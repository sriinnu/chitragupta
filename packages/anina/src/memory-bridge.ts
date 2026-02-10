/**
 * Bridges @chitragupta/anina (Agent) with @chitragupta/smriti (Memory).
 *
 * Responsibilities:
 * - Create a session when an agent starts
 * - Persist each turn (user + assistant) to the session
 * - Load memory context (identity + projects + tasks) for system prompts
 * - Sub-agents create their own sessions linked to parent
 * - Memory flows upward: sub-agent discoveries update parent memory
 */

import {
	createSession,
	loadSession,
	addTurn,
	getMemory,
	appendMemory,
	GraphRAGEngine,
	RecallEngine,
	HybridSearchEngine,
	extractSignals,
	StreamManager,
	configureRecallScoring,
	EmbeddingService,
	SmaranStore,
	detectMemoryIntent,
	IdentityContext,
} from "@chitragupta/smriti";
import type { Session, SessionToolCall, StreamSignals, SmaranCategory } from "@chitragupta/smriti";
import type { EmbeddingProvider } from "@chitragupta/swara";
import { createLogger } from "@chitragupta/core";

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
}

// ─── MemoryBridge ───────────────────────────────────────────────────────────

export class MemoryBridge {
	private config: MemoryBridgeConfig;
	private sessionId: string | null = null;
	private session: Session | null = null;
	private turnCounter = 0;
	private graphEngine: GraphRAGEngine | null = null;
	private recallEngine: RecallEngine | null = null;
	private hybridSearch: HybridSearchEngine | null = null;
	private streamManager: StreamManager | null = null;
	private smaranStore: SmaranStore | null = null;
	private identityContext: IdentityContext | null = null;

	constructor(config: MemoryBridgeConfig) {
		this.config = config;

		const embeddingService = new EmbeddingService(config.embeddingProvider);

		// Initialize GraphRAG + Recall engines if enabled
		if (config.enableGraphRAG) {
			this.graphEngine = new GraphRAGEngine({
				endpoint: config.ollamaEndpoint,
				embeddingService,
			});
			this.recallEngine = new RecallEngine();
		}

		// Configure recall scoring with the shared embedding service
		configureRecallScoring({ embeddingService });

		// Initialize hybrid search if enabled
		if (config.enableHybridSearch) {
			this.hybridSearch = new HybridSearchEngine(
				{},
				this.recallEngine ?? undefined,
				this.graphEngine ?? undefined,
			);
		}

		// Always create the stream manager for 4-stream persistence
		this.streamManager = new StreamManager();

		// Initialize explicit memory store (Smaran)
		if (config.enableSmaran !== false) {
			this.smaranStore = new SmaranStore();
		}

		// Initialize identity context loader
		if (config.identityPath || config.project) {
			this.identityContext = new IdentityContext({
				projectPath: config.identityPath ?? config.project,
			});
		}
	}

	/**
	 * Create a new session for this agent.
	 * Returns the session ID.
	 */
	async initSession(
		agentId: string,
		profile: string,
		model: string,
		project: string,
	): Promise<string> {
		if (!this.config.enabled) return "";

		const session = createSession({
			title: `Agent session: ${profile}`,
			project,
			agent: agentId,
			model,
		});

		this.session = session;
		this.sessionId = session.meta.id;
		this.turnCounter = 0;

		return session.meta.id;
	}

	/**
	 * Record a user turn.
	 */
	async recordUserTurn(sessionId: string, content: string): Promise<void> {
		if (!this.config.enabled || !sessionId) return;

		this.turnCounter++;
		await addTurn(sessionId, this.config.project, {
			turnNumber: this.turnCounter,
			role: "user",
			content,
		});
	}

	/**
	 * Record an assistant turn with optional tool calls.
	 */
	async recordAssistantTurn(
		sessionId: string,
		content: string,
		toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
	): Promise<void> {
		if (!this.config.enabled || !sessionId) return;

		this.turnCounter++;

		const mappedToolCalls: SessionToolCall[] | undefined = toolCalls?.map((tc) => ({
			name: tc.name,
			input: tc.input,
			result: tc.result,
			isError: tc.isError,
		}));

		await addTurn(sessionId, this.config.project, {
			turnNumber: this.turnCounter,
			role: "assistant",
			content,
			toolCalls: mappedToolCalls,
		});

		// Async non-blocking: index for search engines
		this.indexTurnAsync(sessionId, content, toolCalls).catch((e) => { log.debug("background indexing failed", { error: String(e) }); });
	}

	private async indexTurnAsync(
		sessionId: string,
		content: string,
		toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
	): Promise<void> {
		// Index into GraphRAG if enabled
		if (this.graphEngine && this.session) {
			await this.graphEngine.indexSession(this.session).catch((e) => { log.debug("GraphRAG indexing failed", { error: String(e) }); });
		}

		// Index into RecallEngine if enabled
		if (this.recallEngine && this.session) {
			await this.recallEngine.indexSession(this.session).catch((e) => { log.debug("RecallEngine indexing failed", { error: String(e) }); });
		}

		// Extract 4-stream signals and persist
		if (this.streamManager) {
			const turn = {
				turnNumber: this.turnCounter,
				role: "assistant" as const,
				content,
				toolCalls: toolCalls?.map((tc) => ({
					name: tc.name,
					input: tc.input,
					result: tc.result,
					isError: tc.isError,
				})),
			};
			const signals = extractSignals(turn);
			this.persistSignals(signals);
		}
	}

