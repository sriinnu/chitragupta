import { execFileSync } from "node:child_process";
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
				case "research.loops.complete":
					return {
						state: {
							loopKey: params?.loopKey,
							status: params?.stopReason === "cancelled" ? "cancelled" : "completed",
							stopReason: params?.stopReason,
						},
					};
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
		expect(daemonCall).toHaveBeenCalledWith("compression.pack_context", expect.objectContaining({
			text: expect.stringContaining("topic: Bounded run"),
		}));
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
			expect(daemonCall).toHaveBeenCalledWith("research.outcome.record", expect.objectContaining({
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
			}));
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
						}),
					}),
				experimentId: "exp-daemon-1",
			}));
			expect(daemonCall).toHaveBeenCalledWith("research.outcome.record", expect.objectContaining({
				parentSessionId: "sess-parent",
				sessionLineageKey: "lineage-alpha",
				traceMetadata: expect.objectContaining({
					parentSessionId: "sess-parent",
					sessionLineageKey: "lineage-alpha",
					finalizeAction: "reverted",
					workflow: "autoresearch",
				}),
			}));
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
			roundsCompleted: 3,
			stopReason: "no-improvement",
			bestMetric: 0.99,
			bestRoundNumber: 1,
			noImprovementStreak: 2,
			sessionId: "sess-autoresearch",
			sabhaId: "sabha-daemon",
			councilVerdict: "accepted",
			plannerRoute: expect.objectContaining({ routeClass: "coding.deep-reasoning" }),
			executionRoute: expect.objectContaining({ routeClass: "tool.use.flex" }),
		}));
		expect(result.data.rounds).toHaveLength(3);
		expect(daemonCall).toHaveBeenCalledWith("compression.unpack_context", expect.any(Object));
		expect(daemonCall).toHaveBeenCalledWith("compression.normalize_context", expect.any(Object));
		expect(daemonCall.mock.calls.filter(([method]) => method === "research.outcome.record")).toHaveLength(3);
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
			roundsCompleted: 1,
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
			revertedRounds: 0,
			roundsCompleted: 1,
		}));
		expect(summary.rounds).toEqual([
			expect.objectContaining({
				roundNumber: 1,
				decision: "cancelled",
				finalizeAction: "kept",
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

	it("generates a unique runtime loop key when scope.loopKey is omitted", async () => {
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
			hypothesis: "same scoped run should not reuse implicit loop key",
		};

		const first = await executeOvernightResearchLoop({ ...sharedScope }, council, baseline);
		const second = await executeOvernightResearchLoop({ ...sharedScope }, council, baseline);

		expect(first.loopKey).not.toBe(second.loopKey);
		expect(startedLoopKeys).toHaveLength(2);
		expect(startedLoopKeys[0]).not.toBe(startedLoopKeys[1]);
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
		vi.spyOn(recording, "packResearchContext").mockResolvedValue({
			packed: false,
			runtime: null,
			source: "none",
			packedText: "",
			savings: 0,
		});
		vi.spyOn(recording, "recordResearchOutcome").mockResolvedValue({
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
			}),
		]);
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
