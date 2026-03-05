/**
 * Scarlett Internal — In-Process Health Guardian.
 *
 * Named after Black Widow fighting from inside — not just guarding the door
 * (ScarlettWatchdog), but monitoring every subsystem within the daemon itself.
 *
 * Runs inside the daemon and probes 4 internal subsystems on a schedule:
 * 1. SmritiDb     — SQLite WAL bloat + integrity check
 * 2. Memory       — V8 heap pressure, GC hint on threshold breach
 * 3. NidraHeart   — Detects stale heartbeat / stuck NidraDaemon state
 * 4. ConsolidationQueue — Consolidation backlog depth in agent.db
 *
 * Each probe:
 *   check()   → ProbeResult  (healthy / warn / critical)
 *   recover() → auto-remediation attempt
 *   emit      → "probe-result" | "recovery-ok" | "recovery-failed"
 *
 * @module scarlett-internal
 */

import { EventEmitter } from "node:events";
import { createLogger } from "@chitragupta/core";

const log = createLogger("daemon:scarlett-internal");

// ─── Probe Types ─────────────────────────────────────────────────────────────

/** Severity of a probe result. */
export type ProbeSeverity = "ok" | "warn" | "critical";

/** Result returned by a probe's check(). */
export interface ProbeResult {
	/** Whether the subsystem is considered healthy. */
	healthy: boolean;
	/** Machine-readable severity label. */
	severity: ProbeSeverity;
	/** Probe name. */
	probe: string;
	/** Structured diagnostic details. */
	details: Record<string, unknown>;
	/** Human-readable summary. */
	summary: string;
	/** Suggested recovery action key, if any. */
	recoveryAction?: string;
}

/** A single subsystem probe interface. */
export interface InternalProbe {
	/** Unique probe name. */
	readonly name: string;
	/** Run a health check and return results. */
	check(): Promise<ProbeResult>;
	/** Attempt recovery for an unhealthy result. */
	recover(result: ProbeResult): Promise<{ ok: boolean; detail: string }>;
}

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

// ─── Duck Types for Injected Dependencies ────────────────────────────────────

/** Minimal interface for NidraDaemon state access. */
export interface NidraLike {
	getNidraSnapshot(): { lastHeartbeat: number; state: string } | null;
}

/** Minimal interface for DatabaseManager. */
export interface DbManagerLike {
	get(name: "agent"): SqliteDbLike;
}

/** Minimal interface for a better-sqlite3 Database. */
export interface SqliteDbLike {
	prepare(sql: string): { all(): unknown[]; get(): unknown };
	pragma(key: string, value?: string | number): unknown;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_POLL_MS = 60_000;

/** WAL page count above which we checkpoint (warn threshold). */
const WAL_WARN_PAGES = 500;
/** WAL page count above which we force RESTART checkpoint (critical). */
const WAL_CRITICAL_PAGES = 2000;
/** Heap usage fraction above which we hint GC. */
const HEAP_WARN_FRACTION = 0.75;
/** Heap usage fraction above which we flag critical. */
const HEAP_CRITICAL_FRACTION = 0.92;
/** NidraDaemon heartbeat age above which we warn (ms). */
const NIDRA_WARN_AGE_MS = 5 * 60_000;
/** NidraDaemon heartbeat age above which we flag critical (ms). */
const NIDRA_CRITICAL_AGE_MS = 15 * 60_000;
/** Consolidation queue depth above which we warn. */
const QUEUE_WARN_DEPTH = 20;
/** Consolidation queue depth above which we flag critical. */
const QUEUE_CRITICAL_DEPTH = 100;

// ─── Probe Implementations ───────────────────────────────────────────────────

/**
 * SmritiDbProbe — monitors SQLite WAL health.
 *
 * Checks WAL page count via `PRAGMA wal_checkpoint` and runs
 * `PRAGMA integrity_check(1)` on warn/critical. Recovers via
 * PASSIVE checkpoint (warn) or RESTART checkpoint (critical).
 */
export class SmritiDbProbe implements InternalProbe {
	readonly name = "smriti-db";
	private readonly getDb: () => DbManagerLike;

	constructor(getDb: () => DbManagerLike) {
		this.getDb = getDb;
	}

