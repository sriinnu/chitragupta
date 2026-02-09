/**
 * @chitragupta/yantra — File read tool.
 *
 * Reads file contents with optional line range. Returns content with
 * line numbers prepended for easy reference. Truncates output if the
 * file exceeds 10 000 lines.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

/** Configurable limits for the read tool. */
export interface ReadConfig {
	maxLines?: number;
}

const DEFAULT_READ_CONFIG: Required<ReadConfig> = {
	maxLines: 10_000,
};

let _readConfig = { ...DEFAULT_READ_CONFIG };

/** Update read tool configuration at runtime. */
export function configureRead(config: ReadConfig): void {
	_readConfig = { ...DEFAULT_READ_CONFIG, ...config };
}

function resolvePath(filePath: string, context: ToolContext): string {
	if (path.isAbsolute(filePath)) return filePath;
	return path.resolve(context.workingDirectory, filePath);
}

// ─── Path Security (Belt-and-Suspenders) ─────────────────────────────────

/**
 * Sensitive paths that should never be read by the agent, regardless of
 * what the dharma policy engine decides. This is a defence-in-depth measure.
 */
const BLOCKED_READ_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
];

/**
 * Validate that a resolved path is safe to read.
 * Returns an error ToolResult if blocked, or null if allowed.
 */
function validateReadPath(inputPath: string, resolvedPath: string): ToolResult | null {
	// Block path traversal via ".." components
	const normalized = path.normalize(inputPath);
	if (normalized.includes("..")) {
		return { content: "Error: path traversal not allowed", isError: true };
	}

	// Block known sensitive paths
	const lowerResolved = resolvedPath.toLowerCase();
	for (const bp of BLOCKED_READ_PATHS) {
		if (lowerResolved.includes(bp)) {
			return { content: `Error: access to sensitive path denied: ${inputPath}`, isError: true };
		}
	}

	return null;
}

/**
 * File read tool handler.
 *
 * Reads file contents with optional line range selection.
 * Returns line-numbered output; truncates at 10,000 lines.
 *
 * @example
 * ```ts
 * const result = await readTool.execute(
 *   { path: "src/index.ts", startLine: 1, endLine: 50 },
 *   context,
 * );
 * ```
 */
export const readTool: ToolHandler = {
	definition: {
		name: "read",
		description:
			"Read the contents of a file. Returns the content with line numbers. " +
			"Optionally specify startLine and endLine to read a range.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file to read.",
				},
				startLine: {
					type: "number",
					description: "First line to read (1-based, inclusive). Defaults to 1.",
				},
				endLine: {
					type: "number",
					description: "Last line to read (1-based, inclusive). Defaults to end of file.",
				},
			},
			required: ["path"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const filePath = args.path as string | undefined;
		if (!filePath) {
			return { content: "Error: 'path' argument is required.", isError: true };
		}

		const resolved = resolvePath(filePath, context);

		// Belt-and-suspenders: block sensitive paths even if dharma allows them
		const pathError = validateReadPath(filePath, resolved);
		if (pathError) return pathError;

		try {
			const raw = await fs.promises.readFile(resolved, "utf-8");
			const allLines = raw.split("\n");

			const startLine = Math.max(1, (args.startLine as number) || 1);
			const endLine = Math.min(
				allLines.length,
				(args.endLine as number) || allLines.length,
			);

			let lines = allLines.slice(startLine - 1, endLine);
			let truncated = false;

			if (lines.length > _readConfig.maxLines) {
				lines = lines.slice(0, _readConfig.maxLines);
				truncated = true;
			}

			const padWidth = String(startLine + lines.length - 1).length;
			const numbered = lines.map((line, i) => {
				const lineNum = String(startLine + i).padStart(padWidth, " ");
				return `${lineNum}\t${line}`;
			});

			let output = numbered.join("\n");

			if (truncated) {
				output += `\n\n[Truncated: showing ${_readConfig.maxLines} of ${allLines.length} total lines]`;
			}

			const rangeInfo =
				startLine !== 1 || endLine !== allLines.length
					? ` (lines ${startLine}-${Math.min(endLine, startLine + lines.length - 1)})`
					: "";

			return {
				content: output,
				metadata: {
					path: resolved,
					totalLines: allLines.length,
					displayedLines: lines.length,
					range: `${startLine}-${startLine + lines.length - 1}`,
					truncated,
				},
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: File not found: ${resolved}`, isError: true };
			}
			if (err.code === "EACCES") {
				return { content: `Error: Permission denied: ${resolved}`, isError: true };
			}
			if (err.code === "EISDIR") {
				return { content: `Error: Path is a directory, not a file: ${resolved}`, isError: true };
			}
			return { content: `Error reading file: ${err.message}`, isError: true };
		}
	},
};
