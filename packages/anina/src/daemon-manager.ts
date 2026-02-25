/**
 * @module daemon-manager
 * @description Self-healing wrapper around ChitraguptaDaemon.
 *
 * "Prana" (प्राण) — the vital breath that keeps the daemon alive.
 * Adds auto-restart, health monitoring, error aggregation, and
 * skill discovery sync to the base daemon.
 *
 * Design:
 * - Wraps ChitraguptaDaemon with a health loop
 * - Exponential backoff on repeated crashes (1s → 2s → 4s → ... → 60s cap)
 * - Error budget: N errors in M seconds → mark as degraded
 * - Skill sync: periodic SkillDiscovery + approval queue on idle
 * - Broadcasts health changes to Samiti #daemon channel
 *
 * @packageDocumentation
 */

import { EventEmitter } from "node:events";
import { ChitraguptaDaemon, type ConsolidationEvent } from "./chitragupta-daemon.js";
import { DEFAULT_MANAGER_CONFIG } from "./daemon-manager-types.js";
import type {
	DaemonHealth,
	DaemonManagerConfig,
	DaemonManagerState,
	HealthEvent,
	SkillSyncEvent,
	SamitiBroadcaster,
} from "./daemon-manager-types.js";
import { executeSkillScan, type SkillSyncContext } from "./daemon-manager-skill-sync.js";

// Re-export types for backward compatibility
export type {
	DaemonHealth,
	DaemonManagerConfig,
	DaemonManagerState,
	HealthEvent,
	SkillSyncEvent,
	SamitiBroadcaster,
} from "./daemon-manager-types.js";

// Re-export skill sync types
export type { SkillSyncContext } from "./daemon-manager-skill-sync.js";

// ─── DaemonManager ──────────────────────────────────────────────────────────

/**
 * Self-healing daemon manager.
 *
 * @example
 * ```ts
 * const manager = new DaemonManager({
 *   skillScanPaths: ["/path/to/skills"],
 * });
 * manager.on("health", (event) => console.log(event));
 * manager.on("skill-sync", (event) => console.log(event));
 * await manager.start();
 * ```
 */
export class DaemonManager extends EventEmitter {
	private config: DaemonManagerConfig;
	private daemon: ChitraguptaDaemon | null = null;
	private samiti: SamitiBroadcaster | null = null;
	private health: DaemonHealth = "stopped";
	private restartCount = 0;
	private consecutiveRestarts = 0;
	private currentRestartDelay: number;
	private errorTimestamps: number[] = [];
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private skillScanTimer: ReturnType<typeof setInterval> | null = null;
	private lastHealthChange = new Date().toISOString();
	private nextSkillScan: string | null = null;
	private pendingApprovalCount = 0;
	private running = false;

	constructor(config?: Partial<DaemonManagerConfig>) {
		super();
		this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
		this.currentRestartDelay = this.config.initialRestartDelayMs;
	}

	/**
	 * Inject a Samiti broadcaster for health event notifications.
	 * Optional — if not set, events are still emitted as usual.
	 */
	setSamiti(samiti: SamitiBroadcaster): void {
		this.samiti = samiti;
	}

	// ─── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start the daemon manager.
	 * Creates and starts the underlying daemon, begins health monitoring.
	 */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.consecutiveRestarts = 0;
		this.currentRestartDelay = this.config.initialRestartDelayMs;

		await this.startDaemon();

