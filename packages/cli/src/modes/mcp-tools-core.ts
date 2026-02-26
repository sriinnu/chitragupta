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
// Note: ProviderError/loadGlobalSettings moved to mcp-agent-prompt.ts
import {
	INLINE_WAIT_MS, createJob, getJob, completeJob, failJob,
	createHeartbeat, isJobStale,
} from "./mcp-prompt-jobs.js";

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

				return {
					content: [{ type: "text", text: truncateOutput(formatted) }],
					_metadata: { typed: { query, results: limited.map((r) => ({ text: r.content.slice(0, 200), score: r.relevance ?? 0, source: r.scope.type })) } },
				};
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
				return {
					content: [{ type: "text", text: `Sessions (${limited.length}):\n\n${lines.join("\n")}` }],
					_metadata: { typed: { sessions: limited.map((s) => ({ id: s.id, title: s.title, agent: s.agent, model: s.model, created: s.created })) } },
				};
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
				return {
					content: [{ type: "text", text: truncateOutput(full) }],
					_metadata: { typed: { meta: { id: session.meta.id, title: session.meta.title, agent: session.meta.agent, model: session.meta.model, created: session.meta.created, turnCount: session.turns.length }, turns: turns.map((t) => ({ turnNumber: t.turnNumber, role: t.role, contentPreview: t.content.slice(0, 100), toolCalls: t.toolCalls?.map((tc) => tc.name) })) } },
				};
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

// ─── Agent Prompt (Async-Safe with Heartbeat) ──────────────────────────────

/**
 * Create the `chitragupta_prompt` tool — delegates a task to Chitragupta's agent.
 *
 * Waits inline for up to 45s. If the prompt finishes, returns directly.
 * Otherwise returns a jobId for polling via `chitragupta_prompt_status`.
 * Heartbeats are emitted during execution so the caller can detect liveness.
 */
export function createAgentPromptTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_prompt",
			description:
				"Delegate a task to Chitragupta's AI agent. Returns the result " +
				"directly if it completes within 45 seconds. For longer tasks, " +
				"returns a jobId — poll with `chitragupta_prompt_status` to get " +
				"the result and check liveness via heartbeat.",
			inputSchema: {
				type: "object",
				properties: {
					message: { type: "string", description: "The prompt/task to send to Chitragupta's agent." },
					provider: { type: "string", description: "AI provider to use. Default: from config (usually 'anthropic')" },
					model: { type: "string", description: "Model to use. Default: from config" },
					timeout: { type: "number", description: "Timeout in milliseconds per attempt. Default: 120000 (2 min)" },
				},
				required: ["message"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const message = String(args.message ?? "");
			if (!message) {
				return { content: [{ type: "text", text: "Error: message is required" }], isError: true };
			}

			const jobId = createJob();
			const heartbeat = createHeartbeat(jobId);

			const promptPromise = (async () => {
				try {
					const { runAgentPromptWithFallback } = await import("./mcp-agent-prompt.js");
					const result = await runAgentPromptWithFallback({
						message,
						...(args.provider ? { provider: String(args.provider) } : {}),
						...(args.model ? { model: String(args.model) } : {}),
						...(args.timeout ? { timeoutMs: Number(args.timeout) } : {}),
						onHeartbeat: heartbeat,
					});
					completeJob(jobId, result.response);
					return result.response;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					failJob(jobId, msg);
					throw err;
				}
			})();

			try {
				const response = await Promise.race([
					promptPromise,
					new Promise<"__timeout__">((resolve) =>
						setTimeout(() => resolve("__timeout__"), INLINE_WAIT_MS),
					),
				]);
				if (response !== "__timeout__") {
					return { content: [{ type: "text", text: response }] };
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `Agent prompt failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text:
					`Prompt is still running (jobId: ${jobId}). ` +
					`Use chitragupta_prompt_status with this jobId to check progress and liveness.`,
				}],
				_metadata: { jobId, status: "running" },
			};
		},
	};
}

/**
 * Create the `chitragupta_prompt_status` tool — poll for async prompt results.
 *
 * Reports heartbeat liveness: fresh heartbeat means "still executing",
 * stale heartbeat (>60s) means "likely died — consider retrying."
 */
export function createPromptStatusTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_prompt_status",
			description:
				"Check the status of a long-running chitragupta_prompt. " +
				"Reports heartbeat liveness so you can tell if the job is " +
				"still executing or died midway. Returns the result when complete.",
			inputSchema: {
				type: "object",
				properties: {
					jobId: { type: "string", description: "The jobId returned by chitragupta_prompt." },
				},
				required: ["jobId"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const jobId = String(args.jobId ?? "");
			if (!jobId) {
				return { content: [{ type: "text", text: "Error: jobId is required" }], isError: true };
			}
			const job = getJob(jobId);
			if (!job) {
				return { content: [{ type: "text", text: `No prompt job found with id "${jobId}". It may have expired.` }], isError: true };
			}
			if (job.status === "running") {
				const elapsed = Math.round((Date.now() - job.createdAt) / 1000);
				const heartbeatAge = Math.round((Date.now() - job.lastHeartbeat) / 1000);
				const activity = job.lastActivity ?? "initializing";
				const attempt = job.attemptNumber ?? 1;
				const provider = job.providerAttempt ?? "unknown";
				const stale = isJobStale(job);

				if (stale) {
					return {
						content: [{ type: "text", text:
							`WARNING: Prompt may have died — no heartbeat for ${heartbeatAge}s. ` +
							`Last activity: "${activity}" (attempt ${attempt}, provider: ${provider}). ` +
							`Total elapsed: ${elapsed}s. Consider retrying with a new chitragupta_prompt call.`,
						}],
						_metadata: { jobId, status: "stale", elapsedMs: Date.now() - job.createdAt, heartbeatAgeMs: Date.now() - job.lastHeartbeat },
					};
				}

				return {
					content: [{ type: "text", text:
						`Prompt is alive and executing (${elapsed}s elapsed, heartbeat ${heartbeatAge}s ago). ` +
						`Activity: ${activity} (attempt ${attempt}, provider: ${provider}). ` +
						`Poll again in 10-15 seconds.`,
					}],
					_metadata: { jobId, status: "running", elapsedMs: Date.now() - job.createdAt, heartbeatAgeMs: Date.now() - job.lastHeartbeat },
				};
			}
			if (job.status === "failed") {
				return {
					content: [{ type: "text", text: `Prompt failed: ${job.error ?? "Unknown error"}` }],
					isError: true,
				};
			}
			return { content: [{ type: "text", text: job.response ?? "" }] };
		},
	};
}
