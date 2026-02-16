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
import { ChitraguptaDaemon, type ChitraguptaDaemonConfig, type ConsolidationEvent, type DaemonState } from "./chitragupta-daemon.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Health status of the daemon. */
export type DaemonHealth = "healthy" | "degraded" | "crashed" | "stopped";

/** Configuration for the DaemonManager. */
export interface DaemonManagerConfig {
	/** ChitraguptaDaemon configuration. */
	daemon?: Partial<ChitraguptaDaemonConfig>;
	/** Max errors in the window before marking as degraded. Default: 5. */
	errorBudget: number;
	/** Error window duration in ms. Default: 60_000 (1 minute). */
	errorWindowMs: number;
	/** Initial restart delay in ms. Default: 1_000 (1 second). */
	initialRestartDelayMs: number;
	/** Maximum restart delay in ms (cap for exponential backoff). Default: 60_000. */
	maxRestartDelayMs: number;
	/** Max consecutive restart attempts before giving up. Default: 10. */
	maxRestartAttempts: number;
	/** Skill discovery scan interval in ms. Default: 300_000 (5 minutes). */
	skillScanIntervalMs: number;
	/** Whether to enable skill auto-discovery. Default: true. */
	enableSkillSync: boolean;
	/** Directories to scan for skills. Default: []. */
	skillScanPaths: string[];
	/** Whether to auto-approve safe (low-risk, no errors) skills. Default: true. */
	autoApproveSafe: boolean;
}

/** Snapshot of the DaemonManager state. */
export interface DaemonManagerState {
	/** Current health status. */
	health: DaemonHealth;
	/** Underlying daemon state (null if not running). */
	daemon: DaemonState | null;
	/** Total restart count since creation. */
	restartCount: number;
	/** Errors in the current window. */
	errorsInWindow: number;
	/** Time of the last health change. */
	lastHealthChange: string;
	/** Next scheduled skill scan (ISO). */
	nextSkillScan: string | null;
	/** Skills pending approval count. */
	pendingApprovalCount: number;
}

/** Health change event. */
export interface HealthEvent {
	readonly from: DaemonHealth;
	readonly to: DaemonHealth;
	readonly reason: string;
	readonly timestamp: string;
	readonly restartCount: number;
}

/** Skill sync event. */
export interface SkillSyncEvent {
	readonly type: "scan-start" | "scan-complete" | "skill-discovered" | "skill-auto-approved" | "scan-error";
	readonly detail: string;
	readonly timestamp: string;
}

/** Minimal interface for Samiti — avoids hard dependency on @chitragupta/sutra. */
export interface SamitiBroadcaster {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
		},
	): unknown;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MANAGER_CONFIG: DaemonManagerConfig = {
	errorBudget: 5,
	errorWindowMs: 60_000,
	initialRestartDelayMs: 1_000,
	maxRestartDelayMs: 60_000,
	maxRestartAttempts: 10,
	skillScanIntervalMs: 300_000,
	enableSkillSync: true,
	skillScanPaths: [],
	autoApproveSafe: true,
};

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
			this.setHealth("crashed", `Gave up after ${this.consecutiveRestarts} restart attempts`);
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

			// Exponential backoff
			this.currentRestartDelay = Math.min(
				this.currentRestartDelay * 2,
				this.config.maxRestartDelayMs,
			);

			await this.startDaemon();
		}, this.currentRestartDelay);

		if (this.restartTimer.unref) this.restartTimer.unref();
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
			if (this.skillScanTimer && (this.skillScanTimer as any).unref) {
				(this.skillScanTimer as any).unref();
			}
		}, firstScanDelay);

		if (this.skillScanTimer && (this.skillScanTimer as any).unref) {
			(this.skillScanTimer as any).unref();
		}
	}

	private async runSkillScan(): Promise<void> {
		if (!this.running || this.health === "crashed") return;

		this.nextSkillScan = new Date(
			Date.now() + this.config.skillScanIntervalMs,
		).toISOString();

		const timestamp = new Date().toISOString();

		this.emit("skill-sync", {
			type: "scan-start",
			detail: `Scanning ${this.config.skillScanPaths.length} path(s)`,
			timestamp,
		} as SkillSyncEvent);

		try {
			// Lazy-import vidhya-skills to avoid loading at startup
			const { SkillDiscovery } = await import("@chitragupta/vidhya-skills");
			const { ApprovalQueue } = await import("@chitragupta/vidhya-skills");
			const { validateSkill } = await import("@chitragupta/vidhya-skills");
			const { getChitraguptaHome } = await import("@chitragupta/core");

			const home = getChitraguptaHome();
			const queue = new ApprovalQueue(`${home}/approval`);

			const discovery = new SkillDiscovery();
			let discoveredCount = 0;

			for (const scanPath of this.config.skillScanPaths) {
				try {
					const manifests = await discovery.discoverFromDirectory(scanPath);

					for (const manifest of manifests) {
						// Validate
						const validation = validateSkill(manifest);
						const errors = validation.errors.map((e: { message: string }) => e.message);
						const warnings = validation.warnings.map((w: { message: string }) => w.message);

						// Submit to approval queue
						const sourcePath = (manifest.source as any)?.filePath ?? scanPath;
						const req = queue.submit(manifest, sourcePath, {
							validationErrors: errors,
							validationWarnings: warnings,
						});

						// Only count genuinely new discoveries
						if (req.status === "pending") {
							discoveredCount++;
							this.emit("skill-sync", {
								type: "skill-discovered",
								detail: `${manifest.name}@${manifest.version} [${req.riskLevel}]`,
								timestamp: new Date().toISOString(),
							} as SkillSyncEvent);
						}
					}
				} catch (err) {
					this.emit("skill-sync", {
						type: "scan-error",
						detail: `${scanPath}: ${err instanceof Error ? err.message : String(err)}`,
						timestamp: new Date().toISOString(),
					} as SkillSyncEvent);
				}
			}

			// Auto-approve safe skills
			let autoApprovedCount = 0;
			if (this.config.autoApproveSafe) {
				const approved = queue.autoApproveSafe();
				autoApprovedCount = approved.length;

				for (const req of approved) {
					this.emit("skill-sync", {
						type: "skill-auto-approved",
						detail: `${req.manifest.name}@${req.manifest.version}`,
						timestamp: new Date().toISOString(),
					} as SkillSyncEvent);
				}
			}

			this.pendingApprovalCount = queue.pendingCount;

			this.emit("skill-sync", {
				type: "scan-complete",
				detail: `Discovered ${discoveredCount} new, auto-approved ${autoApprovedCount}, ${queue.pendingCount} pending`,
				timestamp: new Date().toISOString(),
			} as SkillSyncEvent);

			// Notify Santhi if there are pending approvals
			if (queue.pendingCount > 0 && this.samiti) {
				try {
					this.samiti.broadcast("#alerts", {
						sender: "daemon-manager",
						severity: "info",
						category: "skill-pending",
						content: `${queue.pendingCount} skill(s) awaiting manual approval`,
						data: {
							pendingCount: queue.pendingCount,
							newDiscovered: discoveredCount,
							autoApproved: autoApprovedCount,
						},
					});
				} catch {
					// Best-effort
				}
			}
		} catch (err) {
			this.emit("skill-sync", {
				type: "scan-error",
				detail: err instanceof Error ? err.message : String(err),
				timestamp: new Date().toISOString(),
			} as SkillSyncEvent);
		}
	}

	/**
	 * Manually trigger a skill scan outside the scheduled interval.
	 */
	async scanSkillsNow(): Promise<void> {
		await this.runSkillScan();
	}
}
