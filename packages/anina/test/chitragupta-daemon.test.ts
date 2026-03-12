import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
					swapnaRuns: [] as Array<{ project: string; sessionIds?: string[] }>,
						researchSummaries: [] as Array<{ id: string; projectPath: string; topic: string; stopReason: string }>,
						researchConsolidationCalls: [] as string[],
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
							currentEpoch: "provider-a:model-a:1536:provider",
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
							scopes: [],
						})),
					}));

				const dayConsolidationMock = () => ({
					consolidateDay: vi.fn(async () => state.dayResult),
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
					listSessionsByDate: () => [],
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
			expect(events.some((event) => event.phase === "deep-sleep:resolve")).toBe(true);
			expect(events.some((event) => event.phase === "deep-sleep:swapna:REPLAY")).toBe(true);
			expect(events.some((event) => event.phase === "deep-sleep:swapna:COMPRESS")).toBe(true);
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

			});
