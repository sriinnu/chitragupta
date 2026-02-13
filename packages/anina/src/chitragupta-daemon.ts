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

		// Backfill missed days on startup
		if (this.config.backfillOnStartup) {
			// Run backfill async — don't block startup
			this.backfillMissedDays().catch((err) => {
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

		// Clear cron timer
		if (this.cronTimer) {
			clearTimeout(this.cronTimer);
			this.cronTimer = null;
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

	// ─── Scheduling ───────────────────────────────────────────────────

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
