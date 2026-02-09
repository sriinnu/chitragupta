/**
 * @chitragupta/yantra — File finder tool.
 *
 * Finds files by glob patterns. Walks the directory tree matching
 * glob patterns using simple pattern matching (supports *, **, ?).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

const DEFAULT_MAX_RESULTS = 200;

/** Directories to always skip during traversal. */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"__pycache__",
	".cache",
]);

/** Sensitive directories that must never be traversed. */
const SENSITIVE_DIRS = new Set([".ssh", ".gnupg"]);

/** File names that must never be returned in search results. */
const SENSITIVE_FILES = new Set(["credentials.json", "id_rsa", "id_ed25519", "id_ecdsa"]);

/** Path fragments that indicate a sensitive location. */
const SENSITIVE_PATH_FRAGMENTS = [".env", ".chitragupta/config"];

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports:
 *   *    — matches any characters except path separator
 *   **   — matches any characters including path separator
 *   ?    — matches a single character except path separator
 *   .ext — literal dots
 */
function globToRegex(pattern: string): RegExp {
	let regexStr = "";
	let i = 0;

	while (i < pattern.length) {
		const ch = pattern[i];

		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				// ** — match anything including separators
				if (pattern[i + 2] === "/") {
					regexStr += "(?:.*/)?";
					i += 3;
				} else {
					regexStr += ".*";
					i += 2;
				}
			} else {
				// * — match anything except separator
				regexStr += "[^/]*";
				i++;
			}
		} else if (ch === "?") {
			regexStr += "[^/]";
			i++;
		} else if (ch === ".") {
			regexStr += "\\.";
			i++;
		} else if (ch === "{") {
			// Brace expansion: {ts,tsx} -> (ts|tsx)
			const close = pattern.indexOf("}", i);
			if (close !== -1) {
				const options = pattern.slice(i + 1, close).split(",").map((s) => s.trim());
				regexStr += "(" + options.map(escapeRegex).join("|") + ")";
				i = close + 1;
			} else {
				regexStr += "\\{";
				i++;
			}
		} else {
			regexStr += escapeRegex(ch);
			i++;
		}
	}

	return new RegExp(`^${regexStr}$`);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recursively walk a directory, yielding relative file paths.
 */
async function* walkFiles(
	dir: string,
	baseDir: string,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	if (signal?.aborted) return;

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (signal?.aborted) return;

		const fullPath = path.join(dir, entry.name);
		const relativePath = path.relative(baseDir, fullPath);

		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			if (SENSITIVE_DIRS.has(entry.name)) continue;
			yield* walkFiles(fullPath, baseDir, signal);
		} else if (entry.isFile()) {
			// Block sensitive files
			if (SENSITIVE_FILES.has(entry.name)) continue;
			const lower = fullPath.toLowerCase();
			if (SENSITIVE_PATH_FRAGMENTS.some((f) => lower.includes(f))) continue;
			yield relativePath;
		}
	}
}

/**
 * File finder tool handler.
 *
 * Finds files matching glob patterns by walking the directory tree.
 * Supports `*`, `**`, `?`, and brace expansion `{ts,tsx}`.
 *
 * @example
 * ```ts
 * const result = await findTool.execute(
 *   { patterns: ["**\/*.test.ts"], path: "src", maxResults: 100 },
 *   context,
 * );
 * ```
 */
export const findTool: ToolHandler = {
	definition: {
		name: "find",
		description:
			"Find files matching glob patterns. Walks the directory tree and returns " +
			"matching file paths. Supports *, **, and ? wildcards.",
		inputSchema: {
			type: "object",
			properties: {
				patterns: {
					type: "array",
					items: { type: "string" },
					description:
						"Glob patterns to match, e.g. ['**/*.ts', '**/*.tsx']. " +
						"Multiple patterns are OR-combined.",
				},
				path: {
					type: "string",
					description: "Directory to search in. Defaults to working directory.",
				},
				maxResults: {
					type: "number",
					description: `Maximum number of results. Defaults to ${DEFAULT_MAX_RESULTS}.`,
				},
			},
			required: ["patterns"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const patterns = args.patterns as string[] | undefined;
		if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
			return { content: "Error: 'patterns' must be a non-empty array of glob strings.", isError: true };
		}

		const searchPath = args.path
			? path.isAbsolute(args.path as string)
				? (args.path as string)
				: path.resolve(context.workingDirectory, args.path as string)
			: context.workingDirectory;

		const maxResults = (args.maxResults as number) || DEFAULT_MAX_RESULTS;

		// Compile glob patterns to regexes
		const regexes = patterns.map((p) => globToRegex(p));

		const results: string[] = [];

		try {
			const stat = await fs.promises.stat(searchPath);
			if (!stat.isDirectory()) {
				return { content: `Error: Path is not a directory: ${searchPath}`, isError: true };
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: Directory not found: ${searchPath}`, isError: true };
			}
			return { content: `Error: ${err.message}`, isError: true };
		}

		for await (const relativePath of walkFiles(searchPath, searchPath, context.signal)) {
			if (results.length >= maxResults) break;

			// Normalize separators to forward slashes for matching
			const normalized = relativePath.replace(/\\/g, "/");

			for (const regex of regexes) {
				if (regex.test(normalized)) {
					results.push(path.join(searchPath, relativePath));
					break;
				}
			}
		}

		if (results.length === 0) {
			return {
				content: `No files found matching patterns: ${patterns.join(", ")}`,
				metadata: { matchCount: 0 },
			};
		}

		let output = results.join("\n");
		if (results.length >= maxResults) {
			output += `\n\n[Results capped at ${maxResults}. Use maxResults to increase.]`;
		}

		return {
			content: output,
			metadata: {
				matchCount: results.length,
				capped: results.length >= maxResults,
			},
		};
	},
};
