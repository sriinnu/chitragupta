/**
 * @chitragupta/daemon — MCP telemetry file utilities.
 *
 * Handles heartbeat scanning, stale/corrupt cleanup, and a lightweight
 * timeline log for telemetry cleanup events.
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";

export interface TelemetryCleanupStats {
	removedStale: number;
	removedCorrupt: number;
	removedOrphan: number;
}

export interface TelemetryScanResult extends TelemetryCleanupStats {
	instances: Record<string, unknown>[];
}

export interface ScanTelemetryOptions {
	staleMs?: number;
	cleanupStale?: boolean;
	cleanupCorrupt?: boolean;
	cleanupOrphan?: boolean;
}

type TelemetryTimelineEventType = "stale_removed" | "corrupt_removed" | "orphan_removed";

interface TelemetryTimelineEvent {
	timestamp: number;
	type: TelemetryTimelineEventType;
	file: string;
	pid: number | null;
	ageMs: number | null;
	reason?: string;
}

const DEFAULT_STALE_MS = 10_000;
const TIMELINE_MAX_LINES = 2_000;
const TIMELINE_PRUNE_SIZE_BYTES = 2 * 1024 * 1024;

/** Get telemetry instances directory path. */
export function getTelemetryInstancesDir(): string {
	return path.join(getChitraguptaHome(), "telemetry", "instances");
}

/** Get telemetry cleanup timeline path (JSONL). */
export function getTelemetryTimelinePath(): string {
	return path.join(getChitraguptaHome(), "telemetry", "timeline.jsonl");
}

/** Compute an FNV-1a fingerprint for instance heartbeat state. */
export function computeTelemetryFingerprint(instances: Record<string, unknown>[]): string {
	const parts = instances.map((i) => `${i.pid}:${i.heartbeatSeq}:${i.state}`).join("|");
	let hash = 0x811c9dc5;
	for (let i = 0; i < parts.length; i++) {
		hash ^= parts.charCodeAt(i);
		hash = (Math.imul(hash, 0x01000193)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/** Read recent telemetry cleanup timeline events (newest first). */
export function readTelemetryTimeline(limit = 100): TelemetryTimelineEvent[] {
	const capped = Math.max(1, Math.min(1_000, Math.trunc(limit)));
	const timelinePath = getTelemetryTimelinePath();
	if (!fs.existsSync(timelinePath)) return [];

	try {
		const raw = fs.readFileSync(timelinePath, "utf-8");
		const lines = raw.split("\n").filter((line) => line.trim().length > 0);
		const tail = lines.slice(-capped);
		const parsed: TelemetryTimelineEvent[] = [];
		for (const line of tail) {
			try {
				parsed.push(JSON.parse(line) as TelemetryTimelineEvent);
			} catch {
				/* skip malformed lines */
			}
		}
		return parsed.reverse();
	} catch {
		return [];
	}
}

/** Scan telemetry instances and optionally clean stale/corrupt/orphan files. */
export function scanTelemetryInstances(options: ScanTelemetryOptions = {}): TelemetryScanResult {
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const cleanupStale = options.cleanupStale ?? false;
	const cleanupCorrupt = options.cleanupCorrupt ?? true;
	const cleanupOrphan = options.cleanupOrphan ?? true;
	const dir = getTelemetryInstancesDir();
	if (!fs.existsSync(dir)) {
		return { instances: [], removedStale: 0, removedCorrupt: 0, removedOrphan: 0 };
	}

	const now = Date.now();
	const instances: Record<string, unknown>[] = [];
	let removedStale = 0;
	let removedCorrupt = 0;
	let removedOrphan = 0;

	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) continue;
			const fp = path.join(dir, entry.name);

			let stat: fs.Stats;
			try {
				stat = fs.statSync(fp);
			} catch {
				continue;
			}

			const ageMs = now - stat.mtimeMs;
			if (ageMs > staleMs) {
				if (cleanupStale && unlinkQuietly(fp)) {
					removedStale++;
					appendTelemetryTimelineEvent({
						timestamp: now,
						type: "stale_removed",
						file: entry.name,
						pid: parsePidFromFilename(entry.name),
						ageMs: Math.max(0, Math.trunc(ageMs)),
						reason: `mtime exceeded stale threshold (${staleMs}ms)`,
					});
				}
				continue;
			}

			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>;
			} catch {
				if (cleanupCorrupt && unlinkQuietly(fp)) {
					removedCorrupt++;
					appendTelemetryTimelineEvent({
						timestamp: now,
						type: "corrupt_removed",
						file: entry.name,
						pid: parsePidFromFilename(entry.name),
						ageMs: Math.max(0, Math.trunc(ageMs)),
						reason: "invalid JSON heartbeat payload",
					});
				}
				continue;
			}

			const pid = typeof parsed.pid === "number" ? parsed.pid : parsePidFromFilename(entry.name);
			if (cleanupOrphan && pid !== null && !isPidLikelyAlive(pid) && unlinkQuietly(fp)) {
				removedOrphan++;
				appendTelemetryTimelineEvent({
					timestamp: now,
					type: "orphan_removed",
					file: entry.name,
					pid,
					ageMs: Math.max(0, Math.trunc(ageMs)),
					reason: "heartbeat PID not alive",
				});
				continue;
			}

			instances.push(parsed);
		}
	} catch {
		// Directory unreadable: return what we have so far.
	}

	return { instances, removedStale, removedCorrupt, removedOrphan };
}

function parsePidFromFilename(name: string): number | null {
	const n = Number(name.replace(/\.json$/i, ""));
	return Number.isInteger(n) && n > 0 ? n : null;
}

function isPidLikelyAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// EPERM means process exists but permission denied.
		if (code === "EPERM") return true;
		return false;
	}
}

function unlinkQuietly(filePath: string): boolean {
	try {
		fs.unlinkSync(filePath);
		return true;
	} catch {
		return false;
	}
}

function appendTelemetryTimelineEvent(event: TelemetryTimelineEvent): void {
	try {
		const timelinePath = getTelemetryTimelinePath();
		fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
		fs.appendFileSync(timelinePath, JSON.stringify(event) + "\n");
		pruneTimelineIfNeeded(timelinePath);
	} catch {
		// Best-effort timeline write.
	}
}

function pruneTimelineIfNeeded(timelinePath: string): void {
	try {
		const stat = fs.statSync(timelinePath);
		if (stat.size < TIMELINE_PRUNE_SIZE_BYTES) return;
		const lines = fs.readFileSync(timelinePath, "utf-8").split("\n").filter((line) => line.trim().length > 0);
		const kept = lines.slice(-TIMELINE_MAX_LINES);
		fs.writeFileSync(timelinePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
	} catch {
		// Best-effort timeline pruning.
	}
}

