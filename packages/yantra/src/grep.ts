/**
 * @chitragupta/yantra — Content search tool.
 *
 * Searches file contents with regex patterns using recursive file walking.
 * Returns matching lines with file path and line number.
 *
 * Features:
 *   - Context lines (like grep -C, -B, -A)
 *   - File type filtering (e.g., "ts", "py" maps to known extensions)
 *   - Invert match support (like grep -v)
 *   - Streaming file reads for better memory usage on large files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";
import { searchFileStreaming } from "./grep-streaming.js";

/** Configurable limits for the grep tool. */
export interface GrepConfig {
	maxResults?: number;
	maxFileSize?: number;
	streamThreshold?: number;
}

const DEFAULT_GREP_CONFIG: Required<GrepConfig> = {
	maxResults: 50,
	maxFileSize: 5_000_000,
	streamThreshold: 1_000_000,
};

let _grepConfig = { ...DEFAULT_GREP_CONFIG };

/** Update grep tool configuration at runtime. */
export function configureGrep(config: GrepConfig): void {
	_grepConfig = { ...DEFAULT_GREP_CONFIG, ...config };
}

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
	".vscode",
	".idea",
]);

// ─── Path Security (Defence-in-Depth) ──────────────────────────────────────

/**
 * Sensitive paths that should never be searched by the agent.
 * Same list as read.ts for consistency.
 */
const BLOCKED_SEARCH_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
	"credentials.json", ".chitragupta/config",
];

/**
 * Check if a file path is sensitive and should be blocked from search.
 */
function isBlockedSearchPath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return BLOCKED_SEARCH_PATHS.some((bp) => lower.includes(bp));
}

/** Binary file extensions to skip. */
const BINARY_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
	".woff", ".woff2", ".ttf", ".eot",
	".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
	".pdf", ".doc", ".docx", ".xls", ".xlsx",
	".exe", ".dll", ".so", ".dylib",
	".mp3", ".mp4", ".avi", ".mov", ".wav",
	".pyc", ".class", ".o", ".obj",
]);

/** Map of file-type shorthand to extensions. */
const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
	ts: [".ts", ".tsx", ".mts", ".cts"],
	js: [".js", ".jsx", ".mjs", ".cjs"],
	py: [".py", ".pyi"],
	rs: [".rs"],
	go: [".go"],
	java: [".java"],
	rb: [".rb"],
	php: [".php"],
	c: [".c", ".h"],
	cpp: [".cpp", ".hpp", ".cc", ".hh", ".cxx"],
	cs: [".cs"],
	swift: [".swift"],
	kt: [".kt", ".kts"],
	scala: [".scala"],
	lua: [".lua"],
	r: [".r", ".R"],
	dart: [".dart"],
	zig: [".zig"],
	vue: [".vue"],
	svelte: [".svelte"],
	html: [".html", ".htm"],
	css: [".css", ".scss", ".sass", ".less"],
	json: [".json"],
	yaml: [".yaml", ".yml"],
	toml: [".toml"],
	md: [".md", ".mdx"],
	sql: [".sql"],
	sh: [".sh", ".bash", ".zsh"],
	dockerfile: ["Dockerfile"],
	xml: [".xml"],
};

export interface GrepMatch {
	file: string;
	line: number;
	text: string;
	isContext?: boolean;
}

/**
 * Check if a filename matches an include glob pattern.
 * Supports simple patterns: *.ts, *.{ts,tsx}, specific filenames.
 */
