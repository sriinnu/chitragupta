import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
const mockPackContextWithFallback = vi.fn();
const mockNormalizeContextForReuse = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../src/context-packing.js", () => ({
	packContextWithFallback: (...args: unknown[]) => mockPackContextWithFallback(...args),
	normalizeContextForReuse: (...args: unknown[]) => mockNormalizeContextForReuse(...args),
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
		mockNormalizeContextForReuse.mockImplementation(async (value: string) => value);
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
			expect(result.taskId).toMatch(/^task-/);
			expect(result.laneId).toMatch(/^lane-/);
			expect(result.finalReport.status).toBe("failed");
			expect(result.finalReport.failureKind).toBe("executor-unavailable");
			expect(result.artifacts).toEqual(expect.arrayContaining([
				expect.objectContaining({ kind: "log" }),
			]));
			expect(result.output).toContain("not available on PATH");
		});

		it("preserves engine-owned task and lane ids when the caller provides them", async () => {
			configureTakumiBinary({ exists: false });

			const result = await bridge.execute({
				type: "task",
				taskId: "task-engine-1",
				laneId: "lane-engine-1",
				task: "fix bug",
			});

			expect(result.taskId).toBe("task-engine-1");
			expect(result.laneId).toBe("lane-engine-1");
			expect(result.finalReport.taskId).toBe("task-engine-1");
			expect(result.finalReport.laneId).toBe("lane-engine-1");
			expect(result.artifacts.every((artifact) => artifact.taskId === "task-engine-1")).toBe(true);
			expect(result.artifacts.every((artifact) => artifact.laneId === "lane-engine-1")).toBe(true);
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
			expect(result.taskId).toMatch(/^task-/);
			expect(result.laneId).toMatch(/^lane-/);
			expect(result.filesModified).toEqual(["src/login.ts"]);
			expect(result.toolCalls).toEqual(["write"]);
			expect(result.finalReport).toEqual(expect.objectContaining({
				taskId: result.taskId,
				laneId: result.laneId,
				status: "completed",
				toolCalls: ["write"],
				failureKind: null,
			}));
			expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(
				expect.arrayContaining(["patch", "log"]),
			);
			expect(result.output).toContain("Working...");
			expect(events).toContainEqual(expect.objectContaining({
				execution: {
					task: { id: result.taskId },
					lane: { id: result.laneId },
				},
				taskId: result.taskId,
				laneId: result.laneId,
				type: "tool_call",
				data: "write",
			}));
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

		it("surfaces engine-selected provider and model envelopes in the Takumi prompt and env", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
				context: {
					engineRoute: {
						routeClass: "coding.deep-reasoning",
						capability: "model.tool-use",
						selectedCapabilityId: "discovery.model.openai.gpt-4-1",
						executionBinding: {
							source: "kosha-discovery",
							kind: "executor",
							query: { capability: "function_calling", mode: "chat" },
							selectedProviderId: "openai",
							selectedModelId: "gpt-4.1",
							preferredProviderIds: ["openai"],
							preferredModelIds: ["gpt-4.1"],
							allowCrossProvider: false,
						},
						enforced: true,
						reason: "engine-selected high reasoning lane",
						policyTrace: ["route-class:coding.deep-reasoning", "selected:discovery.model.openai.gpt-4-1"],
					},
					engineRouteEnvelope: {
						primaryKey: "primary",
						lanes: [
							{
								key: "primary",
								routeClass: "coding.deep-reasoning",
								capability: "model.tool-use",
								selectedCapabilityId: "discovery.model.openai.gpt-4-1",
								executionBinding: {
									source: "kosha-discovery",
									kind: "executor",
									query: { capability: "function_calling", mode: "chat", role: "planner" },
									selectedProviderId: "openai",
									selectedModelId: "gpt-4.1",
									preferredProviderIds: ["openai"],
									preferredModelIds: ["gpt-4.1"],
									allowCrossProvider: false,
								},
								enforced: true,
								reason: "primary planning lane",
								policyTrace: ["route-class:coding.deep-reasoning"],
							},
							{
								key: "validator",
								routeClass: "coding.validation-high-trust",
								capability: "coding.execute",
								selectedCapabilityId: "adapter.takumi.executor",
								executionBinding: {
									source: "kosha-discovery",
									kind: "model",
									query: { capability: "chat", mode: "chat", role: "validator" },
									selectedProviderId: "llamacpp",
									selectedModelId: "qwen2.5-coder:14b",
									preferredProviderIds: ["llamacpp"],
									preferredModelIds: ["qwen2.5-coder:14b"],
									allowCrossProvider: false,
								},
								enforced: true,
								reason: "validator lane prefers local execution",
								policyTrace: ["route-class:coding.validation-high-trust"],
							},
						],
					},
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
			expect(prompt).toContain("Selected provider: openai");
			expect(prompt).toContain("Selected model: gpt-4.1");
			expect(prompt).toContain("Preferred providers: openai");
			expect(prompt).toContain("Preferred models: gpt-4.1");
			expect(prompt).toContain("Engine lane envelope");
			expect(prompt).toContain("Primary lane: primary");
			expect(prompt).toContain("planner");
			expect(prompt).toContain("validator");
			expect(prompt).toContain("qwen2.5-coder:14b");
			expect(env.CHITRAGUPTA_SELECTED_PROVIDER_ID).toBe("openai");
			expect(env.CHITRAGUPTA_SELECTED_MODEL_ID).toBe("gpt-4.1");
			expect(env.CHITRAGUPTA_PREFERRED_PROVIDER_IDS).toBe("openai");
			expect(env.CHITRAGUPTA_PREFERRED_MODEL_IDS).toBe("gpt-4.1");
			expect(env.CHITRAGUPTA_ALLOW_CROSS_PROVIDER).toBe("0");
			expect(env.CHITRAGUPTA_ENGINE_ROUTE_DIGEST).toMatch(/^[a-f0-9]{16}$/);
			expect(env.CHITRAGUPTA_ENGINE_ROUTE_ENVELOPE).toBeDefined();
			expect(env.CHITRAGUPTA_ENGINE_ROUTE_ENVELOPE_DIGEST).toMatch(/^[a-f0-9]{16}$/);

			proc.stdout._emit("data", Buffer.from("Selected provider: openai\nSelected model: gpt-4.1\n"));
			proc._emit("close", 0);
			await resultPromise;
		});

		it("fails closed when an enforced engine route envelope is too large for structured env transport", async () => {
			configureTakumiBinary({ streamSupported: false });

			const result = await bridge.execute({
				type: "task",
				task: "Coordinate multi-lane coding work",
				context: {
					engineRouteEnvelope: {
						primaryKey: "primary",
						lanes: Array.from({ length: 8 }, (_, index) => ({
							key: `lane-${index + 1}`,
							routeClass: "coding.deep-reasoning",
							capability: "model.tool-use",
							selectedCapabilityId: `discovery.model.local.${index + 1}`,
							executionBinding: {
								source: "kosha-discovery",
								kind: "model",
								query: { capability: "chat", mode: "chat", role: "planner" },
								selectedProviderId: "llamacpp",
								selectedModelId: `qwen2.5-coder:${index + 1}`,
								preferredProviderIds: ["llamacpp"],
								preferredModelIds: [`qwen2.5-coder:${index + 1}`],
								candidateModelIds: Array.from({ length: 16 }, (_, candidate) => `candidate-${index + 1}-${candidate + 1}`),
								allowCrossProvider: false,
							},
								enforced: true,
							reason: "engine-owned envelope",
							policyTrace: [
								"route-class:coding.deep-reasoning",
								"discovery:llamacpp",
								"oversized-envelope-test",
							],
						})),
					},
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("Takumi execution blocked by the Chitragupta engine route contract.");
			expect(result.output).toContain("too large for structured Takumi env transport");
			expect(result.finalReport.failureKind).toBe("route-incompatible");
			expect(result.artifacts).toEqual(expect.arrayContaining([
				expect.objectContaining({ kind: "log" }),
			]));
			expect(mockSpawn).not.toHaveBeenCalled();
		});

		it("packs large engine route envelopes before prompt synthesis", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			mockPackContextWithFallback.mockResolvedValue({
				runtime: "pakt-core",
				packedText: "packed engine envelope",
				format: "pakt",
				savings: 0.37,
				originalLength: 2600,
			});

			const resultPromise = bridge.execute({
				type: "task",
				task: "Coordinate multi-lane coding work",
				context: {
					engineRouteEnvelope: {
						primaryKey: "primary",
						lanes: Array.from({ length: 5 }, (_, index) => ({
							key: `lane-${index + 1}`,
							routeClass: "coding.deep-reasoning",
							capability: "model.tool-use",
							selectedCapabilityId: `discovery.model.local.${index + 1}`,
							executionBinding: {
								source: "kosha-discovery",
								kind: "model",
								query: { capability: "chat", mode: "chat", role: "planner" },
								selectedProviderId: "llamacpp",
								selectedModelId: `qwen2.5-coder:${index + 1}`,
								preferredProviderIds: ["llamacpp"],
								preferredModelIds: [`qwen2.5-coder:${index + 1}`],
								candidateModelIds: Array.from({ length: 8 }, (_, candidate) => `candidate-${index + 1}-${candidate + 1}`),
								allowCrossProvider: false,
							},
								enforced: false,
							reason: "engine-owned envelope",
							policyTrace: [
								"route-class:coding.deep-reasoning",
								"discovery:llamacpp",
								"packed-envelope-test",
							],
						})),
					},
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Engine lane envelope (packed via pakt-core");
			expect(prompt).toContain("packed engine envelope");

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

		it("normalizes previously packed repo context before reusing it in the Takumi prompt", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			mockPackContextWithFallback.mockResolvedValue(null);
			mockNormalizeContextForReuse.mockResolvedValueOnce("expanded repo map");

			const resultPromise = bridge.execute({
				type: "task",
				task: "Inspect auth",
				context: {
					repoMap: "[PAKT packed repo map | runtime=pakt-core | savings=41% | original=900]\npakt:repo-map",
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Repo map:");
			expect(prompt).toContain("expanded repo map");
			expect(prompt).not.toContain("[PAKT packed repo map");

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

		it("packs large episodic and recent-decision sections through engine-owned context packing", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);
			mockPackContextWithFallback
				.mockResolvedValueOnce({
					runtime: "pakt-core",
					packedText: "packed episodic block",
					format: "pakt",
					savings: 0.38,
					originalLength: 1200,
				})
				.mockResolvedValueOnce({
					runtime: "pakt-core",
					packedText: "packed recent decision block",
					format: "pakt",
					savings: 0.44,
					originalLength: 980,
				});

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
				context: {
					episodicHints: [
						"Long episodic hint 1 ".repeat(20),
						"Long episodic hint 2 ".repeat(20),
						"Long episodic hint 3 ".repeat(20),
						"Long episodic hint 4 ".repeat(20),
					],
					recentDecisions: [
						"Long recent decision 1 ".repeat(20),
						"Long recent decision 2 ".repeat(20),
						"Long recent decision 3 ".repeat(20),
						"Long recent decision 4 ".repeat(20),
					],
				},
			});

			await tick();
			const prompt = String(proc.stdin.write.mock.calls[0][0]);
			expect(prompt).toContain("Episodic hints (packed via pakt-core, saved 38%)");
			expect(prompt).toContain("packed episodic block");
			expect(prompt).toContain("Recent decisions (packed via pakt-core, saved 44%)");
			expect(prompt).toContain("packed recent decision block");

			proc._emit("close", 0);
			await resultPromise;
		});

		it("omits bulky raw env context when it would bypass engine packing policy", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Refactor auth",
				context: {
					episodicHints: ["Large hint ".repeat(200)],
					recentDecisions: ["Large decision ".repeat(200)],
					fileContext: {
						"src/auth.ts": "const auth = () => run();\n".repeat(200),
					},
				},
			});

			await tick();
			const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
			expect(env.CHITRAGUPTA_EPISODIC_HINTS).toBeUndefined();
			expect(env.CHITRAGUPTA_RECENT_DECISIONS).toBeUndefined();
			expect(env.CHITRAGUPTA_FILE_CONTEXT).toBeUndefined();
			expect(env.CHITRAGUPTA_EPISODIC_HINTS_OMITTED).toBe("1");
			expect(env.CHITRAGUPTA_RECENT_DECISIONS_OMITTED).toBe("1");
			expect(env.CHITRAGUPTA_FILE_CONTEXT_OMITTED).toBe("1");

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

		it("fails closed when Takumi explicitly reports a provider/model outside an enforced engine lane", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Strict review",
				context: {
					engineRoute: {
						routeClass: "coding.review.strict",
						capability: "coding.review",
						selectedCapabilityId: "adapter.takumi.executor",
						executionBinding: {
							source: "kosha-discovery",
							kind: "executor",
							query: { capability: "chat", mode: "chat", role: "reviewer" },
							selectedProviderId: "openai",
							selectedModelId: "gpt-4.1",
							preferredProviderIds: ["openai"],
							preferredModelIds: ["gpt-4.1"],
							allowCrossProvider: false,
						},
						enforced: true,
					},
				},
			});

			await tick();
			proc.stdout._emit("data", Buffer.from("Selected provider: anthropic\nSelected model: claude-3.7-sonnet\n"));
			proc._emit("close", 0);

			const result = await resultPromise;
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("violated the Chitragupta engine route contract");
			expect(result.contractAudit?.violations).toEqual([
				"Observed provider 'anthropic' is outside the engine-selected provider set: openai",
				"Observed model 'claude-3.7-sonnet' is outside the engine-selected model set: gpt-4.1",
			]);
			expect(result.finalReport.failureKind).toBe("contract-violation");
			expect(result.artifacts).toEqual(expect.arrayContaining([
				expect.objectContaining({ kind: "log" }),
			]));
		});

		it("fails closed when Takumi stays silent about provider/model under an enforced engine lane", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Strict review",
				context: {
					engineRoute: {
						routeClass: "coding.review.strict",
						capability: "coding.review",
						selectedCapabilityId: "adapter.takumi.executor",
						executionBinding: {
							source: "kosha-discovery",
							kind: "executor",
							query: { capability: "chat", mode: "chat", role: "reviewer" },
							selectedProviderId: "openai",
							selectedModelId: "gpt-4.1",
							preferredProviderIds: ["openai"],
							preferredModelIds: ["gpt-4.1"],
							allowCrossProvider: false,
						},
						enforced: true,
					},
				},
			});

			await tick();
			proc.stdout._emit("data", Buffer.from("Working...\n"));
			proc._emit("close", 0);

			const result = await resultPromise;
			expect(result.exitCode).toBe(1);
			expect(result.contractAudit?.violations).toEqual([
				"Takumi did not declare a provider for the enforced engine-selected lane: openai",
				"Takumi did not declare a model for the enforced engine-selected lane: gpt-4.1",
			]);
			expect(result.finalReport.failureKind).toBe("contract-violation");
			expect(result.finalReport.selectedProviderId).toBeNull();
			expect(result.finalReport.selectedModelId).toBeNull();
		});

		it("accepts explicit Takumi provider/model declarations that stay within the enforced engine lane", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Strict review",
				context: {
					engineRoute: {
						routeClass: "coding.review.strict",
						capability: "coding.review",
						selectedCapabilityId: "adapter.takumi.executor",
						executionBinding: {
							source: "kosha-discovery",
							kind: "executor",
							query: { capability: "chat", mode: "chat", role: "reviewer" },
							selectedProviderId: "openai",
							selectedModelId: "gpt-4.1",
							preferredProviderIds: ["openai"],
							preferredModelIds: ["gpt-4.1"],
							allowCrossProvider: false,
						},
						enforced: true,
					},
				},
			});

			await tick();
			proc.stdout._emit("data", Buffer.from("Selected provider: openai\nSelected model: gpt-4.1\n"));
			proc._emit("close", 0);

			const result = await resultPromise;
			expect(result.exitCode).toBe(0);
			expect(result.contractAudit).toEqual({
				observedProviderIds: ["openai"],
				observedModelIds: ["gpt-4.1"],
				violations: [],
			});
		});

		it("uses the primary envelope lane when building the compatibility final report", async () => {
			configureTakumiBinary({ streamSupported: false });
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = bridge.execute({
				type: "task",
				task: "Strict review",
				context: {
					engineRouteEnvelope: {
						primaryKey: "validator",
						lanes: [
							{
								key: "validator",
								routeClass: "coding.validation-high-trust",
								capability: "coding.validation",
								selectedCapabilityId: "adapter.takumi.executor",
								executionBinding: {
									source: "kosha-discovery",
									kind: "executor",
									query: { capability: "chat", mode: "chat", role: "validator" },
									selectedProviderId: "openai",
									selectedModelId: "gpt-4.1",
									allowCrossProvider: true,
								},
								enforced: false,
							},
						],
					},
				},
			});

			await tick();
			proc.stdout._emit("data", Buffer.from("Selected provider: openai\nSelected model: gpt-4.1\n"));
			proc._emit("close", 0);

			const result = await resultPromise;
			expect(result.finalReport.usedRoute).toEqual(expect.objectContaining({
				routeClass: "coding.validation-high-trust",
				capability: "coding.validation",
				selectedCapabilityId: "adapter.takumi.executor",
				selectedProviderId: "openai",
				selectedModelId: "gpt-4.1",
			}));
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
