/**
 * @chitragupta/anina — Chitragupta Daemon
 *
 * Background daemon that orchestrates consolidation. Wraps NidraDaemon
 * with calendar-aware scheduling:
 *   - On idle: consolidate today's sessions (incremental)
 *   - On schedule (default 2am): full day consolidation for yesterday
 *   - On startup: backfill missed days since last run
 *   - On shutdown: quick consolidation of today
 *
 * Periodic operations (monthly/yearly consolidation, backfill, archive)
 * are in daemon-periodic.ts.
 */

import { EventEmitter } from "node:events";
import { NidraDaemon } from "./nidra-daemon.js";
import type { NidraSnapshot } from "./types.js";
import {
	formatDate, scheduleLongTimeout,
	consolidateLastMonth as runMonthlyConsolidation,
	consolidateLastYear as runYearlyConsolidation,
	backfillPeriodicReports as runPeriodicBackfill,
	archiveOldDayFiles as runArchiveOldDayFiles,
} from "./daemon-periodic.js";
import {
	acquireDateLock,
	DEFAULT_DAEMON_CONFIG,
	type ChitraguptaDaemonConfig,
	type ConsolidationEvent,
	type DaemonState,
} from "./chitragupta-daemon-support.js";
import { runDailyDaemonPostprocess } from "./chitragupta-daemon-postprocess.js";
import {
	resolveSessionProjects,
	runSwapnaForProjects,
	type SwapnaProjectScope,
} from "./chitragupta-daemon-swapna.js";
import { refreshGlobalSemanticEpochDrift } from "./chitragupta-daemon-semantic.js";

export { formatDate } from "./daemon-periodic.js";
export type { ChitraguptaDaemonConfig, ConsolidationEvent, DaemonState } from "./chitragupta-daemon-support.js";

// ─── Daemon ─────────────────────────────────────────────────────────────────

/**
 * Chitragupta Daemon — orchestrates background consolidation.
 *
 * @example
 * ```ts
 * const daemon = new ChitraguptaDaemon({ consolidationHour: 3 });
 * daemon.on("consolidation", (event) => console.log(event));
 * await daemon.start();
 * ```
 */
export class ChitraguptaDaemon extends EventEmitter {
	private config: ChitraguptaDaemonConfig;
	private nidra: NidraDaemon | null = null;
	private cronTimer: ReturnType<typeof setTimeout> | null = null;
	private monthlyTimer: ReturnType<typeof setTimeout> | null = null;
	private yearlyTimer: ReturnType<typeof setTimeout> | null = null;
	private semanticEpochTimer: ReturnType<typeof setInterval> | null = null;
	private semanticRefreshPromise: Promise<void> | null = null;
	private running = false;
	private startTime = 0;
	private consolidating = false;
	private semanticRefreshing = false;
	private lastConsolidationDate: string | null = null;
	private lastBackfillDate: string | null = null;
	private consolidatedDates: Set<string> = new Set();

	constructor(config?: Partial<ChitraguptaDaemonConfig>) {
		super();
		this.config = { ...DEFAULT_DAEMON_CONFIG, ...config };
	}

	// ─── Lifecycle ────────────────────────────────────────────────────