function matchesInclude(filename: string, include: string): boolean {
	// Handle brace expansion: *.{ts,tsx} -> [*.ts, *.tsx]
	if (include.includes("{") && include.includes("}")) {
		const braceMatch = include.match(/^(.*)\{([^}]+)\}(.*)$/);
		if (braceMatch) {
			const [, prefix, options, suffix] = braceMatch;
			return options.split(",").some((opt) =>
				matchesInclude(filename, prefix + opt.trim() + suffix),
			);
		}
	}

	// Convert simple glob to regex
	const regexStr = include
		.replace(/\./g, "\\.")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${regexStr}$`).test(filename);
}

/**
 * Check if a file matches a file-type filter.
 */
function matchesFileType(filename: string, fileType: string): boolean {
	const extensions = FILE_TYPE_EXTENSIONS[fileType.toLowerCase()];
	if (!extensions) return false;

	const ext = path.extname(filename).toLowerCase();
	// Also check the full filename for extensionless matches like "Dockerfile"
	return extensions.includes(ext) || extensions.includes(filename);
}

/**
 * Recursively walk a directory, yielding file paths.
 */
async function* walkFiles(
	dir: string,
	include: string | undefined,
	fileType: string | undefined,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	if (signal?.aborted) return;

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		// Silently skip: directory not readable (permissions, symlink, etc.)
		return;
	}

	for (const entry of entries) {
		if (signal?.aborted) return;

		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			// Skip sensitive directories
			if (entry.name === ".ssh" || entry.name === ".gnupg") continue;
			yield* walkFiles(path.join(dir, entry.name), include, fileType, signal);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (BINARY_EXTENSIONS.has(ext)) continue;
			if (include && !matchesInclude(entry.name, include)) continue;
			if (fileType && !matchesFileType(entry.name, fileType)) continue;
			// Block sensitive files
			const fullPath = path.join(dir, entry.name);
			if (isBlockedSearchPath(fullPath)) continue;
			yield fullPath;
		}
	}
}

/**
 * Content search tool handler.
 *
 * Searches file contents using regex patterns with recursive directory walking.
 * Supports context lines, file type filtering, and inverted matching.
 * Uses streaming reads for files over 1 MB.
 *
 * @example
 * ```ts
 * const result = await grepTool.execute(
 *   { pattern: "TODO", path: "src", fileType: "ts", contextLines: 2 },
 *   context,
 * );
 * ```
 */
export const grepTool: ToolHandler = {
	definition: {
		name: "grep",
		description:
			"Search file contents using a regex pattern. Returns matching lines " +
			"with file path and line number. Recursively walks the directory tree. " +
			"Supports context lines, file type filtering, and inverted matching.",
		inputSchema: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: "Regular expression pattern to search for.",
				},
				path: {
					type: "string",
					description: "Directory or file to search in. Defaults to working directory.",
				},
				include: {
					type: "string",
					description: "Glob pattern to filter files, e.g. '*.ts' or '*.{ts,tsx}'.",
				},
				fileType: {
					type: "string",
					description:
						"File type shorthand to filter by. E.g. 'ts', 'py', 'rs', 'go', 'js'. " +
						"Maps to known file extensions.",
				},
				maxResults: {
					type: "number",
					description: `Maximum number of matching lines to return. Defaults to ${DEFAULT_GREP_CONFIG.maxResults}.`,
				},
				contextLines: {
					type: "number",
					description: "Number of context lines to show before and after each match (like grep -C).",
				},
				beforeContext: {
					type: "number",
					description: "Number of context lines to show before each match (like grep -B). Overrides contextLines for before.",
				},
				afterContext: {
					type: "number",
					description: "Number of context lines to show after each match (like grep -A). Overrides contextLines for after.",
				},
				invert: {
					type: "boolean",
					description: "If true, return lines that do NOT match the pattern (like grep -v).",
				},
			},
			required: ["pattern"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const pattern = args.pattern as string | undefined;
		if (!pattern) {
			return { content: "Error: 'pattern' argument is required.", isError: true };
		}

		let regex: RegExp;
		try {
			regex = new RegExp(pattern, "g");
		} catch (err) {
			return {
				content: `Error: Invalid regex pattern: ${(err as Error).message}`,
				isError: true,
			};
		}

		const searchPath = args.path
			? path.isAbsolute(args.path as string)
				? (args.path as string)
				: path.resolve(context.workingDirectory, args.path as string)
			: context.workingDirectory;

		const include = args.include as string | undefined;
		const fileType = args.fileType as string | undefined;
		const maxResults = (args.maxResults as number) || _grepConfig.maxResults;
		const invert = args.invert === true;

		// Context line configuration
		const contextAll = (args.contextLines as number) || 0;
		const beforeCtx = (args.beforeContext as number) ?? contextAll;
		const afterCtx = (args.afterContext as number) ?? contextAll;

		const matches: GrepMatch[] = [];

		// Block searching sensitive paths
		if (isBlockedSearchPath(searchPath)) {
			return { content: `Error: access to sensitive path denied: ${searchPath}`, isError: true };
		}

		try {
			const stat = await fs.promises.stat(searchPath);

			if (stat.isFile()) {
				if (stat.size > _grepConfig.streamThreshold) {
					await searchFileStreaming(searchPath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
				} else {
					await searchFile(searchPath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
				}
			} else if (stat.isDirectory()) {
				for await (const filePath of walkFiles(searchPath, include, fileType, context.signal)) {
					if (matches.length >= maxResults) break;

					// Skip large files
					let fileSize = 0;
					try {
						const fileStat = await fs.promises.stat(filePath);
						if (fileStat.size > _grepConfig.maxFileSize) continue;
						fileSize = fileStat.size;
					} catch {
						// Silently skip: file stat failed (deleted, permissions, race condition)
						continue;
					}

					if (fileSize > _grepConfig.streamThreshold) {
						await searchFileStreaming(filePath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
					} else {
						await searchFile(filePath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
					}
				}
			} else {
				return { content: `Error: Path is not a file or directory: ${searchPath}`, isError: true };
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: Path not found: ${searchPath}`, isError: true };
			}
			return { content: `Error searching: ${err.message}`, isError: true };
		}

		if (matches.length === 0) {
			return {
				content: `No matches found for pattern: ${pattern}`,
				metadata: { matchCount: 0 },
			};
		}

		const lines = matches.map((m) => {
			const sep = m.isContext ? "-" : ":";
			return `${m.file}${sep}${m.line}${sep} ${m.text}`;
		});

		let output = lines.join("\n");
		const matchCount = matches.filter((m) => !m.isContext).length;
		if (matchCount >= maxResults) {
			output += `\n\n[Results capped at ${maxResults}. Use maxResults to increase.]`;
		}

		return {
			content: output,
			metadata: {
				matchCount,
				contextLineCount: matches.filter((m) => m.isContext).length,
				capped: matchCount >= maxResults,
			},
		};
	},
};

