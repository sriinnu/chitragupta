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
						researchDispatchCalls: 0,
						researchDispatchResults: [] as boolean[],
						memoryAppends: [] as Array<{ scope: unknown; entry: string; dedupe?: boolean }>,
						remoteSyncCalls: [] as Array<Record<string, unknown>>,
						semanticEpochRefreshCalls: [] as boolean[],
						semanticEpochRefreshPending: false,
						releaseSemanticEpochRefresh: null as (() => void) | null,
						dayResult: {
							sessionsProcessed: 1,
							filePath: "/tmp/day.md",
							extractedFacts: [] as string[],
							projectCount: 1,
							durationMs: 12,
						},
						lastNidraInstance: null as {
							triggerDeepSleepConsolidation(sessionIds: readonly string[]): Promise<void>;
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
					return { state: "LISTENING" as const };
				}

				async triggerDeepSleepConsolidation(sessionIds: readonly string[]): Promise<void> {
					await this.deepSleepHandler?.(sessionIds);
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
						repairSelectiveReembeddingForResearchScopes: vi.fn(async () => ({
							label: "2026-03-10",
							candidates: 0,
							reembedded: 0,
							scopes: [],
						})),
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
							return {
								processed: scopes.length,
								projects: scopes.length,
								projectPaths: scopes.map((scope) => scope.projectPath),
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
				listResearchLoopSummaries: vi.fn(() => state.researchSummaries),
				syncRemoteSemanticMirror: vi.fn(async (options: Record<string, unknown>) => {
					state.remoteSyncCalls.push(options);
					return { status: { enabled: true }, synced: 1 };
				}),
				consolidateDay: vi.fn(async () => state.dayResult),
				getUnconsolidatedDates: vi.fn(async () => []),
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
				expect(events.some((event) => event.phase === "deep-sleep:resolve")).toBe(true);
				expect(events.some((event) => event.phase === "deep-sleep:swapna:REPLAY")).toBe(true);
				expect(events.some((event) => event.phase === "deep-sleep:swapna:COMPRESS")).toBe(true);
				expect(events.some((event) => event.phase === "deep-sleep:research-refinement")).toBe(true);
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
			expect(events.some((event) => event.detail === "no matching projects for pending sessions")).toBe(true);
		});

				it("runs a semantic epoch refresh once on daemon start", async () => {
			const { ChitraguptaDaemon, state } = await loadSubject();
			daemon = new ChitraguptaDaemon({
				consolidateOnIdle: false,
				backfillOnStartup: false,
			});

			await daemon.start();

					expect(state.semanticEpochRefreshCalls).toEqual([false]);
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

			it("waits for semantic epoch refresh completion before date consolidation starts", async () => {
				const { ChitraguptaDaemon, state } = await loadSubject();
				state.semanticEpochRefreshPending = true;
			daemon = new ChitraguptaDaemon({
				consolidateOnIdle: false,
				backfillOnStartup: false,
			});

			await daemon.start();
			const consolidation = daemon.consolidateDate("2026-03-11");
			await Promise.resolve();
			await Promise.resolve();

			expect(state.semanticEpochRefreshCalls).toEqual([false]);
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
