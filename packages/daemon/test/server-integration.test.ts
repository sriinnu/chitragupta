/**
 * Integration test: real Unix socket server + client communication.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../src/client.js";
import type { DaemonPaths } from "../src/paths.js";
import { RpcRouter } from "../src/rpc-router.js";
import { startServer, type DaemonServer } from "../src/server.js";

describe("Server integration (real socket)", () => {
	let tmpDir: string;
	let paths: DaemonPaths;
	let server: DaemonServer;
	let client: DaemonClient;
	let router: RpcRouter;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-test-"));
		paths = {
			socket: path.join(tmpDir, "test.sock"),
			pid: path.join(tmpDir, "test.pid"),
			logDir: path.join(tmpDir, "logs"),
			lock: path.join(tmpDir, "test.lock"),
		};

		router = new RpcRouter();
		router.register("echo", async (params) => ({ echo: params.msg }), "Echo");
		router.register("add", async (params) => ({
			sum: Number(params.a) + Number(params.b),
		}), "Add two numbers");

		server = await startServer({ paths, router });
		client = new DaemonClient({ socketPath: paths.socket, autoStart: false, timeout: 5_000 });
		await client.connect();
	});

	afterEach(async () => {
		client.disconnect();
		await server.stop();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should ping the daemon", async () => {
		const result = (await client.call("daemon.ping")) as Record<string, unknown>;
		expect(result.pong).toBe(true);
	});

	it("should call custom echo method", async () => {
		const result = (await client.call("echo", { msg: "hello daemon" })) as Record<string, unknown>;
		expect(result.echo).toBe("hello daemon");
	});

	it("should handle method not found", async () => {
		await expect(client.call("nonexistent.method")).rejects.toThrow("Method not found");
	});

	it("should call add method", async () => {
		const result = (await client.call("add", { a: 3, b: 7 })) as Record<string, unknown>;
		expect(result.sum).toBe(10);
	});

	it("should handle multiple concurrent requests", async () => {
		const results = await Promise.all([
			client.call("echo", { msg: "one" }),
			client.call("echo", { msg: "two" }),
			client.call("echo", { msg: "three" }),
			client.call("add", { a: 10, b: 20 }),
		]);
		expect((results[0] as Record<string, unknown>).echo).toBe("one");
		expect((results[1] as Record<string, unknown>).echo).toBe("two");
		expect((results[2] as Record<string, unknown>).echo).toBe("three");
		expect((results[3] as Record<string, unknown>).sum).toBe(30);
	});

	it("should report connection count", () => {
		expect(server.connectionCount()).toBe(1);
	});

	it("should handle client disconnect gracefully", () => {
		client.disconnect();
		expect(client.isConnected()).toBe(false);
		// Server should have 0 connections after a moment
	});

	it("should support health check", async () => {
		const health = (await client.call("daemon.health")) as Record<string, unknown>;
		expect(health.status).toBe("ok");
		expect(typeof health.pid).toBe("number");
		expect(typeof health.methods).toBe("number");
	});

	it("should deliver server-push notifications to connected clients", async () => {
		const received: Array<Record<string, unknown>> = [];
		const unsubscribe = client.onNotification("pattern_detected", (params) => {
			received.push(params);
		});

		const delivered = router.notify("pattern_detected", { type: "tool_sequence", confidence: 0.8 });
		expect(delivered).toBe(1);

		await new Promise((resolve) => setTimeout(resolve, 20));
		unsubscribe();

		expect(received).toEqual([
			expect.objectContaining({ type: "tool_sequence", confidence: 0.8 }),
		]);
	});

	it("should reject second daemon bind when socket is already live", async () => {
		const secondRouter = new RpcRouter();
		await expect(startServer({ paths, router: secondRouter }))
			.rejects
			.toThrow("Socket already in use by a live daemon");
	});

	it("should reconnect the same client after daemon restart and keep notifications alive", async () => {
		const received: Array<Record<string, unknown>> = [];
		client.onNotification("akasha.trace_added", (params) => {
			received.push(params);
		});

		const deliveredBefore = router.notify("akasha.trace_added", { trace: { id: "trace-1" } });
		expect(deliveredBefore).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 20));

		await server.stop();
		await new Promise((resolve) => setTimeout(resolve, 20));

		const restartedRouter = new RpcRouter();
		restartedRouter.register("echo", async (params) => ({ echo: params.msg }), "Echo");
		server = await startServer({ paths, router: restartedRouter });

		const echoed = (await client.call("echo", { msg: "after restart" })) as Record<string, unknown>;
		expect(echoed.echo).toBe("after restart");

		const deliveredAfter = restartedRouter.notify("akasha.trace_added", { trace: { id: "trace-2" } });
		expect(deliveredAfter).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(received).toEqual([
			expect.objectContaining({ trace: expect.objectContaining({ id: "trace-1" }) }),
			expect.objectContaining({ trace: expect.objectContaining({ id: "trace-2" }) }),
		]);
	});
});

describe("Server integration auth (real socket)", () => {
	let tmpDir: string;
	let paths: DaemonPaths;
	let server: DaemonServer;
	let router: RpcRouter;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-auth-test-"));
		paths = {
			socket: path.join(tmpDir, "auth.sock"),
			pid: path.join(tmpDir, "auth.pid"),
			logDir: path.join(tmpDir, "logs"),
			lock: path.join(tmpDir, "auth.lock"),
		};

		router = new RpcRouter();
		router.register("akasha.leave", async () => ({ ok: true }), "Synthetic write route");
		server = await startServer({
			paths,
			router,
			auth: {
				required: true,
				validateToken(token) {
					if (token === "chg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
						return {
							authenticated: true,
							tenantId: "local",
							keyId: "admin-key",
							scopes: ["admin"],
						};
					}
					if (token === "chg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
						return {
							authenticated: true,
							tenantId: "local",
							keyId: "read-key",
							scopes: ["read"],
						};
					}
					return { authenticated: false, error: "invalid key" };
				},
			},
		});
	});

	afterEach(async () => {
		await server.stop();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("authenticates a bridge client before allowing requests", async () => {
		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: "chg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});
		await client.connect();

		const health = await client.call("daemon.health") as Record<string, unknown>;
		expect(health.status).toBe("ok");
		client.disconnect();
	});

	it("rejects unauthenticated requests when auth is required", async () => {
		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: "",
		});
		await client.connect();
		await expect(client.call("daemon.health")).rejects.toThrow("Bridge authentication required");
		client.disconnect();
	});

	it("rejects invalid bridge tokens during the handshake", async () => {
		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: "chg_cccccccccccccccccccccccccccccccc",
		});
		await expect(client.connect()).rejects.toThrow(/invalid key|Bridge authentication failed/);
		client.disconnect();
	});

	it("enforces method scopes after a successful handshake", async () => {
		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: "chg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		await client.connect();

		const health = await client.call("daemon.health") as Record<string, unknown>;
		expect(health.status).toBe("ok");
		await expect(client.call("akasha.leave", { text: "forbidden" })).rejects.toThrow("Insufficient scope");
		client.disconnect();
	});
});