	private persistSignals(signals: StreamSignals): void {
		if (!this.streamManager) return;
		try {
			for (const entry of signals.identity) {
				this.streamManager.append("identity", entry + "\n");
			}
			for (const entry of signals.projects) {
				this.streamManager.append("projects", entry + "\n");
			}
			for (const entry of signals.tasks) {
				this.streamManager.append("tasks", entry + "\n");
			}
			// flow entries are ephemeral — only persist if there are few
			if (signals.flow.length <= 5) {
				for (const entry of signals.flow) {
					this.streamManager.append("flow", entry + "\n");
				}
			}
		} catch {
			// Non-fatal: stream persistence failure
		}
	}

	/**
	 * Search across all memory using hybrid search.
	 * Falls back to empty results if no search engines are available.
	 */
	async search(query: string): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
		if (this.hybridSearch) {
			const results = await this.hybridSearch.search(query);
			return results.map((r: { id: string; title: string; content: string; score: number }) => ({
				id: r.id,
				title: r.title,
				content: r.content,
				score: r.score,
			}));
		}
		return [];
	}

	/**
	 * Self-RAG gated search — only retrieves when a knowledge gap is detected.
	 */
	async gatedSearch(query: string): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
		if (this.hybridSearch) {
			const results = await this.hybridSearch.gatedSearch(query);
			return results.map((r: { id: string; title: string; content: string; score: number }) => ({
				id: r.id,
				title: r.title,
				content: r.content,
				score: r.score,
			}));
		}
		return [];
	}

	/**
	 * Load memory context to inject into system prompt.
	 *
	 * Assembles a comprehensive context from multiple sources:
	 *   1. Identity files (SOUL.md, IDENTITY.md, personality.md, USER.md)
	 *   2. Scoped memory (global, project, agent)
	 *   3. Explicit memories (Smaran — preferences, facts, decisions)
	 *   4. 4-stream signals (identity, projects, tasks)
	 *
	 * This context shapes how the agent responds — its personality,
	 * knowledge of the user, and recall of previous conversations.
	 */
	async loadMemoryContext(project: string, agentId: string): Promise<string> {
		if (!this.config.enabled) return "";

		const sections: string[] = [];

		// ─── Identity Files (SOUL.md, IDENTITY.md, personality.md, USER.md) ─
		if (this.identityContext) {
			const identitySection = this.identityContext.load();
			if (identitySection) {
				sections.push(identitySection);
			}
		}

		// ─── Scoped Memory (global, project, agent) ───────────────────────
		const globalMemory = getMemory({ type: "global" });
		const projectMemory = getMemory({ type: "project", path: project });
		const agentMemory = getMemory({ type: "agent", agentId });

		if (globalMemory || projectMemory || agentMemory) {
			sections.push("## Memory Context");
			sections.push("");

			if (globalMemory) {
				sections.push("### Global Knowledge");
				sections.push(globalMemory);
				sections.push("");
			}

			if (projectMemory) {
				sections.push("### Project Knowledge");
				sections.push(projectMemory);
				sections.push("");
			}

			if (agentMemory) {
				sections.push("### Agent Notes");
				sections.push(agentMemory);
				sections.push("");
			}
		}

		// ─── Explicit Memory (Smaran) ─────────────────────────────────────
		if (this.smaranStore) {
			// Apply temporal decay on load
			this.smaranStore.decayConfidence();

			const smaranSection = this.smaranStore.buildContextSection();
			if (smaranSection) {
				sections.push(smaranSection);
			}
		}

		// ─── 4-Stream Memory ──────────────────────────────────────────────
		if (this.streamManager) {
			const identityContent = this.streamManager.readContent("identity");
			const projectsContent = this.streamManager.readContent("projects");
			const tasksContent = this.streamManager.readContent("tasks");

			if (identityContent) {
				sections.push("### Identity Memory");
				sections.push(identityContent.slice(0, 2000));
				sections.push("");
			}
			if (projectsContent) {
				sections.push("### Project Decisions");
				sections.push(projectsContent.slice(0, 2000));
				sections.push("");
			}
			if (tasksContent) {
				sections.push("### Active Tasks");
				sections.push(tasksContent.slice(0, 1000));
				sections.push("");
			}
		}

		// ─── Memory Instructions ──────────────────────────────────────────
		if (this.smaranStore) {
			sections.push("## Memory Capabilities");
			sections.push("");
			sections.push("You have an explicit memory system. When the user says:");
			sections.push('- "remember that..." / "note that..." → Save to memory immediately');
			sections.push('- "forget..." / "delete memory..." → Remove from memory');
			sections.push('- "what do you remember about..." → Recall from memory');
			sections.push('- "list my preferences" → Show stored preferences');
			sections.push("");
			sections.push("When you recall relevant memories during a conversation, use them proactively:");
			sections.push("- If the user asks about restaurants and you know their food preferences, suggest accordingly");
			sections.push("- If the user mentions a topic you have memories about, reference them naturally");
			sections.push("- Always acknowledge when you're using stored memories");
			sections.push("");
		}

		return sections.join("\n");
	}

	/**
	 * Process a user message for memory commands.
	 *
	 * Call this BEFORE sending the message to the LLM.
	 * If a memory intent is detected, it's handled here and
	 * a response string is returned. If null, proceed normally.
	 *
	 * @returns Response string if memory command handled, null otherwise.
	 */
	handleMemoryCommand(userMessage: string, sessionId?: string): string | null {
		if (!this.smaranStore) return null;

		const intent = detectMemoryIntent(userMessage);
		if (!intent) return null;

		switch (intent.action) {
			case "remember": {
				if (!intent.content) return null;
				const entry = this.smaranStore.remember(
					intent.content,
					intent.category ?? "fact",
					{ sessionId, source: "explicit" },
				);
				return `Remembered: "${entry.content}" (${entry.category}). ID: ${entry.id}`;
			}

			case "forget": {
				if (!intent.query) return null;
				const count = this.smaranStore.forgetByContent(intent.query);
				if (count > 0) {
					return `Forgot ${count} memory${count > 1 ? " entries" : ""} matching "${intent.query}".`;
				}
				return `No memories found matching "${intent.query}".`;
			}

			case "recall": {
				if (!intent.query) return null;
				const memories = this.smaranStore.recall(intent.query, 5);
				if (memories.length === 0) {
					return `I don't have any memories about "${intent.query}".`;
				}
				const lines = memories.map(m => `- **${m.category}**: ${m.content}`);
				return `Here's what I remember about "${intent.query}":\n${lines.join("\n")}`;
			}

			case "list": {
				const entries = intent.category
					? this.smaranStore.listByCategory(intent.category)
					: this.smaranStore.listAll();

				if (entries.length === 0) {
					const cat = intent.category ? ` in category "${intent.category}"` : "";
					return `No memories stored${cat}.`;
				}

				const label = intent.category ?? "all";
				const lines = entries.slice(0, 20).map(m =>
					`- [${m.category}] ${m.content} (confidence: ${m.confidence.toFixed(1)})`,
				);
				return `**Stored memories (${label}):** ${entries.length} total\n${lines.join("\n")}`;
			}

			default:
				return null;
		}
	}

	/**
	 * Get the Smaran store for direct access (e.g., from consolidation bridge).
	 */
	getSmaranStore(): SmaranStore | null {
		return this.smaranStore;
	}

	/**
	 * Get the Identity context loader.
	 */
	getIdentityContext(): IdentityContext | null {
		return this.identityContext;
	}

	/**
	 * Query Smaran memories relevant to a user message.
	 * Used by the agent loop to inject relevant memories per-turn.
	 */
	recallForQuery(query: string): string {
		if (!this.smaranStore) return "";
		return this.smaranStore.buildContextSection(query, 1500);
	}

	/**
	 * Create a sub-agent session linked to parent.
	 * Returns the new sub-session ID.
	 */
	async createSubSession(
		parentSessionId: string,
		purpose: string,
		agentId: string,
		model: string,
		project: string,
	): Promise<string> {
		if (!this.config.enabled) return "";

		const session = createSession({
			title: `Sub-agent: ${purpose}`,
			project,
			agent: agentId,
			model,
			parentSessionId,
		});

		return session.meta.id;
	}

	/**
	 * Bubble up sub-agent findings to parent memory.
	 *
	 * Loads the sub-agent session, extracts the last assistant message
	 * as a summary of findings, and appends it to the project memory
	 * so the parent (and future agents) can benefit from the discovery.
	 */
	async bubbleUpFindings(
		subSessionId: string,
		parentSessionId: string,
		project: string,
	): Promise<void> {
		if (!this.config.enabled || !subSessionId) return;

		try {
			const subSession = loadSession(subSessionId, project);
			const turns = subSession.turns;

			// Find the last assistant turn
			let lastAssistantContent = "";
			for (let i = turns.length - 1; i >= 0; i--) {
				if (turns[i].role === "assistant") {
					lastAssistantContent = turns[i].content;
					break;
				}
			}

			if (!lastAssistantContent) return;

			// Truncate to a reasonable summary length
			const maxLen = 500;
			const summary = lastAssistantContent.length > maxLen
				? lastAssistantContent.slice(0, maxLen) + "..."
				: lastAssistantContent;

			const entry = [
				`**Sub-agent finding** (session: ${subSessionId}, parent: ${parentSessionId})`,
				"",
				summary,
			].join("\n");

			appendMemory({ type: "project", path: project }, entry)
				.catch((e) => { log.debug("memory append failed", { error: String(e) }); });
		} catch {
			// Best-effort: don't break the agent if memory operations fail
		}
	}

	/**
	 * Get the session ID for this bridge instance.
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}
}