/**
 * Search a single file by loading it entirely into memory.
 * Used for files under STREAM_THRESHOLD.
 */
async function searchFile(
	filePath: string,
	regex: RegExp,
	matches: GrepMatch[],
	maxResults: number,
	invert: boolean,
	beforeCtx: number,
	afterCtx: number,
): Promise<void> {
	let content: string;
	try {
		content = await fs.promises.readFile(filePath, "utf-8");
	} catch {
		// Silently skip: file not readable (permissions, binary, encoding)
		return;
	}

	const lines = content.split("\n");
	const matchLineNums = new Set<number>();
	const contextLineNums = new Set<number>();
	let matchCount = matches.filter((m) => !m.isContext).length;

	// First pass: find matching line numbers
	for (let i = 0; i < lines.length; i++) {
		if (matchCount >= maxResults) break;

		regex.lastIndex = 0;
		const isMatch = regex.test(lines[i]);
		const shouldInclude = invert ? !isMatch : isMatch;

		if (shouldInclude) {
			matchLineNums.add(i);
			matchCount++;

			// Mark context lines
			for (let b = Math.max(0, i - beforeCtx); b < i; b++) {
				if (!matchLineNums.has(b)) contextLineNums.add(b);
			}
			for (let a = i + 1; a <= Math.min(lines.length - 1, i + afterCtx); a++) {
				if (!matchLineNums.has(a)) contextLineNums.add(a);
			}
		}
	}

	// Collect all line numbers, sorted
	const allLineNums = new Set<number>([...matchLineNums, ...contextLineNums]);
	const sorted = Array.from(allLineNums).sort((a, b) => a - b);

	// Add separator tracking for non-contiguous groups
	let prevLineNum = -2;
	for (const lineNum of sorted) {
		if (matches.length >= maxResults + (afterCtx + beforeCtx) * maxResults) break;

		// Add a separator line for non-contiguous sections
		if (prevLineNum >= 0 && lineNum > prevLineNum + 1 && (beforeCtx > 0 || afterCtx > 0)) {
			matches.push({
				file: filePath,
				line: 0,
				text: "--",
				isContext: true,
			});
		}
		prevLineNum = lineNum;

		const text = lines[lineNum].length > 500 ? lines[lineNum].slice(0, 500) + "..." : lines[lineNum];
		matches.push({
			file: filePath,
			line: lineNum + 1,
			text,
			isContext: !matchLineNums.has(lineNum),
		});
	}
}
