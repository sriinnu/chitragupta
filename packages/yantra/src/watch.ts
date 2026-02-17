/**
 * @chitragupta/yantra — File watcher tool.
 *
 * Watches files and directories for changes using Node's native fs.watch().
 * Delivers debounced change notifications with file path, change type,
 * and timestamp. Automatically cleans up watchers on abort signal.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Type of file system change detected by the watcher. */
export type ChangeType = "create" | "modify" | "delete";

/** A single file change event detected by the watcher. */
export interface FileChange {
	/** Absolute path to the changed file. */
	path: string;
	/** The type of change that occurred. */
	changeType: ChangeType;
	/** Unix timestamp (ms) when the change was detected. */
	timestamp: number;
}

// ─── Debouncer ──────────────────────────────────────────────────────────────

/**
 * Debounce file system events. Node's fs.watch often fires multiple
 * events for a single logical change (e.g., write + rename). This
 * batches events within a window and deduplicates by file path.
 */
class ChangeDebouncer {
	private pending = new Map<string, FileChange>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly delayMs: number;
	private readonly onFlush: (changes: FileChange[]) => void;

	constructor(delayMs: number, onFlush: (changes: FileChange[]) => void) {
		this.delayMs = delayMs;
		this.onFlush = onFlush;
	}

	add(change: FileChange): void {
		// Keep the latest event for each path
		this.pending.set(change.path, change);

		if (this.timer !== null) {
			clearTimeout(this.timer);
		}

		this.timer = setTimeout(() => {
			this.flush();
		}, this.delayMs);
	}

	flush(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		if (this.pending.size > 0) {
			const changes = Array.from(this.pending.values());
			this.pending.clear();
			this.onFlush(changes);
		}
	}

	destroy(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.pending.clear();
	}
}

// ─── File Watcher ───────────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;

/** Maximum number of events to collect before returning. */
const MAX_EVENTS = 100;

/** Maximum watch duration in ms (30 seconds). */
const MAX_WATCH_DURATION_MS = 30_000;

/**
 * Determine the change type by checking file existence.
 * We compare against a set of known files to distinguish create/delete/modify.
 */
async function detectChangeType(
	filePath: string,
	knownFiles: Set<string>,
): Promise<ChangeType> {
	try {
		await fs.promises.access(filePath);
		// File exists now
		if (knownFiles.has(filePath)) {
			return "modify";
		}
		knownFiles.add(filePath);
		return "create";
	} catch {
		// File does not exist
		if (knownFiles.has(filePath)) {
			knownFiles.delete(filePath);
			return "delete";
		}
		return "delete";
	}
}

/**
 * Recursively collect all existing file paths under a directory.
 */
async function collectExistingFiles(dir: string): Promise<Set<string>> {
	const files = new Set<string>();

	async function walk(currentDir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isFile()) {
				files.add(fullPath);
			} else if (entry.isDirectory()) {
				// Skip common non-interesting directories
				if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
					continue;
				}
				await walk(fullPath);
			}
		}
	}

	await walk(dir);
	return files;
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

/**
 * File watcher tool handler.
 *
 * Watches files or directories for changes using `fs.watch`.
 * Returns debounced change notifications within a time window.
 * Automatically stops after a timeout or when max events is reached.
 *
 * @example
 * ```ts
 * const result = await watchTool.execute(
 *   { path: "src", durationMs: 10000, recursive: true },
 *   context,
 * );
 * ```
 */
export const watchTool: ToolHandler = {
	definition: {
		name: "watch",
		description:
			"Watch files or directories for changes. Returns a list of file changes " +
			"(create, modify, delete) that occur within a time window. The watch " +
			"automatically stops after the timeout or when the maximum number of events is reached.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File or directory to watch. Defaults to working directory.",
				},
				durationMs: {
					type: "number",
					description:
						`Duration to watch in milliseconds. Defaults to 5000 (5s). Maximum: ${MAX_WATCH_DURATION_MS}ms.`,
				},
				recursive: {
					type: "boolean",
					description: "Whether to watch subdirectories recursively. Defaults to true.",
				},
			},
			required: [],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const watchPath = args.path
			? path.isAbsolute(args.path as string)
				? (args.path as string)
				: path.resolve(context.workingDirectory, args.path as string)
			: context.workingDirectory;

		const durationMs = Math.min(
			(args.durationMs as number) || 5_000,
			MAX_WATCH_DURATION_MS,
		);
		const recursive = args.recursive !== false;

		// Verify path exists
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(watchPath);
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: Path not found: ${watchPath}`, isError: true };
			}
			return { content: `Error: ${err.message}`, isError: true };
		}

		// Collect existing files for change type detection
		const knownFiles = stat.isDirectory()
			? await collectExistingFiles(watchPath)
			: new Set<string>([watchPath]);

		const collectedChanges: FileChange[] = [];
		let watcher: fs.FSWatcher | null = null;

		return new Promise<ToolResult>((resolve) => {
			let resolved = false;

			const finish = () => {
				if (resolved) return;
				resolved = true;

				debouncer.flush();
				debouncer.destroy();

				if (watcher) {
					watcher.close();
					watcher = null;
				}

				if (collectedChanges.length === 0) {
					resolve({
						content: `No changes detected within ${durationMs}ms watching: ${watchPath}`,
						metadata: { changeCount: 0, durationMs },
					});
					return;
				}

				const lines = collectedChanges.map((c) => {
					const ts = new Date(c.timestamp).toISOString();
					return `[${ts}] ${c.changeType}: ${c.path}`;
				});

				resolve({
					content: lines.join("\n"),
					metadata: {
						changeCount: collectedChanges.length,
						durationMs,
						changes: collectedChanges,
					},
				});
			};

			const debouncer = new ChangeDebouncer(DEBOUNCE_MS, (changes) => {
				for (const change of changes) {
					collectedChanges.push(change);
				}

				if (collectedChanges.length >= MAX_EVENTS) {
					finish();
				}
			});

			// Set up the timeout
			const timeout = setTimeout(finish, durationMs);

			// Set up abort handler
			const onAbort = () => {
				clearTimeout(timeout);
				finish();
			};

			if (context.signal) {
				if (context.signal.aborted) {
					clearTimeout(timeout);
					resolve({
						content: "Watch aborted before starting.",
						metadata: { changeCount: 0, durationMs: 0 },
					});
					return;
				}
				context.signal.addEventListener("abort", onAbort, { once: true });
			}

			// Start watching
			try {
				watcher = fs.watch(
					watchPath,
					{ recursive, persistent: false },
					(eventType, filename) => {
						if (!filename || resolved) return;

						const fullPath = stat.isDirectory()
							? path.join(watchPath, filename)
							: watchPath;

						detectChangeType(fullPath, knownFiles).then((changeType) => {
							if (!resolved) {
								debouncer.add({
									path: fullPath,
									changeType,
									timestamp: Date.now(),
								});
							}
						}).catch(() => {
							// Ignore detection errors
						});
					},
				);

				watcher.on("error", (err) => {
					if (!resolved) {
						clearTimeout(timeout);
						resolved = true;
						debouncer.destroy();
						resolve({
							content: `Watcher error: ${err.message}`,
							isError: true,
						});
					}
				});
			} catch (error) {
				clearTimeout(timeout);
				debouncer.destroy();
				const err = error as Error;
				resolve({
					content: `Error starting watcher: ${err.message}`,
					isError: true,
				});
			}
		});
	},
};
