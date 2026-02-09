/**
 * @chitragupta/cli — Programmatic API.
 *
 * Clean API for consuming Chitragupta as a library.
 * No TUI, no terminal dependencies. Just pure API.
 *
 * Usage:
 *   import { createChitragupta } from "@chitragupta/cli/api";
 *
 *   const chitragupta = await createChitragupta({ provider: "anthropic" });
 *   const response = await chitragupta.prompt("Explain monads");
 *   console.log(response);
 *   await chitragupta.destroy();
 */

import crypto from "crypto";

import {
	loadGlobalSettings,
	loadProjectConfig,
	createConfig,
	cascadeConfigs,
	resolveProfile,
	BUILT_IN_PROFILES,
} from "@chitragupta/core";
import type { AgentProfile, ThinkingLevel, CostBreakdown } from "@chitragupta/core";

import { createProviderRegistry } from "@chitragupta/swara/provider-registry";

import { Agent } from "@chitragupta/anina";
import type { AgentConfig, AgentEventType, AgentMessage, ToolHandler } from "@chitragupta/anina";

import {
	createSession,
	saveSession,
	loadSession,
	listSessions,
} from "@chitragupta/smriti/session-store";
import { searchMemory } from "@chitragupta/smriti/search";
import type { Session, SessionMeta } from "@chitragupta/smriti/types";

import { PolicyEngine, STANDARD_PRESET } from "@chitragupta/dharma";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";

import { detectProject } from "./project-detector.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";

import {
	loadProjectMemory,
	loadCustomProfiles,
	loadCredentials,
	registerBuiltinProviders,
	getBuiltinTools,
	getActionType,
	createEmbeddingProviderInstance,
} from "./bootstrap.js";

// ─── Public Types ───────────────────────────────────────────────────────────

export interface ChitraguptaOptions {
	/** AI provider to use. Default: "anthropic" */
	provider?: string;
	/** Model ID. Default: provider's default */
	model?: string;
	/** Agent profile name or custom profile object. Default: "chitragupta" */
	profile?: string | AgentProfile;
	/** Working directory. Default: process.cwd() */
	workingDir?: string;
	/** Session ID to resume. Creates new if omitted. */
	sessionId?: string;
	/** Event handler for streaming events */
	onEvent?: (event: string, data: unknown) => void;
	/** Max cost per session in USD. Abort if exceeded. */
	maxSessionCost?: number;
	/** Thinking level. Default: from settings or "medium" */
	thinkingLevel?: ThinkingLevel;
	/** Disable memory loading entirely */
	noMemory?: boolean;
}

export interface ChitraguptaInstance {
	/** Send a prompt and get the full text response. */
	prompt(message: string): Promise<string>;
	/** Send a prompt and stream the response as chunks. */
	stream(message: string): AsyncIterable<StreamChunk>;
	/** The underlying Agent instance for advanced use. */
	agent: Agent;
	/** Search project memory by query. */
	searchMemory(query: string, limit?: number): Promise<MemorySearchResult[]>;
	/** Get current session info. */
	getSession(): SessionInfo;
	/** Save the current session to disk. */
	saveSession(): Promise<void>;
	/** Get token/cost statistics for this session. */
	getStats(): SessionStats;
	/** Clean up all resources. Must be called when done. */
	destroy(): Promise<void>;
}

export interface StreamChunk {
	type: "text" | "thinking" | "tool_start" | "tool_done" | "tool_error" | "usage" | "done";
	data: unknown;
}

export interface MemorySearchResult {
	content: string;
	score: number;
	source: string;
	timestamp?: number;
}

export interface SessionInfo {
	id: string;
	title?: string;
	turnCount: number;
	createdAt: number;
}

