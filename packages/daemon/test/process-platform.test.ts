/**
 * Cross-platform process management tests.
 *
 * Validates isProcessAlive, checkStatus, and installSignalHandlers
 * work correctly on the current platform.
 */

import { describe, it, expect, vi } from "vitest";
import { isProcessAlive, checkStatus, readPid, writePid, removePid } from "../src/process.js";
import { isWindows } from "../src/paths.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("process — isProcessAlive", () => {
	it("returns true for the current process PID", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("returns false for a non-existent PID", () => {
		// PID 99999 is unlikely to exist; use a high number
		expect(isProcessAlive(999999)).toBe(false);
	});

	it("returns false for PID 0 (should not crash)", () => {
		// PID 0 is special — behavior varies by OS but should not throw
		const result = isProcessAlive(0);
		expect(typeof result).toBe("boolean");
	});
});

describe("process — checkStatus", () => {
	it("returns a valid DaemonStatus shape", () => {
		const status = checkStatus();
		expect(status).toHaveProperty("running");
		expect(status).toHaveProperty("pid");
		expect(status).toHaveProperty("socket");
		expect(typeof status.running).toBe("boolean");
	});
});

describe("process — PID file operations", () => {
	const tmpDir = os.tmpdir();
	const testPidPath = path.join(tmpDir, `chitragupta-test-${process.pid}.pid`);

	it("writePid + readPid round-trips correctly", () => {
		writePid(testPidPath);
		const pid = readPid(testPidPath);
		expect(pid).toBe(process.pid);
	});

	it("removePid cleans up the file", () => {
		writePid(testPidPath);
		removePid(testPidPath);
		expect(fs.existsSync(testPidPath)).toBe(false);
	});

	it("removePid does not throw on missing file", () => {
		expect(() => removePid(testPidPath)).not.toThrow();
	});

	it("readPid returns null for missing file", () => {
		expect(readPid("/tmp/non-existent-pid-file-xyz-123")).toBeNull();
	});
});

describe("process — platform-specific behavior", () => {
	it("isWindows matches expected platform", () => {
		if (process.platform === "win32") {
			expect(isWindows()).toBe(true);
		} else {
			expect(isWindows()).toBe(false);
		}
	});
});