		// Start skill sync if enabled
		if (this.config.enableSkillSync && this.config.skillScanPaths.length > 0) {
			this.startSkillSync();
		}
	}

	/**
	 * Stop the daemon manager and underlying daemon.
	 */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		// Clear timers
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.skillScanTimer) {
			clearInterval(this.skillScanTimer);
			this.skillScanTimer = null;
			this.nextSkillScan = null;
		}

		// Stop daemon (remove listeners to prevent leaks)
		if (this.daemon) {
			try {
				this.daemon.removeAllListeners();
				await this.daemon.stop();
			} catch {
				// Best-effort
			}
			this.daemon = null;
		}

		this.setHealth("stopped", "Manager stopped");
	}

	/**
	 * Signal user activity to the daemon.
	 */
	touch(): void {
		this.daemon?.touch();
	}

	/**
	 * Get the current state snapshot.
	 */
	getState(): DaemonManagerState {
		return {
			health: this.health,
			daemon: this.daemon?.getState() ?? null,
			restartCount: this.restartCount,
			errorsInWindow: this.countErrorsInWindow(),
			lastHealthChange: this.lastHealthChange,
			nextSkillScan: this.nextSkillScan,
			pendingApprovalCount: this.pendingApprovalCount,
		};
	}

	// ─── Daemon Lifecycle ─────────────────────────────────────────────

	private async startDaemon(): Promise<void> {
		try {
			this.daemon = new ChitraguptaDaemon(this.config.daemon);

			// Wire consolidation events through
			this.daemon.on("consolidation", (event: ConsolidationEvent) => {
				this.emit("consolidation", event);

				// Track errors
				if (event.type === "error") {
					this.recordError(event.detail ?? "consolidation error");
				}
			});

			// Wire daemon errors
			this.daemon.on("error", (err: Error) => {
				this.recordError(err.message);
			});

			await this.daemon.start();
			this.setHealth("healthy", "Daemon started");
			this.consecutiveRestarts = 0;
			this.currentRestartDelay = this.config.initialRestartDelayMs;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.recordError(msg);
			this.setHealth("crashed", `Start failed: ${msg}`);
			this.scheduleRestart();
		}
	}

	private scheduleRestart(): void {
		if (!this.running) return;

		if (this.consecutiveRestarts >= this.config.maxRestartAttempts) {
			// Exponential cooldown: wait 5 min then try one final self-heal
			this.setHealth("crashed", `Max restarts (${this.consecutiveRestarts}) reached — entering cooldown`);
			this.restartTimer = setTimeout(async () => {
				this.restartTimer = null;
				if (!this.running) return;
				await this.selfHeal();
				this.consecutiveRestarts = 0;
				this.currentRestartDelay = this.config.initialRestartDelayMs;
				await this.startDaemon();
			}, 5 * 60 * 1000); // 5-minute cooldown
			if (this.restartTimer.unref) this.restartTimer.unref();
			return;
		}

		this.restartTimer = setTimeout(async () => {
			this.restartTimer = null;
			if (!this.running) return;

			this.restartCount++;
			this.consecutiveRestarts++;

			// Clean up old daemon (remove listeners to prevent leaks)
			if (this.daemon) {
				try {
					this.daemon.removeAllListeners();
					await this.daemon.stop();
				} catch { /* ignore */ }
				this.daemon = null;
			}

			// Run self-heal diagnostics before restart
			await this.selfHeal();

			// Exponential backoff
			this.currentRestartDelay = Math.min(
				this.currentRestartDelay * 2,
				this.config.maxRestartDelayMs,
			);

			await this.startDaemon();
		}, this.currentRestartDelay);

		if (this.restartTimer.unref) this.restartTimer.unref();
	}

	/**
	 * Run self-healing diagnostics before a restart attempt.
	 * Checks DB integrity, clears stale locks, and reinitializes schema if needed.
	 */
	private async selfHeal(): Promise<void> {
		try {
			const { DatabaseManager } = await import("@chitragupta/smriti");
			const db = DatabaseManager.instance();

			// Check DB integrity
			for (const dbName of ["agent", "graph", "vectors"] as const) {
				try {
					const result = db.get(dbName).pragma("integrity_check") as Array<{ integrity_check: string }>;
					if (result[0]?.integrity_check !== "ok") {
						db.get(dbName).pragma("wal_checkpoint(TRUNCATE)");
					}
				} catch {
					// DB may not be initialized yet
				}
			}

			// Clear stale consolidation locks
			try {
				db.get("agent").prepare(
					`UPDATE nidra_state SET consolidation_phase = NULL, consolidation_progress = 0, updated_at = ? WHERE id = 1`,
				).run(Date.now());
			} catch {
				// nidra_state may not exist
			}

			this.emit("health", {
				from: this.health,
				to: this.health,
				reason: "Self-heal diagnostics completed",
				timestamp: new Date().toISOString(),
				restartCount: this.restartCount,
			} as HealthEvent);

			// Emit dedicated recovery event
			if (this.health === "crashed") {
				this.emit("health-recovered", {
					reason: "Self-heal completed, attempting restart",
					timestamp: new Date().toISOString(),
				});
			}
		} catch {
			// Self-heal is best-effort
		}
	}

	// ─── Error Tracking ───────────────────────────────────────────────

	private recordError(message: string): void {
		const now = Date.now();
		this.errorTimestamps.push(now);

		// Prune old timestamps outside the window
		const cutoff = now - this.config.errorWindowMs;
		this.errorTimestamps = this.errorTimestamps.filter(t => t > cutoff);

		// Check error budget
		if (this.errorTimestamps.length >= this.config.errorBudget) {
			if (this.health === "healthy") {
				this.setHealth("degraded", `Error budget exhausted: ${message}`);
			}
		} else if (this.health === "degraded") {
			// Recover: error rate dropped below budget threshold
			this.setHealth("healthy", "Error rate recovered below budget");
		}

		this.emit("error", new Error(message));
	}

	private countErrorsInWindow(): number {
		const cutoff = Date.now() - this.config.errorWindowMs;
		return this.errorTimestamps.filter(t => t > cutoff).length;
	}

	// ─── Health Management ────────────────────────────────────────────

	private setHealth(newHealth: DaemonHealth, reason: string): void {
		const from = this.health;
		if (from === newHealth) return;

		this.health = newHealth;
		this.lastHealthChange = new Date().toISOString();

		const event: HealthEvent = {
			from,
			to: newHealth,
			reason,
			timestamp: this.lastHealthChange,
			restartCount: this.restartCount,
		};

		this.emit("health", event);

		// Broadcast to Samiti
		this.broadcastHealth(event);
	}

	private broadcastHealth(event: HealthEvent): void {
		if (!this.samiti) return;

		const severity: "info" | "warning" | "critical" =
			event.to === "crashed" ? "critical" :
			event.to === "degraded" ? "warning" : "info";

		try {
			this.samiti.broadcast("#daemon", {
				sender: "daemon-manager",
				severity,
				category: `daemon-${event.to}`,
				content: `Daemon health: ${event.from} → ${event.to}\nReason: ${event.reason}${event.restartCount > 0 ? `\nRestarts: ${event.restartCount}` : ""}`,
				data: event,
			});
		} catch {
			// Best-effort
		}
	}

	// ─── Skill Sync ──────────────────────────────────────────────────

	private startSkillSync(): void {
		// Run first scan after a short delay to let daemon settle
		const firstScanDelay = 5_000;
		this.nextSkillScan = new Date(Date.now() + firstScanDelay).toISOString();

		this.skillScanTimer = setTimeout(() => {
			this.runSkillScan();
			// Then periodic scans
			this.skillScanTimer = setInterval(
				() => this.runSkillScan(),
				this.config.skillScanIntervalMs,
			);
			if (this.skillScanTimer && typeof (this.skillScanTimer as NodeJS.Timeout).unref === "function") {
				(this.skillScanTimer as NodeJS.Timeout).unref();
			}
		}, firstScanDelay);

		if (this.skillScanTimer && typeof (this.skillScanTimer as NodeJS.Timeout).unref === "function") {
			(this.skillScanTimer as NodeJS.Timeout).unref();
		}
	}

	private async runSkillScan(): Promise<void> {
		this.nextSkillScan = new Date(
			Date.now() + this.config.skillScanIntervalMs,
		).toISOString();

		const ctx: SkillSyncContext = {
			emitter: this,
			isRunning: () => this.running,
			getHealth: () => this.health,
			config: this.config,
			samiti: this.samiti,
			setPendingApprovalCount: (count: number) => { this.pendingApprovalCount = count; },
		};

		await executeSkillScan(ctx);
	}

	/**
	 * Manually trigger a skill scan outside the scheduled interval.
	 */
	async scanSkillsNow(): Promise<void> {
		await this.runSkillScan();
	}
}
