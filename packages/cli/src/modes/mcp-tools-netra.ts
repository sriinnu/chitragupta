/**
 * MCP Tools -- Netra Repo Map.
 *
 * Exposes the repo map generator from @chitragupta/netra as an MCP tool.
 * The tool scans the project directory, extracts exported symbols, and
 * returns a compact text summary suitable for LLM context injection.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";

/**
 * Create the `repo_map` MCP tool.
 *
 * Calls {@link generateRepoMap} from `@chitragupta/netra` to produce a
 * file-tree summary with exported symbols. Returns both a human-readable
 * text overview and structured entry data.
 *
 * @param projectPath - Absolute path to the project root directory.
 * @returns An MCP tool handler for `repo_map`.
 */
export function createRepoMapTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "repo_map",
			description:
				"Generate a compact file-tree summary of the project directory, " +
				"highlighting key source files and their exports. Useful for giving " +
				"LLM planners a quick overview of the codebase structure.",
			inputSchema: {
				type: "object",
				properties: {
					maxFiles: {
						type: "number",
						description: "Maximum number of files to include. Default: 50, max: 200.",
					},
					extensions: {
						type: "array",
						items: { type: "string" },
						description:
							'File extensions to include (e.g. [".ts", ".py"]). ' +
							"Default: .ts, .tsx, .js, .jsx, .py, .rs, .go",
					},
					query: {
						type: "string",
						description:
							"Optional query to filter files by path substring. " +
							"When provided, only files whose path contains the query are included.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { generateRepoMap } = await import("@chitragupta/netra");

				const maxFiles = args.maxFiles != null
					? Math.min(200, Math.max(1, Number(args.maxFiles) || 50))
					: undefined;

				const extensions = Array.isArray(args.extensions)
					? (args.extensions as string[]).filter((e) => typeof e === "string" && e.startsWith("."))
					: undefined;

				const result = generateRepoMap(projectPath, { maxFiles, extensions });

				// Optional query filter: narrow entries by path substring
				const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
				if (query) {
					const filtered = result.entries.filter((e) =>
						e.filePath.toLowerCase().includes(query),
					);
					const lines = [
						`Repository Map (query: "${query}", ${filtered.length} of ${result.totalFiles} files):`,
					];
					for (const entry of filtered) {
						const exportStr = entry.exports.length > 0 ? ` [${entry.exports.join(", ")}]` : "";
						lines.push(`  ${entry.filePath}${exportStr}`);
					}
					if (filtered.length === 0) {
						lines.push("  (no files matched the query)");
					}

					return {
						content: [{ type: "text", text: lines.join("\n") }],
						_metadata: {
							typed: {
								totalFiles: result.totalFiles,
								matchedFiles: filtered.length,
								entries: filtered,
							},
						},
					};
				}

				return {
					content: [{ type: "text", text: result.text }],
					_metadata: {
						typed: {
							totalFiles: result.totalFiles,
							shownFiles: result.entries.length,
							entries: result.entries,
						},
					},
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `repo_map failed: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}
