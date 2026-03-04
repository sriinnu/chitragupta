/**
 * Tests for Scarlett — Self-Healing Daemon Watchdog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScarlettWatchdog, startScarlett, stopScarlett, type ScarlettConfig } from "../src/scarlett-watchdog.js";
import type { DaemonPaths } from "../src/paths.js";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/** Create a temp directory for test PID/socket/log files. */
function makeTempPaths(): DaemonPaths {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scarlett-test-"));
	return {
		socket: path.join(dir, "test.sock"),
		pid: path.join(dir, "test.pid"),
		logDir: path.join(dir, "logs"),
		lock: path.join(dir, "test.lock"),
	};
}

/** Write a fake PID file. */
function writePid(pidPath: string, pid: number): void {
	fs.mkdirSync(path.dirname(pidPath), { recursive: true });
	fs.writeFileSync(pidPath, String(pid), "utf-8");
}

// Mock process.ts functions
vi.mock("../src/process.js", () => ({
	readPid: vi.fn(),
	removePid: vi.fn(),
	isProcessAlive: vi.fn(),
	spawnDaemon: vi.fn(),
}));

// Import mocked functions
import { readPid, removePid, isProcessAlive, spawnDaemon } from "../src/process.js";

const mockReadPid = vi.mocked(readPid);
const mockRemovePid = vi.mocked(removePid);
const mockIsProcessAlive = vi.mocked(isProcessAlive);
const mockSpawnDaemon = vi.mocked(spawnDaemon);

describe("ScarlettWatchdog", () => {
	let watchdog: ScarlettWatchdog;
	let paths: DaemonPaths;

	const testConfig: ScarlettConfig = {
		pollIntervalMs: 50,
		maxRestartsInWindow: 5,
		stormWindowMs: 5000,
		baseBackoffMs: 10,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		paths = makeTempPaths();
		watchdog = new ScarlettWatchdog({ ...testConfig, paths });
	});

	afterEach(() => {
		watchdog.stop();
		stopScarlett();
		// Clean temp dir
		try {
			fs.rmSync(path.dirname(paths.pid), { recursive: true, force: true });
		} catch { /* best-effort */ }
	});

	it("starts and stops cleanly", () => {
		expect(watchdog.isRunning()).toBe(false);
		watchdog.start();
		expect(watchdog.isRunning()).toBe(true);
		watchdog.stop();
		expect(watchdog.isRunning()).toBe(false);
	});

	it("start is idempotent", () => {
		watchdog.start();
		watchdog.start(); // no-op
		expect(watchdog.isRunning()).toBe(true);
		watchdog.stop();
	});

	it("stop is idempotent", () => {
		watchdog.stop(); // no-op when not running
		watchdog.start();
		watchdog.stop();
		watchdog.stop(); // no-op
		expect(watchdog.isRunning()).toBe(false);
	});

	describe("health check", () => {
		it("does nothing when no PID file exists", async () => {
			mockReadPid.mockReturnValue(null);
			await watchdog.check();
			expect(mockIsProcessAlive).not.toHaveBeenCalled();
			expect(mockSpawnDaemon).not.toHaveBeenCalled();
		});

		it("detects dead daemon when PID file exists but process not alive", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			const crashes: Array<[number | null, string]> = [];
			watchdog.on("crash-detected", (pid, reason) => crashes.push([pid, reason]));

			await watchdog.check();

			expect(crashes).toHaveLength(1);
			expect(crashes[0][0]).toBe(12345);
			expect(crashes[0][1]).toBe("process not alive");
			expect(mockRemovePid).toHaveBeenCalled();
		});

		it("triggers restart after crash detection", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			const successes: number[] = [];
			watchdog.on("restart-success", (pid) => successes.push(pid));

			await watchdog.check();

			expect(mockSpawnDaemon).toHaveBeenCalledOnce();
			expect(successes).toEqual([99999]);
		});

		it("emits restart-failed when spawnDaemon throws", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockRejectedValue(new Error("spawn failed"));

			const failures: Array<[number, string]> = [];
			watchdog.on("restart-failed", (attempt, err) => failures.push([attempt, err]));

			await watchdog.check();

			expect(failures).toHaveLength(1);
			expect(failures[0][0]).toBe(1);
			expect(failures[0][1]).toContain("spawn failed");
		});
	});

	describe("backoff", () => {
		it("uses exponential backoff on restarts", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			const attempts: Array<[number, number]> = [];
			watchdog.on("restart-attempt", (n, backoff) => attempts.push([n, backoff]));

			// First restart
			await watchdog.check();
			expect(attempts[0][1]).toBe(10); // baseBackoff * 2^0

			// Second restart
			await watchdog.check();
			expect(attempts[1][1]).toBe(20); // baseBackoff * 2^1

			// Third restart
			await watchdog.check();
			expect(attempts[2][1]).toBe(40); // baseBackoff * 2^2
		});
	});

	describe("storm prevention", () => {
		it("detects restart storm and gives up", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			const storms: Array<[number, number]> = [];
			const giveUps: string[] = [];
			watchdog.on("storm-detected", (count, window) => storms.push([count, window]));
			watchdog.on("giving-up", (reason) => giveUps.push(reason));

			watchdog.start();

			// Trigger max restarts
			for (let i = 0; i < 5; i++) {
				await watchdog.check();
			}

			// Next check should detect storm
			await watchdog.check();

			expect(storms).toHaveLength(1);
			expect(storms[0][0]).toBe(5);
			expect(giveUps).toHaveLength(1);
			expect(watchdog.isRunning()).toBe(false);
		});

		it("tracks restarts in sliding window", () => {
			const wd = new ScarlettWatchdog({ ...testConfig, paths });
			expect(wd.restartsInWindow()).toBe(0);
			wd.stop();
		});
	});

	describe("stale file cleanup", () => {
		it("cleans up PID file on dead process", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			await watchdog.check();

			expect(mockRemovePid).toHaveBeenCalledWith(paths.pid);
		});
	});

	describe("watchdog log", () => {
		it("writes to scarlett-watchdog.log on restart", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockResolvedValue(99999);

			await watchdog.check();

			const logPath = path.join(paths.logDir, "scarlett-watchdog.log");
			expect(fs.existsSync(logPath)).toBe(true);
			const content = fs.readFileSync(logPath, "utf-8");
			expect(content).toContain("RESTART OK");
			expect(content).toContain("pid=99999");
		});

		it("writes failure to log", async () => {
			mockReadPid.mockReturnValue(12345);
			mockIsProcessAlive.mockReturnValue(false);
			mockSpawnDaemon.mockRejectedValue(new Error("boom"));

			await watchdog.check();

			const logPath = path.join(paths.logDir, "scarlett-watchdog.log");
			const content = fs.readFileSync(logPath, "utf-8");
			expect(content).toContain("RESTART FAILED");
			expect(content).toContain("boom");
		});
	});

	describe("convenience API", () => {
		it("startScarlett creates and starts watchdog", () => {
			const wd = startScarlett({ ...testConfig, paths });
			expect(wd.isRunning()).toBe(true);
			stopScarlett();
			expect(wd.isRunning()).toBe(false);
		});

		it("startScarlett returns same instance if already running", () => {
			const wd1 = startScarlett({ ...testConfig, paths });
			const wd2 = startScarlett({ ...testConfig, paths });
			expect(wd1).toBe(wd2);
			stopScarlett();
		});

		it("stopScarlett is no-op when not started", () => {
			stopScarlett(); // should not throw
		});
	});
});
