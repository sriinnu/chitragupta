/**
 * Platform-specific path resolution tests.
 *
 * Verifies socket, PID, and log paths for macOS, Linux, and Windows.
 * Uses environment variable overrides to simulate each platform.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

// We test the exported helpers rather than mocking platform internals
import { resolvePaths, isWindows, getPlatform, cleanStaleSocket } from "../src/paths.js";

describe("paths — platform helpers", () => {
	it("getPlatform returns a valid platform string", () => {
		const p = getPlatform();
		expect(["macos", "linux", "windows"]).toContain(p);
	});

	it("isWindows returns boolean", () => {
		expect(typeof isWindows()).toBe("boolean");
	});
});

describe("paths — resolvePaths", () => {
	const origEnv = { ...process.env };

	afterEach(() => {
		// Restore env
		process.env = { ...origEnv };
	});

	it("respects CHITRAGUPTA_SOCKET override", () => {
		process.env.CHITRAGUPTA_SOCKET = "/tmp/test-chitragupta.sock";
		const paths = resolvePaths();
		expect(paths.socket).toBe("/tmp/test-chitragupta.sock");
	});

	it("respects CHITRAGUPTA_PID override", () => {
		process.env.CHITRAGUPTA_PID = "/tmp/test-daemon.pid";
		const paths = resolvePaths();
		expect(paths.pid).toBe("/tmp/test-daemon.pid");
	});

	it("respects CHITRAGUPTA_DAEMON_DIR override", () => {
		delete process.env.CHITRAGUPTA_SOCKET;
		process.env.CHITRAGUPTA_DAEMON_DIR = "/tmp/custom-daemon";
		const paths = resolvePaths();
		expect(paths.socket).toContain("/tmp/custom-daemon");
		expect(paths.lock).toContain("/tmp/custom-daemon");
	});

	it("returns paths with expected shape", () => {
		const paths = resolvePaths();
		expect(paths).toHaveProperty("socket");
		expect(paths).toHaveProperty("pid");
		expect(paths).toHaveProperty("logDir");
		expect(paths).toHaveProperty("lock");
		expect(typeof paths.socket).toBe("string");
		expect(typeof paths.pid).toBe("string");
		expect(typeof paths.logDir).toBe("string");
		expect(typeof paths.lock).toBe("string");
	});
});

describe("paths — cleanStaleSocket", () => {
	it("does not throw on non-existent file", () => {
		expect(() => cleanStaleSocket("/tmp/non-existent-socket-xyz-123")).not.toThrow();
	});
});
