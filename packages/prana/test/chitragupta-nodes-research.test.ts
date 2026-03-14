import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeContext } from "../src/chitragupta-nodes.js";

	const {
		appendMemory,
		packLiveContextText,
		normalizePackedContextText,
		unpackPackedContextText,
		upsertResearchExperiment,
		listResearchExperiments,
		listResearchLoopSummaries,
		upsertResearchLoopSummary,
		upsertResearchLoopCheckpoint,
		getResearchLoopCheckpoint,
		clearResearchLoopCheckpoint,
		databaseGet,
		createClient,
		daemonCall,
		defaultDaemonCallImplementation,
		disconnect,
	} = vi.hoisted(() => {
		const appendMemory = vi.fn(async () => undefined);
		const packLiveContextText = vi.fn(async (text: string) => ({
			runtime: "pakt-core",
			savings: 42,
			packedText: `packed:${text.slice(0, 24)}`,
		}));
				const unpackPackedContextText = vi.fn((text: string) => text.replace(/^packed:/, "unpacked:"));
				const normalizePackedContextText = vi.fn((text: string) => text.replace(/\s+/g, " ").trim());
				const upsertResearchExperiment = vi.fn(() => ({ id: "exp-fallback-1" }));
				const listResearchExperiments = vi.fn(() => []);
				const listResearchLoopSummaries = vi.fn(() => []);
				const upsertResearchLoopSummary = vi.fn(() => ({ id: "loop-summary-fallback-1" }));
				let storedCheckpoint: Record<string, unknown> | null = null;
				const upsertResearchLoopCheckpoint = vi.fn((input: Record<string, unknown>) => {
					storedCheckpoint = {
						id: "checkpoint-fallback-1",
						projectPath: String(input.projectPath ?? ""),
						loopKey: String(input.loopKey ?? ""),
						phase: String(input.phase ?? ""),
						status: String(input.status ?? "active"),
						currentRound: input.currentRound ?? null,
						nextRoundNumber: input.nextRoundNumber ?? null,
						totalRounds: input.totalRounds ?? null,
						checkpoint: input.checkpoint ?? null,
					};
					return storedCheckpoint;
				});
				const getResearchLoopCheckpoint = vi.fn(() => storedCheckpoint);
				const clearResearchLoopCheckpoint = vi.fn(() => {
					storedCheckpoint = null;
					return true;
				});
				const databaseGet = vi.fn(() => ({}));
		const defaultDaemonCallImplementation = async (method: string, params?: Record<string, unknown>) => {
			switch (method) {
				case "lucy.live_context":
					return { hit: null, predictions: [], liveSignals: [] };
				case "session.open":
					return { session: { meta: { id: "sess-autoresearch" } }, created: true };
				case "route.resolveBatch":
						return {
							contractVersion: 1,
							resolutions: [
								{
									key: "research",
									request: { capability: "research.autoresearch" },
									routeClass: { id: "research.bounded", capability: "research.autoresearch" },
									selected: { id: "engine.research.autoresearch" },
									discoverableOnly: false,
									degraded: false,
									reason: "Selected engine.research.autoresearch for research.autoresearch",
									policyTrace: ["consumer:prana:autoresearch", "route-class:research.bounded", "selected:engine.research.autoresearch"],
								},
								{
									key: "planner",
									request: { capability: "coding.review" },
									routeClass: { id: "coding.deep-reasoning", capability: "coding.review" },
									selected: { id: "adapter.takumi.executor" },
									executionBinding: {
										source: "kosha-discovery",
										kind: "planner",
										query: { capability: "chat", mode: "chat", role: "planner" },
										selectedModelId: "qwen-coder",
										selectedProviderId: "ollama",
										preferredModelIds: ["qwen-coder"],
										preferredProviderIds: ["ollama"],
										allowCrossProvider: true,
									},
									discoverableOnly: false,
									degraded: false,
									reason: "Selected adapter.takumi.executor for coding.review",
									policyTrace: ["consumer:prana:autoresearch:planner", "route-class:coding.deep-reasoning", "selected:adapter.takumi.executor"],
								},
								{
									key: "execution",
									request: { capability: "model.tool-use" },
									routeClass: { id: "tool.use.flex", capability: "model.tool-use" },
									selected: { id: "discovery.model.ollama.qwen-coder" },
									executionBinding: {
										source: "kosha-discovery",
										kind: "executor",
										query: { capability: "function_calling", mode: "chat" },
										selectedModelId: "qwen-coder",
										selectedProviderId: "ollama",
										preferredModelIds: ["qwen-coder"],
										preferredProviderIds: ["ollama"],
										allowCrossProvider: false,
									},
									discoverableOnly: false,
									degraded: false,
									reason: "Selected discovery.model.ollama.qwen-coder for model.tool-use",
									policyTrace: ["consumer:prana:autoresearch:execution", "route-class:tool.use.flex", "selected:discovery.model.ollama.qwen-coder"],
								},
							],
						};
			case "sabha.ask":
				return { sabha: { id: "sabha-daemon", topic: String(params?.question ?? "") } };
			case "sabha.deliberate":
				return { sabha: { id: String(params?.id ?? "sabha-daemon"), topic: "", rounds: [{ roundNumber: 1, verdict: "deliberating" }], currentRound: { allChallenges: [], voteSummary: { count: 0 } } } };
			case "sabha.submit_perspective":
				return { perspective: { participantId: String(params?.participantId ?? "skeptic") } };
			case "sabha.vote":
				if (params?.conclude === true) {
					return {
						sabha: {
							id: String(params.id ?? "sabha-daemon"),
							topic: "Test bounded loop",
							finalVerdict: "accepted",
							rounds: [{ roundNumber: 1, verdict: "accepted" }],
							currentRound: { allChallenges: [], voteSummary: { count: 5 } },
						},
					};
				}
				return { sabha: { id: String(params?.id ?? "sabha-daemon") } };
			case "compression.pack_context":
				return {
					packed: true,
					runtime: "pakt-core",
					savings: 42,
					packedText: "packed:daemon",
				};
			case "compression.unpack_context":
				return {
					result: String(params?.text ?? "").replace(/^packed:/, "unpacked:"),
				};
			case "compression.normalize_context":
				return {
					result: String(params?.text ?? "").replace(/\s+/g, " ").trim(),
				};
				case "research.outcome.record":
					return {
						recorded: true,
						memoryScope: "project",
						traceId: "trace-1",
						experimentId: "exp-daemon-1",
					};
				case "research.loops.record":
					return {
						summary: { id: "loop-summary-daemon-1" },
					};
					case "research.loops.start":
					case "research.loops.resume":
						return {
							state: {
								loopKey: params?.loopKey,
							status: "running",
							cancelRequestedAt: null,
						},
					};
				case "research.loops.heartbeat":
					return {
						state: {
							loopKey: params?.loopKey,
							status: "running",
							cancelRequestedAt: null,
						},
					};
				case "research.loops.get":
					return {
						state: null,
					};
				case "research.loops.complete":
						return {
							state: {
								loopKey: params?.loopKey,
								status: params?.stopReason === "cancelled" ? "cancelled" : "completed",
								stopReason: params?.stopReason,
							},
						};
					case "research.loops.checkpoint.save":
						return {
							checkpoint: upsertResearchLoopCheckpoint({
								projectPath: params?.projectPath,
								loopKey: params?.loopKey,
								phase: params?.phase,
								status: typeof params?.status === "string" ? params.status : "active",
								currentRound: params?.currentRound,
								nextRoundNumber: params?.nextRoundNumber,
								totalRounds: params?.totalRounds,
								checkpoint: params?.checkpoint,
							}),
						};
					case "research.loops.checkpoint.get":
						return { checkpoint: getResearchLoopCheckpoint() };
					case "research.loops.checkpoint.clear":
						return { cleared: clearResearchLoopCheckpoint() };
						default:
							throw new Error(`Unexpected daemon method: ${method}`);
					}
		};
	const daemonCall = vi.fn(defaultDaemonCallImplementation);
	const disconnect = vi.fn();
	const createClient = vi.fn(async () => ({
		call: daemonCall,
		disconnect,
	}));
		return {
				appendMemory,
				packLiveContextText,
				normalizePackedContextText,
				unpackPackedContextText,
				upsertResearchExperiment,
						listResearchExperiments,
						listResearchLoopSummaries,
						upsertResearchLoopSummary,
						upsertResearchLoopCheckpoint,
						getResearchLoopCheckpoint,
						clearResearchLoopCheckpoint,
						databaseGet,
						createClient,
						daemonCall,
				defaultDaemonCallImplementation,
				disconnect,
	};
});

class MockAkashaField {
	restore = vi.fn();
	persist = vi.fn();
	leave = vi.fn(() => ({ id: "trace-fallback" }));
}

class MockSabhaEngine {
	private readonly sabhas = new Map<
		string,
		{
			id: string;
			topic: string;
			participants: Array<{
				id: string;
				role: string;
				expertise: number;
				credibility: number;
			}>;
			rounds: Array<{
				roundNumber: number;
				verdict: string;
				votes: Array<{ participantId: string; stance: string; rationale: string }>;
				challenges: Array<{ participantId: string; target: string; question: string; response?: string }>;
			}>;
			finalVerdict: string;
		}
	>();

	constructor(_options?: unknown) {}

	convene(
		topic: string,
		_convener: string,
		participants: Array<{
			id: string;
			role: string;
			expertise: number;
			credibility: number;
		}>,
	) {
		const sabha = {
			id: "sabha-local",
			topic,
			participants,
			rounds: [{ roundNumber: 1, verdict: "support", votes: [], challenges: [] }],
			finalVerdict: "support",
		};
		this.sabhas.set(sabha.id, sabha);
		return sabha;
	}

	propose(_sabhaId: string, _participantId: string, _syllogism: unknown): void {}

	challenge(sabhaId: string, participantId: string, target: string, question: string): void {
		const sabha = this.sabhas.get(sabhaId);
		sabha?.rounds[0]?.challenges.push({ participantId, target, question });
	}

	respond(sabhaId: string, challengeIndex: number, response: string): void {
		const sabha = this.sabhas.get(sabhaId);
		const challenge = sabha?.rounds[0]?.challenges[challengeIndex];
		if (challenge) challenge.response = response;
	}

	vote(sabhaId: string, participantId: string, stance: string, rationale: string): void {
		const sabha = this.sabhas.get(sabhaId);
		sabha?.rounds[0]?.votes.push({ participantId, stance, rationale });
	}

	conclude(sabhaId: string) {
		const sabha = this.sabhas.get(sabhaId);
		if (!sabha) throw new Error("sabha missing");
		return sabha;
	}
}

let researchDir = "";

vi.mock("@chitragupta/smriti", () => ({
	appendMemory,
	packLiveContextText,
	normalizePackedContextText,
	unpackPackedContextText,
	upsertResearchExperiment,
	listResearchExperiments,
	listResearchLoopSummaries,
	upsertResearchLoopSummary,
	upsertResearchLoopCheckpoint,
	getResearchLoopCheckpoint,
	clearResearchLoopCheckpoint,
	AkashaField: MockAkashaField,
	DatabaseManager: {
		instance: () => ({ get: databaseGet }),
	},
}));

vi.mock("@chitragupta/sutra", () => ({
	SabhaEngine: MockSabhaEngine,
}));

vi.mock("@chitragupta/daemon", () => ({
	createClient,
}));

function makeContext(overrides?: Partial<NodeContext>): NodeContext {
	return {
		projectPath: researchDir,
		stepOutputs: {},
		extra: {},
		...overrides,
	};
}

