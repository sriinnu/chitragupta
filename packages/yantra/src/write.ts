/**
 * @chitragupta/yantra — File write tool.
 *
 * Creates or overwrites files. Automatically creates parent directories
 * if they do not exist. Returns confirmation with file path and byte size.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

function resolvePath(filePath: string, context: ToolContext): string {
	if (path.isAbsolute(filePath)) return filePath;
	return path.resolve(context.workingDirectory, filePath);
}

// ─── Path Security (Belt-and-Suspenders) ─────────────────────────────────

/**
 * Sensitive paths that should never be written by the agent.
 * Defence-in-depth: blocks writes even if dharma policy allows them.
 */
const BLOCKED_WRITE_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers", "/etc/hosts",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
];

/**
 * System directories that should never be written to.
 */
const BLOCKED_WRITE_DIRS = [
	"/bin", "/sbin", "/usr/bin", "/usr/sbin",
	"/boot", "/dev", "/proc", "/sys",
];

/**
 * Validate that a resolved path is safe to write.
 * Returns an error ToolResult if blocked, or null if allowed.
 */
function validateWritePath(inputPath: string, resolvedPath: string): ToolResult | null {
	// Block path traversal via ".." components
	const normalized = path.normalize(inputPath);
	if (normalized.includes("..")) {
		return { content: "Error: path traversal not allowed", isError: true };
	}

	// Block known sensitive paths
	const lowerResolved = resolvedPath.toLowerCase();
	for (const bp of BLOCKED_WRITE_PATHS) {
		if (lowerResolved.includes(bp)) {
			return { content: `Error: write to sensitive path denied: ${inputPath}`, isError: true };
		}
	}

	// Block system directories
	for (const dir of BLOCKED_WRITE_DIRS) {
		if (resolvedPath.startsWith(dir + "/") || resolvedPath === dir) {
			return { content: `Error: write to system directory denied: ${inputPath}`, isError: true };
		}
	}

	return null;
}

/**
 * File write tool handler.
 *
 * Creates or overwrites files with the given content.
 * Automatically creates parent directories if they do not exist.
 *
 * @example
 * ```ts
 * const result = await writeTool.execute(
 *   { path: "src/new-file.ts", content: "export const x = 1;" },
 *   context,
 * );
 * ```
 */
export const writeTool: ToolHandler = {
	definition: {
		name: "write",
		description:
			"Create or overwrite a file with the given content. " +
			"Parent directories are created automatically if they do not exist.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file to write.",
				},
				content: {
					type: "string",
					description: "The content to write to the file.",
				},
			},
			required: ["path", "content"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const filePath = args.path as string | undefined;
		const content = args.content as string | undefined;

		if (!filePath) {
			return { content: "Error: 'path' argument is required.", isError: true };
		}
		if (content === undefined || content === null) {
			return { content: "Error: 'content' argument is required.", isError: true };
		}

		const resolved = resolvePath(filePath, context);

		// Belt-and-suspenders: block sensitive/system paths even if dharma allows them
		const pathError = validateWritePath(filePath, resolved);
		if (pathError) return pathError;

		try {
			// Create parent directories if needed
			const dir = path.dirname(resolved);
			await fs.promises.mkdir(dir, { recursive: true });

			// Write the file
			await fs.promises.writeFile(resolved, content, "utf-8");

			const stat = await fs.promises.stat(resolved);
			const lineCount = content.split("\n").length;

			return {
				content: `File written: ${resolved} (${stat.size} bytes, ${lineCount} lines)`,
				metadata: {
					path: resolved,
					size: stat.size,
					lines: lineCount,
				},
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "EACCES") {
				return { content: `Error: Permission denied: ${resolved}`, isError: true };
			}
			return { content: `Error writing file: ${err.message}`, isError: true };
		}
	},
};
