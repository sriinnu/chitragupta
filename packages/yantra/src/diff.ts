/**
 * @chitragupta/yantra — File diff tool.
 *
 * Computes unified diffs between two files or between file content and a
 * string. Implements the Myers diff algorithm (longest common subsequence)
 * from scratch, producing standard unified diff output with context lines.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

// ─── Myers Diff Algorithm ───────────────────────────────────────────────────

interface DiffEdit {
	type: "equal" | "insert" | "delete";
	line: string;
}

/**
 * Compute the shortest edit script between two arrays of lines using
 * the Myers diff algorithm (An O(ND) Difference Algorithm).
 *
 * This implementation uses a linear-space refinement: it traces the
 * shortest path through the edit graph and then backtracks to produce
 * the edit script.
 */
function myersDiff(oldLines: string[], newLines: string[]): DiffEdit[] {
	const n = oldLines.length;
	const m = newLines.length;
	const max = n + m;

	// Edge case: both empty
	if (max === 0) return [];

	// Edge case: one side empty
	if (n === 0) {
		return newLines.map((line) => ({ type: "insert" as const, line }));
	}
	if (m === 0) {
		return oldLines.map((line) => ({ type: "delete" as const, line }));
	}

	// V stores the furthest reaching x for each diagonal k
	// Diagonal k = x - y, so y = x - k
	// We store V indexed by k + max to avoid negative indices
	const v = new Int32Array(2 * max + 1);
	v.fill(-1);
	v[max + 1] = 0;

	// Trace stores the V snapshot at each step d for backtracking
	const trace: Int32Array[] = [];

	outer:
	for (let d = 0; d <= max; d++) {
		// Save a copy of V for backtracking
		trace.push(v.slice());

		for (let k = -d; k <= d; k += 2) {
			let x: number;

			// Decide whether to go down or right
			if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
				// Move down (insert)
				x = v[k + 1 + max];
			} else {
				// Move right (delete)
				x = v[k - 1 + max] + 1;
			}

			let y = x - k;

			// Follow diagonal (equal lines)
			while (x < n && y < m && oldLines[x] === newLines[y]) {
				x++;
				y++;
			}

			v[k + max] = x;

			// Check if we've reached the end
			if (x >= n && y >= m) {
				break outer;
			}
		}
	}

	// Backtrack through the trace to build the edit script
	const edits: DiffEdit[] = [];
	let x = n;
	let y = m;

	for (let d = trace.length - 1; d >= 0; d--) {
		const vPrev = trace[d];
		const k = x - y;

		let prevK: number;
		if (k === -d || (k !== d && vPrev[k - 1 + max] < vPrev[k + 1 + max])) {
			prevK = k + 1;
		} else {
			prevK = k - 1;
		}

		const prevX = vPrev[prevK + max];
		const prevY = prevX - prevK;

		// Diagonal moves (equal lines)
		while (x > prevX && y > prevY) {
			x--;
			y--;
			edits.unshift({ type: "equal", line: oldLines[x] });
		}

		if (d > 0) {
			if (x === prevX) {
				// Insert
				y--;
				edits.unshift({ type: "insert", line: newLines[y] });
			} else {
				// Delete
				x--;
				edits.unshift({ type: "delete", line: oldLines[x] });
			}
		}
	}

	return edits;
}

// ─── Unified Diff Formatting ────────────────────────────────────────────────

interface DiffHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: string[];
}

/**
 * Group diff edits into hunks with the specified number of context lines.
 */
function createHunks(edits: DiffEdit[], contextLines: number): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let currentHunk: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;
	let lastChangeIdx = -Infinity;

	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		const isChange = edit.type !== "equal";

		if (isChange) {
			// Check if we need to start a new hunk or extend the current one
			if (currentHunk === null || i - lastChangeIdx > contextLines * 2) {
				// Finish the current hunk with trailing context
				if (currentHunk !== null) {
					// Add trailing context from already-processed equal lines
					// (they were already added)
					hunks.push(currentHunk);
				}

				// Start a new hunk with leading context
				currentHunk = {
					oldStart: Math.max(1, oldLine - contextLines + 1),
					oldCount: 0,
					newStart: Math.max(1, newLine - contextLines + 1),
					newCount: 0,
					lines: [],
				};

				// Add leading context lines
				const contextStart = Math.max(0, i - contextLines);
				for (let j = contextStart; j < i; j++) {
					if (edits[j].type === "equal") {
						currentHunk.lines.push(" " + edits[j].line);
						currentHunk.oldCount++;
						currentHunk.newCount++;
					}
				}
			}

			lastChangeIdx = i;
		}

		if (currentHunk !== null) {
			const distFromLastChange = i - lastChangeIdx;

			if (isChange) {
				if (edit.type === "delete") {
					currentHunk.lines.push("-" + edit.line);
					currentHunk.oldCount++;
				} else if (edit.type === "insert") {
					currentHunk.lines.push("+" + edit.line);
					currentHunk.newCount++;
				}
			} else if (distFromLastChange <= contextLines) {
				// Trailing context
				currentHunk.lines.push(" " + edit.line);
				currentHunk.oldCount++;
				currentHunk.newCount++;
			}
		}

		if (edit.type === "equal" || edit.type === "delete") {
			oldLine++;
		}
		if (edit.type === "equal" || edit.type === "insert") {
			newLine++;
		}
	}

	if (currentHunk !== null) {
		hunks.push(currentHunk);
	}

	return hunks;
}