function hashText(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

describe("chitragupta research nodes", () => {
	beforeEach(async () => {
		researchDir = await fs.mkdtemp(path.join(os.tmpdir(), "chitragupta-research-"));
		await fs.writeFile(path.join(researchDir, "train.py"), "print('train')\n", "utf8");
		await fs.writeFile(path.join(researchDir, "prepare.py"), "print('prepare')\n", "utf8");
		execFileSync("git", ["init"], { cwd: researchDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: researchDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "Test Runner"], { cwd: researchDir, stdio: "ignore" });
		execFileSync("git", ["add", "train.py", "prepare.py"], { cwd: researchDir, stdio: "ignore" });
		execFileSync("git", ["commit", "-m", "init"], { cwd: researchDir, stdio: "ignore" });
		appendMemory.mockClear();
		packLiveContextText.mockClear();
		normalizePackedContextText.mockClear();
			unpackPackedContextText.mockClear();
			upsertResearchExperiment.mockClear();
			listResearchExperiments.mockReset();
			listResearchExperiments.mockReturnValue([]);
			listResearchLoopSummaries.mockReset();
			listResearchLoopSummaries.mockReturnValue([]);
				upsertResearchLoopSummary.mockClear();
				upsertResearchLoopCheckpoint.mockClear();
				getResearchLoopCheckpoint.mockClear();
				clearResearchLoopCheckpoint.mockClear();
				clearResearchLoopCheckpoint();
				databaseGet.mockClear();
		createClient.mockClear();
		daemonCall.mockReset();
		daemonCall.mockImplementation(defaultDaemonCallImplementation);
		disconnect.mockClear();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (researchDir) {
			await fs.rm(researchDir, { recursive: true, force: true });
			researchDir = "";
		}
	});

	it("prepares a bounded research scope", async () => {
		const { autoresearchScope } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchScope(makeContext({
			extra: {
				researchBudgetMs: 999_999,
				researchTargetFiles: ["train.py"],
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(
			expect.objectContaining({
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				objective: "minimize",
				budgetMs: 300_000,
			}),
		);
	});

	it("runs a daemon-backed ACP research council with Lucy guidance", async () => {
		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Test bounded loop",
			},
		}));

		expect(result.ok).toBe(true);
			expect(result.data).toEqual(
				expect.objectContaining({
					sabhaId: "sabha-daemon",
				topic: "Test bounded loop",
				participantCount: 5,
				finalVerdict: "accepted",
				rounds: 1,
				sessionId: "sess-autoresearch",
				source: "daemon",
					lucy: expect.objectContaining({ recommendation: "support" }),
						route: expect.objectContaining({
							routeClass: "research.bounded",
							capability: "research.autoresearch",
							selectedCapabilityId: "engine.research.autoresearch",
							discoverableOnly: false,
						}),
						executionRoute: expect.objectContaining({
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
							executionBinding: expect.objectContaining({
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
								preferredModelIds: ["qwen-coder"],
								preferredProviderIds: ["ollama"],
							}),
							discoverableOnly: false,
						}),
						plannerRoute: expect.objectContaining({
							routeClass: "coding.deep-reasoning",
							capability: "coding.review",
							selectedCapabilityId: "adapter.takumi.executor",
							executionBinding: expect.objectContaining({
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
							}),
							discoverableOnly: false,
						}),
					}),
				);
		expect(daemonCall).toHaveBeenCalledWith("lucy.live_context", expect.objectContaining({
			query: "Test bounded loop",
			project: researchDir,
		}));
		expect(daemonCall).toHaveBeenCalledWith("session.open", expect.objectContaining({
			project: researchDir,
			agent: "prana:autoresearch",
		}));
		expect(daemonCall).toHaveBeenCalledWith("route.resolveBatch", expect.objectContaining({
			consumer: "prana:autoresearch",
			sessionId: "sess-autoresearch",
			routes: expect.arrayContaining([
				expect.objectContaining({
					key: "research",
					routeClass: "research.bounded",
				}),
				expect.objectContaining({
					key: "execution",
					routeClass: "tool.use.flex",
				}),
				expect.objectContaining({
					key: "planner",
					routeClass: "coding.deep-reasoning",
				}),
			]),
		}));
	});

	it("supports a two-agent planner/executor council when requested", async () => {
		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Two-agent overnight council",
				researchAgentCount: 2,
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(expect.objectContaining({
			participantCount: 2,
			participants: [
				expect.objectContaining({ id: "planner", role: "planner" }),
				expect.objectContaining({ id: "executor", role: "executor" }),
			],
		}));
	});

	it("uses the executor as the daemon challenge participant when a two-agent council has live warnings", async () => {
		const defaultImplementation = daemonCall.getMockImplementation();
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "lucy.live_context") {
				return {
					hit: {
						entity: "sqlite",
						content: "WAL checkpoint stalled",
						source: "daemon",
					},
					predictions: [],
					liveSignals: [{ description: "semantic lag" }],
				};
			}
			return defaultImplementation
				? defaultImplementation(method, params)
				: undefined;
		});
		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Two-agent warning council",
				researchAgentCount: 2,
			},
		}));

		expect(result.ok).toBe(true);
		expect(daemonCall).toHaveBeenCalledWith("sabha.deliberate", expect.objectContaining({
			challenges: [
				expect.objectContaining({
					challengerId: "executor",
				}),
			],
		}));
	});

	it("propagates canonical project path and explicit lineage into the daemon session", async () => {
		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Lineage-aware council",
				researchCwd: "subdir",
				researchParentSessionId: "sess-parent",
				researchSessionLineageKey: "lineage-research",
			},
		}));

		expect(result.ok).toBe(true);
		expect(daemonCall).toHaveBeenCalledWith("session.open", expect.objectContaining({
			project: researchDir,
			parentSessionId: "sess-parent",
			sessionLineageKey: "lineage-research",
			consumer: "prana",
			surface: "research",
			channel: "workflow",
		}));
		expect(daemonCall).toHaveBeenCalledWith("route.resolveBatch", expect.objectContaining({
			routes: expect.arrayContaining([
				expect.objectContaining({
					key: "research",
					context: expect.objectContaining({
						projectPath: researchDir,
						cwd: path.join(researchDir, "subdir"),
					}),
				}),
			]),
		}));
	});

	it("rejects research cwd values that escape the canonical project path", async () => {
		const { autoresearchScope } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchScope(makeContext({
			extra: {
				researchCwd: path.resolve(researchDir, ".."),
			},
		}));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain("canonical project path");
	});

	it("runs a bounded experiment only after council approval and extracts the metric", async () => {
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
					"acp-research-council": { data: { finalVerdict: "accepted" } },
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "console.log('val_bpb: 0.991000')"],
				researchCwd: researchDir,
			},
		}));

		expect(result.ok).toBe(true);
			expect(result.data).toEqual(
				expect.objectContaining({
					metricName: "val_bpb",
					metric: 0.991,
					timedOut: false,
					gitBranch: expect.any(String),
					gitHeadCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
					gitDirtyBefore: false,
					gitDirtyAfter: false,
				}),
			);
	});

	it("refuses overnight-style research execution on a dirty workspace by default", async () => {
		await fs.writeFile(path.join(researchDir, "train.py"), "print('dirty')\n", "utf8");
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": { data: { finalVerdict: "accepted" } },
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "console.log('val_bpb: 0.991000')"],
				researchCwd: researchDir,
			},
		}));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain("clean workspace");
	});

	it("allows research execution on a dirty workspace only when explicitly enabled", async () => {
		await fs.writeFile(path.join(researchDir, "train.py"), "print('dirty')\n", "utf8");
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": { data: { finalVerdict: "accepted" } },
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "console.log('val_bpb: 0.991000')"],
				researchCwd: researchDir,
				researchAllowDirtyWorkspace: true,
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(expect.objectContaining({
			metric: 0.991,
			gitDirtyBefore: true,
		}));
	});

		it("passes engine-selected execution lane details into bounded research runs", async () => {
			const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
			const result = await autoresearchRun(makeContext({
				stepOutputs: {
					"acp-research-council": {
						data: {
							finalVerdict: "accepted",
							executionRoute: {
								routeClass: "tool.use.flex",
								capability: "model.tool-use",
								selectedCapabilityId: "discovery.model.ollama.qwen-coder",
								discoverableOnly: false,
								reason: "Selected discovery.model.ollama.qwen-coder for model.tool-use",
								executionBinding: {
									source: "kosha-discovery",
									kind: "executor",
									selectedModelId: "qwen-coder",
									selectedProviderId: "ollama",
									preferredModelIds: ["qwen-coder"],
									preferredProviderIds: ["ollama"],
									allowCrossProvider: false,
								},
							},
						},
					},
				},
				extra: {
					researchCommand: process.execPath,
					researchArgs: [
						"-e",
						[
							"console.log(process.env.CHITRAGUPTA_SELECTED_MODEL_ID);",
							"console.log(process.env.CHITRAGUPTA_SELECTED_PROVIDER_ID);",
							"console.log(process.env.CHITRAGUPTA_SELECTED_CAPABILITY_ID);",
							"console.log(process.env.CHITRAGUPTA_PREFERRED_PROVIDER_IDS);",
							"console.log(process.env.CHITRAGUPTA_EXECUTION_ROUTE_CLASS);",
							"console.log('val_bpb: 0.991000');",
						].join(""),
					],
					researchCwd: researchDir,
				},
			}));

			expect(result.ok).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({
				executionRouteClass: "tool.use.flex",
				selectedCapabilityId: "discovery.model.ollama.qwen-coder",
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
				metric: 0.991,
			}));
			expect((result.data as { stdout: string }).stdout).toContain("qwen-coder");
			expect((result.data as { stdout: string }).stdout).toContain("ollama");
			expect((result.data as { stdout: string }).stdout).toContain("discovery.model.ollama.qwen-coder");
			expect((result.data as { stdout: string }).stdout).toContain("ollama");
			expect((result.data as { stdout: string }).stdout).toContain("tool.use.flex");
		});

		it("does not leak the research lane into execution env when executionRoute is absent", async () => {
			const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
			const result = await autoresearchRun(makeContext({
				stepOutputs: {
					"acp-research-council": {
						data: {
							finalVerdict: "accepted",
							route: {
								routeClass: "research.bounded",
								capability: "research.autoresearch",
								selectedCapabilityId: "engine.research.autoresearch",
								discoverableOnly: false,
								reason: "Selected engine.research.autoresearch for research.autoresearch",
							},
						},
					},
				},
				extra: {
					researchCommand: process.execPath,
					researchArgs: [
						"-e",
						[
							"console.log(String(process.env.CHITRAGUPTA_SELECTED_CAPABILITY_ID ?? 'none'));",
							"console.log('val_bpb: 0.991000');",
						].join(""),
					],
					researchCwd: researchDir,
				},
			}));

			expect(result.ok).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({
				selectedCapabilityId: null,
				selectedModelId: null,
				selectedProviderId: null,
			}));
			expect((result.data as { stdout: string }).stdout).toContain("none");
		});

	it("blocks experiment execution when the council does not support it", async () => {
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": { data: { finalVerdict: "escalated" } },
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "console.log('val_bpb: 0.991000')"],
				researchCwd: researchDir,
			},
		}));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain("did not approve execution");
	});

	it("blocks experiment execution when the research route does not authorize an executable lane", async () => {
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": {
						data: {
							finalVerdict: "accepted",
							route: {
								routeClass: "research.bounded",
								discoverableOnly: true,
								selectedCapabilityId: null,
								reason: "No executable engine lane selected",
							},
							executionRoute: {
								routeClass: "tool.use.flex",
								discoverableOnly: true,
								selectedCapabilityId: null,
								reason: "No discovered model lane selected",
							},
						},
					},
				},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "console.log('val_bpb: 0.991000')"],
				researchCwd: researchDir,
			},
		}));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain("did not authorize execution");
	});

	it("fails closed when a bounded run mutates git refs", async () => {
		const { autoresearchRun } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						finalVerdict: "accepted",
						executionRoute: {
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
						},
					},
				},
			},
			extra: {
				researchCommand: "git",
				researchArgs: ["commit", "--allow-empty", "-m", "mutate refs"],
				researchCwd: researchDir,
			},
		}));

		expect(result.ok).toBe(false);
		expect(String(result.summary)).toContain("Git refs changed during experiment execution");
		expect(result.data).toEqual(expect.objectContaining({
			scopeGuard: "git",
			gitBranch: expect.any(String),
			gitHeadCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
		}));
	});

	it("requires a real measured improvement before keeping a result", async () => {
		const { autoresearchEvaluate } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchEvaluate(makeContext({
			stepOutputs: {
				"autoresearch-baseline": {
					data: { metricName: "val_bpb", objective: "minimize", baselineMetric: null },
				},
				"autoresearch-run": {
					data: { metricName: "val_bpb", objective: "minimize", metric: 0.99 },
				},
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(
			expect.objectContaining({
				baselineMetric: null,
				observedMetric: 0.99,
				improved: false,
				decision: "discard",
			}),
		);
	});

	it("packs and records through the daemon-first nervous-system path", async () => {
		const {
			paktPackResearchContext,
			autoresearchRecord,
		} = await import("../src/chitragupta-nodes-research.js");
		const sharedContext = makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						finalVerdict: "accepted",
						lucy: { recommendation: "support" },
					},
				},
				"autoresearch-run": {
					data: {
						stdout: "val_bpb: 0.991000\nstable run",
						stderr: "",
					},
				},
				"autoresearch-evaluate": {
					data: {
						baselineMetric: 1.01,
						observedMetric: 0.991,
						delta: 0.019,
						decision: "keep",
					},
				},
			},
			extra: {
				researchTopic: "Bounded run",
				researchHypothesis: "train.py can improve",
			},
		});

			const packed = await paktPackResearchContext(sharedContext);
			expect(packed.ok).toBe(true);
			expect(daemonCall).toHaveBeenCalledWith(
				"compression.pack_context",
				expect.objectContaining({
					text: expect.stringContaining("topic: Bounded run"),
				}),
				expect.objectContaining({ signal: undefined }),
			);
		expect(packLiveContextText).not.toHaveBeenCalled();
		expect(packed.data).toEqual(
			expect.objectContaining({
				packed: true,
				runtime: "pakt-core",
				source: "daemon",
			}),
		);

			const recorded = await autoresearchRecord({
				...sharedContext,
				stepOutputs: {
				...sharedContext.stepOutputs,
				"pakt-pack-research-context": packed,
			},
		});
			expect(recorded.ok).toBe(true);
			expect(daemonCall).toHaveBeenCalledWith(
				"research.outcome.record",
				expect.objectContaining({
					projectPath: researchDir,
					entry: expect.stringContaining("### Packed Context\npacked:daemon"),
					traceContent: expect.stringContaining("Decision: keep"),
					topic: "Bounded run",
					decision: "keep",
					traceMetadata: expect.objectContaining({
						projectPath: researchDir,
						parentSessionId: null,
						sessionLineageKey: null,
					}),
				}),
				expect.objectContaining({ signal: undefined }),
			);
			expect(appendMemory).not.toHaveBeenCalled();
			expect(recorded.data).toEqual(
				expect.objectContaining({
					recorded: true,
					traceId: "trace-1",
					experimentId: "exp-daemon-1",
					decision: "keep",
					source: "daemon",
				}),
		);
	});

	it("falls back to local Smriti and Sutra when the daemon is unavailable", async () => {
		createClient
			.mockRejectedValueOnce(new Error("daemon unavailable"))
			.mockRejectedValueOnce(new Error("daemon unavailable"));
		const { acpResearchCouncil, paktPackResearchContext, autoresearchRecord } = await import("../src/chitragupta-nodes-research.js");
		const council = await acpResearchCouncil(makeContext({
			extra: { researchTopic: "Fallback council" },
		}));
		expect(council.ok).toBe(true);
		expect(council.data).toEqual(expect.objectContaining({
			source: "local-fallback",
			sessionId: null,
			route: null,
		}));

		createClient.mockRejectedValueOnce(new Error("daemon unavailable"));
		const packed = await paktPackResearchContext(makeContext({
			stepOutputs: {
				"acp-research-council": council,
				"autoresearch-run": { data: { stdout: "val_bpb: 0.991000", stderr: "" } },
			},
			extra: { researchTopic: "Fallback council" },
		}));
		expect(packed.ok).toBe(true);
		expect(packLiveContextText).toHaveBeenCalledOnce();

		createClient.mockRejectedValueOnce(new Error("daemon unavailable"));
		const recorded = await autoresearchRecord(makeContext({
			stepOutputs: {
				"acp-research-council": council,
				"autoresearch-evaluate": { data: { observedMetric: 0.991, decision: "keep" } },
				"pakt-pack-research-context": packed,
			},
			extra: { researchTopic: "Fallback council", researchHypothesis: "fallback" },
		}));
		expect(recorded.ok).toBe(true);
		expect(appendMemory).toHaveBeenCalledOnce();
			expect(databaseGet).toHaveBeenCalledWith("agent");
			expect(upsertResearchExperiment).toHaveBeenCalledWith(expect.objectContaining({
				gitBranch: null,
				gitHeadCommit: null,
				gitDirtyBefore: null,
				gitDirtyAfter: null,
			}));
			expect(recorded.data).toEqual(expect.objectContaining({ source: "fallback", traceId: "trace-fallback" }));
		});

		it("preserves attempt-safe metadata for successful overnight local-fallback records", async () => {
			createClient.mockRejectedValueOnce(new Error("daemon unavailable"));
			const recording = await import("../src/chitragupta-nodes-research-recording.js");
			const shared = await import("../src/chitragupta-nodes-research-shared.js");
			const overnightScope = shared.withResearchRoundScope(
				shared.buildScope(
					makeContext({
						extra: {
							researchTopic: "Fallback overnight",
							researchHypothesis: "attempt-safe",
						},
					}),
				),
				"loop-attempt-safe",
				1,
				3,
				2,
			);
			const recorded = await recording.recordResearchOutcome(
				overnightScope,
				{ finalVerdict: "support", sabhaId: "sabha-local", sessionId: null },
				{ stdout: "val_bpb: 0.991000", stderr: "", metric: 0.991 },
				{ observedMetric: 0.991, decision: "keep" },
				null,
				{ runtime: "pakt-core", source: "fallback", sourceLength: 120, packedText: "packed:overnight" },
			);
			expect(recorded).toEqual(expect.objectContaining({ source: "fallback" }));
			expect(upsertResearchExperiment).toHaveBeenLastCalledWith(expect.objectContaining({
				loopKey: "loop-attempt-safe",
				roundNumber: 1,
				totalRounds: 3,
				attemptNumber: 2,
				attemptKey: expect.stringContaining("#attempt:2"),
			}));
		});

		it("fails closed when the daemon rejects research outcome recording for policy reasons", async () => {
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.outcome.record") {
				throw new Error("policy denied");
			}
			return defaultDaemonCallImplementation(method, params);
		});
		const { autoresearchRecord } = await import("../src/chitragupta-nodes-research.js");
		const recorded = await autoresearchRecord(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						finalVerdict: "accepted",
						lucy: { recommendation: "support" },
					},
				},
				"autoresearch-run": {
					data: {
						stdout: "val_bpb: 0.991000\nstable run",
						stderr: "",
					},
				},
				"autoresearch-evaluate": {
					data: {
						baselineMetric: 1.01,
						observedMetric: 0.991,
						delta: 0.019,
						decision: "keep",
					},
				},
				"pakt-pack-research-context": {
					data: {
						packed: true,
						runtime: "pakt-core",
						source: "daemon",
						packedText: "packed:daemon",
					},
				},
			},
			extra: {
				researchTopic: "Policy denied",
				researchHypothesis: "should fail closed",
			},
		}));

		expect(recorded.ok).toBe(false);
		expect(String(recorded.summary)).toContain("policy denied");
		expect(appendMemory).not.toHaveBeenCalled();
		expect(upsertResearchExperiment).not.toHaveBeenCalled();
	});

	it("reverts target files after a failed discarded run and preserves scope lineage in records", async () => {
		const { autoresearchRun, autoresearchEvaluate, autoresearchFinalize, autoresearchRecord } = await import("../src/chitragupta-nodes-research.js");
		await fs.writeFile(path.join(researchDir, "train.py"), "print('before')\n", "utf8");
		execFileSync("git", ["add", "train.py"], { cwd: researchDir });
		execFileSync("git", ["commit", "-m", "prepare before state"], { cwd: researchDir });

		const run = await autoresearchRun(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						finalVerdict: "accepted",
						executionRoute: {
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
							executionBinding: {
								source: "kosha-discovery",
								kind: "executor",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
							},
						},
					},
				},
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: [
					"-e",
					[
						"require('fs').writeFileSync('train.py', \"print('after')\\n\");",
						"console.error('boom');",
						"process.exit(2);",
					].join(""),
				],
				researchParentSessionId: "sess-parent",
				researchSessionLineageKey: "lineage-alpha",
			},
		}));

			expect(run.ok).toBe(false);
			expect(run.data).toEqual(expect.objectContaining({
				exitCode: 2,
				scopeSnapshot: expect.any(Object),
				selectedCapabilityId: "discovery.model.ollama.qwen-coder",
				gitBranch: expect.any(String),
				gitHeadCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
				gitDirtyBefore: false,
				gitDirtyAfter: true,
			}));
		expect(await fs.readFile(path.join(researchDir, "train.py"), "utf8")).toContain("after");

		const evaluation = await autoresearchEvaluate(makeContext({
			stepOutputs: {
				"autoresearch-baseline": { data: { metricName: "val_bpb", objective: "minimize", baselineMetric: 0.99 } },
				"autoresearch-run": run,
			},
		}));
		expect(evaluation.ok).toBe(true);
		expect(evaluation.data).toEqual(expect.objectContaining({ decision: "discard" }));

		const finalize = await autoresearchFinalize(makeContext({
			stepOutputs: {
				"autoresearch-run": run,
				"autoresearch-evaluate": evaluation,
			},
		}));
		expect(finalize.ok).toBe(true);
		expect(finalize.data).toEqual(expect.objectContaining({
			action: "reverted",
		}));
		expect(await fs.readFile(path.join(researchDir, "train.py"), "utf8")).toContain("before");

		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const currentBranch = execFileSync("git", ["branch", "--show-current"], {
			cwd: researchDir,
			encoding: "utf8",
		}).trim();
		const mismatchScope = {
			hypothesis: "verify bounded discard cleanup",
			topic: "runner cleanup verification",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize" as const,
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			allowDirtyWorkspace: false,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 1,
			agentCount: 2,
			stopAfterNoImprovementRounds: 1,
			loopKey: null,
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		};
		await fs.writeFile(path.join(researchDir, "train.py"), "print('after-again')\n", "utf8");
		const verifiedDiscard = await runner.finalizeResearchResult(
			mismatchScope,
			{
				scopeGuard: "git",
				scopeSnapshot: {
					mode: "git",
					fileContents: {
						"train.py": "print('before')\n",
					},
				},
				gitBranch: currentBranch,
				gitHeadCommit: "0000000000000000000000000000000000000000",
			},
			{ decision: "discard" },
		);
		expect(verifiedDiscard).toEqual(expect.objectContaining({
			action: "skipped",
			reason: expect.stringContaining("Git HEAD changed during cleanup"),
		}));
		expect(await fs.readFile(path.join(researchDir, "train.py"), "utf8")).toBe("print('before')\n");

		await fs.writeFile(path.join(researchDir, "train.py"), "print('after-failure')\n", "utf8");
		const verifiedRecovery = await runner.recoverResearchFailure(mismatchScope, {
			scopeGuard: "git",
			scopeSnapshot: {
				mode: "git",
				fileContents: {
					"train.py": "print('before')\n",
				},
			},
			gitBranch: currentBranch,
			gitHeadCommit: "1111111111111111111111111111111111111111",
		});
		expect(verifiedRecovery).toEqual(expect.objectContaining({
			action: "skipped",
			reason: expect.stringContaining("Git HEAD changed during cleanup"),
		}));
		expect(await fs.readFile(path.join(researchDir, "train.py"), "utf8")).toBe("print('before')\n");

		const strictEvaluation = await runner.evaluateResearchResult(
			{ metricName: "val_bpb", objective: "minimize", baselineMetric: 0.99 },
			{ metricName: "val_bpb", metric: 0.9895, targetFilesChanged: [] },
			{ minimumImprovementDelta: 0.001, requireTargetFileChangesForKeep: true },
		);
		expect(strictEvaluation.improved).toBe(false);
		expect(strictEvaluation.decision).toBe("discard");
		expect(strictEvaluation.delta).toBeCloseTo(0.0005, 8);

			const hashOnlyScope = {
				...mismatchScope,
				requireTargetFileChangesForKeep: true,
				allowHashOnlyKeep: true,
			};
			const downgradedKeep = await runner.finalizeResearchResult(
			hashOnlyScope,
			{
				scopeGuard: "hash-only",
				scopeSnapshot: {
					mode: "hash-only",
					fileContents: {
						"train.py": "print('before')\n",
					},
				},
				targetFilesChanged: [],
			},
			{ decision: "keep" },
		);
				expect(downgradedKeep).toEqual(expect.objectContaining({
					decision: "discard",
					action: "reverted",
					reason: "Discarded because the run produced no target-file changes to keep.",
				}));

			const hashOnlyPolicyScope = {
				...mismatchScope,
				requireTargetFileChangesForKeep: false,
				allowHashOnlyKeep: false,
			};
			const blockedHashOnlyKeep = await runner.finalizeResearchResult(
				hashOnlyPolicyScope,
				{
					scopeGuard: "hash-only",
					scopeSnapshot: {
						mode: "hash-only",
						fileContents: {
							"train.py": "print('before')\n",
						},
					},
					targetFilesChanged: ["train.py"],
				},
				{ decision: "keep" },
			);
			expect(blockedHashOnlyKeep).toEqual(expect.objectContaining({
				decision: "discard",
				action: "reverted",
				reason: "Discarded because hash-only overnight runs require explicit allowHashOnlyKeep to persist changes.",
			}));

			await fs.writeFile(path.join(researchDir, "train.py"), "print('after-keep')\n", "utf8");
			const allowedHashOnlyKeep = await runner.finalizeResearchResult(
				{
					...hashOnlyPolicyScope,
					allowHashOnlyKeep: true,
				},
				{
					scopeGuard: "hash-only",
					scopeSnapshot: {
						mode: "hash-only",
						hashes: {
							"train.py": hashText("print('before')\n"),
							"prepare.py": hashText("print('prepare')\n"),
						},
						fileContents: {
							"train.py": "print('before')\n",
						},
					},
					targetFilesChanged: ["train.py"],
				},
				{ decision: "keep" },
			);
			expect(allowedHashOnlyKeep).toEqual(expect.objectContaining({
				decision: "discard",
				action: "reverted",
				revertedFiles: ["train.py"],
				scopeGuard: "hash-only",
				reason: "Hash-only keep verification requires git-backed workspace tracking for out-of-scope safety.",
			}));

			await fs.writeFile(path.join(researchDir, "prepare.py"), "print('prepare')\n", "utf8");
			await fs.writeFile(path.join(researchDir, "train.py"), "print('after-extra-change')\n", "utf8");
			const mismatchedHashOnlyKeep = await runner.finalizeResearchResult(
				{
					...hashOnlyPolicyScope,
					allowHashOnlyKeep: true,
					targetFiles: ["train.py", "prepare.py"],
					immutableFiles: [],
				},
				{
					scopeGuard: "hash-only",
					scopeSnapshot: {
						mode: "hash-only",
						hashes: {
							"train.py": hashText("print('before')\n"),
							"prepare.py": hashText("print('prepare')\n"),
						},
						fileContents: {
							"train.py": "print('before')\n",
							"prepare.py": "print('prepare')\n",
						},
					},
					targetFilesChanged: ["train.py"],
				},
				{ decision: "keep" },
			);
			expect(mismatchedHashOnlyKeep).toEqual(expect.objectContaining({
				decision: "discard",
				action: "reverted",
				reason: "Hash-only keep verification requires git-backed workspace tracking for out-of-scope safety.",
				revertedFiles: ["train.py", "prepare.py"],
				scopeGuard: "hash-only",
			}));

			await fs.writeFile(path.join(researchDir, "train.py"), "print('after-missing-hash')\n", "utf8");
			const incompleteHashOnlyKeep = await runner.finalizeResearchResult(
				{
					...hashOnlyPolicyScope,
					allowHashOnlyKeep: true,
				},
				{
					scopeGuard: "hash-only",
					scopeSnapshot: {
						mode: "hash-only",
						fileContents: {
							"train.py": "print('before')\n",
						},
					},
					targetFilesChanged: ["train.py"],
				},
				{ decision: "keep" },
			);
			expect(incompleteHashOnlyKeep).toEqual(expect.objectContaining({
				decision: "discard",
				action: "reverted",
				reason: "Hash-only keep verification requires git-backed workspace tracking for out-of-scope safety.",
				revertedFiles: ["train.py"],
				scopeGuard: "hash-only",
			}));

		const packed = { data: { packed: false, runtime: null, source: "none", savings: 0 } };
		const recorded = await autoresearchRecord(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						finalVerdict: "accepted",
						sessionId: "sess-autoresearch",
						executionRoute: {
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
							executionBinding: {
								source: "kosha-discovery",
								kind: "executor",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
							},
						},
					},
				},
				"autoresearch-run": run,
				"autoresearch-evaluate": evaluation,
				"autoresearch-finalize": finalize,
				"pakt-pack-research-context": packed,
			},
			extra: {
				researchParentSessionId: "sess-parent",
				researchSessionLineageKey: "lineage-alpha",
			},
		}));
		expect(recorded.ok).toBe(true);
			expect(recorded.data).toEqual(expect.objectContaining({
					experimentRecord: expect.objectContaining({
						parentSessionId: "sess-parent",
						sessionLineageKey: "lineage-alpha",
						finalize: expect.objectContaining({ action: "reverted" }),
						run: expect.objectContaining({
							gitBranch: expect.any(String),
							gitHeadCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
							gitDirtyBefore: false,
							gitDirtyAfter: true,
							roundWallClockDurationMs: expect.any(Number),
						}),
					}),
					experimentId: "exp-daemon-1",
				}));
			expect(daemonCall).toHaveBeenCalledWith(
				"research.outcome.record",
				expect.objectContaining({
					parentSessionId: "sess-parent",
					sessionLineageKey: "lineage-alpha",
					traceMetadata: expect.objectContaining({
						parentSessionId: "sess-parent",
						sessionLineageKey: "lineage-alpha",
						finalizeAction: "reverted",
						workflow: "autoresearch",
					}),
				}),
				expect.objectContaining({ signal: undefined }),
			);
		});

	it("does not bypass daemon packing policy when the daemon declines to pack", async () => {
		const defaultImplementation = daemonCall.getMockImplementation();
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "compression.pack_context") {
				return {
					packed: false,
					runtime: null,
					savings: 0,
					reason: "policy-declined",
				};
			}
			return defaultImplementation
				? defaultImplementation(method, params)
				: undefined;
		});

		const { paktPackResearchContext } = await import("../src/chitragupta-nodes-research.js");
		const packed = await paktPackResearchContext(makeContext({
			stepOutputs: {
				"acp-research-council": { data: { finalVerdict: "accepted", lucy: { recommendation: "support" } } },
				"autoresearch-run": { data: { stdout: "val_bpb: 0.991000", stderr: "" } },
			},
			extra: { researchTopic: "Daemon policy" },
		}));

		expect(packed.ok).toBe(true);
		expect(packLiveContextText).not.toHaveBeenCalled();
		expect(packed.data).toEqual(expect.objectContaining({
			packed: false,
			source: "daemon",
			reason: "policy-declined",
		}));
	});

	it("runs a bounded two-agent overnight loop with packed context reuse and early stop", async () => {
		const { autoresearchOvernight } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchOvernight(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						sabhaId: "sabha-daemon",
						sessionId: "sess-autoresearch",
						topic: "Overnight bounded loop",
						participantCount: 2,
						participants: [
							{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
							{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
						],
						finalVerdict: "accepted",
						rounds: 1,
						councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
						lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
						route: {
							routeClass: "research.bounded",
							capability: "research.autoresearch",
							selectedCapabilityId: "engine.research.autoresearch",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected engine.research.autoresearch for research.autoresearch",
							policyTrace: [],
						},
						plannerRoute: {
							routeClass: "coding.deep-reasoning",
							capability: "coding.review",
							selectedCapabilityId: "adapter.takumi.executor",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected adapter.takumi.executor for coding.review",
							policyTrace: [],
							executionBinding: {
								source: "kosha-discovery",
								kind: "planner",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
								preferredModelIds: ["qwen-coder"],
								preferredProviderIds: ["ollama"],
								allowCrossProvider: true,
							},
						},
						executionRoute: {
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected discovery.model.ollama.qwen-coder for model.tool-use",
							policyTrace: [],
							executionBinding: {
								source: "kosha-discovery",
								kind: "executor",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
								preferredModelIds: ["qwen-coder"],
								preferredProviderIds: ["ollama"],
								allowCrossProvider: false,
							},
						},
						source: "daemon",
					},
				},
				"autoresearch-baseline": {
					data: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 1,
						hypothesis: "overnight bounded loop",
					},
				},
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: ["-e", "const r=Number(process.env.CHITRAGUPTA_RESEARCH_ROUND_NUMBER||'1'); console.log(`val_bpb: ${r===1?'0.990000':'0.990000'}`);"],
				researchRounds: 4,
				researchAgentCount: 2,
				researchStopAfterNoImprovementRounds: 2,
				researchTopic: "Overnight bounded loop",
				researchHypothesis: "round-based optimization",
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(expect.objectContaining({
			loopKey: expect.any(String),
			roundsRequested: 4,
			roundsCompleted: 2,
			stopReason: "no-improvement",
			bestMetric: 1,
			bestRoundNumber: null,
			noImprovementStreak: 2,
			keptRounds: 0,
			revertedRounds: 2,
			sessionId: "sess-autoresearch",
			sabhaId: "sabha-daemon",
			councilVerdict: "accepted",
			plannerRoute: expect.objectContaining({ routeClass: "coding.deep-reasoning" }),
			executionRoute: expect.objectContaining({ routeClass: "tool.use.flex" }),
		}));
		expect(result.data.rounds).toHaveLength(2);
			expect(daemonCall).toHaveBeenCalledWith(
				"compression.unpack_context",
				expect.any(Object),
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
			expect(daemonCall).toHaveBeenCalledWith(
				"compression.normalize_context",
				expect.any(Object),
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
		expect(daemonCall.mock.calls.filter(([method]) => method === "research.outcome.record")).toHaveLength(2);
	});

	it("stops the overnight loop when the total budget is exhausted", async () => {
		const { autoresearchOvernight } = await import("../src/chitragupta-nodes-research.js");
		const result = await autoresearchOvernight(makeContext({
			stepOutputs: {
				"acp-research-council": {
					data: {
						sabhaId: "sabha-daemon",
						sessionId: "sess-autoresearch",
						topic: "Budgeted overnight loop",
						participantCount: 2,
						participants: [
							{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
							{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
						],
						finalVerdict: "accepted",
						rounds: 1,
						councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
						lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
						route: {
							routeClass: "research.bounded",
							capability: "research.autoresearch",
							selectedCapabilityId: "engine.research.autoresearch",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected engine.research.autoresearch for research.autoresearch",
							policyTrace: [],
						},
						plannerRoute: {
							routeClass: "coding.deep-reasoning",
							capability: "coding.review",
							selectedCapabilityId: "adapter.takumi.executor",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected adapter.takumi.executor for coding.review",
							policyTrace: [],
							executionBinding: {
								source: "kosha-discovery",
								kind: "planner",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
								preferredModelIds: ["qwen-coder"],
								preferredProviderIds: ["ollama"],
								allowCrossProvider: true,
							},
						},
						executionRoute: {
							routeClass: "tool.use.flex",
							capability: "model.tool-use",
							selectedCapabilityId: "discovery.model.ollama.qwen-coder",
							discoverableOnly: false,
							degraded: false,
							reason: "Selected discovery.model.ollama.qwen-coder for model.tool-use",
							policyTrace: [],
							executionBinding: {
								source: "kosha-discovery",
								kind: "executor",
								selectedModelId: "qwen-coder",
								selectedProviderId: "ollama",
								preferredModelIds: ["qwen-coder"],
								preferredProviderIds: ["ollama"],
								allowCrossProvider: false,
							},
						},
						source: "daemon",
					},
				},
				"autoresearch-baseline": {
					data: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 1,
						hypothesis: "budgeted bounded loop",
					},
				},
			},
			extra: {
				researchCommand: process.execPath,
				researchArgs: [
					"-e",
					"setTimeout(() => console.log('val_bpb: 0.990000'), 550);",
				],
				researchRounds: 6,
				researchAgentCount: 2,
				researchBudgetMs: 1_000,
				researchTotalBudgetMs: 1_000,
				researchStopAfterNoImprovementRounds: 6,
				researchTopic: "Budgeted overnight loop",
				researchHypothesis: "budget should stop the loop",
			},
		}));

		expect(result.ok).toBe(true);
		expect(result.summary).toContain("total budget was exhausted");
		expect(result.data).toEqual(expect.objectContaining({
			roundsCompleted: 0,
			stopReason: "budget-exhausted",
			totalBudgetMs: 1_000,
		}));
	});

	it("cancels a running overnight round when daemon loop control requests interrupt", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");

		vi.spyOn(runner, "executeResearchRun").mockImplementation(async (scope) => {
			const cancellationError = Object.assign(new Error("operator-stop"), {
				cancelled: true,
				durationMs: 550,
				scopeGuard: "git",
				targetFilesChanged: ["train.py"],
				scopeSnapshot: {
					mode: "git",
					fileContents: {
						"train.py": "print('train')\n",
					},
				},
				executionRouteClass: scope.executionRouteClass,
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			});

			await new Promise<never>((_, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("interrupt was never requested"));
				}, 2_000);
				scope.interruptSignal?.addEventListener("abort", () => {
					clearTimeout(timeout);
					reject(cancellationError);
				}, { once: true });
			});
		});
		vi.spyOn(runner, "recoverResearchFailure").mockResolvedValue({
			decision: "discard",
			action: "reverted",
			revertedFiles: ["train.py"],
			reason: "operator cancel cleanup",
			scopeGuard: "git",
		});
		vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-cancelled",
			experimentId: "exp-cancelled",
		});

		let heartbeatCount = 0;
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.heartbeat") {
				heartbeatCount += 1;
				if (params?.phase === "run" && heartbeatCount >= 2) {
					return {
						state: {
							loopKey: params?.loopKey,
							status: "cancelling",
							cancelRequestedAt: Date.now(),
							cancelReason: "operator-stop",
						},
					};
				}
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "cancelled",
						stopReason: params?.stopReason,
					},
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "operator cancel should stop the active round",
			topic: "Cancelled overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 3,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-cancelled",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Cancelled overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "operator cancel should stop the active round",
		});

		expect(summary).toEqual(expect.objectContaining({
			roundsCompleted: 1,
			stopReason: "cancelled",
			revertedRounds: 1,
			summaryId: "loop-summary-daemon-1",
			summarySource: "daemon",
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "cancelled",
				finalizeAction: "reverted",
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			}),
		]);
		expect(daemonCall).toHaveBeenCalledWith("research.loops.complete", expect.objectContaining({
			loopKey: "loop-cancelled",
			stopReason: "cancelled",
		}));
	});

	it("fails closed when cancel cleanup cannot safely revert the active round", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");

		vi.spyOn(runner, "executeResearchRun").mockImplementation(async (scope) => {
			const cancellationError = Object.assign(new Error("operator-stop"), {
				cancelled: true,
				durationMs: 550,
				scopeGuard: "git",
				targetFilesChanged: ["train.py"],
				scopeSnapshot: {
					mode: "git",
					fileContents: {
						"train.py": "print('train')\n",
					},
				},
				executionRouteClass: scope.executionRouteClass,
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			});

			await new Promise<never>((_, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("interrupt was never requested"));
				}, 2_000);
				scope.interruptSignal?.addEventListener("abort", () => {
					clearTimeout(timeout);
					reject(cancellationError);
				}, { once: true });
			});
		});
		vi.spyOn(runner, "recoverResearchFailure").mockResolvedValue({
			decision: "discard",
			action: "skipped",
			revertedFiles: ["train.py"],
			reason: "Git HEAD changed during cleanup: expected abc, found def.",
			scopeGuard: "git",
		});

		let heartbeatCount = 0;
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.heartbeat") {
				heartbeatCount += 1;
				if (params?.phase === "run" && heartbeatCount >= 2) {
					return {
						state: {
							loopKey: params?.loopKey,
							status: "cancelling",
							cancelRequestedAt: Date.now(),
							cancelReason: "operator-stop",
						},
					};
				}
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: params?.stopReason === "closure-failed" ? "failed" : "cancelled",
						stopReason: params?.stopReason,
					},
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "cancel cleanup failure should fail closed",
			topic: "Cancelled cleanup failure overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 3,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-cancel-cleanup-failed",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Cancelled cleanup failure overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "cancel cleanup failure should fail closed",
		});

		expect(summary).toEqual(expect.objectContaining({
			roundsCompleted: 1,
			stopReason: "cancelled",
			closureStatus: "degraded",
			closureError: "Git HEAD changed during cleanup: expected abc, found def.",
			keptRounds: 0,
			revertedRounds: 0,
			summaryId: "loop-summary-daemon-1",
			summarySource: "daemon",
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "cancelled",
				finalizeAction: "skipped",
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			}),
		]);
		expect(daemonCall).toHaveBeenCalledWith("research.loops.complete", expect.objectContaining({
			loopKey: "loop-cancel-cleanup-failed",
			stopReason: "cancelled",
		}));
	});

	it("classifies closure-phase cancellation as cancelled and keeps summary/control state aligned", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");

		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.989,
			stdout: "val_bpb: 0.989000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: {
					"train.py": "print('train')\n",
				},
			},
			selectedModelId: "qwen-coder",
			selectedProviderId: "ollama",
			executionRouteClass: "tool.use.flex",
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.989,
			delta: 0.001,
			improved: true,
			decision: "keep",
			status: "completed",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: "better metric",
			scopeGuard: "git",
		});
		vi.spyOn(runner, "recoverResearchFailure").mockResolvedValue({
			decision: "discard",
			action: "reverted",
			revertedFiles: ["train.py"],
			reason: "operator cancel cleanup",
			scopeGuard: "git",
		});
		vi.spyOn(recording, "packResearchContext").mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			throw new Error("socket closed during pack");
		});

		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.heartbeat") {
				if (params?.phase === "closure-error" || params?.phase === "before-complete") {
					return {
						state: {
							loopKey: params?.loopKey,
							status: "cancelling",
							cancelRequestedAt: Date.now(),
							cancelReason: "operator-stop",
						},
					};
				}
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "cancelled",
						stopReason: params?.stopReason,
					},
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "closure cancellation should stay cancelled",
			topic: "Closure-cancelled overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 2,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-closure-cancelled",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Closure-cancelled overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "closure cancellation should stay cancelled",
		});

		expect(summary).toEqual(expect.objectContaining({
			stopReason: "cancelled",
			closureStatus: "complete",
			bestMetric: 0.99,
			bestRoundNumber: null,
			keptRounds: 0,
			revertedRounds: 1,
			roundsCompleted: 1,
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "cancelled",
				finalizeAction: "reverted",
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			}),
		]);
			expect(daemonCall).toHaveBeenCalledWith("research.loops.complete", expect.objectContaining({
				loopKey: "loop-closure-cancelled",
				stopReason: "cancelled",
			}));
		expect(daemonCall).toHaveBeenCalledWith("research.loops.record", expect.objectContaining({
			loopKey: "loop-closure-cancelled",
			stopReason: "cancelled",
		}));
		expect(daemonCall.mock.calls.filter(([method]) => method === "research.loops.record")).toHaveLength(1);
	});

	it("keeps optimizer metadata when cancellation lands after durable closure recording", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		const closureContext = await import("../src/chitragupta-nodes-research-overnight-context.js");

		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.989,
			stdout: "val_bpb: 0.989000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: { "train.py": "print('train')\n" },
			},
			selectedModelId: "qwen-coder",
			selectedProviderId: "ollama",
			executionRouteClass: "tool.use.flex",
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.989,
			delta: 0.001,
			improved: true,
			decision: "keep",
			status: "completed",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: "better metric",
			scopeGuard: "git",
		});
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: true,
			runtime: "pakt-core",
			source: "daemon",
			packedText: "packed:daemon",
			savings: 42,
		});
		vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
			traceId: "trace-kept",
			experimentId: "exp-kept",
			source: "daemon",
		});
		vi.spyOn(closureContext, "unpackContextForReuseWithPolicy").mockResolvedValue("carry text");
		vi.spyOn(closureContext, "normalizeContextForReuseWithPolicy").mockRejectedValue(new Error("normalize transport closed"));

		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.heartbeat") {
				if (params?.phase === "closure-error") {
					return {
						state: {
							loopKey: params?.loopKey,
							status: "cancelling",
							cancelRequestedAt: Date.now(),
							cancelReason: "operator-stop",
						},
					};
				}
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "cancelled",
						stopReason: params?.stopReason,
					},
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "late cancellation should preserve optimizer metadata",
			topic: "Late cancelled overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 2,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-late-cancelled",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Late cancelled overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "late cancellation should preserve optimizer metadata",
		});

		expect(summary.stopReason).toBe("cancelled");
		expect(summary.frontier).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				optimizerScore: expect.any(Number),
			}),
		]);
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "keep",
				finalizeAction: "kept",
				traceId: "trace-kept",
				experimentId: "exp-kept",
				optimizerScore: expect.any(Number),
				objectiveScores: expect.arrayContaining([
					expect.objectContaining({ id: "metric-improvement" }),
				]),
			}),
		]);
	});

		it("keeps cancellation authoritative when cleanup itself aborts after cancel", async () => {
			vi.resetModules();
			const runner = await import("../src/chitragupta-nodes-research-runner.js");
			let cleanupSignal: AbortSignal | undefined;

		vi.spyOn(runner, "executeResearchRun").mockImplementation(async (scope) => {
			const cancellationError = Object.assign(new Error("operator-stop"), {
				cancelled: true,
				durationMs: 550,
				scopeGuard: "git",
				targetFilesChanged: ["train.py"],
				scopeSnapshot: {
					mode: "git",
					fileContents: {
						"train.py": "print('train')\n",
					},
				},
				executionRouteClass: scope.executionRouteClass,
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			});
			await new Promise<never>((_, reject) => {
				const timeout = setTimeout(() => reject(new Error("interrupt was never requested")), 2_000);
				scope.interruptSignal?.addEventListener("abort", () => {
					clearTimeout(timeout);
					reject(cancellationError);
				}, { once: true });
			});
		});
			vi.spyOn(runner, "recoverResearchFailure").mockImplementation(async (_scope, _run, signal) => {
				cleanupSignal = signal;
				throw Object.assign(new Error("cleanup cancelled"), {
					cancelled: true,
				});
			});

		let heartbeatCount = 0;
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				return { state: { loopKey: params?.loopKey, status: "running", cancelRequestedAt: null } };
			}
			if (method === "research.loops.heartbeat") {
				heartbeatCount += 1;
				if (params?.phase === "run" && heartbeatCount >= 2) {
					return {
						state: {
							loopKey: params?.loopKey,
							status: "cancelling",
							cancelRequestedAt: Date.now(),
							cancelReason: "operator-stop",
						},
					};
				}
				return { state: { loopKey: params?.loopKey, status: "running", cancelRequestedAt: null } };
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "cancelled",
						stopReason: params?.stopReason,
					},
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "cleanup abort should not override cancellation",
			topic: "Cancelled cleanup abort overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 3,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-cancelled-cleanup-abort",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Cancelled cleanup abort overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "cleanup abort should not override cancellation",
		});

		expect(summary).toEqual(expect.objectContaining({
			stopReason: "cancelled",
			closureStatus: "degraded",
			closureError: "cleanup cancelled",
			roundsCompleted: 1,
		}));
			expect(cleanupSignal).toBeInstanceOf(AbortSignal);
			expect(daemonCall).toHaveBeenCalledWith("research.loops.complete", expect.objectContaining({
				loopKey: "loop-cancelled-cleanup-abort",
				stopReason: "cancelled",
		}));
	});

	it("keeps a completion-pending checkpoint when daemon loop completion fails and resumes finalization", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");

		const executeSpy = vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.989,
			stdout: "val_bpb: 0.989000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: { "train.py": "print('train')\n" },
			},
			selectedModelId: "qwen-coder",
			selectedProviderId: "ollama",
			executionRouteClass: "tool.use.flex",
		});
		const evaluateSpy = vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.989,
			delta: 0.001,
			improved: true,
			decision: "keep",
			status: "completed",
		});
		const finalizeSpy = vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: "better metric",
			scopeGuard: "git",
		});

		let completeCalls = 0;
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.complete") {
				completeCalls += 1;
				if (completeCalls === 1) {
					throw new Error("daemon completion unavailable");
				}
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const scope = {
			hypothesis: "terminal checkpoint should preserve stop truth",
			topic: "Terminal checkpoint preservation",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize" as const,
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 1,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-terminal-checkpoint",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		};
		const council = {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Terminal checkpoint preservation",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon" as const,
		};
		const baseline = {
			metricName: "val_bpb",
			objective: "minimize" as const,
			baselineMetric: 0.99,
			hypothesis: "terminal checkpoint should preserve stop truth",
		};

		const degraded = await executeOvernightResearchLoop(scope, council, baseline);

		expect(degraded.stopReason).toBe("max-rounds");
		expect(degraded.closureStatus).toBe("degraded");
		expect(getResearchLoopCheckpoint()).toEqual(expect.objectContaining({
			status: "active",
			phase: "complete-pending",
			checkpoint: expect.objectContaining({
				terminalSummary: expect.objectContaining({
					loopKey: "loop-terminal-checkpoint",
					stopReason: "max-rounds",
				}),
			}),
		}));

		executeSpy.mockClear();
		evaluateSpy.mockClear();
		finalizeSpy.mockClear();

		const resumed = await executeOvernightResearchLoop(scope, council, baseline);

		expect(resumed.stopReason).toBe("max-rounds");
		expect(executeSpy).not.toHaveBeenCalled();
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(finalizeSpy).not.toHaveBeenCalled();
		expect(clearResearchLoopCheckpoint).toHaveBeenCalled();
		expect(getResearchLoopCheckpoint()).toBeNull();
	});

		it("resumes from a successful closure checkpoint without rerunning the experiment", async () => {
			vi.resetModules();
			const runner = await import("../src/chitragupta-nodes-research-runner.js");
			const recording = await import("../src/chitragupta-nodes-research-recording.js");

			const executeSpy = vi.spyOn(runner, "executeResearchRun");
			const evaluateSpy = vi.spyOn(runner, "evaluateResearchResult");
			const finalizeSpy = vi.spyOn(runner, "finalizeResearchResult");
			const recordSpy = vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
				recorded: true,
				traceId: "trace-resume-success",
				experimentId: "exp-resume-success",
			});

			getResearchLoopCheckpoint.mockReturnValueOnce({
				id: "checkpoint-success-1",
				projectPath: researchDir,
				loopKey: "loop-resume-success",
				phase: "closure-record",
				status: "active",
				checkpoint: {
					version: 1,
					loopKey: "loop-resume-success",
					phase: "closure-record",
					currentBaseline: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 0.99,
						hypothesis: "resume success closure",
					},
					progress: {
						bestMetric: 0.99,
						bestRoundNumber: null,
						noImprovementStreak: 0,
						totalDurationMs: 0,
					},
					roundCounts: { keptRounds: 0, revertedRounds: 0 },
					carryContext: "",
					rounds: [],
					nextRoundNumber: 1,
					activeRound: {
						roundNumber: 1,
						roundBase: {
							roundNumber: 1,
							decision: "keep",
							observedMetric: 0.989,
							delta: 0.001,
							finalizeAction: "kept",
							traceId: null,
							experimentId: null,
							packedRuntime: null,
							packedSource: null,
							selectedModelId: "qwen-coder",
							selectedProviderId: "ollama",
							executionRouteClass: "tool.use.flex",
						},
						runData: {
							command: "uv",
							commandArgs: ["run", "train.py"],
							cwd: researchDir,
							metricName: "val_bpb",
							metric: 0.989,
							stdout: "val_bpb: 0.989000",
							stderr: "",
							exitCode: 0,
							timedOut: false,
							durationMs: 25,
							scopeGuard: "git",
							targetFilesChanged: ["train.py"],
							scopeSnapshot: {
								mode: "git",
								fileContents: { "train.py": "print('train')\n" },
							},
							selectedModelId: "qwen-coder",
							selectedProviderId: "ollama",
							executionRouteClass: "tool.use.flex",
						},
						evaluation: {
							metricName: "val_bpb",
							objective: "minimize",
							baselineMetric: 0.99,
							observedMetric: 0.989,
							delta: 0.001,
							improved: true,
							decision: "keep",
							status: "completed",
						},
						finalize: {
							decision: "keep",
							action: "kept",
							revertedFiles: [],
							reason: "better metric",
							scopeGuard: "git",
						},
						packed: {
							runtime: "pakt-core",
							source: "daemon",
							packedText: "packed:resume-success",
						},
						recorded: null,
					},
				},
			});

			const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
			const summary = await executeOvernightResearchLoop({
				hypothesis: "resume success closure",
				topic: "Resume success closure loop",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: researchDir,
				cwd: researchDir,
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 1,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-resume-success",
				roundNumber: null,
				totalRounds: null,
				attemptNumber: null,
			}, {
				sabhaId: "sabha-daemon",
				sessionId: "sess-autoresearch",
				topic: "Resume success closure loop",
				participantCount: 2,
				participants: [
					{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
					{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
				],
				finalVerdict: "accepted",
				rounds: 1,
				councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
				lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
				route: null,
				plannerRoute: null,
				executionRoute: null,
				source: "daemon",
			}, {
				metricName: "val_bpb",
				objective: "minimize",
				baselineMetric: 0.99,
				hypothesis: "resume success closure",
			});

			expect(executeSpy).not.toHaveBeenCalled();
			expect(evaluateSpy).not.toHaveBeenCalled();
			expect(finalizeSpy).not.toHaveBeenCalled();
			expect(recordSpy).toHaveBeenCalledOnce();
			expect(clearResearchLoopCheckpoint).toHaveBeenCalled();
			expect(summary).toEqual(expect.objectContaining({
				loopKey: "loop-resume-success",
				stopReason: "max-rounds",
				roundsCompleted: 1,
				keptRounds: 1,
			}));
		});

		it("prefers the daemon-owned checkpoint when the daemon is available", async () => {
			vi.resetModules();
			const { loadResearchLoopCheckpoint } = await import("../src/chitragupta-nodes-research-checkpoints.js");

			getResearchLoopCheckpoint.mockReturnValueOnce({
				id: "checkpoint-local-newer",
				projectPath: researchDir,
				loopKey: "loop-checkpoint-fork",
				phase: "closure-record",
				status: "active",
				createdAt: 150,
				updatedAt: 200,
				checkpoint: {
					version: 1,
					loopKey: "loop-checkpoint-fork",
					phase: "closure-record",
					currentBaseline: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 0.99,
						hypothesis: "prefer local checkpoint",
					},
					progress: {
						bestMetric: 0.989,
						bestRoundNumber: 1,
						noImprovementStreak: 0,
						totalDurationMs: 250,
					},
					roundCounts: { keptRounds: 1, revertedRounds: 0 },
					carryContext: "packed:local-newer",
					rounds: [],
					nextRoundNumber: 2,
					activeRound: null,
				},
			});

			const defaultImplementation = daemonCall.getMockImplementation();
			daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
				if (method === "research.loops.checkpoint.get") {
					return {
						checkpoint: {
							id: "checkpoint-daemon-older",
							projectPath: researchDir,
							loopKey: String(params?.loopKey ?? ""),
							phase: "run",
							status: "active",
							createdAt: 50,
							updatedAt: 100,
							checkpoint: {
								version: 1,
								loopKey: "loop-checkpoint-fork",
								phase: "run",
								currentBaseline: {
									metricName: "val_bpb",
									objective: "minimize",
									baselineMetric: 0.99,
									hypothesis: "prefer local checkpoint",
								},
								progress: {
									bestMetric: 0.99,
									bestRoundNumber: null,
									noImprovementStreak: 0,
									totalDurationMs: 100,
								},
								roundCounts: { keptRounds: 0, revertedRounds: 0 },
								carryContext: "packed:daemon-older",
								rounds: [],
								nextRoundNumber: 1,
								activeRound: null,
							},
						},
					};
				}
				if (!defaultImplementation) {
					throw new Error(`Unexpected daemon method: ${method}`);
				}
				return defaultImplementation(method, params);
			});

			const checkpoint = await loadResearchLoopCheckpoint({
				hypothesis: "prefer local checkpoint",
				topic: "Checkpoint fork resume",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: researchDir,
				cwd: researchDir,
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				allowDirtyWorkspace: false,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 2,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-checkpoint-fork",
				roundNumber: null,
				totalRounds: null,
				attemptNumber: null,
			}, "loop-checkpoint-fork");

			expect(checkpoint).toEqual(expect.objectContaining({
				loopKey: "loop-checkpoint-fork",
				phase: "run",
				carryContext: "packed:daemon-older",
				nextRoundNumber: 1,
			}));
		});

		it("clears stale local fallback residue after a daemon-owned checkpoint clear", async () => {
			vi.resetModules();
			const { clearResearchLoopCheckpoint: clearDaemonOwnedResearchLoopCheckpoint } =
				await import("../src/chitragupta-nodes-research-checkpoints.js");

			upsertResearchLoopCheckpoint({
				projectPath: researchDir,
				loopKey: "loop-checkpoint-residue",
				phase: "run",
				status: "active",
				currentRound: 1,
				nextRoundNumber: 2,
				totalRounds: 3,
				checkpoint: {
					version: 1,
					loopKey: "loop-checkpoint-residue",
					phase: "run",
					currentBaseline: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 0.99,
						hypothesis: "clear stale residue",
					},
					progress: {
						bestMetric: 0.99,
						bestRoundNumber: null,
						noImprovementStreak: 0,
						totalDurationMs: 0,
					},
					roundCounts: { keptRounds: 0, revertedRounds: 0 },
					carryContext: "packed:local",
					rounds: [],
					nextRoundNumber: 2,
					activeRound: null,
				},
			});
			clearResearchLoopCheckpoint.mockClear();

			const defaultImplementation = daemonCall.getMockImplementation();
			daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
				if (method === "research.loops.checkpoint.clear") {
					return { cleared: true, projectPath: params?.projectPath, loopKey: params?.loopKey };
				}
				if (!defaultImplementation) {
					throw new Error(`Unexpected daemon method: ${method}`);
				}
				return defaultImplementation(method, params);
			});

			await clearDaemonOwnedResearchLoopCheckpoint({
				hypothesis: "clear stale residue",
				topic: "Checkpoint residue cleanup",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: researchDir,
				cwd: researchDir,
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				allowDirtyWorkspace: false,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 2,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-checkpoint-residue",
				roundNumber: null,
				totalRounds: null,
				attemptNumber: null,
			}, "loop-checkpoint-residue");

			expect(clearResearchLoopCheckpoint).toHaveBeenCalledOnce();
		});

		it("resumes from a failed closure checkpoint without rerunning the experiment", async () => {
			vi.resetModules();
			const runner = await import("../src/chitragupta-nodes-research-runner.js");
			const recording = await import("../src/chitragupta-nodes-research-recording.js");

			getResearchLoopCheckpoint.mockReset();
			listResearchLoopSummaries.mockReset();
			listResearchExperiments.mockReset();
			listResearchLoopSummaries.mockReturnValue([]);
			listResearchExperiments.mockReturnValue([]);
			const executeSpy = vi.spyOn(runner, "executeResearchRun");
			const recoverySpy = vi.spyOn(runner, "recoverResearchFailure");
			vi.spyOn(recording, "recordResearchFailure").mockResolvedValue({
				recorded: true,
				traceId: "trace-resume-failure",
				experimentId: "exp-resume-failure",
			});

			getResearchLoopCheckpoint.mockReturnValueOnce({
				id: "checkpoint-failure-1",
				projectPath: researchDir,
				loopKey: "loop-resume-failure",
				phase: "failure-pack",
				status: "active",
				checkpoint: {
					version: 1,
					loopKey: "loop-resume-failure",
					phase: "failure-pack",
					currentBaseline: {
						metricName: "val_bpb",
						objective: "minimize",
						baselineMetric: 0.99,
						hypothesis: "resume failure closure",
					},
					progress: {
						bestMetric: 0.99,
						bestRoundNumber: null,
						noImprovementStreak: 0,
						totalDurationMs: 0,
					},
					roundCounts: { keptRounds: 0, revertedRounds: 0 },
					carryContext: "",
					rounds: [],
					nextRoundNumber: 1,
					activeRound: {
						roundNumber: 1,
						failedRun: {
							command: "uv",
							commandArgs: ["run", "train.py"],
							cwd: researchDir,
							metricName: "val_bpb",
							metric: null,
							errorMessage: "train failed",
							stdout: "",
							stderr: "boom",
							exitCode: 1,
							timedOut: false,
							durationMs: 25,
							scopeGuard: "git",
							targetFilesChanged: ["train.py"],
							scopeSnapshot: {
								mode: "git",
								fileContents: { "train.py": "print('train')\n" },
							},
							selectedModelId: "qwen-coder",
							selectedProviderId: "ollama",
							executionRouteClass: "tool.use.flex",
						},
						finalize: {
							decision: "discard",
							action: "reverted",
							revertedFiles: ["train.py"],
							reason: "failed run reverted",
							scopeGuard: "git",
						},
						packed: null,
						recorded: null,
					},
				},
			});

			const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
			const summary = await executeOvernightResearchLoop({
				hypothesis: "resume failure closure",
				topic: "Resume failure closure loop",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: researchDir,
				cwd: researchDir,
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 1,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-resume-failure",
				roundNumber: null,
				totalRounds: null,
				attemptNumber: null,
			}, {
				sabhaId: "sabha-daemon",
				sessionId: "sess-autoresearch",
				topic: "Resume failure closure loop",
				participantCount: 2,
				participants: [
					{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
					{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
				],
				finalVerdict: "accepted",
				rounds: 1,
				councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
				lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
				route: null,
				plannerRoute: null,
				executionRoute: null,
				source: "daemon",
			}, {
				metricName: "val_bpb",
				objective: "minimize",
				baselineMetric: 0.99,
				hypothesis: "resume failure closure",
			});

			expect(executeSpy).not.toHaveBeenCalled();
			expect(recoverySpy).not.toHaveBeenCalled();
			expect(clearResearchLoopCheckpoint).toHaveBeenCalled();
			expect(summary).toEqual(expect.objectContaining({
				loopKey: "loop-resume-failure",
				stopReason: "round-failed",
				roundsCompleted: 1,
				revertedRounds: 1,
			}));
		});

		it("prefers recorded round wall-clock duration when rebuilding resume progress", async () => {
			vi.resetModules();
			getResearchLoopCheckpoint.mockReset();
			getResearchLoopCheckpoint.mockReturnValue(null);
			listResearchLoopSummaries.mockReturnValue([]);
			listResearchExperiments.mockReturnValue([
				{
					id: "exp-replay-1",
					roundNumber: 1,
					decision: "keep",
					observedMetric: 0.989,
					delta: 0.001,
					packedContext: "packed:resume-duration",
					packedRuntime: "pakt-core",
					packedSource: "daemon",
					selectedModelId: "qwen-coder",
					selectedProviderId: "ollama",
					executionRouteClass: "tool.use.flex",
					updatedAt: 1,
					record: {
						run: {
							durationMs: 25,
							roundWallClockDurationMs: 80,
						},
					},
				},
			]);

			const { restoreOvernightResearchLoopState } = await import("../src/chitragupta-nodes-research-overnight-resume.js");
				const restored = await restoreOvernightResearchLoopState(
				{
					hypothesis: "resume duration uses closure-aware accounting",
					topic: "Resume duration accounting",
					command: "uv",
					commandArgs: ["run", "train.py"],
					projectPath: researchDir,
					cwd: researchDir,
					parentSessionId: null,
					sessionLineageKey: null,
					targetFiles: ["train.py"],
					immutableFiles: ["prepare.py"],
					metricName: "val_bpb",
					metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
					objective: "minimize",
					budgetMs: 60_000,
					totalBudgetMs: 60_000,
					plannerRouteClass: "coding.deep-reasoning",
					plannerCapability: null,
					executionRouteClass: "tool.use.flex",
					executionCapability: null,
					maxRounds: 3,
					agentCount: 2,
					stopAfterNoImprovementRounds: 2,
					loopKey: "loop-resume-duration",
					roundNumber: null,
					totalRounds: null,
					attemptNumber: null,
				},
				{
					sabhaId: "sabha-daemon",
					sessionId: "sess-autoresearch",
					topic: "Resume duration accounting",
					participantCount: 2,
					participants: [
						{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
						{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
					],
					finalVerdict: "accepted",
					rounds: 1,
					councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
					lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
					route: null,
					plannerRoute: null,
					executionRoute: null,
					source: "daemon",
				},
				{
					metricName: "val_bpb",
					objective: "minimize",
					baselineMetric: 0.99,
					hypothesis: "resume duration uses closure-aware accounting",
				},
				"loop-resume-duration",
			);

			expect(restored).toEqual(expect.objectContaining({
				kind: "resume",
				nextRoundNumber: 2,
			}));
			if (restored.kind === "resume") {
				expect(restored.progress.totalDurationMs).toBe(80);
			}
		});

		it("treats a cancelled recorded loop as terminal instead of resumable", async () => {
			vi.resetModules();
			getResearchLoopCheckpoint.mockReturnValueOnce(null);
			listResearchLoopSummaries.mockReturnValue([
				{
					id: "loop-summary-cancelled-1",
					loopKey: "loop-resume-cancelled",
					roundsRequested: 3,
					roundsCompleted: 1,
					stopReason: "cancelled",
					bestMetric: 0.989,
					bestRoundNumber: 1,
					noImprovementStreak: 0,
					totalDurationMs: 80,
					totalBudgetMs: 60_000,
					keptRounds: 0,
					revertedRounds: 1,
					sessionId: "sess-autoresearch",
					sabhaId: "sabha-daemon",
					record: {
						rounds: [
							{
								roundNumber: 1,
								decision: "cancelled",
								observedMetric: 0.989,
								delta: 0.001,
								finalizeAction: "reverted",
							},
						],
					},
				},
			]);
			listResearchExperiments.mockReturnValue([]);

			const { restoreOvernightResearchLoopState } = await import("../src/chitragupta-nodes-research-overnight-resume.js");
			const restored = await restoreOvernightResearchLoopState(
				{
					hypothesis: "cancelled loops should stay terminal",
					topic: "Cancelled loop resume guard",
					command: "uv",
					commandArgs: ["run", "train.py"],
					projectPath: researchDir,
					cwd: researchDir,
					parentSessionId: null,
					sessionLineageKey: null,
					targetFiles: ["train.py"],
					immutableFiles: ["prepare.py"],
					metricName: "val_bpb",
					metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
					objective: "minimize",
					budgetMs: 60_000,
					totalBudgetMs: 60_000,
					plannerRouteClass: "coding.deep-reasoning",
					plannerCapability: null,
					executionRouteClass: "tool.use.flex",
					executionCapability: null,
					maxRounds: 3,
					agentCount: 2,
					stopAfterNoImprovementRounds: 2,
					loopKey: "loop-resume-cancelled",
					roundNumber: null,
					totalRounds: null,
					attemptNumber: null,
				},
				{
					sabhaId: "sabha-daemon",
					sessionId: "sess-autoresearch",
					topic: "Cancelled loop resume guard",
					participantCount: 2,
					participants: [
						{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
						{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
					],
					finalVerdict: "accepted",
					rounds: 1,
					councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
					lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
					route: null,
					plannerRoute: null,
					executionRoute: null,
					source: "daemon",
				},
				{
					metricName: "val_bpb",
					objective: "minimize",
					baselineMetric: 0.99,
					hypothesis: "cancelled loops should stay terminal",
				},
				"loop-resume-cancelled",
			);

			expect(restored).toEqual(expect.objectContaining({
				kind: "terminal",
				summary: expect.objectContaining({
					stopReason: "cancelled",
				}),
			}));
		});

		it("dedupes retry attempts when rebuilding resumed rounds and duration", async () => {
			vi.resetModules();
			getResearchLoopCheckpoint.mockReturnValueOnce(null);
			listResearchLoopSummaries.mockReturnValue([]);
			listResearchExperiments.mockReturnValue([
				{
					id: "exp-round-1-attempt-1",
					roundNumber: 1,
					attemptNumber: 1,
					decision: "discard",
					observedMetric: 0.991,
					delta: -0.001,
					packedContext: "packed:first",
					packedRuntime: "pakt-core",
					packedSource: "daemon",
					selectedModelId: "qwen-coder",
					selectedProviderId: "ollama",
					executionRouteClass: "tool.use.flex",
					updatedAt: 1,
					record: {
						run: {
							durationMs: 25,
							roundWallClockDurationMs: 40,
						},
					},
				},
				{
					id: "exp-round-1-attempt-2",
					roundNumber: 1,
					attemptNumber: 2,
					decision: "keep",
					observedMetric: 0.989,
					delta: 0.001,
					packedContext: "packed:latest",
					packedRuntime: "pakt-core",
					packedSource: "daemon",
					selectedModelId: "qwen-coder",
					selectedProviderId: "ollama",
					executionRouteClass: "tool.use.flex",
					updatedAt: 2,
					record: {
						run: {
							durationMs: 30,
							roundWallClockDurationMs: 80,
						},
					},
				},
			]);

			const { restoreOvernightResearchLoopState } = await import("../src/chitragupta-nodes-research-overnight-resume.js");
			const restored = await restoreOvernightResearchLoopState(
				{
					hypothesis: "resume should count one logical round",
					topic: "Retry dedupe resume",
					command: "uv",
					commandArgs: ["run", "train.py"],
					projectPath: researchDir,
					cwd: researchDir,
					parentSessionId: null,
					sessionLineageKey: null,
					targetFiles: ["train.py"],
					immutableFiles: ["prepare.py"],
					metricName: "val_bpb",
					metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
					objective: "minimize",
					budgetMs: 60_000,
					totalBudgetMs: 60_000,
					plannerRouteClass: "coding.deep-reasoning",
					plannerCapability: null,
					executionRouteClass: "tool.use.flex",
					executionCapability: null,
					maxRounds: 3,
					agentCount: 2,
					stopAfterNoImprovementRounds: 2,
					loopKey: "loop-resume-dedupe",
					roundNumber: null,
					totalRounds: null,
					attemptNumber: null,
				},
				{
					sabhaId: "sabha-daemon",
					sessionId: "sess-autoresearch",
					topic: "Retry dedupe resume",
					participantCount: 2,
					participants: [
						{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
						{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
					],
					finalVerdict: "accepted",
					rounds: 1,
					councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
					lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
					route: null,
					plannerRoute: null,
					executionRoute: null,
					source: "daemon",
				},
				{
					metricName: "val_bpb",
					objective: "minimize",
					baselineMetric: 0.99,
					hypothesis: "resume should count one logical round",
				},
				"loop-resume-dedupe",
			);

			expect(restored).toEqual(expect.objectContaining({
				kind: "resume",
				nextRoundNumber: 2,
			}));
			if (restored.kind === "resume") {
				expect(restored.rounds).toHaveLength(1);
				expect(restored.rounds[0]).toEqual(expect.objectContaining({
					decision: "keep",
					observedMetric: 0.989,
				}));
				expect(restored.progress.totalDurationMs).toBe(80);
				expect(restored.currentBaseline.baselineMetric).toBe(0.989);
			}
		});

		it("rebuilds governance from the persisted summary when the recent experiment slice is truncated", async () => {
			vi.resetModules();
			getResearchLoopCheckpoint.mockReturnValueOnce(null);
			listResearchLoopSummaries.mockReturnValue([
				{
					id: "loop-summary-resume-governance",
					loopKey: "loop-resume-governance",
					roundsRequested: 8,
					roundsCompleted: 6,
					stopReason: "closure-failed",
					bestMetric: 0.982,
					bestRoundNumber: 4,
					noImprovementStreak: 2,
					totalDurationMs: 240,
					totalBudgetMs: 60_000,
					keptRounds: 2,
					revertedRounds: 4,
					sessionId: "sess-autoresearch",
					sabhaId: "sabha-daemon",
					councilVerdict: "accepted",
					record: {
						rounds: [
							{ roundNumber: 1, decision: "discard", observedMetric: 0.991, delta: -0.001, finalizeAction: "reverted", paretoDominated: true, paretoRank: 1 },
							{ roundNumber: 2, decision: "discard", observedMetric: 0.99, delta: -0.001, finalizeAction: "reverted", paretoDominated: true, paretoRank: 1 },
							{ roundNumber: 3, decision: "discard", observedMetric: 0.989, delta: -0.001, finalizeAction: "reverted", paretoDominated: true, paretoRank: 1 },
							{
								roundNumber: 4,
								decision: "keep",
								observedMetric: 0.982,
								delta: 0.007,
								finalizeAction: "kept",
								objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 1, value: 0.007, threshold: 0.001, satisfied: true, explanation: "kept" }],
								stopConditionHits: [{ id: "max-rounds", label: "Max rounds", triggered: false, reason: "not reached" }],
								optimizerScore: 0.91,
								paretoDominated: false,
								paretoRank: 0,
							},
							{ roundNumber: 5, decision: "discard", observedMetric: 0.983, delta: -0.001, finalizeAction: "reverted", paretoDominated: true, paretoRank: 1 },
							{ roundNumber: 6, decision: "discard", observedMetric: 0.984, delta: -0.001, finalizeAction: "reverted", paretoDominated: true, paretoRank: 1 },
						],
						frontier: [
							{
								roundNumber: 4,
								optimizerScore: 0.91,
								objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 1, value: 0.007, threshold: 0.001, satisfied: true, explanation: "kept" }],
							},
						],
						stopConditionHits: [{ id: "quality-plateau", label: "Plateau", triggered: true, reason: "two flat rounds" }],
					},
				},
			]);
			// I only return the recent ledger tail here to simulate the bounded
			// experiment window used by resume rebuild.
			listResearchExperiments.mockReturnValue([
				{
					id: "exp-round-5",
					roundNumber: 5,
					attemptNumber: 1,
					decision: "discard",
					observedMetric: 0.983,
					delta: -0.001,
					packedContext: "packed:recent-5",
					packedRuntime: "pakt-core",
					packedSource: "daemon",
					selectedModelId: "qwen-coder",
					selectedProviderId: "ollama",
					executionRouteClass: "tool.use.flex",
					updatedAt: 5,
					record: { run: { durationMs: 20, roundWallClockDurationMs: 40 } },
				},
				{
					id: "exp-round-6",
					roundNumber: 6,
					attemptNumber: 1,
					decision: "discard",
					observedMetric: 0.984,
					delta: -0.001,
					packedContext: "packed:recent-6",
					packedRuntime: "pakt-core",
					packedSource: "daemon",
					selectedModelId: "qwen-coder",
					selectedProviderId: "ollama",
					executionRouteClass: "tool.use.flex",
					updatedAt: 6,
					record: { run: { durationMs: 20, roundWallClockDurationMs: 40 } },
				},
			]);

			const { restoreOvernightResearchLoopState } = await import("../src/chitragupta-nodes-research-overnight-resume.js");
			const restored = await restoreOvernightResearchLoopState(
				{
					hypothesis: "resume should not truncate governance to the recent ledger tail",
					topic: "Resume governance recovery",
					command: "uv",
					commandArgs: ["run", "train.py"],
					projectPath: researchDir,
					cwd: researchDir,
					parentSessionId: null,
					sessionLineageKey: null,
					targetFiles: ["train.py"],
					immutableFiles: ["prepare.py"],
					metricName: "val_bpb",
					metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
					objective: "minimize",
					budgetMs: 60_000,
					totalBudgetMs: 60_000,
					plannerRouteClass: "coding.deep-reasoning",
					plannerCapability: null,
					executionRouteClass: "tool.use.flex",
					executionCapability: null,
					maxRounds: 8,
					agentCount: 2,
					stopAfterNoImprovementRounds: 2,
					loopKey: "loop-resume-governance",
					roundNumber: null,
					totalRounds: null,
					attemptNumber: null,
				},
				{
					sabhaId: "sabha-daemon",
					sessionId: "sess-autoresearch",
					topic: "Resume governance recovery",
					participantCount: 2,
					participants: [
						{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
						{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
					],
					finalVerdict: "accepted",
					rounds: 1,
					councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
					lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
					route: null,
					plannerRoute: null,
					executionRoute: null,
					source: "daemon",
				},
				{
					metricName: "val_bpb",
					objective: "minimize",
					baselineMetric: 0.99,
					hypothesis: "resume should not truncate governance to the recent ledger tail",
				},
				"loop-resume-governance",
				);

				expect(listResearchExperiments).toHaveBeenCalledWith(expect.objectContaining({
					projectPath: researchDir,
					loopKey: "loop-resume-governance",
					limit: 200,
				}));
				expect(restored).toEqual(expect.objectContaining({
					kind: "resume",
					nextRoundNumber: 7,
			}));
			if (restored.kind === "resume") {
				expect(restored.rounds).toHaveLength(6);
				expect(restored.roundCounts).toEqual({
					keptRounds: 1,
					revertedRounds: 5,
				});
				expect(restored.currentBaseline.baselineMetric).toBe(0.982);
				expect(restored.progress.bestMetric).toBe(0.982);
				expect(restored.progress.noImprovementStreak).toBe(2);
				expect(restored.rounds[3]).toEqual(expect.objectContaining({
					roundNumber: 4,
					optimizerScore: 0.91,
					paretoDominated: false,
					objectiveScores: expect.arrayContaining([
						expect.objectContaining({ id: "metric-improvement", score: 1 }),
					]),
				}));
			}
		});

		it("reuses the same logical loop key when scope.loopKey is omitted", async () => {
			vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");

		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.989,
			stdout: "val_bpb: 0.989000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: {
					"train.py": "print('train')\n",
				},
			},
			selectedModelId: "qwen-coder",
			selectedProviderId: "ollama",
			executionRouteClass: "tool.use.flex",
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.989,
			delta: 0.001,
			improved: true,
			decision: "keep",
			status: "completed",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: "better metric",
			scopeGuard: "git",
		});
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: true,
			runtime: "pakt-core",
			source: "daemon",
			packedText: "packed:daemon",
			savings: 42,
			sourceLength: 128,
		});
		vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-1",
			experimentId: "exp-daemon-1",
		});
		const storedLoopSummaries: Array<Record<string, unknown>> = [];
		listResearchLoopSummaries.mockImplementation((options?: { loopKey?: string; limit?: number }) => {
			const loopKey = typeof options?.loopKey === "string" ? options.loopKey : null;
			const filtered = loopKey
				? storedLoopSummaries.filter((summary) => summary.loopKey === loopKey)
				: storedLoopSummaries;
			const limit = typeof options?.limit === "number" ? options.limit : filtered.length;
			return filtered.slice(0, limit);
		});

		const startedLoopKeys: string[] = [];
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "research.loops.start") {
				if (typeof params?.loopKey === "string") startedLoopKeys.push(params.loopKey);
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.heartbeat") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "running",
						cancelRequestedAt: null,
					},
				};
			}
			if (method === "research.loops.complete") {
				return {
					state: {
						loopKey: params?.loopKey,
						status: "completed",
						stopReason: params?.stopReason,
					},
				};
			}
			if (method === "research.loops.record") {
				storedLoopSummaries.unshift({
					id: "loop-summary-daemon-1",
					loopKey: params?.loopKey,
					roundsRequested: params?.roundsRequested,
					roundsCompleted: params?.roundsCompleted,
					stopReason: params?.stopReason,
					bestMetric: params?.bestMetric,
					bestRoundNumber: params?.bestRoundNumber,
					noImprovementStreak: params?.noImprovementStreak,
					totalDurationMs: params?.totalDurationMs,
					totalBudgetMs: params?.totalBudgetMs,
					keptRounds: params?.keptRounds,
					revertedRounds: params?.revertedRounds,
					sessionId: params?.sessionId,
					sabhaId: params?.sabhaId,
					councilVerdict: params?.councilVerdict,
					record: params?.record,
				});
				return {
					summary: { id: "loop-summary-daemon-1" },
				};
			}
			return defaultDaemonCallImplementation(method, params);
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const sharedScope = {
			hypothesis: "same scoped run should not reuse implicit loop key",
			topic: "Autogenerated loop keys",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize" as const,
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 1,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		};
		const council = {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Autogenerated loop keys",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon" as const,
		};
		const baseline = {
			metricName: "val_bpb",
			objective: "minimize" as const,
			baselineMetric: 0.99,
				hypothesis: "same scoped run should resume the implicit logical loop key",
			};

			const first = await executeOvernightResearchLoop({ ...sharedScope }, council, baseline);
			const second = await executeOvernightResearchLoop({ ...sharedScope }, council, baseline);

			expect(first.loopKey).toBe(second.loopKey);
			expect(startedLoopKeys).toHaveLength(1);
			expect(second.stopReason).toBe(first.stopReason);
		});

	it("fails closed when an overnight discarded round cannot be safely reverted", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.995,
			stdout: "val_bpb: 0.995000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: undefined,
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.995,
			delta: -0.005,
			improved: false,
			decision: "discard",
			reason: "regression",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "discard",
			action: "skipped",
			revertedFiles: [],
			reason: "No reusable scope snapshot was available for discard cleanup.",
			scopeGuard: "git",
		});
			const packSpy = vi.spyOn(recording, "packResearchContext").mockResolvedValue({
				packed: false,
				runtime: null,
				source: "none",
				packedText: "",
				savings: 0,
			});
			const recordSpy = vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
				recorded: true,
				memoryScope: "project",
				traceId: "trace-overnight",
				experimentId: "exp-overnight",
			});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "unsafe discard should fail closed",
			topic: "Unsafe discard overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 3,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-unsafe",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Unsafe discard overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "unsafe discard should fail closed",
		});

			expect(summary).toEqual(expect.objectContaining({
				roundsCompleted: 1,
				stopReason: "unsafe-discard",
				keptRounds: 0,
				revertedRounds: 0,
				summaryId: "loop-summary-daemon-1",
				summarySource: "daemon",
			}));
			expect(summary.rounds).toEqual([
				expect.objectContaining({
					roundNumber: 1,
					decision: "discard",
					finalizeAction: "skipped",
					traceId: "trace-overnight",
					experimentId: "exp-overnight",
				}),
			]);
			expect(packSpy).toHaveBeenCalledTimes(1);
			expect(recordSpy).toHaveBeenCalledTimes(1);
		});

	it("records a failed overnight round attempt and stops fail-closed", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		vi.spyOn(runner, "executeResearchRun").mockRejectedValue(Object.assign(new Error("runner exploded"), {
			stdout: "",
			stderr: "runner exploded",
			exitCode: 1,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: {
					"train.py": "print('train')\n",
				},
			},
		}));
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: false,
			runtime: null,
			source: "none",
			packedText: "",
			savings: 0,
		});
		const recordFailure = vi.spyOn(recording, "recordResearchFailure").mockResolvedValue({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-fail",
			experimentId: "exp-fail",
		});

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "failed round should be recorded",
			topic: "Failed overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 3,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-failed",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Failed overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "failed round should be recorded",
		});

			expect(summary).toEqual(expect.objectContaining({
				roundsCompleted: 1,
				stopReason: "round-failed",
				keptRounds: 0,
				summaryId: "loop-summary-daemon-1",
				summarySource: "daemon",
			}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "record",
				finalizeAction: "reverted",
				traceId: "trace-fail",
				experimentId: "exp-fail",
			}),
		]);
		expect(recordFailure).toHaveBeenCalledTimes(1);
	});

	it("degrades closure after a successful overnight round instead of reverting it", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.985,
			stdout: "val_bpb: 0.985000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: undefined,
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.985,
			delta: 0.005,
			improved: true,
			decision: "keep",
			reason: "improved",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: null,
			scopeGuard: "git",
		});
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: true,
			runtime: "pakt-core",
			source: "daemon",
			packedText: "packed:daemon",
			savings: 42,
		});
		vi.spyOn(recording, "recordResearchOutcome").mockRejectedValue(new Error("recording failed"));

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "closure should degrade without reverting a kept round",
			topic: "Closure failed overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 2,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-closure-failed",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Closure failed overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "closure should degrade without reverting a kept round",
		});

		expect(summary).toEqual(expect.objectContaining({
			roundsCompleted: 1,
			stopReason: "closure-failed",
			bestMetric: 0.99,
			bestRoundNumber: null,
			keptRounds: 0,
			revertedRounds: 0,
			closureStatus: "degraded",
			closureError: "recording failed",
			summaryId: "loop-summary-daemon-1",
			summarySource: "daemon",
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "keep",
				finalizeAction: "kept",
				traceId: null,
				experimentId: null,
			}),
		]);
	});

	it("returns a degraded summary when loop summary recording fails after a successful loop", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		const loopRecording = await import("../src/chitragupta-nodes-research-loop-recording.js");
		vi.spyOn(runner, "executeResearchRun").mockResolvedValue({
			command: "uv",
			commandArgs: ["run", "train.py"],
			cwd: researchDir,
			metricName: "val_bpb",
			metric: 0.985,
			stdout: "val_bpb: 0.985000",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: undefined,
		});
		vi.spyOn(runner, "evaluateResearchResult").mockResolvedValue({
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			observedMetric: 0.985,
			delta: 0.005,
			improved: true,
			decision: "keep",
			reason: "improved",
		});
		vi.spyOn(runner, "finalizeResearchResult").mockResolvedValue({
			decision: "keep",
			action: "kept",
			revertedFiles: [],
			reason: null,
			scopeGuard: "git",
		});
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: true,
			runtime: "pakt-core",
			source: "daemon",
			packedText: "packed:daemon",
			savings: 42,
		});
		vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-overnight",
			experimentId: "exp-overnight",
		});
		vi.spyOn(loopRecording, "recordResearchLoopSummary").mockRejectedValue(new Error("summary store down"));

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "loop summary failures should not throw",
			topic: "Loop summary degraded overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 1,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-summary-degraded",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Loop summary degraded overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "loop summary failures should not throw",
		});

		expect(summary).toEqual(expect.objectContaining({
			roundsCompleted: 1,
			stopReason: "max-rounds",
			closureStatus: "degraded",
			closureError: "summary store down",
			summaryId: null,
			summarySource: null,
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "keep",
				finalizeAction: "kept",
				traceId: "trace-overnight",
				experimentId: "exp-overnight",
			}),
		]);
	});

	it("degrades closure cleanly when failed-round recording cannot complete", async () => {
		vi.resetModules();
		const runner = await import("../src/chitragupta-nodes-research-runner.js");
		const recording = await import("../src/chitragupta-nodes-research-recording.js");
		vi.spyOn(runner, "executeResearchRun").mockRejectedValue(Object.assign(new Error("runner exploded"), {
			stdout: "",
			stderr: "runner exploded",
			exitCode: 1,
			durationMs: 25,
			scopeGuard: "git",
			targetFilesChanged: ["train.py"],
			scopeSnapshot: {
				mode: "git",
				fileContents: {
					"train.py": "print('train')\n",
				},
			},
		}));
		vi.spyOn(recording, "packResearchContext").mockRejectedValue(new Error("failure packing failed"));

		const { executeOvernightResearchLoop } = await import("../src/chitragupta-nodes-research-overnight.js");
		const summary = await executeOvernightResearchLoop({
			hypothesis: "failed closure should degrade cleanly",
			topic: "Failed closure overnight loop",
			command: "uv",
			commandArgs: ["run", "train.py"],
			projectPath: researchDir,
			cwd: researchDir,
			parentSessionId: null,
			sessionLineageKey: null,
			targetFiles: ["train.py"],
			immutableFiles: ["prepare.py"],
			metricName: "val_bpb",
			metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
			objective: "minimize",
			budgetMs: 60_000,
			totalBudgetMs: 60_000,
			plannerRouteClass: "coding.deep-reasoning",
			plannerCapability: null,
			executionRouteClass: "tool.use.flex",
			executionCapability: null,
			maxRounds: 2,
			agentCount: 2,
			stopAfterNoImprovementRounds: 2,
			loopKey: "loop-failed-closure",
			roundNumber: null,
			totalRounds: null,
			attemptNumber: null,
		}, {
			sabhaId: "sabha-daemon",
			sessionId: "sess-autoresearch",
			topic: "Failed closure overnight loop",
			participantCount: 2,
			participants: [
				{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
				{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
			],
			finalVerdict: "accepted",
			rounds: 1,
			councilSummary: [{ roundNumber: 1, verdict: "accepted", voteCount: 2, challengeCount: 0 }],
			lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
			route: null,
			plannerRoute: null,
			executionRoute: null,
			source: "daemon",
		}, {
			metricName: "val_bpb",
			objective: "minimize",
			baselineMetric: 0.99,
			hypothesis: "failed closure should degrade cleanly",
		});

		expect(summary).toEqual(expect.objectContaining({
			roundsCompleted: 1,
			stopReason: "closure-failed",
			closureStatus: "degraded",
			closureError: "failure packing failed",
			summaryId: "loop-summary-daemon-1",
			summarySource: "daemon",
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "record",
				finalizeAction: "reverted",
				traceId: null,
				experimentId: null,
			}),
		]);
	});

	it("allows overriding the research execution route class", async () => {
		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Override execution lane",
				researchExecutionRouteClass: "chat.flex",
			},
		}));

		expect(result.ok).toBe(true);
		expect(daemonCall).toHaveBeenCalledWith("route.resolveBatch", expect.objectContaining({
			routes: expect.arrayContaining([
				expect.objectContaining({
					key: "execution",
					routeClass: "chat.flex",
				}),
			]),
		}));
	});

	it("packs large live Lucy/Scarlett signal reasoning before writing a skeptical council perspective", async () => {
		const defaultImplementation = daemonCall.getMockImplementation();
		daemonCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "lucy.live_context") {
				return {
					hit: { entity: "sqlite", content: "Live warning ".repeat(60), source: "daemon" },
					predictions: [],
					liveSignals: [
						{ severity: "warning", description: "signal-a ".repeat(80) },
						{ severity: "warning", description: "signal-b ".repeat(80) },
					],
				};
			}
			return defaultImplementation
				? defaultImplementation(method, params)
				: undefined;
		});

		const { acpResearchCouncil } = await import("../src/chitragupta-nodes-research.js");
		const result = await acpResearchCouncil(makeContext({
			extra: {
				researchTopic: "Packed live warnings",
			},
		}));

		expect(result.ok).toBe(true);
		expect(daemonCall).toHaveBeenCalledWith("compression.pack_context", expect.objectContaining({
			text: expect.stringContaining("Live warning"),
		}));
		expect(daemonCall).toHaveBeenCalledWith("sabha.submit_perspective", expect.objectContaining({
			summary: "packed:daemon",
			reasoning: "packed:daemon",
		}));
	});
});
