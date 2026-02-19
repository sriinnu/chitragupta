/**
 * @chitragupta/anina — Nidra Daemon persistence and timer utilities.
 *
 * SQLite persist/restore for the nidra_state singleton row,
 * timer unref helper, and valid state transitions. All pure
 * functions operating on passed-in state objects.
 */

import { createLogger } from "@chitragupta/core";
import { DatabaseManager } from "@chitragupta/smriti";
import type { NidraState, NidraSnapshot, SvapnaPhase } from "./types.js";

const log = createLogger("nidra");

// ─── Types ───────────────────────────────────────────────────────────────────

/** Progress callback supplied to the dream handler. */
export type DreamProgressFn = (phase: SvapnaPhase, pct: number) => void;

/** Async handler invoked when entering the DREAMING state. */
export type DreamHandler = (progress: DreamProgressFn) => Promise<void>;

/** Async handler invoked when entering the DEEP_SLEEP state. */
export type DeepSleepHandler = () => Promise<void>;

/** Internal daemon state bag passed to persistence functions. */
export interface NidraDaemonState {
	state: NidraState;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart: number | undefined;
	lastConsolidationEnd: number | undefined;
	consolidationPhase: SvapnaPhase | undefined;
	consolidationProgress: number;
	startedAt: number;
	running: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid state transitions. Any state can also jump to LISTENING via interrupt. */
export const VALID_TRANSITIONS: ReadonlyMap<NidraState, NidraState> = new Map([
	["LISTENING", "DREAMING"],
	["DREAMING", "DEEP_SLEEP"],
	["DEEP_SLEEP", "LISTENING"],
]);

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Persist nidra state to the nidra_state singleton row in SQLite. */
export function persistNidraState(s: NidraDaemonState): void {
	try {
		const db = DatabaseManager.instance().get("agent");
		const now = Date.now();
		db.prepare(`
			INSERT OR REPLACE INTO nidra_state
				(id, current_state, last_state_change, last_heartbeat,
				 last_consolidation_start, last_consolidation_end,
				 consolidation_phase, consolidation_progress, updated_at)
			VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			s.state, s.lastStateChange, s.lastHeartbeat,
			s.lastConsolidationStart ?? null, s.lastConsolidationEnd ?? null,
			s.consolidationPhase ?? null, s.consolidationProgress, now,
		);
	} catch (err) {
		log.warn("Failed to persist nidra state", { error: String(err) });
	}
}

/** Restore nidra state from the nidra_state singleton row in SQLite. */
export function restoreNidraState(s: NidraDaemonState): void {
	try {
		const db = DatabaseManager.instance().get("agent");
		const row = db.prepare(
			"SELECT current_state, last_state_change, last_heartbeat, " +
			"last_consolidation_start, last_consolidation_end, " +
			"consolidation_phase, consolidation_progress " +
			"FROM nidra_state WHERE id = 1"
		).get() as {
			current_state: NidraState;
			last_state_change: number;
			last_heartbeat: number;
			last_consolidation_start: number | null;
			last_consolidation_end: number | null;
			consolidation_phase: string | null;
			consolidation_progress: number;
		} | undefined;

		if (row) {
			s.state = row.current_state;
			s.lastStateChange = row.last_state_change;
			s.lastHeartbeat = row.last_heartbeat;
			s.lastConsolidationStart = row.last_consolidation_start ?? undefined;
			s.lastConsolidationEnd = row.last_consolidation_end ?? undefined;
			s.consolidationPhase = row.consolidation_phase as SvapnaPhase | undefined;
			s.consolidationProgress = row.consolidation_progress;
			log.debug(`Restored nidra state: ${s.state}`);
		}
	} catch (err) {
		log.warn("Failed to restore nidra state, starting fresh", { error: String(err) });
		s.state = "LISTENING";
		s.lastStateChange = Date.now();
		s.lastHeartbeat = Date.now();
	}
}

/** Lightweight heartbeat persistence — only updates the timestamp column. */
export function persistHeartbeat(now: number): void {
	try {
		const db = DatabaseManager.instance().get("agent");
		db.prepare(
			"UPDATE nidra_state SET last_heartbeat = ?, updated_at = ? WHERE id = 1"
		).run(now, now);
	} catch {
		// Non-critical — swallow to avoid crashing the heartbeat loop
	}
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/** Build a read-only snapshot of the daemon's current state. */
export function buildNidraSnapshot(s: NidraDaemonState): NidraSnapshot {
	const now = Date.now();
	return {
		state: s.state,
		lastStateChange: s.lastStateChange,
		lastHeartbeat: s.lastHeartbeat,
		lastConsolidationStart: s.lastConsolidationStart,
		lastConsolidationEnd: s.lastConsolidationEnd,
		consolidationPhase: s.consolidationPhase,
		consolidationProgress: s.consolidationProgress,
		uptime: s.running ? now - s.startedAt : 0,
	};
}

// ─── Timer Utility ──────────────────────────────────────────────────────────

/** Unref a timer so it doesn't keep the Node.js process alive. */
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === "object" && timer !== null && "unref" in timer) {
		(timer as NodeJS.Timeout).unref();
	}
}
