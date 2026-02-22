/**
 * @chitragupta/cli — ChitraguptaInstance builder extracted from api.ts.
 *
 * Contains the instance methods:
 *   - prompt() — send a message and get the full text response
 *   - stream() — send a message and stream response chunks
 *   - searchMemory() — search project memory by query
 *   - getSession() / saveSession() — session management
 *   - getStats() — token/cost statistics
 *   - destroy() — clean up all resources
 */

import { Agent } from "@chitragupta/anina";
import type { AgentEventType, AgentMessage, ToolHandler } from "@chitragupta/anina";
import type { AgentProfile } from "@chitragupta/core";

import {
	saveSession,
	addTurn,
} from "@chitragupta/smriti/session-store";
import { searchMemory } from "@chitragupta/smriti/search";
import type { Session } from "@chitragupta/smriti/types";

import type { ApiWiringResult } from "./api-wiring.js";

// ─── Public Types ───────────────────────────────────────────────────────────

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
		if (msg.cost) { totalCost += msg.cost.total; }
	}
	return { totalCost, totalInputTokens: 0, totalOutputTokens: 0 };
}

// ─── Builder ────────────────────────────────────────────────────────────────

/** Parameters for building a ChitraguptaInstance. */
export interface BuildInstanceParams {
	agent: Agent;
	session: Session;
	profile: AgentProfile;
	providerId: string;
	modelId: string;
	projectPath: string;
	maxSessionCost?: number;
	onEvent?: (event: string, data: unknown) => void;
	wiring: ApiWiringResult;
	mcpShutdown?: () => Promise<void>;
}

/**
 * Build a ChitraguptaInstance from its constituent parts.
 *
 * This assembles the public API surface (prompt, stream, searchMemory, etc.)
 * around the given agent, session, and wiring infrastructure.
 */
