/**
 * Bridges @chitragupta/anina (Agent) with @chitragupta/smriti (Memory).
 *
 * Creates sessions, persists turns, loads memory context for system prompts,
 * and handles sub-agent sessions. Memory context assembly and command handling
 * are in memory-bridge-context.ts.
 */

import { createLogger } from "@chitragupta/core";
import type { MemoryScope, Session, SessionOpts, SessionToolCall, SessionTurn } from "@chitragupta/smriti";
import {
	addTurn,
	appendMemory,
	configureRecallScoring,
	createSession,
	EmbeddingService,
	extractSignals,
	GraphRAGEngine,
	HybridSearchEngine,
	IdentityContext,
	loadSession,
	RecallEngine,
	SmaranStore,
	StreamManager,
} from "@chitragupta/smriti";
import type { EmbeddingProvider } from "@chitragupta/swara";
import { buildMemoryContext, handleMemoryCommand as handleCmd, persistSignals } from "./memory-bridge-context.js";

// Re-export context utilities for consumers
export { buildMemoryContext, handleMemoryCommand, persistSignals } from "./memory-bridge-context.js";

const log = createLogger("anina:memory-bridge");

// ─── Config ─────────────────────────────────────────────────────────────────

export interface MemoryBridgeConfig {
	/** Enable or disable memory persistence. */
	enabled: boolean;
	/** Project path for scoping sessions and memory. */
	project: string;
	/** Enable GraphRAG indexing for session content. */
	enableGraphRAG?: boolean;
	/** Enable hybrid search (BM25 + vector + GraphRAG fusion). */
	enableHybridSearch?: boolean;
	/** Ollama endpoint for embeddings. */
	ollamaEndpoint?: string;
	/** Embedding provider from swara for vector generation. */
	embeddingProvider?: EmbeddingProvider;
	/** Enable explicit memory (Smaran) for "remember this" commands. */
	enableSmaran?: boolean;
	/** Path to search for identity files (SOUL.md, IDENTITY.md, etc.) */
	identityPath?: string;
	/** Optional persistence adapter for daemon-backed session/memory writes. */
	persistence?: MemoryBridgePersistence;
}

export interface MemoryBridgePersistence {
	createSession(opts: SessionOpts): Promise<Session> | Session;
	addTurn(sessionId: string, project: string, turn: SessionTurn): Promise<void> | void;
	loadSession(sessionId: string, project: string): Promise<Session> | Session;
	appendMemory(scope: MemoryScope, entry: string): Promise<void> | void;
}

// ─── MemoryBridge ───────────────────────────────────────────────────────────

const defaultPersistence: MemoryBridgePersistence = {
	createSession,
	addTurn,
	loadSession,
	appendMemory,
};

export class MemoryBridge {
	private config: MemoryBridgeConfig;
	private persistence: MemoryBridgePersistence;
	private sessionId: string | null = null;
	private session: Session | null = null;
	private turnCounter = 0;
	private graphEngine: GraphRAGEngine | null = null;
	private recallEngine: RecallEngine | null = null;
	private hybridSearch: HybridSearchEngine | null = null;
	private streamManager: StreamManager | null = null;
	private smaranStore: SmaranStore | null = null;
	private identityContext: IdentityContext | null = null;
	private surfacedMemoryIds = new Set<string>();

	constructor(config: MemoryBridgeConfig) {
		this.config = config;
		this.persistence = config.persistence ?? defaultPersistence;
		const embeddingService = new EmbeddingService(config.embeddingProvider);
		if (config.enableGraphRAG) {
			this.graphEngine = new GraphRAGEngine({ endpoint: config.ollamaEndpoint, embeddingService });
			this.recallEngine = new RecallEngine();
		}
		configureRecallScoring({ embeddingService });
		if (config.enableHybridSearch) {
			this.hybridSearch = new HybridSearchEngine({}, this.recallEngine ?? undefined, this.graphEngine ?? undefined);
		}
		this.streamManager = new StreamManager();
		if (config.enableSmaran !== false) this.smaranStore = new SmaranStore();
		if (config.identityPath || config.project) {
			this.identityContext = new IdentityContext({ projectPath: config.identityPath ?? config.project });
		}
	}

	/** Create a new session for this agent. Returns the session ID. */
	async initSession(agentId: string, profile: string, model: string, project: string): Promise<string> {
		if (!this.config.enabled) return "";
			const session = await this.persistence.createSession({
				title: `Agent session: ${profile}`,
				project,
				agent: agentId,
				model,
			metadata: {
					agentLabel: profile,
					actorId: agentId,
					surface: "agent",
					channel: "internal",
					sessionReusePolicy: "isolated",
					source: "anina.memory-bridge.initSession",
				},
			});
		this.session = session;
		this.sessionId = session.meta.id;
		this.turnCounter = 0;
		this.surfacedMemoryIds.clear();
		return session.meta.id;
	}

	/** Record a user turn. */
	async recordUserTurn(sessionId: string, content: string): Promise<void> {
		if (!this.config.enabled || !sessionId) return;
		this.turnCounter++;
		await this.persistence.addTurn(sessionId, this.config.project, { turnNumber: this.turnCounter, role: "user", content });
		await this.refreshSessionSnapshot(sessionId);
	}

	/** Record an assistant turn with optional tool calls. */
	async recordAssistantTurn(
		sessionId: string,
		content: string,
		toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
	): Promise<void> {
		if (!this.config.enabled || !sessionId) return;
		this.turnCounter++;
		const mapped: SessionToolCall[] | undefined = toolCalls?.map((tc) => ({
			name: tc.name,
			input: tc.input,
			result: tc.result,
			isError: tc.isError,
		}));
		await this.persistence.addTurn(sessionId, this.config.project, {
			turnNumber: this.turnCounter,
			role: "assistant",
			content,
			toolCalls: mapped,
		});
		await this.refreshSessionSnapshot(sessionId);
		this.indexTurnAsync(content, toolCalls).catch((e) => {
			log.debug("background indexing failed", { error: String(e) });
		});
	}

