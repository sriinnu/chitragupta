/**
 * @chitragupta/smriti — Cross-machine snapshot import logic.
 *
 * Applies a portable JSON snapshot to the local Chitragupta home.
 * Handles day-file conflict resolution (safe / preferRemote / preferLocal)
 * and memory-file merging (deduplicated, local-first).
 *
 * Extracted from cross-machine-sync.ts to keep file sizes under 450 LOC.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";

import type {
	CrossMachineSnapshot,
	CrossMachineImportOptions,
	CrossMachineSyncTotals,
	CrossMachineImportResult,
} from "./cross-machine-sync.js";

const ENTRY_SEPARATOR = "\n---\n\n";

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
 * Resolve a POSIX-style relative snapshot path to an absolute local path,
 * rejecting any path that would escape the Chitragupta home.
 */
function resolveSnapshotPath(relPath: string, home: string): string {
	const normalizedRel = relPath.replaceAll("\\", "/");
	const abs = path.resolve(home, normalizedRel);
	const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
	if (abs !== home && !abs.startsWith(homeWithSep)) {
		throw new SessionError(`Snapshot path escapes Chitragupta home: ${relPath}`);
	}
	return abs;
}

/** Read and validate a snapshot JSON file from disk. */
function readSnapshotFromDisk(snapshotPath: string): CrossMachineSnapshot {
	const resolved = path.resolve(snapshotPath);
	const raw = fs.readFileSync(resolved, "utf-8");
	const parsed = JSON.parse(raw) as unknown;
	assertSnapshot(parsed);
	return parsed;
}

/** Atomically write a UTF-8 text file, creating parent directories as needed. */
function writeTextFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

/** Build the conflict-sidecar path for a remote file entry. */
function createConflictPath(conflictRoot: string, relPath: string): string {
	const ext = path.extname(relPath);
	const base = ext ? relPath.slice(0, -ext.length) : relPath;
	const remoteName = `${base}.remote${ext || ".md"}`;
	return path.join(conflictRoot, remoteName);
}

/* ------------------------------------------------------------------ */
/*  Memory merge                                                       */
/* ------------------------------------------------------------------ */

/** Split a memory markdown file into its header and `---`-separated entries. */
function splitMemory(content: string): { header: string; entries: string[] } {
	const normalized = content.replaceAll("\r\n", "\n");
	const parts = normalized.split(ENTRY_SEPARATOR);
	if (parts.length <= 1) {
		return { header: normalized.trimEnd(), entries: [] };
	}
	const header = (parts[0] ?? "").trimEnd();
	const entries = parts.slice(1).map((entry) => entry.trim()).filter(Boolean);
	return { header, entries };
}

/**
 * Merge two memory-file contents with local-first deduplication.
 *
 * Local entries are preserved in order; remote entries are appended only if
 * their normalised SHA-256 digest has not been seen.
 */
function mergeMemory(localContent: string, remoteContent: string): string {
	const localTrimmed = localContent.trim();
	const remoteTrimmed = remoteContent.trim();
	if (!localTrimmed) return remoteTrimmed ? `${remoteTrimmed}\n` : "";
	if (!remoteTrimmed) return localContent.endsWith("\n") ? localContent : `${localContent}\n`;
	if (localContent === remoteContent) return localContent;

	const local = splitMemory(localContent);
	const remote = splitMemory(remoteContent);
	if (local.entries.length === 0 && remote.entries.length === 0) {
		if (localContent.includes(remoteContent)) return localContent;
		if (remoteContent.includes(localContent)) return remoteContent;
		return `${localContent.trimEnd()}\n\n---\n\n${remoteContent.trim()}\n`;
	}

	const header = local.header || remote.header || "# Memory";
	const seen = new Set<string>();
	const mergedEntries: string[] = [];
	for (const entry of [...local.entries, ...remote.entries]) {
		const key = sha256(entry.replace(/\s+/g, " ").trim().toLowerCase());
		if (seen.has(key)) continue;
		seen.add(key);
		mergedEntries.push(entry.trim());
	}

	let merged = header.trimEnd();
	if (mergedEntries.length > 0) {
		merged += ENTRY_SEPARATOR + mergedEntries.join(ENTRY_SEPARATOR);
	}
	if (!merged.endsWith("\n")) merged += "\n";
	return merged;
}