	/** Start the daemon. Initializes Nidra, schedules consolidation, backfills. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.startTime = Date.now();

		this.nidra = new NidraDaemon(this.config.nidra);
		this.nidra.onDream(async (_progress) => {
			if (this.config.consolidateOnIdle) await this.consolidateToday();
		});
		this.nidra.onDeepSleepConsolidation(async (sessionIds) => {
			return this.consolidateProjectsForSessions(sessionIds);
		});
		this.nidra.start();

		this.scheduleDailyCron();
		this.scheduleMonthlyConsolidation();
		this.scheduleYearlyConsolidation();
		this.scheduleSemanticEpochRefresh();

		if (this.config.backfillOnStartup) {
			this.backfillMissedDays()
				.then(() => this.backfillPeriodicReports())
				.catch((err) => { this.emit("error", err); });
		}
		void this.runSemanticEpochRefresh();
		this.emit("started");
	}

	/** Stop the daemon gracefully. Runs a quick consolidation before shutdown. */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.cronTimer) { clearTimeout(this.cronTimer); this.cronTimer = null; }
		if (this.monthlyTimer) { clearTimeout(this.monthlyTimer); this.monthlyTimer = null; }
		if (this.yearlyTimer) { clearTimeout(this.yearlyTimer); this.yearlyTimer = null; }
		if (this.semanticEpochTimer) { clearInterval(this.semanticEpochTimer); this.semanticEpochTimer = null; }

		try { await this.consolidateToday(); } catch { /* best-effort */ }
		if (this.nidra) { await this.nidra.stop(); this.nidra = null; }
		this.emit("stopped");
	}

	/** Signal user activity (resets idle timer). */
	touch(): void { this.nidra?.touch(); }

	/** Register a logical session with Nidra for sleep-cycle accounting. */
	notifySession(sessionId: string): void { this.nidra?.notifySession(sessionId); }

	/** Wake Nidra out of dreaming/deep-sleep state. */
	wake(): void { this.nidra?.wake(); }

	/** Get current daemon state. */
	getState(): DaemonState {
		return {
			running: this.running,
			nidraState: this.nidra?.snapshot().state ?? "LISTENING",
			lastConsolidation: this.lastConsolidationDate,
			lastBackfill: this.lastBackfillDate,
			consolidatedDates: [...this.consolidatedDates],
			uptime: this.running ? Date.now() - this.startTime : 0,
		};
	}

	/** Get a detailed Nidra snapshot (state, phase, progress, heartbeat). */
	getNidraSnapshot(): NidraSnapshot | null {
		return this.nidra?.snapshot() ?? null;
	}

	// ─── Consolidation ────────────────────────────────────────────────

	/** Consolidate today's sessions into a day file. */
	async consolidateToday(): Promise<void> {
		await this.consolidateDate(formatDate(new Date()));
	}

	/** Consolidate sessions for a specific date. */
	async consolidateDate(date: string): Promise<void> {
		if (this.semanticRefreshPromise) {
			await this.semanticRefreshPromise;
		}
		if (this.consolidating) return;
		const releaseDateLock = acquireDateLock(date);
		if (!releaseDateLock) {
			this.emit("consolidation", {
				type: "progress",
				date,
				phase: "lock",
				detail: "skipped: consolidation lock held by another process",
			});
			return;
		}
		this.consolidating = true;
		this.emit("consolidation", { type: "start", date } as ConsolidationEvent);

		try {
			const { consolidateDay } = await import("@chitragupta/smriti/day-consolidation");
			const result = await consolidateDay(date, { force: true });

			this.emit("consolidation", {
				type: "progress", date, phase: "day-file",
				detail: `${result.sessionsProcessed} sessions → ${result.filePath}`,
			});

			if (result.sessionsProcessed === 0) {
				this.emit("consolidation", { type: "complete", date, detail: "no sessions" });
				return;
			}

			// Run Swapna consolidation per project.
			const { listSessionsByDate } = await import("@chitragupta/smriti/session-store");
			const sessions = listSessionsByDate(date);
			await runSwapnaForProjects(
				[...new Set(sessions.map((s: { project: string }) => s.project))].map((project) => ({ project })),
				date,
				"swapna",
				this.emit.bind(this),
			);

			// Persist extracted facts to global memory
					if (result.extractedFacts.length > 0) {
					try {
							const { appendMemory } = await import("@chitragupta/smriti/memory-store");
						for (const fact of result.extractedFacts) {
							await appendMemory({ type: "global" }, `[${date}] ${fact}`);
						}
					this.emit("consolidation", {
						type: "progress", date, phase: "facts",
						detail: `${result.extractedFacts.length} facts persisted`,
					});
						} catch { /* best-effort */ }
					}

			try {
				const postprocess = await runDailyDaemonPostprocess(date);
				if (postprocess.research.processed > 0) {
					this.emit("consolidation", { type: "progress", date, phase: "research-loops", detail: `${postprocess.research.processed} overnight loop summaries across ${postprocess.research.projects} projects` });
				}
				if (postprocess.research.refinements.processed > 0) {
					this.emit("consolidation", {
						type: "progress",
						date,
						phase: "research-refinement",
						detail: `${postprocess.research.refinements.processed} research refinement digests across ${postprocess.research.refinements.projects} projects`,
					});
				}
				if (postprocess.semantic.reembedded > 0) {
					this.emit("consolidation", {
						type: "progress",
						date,
						phase: "semantic-reembed",
						detail: `re-embedded ${postprocess.semantic.reembedded} of ${postprocess.semantic.candidates} stale daily artifacts`,
					});
				}
				if (postprocess.remote.enabled) {
					this.emit("consolidation", {
						type: "progress",
						date,
						phase: "remote-sync",
						detail: `remote semantic mirror synced ${postprocess.remote.synced} daily artifacts`,
					});
				}
			} catch {
				/* best-effort */
			}

				this.consolidatedDates.add(date);
			this.lastConsolidationDate = date;
			this.emit("consolidation", {
				type: "complete", date, durationMs: result.durationMs,
				detail: `${result.sessionsProcessed} sessions, ${result.projectCount} projects`,
			});
		} catch (err) {
			this.emit("consolidation", {
				type: "error", date,
				detail: err instanceof Error ? err.message : String(err),
			});
		} finally {
			this.consolidating = false;
			releaseDateLock();
		}
	}

	private async consolidateProjectsForSessions(sessionIds: readonly string[]): Promise<string[]> {
		if (sessionIds.length === 0) return [];

		const label = "deep-sleep";
		this.emit("consolidation", {
			type: "progress",
			date: label,
			phase: "deep-sleep:resolve",
			detail: `${sessionIds.length} pending sessions`,
		});

		const sessions = await resolveSessionProjects(sessionIds);
		const resolvedIds = new Set(sessions.map((session) => session.id));
		const missingCount = sessionIds.reduce(
			(count, id) => count + (resolvedIds.has(id) ? 0 : 1),
			0,
		);
		const projects = new Map<string, string[]>();

		for (const session of sessions) {
			const existing = projects.get(session.project);
			if (existing) existing.push(session.id);
			else projects.set(session.project, [session.id]);
		}

		if (missingCount > 0) {
			this.emit("consolidation", {
				type: "progress",
				date: label,
				phase: "deep-sleep:resolve",
				detail: `${missingCount} sessions missing from Smriti`,
			});
		}

		if (projects.size === 0) {
			this.emit("consolidation", {
				type: "progress",
				date: label,
				phase: "deep-sleep:resolve",
				detail: "no matching projects for pending sessions",
			});
			return [];
		}

		const processedSessionIds = await runSwapnaForProjects(
			[...projects.entries()].map(([project, scopedSessionIds]) => ({
				project,
				sessionIds: scopedSessionIds,
			})),
			label,
			"deep-sleep:swapna",
			this.emit.bind(this),
		);

		if (processedSessionIds.length !== sessionIds.length) {
			const processed = new Set(processedSessionIds);
			const deferred = sessionIds.filter((id) => !processed.has(id));
			if (deferred.length > 0) {
				this.emit("consolidation", {
					type: "progress",
					date: label,
					phase: "deep-sleep:swapna",
					detail: `${deferred.length} pending sessions deferred for retry`,
				});
			}
		}

		return processedSessionIds;
	}

	/** Backfill any days that have sessions but no day file. */
	async backfillMissedDays(): Promise<string[]> {
		try {
			const { getUnconsolidatedDates } = await import("@chitragupta/smriti/day-consolidation");
			const missed = await getUnconsolidatedDates(this.config.maxBackfillDays);
			for (const date of missed) {
				if (!this.running) break;
				await this.consolidateDate(date);
			}
			this.lastBackfillDate = new Date().toISOString();
			return missed;
		} catch { return []; }
	}

	// ─── Periodic Consolidation (delegated) ──────────────────────────

	/** Consolidate last month's data for all projects. */
	async consolidateLastMonth(): Promise<void> {
		await runMonthlyConsolidation(this.emit.bind(this));
	}

	/** Consolidate last year's data for all projects. */
	async consolidateLastYear(): Promise<void> {
		await runYearlyConsolidation(this.emit.bind(this));
	}

	/** Backfill missing periodic reports and vector indices. */
	async backfillPeriodicReports(): Promise<void> {
		await runPeriodicBackfill(
			this.config, this.emit.bind(this),
			async () => { await this.archiveOldDayFiles(); return 0; },
		);
	}

	/** Archive day files older than the retention window. */
	async archiveOldDayFiles(): Promise<number> {
		return runArchiveOldDayFiles(this.config, this.emit.bind(this));
	}

	// ─── Scheduling ──────────────────────────────────────────────────

	private scheduleSemanticEpochRefresh(): void {
		if (!this.running || this.config.semanticEpochRefreshMinutes <= 0) return;
		const intervalMs = this.config.semanticEpochRefreshMinutes * 60 * 1000;
		this.semanticEpochTimer = setInterval(() => {
			if (!this.running) return;
			void this.runSemanticEpochRefresh();
		}, intervalMs);
		if (this.semanticEpochTimer.unref) this.semanticEpochTimer.unref();
	}

	private async runSemanticEpochRefresh(): Promise<void> {
		if (this.semanticRefreshing || this.consolidating) return;
		this.semanticRefreshing = true;
		const label = formatDate(new Date());
		const refreshPromise = (async () => {
			try {
				const refreshed = await refreshGlobalSemanticEpochDrift(false);
				if (refreshed.refreshed || refreshed.repair.reembedded > 0 || refreshed.repair.remoteSynced > 0) {
					this.emit("consolidation", {
						type: "progress",
						date: label,
						phase: "semantic-epoch-refresh",
						detail: `${refreshed.reason}: reembedded ${refreshed.repair.reembedded}, remote ${refreshed.repair.remoteSynced}${refreshed.completed ? "" : " (partial)"}`,
					});
				}
			} catch (err) {
				this.emit("consolidation", {
					type: "error",
					date: label,
					phase: "semantic-epoch-refresh",
					detail: err instanceof Error ? err.message : String(err),
				});
			} finally {
				this.semanticRefreshing = false;
				this.semanticRefreshPromise = null;
			}
		})();
		this.semanticRefreshPromise = refreshPromise;
		await refreshPromise;
	}

	private scheduleMonthlyConsolidation(): void {
		if (!this.running) return;
		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth() + 1, 1,
			this.config.monthlyConsolidationHour, 0, 0, 0);
		this.monthlyTimer = scheduleLongTimeout(async () => {
			await this.consolidateLastMonth();
			this.scheduleMonthlyConsolidation();
		}, next.getTime(), () => this.running);
	}

	private scheduleYearlyConsolidation(): void {
		if (!this.running) return;
		const now = new Date();
		const next = new Date(now.getFullYear() + 1, 0, 1,
			this.config.yearlyConsolidationHour, 0, 0, 0);
		this.yearlyTimer = scheduleLongTimeout(async () => {
			await this.consolidateLastYear();
			this.scheduleYearlyConsolidation();
		}, next.getTime(), () => this.running);
	}

	private scheduleDailyCron(): void {
		if (!this.running) return;
		const now = new Date();
		const next = new Date(now);
		next.setHours(this.config.consolidationHour, 0, 0, 0);
		if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

		this.cronTimer = setTimeout(async () => {
			if (!this.running) return;
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			await this.consolidateDate(formatDate(yesterday));
			this.scheduleDailyCron();
		}, next.getTime() - now.getTime());
		if (this.cronTimer.unref) this.cronTimer.unref();
	}
}
