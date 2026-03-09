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

// Re-export helpers for backward compatibility
export { formatDate } from "./daemon-periodic.js";
export type {
	ChitraguptaDaemonConfig,
	ConsolidationEvent,
	DaemonState,
} from "./chitragupta-daemon-support.js";

interface SwapnaProjectScope {
	project: string;
	sessionIds?: string[];
}

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
	private running = false;
	private startTime = 0;
	private consolidating = false;
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

		if (this.config.backfillOnStartup) {
			this.backfillMissedDays()
				.then(() => this.backfillPeriodicReports())
				.catch((err) => { this.emit("error", err); });
		}
		this.emit("started");
	}

	/** Stop the daemon gracefully. Runs a quick consolidation before shutdown. */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.cronTimer) { clearTimeout(this.cronTimer); this.cronTimer = null; }
		if (this.monthlyTimer) { clearTimeout(this.monthlyTimer); this.monthlyTimer = null; }
		if (this.yearlyTimer) { clearTimeout(this.yearlyTimer); this.yearlyTimer = null; }

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

				// Run Swapna consolidation per project
				const { listSessionsByDate } = await import("@chitragupta/smriti/session-store");
				const sessions = listSessionsByDate(date);
					await this.runSwapnaForProjects(
						[...new Set(sessions.map((s: { project: string }) => s.project))].map((project) => ({ project })),
						date,
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
					const { syncRemoteSemanticMirror } = await import("@chitragupta/smriti");
					const remote = await syncRemoteSemanticMirror({
						levels: ["daily"],
						dates: [date],
					});
					if (remote.status.enabled) {
						this.emit("consolidation", {
							type: "progress",
							date,
							phase: "remote-sync",
							detail: `remote semantic mirror synced ${remote.synced} daily artifacts`,
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

		const sessions = await this.resolveSessionProjects(sessionIds);
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

		const processedSessionIds = await this.runSwapnaForProjects(
			[...projects.entries()].map(([project, scopedSessionIds]) => ({
				project,
				sessionIds: scopedSessionIds,
			})),
			label,
			"deep-sleep:swapna",
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

	private async resolveSessionProjects(sessionIds: readonly string[]): Promise<Array<{ id: string; project: string }>> {
		try {
			const { DatabaseManager } = await import("@chitragupta/smriti");
			const db = DatabaseManager.instance().get("agent");
			const placeholders = sessionIds.map(() => "?").join(",");
			if (!placeholders) return [];
			return db.prepare(
				`SELECT id, project FROM sessions WHERE id IN (${placeholders}) ORDER BY updated_at DESC`,
			).all(...sessionIds) as Array<{ id: string; project: string }>;
		} catch {
			const { listSessions } = await import("@chitragupta/smriti/session-store");
			const wanted = new Set(sessionIds);
			return listSessions()
				.filter((session) => wanted.has(session.id))
				.map((session) => ({ id: session.id, project: session.project }));
		}
	}

	private async runSwapnaForProjects(
		projects: Iterable<SwapnaProjectScope>,
		date: string,
		phasePrefix = "swapna",
	): Promise<string[]> {
		const { SwapnaConsolidation } = await import("@chitragupta/smriti");
		const processedSessionIds: string[] = [];

		for (const scope of projects) {
			const { project, sessionIds } = scope;
			try {
				const swapnaConfig = {
					project,
					sessionIds,
					maxSessionsPerCycle: 50,
					surpriseThreshold: 0.7,
					minPatternFrequency: 3,
					minSequenceLength: 2,
					minSuccessRate: 0.8,
				} as ConstructorParameters<typeof SwapnaConsolidation>[0] & { sessionIds?: string[] };
				const swapna = new SwapnaConsolidation(swapnaConfig);
				await swapna.run((phase: string, progress: number) => {
					this.emit("consolidation", {
						type: "progress",
						date,
						phase: `${phasePrefix}:${phase}`,
						detail: `${project} (${(progress * 100).toFixed(0)}%)`,
					});
				});
				if (sessionIds?.length) processedSessionIds.push(...sessionIds);
			} catch (err) {
				this.emit("consolidation", {
					type: "error",
					date,
					phase: phasePrefix,
					detail: `${project}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}

		return [...new Set(processedSessionIds)];
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
