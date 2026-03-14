/**
 * @chitragupta/anina — Support types and lock helpers for ChitraguptaDaemon.
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { NidraConfig, NidraState } from "./types.js";

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
	/** Minutes between embedding-epoch self-heal checks. Default: 30. */
	semanticEpochRefreshMinutes: number;
	/** Minutes between daemon-owned research dispatch checks. Default: 1. */
	researchDispatchMinutes: number;
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

export const DEFAULT_DAEMON_CONFIG: ChitraguptaDaemonConfig = {
	consolidationHour: 2,
	maxBackfillDays: 7,
	consolidateOnIdle: true,
	backfillOnStartup: true,
	monthlyConsolidationHour: 3,
	yearlyConsolidationHour: 4,
	dayFileRetentionMonths: 6,
	semanticEpochRefreshMinutes: 30,
	researchDispatchMinutes: 1,
};

const CONSOLIDATION_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

function getConsolidationLockPath(date: string): string {
	const safeDate = date.replace(/[^0-9-]/g, "");
	return path.join(getChitraguptaHome(), "consolidation", "locks", `${safeDate}.lock`);
}

function readLockPid(lockPath: string): number | null {
	try {
		const firstLine = fs.readFileSync(lockPath, "utf-8").split("\n")[0]?.trim() ?? "";
		const pid = parseInt(firstLine, 10);
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function acquireDateLock(date: string): (() => void) | null {
	const lockPath = getConsolidationLockPath(date);
	const dir = path.dirname(lockPath);
	fs.mkdirSync(dir, { recursive: true });

	try {
		const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
		fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
		fs.closeSync(fd);
		return () => {
			try {
				fs.unlinkSync(lockPath);
			} catch {
				/* best-effort */
			}
		};
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") return null;
		try {
			const stat = fs.statSync(lockPath);
			const ageMs = Date.now() - stat.mtimeMs;
			if (ageMs <= CONSOLIDATION_LOCK_STALE_MS) return null;
			const holderPid = readLockPid(lockPath);
			if (holderPid !== null && isProcessAlive(holderPid)) return null;
			fs.unlinkSync(lockPath);
			return acquireDateLock(date);
		} catch {
			return null;
		}
	}
}