	async check(): Promise<ProbeResult> {
		try {
			const db = this.getDb().get("agent") as SqliteDbLike;
			// WAL page count: [busy, log, checkpointed]
			const wal = db.pragma("wal_checkpoint") as unknown[];
			const logPages = typeof wal[1] === "number" ? wal[1] : 0;

			if (logPages >= WAL_CRITICAL_PAGES) {
				const integrity = (db.pragma("integrity_check(1)") as unknown[])[0];
				return {
					healthy: false, severity: "critical", probe: this.name,
					details: { walPages: logPages, integrity },
					summary: `WAL critical: ${logPages} pages unflushed`,
					recoveryAction: "wal-checkpoint-restart",
				};
			}
			if (logPages >= WAL_WARN_PAGES) {
				return {
					healthy: false, severity: "warn", probe: this.name,
					details: { walPages: logPages },
					summary: `WAL elevated: ${logPages} pages`,
					recoveryAction: "wal-checkpoint-passive",
				};
			}
			return {
				healthy: true, severity: "ok", probe: this.name,
				details: { walPages: logPages },
				summary: `WAL healthy (${logPages} pages)`,
			};
		} catch (err) {
			return {
				healthy: false, severity: "critical", probe: this.name,
				details: { error: err instanceof Error ? err.message : String(err) },
				summary: "smriti-db probe threw — DB may be unavailable",
			};
		}
	}

	async recover(result: ProbeResult): Promise<{ ok: boolean; detail: string }> {
		try {
			const db = this.getDb().get("agent") as SqliteDbLike;
			const mode = result.recoveryAction === "wal-checkpoint-restart" ? "RESTART" : "PASSIVE";
			db.pragma(`wal_checkpoint(${mode})`);
			return { ok: true, detail: `WAL checkpoint(${mode}) completed` };
		} catch (err) {
			return { ok: false, detail: err instanceof Error ? err.message : String(err) };
		}
	}
}

/**
 * MemoryPressureProbe — monitors V8 heap usage.
 *
 * Reads process.memoryUsage() and compares heapUsed/heapTotal.
 * Recovery: hints V8 to GC via global.gc() if exposed.
 */
export class MemoryPressureProbe implements InternalProbe {
	readonly name = "memory-pressure";

	async check(): Promise<ProbeResult> {
		const { heapUsed, heapTotal, rss } = process.memoryUsage();
		const fraction = heapUsed / heapTotal;
		const details = {
			heapUsedMB: +(heapUsed / 1_048_576).toFixed(1),
			heapTotalMB: +(heapTotal / 1_048_576).toFixed(1),
			rssMB: +(rss / 1_048_576).toFixed(1),
			fraction: +fraction.toFixed(3),
		};

		if (fraction >= HEAP_CRITICAL_FRACTION) {
			return {
				healthy: false, severity: "critical", probe: this.name, details,
				summary: `Heap critical: ${(fraction * 100).toFixed(0)}% used`,
				recoveryAction: "gc-hint",
			};
		}
		if (fraction >= HEAP_WARN_FRACTION) {
			return {
				healthy: false, severity: "warn", probe: this.name, details,
				summary: `Heap elevated: ${(fraction * 100).toFixed(0)}% used`,
				recoveryAction: "gc-hint",
			};
		}
		return {
			healthy: true, severity: "ok", probe: this.name, details,
			summary: `Heap healthy: ${(fraction * 100).toFixed(0)}% used`,
		};
	}

	async recover(_result: ProbeResult): Promise<{ ok: boolean; detail: string }> {
		// biome-ignore lint/suspicious/noExplicitAny: V8 exposes gc() on global when --expose-gc is set
		const gc = (global as any).gc as (() => void) | undefined;
		if (typeof gc === "function") {
			gc();
			return { ok: true, detail: "GC hint delivered" };
		}
		return { ok: false, detail: "global.gc not exposed — start with --expose-gc to enable" };
	}
}

/**
 * NidraHeartbeatProbe — detects stuck NidraDaemon state.
 *
 * Reads the lastHeartbeat from the NidraSnapshot. If it's stale
 * beyond thresholds, flags warn/critical. Cannot force-wake Nidra
 * (that would break the state machine), but emits attention so the
 * daemon can route an alert to the operator.
 */
export class NidraHeartbeatProbe implements InternalProbe {
	readonly name = "nidra-heartbeat";
	private readonly nidra: NidraLike;

	constructor(nidra: NidraLike) {
		this.nidra = nidra;
	}

