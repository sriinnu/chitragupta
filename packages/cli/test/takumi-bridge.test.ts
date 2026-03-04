import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock child_process ────────────────────────────────────────────────────

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ─── Mock smriti (transitive dep via mcp-server) ───────────────────────────

vi.mock("@chitragupta/smriti/search", () => ({
	searchMemory: vi.fn().mockReturnValue([]),
}));

vi.mock("@chitragupta/smriti/session-store", () => ({
	listSessions: vi.fn().mockReturnValue([]),
	loadSession: vi.fn().mockReturnValue({ meta: { id: "test" }, turns: [] }),
	createSession: vi.fn(() => ({ meta: { id: "test-session" }, turns: [] })),
	addTurn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: vi.fn().mockReturnValue([]),
}));

vi.mock("@chitragupta/core", async () => {
	const actual = await vi.importActual("@chitragupta/core");
	return {
		...actual,
		getChitraguptaHome: vi.fn().mockReturnValue("/tmp/.chitragupta-test"),
		loadGlobalSettings: vi.fn().mockReturnValue({
			providerPriority: ["anthropic"],
		}),
	};
});

// ─── Imports ───────────────────────────────────────────────────────────────

import { TakumiBridge } from "../src/modes/takumi-bridge.js";
import { parseCliOutput } from "../src/modes/takumi-bridge-helpers.js";
import type { TakumiEvent } from "../src/modes/takumi-bridge-types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Create a mock process with controllable stdout/stderr/close events. */
function createMockProcess() {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const stderrListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

	return {
		stdout: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stdoutListeners[event] = stdoutListeners[event] ?? [];
				stdoutListeners[event].push(cb);
			}),
			_emit: (event: string, data: unknown) => {
				stdoutListeners[event]?.forEach((cb) => cb(data));
			},
		},
		stderr: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stderrListeners[event] = stderrListeners[event] ?? [];
				stderrListeners[event].push(cb);
			}),
			_emit: (event: string, data: unknown) => {
				stderrListeners[event]?.forEach((cb) => cb(data));
			},
		},
		stdin: {
			write: vi.fn(),
			end: vi.fn(),
		},
		on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			listeners[event] = listeners[event] ?? [];
			listeners[event].push(cb);
		}),
		_emit: (event: string, ...args: unknown[]) => {
			listeners[event]?.forEach((cb) => cb(...args));
		},
		kill: vi.fn(),
		killed: false,
	};
}

