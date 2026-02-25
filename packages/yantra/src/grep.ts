/**
 * @chitragupta/yantra -- Content search tool.
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
import {
	getGrepConfig,
	isBlockedSearchPath,
	walkFiles,
} from "./grep-helpers.js";

// Re-export for backward compatibility
export {
	type GrepConfig,
	DEFAULT_GREP_CONFIG,
	configureGrep,
	SKIP_DIRS,
	BLOCKED_SEARCH_PATHS,
	BINARY_EXTENSIONS,
	FILE_TYPE_EXTENSIONS,
	isBlockedSearchPath,
	matchesInclude,
	matchesFileType,
	walkFiles,
} from "./grep-helpers.js";

export interface GrepMatch {
	file: string;
	line: number;
	text: string;
	isContext?: boolean;
}

/**
 * Content search tool handler.
 *
 * Searches file contents using regex patterns with recursive directory walking.
 * Supports context lines, file type filtering, and inverted matching.
 * Uses streaming reads for files over 1 MB.
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
					description: "Maximum number of matching lines to return.",
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
		const config = getGrepConfig();
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
		const maxResults = (args.maxResults as number) || config.maxResults;
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
				if (stat.size > config.streamThreshold) {
					await searchFileStreaming(searchPath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
				} else {
					await searchFile(searchPath, regex, matches, maxResults, invert, beforeCtx, afterCtx);
				}
			} else if (stat.isDirectory()) {
				for await (const filePath of walkFiles(searchPath, include, fileType, context.signal)) {
					if (matches.length >= maxResults) break;

					let fileSize = 0;
					try {
						const fileStat = await fs.promises.stat(filePath);
						if (fileStat.size > config.maxFileSize) continue;
						fileSize = fileStat.size;
					} catch {
						continue;
					}

					if (fileSize > config.streamThreshold) {
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
 * Used for files under the stream threshold.
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

		if (prevLineNum >= 0 && lineNum > prevLineNum + 1 && (beforeCtx > 0 || afterCtx > 0)) {
			matches.push({ file: filePath, line: 0, text: "--", isContext: true });
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
