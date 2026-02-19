/**
 * MCP Tools — Sync, Recall, Vidhis & Consolidation.
 *
 * Tool factories for cross-machine sync (export/import), unified recall,
 * learned procedures (Vidhis), and on-demand Svapna consolidation.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import path from "path";
import { truncateOutput } from "./mcp-tools-core.js";

// ─── Sync Status ────────────────────────────────────────────────────────────

/** Create the `chitragupta_sync_status` tool — cross-machine sync status. */
export function createSyncStatusTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_sync_status",
			description: "Show cross-machine sync status for day files and memory files, including last export/import metadata.",
			inputSchema: { type: "object" as const, properties: {}, required: [] },
		},
		async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { getCrossMachineSyncStatus } = await import("@chitragupta/smriti");
				const status = getCrossMachineSyncStatus();
				const totals = status.lastImportTotals;
				const totalsLine = totals
					? `\nLast import totals: created=${totals.created}, updated=${totals.updated}, merged=${totals.merged}, skipped=${totals.skipped}, conflicts=${totals.conflicts}, errors=${totals.errors}`
					: "";
				const text = [
					`Cross-Machine Sync`,
					`Home: ${status.home}`,
					`Day files: ${status.daysCount}`,
					`Memory files: ${status.memoryCount}`,
					`Last export: ${status.lastExportAt ?? "(never)"}`,
					`Last import: ${status.lastImportAt ?? "(never)"}`,
					`Last export path: ${status.lastExportPath ?? "(none)"}`,
					`Last import source: ${status.lastImportSource ?? "(none)"}`,
					totalsLine,
				].filter(Boolean).join("\n");
				return { content: [{ type: "text", text }], _metadata: { action: "sync_status" } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Sync Export ────────────────────────────────────────────────────────────

/** Create the `chitragupta_sync_export` tool — generate a portable sync snapshot. */
export function createSyncExportTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_sync_export",
			description: "Export day files and memory files into a portable JSON snapshot for cross-machine sync.",
			inputSchema: {
				type: "object" as const,
				properties: {
					outputPath: { type: "string", description: "Optional output file path. Defaults to <project>/.chitragupta-sync/snapshot-<timestamp>.json" },
					maxDays: { type: "number", description: "Optional cap for number of day files (most recent first)." },
					includeDays: { type: "boolean", description: "Include day files. Default: true." },
					includeMemory: { type: "boolean", description: "Include memory files. Default: true." },
				},
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const includeDays = typeof args.includeDays === "boolean" ? args.includeDays : true;
				const includeMemory = typeof args.includeMemory === "boolean" ? args.includeMemory : true;
				const maxDays = typeof args.maxDays === "number" ? args.maxDays : undefined;
				const { createCrossMachineSnapshot, writeCrossMachineSnapshot } = await import("@chitragupta/smriti");
				const snapshot = createCrossMachineSnapshot({ includeDays, includeMemory, maxDays });
				const dayCount = snapshot.files.filter((f) => f.kind === "day").length;
				const memoryCount = snapshot.files.filter((f) => f.kind === "memory").length;
				const totalBytes = snapshot.files.reduce((sum, file) => sum + file.bytes, 0);
				const defaultPath = path.join(
					projectPath, ".chitragupta-sync",
					`snapshot-${snapshot.exportedAt.replace(/[:.]/g, "-")}.json`,
				);
				const outputPath = args.outputPath ? String(args.outputPath) : defaultPath;
				const writtenPath = writeCrossMachineSnapshot(snapshot, outputPath);
				return {
					content: [{
						type: "text",
						text: `Sync snapshot exported.\nPath: ${writtenPath}\nExportedAt: ${snapshot.exportedAt}\nFiles: ${snapshot.files.length} (days=${dayCount}, memory=${memoryCount})\nBytes: ${totalBytes}`,
					}],
					_metadata: { action: "sync_export", path: writtenPath, files: snapshot.files.length, days: dayCount, memory: memoryCount },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Sync Import ────────────────────────────────────────────────────────────

/** Create the `chitragupta_sync_import` tool — apply a sync snapshot. */
export function createSyncImportTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_sync_import",
			description: "Import a sync snapshot JSON file and apply it to local day/memory files.",
			inputSchema: {
				type: "object" as const,
				properties: {
					snapshotPath: { type: "string", description: "Path to the snapshot JSON produced by chitragupta_sync_export." },
					strategy: { type: "string", description: "Conflict strategy: safe, prefer-remote, prefer-local. Default: safe.", enum: ["safe", "prefer-remote", "prefer-local"] },
					dryRun: { type: "boolean", description: "If true, compute what would change without writing files." },
				},
				required: ["snapshotPath"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const snapshotPath = String(args.snapshotPath ?? "");
			if (!snapshotPath) {
				return { content: [{ type: "text", text: "Error: snapshotPath is required." }], isError: true };
			}
			try {
				const strategyRaw = String(args.strategy ?? "safe");
				const strategy = strategyRaw === "prefer-remote" ? "preferRemote"
					: strategyRaw === "prefer-local" ? "preferLocal" : "safe";
				const dryRun = Boolean(args.dryRun);
				const { importCrossMachineSnapshot } = await import("@chitragupta/smriti");
				const result = importCrossMachineSnapshot(snapshotPath, { strategy, dryRun });
				const t = result.totals;
				const text = [
					`Sync import complete.`,
					`ImportedAt: ${result.importedAt}`,
					`SourceExportedAt: ${result.sourceExportedAt}`,
					`Strategy: ${result.strategy}`,
					`DryRun: ${result.dryRun ? "yes" : "no"}`,
					`Totals: files=${t.files}, created=${t.created}, updated=${t.updated}, merged=${t.merged}, skipped=${t.skipped}, conflicts=${t.conflicts}, errors=${t.errors}`,
				].join("\n");
				return {
					content: [{ type: "text", text }],
					_metadata: { action: "sync_import", totals: t, conflicts: result.conflictPaths.length, errors: result.errorPaths.length },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Unified Recall ─────────────────────────────────────────────────────────

/** Create the `chitragupta_recall` tool — unified search across ALL memory layers. */
export function createRecallTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_recall",
			description:
				"Unified recall — searches ALL of Chitragupta's memory layers " +
				"(sessions, memory, knowledge graph, day files) to answer natural language " +
				"questions. Use this to recall past conversations, decisions, facts, or " +
				"anything that happened across any provider, project, or date.",
			inputSchema: {
				type: "object" as const,
				properties: {
					query: { type: "string", description: "Natural language question. E.g. 'how did I fix the yaxis interval in charts?' or 'what do we know about the auth system?'" },
					project: { type: "string", description: "Optional: filter to specific project path." },
					limit: { type: "number", description: "Max results. Default: 5." },
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const project = args.project != null ? String(args.project) : undefined;
			const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5) || 5));

			if (!query) {
				return { content: [{ type: "text", text: "Error: 'query' is required." }], isError: true };
			}

			try {
				const { recall } = await import("@chitragupta/smriti/unified-recall");
				const results = await recall(query, { limit, project });
				if (results.length === 0) {
					return { content: [{ type: "text", text: `No recall results for: ${query}` }], _metadata: { action: "recall", query } };
				}
				const lines: string[] = [`Recall results for "${query}":\n`];
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					lines.push(`**[${i + 1}]** (${(r.score * 100).toFixed(0)}% match, via ${r.primarySource})`);
					lines.push(r.answer);
					if (r.sessionId) lines.push(`  Session: ${r.sessionId}`);
					if (r.date) lines.push(`  Date: ${r.date}`);
					lines.push("");
				}
				return { content: [{ type: "text", text: truncateOutput(lines.join("\n")) }], _metadata: { action: "recall", query, resultCount: results.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Vidhis (Learned Procedures) ────────────────────────────────────────────

/** Format a single Vidhi for display. */
function formatVidhi(v: {
	name: string;
	steps: Array<{ toolName: string; description: string }>;
	triggers: string[];
	confidence: number;
	successRate: number;
	successCount: number;
	failureCount: number;
	parameterSchema: Record<string, { name: string; description: string }>;
}): string {
	const steps = v.steps.map((s, i) => `  ${i + 1}. ${s.toolName}: ${s.description}`).join("\n");
	const triggers = v.triggers.length > 0 ? v.triggers.join(", ") : "(none)";
	const params = Object.keys(v.parameterSchema);
	const paramStr = params.length > 0 ? params.join(", ") : "(none)";
	return `**${v.name}** (confidence: ${(v.confidence * 100).toFixed(0)}%, success: ${(v.successRate * 100).toFixed(0)}%, ${v.successCount + v.failureCount} runs)\n` +
		`  Triggers: ${triggers}\n  Parameters: ${paramStr}\n  Steps:\n${steps}`;
}

/** Create the `chitragupta_vidhis` tool — list/search learned procedures. */
export function createVidhisTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_vidhis",
			description:
				"List or search learned procedures (Vidhis) from Svapna consolidation. " +
				"Vidhis are parameterized tool sequences that were extracted from repeated " +
				"successful patterns across sessions. Returns procedure name, tool steps, " +
				"trigger phrases, confidence, and success rate.",
			inputSchema: {
				type: "object" as const,
				properties: {
					query: { type: "string", description: "Optional search query to filter vidhis by trigger phrases or name. Omit to list all." },
					limit: { type: "number", description: "Maximum results to return. Default: 10." },
				},
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = args.query != null ? String(args.query) : undefined;
			const limit = typeof args.limit === "number" ? args.limit : 10;

			try {
				const { VidhiEngine } = await import("@chitragupta/smriti");
				const engine = new VidhiEngine({ project: projectPath });

				if (query) {
					const matched = engine.match(query);
					if (matched) {
						return { content: [{ type: "text", text: `Best match for "${query}":\n\n${formatVidhi(matched)}` }], _metadata: { action: "vidhis_search", matches: 1 } };
					}
					return { content: [{ type: "text", text: `No vidhis match "${query}".` }], _metadata: { action: "vidhis_search", matches: 0 } };
				}

				const vidhis = engine.getVidhis(projectPath, limit);
				if (vidhis.length === 0) {
					return { content: [{ type: "text", text: "No learned procedures (vidhis) found. Procedures are extracted during Svapna consolidation from repeated successful tool sequences." }], _metadata: { action: "vidhis_list", count: 0 } };
				}
				const lines = vidhis.map((v, i) => `${i + 1}. ${formatVidhi(v)}`);
				return { content: [{ type: "text", text: `Learned Procedures (${vidhis.length}):\n\n${lines.join("\n\n")}` }], _metadata: { action: "vidhis_list", count: vidhis.length } };
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}

// ─── Consolidation ──────────────────────────────────────────────────────────

/** Create the `chitragupta_consolidate` tool — on-demand Svapna memory consolidation. */
export function createConsolidateTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_consolidate",
			description:
				"Run Swapna memory consolidation on demand. Analyzes recent sessions to extract " +
				"knowledge rules (samskaras) and tool sequence procedures (vidhis). " +
				"Returns a summary of new rules learned, rules reinforced, and patterns detected.",
			inputSchema: {
				type: "object" as const,
				properties: { sessionCount: { type: "number", description: "Number of recent sessions to analyze. Default: 10." } },
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const sessionCount = typeof args.sessionCount === "number" ? args.sessionCount : 10;

			try {
				const { ConsolidationEngine, VidhiEngine } = await import("@chitragupta/smriti");
				const { listSessions, loadSession } = await import("@chitragupta/smriti/session-store");

				const consolidator = new ConsolidationEngine();
				consolidator.load();

				const recentMetas = listSessions(projectPath).slice(0, sessionCount);
				const sessions: import("@chitragupta/smriti/types").Session[] = [];
				for (const meta of recentMetas) {
					try {
						const s = loadSession(meta.id, projectPath);
						if (s) sessions.push(s);
					} catch { /* skip */ }
				}

				if (sessions.length === 0) {
					return { content: [{ type: "text", text: "No sessions found to consolidate." }], _metadata: { action: "consolidate", sessions: 0 } };
				}

				const result = consolidator.consolidate(sessions);
				consolidator.decayRules();
				consolidator.pruneRules();

				let vidhiSummary = "";
				try {
					const vidhiEngine = new VidhiEngine({ project: projectPath });
					const vr = vidhiEngine.extract();
					vidhiSummary = `\nVidhis: ${vr.newVidhis.length} new, ${vr.reinforced.length} reinforced`;
				} catch { /* optional */ }

				consolidator.save();

				const lines: string[] = [
					`Swapna Consolidation Complete`,
					`Sessions analyzed: ${result.sessionsAnalyzed}`,
					`New rules: ${result.newRules.length}`,
					`Rules reinforced: ${result.reinforcedRules.length}`,
					`Rules weakened: ${result.weakenedRules.length}`,
					`Patterns detected: ${result.patternsDetected.length}`,
				];
				if (vidhiSummary) lines.push(vidhiSummary.trim());
				if (result.newRules.length > 0) {
					lines.push("", "New rules:");
					for (const rule of result.newRules.slice(0, 10)) lines.push(`  - [${rule.category}] ${rule.rule}`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					_metadata: { action: "consolidate", sessions: result.sessionsAnalyzed, newRules: result.newRules.length, reinforced: result.reinforcedRules.length },
				};
			} catch (err) {
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	};
}