/**
 * Format hunks into a unified diff string.
 */
function formatUnifiedDiff(
	oldName: string,
	newName: string,
	hunks: DiffHunk[],
): string {
	if (hunks.length === 0) {
		return ""; // No differences
	}

	const lines: string[] = [];
	lines.push(`--- ${oldName}`);
	lines.push(`+++ ${newName}`);

	for (const hunk of hunks) {
		lines.push(
			`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
		);
		lines.push(...hunk.lines);
	}

	return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute a unified diff between two strings (as line arrays).
 *
 * @param oldContent  The original content.
 * @param newContent  The modified content.
 * @param oldName     Label for the original (e.g., file path).
 * @param newName     Label for the modified (e.g., file path).
 * @param contextLines  Number of context lines around changes. Defaults to 3.
 */
export function computeUnifiedDiff(
	oldContent: string,
	newContent: string,
	oldName: string = "a",
	newName: string = "b",
	contextLines: number = 3,
): string {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");

	const edits = myersDiff(oldLines, newLines);
	const hunks = createHunks(edits, contextLines);

	return formatUnifiedDiff(oldName, newName, hunks);
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

function resolvePath(filePath: string, context: ToolContext): string {
	if (path.isAbsolute(filePath)) return filePath;
	return path.resolve(context.workingDirectory, filePath);
}

/**
 * File diff tool handler.
 *
 * Computes unified diffs between two files, or between a file and
 * inline content. Returns standard unified diff format with context lines.
 *
 * @example
 * ```ts
 * const result = await diffTool.execute(
 *   { file_a: "old.ts", file_b: "new.ts", contextLines: 5 },
 *   context,
 * );
 * ```
 */
export const diffTool: ToolHandler = {
	definition: {
		name: "diff",
		description:
			"Compute a unified diff between two files, or between a file and provided content. " +
			"Returns standard unified diff format with context lines.",
		inputSchema: {
			type: "object",
			properties: {
				file_a: {
					type: "string",
					description: "Path to the first (original) file.",
				},
				file_b: {
					type: "string",
					description: "Path to the second (modified) file. Mutually exclusive with 'content_b'.",
				},
				content_b: {
					type: "string",
					description:
						"String content to compare against file_a. Use this when you have " +
						"the modified content as a string rather than a file.",
				},
				contextLines: {
					type: "number",
					description: "Number of context lines around each change. Defaults to 3.",
				},
			},
			required: ["file_a"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const fileAPath = args.file_a as string | undefined;
		if (!fileAPath) {
			return { content: "Error: 'file_a' argument is required.", isError: true };
		}

		const resolvedA = resolvePath(fileAPath, context);
		const ctxLines = (args.contextLines as number) || 3;

		// Read file A
		let contentA: string;
		try {
			contentA = await fs.promises.readFile(resolvedA, "utf-8");
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return { content: `Error: File not found: ${resolvedA}`, isError: true };
			}
			return { content: `Error reading file: ${err.message}`, isError: true };
		}

		// Get content B from either a file or inline content
		let contentB: string;
		let labelB: string;

		if (args.file_b) {
			const resolvedB = resolvePath(args.file_b as string, context);
			labelB = resolvedB;
			try {
				contentB = await fs.promises.readFile(resolvedB, "utf-8");
			} catch (error) {
				const err = error as NodeJS.ErrnoException;
				if (err.code === "ENOENT") {
					return { content: `Error: File not found: ${resolvedB}`, isError: true };
				}
				return { content: `Error reading file: ${err.message}`, isError: true };
			}
		} else if (typeof args.content_b === "string") {
			contentB = args.content_b;
			labelB = "(provided content)";
		} else {
			return {
				content: "Error: Either 'file_b' or 'content_b' must be provided.",
				isError: true,
			};
		}

		// Compute diff
		const diff = computeUnifiedDiff(contentA, contentB, resolvedA, labelB, ctxLines);

		if (!diff) {
			return {
				content: "No differences found.",
				metadata: { identical: true },
			};
		}

		// Count added/removed lines
		const diffLines = diff.split("\n");
		let additions = 0;
		let deletions = 0;
		for (const line of diffLines) {
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			if (line.startsWith("-") && !line.startsWith("---")) deletions++;
		}

		return {
			content: diff,
			metadata: {
				additions,
				deletions,
				identical: false,
			},
		};
	},
};
