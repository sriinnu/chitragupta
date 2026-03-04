/**
 * MCP Tools — Episodic Developer Memory.
 *
 * Tool factories for recording and recalling episodic developer memories.
 * Episodes are tagged with error signatures, tool names, and file paths
 * for multi-dimensional recall when similar situations recur.
 *
 * @module mcp-tools-episodic
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";

// ─── Shared Helpers ────────────────────────────────────────────────────────

/** Truncate output to a safe MCP response size. */
function truncateForMcp(text: string, maxLen = 50_000): string {
	return text.length > maxLen ? text.slice(0, maxLen) + "\n...(truncated)" : text;
}

// ─── episodic_recall ───────────────────────────────────────────────────────

/**
 * Create the `episodic_recall` MCP tool.
 *
 * Searches episodic memory by any combination of error pattern, file context,
 * tool name, and free-text query. Merges results, deduplicates, and
 * auto-bumps recall counts for returned episodes.
 *
 * @param projectPath - Default project path for scoping queries.
 * @returns MCP tool handler for episodic recall.
 */
export function createEpisodicRecallTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "episodic_recall",
			description:
				"Recall episodic developer memories by error pattern, file context, tool name, or free-text query. " +
				"Use this when you encounter an error or situation that might have been seen before. " +
				"Returns past episodes with descriptions, solutions, and how often they've been recalled.",
			inputSchema: {
				type: "object" as const,
				properties: {
					error_pattern: {
						type: "string",
						description: "Error signature or raw error text to match. Will be auto-normalized.",
					},
					file_context: {
						type: "string",
						description: "File path being worked on — finds episodes related to this file.",
					},
					tool_name: {
						type: "string",
						description: "Tool name (e.g., 'vitest', 'tsc', 'bash') to filter by.",
					},
					query: {
						type: "string",
						description: "Free-text search across episode descriptions and solutions.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { EpisodicMemoryStore } = await import("@chitragupta/smriti/episodic-store");
				const store = new EpisodicMemoryStore();
				const seen = new Set<string>();
				const merged: Array<Record<string, unknown>> = [];

				const errorPattern = args.error_pattern ? String(args.error_pattern) : undefined;
				const fileContext = args.file_context ? String(args.file_context) : undefined;
				const toolName = args.tool_name ? String(args.tool_name) : undefined;
				const query = args.query ? String(args.query) : undefined;

				// Strategy: search by each provided dimension, merge and deduplicate
				if (errorPattern) {
					const normalized = EpisodicMemoryStore.normalizeErrorSignature(errorPattern);
					const results = store.recallByError(normalized);
					for (const ep of results) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
					// Also try text search with the raw error pattern
					const textResults = store.search(errorPattern, 5);
					for (const ep of textResults) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
				}

				if (fileContext) {
					const results = store.recallByFile(fileContext, 5);
					for (const ep of results) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
				}

				if (toolName) {
					const results = store.recallByTool(toolName, 5);
					for (const ep of results) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
				}

				if (query) {
					const results = store.search(query, 10);
					for (const ep of results) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
				}

				// Fallback: if no filters provided, return recent frequent errors
				if (!errorPattern && !fileContext && !toolName && !query) {
					const frequent = store.getFrequentErrors(10);
					for (const ep of frequent) {
						if (!seen.has(ep.id)) { seen.add(ep.id); merged.push(episodeToResult(ep)); }
					}
				}

				// Bump recall count for all returned episodes
				for (const ep of merged) {
					store.bumpRecallCount(ep.id as string);
				}

				if (merged.length === 0) {
					return {
						content: [{ type: "text", text: "No matching episodic memories found." }],
						_metadata: { action: "episodic_recall", resultCount: 0 },
					};
				}

				const lines: string[] = [`Found ${merged.length} episodic memor${merged.length === 1 ? "y" : "ies"}:\n`];
				for (const ep of merged) {
					lines.push(`## ${ep.description}`);
					if (ep.errorSignature) lines.push(`  Error: ${ep.errorSignature as string}`);
					if (ep.solution) lines.push(`  Solution: ${ep.solution as string}`);
					if (ep.toolName) lines.push(`  Tool: ${ep.toolName as string}`);
					if (ep.filePath) lines.push(`  File: ${ep.filePath as string}`);
					const tags = ep.tags as string[];
					if (tags.length > 0) lines.push(`  Tags: ${tags.join(", ")}`);
					lines.push(`  Recalled: ${ep.recallCount as number}x | Created: ${ep.createdAt as string}`);
					lines.push("");
				}

				return {
					content: [{ type: "text", text: truncateForMcp(lines.join("\n")) }],
					_metadata: {
						action: "episodic_recall",
						resultCount: merged.length,
						typed: { episodes: merged.slice(0, 20) },
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Episodic recall failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── episodic_record ───────────────────────────────────────────────────────

/**
 * Create the `episodic_record` MCP tool.
 *
 * Records a new episodic memory with optional error signature, tool name,
 * file path, solution, and tags. Error signatures are auto-normalized.
 *
 * @param projectPath - Default project path for scoping records.
 * @returns MCP tool handler for episodic recording.
 */
export function createEpisodicRecordTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "episodic_record",
			description:
				"Record an episodic developer memory — a problem, fix, discovery, or pattern. " +
				"Tag it with error signature, tool name, file path, and solution for future recall. " +
				"Use this after fixing an error, discovering a workaround, or learning something reusable.",
			inputSchema: {
				type: "object" as const,
				properties: {
					description: {
						type: "string",
						description: "What happened — the context and situation (required).",
					},
					solution: {
						type: "string",
						description: "The fix or resolution, if applicable.",
					},
					error_signature: {
						type: "string",
						description: "Error signature or raw error text. Will be auto-normalized for matching.",
					},
					tool_name: {
						type: "string",
						description: "Tool involved (e.g., 'vitest', 'tsc', 'bash').",
					},
					file_path: {
						type: "string",
						description: "File being worked on.",
					},
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Free-form tags for categorization.",
					},
				},
				required: ["description"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { EpisodicMemoryStore } = await import("@chitragupta/smriti/episodic-store");
				const store = new EpisodicMemoryStore();

				const description = String(args.description ?? "");
				if (!description.trim()) {
					return {
						content: [{ type: "text", text: "Error: 'description' is required." }],
						isError: true,
					};
				}

				const rawError = args.error_signature ? String(args.error_signature) : undefined;
				const normalizedError = rawError
					? EpisodicMemoryStore.normalizeErrorSignature(rawError)
					: undefined;

				const rawTags = Array.isArray(args.tags) ? args.tags.map(String) : [];

				const id = store.record({
					project: projectPath,
					description,
					solution: args.solution ? String(args.solution) : undefined,
					errorSignature: normalizedError,
					toolName: args.tool_name ? String(args.tool_name) : undefined,
					filePath: args.file_path ? String(args.file_path) : undefined,
					tags: rawTags,
				});

				const summary = [
					`Episodic memory recorded (ID: ${id})`,
					`  Description: ${description.slice(0, 200)}${description.length > 200 ? "..." : ""}`,
				];
				if (normalizedError) summary.push(`  Error signature: ${normalizedError}`);
				if (args.tool_name) summary.push(`  Tool: ${args.tool_name as string}`);
				if (args.file_path) summary.push(`  File: ${args.file_path as string}`);
				if (rawTags.length > 0) summary.push(`  Tags: ${rawTags.join(", ")}`);

				return {
					content: [{ type: "text", text: summary.join("\n") }],
					_metadata: {
						action: "episodic_record",
						typed: { id, project: projectPath, errorSignature: normalizedError },
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Episodic record failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert an Episode to a plain result object for MCP metadata. */
function episodeToResult(ep: {
	id: string;
	createdAt: string;
	project: string;
	errorSignature: string | null;
	toolName: string | null;
	filePath: string | null;
	description: string;
	solution: string | null;
	tags: string[];
	recallCount: number;
	lastRecalled: string | null;
}): Record<string, unknown> {
	return {
		id: ep.id,
		createdAt: ep.createdAt,
		project: ep.project,
		errorSignature: ep.errorSignature,
		toolName: ep.toolName,
		filePath: ep.filePath,
		description: ep.description,
		solution: ep.solution,
		tags: ep.tags,
		recallCount: ep.recallCount,
		lastRecalled: ep.lastRecalled,
	};
}