	async check(): Promise<ProbeResult> {
		const snapshot = this.nidra.getNidraSnapshot();
		if (!snapshot) {
			return {
				healthy: true, severity: "ok", probe: this.name,
				details: { snapshot: null },
				summary: "Nidra not yet started — no snapshot",
			};
		}

		const ageMs = Date.now() - snapshot.lastHeartbeat;
		const details = {
			state: snapshot.state,
			heartbeatAgeMs: ageMs,
			heartbeatAgeSec: +(ageMs / 1000).toFixed(0),
		};

		if (ageMs >= NIDRA_CRITICAL_AGE_MS) {
			return {
				healthy: false, severity: "critical", probe: this.name, details,
				summary: `Nidra heartbeat stale ${+(ageMs / 60_000).toFixed(1)}min — state: ${snapshot.state}`,
				recoveryAction: "log-attention",
			};
		}
		if (ageMs >= NIDRA_WARN_AGE_MS) {
			return {
				healthy: false, severity: "warn", probe: this.name, details,
				summary: `Nidra heartbeat slow ${+(ageMs / 60_000).toFixed(1)}min — state: ${snapshot.state}`,
				recoveryAction: "log-attention",
			};
		}
		return {
			healthy: true, severity: "ok", probe: this.name, details,
			summary: `Nidra heartbeat fresh (${+(ageMs / 1000).toFixed(0)}s ago), state: ${snapshot.state}`,
		};
	}

	/** Nidra state machine must not be force-interrupted — log only. */
	async recover(result: ProbeResult): Promise<{ ok: boolean; detail: string }> {
		log.warn("Nidra heartbeat attention", { summary: result.summary, details: result.details });
		return { ok: true, detail: `Attention logged — ${result.summary}` };
	}
}

/**
 * ConsolidationQueueProbe — monitors the consolidation backlog.
 *
 * Reads the count of unconsolidated days from agent.db. A deep queue
 * means Nidra is not keeping up. Recovery: emits a structured alert;
 * actual consolidation trigger happens via nidra.consolidateToday().
 */
export class ConsolidationQueueProbe implements InternalProbe {
	readonly name = "consolidation-queue";
	private readonly getDb: () => DbManagerLike;
	private readonly nidra: NidraLike | null;

	constructor(getDb: () => DbManagerLike, nidra?: NidraLike) {
		this.getDb = getDb;
		this.nidra = nidra ?? null;
	}

	async check(): Promise<ProbeResult> {
		try {
			const db = this.getDb().get("agent") as SqliteDbLike;
			const row = db.prepare(
				`SELECT COUNT(*) as cnt FROM day_consolidations WHERE status = 'pending'`,
			).get() as { cnt: number } | null;
			const depth = row?.cnt ?? 0;

			if (depth >= QUEUE_CRITICAL_DEPTH) {
				return {
					healthy: false, severity: "critical", probe: this.name,
					details: { pendingDays: depth },
					summary: `Consolidation queue critical: ${depth} days pending`,
					recoveryAction: "log-attention",
				};
			}
			if (depth >= QUEUE_WARN_DEPTH) {
				return {
					healthy: false, severity: "warn", probe: this.name,
					details: { pendingDays: depth },
					summary: `Consolidation queue elevated: ${depth} days pending`,
					recoveryAction: "log-attention",
				};
			}
			return {
				healthy: true, severity: "ok", probe: this.name,
				details: { pendingDays: depth },
				summary: `Consolidation queue healthy (${depth} pending)`,
			};
		} catch {
			// day_consolidations table may not exist yet (first run)
			return {
				healthy: true, severity: "ok", probe: this.name,
				details: { pendingDays: 0 },
				summary: "Consolidation queue: table not yet initialized",
			};
		}
	}

	async recover(result: ProbeResult): Promise<{ ok: boolean; detail: string }> {
		log.warn("Consolidation queue attention", { summary: result.summary });
		return { ok: true, detail: `Logged: ${result.summary}` };
	}
}

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

/** Lazily imports DatabaseManager singleton — avoids circular dep at module load. */
function defaultGetDb(): DbManagerLike {
	// Dynamic require so the module loads without DB initialization at import time.
	// DatabaseManager.instance() returns the existing singleton (already opened by daemon).
	// biome-ignore lint/style/noRestrictedGlobals: intentional dynamic require
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import bridge
	const { DatabaseManager } = require("@chitragupta/smriti/db") as {
		DatabaseManager: { instance(): DbManagerLike };
	};
	return DatabaseManager.instance();
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
