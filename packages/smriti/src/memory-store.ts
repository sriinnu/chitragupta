/**
 * @chitragupta/smriti — Memory store.
 *
 * Manages scoped memory files at ~/.chitragupta/memory/.
 * Memory is stored as plain Markdown files, organized by scope:
 *   - global   -> ~/.chitragupta/memory/global.md
 *   - project  -> ~/.chitragupta/memory/projects/<hash>/project.md
 *   - agent    -> ~/.chitragupta/memory/agents/<agentId>.md
 *   - session  -> stored within the session file itself
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getChitraguptaHome, MemoryError } from "@chitragupta/core";
import type { MemoryScope } from "./types.js";

/**
 * Hash a project path to a short hex string.
 */
function hashProject(projectPath: string): string {
	return crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

/**
 * Get the memory root directory.
 */
function getMemoryRoot(): string {
	return path.join(getChitraguptaHome(), "memory");
}

/**
 * Resolve a MemoryScope to a filesystem path.
 * Returns null for session scope (stored within session files).
 */
function resolveMemoryPath(scope: MemoryScope): string | null {
	const root = getMemoryRoot();

	switch (scope.type) {
		case "global":
			return path.join(root, "global.md");

		case "project":
			return path.join(root, "projects", hashProject(scope.path), "project.md");

		case "agent":
			return path.join(root, "agents", `${scope.agentId}.md`);

		case "session":
			// Session memory is stored within the session file itself
			return null;
	}
}

/**
 * Ensure the parent directory of a file path exists.
 */
function ensureDir(filePath: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------------------------------------------ */
/*  Write-queue serialization                                          */
/* ------------------------------------------------------------------ */

/** Maximum memory file size per scope (bytes). */
const MAX_MEMORY_SIZE = 500_000; // 500 KB

/** Per-scope write queue: chains write operations to prevent races. */
const memoryWriteQueues = new Map<string, Promise<void>>();

function scopeKey(scope: MemoryScope): string {
	switch (scope.type) {
		case "global": return "global";
		case "project": return `project:${scope.path}`;
		case "agent": return `agent:${scope.agentId}`;
		case "session": return `session:${scope.sessionId}`;
	}
}

/**
 * Read the memory content for a given scope.
 *
 * Returns an empty string if the memory file does not exist.
 *
 * @param scope - The memory scope to read (global, project, or agent).
 * @returns The file content as a UTF-8 string, or empty string if missing.
 * @throws {MemoryError} If scope is `"session"` (use `loadSession()` instead).
 * @throws {MemoryError} If the file exists but cannot be read.
 */
export function getMemory(scope: MemoryScope): string {
	if (scope.type === "session") {
		throw new MemoryError(
			"Session memory is stored within the session file. Use loadSession() to access it."
		);
	}

	const filePath = resolveMemoryPath(scope);
	if (!filePath) return "";

	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch (err) {
		const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT"
			|| (err instanceof Error && err.message.includes("ENOENT"));
		if (isNotFound) return "";
		throw new MemoryError(`Failed to read memory at ${filePath}: ${err}`);
	}
}

/**
 * Write (overwrite) the memory content for a given scope.
 *
 * Creates the file and parent directories if they do not exist.
 * Writes are serialized per-scope via a promise-chain queue to prevent
 * concurrent write corruption.
 *
 * @param scope - The memory scope to write (global, project, or agent).
 * @param content - The content to write.
 * @returns A promise that resolves when the write completes.
 * @throws {MemoryError} If scope is `"session"`.
 * @throws {MemoryError} If the write fails.
 */
export function updateMemory(scope: MemoryScope, content: string): Promise<void> {
	if (scope.type === "session") {
		throw new MemoryError(
			"Session memory is stored within the session file. Use saveSession() to update it."
		);
	}

	const filePath = resolveMemoryPath(scope);
	if (!filePath) return Promise.resolve();

	const key = scopeKey(scope);
	const prev = memoryWriteQueues.get(key) ?? Promise.resolve();
	const next = prev.then(() => {
		try {
			ensureDir(filePath);
			fs.writeFileSync(filePath, content, "utf-8");
		} catch (err) {
			throw new MemoryError(`Failed to write memory at ${filePath}: ${err}`);
		}
	}).finally(() => {
		if (memoryWriteQueues.get(key) === next) {
			memoryWriteQueues.delete(key);
		}
	});
	memoryWriteQueues.set(key, next);
	return next;
}

/**
 * Append a timestamped entry to the memory file for a given scope.
 *
 * Each entry is separated by a horizontal rule and prefixed with an ISO
 * timestamp. If the file does not exist, it is created with a scope-appropriate
 * header.
 *
 * Writes are serialized per-scope via a promise-chain queue. If the resulting
 * file would exceed {@link MAX_MEMORY_SIZE}, the oldest entries are dropped.
 *
 * @param scope - The memory scope to append to (global, project, or agent).
 * @param entry - The text content to append.
 * @returns A promise that resolves when the write completes.
 * @throws {MemoryError} If scope is `"session"`.
 */
export function appendMemory(scope: MemoryScope, entry: string): Promise<void> {
	if (scope.type === "session") {
		throw new MemoryError(
			"Session memory is stored within the session file. Use addTurn() to append."
		);
	}

	const filePath = resolveMemoryPath(scope);
	if (!filePath) return Promise.resolve();

	const key = scopeKey(scope);
	const prev = memoryWriteQueues.get(key) ?? Promise.resolve();
	const next = prev.then(() => {
		try {
			ensureDir(filePath);
			const timestamp = new Date().toISOString();
			const formatted = `\n---\n\n*${timestamp}*\n\n${entry}\n`;

			// Read existing content atomically (no TOCTOU: single readFileSync + ENOENT catch)
			let existing: string | null = null;
			try {
				existing = fs.readFileSync(filePath, "utf-8");
			} catch (readErr) {
				const isNotFound = (readErr as NodeJS.ErrnoException).code === "ENOENT"
					|| (readErr instanceof Error && readErr.message.includes("ENOENT"));
				if (!isNotFound) throw readErr;
			}

			if (existing !== null) {
				const totalSize = Buffer.byteLength(existing, "utf-8")
					+ Buffer.byteLength(formatted, "utf-8");

				if (totalSize > MAX_MEMORY_SIZE) {
					// Truncate oldest entries and write the full result
					const result = truncateToFit(existing, formatted);
					fs.writeFileSync(filePath, result, "utf-8");
				} else {
					fs.appendFileSync(filePath, formatted, "utf-8");
				}
			} else {
				// First entry: write with a header
				const header = buildMemoryHeader(scope);
				fs.writeFileSync(filePath, header + formatted, "utf-8");
			}
		} catch (err) {
			if (err instanceof MemoryError) throw err;
			throw new MemoryError(`Failed to append memory at ${filePath}: ${err}`);
		}
	}).finally(() => {
		if (memoryWriteQueues.get(key) === next) {
			memoryWriteQueues.delete(key);
		}
	});
	memoryWriteQueues.set(key, next);
	return next;
}

/** Entry separator used in memory files. */
const ENTRY_SEPARATOR = "\n---\n\n";

/**
 * Truncate oldest entries from content to stay under MAX_MEMORY_SIZE.
 * Keeps the header (first segment) and newest entries.
 */
function truncateToFit(existing: string, incoming: string): string {
	const segments = existing.split(ENTRY_SEPARATOR);
	const header = segments[0];

	const budget = MAX_MEMORY_SIZE - Buffer.byteLength(incoming, "utf-8");
	const kept: string[] = [];
	let size = Buffer.byteLength(header, "utf-8");

	for (let i = segments.length - 1; i >= 1; i--) {
		const segSize = Buffer.byteLength(ENTRY_SEPARATOR + segments[i], "utf-8");
		if (size + segSize > budget) break;
		size += segSize;
		kept.unshift(segments[i]);
	}

	const truncated = kept.length > 0
		? header + ENTRY_SEPARATOR + kept.join(ENTRY_SEPARATOR)
		: header;

	return truncated + incoming;
}

/**
 * Delete the memory file for a given scope and clean up empty parent dirs.
 *
 * @param scope - The memory scope to delete (global, project, or agent).
 * @throws {MemoryError} If scope is `"session"`.
 * @throws {MemoryError} If the delete fails.
 */
export function deleteMemory(scope: MemoryScope): void {
	if (scope.type === "session") {
		throw new MemoryError(
			"Session memory is stored within the session file. Use deleteSession() to remove."
		);
	}

	const filePath = resolveMemoryPath(scope);
	if (!filePath) return;

	try {
		try {
			fs.unlinkSync(filePath);
		} catch (unlinkErr) {
			const isNotFound = (unlinkErr as NodeJS.ErrnoException).code === "ENOENT"
				|| (unlinkErr instanceof Error && unlinkErr.message.includes("ENOENT"));
			if (!isNotFound) throw unlinkErr;
		}

		// Clean up empty parent directories
		const dir = path.dirname(filePath);
		try {
			const remaining = fs.readdirSync(dir);
			if (remaining.length === 0) {
				fs.rmdirSync(dir);
			}
		} catch {
			// Non-fatal: empty-dir cleanup is best-effort, race with concurrent writes
		}
	} catch (err) {
		throw new MemoryError(`Failed to delete memory at ${filePath}: ${err}`);
	}
}

/**
 * Build a header for a new memory file based on scope.
 */
function buildMemoryHeader(scope: MemoryScope): string {
	switch (scope.type) {
		case "global":
			return "# Global Memory\n\nPersistent knowledge shared across all projects and sessions.\n";

		case "project":
			return `# Project Memory\n\nKnowledge specific to project: ${scope.path}\n`;

		case "agent":
			return `# Agent Memory: ${scope.agentId}\n\nKnowledge specific to agent: ${scope.agentId}\n`;

		default:
			return "# Memory\n";
	}
}

/**
 * List all memory scopes that currently have files on disk.
 *
 * Scans the memory root for global.md, project directories, and agent files.
 * Does not include session-scoped memory.
 *
 * @returns An array of {@link MemoryScope} objects representing on-disk memory files.
 */
export function listMemoryScopes(): MemoryScope[] {
	const root = getMemoryRoot();
	const scopes: MemoryScope[] = [];

	// Check global
	if (fs.existsSync(path.join(root, "global.md"))) {
		scopes.push({ type: "global" });
	}

	// Check project memories
	const projectsDir = path.join(root, "projects");
	if (fs.existsSync(projectsDir)) {
		try {
			const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
			for (const entry of projectDirs) {
				if (entry.isDirectory()) {
					const projectFile = path.join(projectsDir, entry.name, "project.md");
					if (fs.existsSync(projectFile)) {
						// We store the hash, not the original path — read the file to get the project path
						const content = fs.readFileSync(projectFile, "utf-8");
						const pathMatch = content.match(/project:\s*(.+)/);
						const projectPath = pathMatch ? pathMatch[1].trim() : entry.name;
						scopes.push({ type: "project", path: projectPath });
					}
				}
			}
		} catch {
			// Non-fatal: projects directory may be inaccessible; continue with other scopes
		}
	}

	// Check agent memories
	const agentsDir = path.join(root, "agents");
	if (fs.existsSync(agentsDir)) {
		try {
			const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
			for (const file of agentFiles) {
				const agentId = file.replace(/\.md$/, "");
				scopes.push({ type: "agent", agentId });
			}
		} catch {
			// Non-fatal: agents directory may be inaccessible; continue with other scopes
		}
	}

	return scopes;
}