export interface SessionStats {
	totalCost: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	turnCount: number;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Extract plain text from an AgentMessage's content parts.
 */
function extractText(message: AgentMessage): string {
	return message.content
		.filter((p) => p.type === "text")
		.map((p) => (p as { type: "text"; text: string }).text)
		.join("");
}

/**
 * Sum cost breakdowns across all messages.
 *
 * CostBreakdown stores dollar amounts (input, output, total), not token counts.
 * We sum the dollar costs directly. Token counts are reported as 0 because
 * the CostBreakdown type does not carry token-level granularity.
 */
function sumCosts(messages: readonly AgentMessage[]): {
	totalCost: number;
	totalInputTokens: number;
	totalOutputTokens: number;
} {
	let totalCost = 0;

	for (const msg of messages) {
		if (msg.cost) {
			totalCost += msg.cost.total;
		}
	}

	// Token counts are unavailable — CostBreakdown only stores dollar amounts.
	// Return 0 rather than fabricating numbers from cost ratios.
	return { totalCost, totalInputTokens: 0, totalOutputTokens: 0 };
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new Chitragupta instance.
 *
 * This is the main entry point for programmatic use. It mirrors the
 * CLI's initialization flow (see main.ts) but WITHOUT any terminal,
 * TUI, or process.stdin/stdout dependencies.
 *
 * @param options - Configuration for the instance.
 * @returns A fully-wired ChitraguptaInstance ready for use.
 *
 * @example
 * ```ts
 * import { createChitragupta } from "@chitragupta/cli/api";
 *
 * const chitragupta = await createChitragupta({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-5-20250929",
 *   workingDir: "/path/to/project",
 * });
 *
 * const answer = await chitragupta.prompt("What does this codebase do?");
 * console.log(answer);
 *
 * for await (const chunk of chitragupta.stream("Explain the architecture")) {
 *   if (chunk.type === "text") process.stdout.write(chunk.data as string);
 * }
 *
 * await chitragupta.destroy();
 * ```
 */
export async function createChitragupta(options: ChitraguptaOptions = {}): Promise<ChitraguptaInstance> {
	// ─── 1. Load settings and credentials ─────────────────────────────
	loadCredentials();
	const settings = loadGlobalSettings();

	// ─── 2. Detect project ────────────────────────────────────────────
	const projectPath = options.workingDir ?? process.cwd();
	const project = detectProject(projectPath);

	// ─── 3. Load and cascade config ───────────────────────────────────
	let projectConfig: Record<string, unknown> = {};
	try {
		projectConfig = loadProjectConfig(projectPath);
	} catch {
		// No project config — use defaults
	}

	const globalConfig = createConfig("global", settings as unknown as Record<string, unknown>);
	const projConfig = createConfig("project", projectConfig);
	cascadeConfigs(globalConfig, projConfig);

	// ─── 4. Resolve agent profile ─────────────────────────────────────
	let profile: AgentProfile;
	if (typeof options.profile === "object" && options.profile !== null) {
		profile = options.profile;
	} else {
		const profileId = (options.profile as string | undefined) ?? settings.agentProfile ?? "chitragupta";
		const customProfiles = loadCustomProfiles();
		profile = resolveProfile(profileId, customProfiles) ?? BUILT_IN_PROFILES["chitragupta"];
	}

	// ─── 5. Initialize provider registry ──────────────────────────────
	const registry = createProviderRegistry();
	registerBuiltinProviders(registry, settings);

	const providerId = options.provider ?? settings.defaultProvider ?? "anthropic";
	const modelId = options.model ?? profile.preferredModel ?? settings.defaultModel ?? "claude-sonnet-4-5-20250929";

	const provider = registry.get(providerId);
	if (!provider) {
		const available = registry.getAll().map((p) => p.id).join(", ");
		throw new Error(
			`Provider "${providerId}" not found. Available providers: ${available}`,
		);
	}

	// ─── 6. Load context files and memory ─────────────────────────────
	const contextFiles = loadContextFiles(projectPath);

	let memoryContext: string | undefined;
	if (!options.noMemory) {
		memoryContext = loadProjectMemory(projectPath);
	}

	// ─── 7. Get built-in tools ────────────────────────────────────────
	const tools: ToolHandler[] = getBuiltinTools();

	// ─── 8. Build system prompt ───────────────────────────────────────
	const systemPrompt = buildSystemPrompt({
		profile,
		project,
		contextFiles,
		memoryContext,
		tools,
	});

	// ─── 9. Resolve thinking level ────────────────────────────────────
	const thinkingLevel: ThinkingLevel =
		options.thinkingLevel ?? profile.preferredThinking ?? settings.thinkingLevel ?? "medium";

	// ─── 10. Create session ───────────────────────────────────────────
	let session: Session;
	if (options.sessionId) {
		try {
			session = loadSession(options.sessionId, projectPath);
		} catch {
			// Session not found — create a new one
			session = createSession({
				project: projectPath,
				agent: profile.id,
				model: modelId,
				title: "API Session",
			});
		}
	} else {
		session = createSession({
			project: projectPath,
			agent: profile.id,
			model: modelId,
			title: "API Session",
		});
	}

	// ─── 10a. Wire dharma policy engine ──────────────────────────────
	let policyAdapter: AgentConfig["policyEngine"];
	try {
		const preset = STANDARD_PRESET;
		const dharmaEngine = new PolicyEngine(preset.config);
		for (const ps of preset.policySets) {
			dharmaEngine.addPolicySet(ps);
		}

		policyAdapter = {
			check(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string } {
				const actionType = getActionType(toolName);
				const action: PolicyAction = {
					type: actionType,
					tool: toolName,
					args,
					filePath: (args.path ?? args.file_path ?? args.filePath) as string | undefined,
					command: (args.command ?? args.cmd) as string | undefined,
					content: (args.content ?? args.text) as string | undefined,
					url: (args.url ?? args.uri) as string | undefined,
				};
				const context: PolicyContext = {
					sessionId: session.meta.id,
					agentId: "api",
					agentDepth: 0,
					projectPath,
					totalCostSoFar: 0,
					costBudget: preset.config.costBudget,
					filesModified: [],
					commandsRun: [],
					timestamp: Date.now(),
				};

				let blocked = false;
				let reason: string | undefined;
				try {
					const verdicts: Array<{ status: string; reason: string }> = [];
					for (const ps of preset.policySets) {
						for (const rule of ps.rules) {
							const result = rule.evaluate(action, context);
							if (result && typeof result === "object" && "status" in result && !("then" in result)) {
								verdicts.push(result as { status: string; reason: string });
							}
						}
					}
					const deny = verdicts.find((v) => v.status === "deny");
					if (deny) {
						blocked = true;
						reason = deny.reason;
					}
				} catch {
					// Rule evaluation failed — allow by default
				}
				return blocked ? { allowed: false, reason } : { allowed: true };
			},
		};
	} catch {
		// Silently skip: dharma is optional
	}

	// ─── 10b. Create embedding provider ────────────────────────────────
	const embeddingProvider = await createEmbeddingProviderInstance();

	// ─── 11. Create the agent ─────────────────────────────────────────
	const agentConfig: AgentConfig = {
		profile,
		providerId,
		model: modelId,
		tools,
		systemPrompt,
		thinkingLevel,
		workingDirectory: projectPath,
		policyEngine: policyAdapter,
		embeddingProvider,
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// If resuming a session, replay turns into agent state
	if (options.sessionId && session.turns.length > 0) {
		for (const turn of session.turns) {
			const role = turn.role === "user" ? "user" : "assistant";
			// Prefer full content parts when available, fall back to text-only
			const content = turn.contentParts?.length
				? turn.contentParts
				: [{ type: "text" as const, text: turn.content }];
			agent.pushMessage({
				id: crypto.randomUUID(),
				role: role as "user" | "assistant",
				content: content as unknown as AgentMessage["content"],
				timestamp: Date.now(),
				agentId: turn.agent,
				model: turn.model,
			});
		}
	}

	// Track cumulative cost for maxSessionCost enforcement
	let cumulativeCost = 0;
	const maxCost = options.maxSessionCost;

	// Wire user event handler if provided
	if (options.onEvent) {
		const userHandler = options.onEvent;
		agent.setOnEvent((event: AgentEventType, data: unknown) => {
			userHandler(event, data);
		});
	}

	// ─── 12. MCP tools (optional) ─────────────────────────────────────
	let mcpShutdown: (() => Promise<void>) | undefined;
	try {
		const { loadMCPConfig, startMCPServers, importMCPTools, shutdownMCPServers } =
			await import("./mcp-loader.js");

		const mcpConfigs = loadMCPConfig();
		if (mcpConfigs.length > 0) {
			const mcpRegistry = await startMCPServers(mcpConfigs);
			const mcpTools = importMCPTools(mcpRegistry);
			for (const mcpTool of mcpTools) {
				agent.registerTool(mcpTool as unknown as ToolHandler);
			}
			mcpShutdown = shutdownMCPServers;
		}
	} catch {
		// MCP loading is optional
	}

	// ─── Build the ChitraguptaInstance ───────────────────────────────────

	let destroyed = false;

	const instance: ChitraguptaInstance = {
		agent,

		async prompt(message: string): Promise<string> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");

			if (maxCost !== undefined && cumulativeCost >= maxCost) {
				throw new Error(
					`Session cost limit exceeded: $${cumulativeCost.toFixed(4)} >= $${maxCost.toFixed(4)}`,
				);
			}

			const response = await agent.prompt(message);
			const text = extractText(response);

			// Update cumulative cost
			if (response.cost) {
				cumulativeCost += response.cost.total;
			}

			// Record turns into session
			session.turns.push({
				turnNumber: session.turns.length + 1,
				role: "user",
				content: message,
			});
			session.turns.push({
				turnNumber: session.turns.length + 1,
				role: "assistant",
				agent: profile.id,
				model: modelId,
				content: text,
				contentParts: response.content as unknown as Array<Record<string, unknown>>,
			});

			return text;
		},

		async *stream(message: string): AsyncGenerator<StreamChunk, void, undefined> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");

			if (maxCost !== undefined && cumulativeCost >= maxCost) {
				throw new Error(
					`Session cost limit exceeded: $${cumulativeCost.toFixed(4)} >= $${maxCost.toFixed(4)}`,
				);
			}

			// Capture chunks via the event system
			let streamError: Error | null = null;
			const chunks: StreamChunk[] = [];
			let resolveChunk: ((chunk: StreamChunk | null) => void) | null = null;
			const chunkQueue: (StreamChunk | null)[] = [];

			const pushChunk = (chunk: StreamChunk | null) => {
				if (resolveChunk) {
					const r = resolveChunk;
					resolveChunk = null;
					r(chunk);
				} else {
					chunkQueue.push(chunk);
				}
			};

			const nextChunk = (): Promise<StreamChunk | null> => {
				if (chunkQueue.length > 0) {
					return Promise.resolve(chunkQueue.shift()!);
				}
				return new Promise<StreamChunk | null>((resolve) => {
					resolveChunk = resolve;
				});
			};

			// Wire up streaming events
			const previousOnEvent = agent.getConfig().onEvent;
			let fullText = "";

			agent.setOnEvent((event: AgentEventType, data: unknown) => {
				const eventData = data as Record<string, unknown>;

				switch (event) {
					case "stream:text":
						fullText += eventData.text as string;
						pushChunk({ type: "text", data: eventData.text });
						break;
					case "stream:thinking":
						pushChunk({ type: "thinking", data: eventData.text });
						break;
					case "tool:start":
						pushChunk({ type: "tool_start", data: { name: eventData.name, id: eventData.id } });
						break;
					case "tool:done":
						pushChunk({ type: "tool_done", data: { name: eventData.name, id: eventData.id, result: eventData.result } });
						break;
					case "tool:error":
						pushChunk({ type: "tool_error", data: { name: eventData.name, error: eventData.error } });
						break;
					case "stream:usage":
						pushChunk({ type: "usage", data: eventData.usage });
						break;
					case "stream:done":
						pushChunk({ type: "done", data: { stopReason: eventData.stopReason, cost: eventData.cost } });
						break;
				}

				// Forward to user's original handler
				previousOnEvent?.(event, data);
			});

			// Run the prompt in the background and signal completion
			const promptDone = agent.prompt(message).then((response) => {
				if (response.cost) {
					cumulativeCost += response.cost.total;
				}

				// Record turns
				session.turns.push({
					turnNumber: session.turns.length + 1,
					role: "user",
					content: message,
				});
				session.turns.push({
					turnNumber: session.turns.length + 1,
					role: "assistant",
					agent: profile.id,
					model: modelId,
					content: fullText,
					contentParts: response.content as unknown as Array<Record<string, unknown>>,
				});

				pushChunk(null); // Signal end
			}).catch((err) => {
				streamError = err instanceof Error ? err : new Error(String(err));
				pushChunk(null); // Signal end (consumer will check streamError)
			});

			// Yield chunks as they arrive
			while (true) {
				const chunk = await nextChunk();
				if (chunk === null) break;
				yield chunk;
			}

			// Ensure the prompt finishes (no unhandled rejection — error stored in streamError)
			await promptDone;

			// Restore previous event handler before throwing
			if (previousOnEvent) {
				agent.setOnEvent(previousOnEvent);
			}

			// Now propagate the stored error after generator cleanup
			if (streamError) {
				throw streamError;
			}
		},

		async searchMemory(query: string, limit?: number): Promise<MemorySearchResult[]> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");

			const results = searchMemory(query);
			const limited = limit ? results.slice(0, limit) : results;

			return limited.map((r) => ({
				content: r.content,
				score: r.relevance ?? 0,
				source: r.scope.type === "project"
					? `project:${r.scope.path}`
					: r.scope.type === "global"
						? "global"
						: r.scope.type === "agent"
							? `agent:${r.scope.agentId}`
							: `session:${r.scope.sessionId}`,
			}));
		},

		getSession(): SessionInfo {
			return {
				id: session.meta.id,
				title: session.meta.title,
				turnCount: session.turns.length,
				createdAt: new Date(session.meta.created).getTime(),
			};
		},

		async saveSession(): Promise<void> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");
			saveSession(session);
		},

		getStats(): SessionStats {
			const messages = agent.getMessages();
			const costs = sumCosts(messages);
			const turnCount = messages.filter((m) => m.role === "user").length;

			return {
				totalCost: cumulativeCost > 0 ? cumulativeCost : costs.totalCost,
				totalInputTokens: costs.totalInputTokens,
				totalOutputTokens: costs.totalOutputTokens,
				turnCount,
			};
		},

		async destroy(): Promise<void> {
			if (destroyed) return;
			destroyed = true;

			// Abort any running agent loop
			agent.abort();

			// Shutdown MCP servers
			if (mcpShutdown) {
				try {
					await mcpShutdown();
				} catch {
					// Best-effort MCP cleanup
				}
			}
		},
	};

	return instance;
}

// ─── Re-exports for convenience ─────────────────────────────────────────────

export type { AgentProfile, ThinkingLevel, CostBreakdown } from "@chitragupta/core";
export type { Agent, AgentConfig, AgentMessage, AgentEventType } from "@chitragupta/anina";
