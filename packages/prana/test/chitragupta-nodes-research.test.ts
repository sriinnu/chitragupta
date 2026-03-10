import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeContext } from "../src/chitragupta-nodes.js";

const {
	appendMemory,
	packLiveContextText,
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
			case "research.outcome.record":
				return {
					recorded: true,
					memoryScope: "project",
					traceId: "trace-1",
					experimentId: "exp-daemon-1",
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
		appendMemory.mockClear();
		packLiveContextText.mockClear();
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
			]),
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
				}),
			);
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
		expect(recorded.data).toEqual(expect.objectContaining({ source: "fallback", traceId: "trace-fallback" }));
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
