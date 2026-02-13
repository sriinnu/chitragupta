/**
 * @chitragupta/anina — Chitragupta Daemon
 *
 * The always-running background daemon that orchestrates consolidation.
 * Wraps NidraDaemon with calendar-aware scheduling:
 *
 *   - On idle: consolidate today's sessions (incremental)
 *   - On schedule (default 2am): full day consolidation for yesterday
 *   - On startup: consolidate any missed days since last run
 *   - On shutdown: quick consolidation of today
 *
 * The daemon owns the Nidra → Svapna → Vasana pipeline:
 *   1. Nidra (idle detection) triggers DREAMING state
 *   2. Svapna (5-phase consolidation) processes sessions
 *   3. Day file writer merges sessions into diary entry
 *   4. Vasana (pattern detection) crystallizes behaviors
 */

import { EventEmitter } from "node:events";
import { NidraDaemon } from "./nidra-daemon.js";
import type { NidraConfig, NidraState } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Daemon configuration. */
export interface ChitraguptaDaemonConfig {
	/** Nidra configuration overrides. */
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
 * // ... daemon runs in background ...
 * await daemon.stop();
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

	/**
	 * Start the daemon.
	 * Initializes Nidra, schedules consolidation, and optionally backfills.
	 */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.startTime = Date.now();

		// Start Nidra daemon for idle detection
		this.nidra = new NidraDaemon(this.config.nidra);

		// Wire up Nidra dream handler — consolidate today on idle
		this.nidra.onDream(async (_progress) => {
			if (this.config.consolidateOnIdle) {
				await this.consolidateToday();
			}
		});

		// NidraDaemon.start() is synchronous
		this.nidra.start();

		// Schedule daily consolidation
		this.scheduleDailyCron();

		// Schedule monthly/yearly consolidation
		this.scheduleMonthlyConsolidation();
		this.scheduleYearlyConsolidation();

		// Backfill missed days on startup
		if (this.config.backfillOnStartup) {
			// Run backfill async — don't block startup
			this.backfillMissedDays()
				.then(() => this.backfillPeriodicReports())
				.catch((err) => {
					this.emit("error", err);
				});
		}

