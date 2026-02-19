/**
 * Core MCP Tool Factories.
 *
 * Lightweight tool factories for memory search, session management,
 * Marga routing, and agent prompting. Each factory returns an
 * {@link McpToolHandler} ready for registration with the MCP server.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";

// ─── Output Truncation ──────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 50_000;

/**
 * Truncate large MCP tool output to prevent blowing up client context windows.
 * Keeps the head and tail of the content with a truncation notice in between.
 */
export function truncateOutput(text: string, maxChars = MAX_OUTPUT_CHARS): string {
	if (text.length <= maxChars) return text;
	const headSize = Math.floor(maxChars * 0.6);
	const tailSize = Math.floor(maxChars * 0.35);
	const omitted = text.length - headSize - tailSize;
	return (
		text.slice(0, headSize) +
		`\n\n--- [TRUNCATED: ${omitted.toLocaleString()} characters omitted. ` +
		`Use turnLimit, limit, or date params to narrow results.] ---\n\n` +
		text.slice(-tailSize)
	);
}

// ─── Memory Search ──────────────────────────────────────────────────────────

/** Create the `chitragupta_memory_search` tool — searches project memory. */
export function createMemorySearchTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_memory_search",
			description:
				"Search Chitragupta's project memory (GraphRAG-backed). " +
				"Returns relevant memory entries, past decisions, patterns, and conventions " +
				"learned from previous sessions.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "The search query. Be specific for better results." },
					limit: { type: "number", description: "Maximum results to return. Default: 10" },
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 10) || 10));

			if (!query) {
				return { content: [{ type: "text", text: "Error: query is required" }], isError: true };
			}

			try {
				const { searchMemory } = await import("@chitragupta/smriti/search");
				const { listMemoryScopes } = await import("@chitragupta/smriti/memory-store");
				const results = searchMemory(query);
				const limited = results.slice(0, limit);

				if (limited.length === 0) {
					const scopes = listMemoryScopes();
					const hint = scopes.length === 0
						? " No memory files exist yet — use the `memory` tool with action 'write' or 'append' to create memory."
						: ` Searched ${scopes.length} memory scope(s).`;
					return { content: [{ type: "text", text: `No memory entries found for query "${query}".${hint}` }] };
				}

				const formatted = limited.map((r, i) => {
					const source = r.scope.type === "project"
						? `project:${r.scope.path}`
						: r.scope.type === "global"
							? "global"
							: r.scope.type === "agent"
								? `agent:${r.scope.agentId}`
								: `session:${r.scope.sessionId}`;
					return `[${i + 1}] (score: ${(r.relevance ?? 0).toFixed(2)}, source: ${source})\n${r.content}`;
				}).join("\n\n---\n\n");

				return { content: [{ type: "text", text: truncateOutput(formatted) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Session List ───────────────────────────────────────────────────────────

/** Create the `chitragupta_session_list` tool — lists recent sessions. */
export function createSessionListTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_session_list",
			description:
				"List recent Chitragupta sessions for this project. " +
				"Shows session IDs, titles, timestamps, and turn counts.",
			inputSchema: {
				type: "object",
				properties: {
					limit: { type: "number", description: "Maximum sessions to return. Default: 20" },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

			try {
				const { listSessions } = await import("@chitragupta/smriti/session-store");
				const sessions = listSessions(projectPath);
				const limited = sessions.slice(0, limit);

				if (limited.length === 0) {
					return {
						content: [{ type: "text", text: `No sessions found for project: ${projectPath}. Sessions are created when you start a new conversation via the CLI or when the MCP server records tool calls.` }],
					};
				}

				const lines = limited.map((s) =>
					`- ${s.id} | "${s.title}" | ${s.agent}/${s.model} | ${s.created}`,
				);
				return { content: [{ type: "text", text: `Sessions (${limited.length}):\n\n${lines.join("\n")}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Session Show ───────────────────────────────────────────────────────────

/** Create the `chitragupta_session_show` tool — shows a specific session. */
export function createSessionShowTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_session_show",
			description:
				"Show the contents of a specific Chitragupta session by ID. " +
				"Returns the full conversation including user and assistant turns.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: { type: "string", description: "The session ID to load." },
					turnLimit: { type: "number", description: "Maximum turns to include. Default: all" },
				},
				required: ["sessionId"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const sessionId = String(args.sessionId ?? "");
			const turnLimit = args.turnLimit != null ? (Number(args.turnLimit) || undefined) : undefined;

			if (!sessionId) {
				return { content: [{ type: "text", text: "Error: sessionId is required" }], isError: true };
			}

			try {
				const { loadSession } = await import("@chitragupta/smriti/session-store");
				const session = loadSession(sessionId, projectPath);

				const turns = turnLimit ? session.turns.slice(0, turnLimit) : session.turns;
				const formatted = turns.map((t) =>
					`## Turn ${t.turnNumber} - ${t.role}${t.agent ? ` (${t.agent})` : ""}\n\n${t.content}`,
				).join("\n\n---\n\n");

				const header = [
					`Session: ${session.meta.id}`,
					`Title: ${session.meta.title}`,
					`Agent: ${session.meta.agent}`,
					`Model: ${session.meta.model}`,
					`Created: ${session.meta.created}`,
					`Turns: ${session.turns.length}`,
				].join("\n");

				const full = `${header}\n\n${"=".repeat(60)}\n\n${formatted}`;
				return { content: [{ type: "text", text: truncateOutput(full) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to load session: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Marga Routing ──────────────────────────────────────────────────────────

/**
 * Create the `swara_marga_decide` tool — stateless LLM routing decision.
 *
 * Returns a versioned MargaDecision payload with:
 * providerId, modelId, taskType, complexity, skipLLM, escalationChain, rationale.
 */
export function createMargaDecideTool(): McpToolHandler {
	return {
		definition: {
			name: "swara_marga_decide",
			description:
				"Get a stateless LLM routing decision from Chitragupta's Marga pipeline. " +
				"Classifies the task type (14 categories) and complexity (5 tiers), " +
				"then selects the optimal provider/model. Returns escalation chain for fallback. " +
				"Chitragupta picks the model; caller enforces budget/health/policy.",
			inputSchema: {
				type: "object",
				properties: {
					message: { type: "string", description: "The user's message text to classify and route." },
					hasTools: { type: "boolean", description: "Whether the caller has tools available. Default: false" },
					hasImages: { type: "boolean", description: "Whether the message contains images. Default: false" },
					bindingStrategy: {
						type: "string",
						enum: ["local", "cloud", "hybrid"],
						description: "Model binding strategy. Default: hybrid",
					},
				},
				required: ["message"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const message = String(args.message ?? "");
			if (!message) {
				return { content: [{ type: "text", text: "Error: message is required" }], isError: true };
			}

			try {
				const { margaDecide } = await import("@chitragupta/swara");
				const decision = margaDecide({
					message,
					hasTools: Boolean(args.hasTools),
					hasImages: Boolean(args.hasImages),
					bindingStrategy: (args.bindingStrategy as "local" | "cloud" | "hybrid") ?? "hybrid",
				});
				return { content: [{ type: "text", text: JSON.stringify(decision) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Marga decision failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Agent Prompt ───────────────────────────────────────────────────────────

/** Create the `chitragupta_prompt` tool — delegates a task to Chitragupta's agent. */
export function createAgentPromptTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_prompt",
			description:
				"Delegate a task to Chitragupta's AI agent. The agent has its own " +
				"memory, tools, and configuration. Use this for complex tasks that " +
				"benefit from Chitragupta's project context and memory.",
			inputSchema: {
				type: "object",
				properties: {
					message: { type: "string", description: "The prompt/task to send to Chitragupta's agent." },
					provider: { type: "string", description: "AI provider to use. Default: from config (usually 'anthropic')" },
					model: { type: "string", description: "Model to use. Default: from config" },
				},
				required: ["message"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const message = String(args.message ?? "");
			if (!message) {
				return { content: [{ type: "text", text: "Error: message is required" }], isError: true };
			}

			try {
				const { createChitragupta } = await import("../api.js");
				const options: Record<string, unknown> = {};
				if (args.provider) options.provider = String(args.provider);
				if (args.model) options.model = String(args.model);

				const chitragupta = await createChitragupta(options);
				try {
					const response = await chitragupta.prompt(message);
					return { content: [{ type: "text", text: response }] };
				} finally {
					await chitragupta.destroy();
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `Agent prompt failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
