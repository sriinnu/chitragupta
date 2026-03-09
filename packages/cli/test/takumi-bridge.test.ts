import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
const mockPackContextWithFallback = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../src/context-packing.js", () => ({
	packContextWithFallback: (...args: unknown[]) => mockPackContextWithFallback(...args),
}));

import { parseCliOutput } from "../src/modes/takumi-bridge-helpers.js";
import { TakumiBridge } from "../src/modes/takumi-bridge.js";
import type { TakumiEvent } from "../src/modes/takumi-bridge-types.js";

function createMockProcess() {
	const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
	const stdoutListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
	const stderrListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

	return {
		stdout: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stdoutListeners[event] = stdoutListeners[event] ?? [];
				stdoutListeners[event].push(cb);
			}),
			_emit: (event: string, value: unknown) => {
				stdoutListeners[event]?.forEach((cb) => cb(value));
			},
		},
		stderr: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stderrListeners[event] = stderrListeners[event] ?? [];
				stderrListeners[event].push(cb);
			}),
			_emit: (event: string, value: unknown) => {
				stderrListeners[event]?.forEach((cb) => cb(value));
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

function configureTakumiBinary(options?: {
	exists?: boolean;
	streamSupported?: boolean;
	version?: string;
}) {
	const exists = options?.exists ?? true;
	const streamSupported = options?.streamSupported ?? true;
	const version = options?.version ?? "takumi 1.0.0";

	mockExecFile.mockImplementation(
		(cmd: string, args: string[], ...rest: unknown[]) => {
			const cb = rest[rest.length - 1] as (
				err: Error | null,
				stdout?: string,
				stderr?: string,
			) => void;

			if (cmd === "which" || cmd === "where.exe") {
				if (exists) cb(null, `/usr/local/bin/${args[0]}`);
				else cb(new Error("not found"), "", "");
				return;
			}

			if (cmd === "takumi" && args[0] === "--version") {
				if (exists) cb(null, version, "");
				else cb(new Error("not found"), "", "");
				return;
			}

			if (cmd === "takumi" && args[0] === "--help") {
				if (!exists) {
					cb(new Error("not found"), "", "");
					return;
				}
				if (streamSupported) {
					cb(null, "Takumi help", "");
				} else {
					cb(new Error("Unknown option: --stream"), "", "Unknown option: --stream");
				}
				return;
			}

			cb(new Error("not found"), "", "");
		},
	);
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TakumiBridge", () => {
	let bridge: TakumiBridge;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPackContextWithFallback.mockResolvedValue(null);
		bridge = new TakumiBridge({ cwd: "/tmp/project" });
	});

	afterEach(() => {
		bridge.dispose();
	});

	describe("detect()", () => {
		it("returns unavailable when Takumi is not on PATH", async () => {
			configureTakumiBinary({ exists: false });

			const status = await bridge.detect();

			expect(status).toEqual({ mode: "unavailable", command: "takumi" });
		});

		it("prefers structured mode when Takumi accepts --stream ndjson", async () => {
			configureTakumiBinary({ streamSupported: true });

			const status = await bridge.detect();

			expect(status.mode).toBe("rpc");
			expect(status.version).toBe("takumi 1.0.0");
		});

		it("falls back to cli mode when Takumi rejects --stream", async () => {
			configureTakumiBinary({ streamSupported: false });

			const status = await bridge.detect();

			expect(status.mode).toBe("cli");
		});
	});

	describe("execute()", () => {
		it("returns an unavailable response when Takumi is missing", async () => {
			configureTakumiBinary({ exists: false });

			const result = await bridge.execute({ type: "task", task: "fix bug" });

			expect(result.exitCode).toBe(127);
			expect(result.output).toContain("not available on PATH");
		});

		it("runs Takumi in structured NDJSON mode and synthesizes a result", async () => {
			configureTakumiBinary({ streamSupported: true });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const events: TakumiEvent[] = [];
			const resultPromise = bridge.execute(
				{
					type: "task",
					task: "Fix login flow",
					context: {
						fresh: true,
						episodicHints: ["Check null state before redirect"],
						recentDecisions: ["Prefer explicit error returns"],
						fileContext: {
							"src/login.ts": "const login = async () => redirect();",
						},
					},
				},
				(event) => events.push(event),
			);

			await tick();

			expect(mockSpawn).toHaveBeenCalledWith(
				"takumi",
				["--print", "--stream", "ndjson", "--cwd", "/tmp/project"],
				expect.objectContaining({ cwd: "/tmp/project", stdio: ["pipe", "pipe", "pipe"] }),
			);
			expect(proc.stdin.write).toHaveBeenCalledTimes(1);
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Fix login flow");
			expect(prompt).toContain("Fresh mode is required for this run");
			expect(prompt).toContain("Check null state before redirect");
			expect(prompt).toContain("Prefer explicit error returns");
			expect(prompt).toContain("src/login.ts");

			const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
			expect(env.CHITRAGUPTA_NO_CACHE).toBe("1");
			expect(env.CHITRAGUPTA_FRESH).toBe("1");
			expect(env.CHITRAGUPTA_EPISODIC_HINTS).toBeDefined();
			expect(env.CHITRAGUPTA_RECENT_DECISIONS).toBeDefined();

			proc.stdout._emit(
				"data",
				Buffer.from(
					[
						'{"type":"text_delta","text":"Working..."}',
						'{"type":"tool_use","id":"tool_1","name":"write","input":{"path":"src/login.ts"}}',
						'{"type":"tool_result","id":"tool_1","name":"write","output":"Modified: src/login.ts","isError":false}',
					].join("\n") + "\n",
				),
			);
			proc._emit("close", 0);

			const result = await resultPromise;

			expect(result.modeUsed).toBe("rpc");
			expect(result.cacheIntent).toBe("fresh");
			expect(result.exitCode).toBe(0);
			expect(result.filesModified).toEqual(["src/login.ts"]);
			expect(result.output).toContain("Working...");
			expect(events).toContainEqual({ type: "tool_call", data: "write" });
		});

		it("falls back to plain text mode when stream execution is rejected", async () => {
			configureTakumiBinary({ streamSupported: true });
			const structuredProc = createMockProcess();
			const cliProc = createMockProcess();
			mockSpawn.mockReturnValueOnce(structuredProc).mockReturnValueOnce(cliProc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Repair auth flow",
			});

			await tick();
			structuredProc.stderr._emit("data", Buffer.from("Unknown option: --stream\n"));
			structuredProc._emit("close", 1);

			await tick();
			expect(mockSpawn).toHaveBeenNthCalledWith(
				2,
				"takumi",
				["--print", "--cwd", "/tmp/project"],
				expect.objectContaining({ cwd: "/tmp/project", stdio: ["pipe", "pipe", "pipe"] }),
			);

			cliProc.stdout._emit("data", Buffer.from("Modified: src/auth.ts\n"));
			cliProc._emit("close", 0);

			const result = await resultPromise;
			expect(result.modeUsed).toBe("cli");
			expect(result.exitCode).toBe(0);
			expect(result.filesModified).toEqual(["src/auth.ts"]);
		});

		it("merges injected context into the synthesized prompt", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			bridge.injectContext({
				episodicHints: ["Use composition"],
				recentDecisions: ["Do not use singleton state"],
			});

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Use composition");
			expect(prompt).toContain("Do not use singleton state");

			proc._emit("close", 0);
			await resultPromise;
		});

		it("packs repo and file context before prompt synthesis when the engine allows it", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			mockPackContextWithFallback
				.mockResolvedValueOnce({
					runtime: "pakt-core",
					packedText: "packed repo map",
					format: "pakt",
					savings: 0.42,
					originalLength: 2200,
				})
				.mockResolvedValueOnce({
					runtime: "pakt-core",
					packedText: "packed file excerpts",
					format: "pakt",
					savings: 0.55,
					originalLength: 1800,
				});

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
				context: {
					repoMap: "src/auth.ts -> src/session.ts",
					fileContext: {
						"src/auth.ts": "const auth = () => run();",
						"src/session.ts": "const session = () => keepAlive();",
					},
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Repo map (packed via pakt-core, saved 42%)");
			expect(prompt).toContain("packed repo map");
			expect(prompt).toContain("Relevant file excerpts (packed via pakt-core, saved 55%)");
			expect(prompt).toContain("packed file excerpts");

			proc._emit("close", 0);
			await resultPromise;
		});

		it("does not locally repack repo context when daemon policy returns packed:false", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			mockPackContextWithFallback.mockResolvedValue(null);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Inspect auth",
				context: {
					repoMap: "src/auth.ts -> src/session.ts",
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Repo map:");
			expect(prompt).toContain("src/auth.ts -> src/session.ts");
			expect(prompt).not.toContain("packed via");

			proc._emit("close", 0);
			await resultPromise;
		});

		it("keeps packed Lucy hints materially intact instead of truncating them to generic hint length", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			const packedHint = [
				"[PAKT packed episodic hints | runtime=pakt-core | savings=42% | original=1800]",
				"packed-line-1",
				"packed-line-2",
				"packed-line-3",
				"packed-line-4",
				"packed-line-5",
			].join("\n");

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
				context: {
					episodicHints: [packedHint],
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("[PAKT packed episodic hints");
			expect(prompt).toContain("packed-line-5");

			proc._emit("close", 0);
			await resultPromise;
		});

		it("records default cache intent when fresh mode is not requested", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
			});

			await tick();
			const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
			expect(env.CHITRAGUPTA_NO_CACHE).toBeUndefined();
			expect(env.CHITRAGUPTA_FRESH).toBeUndefined();

			proc._emit("close", 0);
			const result = await resultPromise;
			expect(result.cacheIntent).toBe("default");
		});
	});

	describe("dispose()", () => {
		it("kills the active child process", async () => {
			configureTakumiBinary({ streamSupported: true });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({ type: "task", task: "Long task" });
			await tick();

			bridge.dispose();
			expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

			proc._emit("close", 143);
			await resultPromise;
		});
	});
});

describe("parseCliOutput", () => {
	it("extracts modified files from mixed output", () => {
		const result = parseCliOutput(
			[
				"Modified: src/a.ts",
				"diff --git a/src/b.ts b/src/b.ts",
				"+++ b/src/b.ts",
			].join("\n"),
		);

		expect(result.filesModified).toEqual(["src/b.ts", "src/a.ts"]);
	});

	it("extracts test summaries when present", () => {
		const result = parseCliOutput("Tests: 3 passed, 1 failed, 4 total");

		expect(result.testsRun).toEqual({ passed: 3, failed: 1, total: 4 });
	});
});