	private async refreshSessionSnapshot(sessionId: string): Promise<void> {
		try {
			const latest = await this.persistence.loadSession(sessionId, this.config.project);
			this.session = latest;
			this.sessionId = latest.meta.id;
		} catch (e) {
			log.debug("session snapshot refresh failed", { error: String(e), sessionId });
		}
	}

	private async indexTurnAsync(
		content: string,
		toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
	): Promise<void> {
		if (this.graphEngine && this.session) {
			await this.graphEngine.indexSession(this.session).catch((e) => {
				log.debug("GraphRAG indexing failed", { error: String(e) });
			});
		}
		if (this.recallEngine && this.session) {
			await this.recallEngine.indexSession(this.session).catch((e) => {
				log.debug("RecallEngine indexing failed", { error: String(e) });
			});
		}
		if (this.streamManager) {
			const turn = {
				turnNumber: this.turnCounter,
				role: "assistant" as const,
				content,
				toolCalls: toolCalls?.map((tc) => ({ name: tc.name, input: tc.input, result: tc.result, isError: tc.isError })),
			};
			persistSignals(extractSignals(turn), this.streamManager);
		}
	}

	/** Search across all memory using hybrid search. */
	async search(query: string): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
		if (!this.hybridSearch) return [];
		const results = await this.hybridSearch.search(query);
		return results.map((r: { id: string; title: string; content: string; score: number }) => ({
			id: r.id,
			title: r.title,
			content: r.content,
			score: r.score,
		}));
	}

	/** Self-RAG gated search — only retrieves when a knowledge gap is detected. */
	async gatedSearch(query: string): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
		if (!this.hybridSearch) return [];
		const results = await this.hybridSearch.gatedSearch(query);
		return results.map((r: { id: string; title: string; content: string; score: number }) => ({
			id: r.id,
			title: r.title,
			content: r.content,
			score: r.score,
		}));
	}

	/** Load memory context to inject into system prompt. */
	async loadMemoryContext(project: string, agentId: string): Promise<string> {
		if (!this.config.enabled) return "";
		this.identityContext?.clearCache();
		return buildMemoryContext(project, agentId, {
			identityContext: this.identityContext,
			smaranStore: this.smaranStore,
			streamManager: this.streamManager,
		});
	}

	/** Process a user message for memory commands. Returns response string if handled, null otherwise. */
	handleMemoryCommand(userMessage: string, sessionId?: string): string | null {
		return handleCmd(userMessage, this.smaranStore, sessionId);
	}

	/** Get the Smaran store for direct access. */
	getSmaranStore(): SmaranStore | null {
		return this.smaranStore;
	}

	/** Get the Identity context loader. */
	getIdentityContext(): IdentityContext | null {
		return this.identityContext;
	}

	/** Query Smaran memories relevant to a user message. */
	recallForQuery(query: string): string {
		if (!this.smaranStore) return "";
		const proactive = this.smaranStore.buildProactiveContextSection(query, {
			threshold: 0.8,
			limit: 4,
			excludeIds: this.surfacedMemoryIds,
		});
		for (const id of proactive.surfacedIds) this.surfacedMemoryIds.add(id);
		if (this.surfacedMemoryIds.size > 500) this.surfacedMemoryIds.clear();
		const recalled = this.smaranStore.buildContextSection(query, proactive.section ? 1100 : 1500, {
			excludeIds: this.surfacedMemoryIds,
		});
		if (proactive.section && recalled) return `${proactive.section}\n${recalled}`;
		return proactive.section || recalled;
	}

	/** Create a sub-agent session linked to parent. */
	async createSubSession(
		parentSessionId: string,
		purpose: string,
		agentId: string,
		model: string,
		project: string,
	): Promise<string> {
		if (!this.config.enabled) return "";
			const session = await this.persistence.createSession({
				title: `Sub-agent: ${purpose}`,
				project,
				agent: agentId,
			model,
			parentSessionId,
			metadata: {
					agentLabel: purpose,
					actorId: agentId,
					parentSessionId,
					surface: "subagent",
					channel: "internal",
					sessionReusePolicy: "isolated",
					source: "anina.memory-bridge.createSubSession",
				},
			});
		return session.meta.id;
	}

	/** Bubble up sub-agent findings to parent memory. */
	async bubbleUpFindings(subSessionId: string, parentSessionId: string, project: string): Promise<void> {
		if (!this.config.enabled || !subSessionId) return;
		try {
			const subSession = await this.persistence.loadSession(subSessionId, project);
			let lastAssistantContent = "";
			for (let i = subSession.turns.length - 1; i >= 0; i--) {
				if (subSession.turns[i].role === "assistant") {
					lastAssistantContent = subSession.turns[i].content;
					break;
				}
			}
			if (!lastAssistantContent) return;
			const summary =
				lastAssistantContent.length > 500 ? `${lastAssistantContent.slice(0, 500)}...` : lastAssistantContent;
			const entry = `**Sub-agent finding** (session: ${subSessionId}, parent: ${parentSessionId})\n\n${summary}`;
			Promise.resolve(this.persistence.appendMemory({ type: "project", path: project }, entry)).catch((e) => {
				log.debug("memory append failed", { error: String(e) });
			});
		} catch {
			/* Best-effort */
		}
	}

	/** Get the session ID for this bridge instance. */
	getSessionId(): string | null {
		return this.sessionId;
	}
}
