/**
 * MCP Tools -- Netra (Repo Map + Semantic Graph Query).
 *
 * Exposes netra tools as MCP tools:
 * - `repo_map`: compact file-tree summary with exported symbols.
 * - `semantic_graph_query`: query code structure by symbol/file, with depth and direction.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { QueryDirection } from "@chitragupta/netra";

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

// ─── Semantic Graph Query Tool ─────────────────────────────────────────────

const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["upstream", "downstream", "both"]);

/**
 * Format a subgraph query result as human-readable text.
 *
 * Produces a compact summary with matched symbols, file list with
 * symbol annotations, and edge descriptions.
 */
function formatGraphResult(
	result: {
		entity: string;
		direction: string;
		depth: number;
		matchedSymbols: Array<{ name: string; kind: string; filePath: string; line: number; exported: boolean }>;
		subgraph: {
			nodes: Array<{ filePath: string; symbols: Array<{ name: string; kind: string; exported: boolean }>; rankScore: number; depth: number }>;
			edges: Array<{ from: string; to: string }>;
			totalFiles: number;
		};
	},
): string {
	const lines: string[] = [];
	const { entity, direction, depth, matchedSymbols, subgraph } = result;

	lines.push(`Semantic Graph Query: "${entity}" (direction: ${direction}, depth: ${depth})`);
	lines.push(`Total files in graph: ${subgraph.totalFiles}`);
	lines.push("");

	// Matched symbols
	if (matchedSymbols.length > 0) {
		lines.push(`Matched symbols (${matchedSymbols.length}):`);
		for (const sym of matchedSymbols.slice(0, 20)) {
			const exp = sym.exported ? "exported" : "internal";
			lines.push(`  ${sym.kind} ${sym.name} (${exp}) \u2014 ${sym.filePath}:${sym.line}`);
		}
		if (matchedSymbols.length > 20) {
			lines.push(`  ... and ${matchedSymbols.length - 20} more`);
		}
		lines.push("");
	}

	// Nodes sorted by depth then rank
	const sorted = [...subgraph.nodes].sort((a, b) => a.depth - b.depth || b.rankScore - a.rankScore);
	lines.push(`Related files (${sorted.length}):`);
	for (const node of sorted.slice(0, 50)) {
		const syms = node.symbols.filter((s) => s.exported).map((s) => s.name).slice(0, 5);
		const symStr = syms.length > 0 ? ` [${syms.join(", ")}]` : "";
		const rankStr = node.rankScore > 0 ? ` (rank: ${node.rankScore.toFixed(3)})` : "";
		lines.push(`  [depth=${node.depth}] ${node.filePath}${symStr}${rankStr}`);
	}
	if (sorted.length > 50) {
		lines.push(`  ... and ${sorted.length - 50} more files`);
	}

	// Edges
	if (subgraph.edges.length > 0) {
		lines.push("");
		lines.push(`Import edges (${subgraph.edges.length}):`);
		for (const edge of subgraph.edges.slice(0, 30)) {
			lines.push(`  ${edge.from} \u2192 ${edge.to}`);
		}
		if (subgraph.edges.length > 30) {
			lines.push(`  ... and ${subgraph.edges.length - 30} more edges`);
		}
	}

	return lines.join("\n");
}

/**
 * Create the `semantic_graph_query` MCP tool.
 *
 * Builds a semantic graph of the project's source code and allows
 * agents to query code structure: find all files/symbols related to
 * an entity (class, function, file), with configurable depth and direction.
 *
 * @param projectPath - Absolute path to the project root directory.
 * @returns An MCP tool handler for `semantic_graph_query`.
 */
export function createSemanticGraphQueryTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "semantic_graph_query",
			description:
				"Query the code structure graph. Find all files and symbols that depend on " +
				"or are depended upon by a given entity (class, function, type, or file path). " +
				"Supports depth-limited traversal in upstream, downstream, or both directions. " +
				'Example: entity="UserAuthentication", depth=2, direction="upstream".',
			inputSchema: {
				type: "object",
				properties: {
					entity: {
						type: "string",
						description:
							'Symbol name (e.g. "UserAuthentication", "buildImportGraph") or ' +
							'relative file path (e.g. "src/auth.ts"). Case-insensitive substring match for symbols.',
					},
					depth: {
						type: "number",
						description: "How many levels of dependencies to traverse. Default: 1, max: 5.",
					},
					direction: {
						type: "string",
						enum: ["upstream", "downstream", "both"],
						description:
							'"upstream" = who depends on this entity, ' +
							'"downstream" = what this entity depends on, ' +
							'"both" = both directions. Default: "both".',
					},
				},
				required: ["entity"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { buildSemanticGraph } = await import("@chitragupta/netra");

				const entity = typeof args.entity === "string" ? args.entity.trim() : "";
				if (!entity) {
					return {
						content: [{ type: "text", text: "Error: 'entity' parameter is required and must be a non-empty string." }],
						isError: true,
					};
				}

				const depth = args.depth != null
					? Math.min(5, Math.max(1, Number(args.depth) || 1))
					: 1;

				const rawDir = typeof args.direction === "string" ? args.direction.toLowerCase() : "both";
				const direction: QueryDirection = VALID_DIRECTIONS.has(rawDir)
					? rawDir as QueryDirection
					: "both";

				const graph = buildSemanticGraph(projectPath);
				const result = graph.query(entity, depth, direction);
				const text = formatGraphResult(result);

				return {
					content: [{ type: "text", text }],
					_metadata: {
						typed: {
							entity: result.entity,
							direction: result.direction,
							depth: result.depth,
							matchedSymbols: result.matchedSymbols.length,
							nodesCount: result.subgraph.nodes.length,
							edgesCount: result.subgraph.edges.length,
							totalFiles: result.subgraph.totalFiles,
						},
					},
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `semantic_graph_query failed: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}
