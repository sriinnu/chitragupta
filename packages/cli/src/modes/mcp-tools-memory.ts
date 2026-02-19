/**
 * MCP Tools — Memory, Handover & Day Files.
 *
 * Tool factories for the handover tool (context continuity), day file
 * queries (consolidated daily diaries), and provider context loading.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { truncateOutput } from "./mcp-tools-core.js";
import { writeChitraguptaState } from "./mcp-state.js";

// ─── Handover ───────────────────────────────────────────────────────────────

/** Patterns that indicate a key decision or action statement. */
const HANDOVER_DECISION_PATTERNS = [
	"i'll", "i will", "let's", "the fix is", "the issue is", "the problem is",
	"we need to", "we should", "the solution is", "i've decided", "i have",
	"decision:", "plan:", "approach:", "strategy:", "conclusion:",
	"the root cause", "this means", "therefore",
];

/**
 * Create the `chitragupta_handover` tool — structured work-state summary
 * for context continuity across compaction boundaries.
 */
export function createHandoverTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_handover",
			description:
				"Generate a structured work-state handover summary for context continuity. " +
				"Call this when approaching context limits to preserve work state across " +
				"compaction boundaries. Returns: original request, files modified/read, " +
				"decisions made, errors encountered, commands run, and recent context. " +
				"This is NOT identity (use atman_report for that) — this is work state.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: { type: "string", description: "Session ID to summarize. Default: most recent session." },
					turnWindow: { type: "number", description: "Focus on the last N turns only. Default: all turns." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { loadSession, listSessions } = await import("@chitragupta/smriti/session-store");

				let sessionId = args.sessionId ? String(args.sessionId) : undefined;
				if (!sessionId) {
					const sessions = listSessions(projectPath);
					if (sessions.length === 0) {
						return { content: [{ type: "text", text: "No sessions found. Nothing to hand over." }] };
					}
					sessionId = sessions[0].id;
				}

				const session = loadSession(sessionId, projectPath);
				const allTurns = session.turns;
				const turnWindow = args.turnWindow ? (Number(args.turnWindow) || 0) : 0;
				const turns = turnWindow > 0 ? allTurns.slice(-turnWindow) : allTurns;

				const filesRead = new Set<string>();
				const filesModified = new Set<string>();
				const commands: string[] = [];
				const errors: string[] = [];
				const decisions: string[] = [];
				const otherTools = new Map<string, number>();

				for (const turn of turns) {
					if (turn.toolCalls) {
						for (const tc of turn.toolCalls) {
							const name = tc.name.toLowerCase();
							let input: Record<string, unknown> = {};
							try { input = JSON.parse(tc.input) as Record<string, unknown>; } catch { /* skip */ }

							if (name.includes("read") || name.includes("glob") || name.includes("grep")) {
								const target = String(input.file_path ?? input.path ?? input.pattern ?? "");
								if (target) filesRead.add(target);
							} else if (name.includes("write") || name.includes("edit")) {
								const target = String(input.file_path ?? input.path ?? "");
								if (target) filesModified.add(target);
							} else if (name.includes("bash") || name.includes("exec") || name.includes("command")) {
								const cmd = String(input.command ?? "");
								if (cmd) commands.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
							} else {
								otherTools.set(tc.name, (otherTools.get(tc.name) ?? 0) + 1);
							}
							if (tc.isError && tc.result) {
								const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
								errors.push(`${tc.name}: ${resultStr.slice(0, 200)}`);
							}
						}
					}
					if (turn.role === "assistant" && turn.content) {
						for (const line of turn.content.split("\n")) {
							const lower = line.trim().toLowerCase();
							if (lower.length > 10 && HANDOVER_DECISION_PATTERNS.some((p) => lower.startsWith(p))) {
								const trimmed = line.trim();
								decisions.push(trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200) + "...");
							}
						}
					}
				}

				const uniqueDecisions = [...new Set(decisions)].slice(0, 15);
				const firstUserTurn = allTurns.find((t) => t.role === "user");
				const userRequest = firstUserTurn?.content
					? firstUserTurn.content.length > 500 ? firstUserTurn.content.slice(0, 500) + "..." : firstUserTurn.content
					: "(unknown)";

				const sections: string[] = [];
				sections.push("चि Handover Summary", "━".repeat(40));
				sections.push(`Session: ${session.meta.id}`, `Title: ${session.meta.title}`);
				sections.push(`Turns: ${allTurns.length} | Model: ${session.meta.model}`, `Created: ${session.meta.created}`, "");
				sections.push("## Original Request", userRequest, "");

				if (filesModified.size > 0) {
					sections.push("## Files Modified");
					for (const f of filesModified) sections.push(`  - ${f}`);
					sections.push("");
				}
				if (filesRead.size > 0) {
					sections.push("## Files Read");
					for (const f of [...filesRead].slice(0, 30)) sections.push(`  - ${f}`);
					if (filesRead.size > 30) sections.push(`  ... and ${filesRead.size - 30} more`);
					sections.push("");
				}
				if (uniqueDecisions.length > 0) {
					sections.push("## Key Decisions");
					for (const d of uniqueDecisions) sections.push(`  - ${d}`);
					sections.push("");
				}
				if (errors.length > 0) {
					sections.push("## Errors Encountered");
					for (const e of errors.slice(0, 10)) sections.push(`  - ${e}`);
					sections.push("");
				}
				if (commands.length > 0) {
					sections.push("## Commands Run");
					for (const c of commands.slice(0, 10)) sections.push(`  $ ${c}`);
					if (commands.length > 10) sections.push(`  ... and ${commands.length - 10} more`);
					sections.push("");
				}
				if (otherTools.size > 0) {
					const entries = [...otherTools.entries()].map(([n, c]) => `${n}(x${c})`);
					sections.push("## Other Tools Used", `  ${entries.join(", ")}`, "");
				}

				const recentAssistant = turns.filter((t) => t.role === "assistant").slice(-3);
				if (recentAssistant.length > 0) {
					sections.push("## Recent Context (last 3 responses)");
					for (const t of recentAssistant) {
						const preview = t.content.slice(0, 300).replace(/\n/g, " ").trim();
						sections.push(`  [Turn ${t.turnNumber}] ${preview}${t.content.length > 300 ? "..." : ""}`);
					}
					sections.push("");
				}

				writeChitraguptaState({
					sessionId: session.meta.id,
					project: projectPath,
					turnCount: allTurns.length,
					filesModified: [...filesModified],
					lastTool: "chitragupta_handover",
				});

				return { content: [{ type: "text", text: truncateOutput(sections.join("\n")) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Handover failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Day File Tools ─────────────────────────────────────────────────────────

/** Create the `chitragupta_day_show` tool — shows a consolidated day file. */
export function createDayShowTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_show",
			description: "Show the consolidated day file (diary) for a specific date. Day files contain all projects, sessions, tool usage, and files modified for that day.",
			inputSchema: {
				type: "object" as const,
				properties: { date: { type: "string", description: "Date in YYYY-MM-DD format. Omit for today." } },
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const date = args.date ? String(args.date) : new Date().toISOString().slice(0, 10);
			try {
				const { readDayFile } = await import("@chitragupta/smriti/day-consolidation");
				const content = readDayFile(date);
				if (!content) {
					return { content: [{ type: "text", text: `No day file for ${date}. Run consolidation first, or the daemon will create it automatically.` }], _metadata: { action: "day_show", date } };
				}
				return { content: [{ type: "text", text: truncateOutput(content) }], _metadata: { action: "day_show", date } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

/** Create the `chitragupta_day_list` tool — lists available day files. */
export function createDayListTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_list",
			description: "List all consolidated day files (diaries). Returns dates in YYYY-MM-DD format, most recent first.",
			inputSchema: {
				type: "object" as const,
				properties: { limit: { type: "number", description: "Maximum dates to return. Default: 30." } },
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 30) || 30));
			try {
				const { listDayFiles } = await import("@chitragupta/smriti/day-consolidation");
				const dates = listDayFiles().slice(0, limit);
				if (dates.length === 0) {
					return { content: [{ type: "text", text: "No consolidated day files found. The daemon will create them automatically." }], _metadata: { action: "day_list" } };
				}
				return { content: [{ type: "text", text: `Day files (${dates.length}):\n\n${dates.map((d: string) => `- ${d}`).join("\n")}` }], _metadata: { action: "day_list" } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

/** Create the `chitragupta_day_search` tool — searches across day files. */
export function createDaySearchTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_search",
			description: "Search across all consolidated day files (diaries) for a query. Finds matching content across any date or project.",
			inputSchema: {
				type: "object" as const,
				properties: {
					query: { type: "string", description: "Search query (case-insensitive substring match)." },
					limit: { type: "number", description: "Maximum day files to return. Default: 10." },
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10) || 10));
			if (!query) {
				return { content: [{ type: "text", text: "Error: 'query' is required for search." }], isError: true };
			}
			try {
				const { searchDayFiles } = await import("@chitragupta/smriti/day-consolidation");
				const results = searchDayFiles(query, { limit });
				if (results.length === 0) {
					return { content: [{ type: "text", text: `No matches found for: ${query}` }], _metadata: { action: "day_search", query } };
				}
				const lines: string[] = [`Found matches in ${results.length} day(s):\n`];
				for (const r of results) {
					lines.push(`## ${r.date}`);
					for (const m of r.matches) lines.push(`  L${m.line}: ${m.text}`);
					lines.push("");
				}
				return { content: [{ type: "text", text: truncateOutput(lines.join("\n")) }], _metadata: { action: "day_search", query } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Provider Context ───────────────────────────────────────────────────────

/**
 * Create the `chitragupta_context` tool — load memory context for a new session.
 * Returns global facts, project memory, and recent session summaries.
 */
export function createContextTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_context",
			description: "Load memory context for a new session. Returns global facts, project memory, and recent session summaries. Call this at the start of every session to get persistent memory.",
			inputSchema: {
				type: "object" as const,
				properties: { project: { type: "string", description: "Project path for project-specific memory. Defaults to current project." } },
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const project = args.project != null ? String(args.project) : projectPath;
			try {
				const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
				const ctx = await loadProviderContext(project);
				if (ctx.itemCount === 0) {
					return { content: [{ type: "text", text: "No memory context found. This appears to be a fresh start." }], _metadata: { action: "context", itemCount: 0 } };
				}
				return { content: [{ type: "text", text: truncateOutput(ctx.assembled) }], _metadata: { action: "context", itemCount: ctx.itemCount } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}
