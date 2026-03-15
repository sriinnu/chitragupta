import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEMANTIC_EMBEDDING_POLICY_VERSION } from "../../smriti/src/embedding-epoch.js";

function epoch(providerId = "provider-a", modelId = "model-a", dimensions = 1536): string {
	return `${providerId}:${modelId}:${dimensions}:provider:${SEMANTIC_EMBEDDING_POLICY_VERSION}`;
}

describe("ChitraguptaDaemon", () => {
	let daemon: {
		start(): Promise<void>;
		stop(): Promise<void>;
		consolidateDate(date: string): Promise<void>;
		on(event: string, handler: (event: { phase?: string; detail?: string }) => void): void;
	} | undefined;

	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(async () => {
		if (daemon) {
			await daemon.stop();
			daemon = undefined;
		}
	});

			async function loadSubject() {
					const state = {
						resolvedSessions: [] as Array<{ id: string; project: string }>,
						dailySessions: [] as Array<{ id: string; project: string }>,
						swapnaRuns: [] as Array<{ project: string; sessionIds?: string[] }>,
						researchSummaries: [] as Array<{ id: string; projectPath: string; topic: string; stopReason: string }>,
						researchConsolidationCalls: [] as string[],
						researchDailyConsolidationCalls: [] as string[],
						dailyResearchProjectPaths: [] as string[],
						researchSemanticScopes: [] as Array<Array<{ projectPath: string; sessionIds?: string[]; priorityScore?: number }>>,
						researchDigestScopesOverride: null as null | Array<Record<string, unknown>>,
							researchDispatchCalls: 0,
							researchDispatchResults: [] as boolean[],
							queueDrainCalls: [] as Array<Record<string, unknown>>,
							queueUpserts: [] as Array<{ scopes: Array<Record<string, unknown>>; options: Record<string, unknown> }>,
							queueDrainResult: {
								drained: 0,
								repaired: 0,
								deferred: 0,
							remainingDue: 0,
							remoteSynced: 0,
							qualityDeferred: 0,
						},
						queuedDueScopes: 0,
						activeResearchBudget: null as null | {
							refinement: Record<string, unknown>;
							nidra?: Record<string, unknown>;
							source: string;
							expiresAt: number;
							updatedAt: number;
							parseError: null;
						},
						budgetUpserts: [] as Array<Record<string, unknown>>,
						memoryAppends: [] as Array<{ scope: unknown; entry: string; dedupe?: boolean }>,
						remoteSyncCalls: [] as Array<Record<string, unknown>>,
						semanticEpochRefreshCalls: [] as boolean[],
						semanticEpochRefreshPending: false,
						releaseSemanticEpochRefresh: null as (() => void) | null,
						backfillPending: false,
						releaseBackfill: null as (() => void) | null,
						nidraState: "LISTENING" as const,
						dayResult: {
							sessionsProcessed: 1,
							filePath: "/tmp/day.md",
							extractedFacts: [] as string[],
							projectCount: 1,
							durationMs: 12,
						},
						lastNidraInstance: null as {
							triggerDeepSleepConsolidation(sessionIds: readonly string[]): Promise<readonly string[] | void>;
						} | null,
					};

		vi.doMock("../src/nidra-daemon.js", () => {
			class MockNidraDaemon extends EventEmitter {
				private deepSleepHandler: ((sessionIds: readonly string[]) => Promise<void>) | null = null;

				constructor(_config?: unknown) {
					super();
					state.lastNidraInstance = this;
				}

				onDream(_handler: (_progress: unknown) => Promise<void>): void {}

				onDeepSleepConsolidation(handler: (sessionIds: readonly string[]) => Promise<void>): void {
					this.deepSleepHandler = handler;
				}

				start(): void {}

				async stop(): Promise<void> {}

				touch(): void {}

				wake(): void {}

				snapshot() {
					return { state: state.nidraState };
				}

				async triggerDeepSleepConsolidation(sessionIds: readonly string[]): Promise<readonly string[] | void> {
					return await this.deepSleepHandler?.(sessionIds);
				}
			}

			return { NidraDaemon: MockNidraDaemon };
		});

				vi.doMock("@chitragupta/core", () => ({
					getChitraguptaHome: () => "/tmp/chitragupta-daemon-test",
				}));

					vi.doMock("../src/chitragupta-daemon-support.js", async (importOriginal) => {
						const actual = await importOriginal<typeof import("../src/chitragupta-daemon-support.js")>();
						return {
							...actual,
							acquireDateLock: () => () => {},
						};
					});

					vi.doMock("../src/chitragupta-daemon-semantic.js", () => ({
						refreshGlobalSemanticEpochDrift: vi.fn(async (force = false) => {
							state.semanticEpochRefreshCalls.push(force);
							if (state.semanticEpochRefreshPending) {
								await new Promise<void>((resolve) => {
									state.releaseSemanticEpochRefresh = resolve;
								});
							}
							return {
								currentEpoch: epoch(),
								previousEpoch: null,
								reason: force ? "forced" : "bootstrap",
								completed: true,
								refreshed: true,
								repair: {
									plan: { scanned: 3, candidateCount: 1 },
									reembedded: 1,
									remoteSynced: 0,
									qualityDeferred: 0,
								},
							};
						}),
						repairSelectiveReembeddingForDate: vi.fn(async () => ({
							candidates: 0,
							reembedded: 0,
							qualityDeferred: 0,
							scopes: [],
						})),
								repairSelectiveReembeddingForResearchScopes: vi.fn(async (_label: string, scopes: Array<{ projectPath: string; sessionIds?: string[]; priorityScore?: number }>) => {
									state.researchSemanticScopes.push(scopes);
									return {
									label: "2026-03-10",
									candidates: 0,
									reembedded: 0,
									scopes: [],
								};
								}),
					}));

					vi.doMock("../src/chitragupta-daemon-semantic-queue.js", () => ({
						drainQueuedResearchRefinementScopes: vi.fn(async (options: Record<string, unknown>) => {
							state.queueDrainCalls.push(options);
							return state.queueDrainResult;
						}),
					}));

					vi.doMock("../src/chitragupta-daemon-postprocess.js", () => ({
						runDailyDaemonPostprocess: vi.fn(async (date: string) => {
							state.researchDailyConsolidationCalls.push(`loops:${date}`);
							state.researchDailyConsolidationCalls.push(`experiments:${date}`);
							state.researchDailyConsolidationCalls.push(`refinements:${date}`);
								return {
									research: {
										loops: { processed: 0, projects: state.dailyResearchProjectPaths.length },
										experiments: { processed: 0, projects: state.dailyResearchProjectPaths.length },
										refinements: {
											processed: 0,
											projects: state.dailyResearchProjectPaths.length,
											projectPaths: state.dailyResearchProjectPaths,
											scopes: [],
											deferredScopes: [],
										},
										processed: 0,
										projects: state.dailyResearchProjectPaths.length,
										projectPaths: state.dailyResearchProjectPaths,
									},
									semantic: {
										candidates: 0,
										reembedded: 0,
										remoteSynced: 0,
										qualityDeferred: 0,
										scopes: [],
										researchScoped: {
											candidates: 0,
											reembedded: 0,
											remoteSynced: 0,
											qualityDeferred: 0,
											scopes: [],
										},
										epochRefresh: {
											currentEpoch: "epoch:1",
											previousEpoch: null,
											reason: "unchanged",
											completed: true,
											freshnessCompleted: true,
											refreshed: false,
											qualityDebtCount: 0,
											repair: {
												plan: { scanned: 0, candidateCount: 0 },
												reembedded: 0,
												remoteSynced: 0,
												qualityDeferred: 0,
											},
										},
											queuedResearch: {
												drained: 0,
												repaired: 0,
												deferred: 0,
												remainingDue: 0,
												carriedForward: 0,
												remoteSynced: 0,
												qualityDeferred: 0,
										},
									},
									remote: {
										enabled: false,
										synced: 0,
										skippedDueToOutstandingRepair: false,
										sources: {
											dailyRepair: 0,
											researchRepair: 0,
											queuedResearch: 0,
											epochRefresh: 0,
											postprocessSync: 0,
										},
									},
								};
						}),
					}));

					vi.doMock("../src/chitragupta-daemon-swapna.js", async (importOriginal) => {
						const actual = await importOriginal<typeof import("../src/chitragupta-daemon-swapna.js")>();
						return {
							...actual,
							runSwapnaForProjects: vi.fn(async (projects: Iterable<{ project: string; sessionIds?: string[] }>, _date: string, phasePrefix: string, emit: (eventName: "consolidation", event: { phase?: string; detail?: string; type: string; date: string }) => boolean) => {
								const scopes = [...projects];
								for (const scope of scopes) {
									state.swapnaRuns.push({ project: scope.project, sessionIds: scope.sessionIds });
									emit("consolidation", {
										type: "progress",
										date: "2026-03-11",
										phase: `${phasePrefix}:REPLAY`,
										detail: `${scope.project} (50%)`,
									});
									emit("consolidation", {
										type: "progress",
										date: "2026-03-11",
										phase: `${phasePrefix}:COMPRESS`,
										detail: `${scope.project} (100%)`,
									});
								}
								return scopes.flatMap((scope) => scope.sessionIds ?? []);
							}),
						};
					});

						vi.doMock("../src/chitragupta-daemon-research.js", () => ({
							consolidateResearchRefinementDigestsForProjects: vi.fn(async (label: string, scopes: Array<{ projectPath: string; sessionIds?: string[] }>) => {
								state.researchConsolidationCalls.push(`${label}:${scopes.map((scope) => `${scope.projectPath}:${scope.sessionIds?.join(",") ?? ""}`).join("|")}`);
								const digestScopes = state.researchDigestScopesOverride
									? state.researchDigestScopesOverride as Array<{ projectPath: string; sessionIds?: string[]; sessionLineageKeys?: string[]; priorityScore?: number }>
									: scopes.map((scope, index) => ({
										...scope,
										priorityScore: index + 1,
									}));
								return {
									processed: scopes.length,
									projects: scopes.length,
									projectPaths: scopes.map((scope) => scope.projectPath),
									scopes: digestScopes,
								};
							}),
							consolidateResearchLoopSummariesForDate: vi.fn(async (date: string) => {
								state.researchDailyConsolidationCalls.push(`loops:${date}`);
								return { processed: 0, projects: 0, projectPaths: state.dailyResearchProjectPaths };
							}),
							consolidateResearchExperimentsForDate: vi.fn(async (date: string) => {
								state.researchDailyConsolidationCalls.push(`experiments:${date}`);
								return { processed: 0, projects: 0, projectPaths: state.dailyResearchProjectPaths };
							}),
							consolidateResearchRefinementDigestsForDate: vi.fn(async (date: string) => {
								state.researchDailyConsolidationCalls.push(`refinements:${date}`);
								return { processed: 0, projects: 0, projectPaths: state.dailyResearchProjectPaths };
							}),
							}));

						vi.doMock("../src/chitragupta-daemon-research-scheduler.js", () => ({
							dispatchNextQueuedResearchLoop: vi.fn(async () => {
								state.researchDispatchCalls += 1;
								return state.researchDispatchResults.shift() ?? false;
							}),
						}));

				const dayConsolidationMock = () => ({
					consolidateDay: vi.fn(async () => state.dayResult),
					getUnconsolidatedDates: vi.fn(async () => []),
					listDayFiles: vi.fn(async () => []),
					getDayFilePath: vi.fn((date: string) => `/tmp/${date}.md`),
						});
				vi.doMock("@chitragupta/smriti/day-consolidation", dayConsolidationMock);
				vi.doMock("@chitragupta/smriti/day-consolidation.js", dayConsolidationMock);

				vi.doMock("@chitragupta/smriti", () => ({
					DatabaseManager: {
					instance: () => ({
						get: () => ({
						prepare: () => ({
							all: () => state.resolvedSessions,
						}),
						}),
					}),
				},
					appendMemory: vi.fn(async (scope: unknown, entry: string, options?: { dedupe?: boolean }) => {
						state.memoryAppends.push({ scope, entry, dedupe: options?.dedupe });
					}),
					countQueuedResearchRefinementScopes: vi.fn(() => state.queuedDueScopes),
					upsertResearchRefinementQueue: vi.fn((scopes: Array<Record<string, unknown>>, options: Record<string, unknown>) => {
						state.queueUpserts.push({ scopes, options });
						return scopes.length;
					}),
					readActiveResearchRefinementBudget: vi.fn(() => state.activeResearchBudget),
					upsertResearchRefinementBudget: vi.fn((budget: Record<string, unknown>) => {
						state.budgetUpserts.push(budget);
						state.activeResearchBudget = {
						refinement: (budget.refinement as Record<string, unknown>) ?? {},
						nidra: budget.nidra as Record<string, unknown> | undefined,
						source: typeof budget.source === "string" ? budget.source : "test",
						expiresAt: Date.now() + 60_000,
						updatedAt: Date.now(),
						parseError: null,
					};
				}),
				listResearchLoopSummaries: vi.fn(() => state.researchSummaries),
				syncRemoteSemanticMirror: vi.fn(async (options: Record<string, unknown>) => {
					state.remoteSyncCalls.push(options);
					return { status: { enabled: true }, synced: 1 };
				}),
				consolidateDay: vi.fn(async () => state.dayResult),
				getUnconsolidatedDates: vi.fn(async () => {
					if (state.backfillPending) {
						await new Promise<void>((resolve) => {
							state.releaseBackfill = resolve;
						});
					}
					return [];
				}),
				listDayFiles: vi.fn(async () => []),
				getDayFilePath: vi.fn((date: string) => `/tmp/${date}.md`),
				SwapnaConsolidation: class {
						private project: string;
						private sessionIds?: string[];

					constructor(config: { project: string; sessionIds?: string[] }) {
						this.project = config.project;
						this.sessionIds = config.sessionIds;
					}

					async run(onProgress?: (phase: string, progress: number) => void): Promise<void> {
						state.swapnaRuns.push({ project: this.project, sessionIds: this.sessionIds });
						onProgress?.("REPLAY", 0.5);
						onProgress?.("COMPRESS", 1);
					}
				},
			}));

				vi.doMock("@chitragupta/smriti/session-store", () => ({
						listSessions: () => state.resolvedSessions,
						listSessionsByDate: () => state.dailySessions,
					}));

				const mod = await import("../src/chitragupta-daemon.js");
				return {
					ChitraguptaDaemon: mod.ChitraguptaDaemon,
			state,
		};
	}

		it("runs one deep-sleep Swapna pass per affected project", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a" },
			{ id: "s2", project: "/proj-a" },
			{ id: "s3", project: "/proj-b" },
		];

		const events: Array<{ phase?: string; detail?: string }> = [];
		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});
		daemon.on("consolidation", (event) => {
			events.push({ phase: event.phase, detail: event.detail });
		});

			await daemon.start();
				await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1", "s2", "s3"]);

				expect(state.swapnaRuns).toEqual([
					{ project: "/proj-a", sessionIds: ["s1", "s2"] },
					{ project: "/proj-b", sessionIds: ["s3"] },
				]);
					expect(state.researchConsolidationCalls).toEqual([
						"deep-sleep:/proj-a:s1,s2|/proj-b:s3",
					]);
					expect(state.researchSemanticScopes).toEqual([
						[
							{ projectPath: "/proj-b", sessionIds: ["s3"], sessionLineageKeys: [], priorityScore: 2 },
							{ projectPath: "/proj-a", sessionIds: ["s1", "s2"], sessionLineageKeys: [], priorityScore: 1 },
						],
					]);
					expect(events.some((event) => event.phase === "deep-sleep:resolve")).toBe(true);
		expect(events.some((event) => event.phase === "deep-sleep:swapna:REPLAY")).toBe(true);
		expect(events.some((event) => event.phase === "deep-sleep:swapna:COMPRESS")).toBe(true);
		expect(events.some((event) => event.phase === "deep-sleep:research-refinement")).toBe(true);
	});

	it("carries deep-sleep research budgets into the shared daemon refinement envelope", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a" },
			{ id: "s2", project: "/proj-b" },
		];
		state.activeResearchBudget = {
			refinement: {
				dailyCandidateLimit: 2,
				projectCandidateLimit: 2,
				dailyMinMdlScore: 0.55,
				projectMinMdlScore: 0.6,
				dailyMinPriorityScore: 1.5,
				projectMinPriorityScore: 1.8,
				dailyMinSourceSessionCount: 2,
				projectMinSourceSessionCount: 2,
			},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 2,
			},
			source: "existing",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		};
		state.researchDigestScopesOverride = [
			{
				projectPath: "/proj-a",
				sessionIds: ["s1"],
				sessionLineageKeys: [],
				priorityScore: 4.6,
				refinementBudget: {
					dailyCandidateLimit: 7,
					projectCandidateLimit: 5,
					dailyMinMdlScore: 0.42,
					projectMinMdlScore: 0.5,
				},
				nidraBudget: {
					maxSemanticPressure: 5,
				},
			},
			{
				projectPath: "/proj-b",
				sessionIds: ["s2"],
				sessionLineageKeys: [],
				priorityScore: 1.2,
			},
		];

		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});

		await daemon.start();
		await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1", "s2"]);

		expect(state.budgetUpserts).toEqual([
			expect.objectContaining({
				source: "nidra.deep-sleep",
				refinement: expect.objectContaining({
					dailyCandidateLimit: expect.any(Number),
					projectCandidateLimit: expect.any(Number),
					dailyMinMdlScore: 0.42,
					projectMinMdlScore: 0.5,
				}),
				nidra: expect.objectContaining({
					maxResearchProjectsPerCycle: 2,
					maxSemanticPressure: expect.any(Number),
				}),
			}),
		]);
		expect(state.budgetUpserts[0]?.refinement?.dailyCandidateLimit).toBeGreaterThanOrEqual(7);
		expect(state.budgetUpserts[0]?.refinement?.projectCandidateLimit).toBeGreaterThanOrEqual(5);
		expect(state.budgetUpserts[0]?.nidra?.maxSemanticPressure).toBeGreaterThanOrEqual(5);
		expect(state.researchSemanticScopes).toEqual([
			[
				expect.objectContaining({ projectPath: "/proj-a", priorityScore: 4.6 }),
				expect.objectContaining({ projectPath: "/proj-b", priorityScore: 1.2 }),
			],
		]);
		expect(state.queueUpserts).toEqual([]);
	});

	it("does not relabel the shared refinement budget when deep-sleep produced no research digests", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.activeResearchBudget = {
			refinement: {
				dailyCandidateLimit: 5,
				projectCandidateLimit: 4,
			},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 2,
			},
			source: "existing",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		};
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a", sessionLineageKey: "lineage-a" },
		];
		state.researchDigestScopesOverride = [];

		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});

		await daemon.start();
		await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1"]);

		expect(state.budgetUpserts).toEqual([]);
		expect(state.researchSemanticScopes).toEqual([]);
	});

	it("keeps consumed deep-sleep sessions closed while queueing the failed refinement tail", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a", sessionLineageKey: "lineage-a" },
		];
		state.researchDigestScopesOverride = [
			{
				projectPath: "/proj-a",
				sessionIds: ["s1"],
				sessionLineageKeys: ["lineage-a"],
				policyFingerprints: ["policy-a"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["budget-exhausted"],
				primaryStopConditionKinds: ["budget-exhausted"],
				frontierBestScore: 0.91,
				refinementBudget: { dailyCandidateLimit: 5 },
				nidraBudget: { maxResearchProjectsPerCycle: 2 },
				priorityScore: 4.2,
			},
		];
		state.activeResearchBudget = {
			refinement: {},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 2,
			},
			source: "existing",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		};

		const events: Array<{ phase?: string; detail?: string }> = [];
		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});
		daemon.on("consolidation", (event) => {
			events.push({ phase: event.phase, detail: event.detail });
		});

		const semanticModule = await import("../src/chitragupta-daemon-semantic.js");
		vi.mocked(semanticModule.repairSelectiveReembeddingForResearchScopes).mockRejectedValueOnce(
			new Error("semantic deep-sleep repair failed"),
		);

		await daemon.start();
		const consumed = await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1"]);

		expect(consumed).toEqual(["s1"]);
		expect(state.queueUpserts).toContainEqual(expect.objectContaining({
			scopes: [
				expect.objectContaining({
					label: "deep-sleep",
					projectPath: "/proj-a",
					sessionIds: ["s1"],
					sessionLineageKeys: ["lineage-a"],
					policyFingerprints: ["policy-a"],
					primaryObjectiveIds: ["metric-improvement"],
					primaryStopConditionIds: ["budget-exhausted"],
					primaryStopConditionKinds: ["budget-exhausted"],
					frontierBestScore: 0.91,
					refinementBudget: { dailyCandidateLimit: 5 },
					nidraBudget: { maxResearchProjectsPerCycle: 2 },
				}),
			],
			options: expect.objectContaining({
				lastError: "error:nidra-deep-sleep:semantic deep-sleep repair failed",
			}),
		}));
		expect(state.memoryAppends).toContainEqual(expect.objectContaining({
			scope: { type: "global" },
			entry: expect.stringContaining("queuedCarriedForward: 1"),
		}));
		expect(events).toContainEqual(expect.objectContaining({
			phase: "deep-sleep:research-refinement",
			detail: "semantic deep-sleep repair failed",
		}));
	});

	it("queues deep-sleep scopes that exceeded the Nidra project budget for later retry", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = Array.from({ length: 9 }, (_, index) => ({
			id: `s${index + 1}`,
			project: `/proj-${index + 1}`,
			sessionLineageKey: `lineage-${index + 1}`,
		}));
		state.researchDigestScopesOverride = Array.from({ length: 9 }, (_, index) => ({
			projectPath: `/proj-${index + 1}`,
			sessionIds: [`s${index + 1}`],
			sessionLineageKeys: [`lineage-${index + 1}`],
			priorityScore: 10 - index,
		}));

		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});

		await daemon.start();
		await state.lastNidraInstance?.triggerDeepSleepConsolidation(
			Array.from({ length: 9 }, (_, index) => `s${index + 1}`),
		);

		expect(state.researchSemanticScopes).toHaveLength(1);
		expect(state.researchSemanticScopes[0]).toHaveLength(8);
		expect(state.researchSemanticScopes[0]?.some((scope) => scope.projectPath === "/proj-9")).toBe(false);
		expect(state.queueUpserts).toContainEqual({
			scopes: [
				expect.objectContaining({
					label: "deep-sleep",
					projectPath: "/proj-9",
					sessionIds: ["s9"],
					sessionLineageKeys: ["lineage-9"],
				}),
			],
			options: expect.objectContaining({
				lastError: "deferred:nidra-project-budget",
			}),
		});
		expect(state.memoryAppends).toContainEqual(expect.objectContaining({
			scope: { type: "global" },
			entry: expect.stringContaining("## Deep-Sleep Research Backlog [deep-sleep]"),
		}));
		expect(state.memoryAppends).toContainEqual(expect.objectContaining({
			scope: { type: "global" },
			entry: expect.stringContaining("- deferredProjects: /proj-9"),
		}));
	});

	it("queues deep-sleep scopes that still report semantic quality debt", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a", sessionLineageKey: "lineage-a" },
		];
		state.researchDigestScopesOverride = [
			{
				projectPath: "/proj-a",
				sessionIds: ["s1"],
				sessionLineageKeys: ["lineage-a"],
				priorityScore: 4.2,
				refinementBudget: { dailyCandidateLimit: 7 },
			},
		];
		const events: Array<{ phase?: string; detail?: string }> = [];
		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});
		daemon.on("consolidation", (event) => {
			events.push({ phase: event.phase, detail: event.detail });
		});

		const semanticModule = await import("../src/chitragupta-daemon-semantic.js");
		vi.mocked(semanticModule.repairSelectiveReembeddingForResearchScopes).mockResolvedValueOnce({
			label: "deep-sleep",
			candidates: 2,
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 2,
			scopes: [
				{
					projectPath: "/proj-a",
					dailyDates: ["2026-03-14"],
					candidates: 2,
					reembedded: 1,
					remoteSynced: 0,
					qualityDeferred: 2,
				},
			],
		});

		await daemon.start();
		await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1"]);

		expect(state.queueUpserts).toContainEqual({
			scopes: [
				expect.objectContaining({
					label: "deep-sleep",
					projectPath: "/proj-a",
					sessionIds: ["s1"],
					sessionLineageKeys: ["lineage-a"],
					refinementBudget: { dailyCandidateLimit: 7 },
				}),
			],
			options: expect.objectContaining({
				lastError: "quality-deferred:nidra-deep-sleep:2",
			}),
		});
		expect(events).toContainEqual(expect.objectContaining({
			phase: "deep-sleep:research-refinement",
			detail: "queued 0 deferred scopes and 1 quality-debt scopes for retry",
		}));
		expect(state.memoryAppends).toContainEqual(expect.objectContaining({
			scope: { type: "global" },
			entry: expect.stringContaining("- qualityDebtProjects: /proj-a"),
		}));
	});

	it("counts mixed resolved and missing deep-sleep sessions without double-counting processed work", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [
			{ id: "s1", project: "/proj-a", sessionLineageKey: "lineage-a" },
		];

		const events: Array<{ phase?: string; detail?: string }> = [];
		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});
		daemon.on("consolidation", (event) => {
			events.push({ phase: event.phase, detail: event.detail });
		});

		await daemon.start();
		const consumed = await state.lastNidraInstance?.triggerDeepSleepConsolidation(["s1", "missing-session"]);

		expect(consumed).toEqual(["s1"]);
		expect(state.swapnaRuns).toEqual([
			{ project: "/proj-a", sessionIds: ["s1"] },
		]);
		expect(events).toContainEqual(expect.objectContaining({
			phase: "deep-sleep:resolve",
			detail: "1 sessions missing from Smriti",
		}));
		expect(events).toContainEqual(expect.objectContaining({
			phase: "deep-sleep:swapna",
			detail: "1 pending sessions deferred for retry",
		}));
		expect(events).not.toContainEqual(expect.objectContaining({
			phase: "deep-sleep:swapna",
			detail: "2 pending sessions deferred for retry",
		}));
	});

	it("reports unresolved pending sessions without running Swapna", async () => {
		const { ChitraguptaDaemon, state } = await loadSubject();
		state.resolvedSessions = [];

		const events: Array<{ phase?: string; detail?: string }> = [];
		daemon = new ChitraguptaDaemon({
			consolidateOnIdle: false,
			backfillOnStartup: false,
		});
		daemon.on("consolidation", (event) => {
			events.push({ phase: event.phase, detail: event.detail });
		});

			await daemon.start();
			await state.lastNidraInstance?.triggerDeepSleepConsolidation(["missing-session"]);

			expect(state.swapnaRuns).toEqual([]);
			expect(events.some((event) => event.detail === "1 sessions missing from Smriti")).toBe(true);
			expect(events.some((event) => event.detail === "1 pending sessions deferred for retry")).toBe(true);
			expect(events.some((event) => event.detail === "no matching projects for pending sessions")).toBe(true);
		});

				it("runs a semantic epoch refresh once on daemon start", async () => {
			const { ChitraguptaDaemon, state } = await loadSubject();
			daemon = new ChitraguptaDaemon({
				consolidateOnIdle: false,
				backfillOnStartup: false,
			});

			await daemon.start();
			await vi.waitFor(() => {
				expect(state.semanticEpochRefreshCalls).toEqual([false]);
			});
				});

				it("does not drain queued research refinement during periodic semantic refresh without a shared budget", async () => {
					const { ChitraguptaDaemon, state } = await loadSubject();
					const events: Array<{ phase?: string; detail?: string }> = [];
					state.queuedDueScopes = 3;
					daemon = new ChitraguptaDaemon({
						consolidateOnIdle: false,
						backfillOnStartup: false,
					});
					daemon.on("consolidation", (event) => {
						events.push({ phase: event.phase, detail: event.detail });
					});

					await daemon.start();
					await vi.waitFor(() => {
						expect(state.semanticEpochRefreshCalls).toEqual([false]);
					});
					expect(state.queueDrainCalls).toEqual([]);
					expect(events.some((event) => event.detail === "queued research refinement waiting for shared governor (3 due)")).toBe(true);
				});

				it("reuses the shared refinement governor before draining queued research during semantic refresh", async () => {
					const { ChitraguptaDaemon, state } = await loadSubject();
					state.queuedDueScopes = 3;
					state.activeResearchBudget = {
						refinement: {},
						nidra: {
							maxResearchProjectsPerCycle: 2,
							maxSemanticPressure: 8,
						},
						source: "test",
						expiresAt: Date.now() + 60_000,
						updatedAt: Date.now(),
						parseError: null,
					};
					daemon = new ChitraguptaDaemon({
						consolidateOnIdle: false,
						backfillOnStartup: false,
					});

					await daemon.start();
					await vi.waitFor(() => {
						expect(state.queueDrainCalls).toEqual([
							{
								label: expect.any(String),
								limit: 2,
							},
						]);
					});
				});

				it("polls the resident research queue on the configured cadence and stops polling after shutdown", async () => {
					vi.useFakeTimers();
					const { ChitraguptaDaemon, state } = await loadSubject();
					state.researchDispatchResults = [true, false];
					daemon = new ChitraguptaDaemon({
						consolidateOnIdle: false,
						backfillOnStartup: false,
						semanticEpochRefreshMinutes: 0,
						researchDispatchMinutes: 0.001,
					});

					await daemon.start();
					await Promise.resolve();
					await Promise.resolve();
					expect(state.researchDispatchCalls).toBe(0);
					await vi.advanceTimersByTimeAsync(80);
					expect(state.researchDispatchCalls).toBeGreaterThanOrEqual(1);

					const callsBeforeStop = state.researchDispatchCalls;
					await daemon.stop();
					await vi.advanceTimersByTimeAsync(500);

					expect(state.researchDispatchCalls).toBe(callsBeforeStop);
					vi.useRealTimers();
				});

				it("does not dispatch resident research while Nidra is in deep sleep", async () => {
					vi.useFakeTimers();
					const { ChitraguptaDaemon, state } = await loadSubject();
					state.nidraState = "DEEP_SLEEP";
					state.researchDispatchResults = [true];
					daemon = new ChitraguptaDaemon({
						consolidateOnIdle: false,
						backfillOnStartup: false,
						semanticEpochRefreshMinutes: 0,
						researchDispatchMinutes: 0.001,
					});

					await daemon.start();
					await vi.advanceTimersByTimeAsync(80);
					expect(state.researchDispatchCalls).toBe(0);

					state.nidraState = "LISTENING";
					await vi.advanceTimersByTimeAsync(80);
					expect(state.researchDispatchCalls).toBeGreaterThanOrEqual(1);

					await daemon.stop();
					vi.useRealTimers();
				});

				it("does not dispatch resident research while startup backfill is still active", async () => {
					vi.useFakeTimers();
					const { ChitraguptaDaemon, state } = await loadSubject();
					state.backfillPending = true;
					state.researchDispatchResults = [true];
					daemon = new ChitraguptaDaemon({
						consolidateOnIdle: false,
						backfillOnStartup: true,
						semanticEpochRefreshMinutes: 0,
						researchDispatchMinutes: 0.001,
					});

					await daemon.start();
					await vi.advanceTimersByTimeAsync(80);
					expect(state.researchDispatchCalls).toBe(0);

					state.backfillPending = false;
					state.releaseBackfill?.();
					await Promise.resolve();
					await Promise.resolve();
					await vi.advanceTimersByTimeAsync(200);
					await vi.waitFor(() => {
						expect(state.researchDispatchCalls).toBeGreaterThanOrEqual(1);
					});

					await daemon.stop();
					vi.useRealTimers();
				});

			it("waits for semantic epoch refresh completion before date consolidation starts", async () => {
				const { ChitraguptaDaemon, state } = await loadSubject();
				state.semanticEpochRefreshPending = true;
			daemon = new ChitraguptaDaemon({
				consolidateOnIdle: false,
				backfillOnStartup: false,
			});

			await daemon.start();
			const consolidation = daemon.consolidateDate("2026-03-11");
			await vi.waitFor(() => {
				expect(state.semanticEpochRefreshCalls).toEqual([false]);
				expect(typeof state.releaseSemanticEpochRefresh).toBe("function");
			});
			expect(state.swapnaRuns).toEqual([]);

				state.releaseSemanticEpochRefresh?.();
				await consolidation;
			});

			it("runs a targeted same-day Swapna pass for research projects discovered during postprocess", async () => {
				const { ChitraguptaDaemon, state } = await loadSubject();
				state.dayResult = {
					sessionsProcessed: 0,
					filePath: "/tmp/day.md",
					extractedFacts: [],
					projectCount: 0,
					durationMs: 7,
				};
				state.dailyResearchProjectPaths = ["/repo/research-a", "/repo/research-b"];
				daemon = new ChitraguptaDaemon({
					consolidateOnIdle: false,
					backfillOnStartup: false,
				});

				await daemon.start();
				await daemon.consolidateDate("2026-03-11");

				expect(state.swapnaRuns).toEqual([
					{ project: "/repo/research-a", sessionIds: undefined },
					{ project: "/repo/research-b", sessionIds: undefined },
				]);
				expect(state.researchDailyConsolidationCalls).toEqual([
					"loops:2026-03-11",
					"experiments:2026-03-11",
					"refinements:2026-03-11",
				]);
			});

			it("runs the regular day consolidation and then a second targeted research refinement pass", async () => {
				const { ChitraguptaDaemon, state } = await loadSubject();
				state.dailySessions = [
					{ id: "day-session-1", project: "/repo/app" },
					{ id: "day-session-2", project: "/repo/app" },
				];
				state.dayResult = {
					sessionsProcessed: 2,
					filePath: "/tmp/day.md",
					extractedFacts: ["note"],
					projectCount: 1,
					durationMs: 12,
				};
				state.dailyResearchProjectPaths = ["/repo/research-a"];
				daemon = new ChitraguptaDaemon({
					consolidateOnIdle: false,
					backfillOnStartup: false,
				});

				await daemon.start();
				await daemon.consolidateDate("2026-03-11");

				expect(state.swapnaRuns).toEqual([
					{ project: "/repo/app", sessionIds: undefined },
					{ project: "/repo/research-a", sessionIds: undefined },
				]);
				expect(state.researchDailyConsolidationCalls).toEqual([
					"loops:2026-03-11",
					"experiments:2026-03-11",
					"refinements:2026-03-11",
				]);
			});

				});
