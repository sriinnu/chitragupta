/**
 * @chitragupta/yantra — Surgical file edit tool.
 *
 * Performs search-and-replace edits within a file. Each edit specifies an
 * exact oldText to find and a newText to replace it with. Fails if any
 * oldText is not found, preventing silent failures.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

interface Edit {
	oldText: string;
	newText: string;
}

function resolvePath(filePath: string, context: ToolContext): string {
	if (path.isAbsolute(filePath)) return filePath;
	return path.resolve(context.workingDirectory, filePath);
}

// ─── Path Security (Belt-and-Suspenders) ─────────────────────────────────

/**
 * Sensitive paths that should never be edited by the agent.
 * Defence-in-depth: blocks edits even if dharma policy allows them.
 */
const BLOCKED_EDIT_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers", "/etc/hosts",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
];

/**
 * System directories that should never be edited.
 */
const BLOCKED_EDIT_DIRS = [
	"/bin", "/sbin", "/usr/bin", "/usr/sbin",
	"/boot", "/dev", "/proc", "/sys",
];

/**
 * Validate that a resolved path is safe to edit.
 * Returns an error ToolResult if blocked, or null if allowed.
 */
function validateEditPath(inputPath: string, resolvedPath: string): ToolResult | null {
	// Block path traversal via ".." components
	const normalized = path.normalize(inputPath);
	if (normalized.includes("..")) {
		return { content: "Error: path traversal not allowed", isError: true };
	}

	// Block known sensitive paths
	const lowerResolved = resolvedPath.toLowerCase();
	for (const bp of BLOCKED_EDIT_PATHS) {
		if (lowerResolved.includes(bp)) {
			return { content: `Error: edit of sensitive path denied: ${inputPath}`, isError: true };
		}
	}

	// Block system directories
	for (const dir of BLOCKED_EDIT_DIRS) {
		if (resolvedPath.startsWith(dir + "/") || resolvedPath === dir) {
			return { content: `Error: edit in system directory denied: ${inputPath}`, isError: true };
		}
	}

	return null;
}

/**
 * Generate a simple diff-like output showing what changed.
 */
function formatDiff(oldText: string, newText: string, editIndex: number): string {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	const parts: string[] = [`--- Edit ${editIndex + 1} ---`];

	for (const line of oldLines) {
		parts.push(`- ${line}`);
	}
	for (const line of newLines) {
		parts.push(`+ ${line}`);
	}

	return parts.join("\n");
}

/**
 * Surgical file edit tool handler.
 *
 * Performs exact search-and-replace edits within a file.
 * Fails if any `oldText` is not found or appears multiple times,
 * preventing silent failures and ambiguous replacements.
 *
 * @example
 * ```ts
 * const result = await editTool.execute({
 *   path: "src/config.ts",
 *   edits: [{ oldText: "port: 3000", newText: "port: 8080" }],
 * }, context);
 * ```
 */
export const editTool: ToolHandler = {
	definition: {
		name: "edit",
		description:
			"Perform surgical text replacements in a file. Each edit specifies an " +
			"exact 'oldText' string to find and a 'newText' string to replace it with. " +
			"Fails if any oldText is not found in the file.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file to edit.",
				},
				edits: {
					type: "array",
					description: "Array of edits to apply.",
					items: {
						type: "object",
						properties: {
							oldText: {
								type: "string",
								description: "The exact text to search for.",
							},
							newText: {
								type: "string",
								description: "The replacement text.",
							},
						},
						required: ["oldText", "newText"],
					},
				},
			},
			required: ["path", "edits"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const filePath = args.path as string | undefined;
		const edits = args.edits as Edit[] | undefined;

		if (!filePath) {
			return { content: "Error: 'path' argument is required.", isError: true };
		}
		if (!edits || !Array.isArray(edits) || edits.length === 0) {
			return { content: "Error: 'edits' must be a non-empty array.", isError: true };
		}

		const resolved = resolvePath(filePath, context);

		// Belt-and-suspenders: block sensitive/system paths even if dharma allows them
		const pathError = validateEditPath(filePath, resolved);
		if (pathError) return pathError;

		try {
			let content = await fs.promises.readFile(resolved, "utf-8");
			const diffs: string[] = [];

			for (let i = 0; i < edits.length; i++) {
				const edit = edits[i];

				if (edit.oldText === undefined || edit.oldText === null) {
					return {
						content: `Error: Edit ${i + 1} is missing 'oldText'.`,
						isError: true,
					};
				}

				const idx = content.indexOf(edit.oldText);
				if (idx === -1) {
					// Show a snippet of the file to help debug
					const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
					return {
						content:
							`Error: Edit ${i + 1} failed — oldText not found in ${resolved}.\n\n` +
							`Searched for:\n${edit.oldText}\n\n` +
							`File preview:\n${preview}`,
						isError: true,
					};
				}

				// Check for ambiguity: multiple occurrences
				const secondIdx = content.indexOf(edit.oldText, idx + 1);
				if (secondIdx !== -1) {
					return {
						content:
							`Error: Edit ${i + 1} failed — oldText appears multiple times in ${resolved}. ` +
							`Provide more surrounding context to make the match unique.`,
						isError: true,
					};
				}

				diffs.push(formatDiff(edit.oldText, edit.newText, i));
				content = content.slice(0, idx) + edit.newText + content.slice(idx + edit.oldText.length);
			}

			await fs.promises.writeFile(resolved, content, "utf-8");

			return {
				content: `Applied ${edits.length} edit(s) to ${resolved}:\n\n${diffs.join("\n\n")}`,
				metadata: {
					path: resolved,
					editsApplied: edits.length,
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
			return { content: `Error editing file: ${err.message}`, isError: true };
		}
	},
};