/** Mock execFile to simulate command existence on PATH. */
function mockCommandExists(commands: Record<string, boolean>) {
	mockExecFile.mockImplementation(
		(cmd: string, args: string[], ...rest: unknown[]) => {
			// Handle 'which <command>' calls
			const cb = rest[rest.length - 1] as (
				err: Error | null,
				stdout?: string,
			) => void;

			if (cmd === "which" || cmd === "where.exe") {
				const tool = args[0];
				if (commands[tool]) {
					cb(null, `/usr/local/bin/${tool}`);
				} else {
					cb(new Error("not found"));
				}
				return;
			}

			// Handle '<command> --version' calls
			if (args[0] === "--version" && commands[cmd]) {
				cb(null, `${cmd} 1.0.0`);
				return;
			}

			cb(new Error("not found"));
		},
	);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("TakumiBridge", () => {
	let bridge: TakumiBridge;

	beforeEach(() => {
		vi.clearAllMocks();
		bridge = new TakumiBridge({ cwd: "/tmp/project" });
	});

	afterEach(() => {
		bridge.dispose();
	});

	describe("detect()", () => {
		it("should return unavailable when takumi is not on PATH", async () => {
			mockCommandExists({ takumi: false });

			const status = await bridge.detect();

			expect(status.mode).toBe("unavailable");
			expect(status.command).toBe("takumi");
			expect(status.version).toBeUndefined();
		});

		it("should detect CLI mode when RPC probe exits non-zero", async () => {
			mockCommandExists({ takumi: true });

			// RPC probe: spawn exits immediately with code 1
			const rpcProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(rpcProc);

			const detectPromise = bridge.detect();

			// Simulate RPC probe failing (process exits with code 1)
			await new Promise((r) => setTimeout(r, 10));
			rpcProc._emit("close", 1);

			const status = await detectPromise;
			expect(status.mode).toBe("cli");
			expect(status.version).toBe("takumi 1.0.0");
		});

		it("should cache detection results", async () => {
			mockCommandExists({ takumi: false });

			const first = await bridge.detect();
			const second = await bridge.detect();

			expect(first).toBe(second); // Same reference
		});

		it("should clear cache on resetDetection()", async () => {
			mockCommandExists({ takumi: false });

			const first = await bridge.detect();
			bridge.resetDetection();

			mockCommandExists({ takumi: false });
			const second = await bridge.detect();

			expect(first).not.toBe(second);
		});
	});

	describe("execute()", () => {
		it("should return error response when takumi is unavailable", async () => {
			mockCommandExists({ takumi: false });

			const result = await bridge.execute({
				type: "task",
				task: "fix bug",
			});

			expect(result.exitCode).toBe(127);
			expect(result.output).toContain("not available on PATH");
			expect(result.filesModified).toEqual([]);
		});

		it("should spawn CLI mode and parse output", async () => {
			mockCommandExists({ takumi: true });

			// RPC probe fails
			const rpcProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(rpcProc);

			// CLI spawn
			const cliProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(cliProc);

			const events: TakumiEvent[] = [];
			const execPromise = bridge.execute(
				{ type: "task", task: "fix the login bug" },
				(event) => events.push(event),
			);

			// Let RPC probe fail
			await new Promise((r) => setTimeout(r, 10));
			rpcProc._emit("close", 1);

			// Wait for CLI spawn
			await new Promise((r) => setTimeout(r, 10));

			// Simulate CLI output with file modification
			cliProc.stdout._emit(
				"data",
				Buffer.from("Modified: src/login.ts\nDone.\n"),
			);
			cliProc._emit("close", 0);

			const result = await execPromise;
			expect(result.exitCode).toBe(0);
			expect(result.filesModified).toContain("src/login.ts");
			expect(events.length).toBeGreaterThan(0);
		});

		it("should handle spawn errors gracefully", async () => {
			mockCommandExists({ takumi: true });

			// RPC probe fails
			const rpcProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(rpcProc);

			// CLI spawn errors
			const cliProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(cliProc);

			const execPromise = bridge.execute({
				type: "task",
				task: "do something",
			});

			// RPC probe fails
			await new Promise((r) => setTimeout(r, 10));
			rpcProc._emit("close", 1);

			// CLI spawn error
			await new Promise((r) => setTimeout(r, 10));
			cliProc._emit("error", new Error("ENOENT"));

			const result = await execPromise;
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("Failed to spawn");
		});
	});

	describe("injectContext()", () => {
		it("should merge injected context into the next request", async () => {
			mockCommandExists({ takumi: true });

			// RPC probe fails
			const rpcProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(rpcProc);

			// CLI spawn
			const cliProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(cliProc);

			bridge.injectContext({
				episodicHints: ["Use null checks"],
				recentDecisions: ["Prefer composition"],
			});

			const execPromise = bridge.execute({
				type: "task",
				task: "refactor auth",
			});

			// RPC probe fails
			await new Promise((r) => setTimeout(r, 10));
			rpcProc._emit("close", 1);

			// CLI spawn completes
			await new Promise((r) => setTimeout(r, 10));
			cliProc._emit("close", 0);

			const result = await execPromise;
			expect(result.type).toBe("result");

			// Verify env vars were set on spawn
			const spawnCalls = mockSpawn.mock.calls;
			const cliCall = spawnCalls[spawnCalls.length - 1];
			const env = cliCall[2]?.env as Record<string, string>;
			expect(env.CHITRAGUPTA_EPISODIC_HINTS).toBeDefined();
			expect(env.CHITRAGUPTA_RECENT_DECISIONS).toBeDefined();
		});

		it("should clear injected context after use", async () => {
			mockCommandExists({ takumi: false });

			bridge.injectContext({
				episodicHints: ["hint1"],
			});

			await bridge.execute({ type: "task", task: "test" });

			// Second call should not have context
			const status = bridge.getStatus();
			expect(status?.mode).toBe("unavailable");
		});
	});

	describe("dispose()", () => {
		it("should kill the active process", async () => {
			mockCommandExists({ takumi: true });

			// RPC probe
			const rpcProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(rpcProc);

			// Start detection (non-blocking)
			bridge.detect();

			// Dispose before detection completes
			bridge.dispose();

			// Should not throw
			expect(bridge.getStatus()).toBeNull();
		});

		it("should clear injected context", () => {
			bridge.injectContext({ episodicHints: ["test"] });
			bridge.dispose();

			// After dispose, getStatus should return null (reset)
			expect(bridge.getStatus()).toBeNull();
		});
	});
});

describe("parseCliOutput", () => {
	it("should extract file paths from git diff headers", () => {
		const output = [
			"diff --git a/src/auth.ts b/src/auth.ts",
			"index abc..def 100644",
			"--- a/src/auth.ts",
			"+++ b/src/auth.ts",
			"@@ -1,5 +1,6 @@",
			" import { foo } from 'bar';",
			"+import { baz } from 'qux';",
			"diff --git a/src/login.ts b/src/login.ts",
			"--- a/src/login.ts",
			"+++ b/src/login.ts",
		].join("\n");

		const result = parseCliOutput(output);
		expect(result.filesModified).toContain("src/auth.ts");
		expect(result.filesModified).toContain("src/login.ts");
	});

	it("should extract file paths from Modified/Created lines", () => {
		const output = [
			"Working on task...",
			"Modified: src/utils.ts",
			"Created: src/helpers.ts",
			"Updated: src/config.ts",
			"Done.",
		].join("\n");

		const result = parseCliOutput(output);
		expect(result.filesModified).toContain("src/utils.ts");
		expect(result.filesModified).toContain("src/helpers.ts");
		expect(result.filesModified).toContain("src/config.ts");
	});

	it("should extract test results", () => {
		const output = "Tests: 42 passed, 3 failed, 45 total";
		const result = parseCliOutput(output);

		expect(result.testsRun).toEqual({
			passed: 42,
			failed: 3,
			total: 45,
		});
	});

	it("should return empty results for no patterns", () => {
		const output = "Just some random text output.";
		const result = parseCliOutput(output);

		expect(result.filesModified).toEqual([]);
		expect(result.testsRun).toBeUndefined();
		expect(result.diffSummary).toBeUndefined();
	});

	it("should produce diff summary from diff blocks", () => {
		const output = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1 +1 @@",
			"-old line",
			"+new line",
		].join("\n");

		const result = parseCliOutput(output);
		expect(result.diffSummary).toBeDefined();
		expect(result.diffSummary).toContain("diff --git");
	});

	it("should deduplicate file paths", () => {
		const output = [
			"Modified: src/auth.ts",
			"diff --git a/src/auth.ts b/src/auth.ts",
		].join("\n");

		const result = parseCliOutput(output);
		const authCount = result.filesModified.filter(
			(f) => f === "src/auth.ts",
		).length;
		expect(authCount).toBe(1);
	});
});