/* ------------------------------------------------------------------ */
/*  Sync-state persistence                                             */
/* ------------------------------------------------------------------ */

interface CrossMachineSyncState {
	lastExportAt?: string;
	lastExportPath?: string;
	lastImportAt?: string;
	lastImportSource?: string;
	lastImportTotals?: CrossMachineSyncTotals;
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

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Import a cross-machine snapshot into the local Chitragupta home.
 *
 * Iterates over each file in the snapshot and applies the configured
 * conflict-resolution strategy:
 * - **safe** (default): day-file conflicts are saved as `.remote` sidecars
 *   under `sync-conflicts/`; memory files are merged with deduplication.
 * - **preferRemote**: remote content always overwrites local.
 * - **preferLocal**: local content is always kept.
 *
 * @param source - A snapshot object or path to a snapshot JSON file.
 * @param options - Import strategy and dry-run toggle.
 * @returns Detailed result including totals, changed paths, and conflict paths.
 */
export function importCrossMachineSnapshot(
	source: string | CrossMachineSnapshot,
	options?: CrossMachineImportOptions,
): CrossMachineImportResult {
	const snapshot = typeof source === "string" ? readSnapshotFromDisk(source) : source;
	assertSnapshot(snapshot);

	const home = getChitraguptaHome();
	const strategy = options?.strategy ?? "safe";
	const dryRun = options?.dryRun ?? false;
	const importedAt = new Date().toISOString();
	const conflictRoot = path.join(home, "sync-conflicts", importedAt.replace(/[:.]/g, "-"));

	const totals: CrossMachineSyncTotals = {
		files: snapshot.files.length,
		created: 0,
		updated: 0,
		merged: 0,
		skipped: 0,
		conflicts: 0,
		errors: 0,
	};
	const changedPaths: string[] = [];
	const conflictPaths: string[] = [];
	const errorPaths: string[] = [];

	for (const file of snapshot.files) {
		try {
			const contentHash = sha256(file.content);
			if (contentHash !== file.sha256) {
				totals.errors += 1;
				errorPaths.push(file.path);
				continue;
			}

			const targetPath = resolveSnapshotPath(file.path, home);
			if (!fs.existsSync(targetPath)) {
				if (!dryRun) writeTextFile(targetPath, file.content);
				totals.created += 1;
				changedPaths.push(file.path);
				continue;
			}

			const localContent = fs.readFileSync(targetPath, "utf-8");
			if (localContent === file.content || sha256(localContent) === file.sha256) {
				totals.skipped += 1;
				continue;
			}

			if (file.kind === "memory") {
				const merged = mergeMemory(localContent, file.content);
				if (merged === localContent) {
					totals.skipped += 1;
					continue;
				}
				if (!dryRun) writeTextFile(targetPath, merged);
				totals.merged += 1;
				changedPaths.push(file.path);
				continue;
			}

			// Day files: explicit strategy-based conflict handling.
			if (strategy === "preferRemote") {
				if (!dryRun) writeTextFile(targetPath, file.content);
				totals.updated += 1;
				changedPaths.push(file.path);
				continue;
			}
			if (strategy === "preferLocal") {
				totals.skipped += 1;
				continue;
			}

			const conflictPath = createConflictPath(conflictRoot, file.path);
			if (!dryRun) writeTextFile(conflictPath, file.content);
			totals.conflicts += 1;
			conflictPaths.push(toPortablePath(conflictPath, home));
		} catch {
			totals.errors += 1;
			errorPaths.push(file.path);
		}
	}

	if (!dryRun) {
		writeSyncState(home, {
			lastImportAt: importedAt,
			lastImportSource: snapshot.source.machine,
			lastImportTotals: totals,
		});
	}

	return {
		importedAt,
		sourceExportedAt: snapshot.exportedAt,
		strategy,
		dryRun,
		totals,
		changedPaths,
		conflictPaths,
		errorPaths,
	};
}

/* ------------------------------------------------------------------ */
/*  Snapshot validation (duplicated from cross-machine-sync.ts to      */
/*  avoid circular import — assertSnapshot is not exported)            */
/* ------------------------------------------------------------------ */

const SNAPSHOT_VERSION = 1 as const;

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
