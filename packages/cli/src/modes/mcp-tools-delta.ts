/**
 * MCP Tools — Incremental Handover & Memory Changes.
 *
 * Tool factories for cursor-based incremental handover and
 * timestamp-based memory change detection. These enable
 * live UI polling without full-snapshot overhead.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { truncateOutput } from "./mcp-tools-core.js";

/** Patterns that indicate a key decision or action statement (shared with handover). */
const HANDOVER_DECISION_PATTERNS = [
	"i'll", "i will", "let's", "the fix is", "the issue is", "the problem is",
	"we need to", "we should", "the solution is", "i've decided", "i have",
	"decision:", "plan:", "approach:", "strategy:", "conclusion:",
	"the root cause", "this means", "therefore",
];

// ─── Incremental Handover ────────────────────────────────────────────────────

/**
 * Create the `chitragupta_handover_since` tool — cursor-based incremental handover.
 *
 * If cursor=0 or omitted, returns a no-op with newCursor set to max turn.
 * Otherwise, only returns turns added since the cursor position.
 */
export function createHandoverSinceTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_handover_since",
			description:
				"Incremental handover — returns only the changes since a previous cursor position. " +
				"Pass the `newCursor` value from a previous handover_since call to get only new turns. " +
				"If cursor is 0 or omitted, returns the full handover (same as chitragupta_handover).",
			inputSchema: {
				type: "object" as const,
				properties: {
					sessionId: { type: "string", description: "Session ID. Default: most recent session." },
					cursor: { type: "number", description: "Turn number from a previous handover. 0 = full handover." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const cursor = typeof args.cursor === "number" ? args.cursor : 0;

			try {
				const { listSessions, getTurnsSince, getMaxTurnNumber } = await import("@chitragupta/smriti/session-store");

				let sessionId = args.sessionId ? String(args.sessionId) : undefined;
				if (!sessionId) {
					const sessions = listSessions(projectPath);
					if (sessions.length === 0) {
						return { content: [{ type: "text", text: "No sessions found. Nothing to hand over." }] };
					}
					sessionId = sessions[0].id;
				}

				const maxTurn = getMaxTurnNumber(sessionId);

				// No new turns since cursor
				if (cursor >= maxTurn && cursor > 0) {
					return {
						content: [{ type: "text", text: `No new turns since cursor ${cursor}. Session has ${maxTurn} turns total.` }],
						_metadata: { typed: { sessionId, previousCursor: cursor, newCursor: maxTurn, turnsAdded: 0, filesModified: [], filesRead: [], decisions: [], errors: [] } },
					};
				}

				const newTurns = getTurnsSince(sessionId, cursor);

				if (newTurns.length === 0) {
					return {
						content: [{ type: "text", text: `No new turns since cursor ${cursor}.` }],
						_metadata: { typed: { sessionId, previousCursor: cursor, newCursor: maxTurn, turnsAdded: 0, filesModified: [], filesRead: [], decisions: [], errors: [] } },
					};
				}

				const filesRead = new Set<string>();
				const filesModified = new Set<string>();
				const errors: string[] = [];
				const decisions: string[] = [];

				for (const turn of newTurns) {
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
							}
							if (tc.isError && tc.result) {
								errors.push(`${tc.name}: ${String(tc.result).slice(0, 200)}`);
							}
						}
					}
					if (turn.role === "assistant" && turn.content) {
						for (const line of turn.content.split("\n")) {
							const lower = line.trim().toLowerCase();
							if (lower.length > 10 && HANDOVER_DECISION_PATTERNS.some((p) => lower.startsWith(p))) {
								decisions.push(line.trim().slice(0, 200));
							}
						}
					}
				}

				const newCursor = newTurns[newTurns.length - 1].turnNumber;
				const sections: string[] = [
					`चि Incremental Handover (cursor ${cursor} → ${newCursor})`,
					`Session: ${sessionId}`,
					`New turns: ${newTurns.length}`,
					"",
				];

				if (filesModified.size > 0) {
					sections.push("## Files Modified");
					for (const f of filesModified) sections.push(`  - ${f}`);
					sections.push("");
				}
				if (filesRead.size > 0) {
					sections.push("## Files Read");
					for (const f of [...filesRead].slice(0, 20)) sections.push(`  - ${f}`);
					sections.push("");
				}
				if (decisions.length > 0) {
					sections.push("## Key Decisions");
					for (const d of [...new Set(decisions)].slice(0, 10)) sections.push(`  - ${d}`);
					sections.push("");
				}
				if (errors.length > 0) {
					sections.push("## Errors");
					for (const e of errors.slice(0, 5)) sections.push(`  - ${e}`);
					sections.push("");
				}

				return {
					content: [{ type: "text", text: truncateOutput(sections.join("\n")) }],
					_metadata: {
						typed: {
							sessionId, previousCursor: cursor, newCursor,
							turnsAdded: newTurns.length,
							filesModified: [...filesModified],
							filesRead: [...filesRead],
							decisions: [...new Set(decisions)].slice(0, 10),
							errors: errors.slice(0, 5),
						},
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `handover_since failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Memory Changes Since ────────────────────────────────────────────────────

/**
 * Create the `chitragupta_memory_changes_since` tool — detect new/modified sessions.
 * Returns sessions created or updated since a given ISO timestamp.
 */
export function createMemoryChangesSinceTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_memory_changes_since",
			description:
				"Detect memory changes since a given timestamp. Returns new and updated " +
				"sessions since the ISO timestamp. Use this for live UI polling.",
			inputSchema: {
				type: "object" as const,
				properties: {
					since: { type: "string", description: "ISO timestamp (e.g. '2026-02-24T10:00:00Z'). Returns changes after this time." },
				},
				required: ["since"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const sinceStr = String(args.since ?? "");
			if (!sinceStr) {
				return { content: [{ type: "text", text: "Error: 'since' timestamp is required." }], isError: true };
			}

			const sinceMs = new Date(sinceStr).getTime();
			if (isNaN(sinceMs)) {
				return { content: [{ type: "text", text: `Error: Invalid timestamp: ${sinceStr}` }], isError: true };
			}

			try {
				const { getSessionsModifiedSince } = await import("@chitragupta/smriti/session-store");
				const modified = getSessionsModifiedSince(projectPath, sinceMs);

				const newSessions = modified.filter((s) => new Date(s.created).getTime() > sinceMs);
				const updatedSessions = modified.filter((s) => new Date(s.created).getTime() <= sinceMs);

				const lines: string[] = [
					`Memory changes since ${sinceStr}:`,
					`New sessions: ${newSessions.length}`,
					`Updated sessions: ${updatedSessions.length}`,
				];

				if (newSessions.length > 0) {
					lines.push("", "## New Sessions");
					for (const s of newSessions.slice(0, 20)) {
						lines.push(`  - ${s.id}: "${s.title}" (${s.created})`);
					}
				}
				if (updatedSessions.length > 0) {
					lines.push("", "## Updated Sessions");
					for (const s of updatedSessions.slice(0, 20)) {
						lines.push(`  - ${s.id} (updated: ${s.updated})`);
					}
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					_metadata: {
						typed: {
							since: sinceStr,
							newSessions: newSessions.map((s) => ({ id: s.id, title: s.title })),
							updatedSessions: updatedSessions.map((s) => ({ id: s.id })),
							newTurns: 0,
						},
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `memory_changes_since failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
