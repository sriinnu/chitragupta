import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeDaemonMethod, resolveDaemonClientToken } from "../src/auth.js";

describe("daemon auth helpers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("prefers the MCP-specific bridge key override", () => {
		vi.stubEnv("CHITRAGUPTA_MCP_BRIDGE_API_KEY", "chg_0123456789abcdef0123456789abcdef");
		vi.stubEnv("CHITRAGUPTA_DAEMON_API_KEY", "chg_fedcba9876543210fedcba9876543210");

		expect(resolveDaemonClientToken()).toBe("chg_0123456789abcdef0123456789abcdef");
	});

	it("falls back to the daemon token file when env is unset", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-auth-"));
		const paths = {
			socket: path.join(tmpDir, "daemon.sock"),
			pid: path.join(tmpDir, "daemon.pid"),
			logDir: path.join(tmpDir, "logs"),
			lock: path.join(tmpDir, "daemon.lock"),
		};
		const tokenPath = path.join(tmpDir, "daemon.api-key");
		fs.writeFileSync(tokenPath, "chg_0123456789abcdef0123456789abcdef\n", "utf-8");

		try {
			expect(resolveDaemonClientToken(paths)).toBe("chg_0123456789abcdef0123456789abcdef");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws for malformed env overrides", () => {
		vi.stubEnv("CHITRAGUPTA_MCP_BRIDGE_API_KEY", "bad-key");
		expect(() => resolveDaemonClientToken()).toThrow("Bridge key must match");
	});

	it("requires write scope for discovery.refresh while allowing read-only discovery queries", () => {
		expect(authorizeDaemonMethod("discovery.providers", ["read"])).toEqual({ allowed: true });
		expect(authorizeDaemonMethod("discovery.refresh", ["read"])).toEqual({
			allowed: false,
			required: "write",
		});
		expect(authorizeDaemonMethod("discovery.refresh", ["write"])).toEqual({ allowed: true });
	});
});