		this.emit("started");
	}

	/**
	 * Stop the daemon gracefully.
	 * Runs a quick consolidation of today before shutting down.
	 */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		// Clear cron timers
		if (this.cronTimer) {
			clearTimeout(this.cronTimer);
			this.cronTimer = null;
		}
		if (this.monthlyTimer) {
			clearTimeout(this.monthlyTimer);
			this.monthlyTimer = null;
		}
		if (this.yearlyTimer) {
			clearTimeout(this.yearlyTimer);
			this.yearlyTimer = null;
		}

		// Quick consolidation of today on shutdown
		try {
			await this.consolidateToday();
		} catch {
			// Best-effort on shutdown
		}

		// Stop Nidra
		if (this.nidra) {
			await this.nidra.stop();
			this.nidra = null;
		}

		this.emit("stopped");
	}

	/**
	 * Signal user activity (resets idle timer).
	 */
	touch(): void {
		this.nidra?.touch();
	}

	/**
	 * Get current daemon state.
	 */
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

	/**
	 * Consolidate today's sessions into a day file.
	 */
	async consolidateToday(): Promise<void> {
		const today = this.formatDate(new Date());
		await this.consolidateDate(today);
	}

	/**
	 * Consolidate sessions for a specific date.
	 */
	async consolidateDate(date: string): Promise<void> {
		if (this.consolidating) return; // Prevent concurrent consolidation
		this.consolidating = true;

		const event: ConsolidationEvent = { type: "start", date };
		this.emit("consolidation", event);

		try {
			// Phase 1: Write day file (diary)
			const { consolidateDay } = await import("@chitragupta/smriti/day-consolidation");
			const result = await consolidateDay(date, { force: true });

			this.emit("consolidation", {
				type: "progress",
				date,
				phase: "day-file",
				detail: `${result.sessionsProcessed} sessions → ${result.filePath}`,
			});

			if (result.sessionsProcessed === 0) {
				this.emit("consolidation", { type: "complete", date, detail: "no sessions" });
				return;
			}

			// Phase 2: Run Svapna consolidation per project
			const { listSessionsByDate } = await import("@chitragupta/smriti/session-store");
			const sessions = listSessionsByDate(date);
			const projects = new Set(sessions.map((s: { project: string }) => s.project));

			for (const project of projects) {
				try {
					const { SvapnaConsolidation } = await import("@chitragupta/smriti/svapna-consolidation");
					const svapna = new SvapnaConsolidation({
						project,
						maxSessionsPerCycle: 50,
						surpriseThreshold: 0.7,
						minPatternFrequency: 3,
						minSequenceLength: 2,
						minSuccessRate: 0.8,
					});
					await svapna.run((phase: string, progress: number) => {
						this.emit("consolidation", {
							type: "progress",
							date,
							phase: `svapna:${phase}`,
							detail: `${project} (${(progress * 100).toFixed(0)}%)`,
						});
					});
				} catch (err) {
					this.emit("consolidation", {
						type: "error",
						date,
						phase: "svapna",
						detail: `${project}: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			}

			// Phase 3: Persist extracted facts to global memory
			if (result.extractedFacts.length > 0) {
				try {
					const { appendMemory } = await import("@chitragupta/smriti/memory-store");
					for (const fact of result.extractedFacts) {
						await appendMemory({ type: "global" }, `[${date}] ${fact}`);
					}
					this.emit("consolidation", {
						type: "progress",
						date,
						phase: "facts",
						detail: `${result.extractedFacts.length} facts persisted`,
					});
				} catch {
					// Best-effort
				}
			}

			this.consolidatedDates.add(date);
			this.lastConsolidationDate = date;

			this.emit("consolidation", {
				type: "complete",
				date,
				durationMs: result.durationMs,
				detail: `${result.sessionsProcessed} sessions, ${result.projectCount} projects`,
			});
		} catch (err) {
			this.emit("consolidation", {
				type: "error",
				date,
				detail: err instanceof Error ? err.message : String(err),
			});
		} finally {
			this.consolidating = false;
		}
	}

	/**
	 * Backfill any days that have sessions but no day file.
	 */
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
		} catch {
			return [];
		}
	}

	// ─── Monthly / Yearly Consolidation ──────────────────────────────

	/**
	 * Consolidate last month's data for all projects.
	 */
	async consolidateLastMonth(): Promise<void> {
		const now = new Date();
		const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
		const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

		this.emit("consolidation", { type: "start", date: `monthly-${year}-${String(lastMonth).padStart(2, "0")}` });

		try {
			const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
			const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
			const projectEntries = listSessionProjects();

			for (const entry of projectEntries) {
				try {
					const pc = new PeriodicConsolidation({ project: entry.project });
					if (!pc.hasMonthlyReport(year, lastMonth)) {
						await pc.monthly(year, lastMonth);
						this.emit("consolidation", {
							type: "progress",
							date: `monthly-${year}-${String(lastMonth).padStart(2, "0")}`,
							phase: "monthly",
							detail: entry.project,
						});
					}
				} catch (err) {
					this.emit("consolidation", {
						type: "error",
						date: `monthly-${year}-${String(lastMonth).padStart(2, "0")}`,
						detail: `${entry.project}: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			}

			this.emit("consolidation", {
				type: "complete",
				date: `monthly-${year}-${String(lastMonth).padStart(2, "0")}`,
			});
		} catch (err) {
			this.emit("consolidation", {
				type: "error",
				date: `monthly-${year}-${String(lastMonth).padStart(2, "0")}`,
				detail: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Consolidate last year's data for all projects.
	 */
	async consolidateLastYear(): Promise<void> {
		const lastYear = new Date().getFullYear() - 1;

		this.emit("consolidation", { type: "start", date: `yearly-${lastYear}` });

		try {
			const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
			const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
			const projectEntries = listSessionProjects();

			for (const entry of projectEntries) {
				try {
					const pc = new PeriodicConsolidation({ project: entry.project });
					if (!pc.hasYearlyReport(lastYear)) {
						await pc.yearly(lastYear);
						this.emit("consolidation", {
							type: "progress",
							date: `yearly-${lastYear}`,
							phase: "yearly",
							detail: entry.project,
						});
					}
				} catch (err) {
					this.emit("consolidation", {
						type: "error",
						date: `yearly-${lastYear}`,
						detail: `${entry.project}: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			}

			this.emit("consolidation", {
				type: "complete",
				date: `yearly-${lastYear}`,
			});
		} catch (err) {
			this.emit("consolidation", {
				type: "error",
				date: `yearly-${lastYear}`,
				detail: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Backfill missing periodic reports and vector indices on startup.
	 * Checks last 3 months for missing monthly reports and last year for yearly.
	 */
	async backfillPeriodicReports(): Promise<void> {
		try {
			const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
			const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
			const projectEntries = listSessionProjects();
			const now = new Date();

			for (const entry of projectEntries) {
				const pc = new PeriodicConsolidation({ project: entry.project });

				// Check last 3 months
				for (let i = 1; i <= 3; i++) {
					const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
					const year = d.getFullYear();
					const month = d.getMonth() + 1;
					if (!pc.hasMonthlyReport(year, month)) {
						try {
							await pc.monthly(year, month);
						} catch { /* skip */ }
					}
				}

				// Check last year
				const lastYear = now.getFullYear() - 1;
				if (!pc.hasYearlyReport(lastYear)) {
					try {
						await pc.yearly(lastYear);
					} catch { /* skip */ }
				}
			}

			// Backfill vector indices for all consolidation files
			try {
				const { backfillConsolidationIndices } = await import("@chitragupta/smriti/consolidation-indexer");
				await backfillConsolidationIndices();
			} catch { /* best-effort */ }
		} catch {
			// Best-effort — don't break startup
		}
	}

	// ─── Scheduling ───────────────────────────────────────────────────

	/**
	 * Schedule monthly consolidation: 1st of month at configured hour.
	 */
	private scheduleMonthlyConsolidation(): void {
		if (!this.running) return;

		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth() + 1, 1,
			this.config.monthlyConsolidationHour, 0, 0, 0);

		const msUntil = next.getTime() - now.getTime();

		this.monthlyTimer = setTimeout(async () => {
			if (!this.running) return;
			await this.consolidateLastMonth();
			this.scheduleMonthlyConsolidation(); // Re-schedule
		}, msUntil);

		if (this.monthlyTimer.unref) this.monthlyTimer.unref();
	}

	/**
	 * Schedule yearly consolidation: Jan 1st at configured hour.
	 */
	private scheduleYearlyConsolidation(): void {
		if (!this.running) return;

		const now = new Date();
		const next = new Date(now.getFullYear() + 1, 0, 1,
			this.config.yearlyConsolidationHour, 0, 0, 0);

		const msUntil = next.getTime() - now.getTime();

		this.yearlyTimer = setTimeout(async () => {
			if (!this.running) return;
			await this.consolidateLastYear();
			this.scheduleYearlyConsolidation(); // Re-schedule
		}, msUntil);

		if (this.yearlyTimer.unref) this.yearlyTimer.unref();
	}

	/**
	 * Schedule the next daily consolidation cron.
	 * Calculates ms until the configured hour, then sets a timeout.
	 */
	private scheduleDailyCron(): void {
		if (!this.running) return;

		const now = new Date();
		const next = new Date(now);
		next.setHours(this.config.consolidationHour, 0, 0, 0);

		// If we've already passed the hour today, schedule for tomorrow
		if (next.getTime() <= now.getTime()) {
			next.setDate(next.getDate() + 1);
		}

		const msUntilCron = next.getTime() - now.getTime();

		this.cronTimer = setTimeout(async () => {
			if (!this.running) return;

			// Consolidate yesterday (the full day that just ended)
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			await this.consolidateDate(this.formatDate(yesterday));

			// Re-schedule for next day
			this.scheduleDailyCron();
		}, msUntilCron);

		// Don't block process exit
		if (this.cronTimer.unref) {
			this.cronTimer.unref();
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────

	private formatDate(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = (date.getMonth() + 1).toString().padStart(2, "0");
		const dd = date.getDate().toString().padStart(2, "0");
		return `${yyyy}-${mm}-${dd}`;
	}
}
