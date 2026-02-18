/**
 * @chitragupta/smriti — Cross-machine sync for day files + memory files.
 *
 * Sync model:
 * - Export creates a portable JSON snapshot containing `days/` and/or `memory/`.
 * - Import applies the snapshot with explicit conflict strategy.
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

const SNAPSHOT_VERSION = 1 as const;
const ENTRY_SEPARATOR = "\n---\n\n";

export type CrossMachineFileKind = "day" | "memory";
export type CrossMachineImportStrategy = "safe" | "preferRemote" | "preferLocal";

export interface CrossMachineSnapshotFile {
	path: string;
	kind: CrossMachineFileKind;
	content: string;
	sha256: string;
	bytes: number;
	mtimeMs: number;
}

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

export interface CrossMachineSnapshotOptions {
	includeDays?: boolean;
	includeMemory?: boolean;
	maxDays?: number;
}

export interface CrossMachineImportOptions {
	strategy?: CrossMachineImportStrategy;
	dryRun?: boolean;
}

export interface CrossMachineSyncTotals {
	files: number;
	created: number;
	updated: number;
	merged: number;
	skipped: number;
	conflicts: number;
	errors: number;
}

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

interface CrossMachineSyncState {
	lastExportAt?: string;
	lastExportPath?: string;
	lastImportAt?: string;
	lastImportSource?: string;
	lastImportTotals?: CrossMachineSyncTotals;
}

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function toPortablePath(absPath: string, home: string): string {
	const rel = path.relative(home, absPath);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new SessionError(`Path escapes Chitragupta home: ${absPath}`);
	}
	return rel.split(path.sep).join("/");
}

function resolveSnapshotPath(relPath: string, home: string): string {
	const normalizedRel = relPath.replaceAll("\\", "/");
	const abs = path.resolve(home, normalizedRel);
	const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
	if (abs !== home && !abs.startsWith(homeWithSep)) {
		throw new SessionError(`Snapshot path escapes Chitragupta home: ${relPath}`);
	}
	return abs;
}

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

function writeSyncState(home: string, patch: Partial<CrossMachineSyncState>): void {
	const statePath = path.join(home, "sync-state.json");
	const next = { ...readSyncState(home), ...patch };
	fs.mkdirSync(path.dirname(statePath), { recursive: true });
	fs.writeFileSync(statePath, JSON.stringify(next, null, "\t"), "utf-8");
}

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

export function readCrossMachineSnapshot(snapshotPath: string): CrossMachineSnapshot {
	const resolved = path.resolve(snapshotPath);
	const raw = fs.readFileSync(resolved, "utf-8");
	const parsed = JSON.parse(raw) as unknown;
	assertSnapshot(parsed);
	return parsed;
}

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

function writeTextFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

function createConflictPath(conflictRoot: string, relPath: string): string {
	const ext = path.extname(relPath);
	const base = ext ? relPath.slice(0, -ext.length) : relPath;
	const remoteName = `${base}.remote${ext || ".md"}`;
	return path.join(conflictRoot, remoteName);
}

export function importCrossMachineSnapshot(
	source: string | CrossMachineSnapshot,
	options?: CrossMachineImportOptions,
): CrossMachineImportResult {
	const snapshot = typeof source === "string" ? readCrossMachineSnapshot(source) : source;
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
