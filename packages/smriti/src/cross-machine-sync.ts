/**
 * @chitragupta/smriti — Cross-machine sync for day files + memory files.
 *
 * Sync model:
 * - Export creates a portable JSON snapshot containing `days/` and/or `memory/`.
 * - Import applies the snapshot with explicit conflict strategy (see sync-import.ts).
 * - Default strategy is safe (non-destructive): day-file conflicts are copied to
 *   `sync-conflicts/` and local files are preserved.
 * - Memory conflicts merge entries (local-first, remote deduplicated).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import { getDayFilePath, listDayFiles } from "./day-consolidation.js";

// Re-export importCrossMachineSnapshot from the extracted module so that
// index.ts (and all downstream consumers) continue to work unchanged.
export { importCrossMachineSnapshot } from "./sync-import.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SNAPSHOT_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** The two categories of files tracked by cross-machine sync. */
export type CrossMachineFileKind = "day" | "memory";

/** Conflict-resolution strategy when importing day files. */
export type CrossMachineImportStrategy = "safe" | "preferRemote" | "preferLocal";

/** A single file entry inside a {@link CrossMachineSnapshot}. */
export interface CrossMachineSnapshotFile {
	path: string;
	kind: CrossMachineFileKind;
	content: string;
	sha256: string;
	bytes: number;
	mtimeMs: number;
}

/** Portable JSON snapshot produced by {@link createCrossMachineSnapshot}. */
export interface CrossMachineSnapshot {
	version: 1;
	exportedAt: string;
	source: {
		machine: string;
		platform: string;
		home: string;
	};
	files: CrossMachineSnapshotFile[];
}

/** Options for {@link createCrossMachineSnapshot}. */
export interface CrossMachineSnapshotOptions {
	includeDays?: boolean;
	includeMemory?: boolean;
	maxDays?: number;
}

/** Options for {@link importCrossMachineSnapshot}. */
export interface CrossMachineImportOptions {
	strategy?: CrossMachineImportStrategy;
	dryRun?: boolean;
}

/** Aggregate counters returned after a sync import. */
export interface CrossMachineSyncTotals {
	files: number;
	created: number;
	updated: number;
	merged: number;
	skipped: number;
	conflicts: number;
	errors: number;
}

/** Detailed result of {@link importCrossMachineSnapshot}. */
export interface CrossMachineImportResult {
	importedAt: string;
	sourceExportedAt: string;
	strategy: CrossMachineImportStrategy;
	dryRun: boolean;
	totals: CrossMachineSyncTotals;
	changedPaths: string[];
	conflictPaths: string[];
	errorPaths: string[];
}

/** Summary returned by {@link getCrossMachineSyncStatus}. */
export interface CrossMachineSyncStatus {
	home: string;
	daysCount: number;
	memoryCount: number;
	lastExportAt?: string;
	lastExportPath?: string;
	lastImportAt?: string;
	lastImportSource?: string;
	lastImportTotals?: CrossMachineSyncTotals;
}

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface CrossMachineSyncState {
	lastExportAt?: string;
	lastExportPath?: string;
	lastImportAt?: string;
	lastImportSource?: string;
	lastImportTotals?: CrossMachineSyncTotals;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/** SHA-256 hex digest of a UTF-8 string. */
function sha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Convert an absolute path to a portable POSIX-style relative path
 * anchored at the Chitragupta home directory.
 */
function toPortablePath(absPath: string, home: string): string {
	const rel = path.relative(home, absPath);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new SessionError(`Path escapes Chitragupta home: ${absPath}`);
	}
	return rel.split(path.sep).join("/");
}

/**
 * Recursively list all `.md` files under a memory root directory.
 * Returns an empty array if the directory does not exist.
 */
function listMemoryFiles(memoryRoot: string): string[] {
	if (!fs.existsSync(memoryRoot)) return [];
	const stack = [memoryRoot];
	const files: string[] = [];

	while (stack.length > 0) {
		const current = stack.pop()!;
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".md")) {
				files.push(full);
			}
		}
	}

	return files.sort();
}

