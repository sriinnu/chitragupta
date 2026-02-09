/**
 * @chitragupta/yantra — Directory listing tool.
 *
 * Lists directory contents with file sizes and types.
 * Supports recursive listing with configurable depth.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_ENTRIES = 2000;

// ─── Path Security ──────────────────────────────────────────────────────────

/** Sensitive paths that should never be listed. */
const BLOCKED_LIST_PATHS = [
	".ssh", ".gnupg", ".env",
	"credentials.json", "id_rsa", "id_ed25519", "id_ecdsa",
	".chitragupta/config",
];

/** Check if a path is sensitive and should be blocked from listing. */
function isBlockedListPath(targetPath: string): boolean {
	const lower = targetPath.toLowerCase();
	return BLOCKED_LIST_PATHS.some((bp) => lower.includes(bp));
}

interface DirEntry {
	name: string;
	relativePath: string;
	type: "file" | "dir" | "symlink" | "other";
	size: number;
}

/**
 * Format byte sizes into human-readable strings.
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Read a single directory level.
 */
async function readDir(dir: string, baseDir: string): Promise<DirEntry[]> {
	const entries: DirEntry[] = [];

	let dirents: fs.Dirent[];
	try {
		dirents = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return entries;
	}

	for (const dirent of dirents) {
		// Skip sensitive entries
		if (isBlockedListPath(dirent.name)) continue;

		const fullPath = path.join(dir, dirent.name);
		const relativePath = path.relative(baseDir, fullPath);
		let size = 0;

		if (dirent.isFile()) {
			try {
				const stat = await fs.promises.stat(fullPath);
				size = stat.size;
			} catch {
				// If we can't stat, just report size 0
			}
		}

		let type: DirEntry["type"];
		if (dirent.isDirectory()) type = "dir";
		else if (dirent.isSymbolicLink()) type = "symlink";
		else if (dirent.isFile()) type = "file";
		else type = "other";

		entries.push({ name: dirent.name, relativePath, type, size });
	}

	// Sort: directories first, then files, both alphabetically
	entries.sort((a, b) => {
		if (a.type === "dir" && b.type !== "dir") return -1;
		if (a.type !== "dir" && b.type === "dir") return 1;
		return a.name.localeCompare(b.name);
	});

	return entries;
}

/**
 * Recursively collect directory entries up to a given depth.
 */
async function collectEntries(
	dir: string,
	baseDir: string,
	depth: number,
	maxDepth: number,
	collected: DirEntry[],
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	if (depth > maxDepth) return;
	if (collected.length >= MAX_ENTRIES) return;

	const entries = await readDir(dir, baseDir);

	for (const entry of entries) {
		if (collected.length >= MAX_ENTRIES) return;
		if (signal?.aborted) return;

		collected.push(entry);

		if (entry.type === "dir" && depth < maxDepth) {
			const fullPath = path.join(baseDir, entry.relativePath);
			await collectEntries(fullPath, baseDir, depth + 1, maxDepth, collected, signal);
		}
	}
}

/**
 * Directory listing tool handler.
 *
 * Lists directory contents with file sizes and types.
 * Supports recursive listing with configurable depth (default 3).
 *
 * @example
 * ```ts
 * const result = await lsTool.execute(
 *   { path: "src", recursive: true, maxDepth: 2 },
 *   context,
 * );
 * ```
 */
export const lsTool: ToolHandler = {
	definition: {
		name: "ls",
		description:
			"List directory contents. Shows files and directories with their " +
			"sizes and types. Supports recursive listing with depth control.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Directory to list. Defaults to working directory.",
				},
				recursive: {
					type: "boolean",
					description: "Whether to list recursively. Defaults to false.",
				},
				maxDepth: {
					type: "number",
					description: `Maximum recursion depth. Defaults to ${DEFAULT_MAX_DEPTH}. Only used when recursive is true.`,
				},
			},
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const targetPath = args.path
			? path.isAbsolute(args.path as string)
				? (args.path as string)
				: path.resolve(context.workingDirectory, args.path as string)
			: context.workingDirectory;

		const recursive = (args.recursive as boolean) || false;
		const maxDepth = recursive ? ((args.maxDepth as number) || DEFAULT_MAX_DEPTH) : 0;

		// Block listing of sensitive directories
		if (isBlockedListPath(targetPath)) {
			return { content: `Error: access to sensitive path denied: ${targetPath}`, isError: true };
		}

		try {
			const stat = await fs.promises.stat(targetPath);
			if (!stat.isDirectory()) {
				return { content: `Error: Path is not a directory: ${targetPath}`, isError: true };
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: Directory not found: ${targetPath}`, isError: true };
			}
			return { content: `Error: ${err.message}`, isError: true };
		}

		const collected: DirEntry[] = [];
		await collectEntries(targetPath, targetPath, 0, maxDepth, collected, context.signal);

		if (collected.length === 0) {
			return {
				content: `Directory is empty: ${targetPath}`,
				metadata: { path: targetPath, entryCount: 0 },
			};
		}

		const lines = collected.map((entry) => {
			const typeIndicator = entry.type === "dir" ? "/" : entry.type === "symlink" ? "@" : "";
			const sizeStr = entry.type === "file" ? formatSize(entry.size) : "-";
			return `${sizeStr.padStart(10)}  ${entry.relativePath}${typeIndicator}`;
		});

		let output = `${targetPath}\n\n${lines.join("\n")}`;

		if (collected.length >= MAX_ENTRIES) {
			output += `\n\n[Listing capped at ${MAX_ENTRIES} entries]`;
		}

		return {
			content: output,
			metadata: {
				path: targetPath,
				entryCount: collected.length,
				capped: collected.length >= MAX_ENTRIES,
			},
		};
	},
};