export function buildInstance(params: BuildInstanceParams): ChitraguptaInstance {
	const { agent, profile, providerId, modelId, projectPath, wiring, mcpShutdown } = params;
	let { session } = params;

	let destroyed = false;
	let cumulativeCost = 0;
	const maxCost = params.maxSessionCost;

	// Wire user event handler
	if (params.onEvent) {
		const userHandler = params.onEvent;
		agent.setOnEvent((event: AgentEventType, data: unknown) => {
			userHandler(event, data);
		});
	}

	const saveCheckpoint = async () => {
		if (!wiring.checkpointManager) return;
		try {
			await wiring.checkpointManager.save(session.meta.id, {
				version: 1, sessionId: session.meta.id, turns: [...agent.getMessages()],
				metadata: { model: modelId, providerId, updatedAt: new Date().toISOString() },
				timestamp: Date.now(),
			});
		} catch { /* best-effort */ }
	};

	const persistTurn = async (turn: {
		role: "user" | "assistant"; content: string;
		agent?: string; model?: string;
		contentParts?: Array<Record<string, unknown>>;
	}) => {
		const turnNumber = session.turns.length + 1;
		session.turns.push({ ...turn, turnNumber });
		try {
			await addTurn(session.meta.id, projectPath, { ...turn, turnNumber });
		} catch {
			try { saveSession(session); } catch { /* best-effort */ }
		}
	};

	const persistExchange = async (p: {
		userMessage: string; assistantText: string;
		assistantContentParts?: Array<Record<string, unknown>>;
	}) => {
		await persistTurn({ role: "user", content: p.userMessage });
		await persistTurn({
			role: "assistant", agent: profile.id, model: modelId,
			content: p.assistantText, contentParts: p.assistantContentParts,
		});
		if (wiring.nidraDaemon) { try { wiring.nidraDaemon.touch(); } catch { /* best-effort */ } }
		await saveCheckpoint();
	};

	const instance: ChitraguptaInstance = {
		agent,

		async prompt(message: string): Promise<string> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");
			if (maxCost !== undefined && cumulativeCost >= maxCost) {
				throw new Error(`Session cost limit exceeded: $${cumulativeCost.toFixed(4)} >= $${maxCost.toFixed(4)}`);
			}
			const response = await agent.prompt(message);
			const text = extractText(response);
			if (response.cost) { cumulativeCost += response.cost.total; }
			await persistExchange({
				userMessage: message, assistantText: text,
				assistantContentParts: response.content as unknown as Array<Record<string, unknown>>,
			});
			return text;
		},

		async *stream(message: string): AsyncGenerator<StreamChunk, void, undefined> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");
			if (maxCost !== undefined && cumulativeCost >= maxCost) {
				throw new Error(`Session cost limit exceeded: $${cumulativeCost.toFixed(4)} >= $${maxCost.toFixed(4)}`);
			}

			let streamError: Error | null = null;
			let resolveChunk: ((chunk: StreamChunk | null) => void) | null = null;
			const chunkQueue: (StreamChunk | null)[] = [];

			const pushChunk = (chunk: StreamChunk | null) => {
				if (resolveChunk) { const r = resolveChunk; resolveChunk = null; r(chunk); }
				else { chunkQueue.push(chunk); }
			};
			const nextChunk = (): Promise<StreamChunk | null> => {
				if (chunkQueue.length > 0) return Promise.resolve(chunkQueue.shift()!);
				return new Promise<StreamChunk | null>((resolve) => { resolveChunk = resolve; });
			};

			const previousOnEvent = agent.getConfig().onEvent;
			let fullText = "";
			const restoreEventHandler = () => { if (previousOnEvent) { agent.setOnEvent(previousOnEvent); } };

			agent.setOnEvent((event: AgentEventType, data: unknown) => {
				const d = data as Record<string, unknown>;
				switch (event) {
					case "stream:text": fullText += d.text as string; pushChunk({ type: "text", data: d.text }); break;
					case "stream:thinking": pushChunk({ type: "thinking", data: d.text }); break;
					case "tool:start": pushChunk({ type: "tool_start", data: { name: d.name, id: d.id } }); break;
					case "tool:done": pushChunk({ type: "tool_done", data: { name: d.name, id: d.id, result: d.result } }); break;
					case "tool:error": pushChunk({ type: "tool_error", data: { name: d.name, error: d.error } }); break;
					case "stream:usage": pushChunk({ type: "usage", data: d.usage }); break;
					case "stream:done": pushChunk({ type: "done", data: { stopReason: d.stopReason, cost: d.cost } }); break;
				}
				previousOnEvent?.(event, data);
			});

			const promptDone = agent.prompt(message).then(async (response) => {
				if (response.cost) { cumulativeCost += response.cost.total; }
				const assistantText = fullText.length > 0 ? fullText : extractText(response);
				await persistExchange({
					userMessage: message, assistantText,
					assistantContentParts: response.content as unknown as Array<Record<string, unknown>>,
				});
				pushChunk(null);
			}).catch((err) => {
				streamError = err instanceof Error ? err : new Error(String(err));
				pushChunk(null);
			});

			try {
				while (true) {
					const chunk = await nextChunk();
					if (chunk === null) break;
					yield chunk;
				}
				await promptDone;
			} finally { restoreEventHandler(); }

			if (streamError) { throw streamError; }
		},

		async searchMemory(query: string, limit?: number): Promise<MemorySearchResult[]> {
			if (destroyed) throw new Error("ChitraguptaInstance has been destroyed");
			const results = searchMemory(query);
			const limited = limit ? results.slice(0, limit) : results;
			return limited.map((r) => ({
				content: r.content, score: r.relevance ?? 0,
				source: r.scope.type === "project" ? `project:${r.scope.path}`
					: r.scope.type === "global" ? "global"
					: r.scope.type === "agent" ? `agent:${r.scope.agentId}`
					: `session:${r.scope.sessionId}`,
			}));
		},

		getSession(): SessionInfo {
			return {
				id: session.meta.id, title: session.meta.title,
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
			agent.abort();
			for (const cleanup of wiring.skillWatcherCleanups) { try { cleanup(); } catch { /* best-effort */ } }
			if (wiring.kaalaStopMonitoring) { try { wiring.kaalaStopMonitoring(); } catch { /* best-effort */ } }
			if (wiring.nidraDaemon) { try { await wiring.nidraDaemon.stop(); } catch { /* best-effort */ } }
			if (wiring.commHubDestroy) { try { wiring.commHubDestroy(); } catch { /* best-effort */ } }
			if (mcpShutdown) { try { await mcpShutdown(); } catch { /* best-effort */ } }
			try { saveSession(session); } catch { /* best-effort */ }
		},
	};

	return instance;
}