/** Read the persisted sync-state JSON, returning `{}` on any failure. */
function readSyncState(home: string): CrossMachineSyncState {
	const statePath = path.join(home, "sync-state.json");
	try {
		if (!fs.existsSync(statePath)) return {};
		const raw = fs.readFileSync(statePath, "utf-8");
		const parsed = JSON.parse(raw) as CrossMachineSyncState;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Patch the persisted sync-state with the provided fields. */
function writeSyncState(home: string, patch: Partial<CrossMachineSyncState>): void {
	const statePath = path.join(home, "sync-state.json");
	const next = { ...readSyncState(home), ...patch };
	fs.mkdirSync(path.dirname(statePath), { recursive: true });
	fs.writeFileSync(statePath, JSON.stringify(next, null, "\t"), "utf-8");
}

/** Runtime assertion that an unknown value is a valid {@link CrossMachineSnapshot}. */
function assertSnapshot(value: unknown): asserts value is CrossMachineSnapshot {
	if (!value || typeof value !== "object") {
		throw new SessionError("Invalid sync snapshot: expected object");
	}
	const snapshot = value as Record<string, unknown>;
	if (snapshot.version !== SNAPSHOT_VERSION) {
		throw new SessionError(`Unsupported sync snapshot version: ${String(snapshot.version)}`);
	}
	if (typeof snapshot.exportedAt !== "string") {
		throw new SessionError("Invalid sync snapshot: missing exportedAt");
	}
	if (!Array.isArray(snapshot.files)) {
		throw new SessionError("Invalid sync snapshot: missing files array");
	}
	for (const file of snapshot.files) {
		if (!file || typeof file !== "object") {
			throw new SessionError("Invalid sync snapshot: file entry must be object");
		}
		const entry = file as Record<string, unknown>;
		if (typeof entry.path !== "string" || !entry.path) {
			throw new SessionError("Invalid sync snapshot: file.path must be non-empty string");
		}
		if (entry.kind !== "day" && entry.kind !== "memory") {
			throw new SessionError(`Invalid sync snapshot: unsupported kind for ${String(entry.path)}`);
		}
		if (typeof entry.content !== "string" || typeof entry.sha256 !== "string") {
			throw new SessionError(`Invalid sync snapshot: content/hash missing for ${entry.path}`);
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Public API — snapshot creation, writing, reading, status           */
/* ------------------------------------------------------------------ */

/**
 * Create a portable cross-machine snapshot of day files and/or memory files.
 *
 * @param options - Controls which categories to include and optional day-file cap.
 * @returns A snapshot object ready for serialisation via {@link writeCrossMachineSnapshot}.
 */
export function createCrossMachineSnapshot(options?: CrossMachineSnapshotOptions): CrossMachineSnapshot {
	const includeDays = options?.includeDays ?? true;
	const includeMemory = options?.includeMemory ?? true;
	if (!includeDays && !includeMemory) {
		throw new SessionError("Snapshot must include at least one category: days or memory");
	}

	const home = getChitraguptaHome();
	const files: CrossMachineSnapshotFile[] = [];

	if (includeDays) {
		let dates = listDayFiles();
		if (typeof options?.maxDays === "number" && Number.isFinite(options.maxDays)) {
			dates = dates.slice(0, Math.max(0, Math.floor(options.maxDays)));
		}
		for (const date of dates) {
			const absPath = getDayFilePath(date);
			if (!fs.existsSync(absPath)) continue;
			try {
				const content = fs.readFileSync(absPath, "utf-8");
				const stat = fs.statSync(absPath);
				files.push({
					path: toPortablePath(absPath, home),
					kind: "day",
					content,
					sha256: sha256(content),
					bytes: Buffer.byteLength(content, "utf-8"),
					mtimeMs: stat.mtimeMs,
				});
			} catch {
				// Skip unreadable files: snapshot is best-effort.
			}
		}
	}

	if (includeMemory) {
		const memoryRoot = path.join(home, "memory");
		for (const absPath of listMemoryFiles(memoryRoot)) {
			try {
				const content = fs.readFileSync(absPath, "utf-8");
				const stat = fs.statSync(absPath);
				files.push({
					path: toPortablePath(absPath, home),
					kind: "memory",
					content,
					sha256: sha256(content),
					bytes: Buffer.byteLength(content, "utf-8"),
					mtimeMs: stat.mtimeMs,
				});
			} catch {
				// Skip unreadable files: snapshot is best-effort.
			}
		}
	}

	return {
		version: SNAPSHOT_VERSION,
		exportedAt: new Date().toISOString(),
		source: {
			machine: os.hostname(),
			platform: `${process.platform}-${process.arch}`,
			home,
		},
		files,
	};
}

/**
 * Serialise a snapshot to disk and update the local sync-state.
 *
 * @param snapshot - The snapshot to write.
 * @param outputPath - Destination file path (parent directories created automatically).
 * @returns The resolved absolute path of the written file.
 */
export function writeCrossMachineSnapshot(snapshot: CrossMachineSnapshot, outputPath: string): string {
	assertSnapshot(snapshot);
	const resolved = path.resolve(outputPath);
	fs.mkdirSync(path.dirname(resolved), { recursive: true });
	fs.writeFileSync(resolved, JSON.stringify(snapshot, null, "\t"), "utf-8");
	writeSyncState(getChitraguptaHome(), {
		lastExportAt: snapshot.exportedAt,
		lastExportPath: resolved,
	});
	return resolved;
}

/**
 * Read and validate a snapshot JSON file from disk.
 *
 * @param snapshotPath - Path to the snapshot JSON file.
 * @returns The validated snapshot object.
 */
export function readCrossMachineSnapshot(snapshotPath: string): CrossMachineSnapshot {
	const resolved = path.resolve(snapshotPath);
	const raw = fs.readFileSync(resolved, "utf-8");
	const parsed = JSON.parse(raw) as unknown;
	assertSnapshot(parsed);
	return parsed;
}

/**
 * Return a summary of the local sync state: file counts, last export/import metadata.
 */
export function getCrossMachineSyncStatus(): CrossMachineSyncStatus {
	const home = getChitraguptaHome();
	const state = readSyncState(home);
	const daysCount = listDayFiles().length;
	const memoryCount = listMemoryFiles(path.join(home, "memory")).length;
	return {
		home,
		daysCount,
		memoryCount,
		...state,
	};
}
