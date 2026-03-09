import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../src/client.js";
import type { DaemonPaths } from "../src/paths.js";
import { RpcRouter } from "../src/rpc-router.js";
import { startServer, type DaemonServer } from "../src/server.js";
import type { DaemonServerAuthConfig } from "../src/auth.js";

const VALID_READ_WRITE_KEY = "chg_0123456789abcdef0123456789abcdef";
const VALID_READ_ONLY_KEY = "chg_fedcba9876543210fedcba9876543210";

describe("Server auth", () => {
	let tmpDir: string;
	let paths: DaemonPaths;
	let server: DaemonServer | null = null;
	let router: RpcRouter;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-auth-"));
		paths = {
			socket: path.join(tmpDir, "auth.sock"),
			pid: path.join(tmpDir, "auth.pid"),
			logDir: path.join(tmpDir, "logs"),
			lock: path.join(tmpDir, "auth.lock"),
		};

		router = new RpcRouter();
		router.register("echo", async (params) => ({ echo: params.msg }), "Echo");
		router.register("akasha.leave", async () => ({ ok: true }), "Write Akasha");
		router.register("compression.compress", async () => ({ ok: true }), "Compression");
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("rejects requests before bridge authentication", async () => {
		server = await startServer({
			paths,
			router,
			auth: createStubAuth(),
		});

		const client = new DaemonClient({ socketPath: paths.socket, autoStart: false, timeout: 5_000 });
		await client.connect();
		await expect(client.call("echo", { msg: "hello" })).rejects.toThrow(
			"Bridge authentication required",
		);
		client.disconnect();
	});

	it("rejects invalid bridge keys during handshake", async () => {
		server = await startServer({
			paths,
			router,
			auth: createStubAuth(),
		});

		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: "chg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});

		await expect(client.connect()).rejects.toThrow("Invalid bridge key");
		client.disconnect();
	});

	it("allows scoped requests after a successful handshake", async () => {
		server = await startServer({
			paths,
			router,
			auth: createStubAuth(),
		});

		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: VALID_READ_WRITE_KEY,
		});

		await client.connect();
		const result = (await client.call("echo", { msg: "hello" })) as { echo: string };
		expect(result.echo).toBe("hello");
		client.disconnect();
	});

	it("blocks methods outside the authenticated scope set", async () => {
		server = await startServer({
			paths,
			router,
			auth: createStubAuth(),
		});

		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: VALID_READ_ONLY_KEY,
		});

		await client.connect();
		await expect(client.call("akasha.leave", { topic: "x" })).rejects.toThrow(
			"Insufficient scope for akasha.leave",
		);
		await expect(client.call("compression.compress", { text: "abc" })).rejects.toThrow(
			"Insufficient scope for compression.compress",
		);
		client.disconnect();
	});

	it("rate-limits authenticated callers when configured", async () => {
		server = await startServer({
			paths,
			router,
			auth: createStubAuth({
				requestRateLimit: {
					maxRequests: 1,
					windowMs: 60_000,
					exemptMethods: ["auth.handshake", "daemon.ping"],
				},
			}),
		});

		const client = new DaemonClient({
			socketPath: paths.socket,
			autoStart: false,
			timeout: 5_000,
			apiKey: VALID_READ_WRITE_KEY,
		});

		await client.connect();
		await client.call("echo", { msg: "first" });
		await expect(client.call("echo", { msg: "second" })).rejects.toThrow(
			"Bridge rate limit exceeded",
		);
		client.disconnect();
	});
});

function createStubAuth(
	overrides: Partial<DaemonServerAuthConfig> = {},
): DaemonServerAuthConfig {
	return {
		required: true,
		validateToken(token: string) {
			if (token === VALID_READ_WRITE_KEY) {
				return {
					authenticated: true,
					keyId: "key-rw",
					tenantId: "tenant-a",
					scopes: ["read", "write", "sessions", "memory"],
				};
			}
			if (token === VALID_READ_ONLY_KEY) {
				return {
					authenticated: true,
					keyId: "key-ro",
					tenantId: "tenant-a",
					scopes: ["read"],
				};
			}
			return { authenticated: false, error: "Invalid bridge key" };
		},
		...overrides,
	};
}
