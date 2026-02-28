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

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-test-"));
		paths = {
			socket: path.join(tmpDir, "test.sock"),
			pid: path.join(tmpDir, "test.pid"),
			logDir: path.join(tmpDir, "logs"),
			lock: path.join(tmpDir, "test.lock"),
		};

		const router = new RpcRouter();
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
});
