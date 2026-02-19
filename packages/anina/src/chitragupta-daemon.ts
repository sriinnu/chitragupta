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
import type { NidraConfig, NidraState } from "./types.js";
import {
	formatDate, scheduleLongTimeout,
	consolidateLastMonth as runMonthlyConsolidation,
	consolidateLastYear as runYearlyConsolidation,
	backfillPeriodicReports as runPeriodicBackfill,
	archiveOldDayFiles as runArchiveOldDayFiles,
} from "./daemon-periodic.js";

// Re-export helpers for backward compatibility
export { formatDate } from "./daemon-periodic.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Daemon configuration. */
export interface ChitraguptaDaemonConfig {
	nidra?: Partial<NidraConfig>;
	/** Hour of day (0-23) to run full consolidation. Default: 2. */
	consolidationHour: number;
	/** Maximum days to backfill on startup. Default: 7. */
	maxBackfillDays: number;
	/** Whether to run consolidation on idle. Default: true. */
	consolidateOnIdle: boolean;
	/** Whether to run backfill on startup. Default: true. */
	backfillOnStartup: boolean;
	/** Hour for monthly consolidation (1st of month). Default: 3. */
	monthlyConsolidationHour: number;
	/** Hour for yearly consolidation (Jan 1). Default: 4. */
	yearlyConsolidationHour: number;
	/** Retain day files for this many months before archiving. Default: 6. */
	dayFileRetentionMonths: number;
}

/** Daemon state snapshot. */
export interface DaemonState {
	running: boolean;
	nidraState: NidraState;
	lastConsolidation: string | null;
	lastBackfill: string | null;
	consolidatedDates: string[];
	uptime: number;
}

/** Consolidation event emitted during processing. */
export interface ConsolidationEvent {
	type: "start" | "progress" | "complete" | "error";
	date: string;
	phase?: string;
	detail?: string;
	durationMs?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ChitraguptaDaemonConfig = {
	consolidationHour: 2,
	maxBackfillDays: 7,
	consolidateOnIdle: true,
	backfillOnStartup: true,
	monthlyConsolidationHour: 3,
	yearlyConsolidationHour: 4,
	dayFileRetentionMonths: 6,
};

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
		this.config = { ...DEFAULT_CONFIG, ...config };
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

	// ─── Consolidation ────────────────────────────────────────────────

	/** Consolidate today's sessions into a day file. */
	async consolidateToday(): Promise<void> {
		await this.consolidateDate(formatDate(new Date()));
	}

	/** Consolidate sessions for a specific date. */
	async consolidateDate(date: string): Promise<void> {
		if (this.consolidating) return;
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

			// Run Svapna consolidation per project
			const { listSessionsByDate } = await import("@chitragupta/smriti/session-store");
			const sessions = listSessionsByDate(date);
			const projects = new Set(sessions.map((s: { project: string }) => s.project));

			for (const project of projects) {
				try {
					const { SvapnaConsolidation } = await import("@chitragupta/smriti/svapna-consolidation");
					const svapna = new SvapnaConsolidation({
						project, maxSessionsPerCycle: 50,
						surpriseThreshold: 0.7, minPatternFrequency: 3,
						minSequenceLength: 2, minSuccessRate: 0.8,
					});
					await svapna.run((phase: string, progress: number) => {
						this.emit("consolidation", {
							type: "progress", date, phase: `svapna:${phase}`,
							detail: `${project} (${(progress * 100).toFixed(0)}%)`,
						});
					});
				} catch (err) {
					this.emit("consolidation", {
						type: "error", date, phase: "svapna",
						detail: `${project}: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			}

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
		}
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
