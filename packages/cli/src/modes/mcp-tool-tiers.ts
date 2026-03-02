/**
 * @chitragupta/cli — MCP Tool Tier Classification.
 *
 * Classifies tools into 3 tiers for context efficiency:
 * - essential: Always full descriptions (~8 tools)
 * - standard: Short descriptions, full on first use (~15 tools)
 * - advanced: Name only, full on first use (~15 tools)
 *
 * Activated via CHITRAGUPTA_MCP_COMPACT_TOOLS=true environment variable.
 * Reduces tool description token count by ~50%.
 *
 * @module
 */

import type { McpToolHandler } from "@chitragupta/tantra";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Tool tier classification. */
export type ToolTier = "essential" | "standard" | "advanced";

/** Tier metadata for a tool. */
export interface ToolTierMeta {
	tier: ToolTier;
	shortDescription: string;
}

// ─── Tier Sets ──────────────────────────────────────────────────────────────

/** Essential tools — always get full descriptions. */
const ESSENTIAL_TOOLS = new Set([
	"chitragupta_recall",
	"chitragupta_memory_search",
	"read", "write", "edit", "bash", "grep", "find", "ls",
	"chitragupta_record_conversation",
	"memory",
	"project_analysis",
]);

/** Standard tools — short description, full on first use. */
const STANDARD_TOOLS = new Set([
	"akasha_traces", "akasha_deposit",
	"chitragupta_session_list", "chitragupta_session_show",
	"chitragupta_context", "chitragupta_handover", "chitragupta_handover_since",
	"chitragupta_day_show", "chitragupta_day_list", "chitragupta_day_search",
	"chitragupta_memory_changes_since",
	"skills_find", "skills_list", "skills_recommend",
	"diff", "watch",
]);

/** Short descriptions for standard-tier tools. */
const SHORT_DESCRIPTIONS: Record<string, string> = {
	"akasha_traces": "Query shared knowledge traces by topic.",
	"akasha_deposit": "Record a solution, pattern, warning, or correction.",
	"chitragupta_session_list": "List recent sessions for this project.",
	"chitragupta_session_show": "Show a session's full conversation by ID.",
	"chitragupta_context": "Load memory context (global + project + recent).",
	"chitragupta_handover": "Generate work-state handover for context continuity.",
	"chitragupta_handover_since": "Incremental handover (delta since cursor).",
	"chitragupta_day_show": "Show consolidated day file for a date.",
	"chitragupta_day_list": "List available day files.",
	"chitragupta_day_search": "Search across all day files.",
	"chitragupta_memory_changes_since": "Detect memory changes since timestamp.",
	"skills_find": "Find skills matching a natural language query.",
	"skills_list": "List all registered skills.",
	"skills_recommend": "Get smart skill recommendation for a task.",
	"diff": "Compute unified diff between files or content.",
	"watch": "Watch files/directories for changes.",
};

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Get the tier for a tool by name.
 *
 * @param toolName - Tool name to classify.
 * @returns The tier classification.
 */
export function getToolTier(toolName: string): ToolTier {
	if (ESSENTIAL_TOOLS.has(toolName)) return "essential";
	if (STANDARD_TOOLS.has(toolName)) return "standard";
	return "advanced";
}

/**
 * Check if compact tool mode is enabled.
 * Controlled by CHITRAGUPTA_MCP_COMPACT_TOOLS environment variable.
 */
export function isCompactMode(): boolean {
	const val = (process.env.CHITRAGUPTA_MCP_COMPACT_TOOLS ?? "").trim().toLowerCase();
	return new Set(["1", "true", "yes", "on"]).has(val);
}

// ─── Compression ────────────────────────────────────────────────────────────

/**
 * Apply tier-based description compression to a list of MCP tools.
 *
 * In compact mode:
 * - Essential tools keep full descriptions.
 * - Standard tools get short one-line descriptions.
 * - Advanced tools get name-only descriptions.
 *
 * Non-compact mode returns tools unmodified.
 *
 * @param tools - Array of MCP tool handlers to compress.
 * @returns Modified tools with compressed descriptions (originals unmodified).
 */
export function applyToolTiers(tools: McpToolHandler[]): McpToolHandler[] {
	if (!isCompactMode()) return tools;

	return tools.map((tool) => {
		const tier = getToolTier(tool.definition.name);

		if (tier === "essential") {
			return tool;
		}

		if (tier === "standard") {
			const short = SHORT_DESCRIPTIONS[tool.definition.name];
			if (short) {
				return {
					...tool,
					definition: {
						...tool.definition,
						description: short,
					},
				};
			}
			return tool;
		}

		// Advanced: name + minimal description
		return {
			...tool,
			definition: {
				...tool.definition,
				description: `[Advanced] ${tool.definition.name.replace(/_/g, " ")}. Use tool name to get full details.`,
			},
		};
	});
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/**
 * Get tier statistics for a set of tools.
 * Useful for logging and diagnostics.
 *
 * @param tools - Array of MCP tool handlers to classify.
 * @returns Count per tier.
 */
export function getTierStats(tools: McpToolHandler[]): Record<ToolTier, number> {
	const stats: Record<ToolTier, number> = { essential: 0, standard: 0, advanced: 0 };
	for (const tool of tools) {
		stats[getToolTier(tool.definition.name)]++;
	}
	return stats;
}
