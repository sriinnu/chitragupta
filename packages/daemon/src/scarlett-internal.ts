/**
 * Scarlett Internal — In-Process Health Guardian.
 *
 * Named after Black Widow fighting from inside — not just guarding the door
 * (ScarlettWatchdog), but monitoring every subsystem within the daemon itself.
 *
 * Runs inside the daemon and probes internal subsystems on a schedule:
 * 1. SmritiDb     — SQLite WAL bloat + integrity check
 * 2. Memory       — V8 heap pressure, GC hint on threshold breach
 * 3. NidraHeart   — Detects stale heartbeat / stuck NidraDaemon state
 * 4. ConsolidationQueue — Consolidation backlog depth in agent.db
 * 5. SemanticSync — Curated consolidation artifacts mirrored into vectors.db
 *
 * Probe implementations live in scarlett-probes.ts (extracted for LOC limit).
 *
 * @module scarlett-internal
 */

import { EventEmitter } from "node:events";
import { createLogger } from "@chitragupta/core";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import {
	SmritiDbProbe,
	MemoryPressureProbe,
	NidraHeartbeatProbe,
	ConsolidationQueueProbe,
	SemanticSyncProbe,
} from "./scarlett-probes.js";
import type {
	ProbeResult,
	InternalProbe,
	NidraLike,
	DbManagerLike,
} from "./scarlett-probes.js";

// Re-export everything from probes for backward compatibility
export {
	SmritiDbProbe,
	MemoryPressureProbe,
	NidraHeartbeatProbe,
	ConsolidationQueueProbe,
	SemanticSyncProbe,
} from "./scarlett-probes.js";
export type {
	ProbeSeverity,
	ProbeResult,
	InternalProbe,
	NidraLike,
	DbManagerLike,
	SqliteDbLike,
} from "./scarlett-probes.js";

const log = createLogger("daemon:scarlett-internal");

// ─── Events ──────────────────────────────────────────────────────────────────

/** Events emitted by InternalScarlett. */
export interface InternalScarlettEvents {
	"probe-result": [result: ProbeResult];
	"recovery-ok": [probe: string, detail: string];
	"recovery-failed": [probe: string, detail: string];
	"cycle-complete": [results: ProbeResult[], durationMs: number];
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Configuration for InternalScarlett. */
export interface InternalScarlettConfig {
	/** Poll interval in ms (default: 60_000). */
	pollIntervalMs?: number;
	/** Optional NidraDaemon instance for heartbeat probing. */
	nidra?: NidraLike;
	/** Override DatabaseManager factory (for testing). */
	getDb?: () => DbManagerLike;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_POLL_MS = 60_000;

// ─── InternalScarlett ────────────────────────────────────────────────────────

/**
 * In-process health guardian for Chitragupta's internal subsystems.
 *
 * Runs a configurable probe set on a poll interval inside the daemon.
 * On unhealthy results: attempts recovery, emits structured events.
 *
 * @example
 * ```ts
 * const scarlett = new InternalScarlett({ nidra, pollIntervalMs: 60_000 });
 * scarlett.on("probe-result", (r) => log.info("probe", r));
 * scarlett.start();
 * // ...
 * scarlett.stop();
 * ```
 */
export class InternalScarlett extends EventEmitter<InternalScarlettEvents> {
	private readonly config: Required<Omit<InternalScarlettConfig, "nidra" | "getDb">>;
	private readonly probes: InternalProbe[];
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private cycling = false;

	constructor(config: InternalScarlettConfig = {}) {
		super();
		this.config = { pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_MS };

		const getDb = config.getDb ?? defaultGetDb;
		const nidra = config.nidra;

		this.probes = [
			new SmritiDbProbe(getDb),
			new MemoryPressureProbe(),
			new SemanticSyncProbe(),
			...(nidra ? [new NidraHeartbeatProbe(nidra), new ConsolidationQueueProbe(getDb, nidra)] : [new ConsolidationQueueProbe(getDb)]),
		];
	}

	/** Start periodic health polling. */
	start(): void {
		if (this.running) return;
		this.running = true;
		log.info("InternalScarlett started", {
			pollMs: this.config.pollIntervalMs,
			probes: this.probes.map((p) => p.name),
		});

		this.pollTimer = setInterval(() => {
			this.runCycle().catch((err) => {
				log.error("InternalScarlett cycle error", err instanceof Error ? err : undefined);
			});
		}, this.config.pollIntervalMs);

		if (this.pollTimer.unref) this.pollTimer.unref();
	}

	/** Stop polling and clean up. */
	stop(): void {
		if (!this.running) return;
		this.running = false;
		if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
		this.removeAllListeners();
		log.info("InternalScarlett stopped");
	}

	/** Whether polling is active. */
	isRunning(): boolean { return this.running; }

	/**
	 * Run one full probe cycle immediately.
	 * Useful for on-demand health checks (e.g. MCP health_status tool).
	 */
	async runCycle(): Promise<ProbeResult[]> {
		if (this.cycling) return [];
		this.cycling = true;
		const start = Date.now();

		try {
			const results = await Promise.all(this.probes.map((p) => this.runProbe(p)));
			const durationMs = Date.now() - start;
			this.emit("cycle-complete", results, durationMs);

			const unhealthy = results.filter((r) => !r.healthy);
			if (unhealthy.length > 0) {
				log.warn("InternalScarlett: unhealthy probes", {
					count: unhealthy.length,
					probes: unhealthy.map((r) => `${r.probe}(${r.severity})`),
				});
			}

			return results;
		} finally {
			this.cycling = false;
		}
	}

	// ─── Private ─────────────────────────────────────────────────────────

	private async runProbe(probe: InternalProbe): Promise<ProbeResult> {
		let result: ProbeResult;
		try {
			result = await probe.check();
		} catch (err) {
			result = {
				healthy: false, severity: "critical", probe: probe.name,
				details: { error: err instanceof Error ? err.message : String(err) },
				summary: `${probe.name} threw during check`,
			};
		}

		this.emit("probe-result", result);

		if (!result.healthy && result.recoveryAction) {
			try {
				const recovery = await probe.recover(result);
				if (recovery.ok) {
					log.info("Recovery ok", { probe: probe.name, detail: recovery.detail });
					this.emit("recovery-ok", probe.name, recovery.detail);
				} else {
					log.warn("Recovery failed", { probe: probe.name, detail: recovery.detail });
					this.emit("recovery-failed", probe.name, recovery.detail);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log.error("Recovery threw", { probe: probe.name, error: msg });
				this.emit("recovery-failed", probe.name, msg);
			}
		}

		return result;
	}
}

// ─── Default DB accessor ─────────────────────────────────────────────────────

/** Returns the existing DatabaseManager singleton already opened by the daemon. */
function defaultGetDb(): DbManagerLike {
	return DatabaseManager.instance() as unknown as DbManagerLike;
}

// ─── Convenience API ─────────────────────────────────────────────────────────

let activeInternal: InternalScarlett | null = null;

/**
 * Start the InternalScarlett singleton inside the daemon.
 * Safe to call multiple times — returns existing instance if running.
 */
export function startInternalScarlett(config?: InternalScarlettConfig): InternalScarlett {
	if (activeInternal?.isRunning()) return activeInternal;
	activeInternal = new InternalScarlett(config);
	activeInternal.start();
	return activeInternal;
}

/**
 * Stop the active InternalScarlett.
 * No-op if not running.
 */
export function stopInternalScarlett(): void {
	if (activeInternal) { activeInternal.stop(); activeInternal = null; }
}
