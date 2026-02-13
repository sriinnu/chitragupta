/**
 * @chitragupta/smriti — Memory & Sessions types.
 *
 * All types for session management, memory scoping, GraphRAG knowledge graphs,
 * and vector search.
 */

// ─── Session Types ──────────────────────────────────────────────────────────

/** Metadata for a session, stored in YAML frontmatter. Does not include turn content. */
export interface SessionMeta {
	id: string;
	title: string;
	created: string; // ISO date
	updated: string;
	agent: string;
	model: string;
	/** Provider that created this session (e.g. claude-code, codex, vaayu). */
	provider?: string;
	project: string;
	parent: string | null; // For branching
	branch: string | null;
	tags: string[];
	totalCost: number;
	totalTokens: number;
	/** Arbitrary metadata from external systems (e.g. Vaayu session fields). */
	metadata?: Record<string, unknown>;
}

/** A single conversation turn (user prompt or assistant response) within a session. */
export interface SessionTurn {
	turnNumber: number;
	role: "user" | "assistant";
	agent?: string;
	model?: string;
	content: string;
	/** Full content parts (text, tool_call, tool_result, thinking, image).
	 * When present, used for faithful replay instead of the text-only `content` field. */
	contentParts?: Array<Record<string, unknown>>;
	toolCalls?: SessionToolCall[];
}

/** A tool call executed during an assistant turn, with input and result. */
export interface SessionToolCall {
	name: string;
	input: string;
	result: string;
	isError?: boolean;
}

/** A complete session with metadata and an ordered list of conversation turns. */
export interface Session {
	meta: SessionMeta;
	turns: SessionTurn[];
}

// ─── Memory Types ───────────────────────────────────────────────────────────

/** A discriminated union identifying the scope of a memory file. */
export type MemoryScope =
	| { type: "global" }
	| { type: "project"; path: string }
	| { type: "agent"; agentId: string }
	| { type: "session"; sessionId: string };

/** A search result from querying memory files, with scope and relevance score. */
export interface MemoryResult {
	scope: MemoryScope;
	content: string;
	relevance?: number; // 0-1 for vector search results
}

// ─── Session Options ────────────────────────────────────────────────────────

/** Options for creating a new session. Only `project` is required. */
export interface SessionOpts {
	title?: string;
	project: string;
	agent?: string;
	model?: string;
	/** Provider that created this session (e.g. claude-code, codex, vaayu). */
	provider?: string;
	branch?: string;
	parentSessionId?: string;
	tags?: string[];
	/** Arbitrary metadata from external systems (e.g. Vaayu session fields). */
	metadata?: Record<string, unknown>;
}

export interface AgentSummary {
	agentId: string;
	sessionCount: number;
	lastActive: string;
	totalCost: number;
}

// ─── GraphRAG Types ─────────────────────────────────────────────────────────

export interface EmbeddingVector {
	id: string;
	vector: number[];
	text: string;
	metadata: Record<string, unknown>;
}

/** A node in the knowledge graph (session, memory, concept, file, or decision). */
export interface GraphNode {
	id: string;
	type: "session" | "memory" | "concept" | "file" | "decision";
	label: string;
	content: string;
	embedding?: number[];
	metadata: Record<string, unknown>;
}

/**
 * A weighted, directional edge between two nodes in the knowledge graph.
 *
 * Bi-temporal: every edge carries TWO time axes —
 *   - Valid time (validFrom / validUntil): when the relationship is true in the real world.
 *   - Record time (recordedAt / supersededAt): when the edge was recorded / superseded in the graph.
 *
 * This separation allows time-travel queries, corrections without data loss,
 * and a complete audit trail.
 */
export interface GraphEdge {
	source: string;
	target: string;
	relationship: string;
	weight: number;
	/** When this relationship became true in the real world (valid time). ISO 8601 date. Set by createEdge(). */
	validFrom?: string;
	/** When this relationship stops being true. Undefined = still valid. ISO 8601 date. */
	validUntil?: string;
	/** When this edge was recorded in the graph (transaction/record time). ISO 8601 date. Set by createEdge(). */
	recordedAt?: string;
	/** When this record was superseded by a newer version. Undefined = current version. ISO 8601 date. */
	supersededAt?: string;
}

/** A knowledge graph consisting of nodes and directed edges. */
export interface KnowledgeGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

// ─── Session Tree (Branching) ───────────────────────────────────────────────

/** A node in the session branching tree. */
export interface SessionTreeNode {
	session: SessionMeta;
	children: SessionTreeNode[];
}

/** A tree of sessions showing parent-child branching relationships. */
export interface SessionTree {
	root: SessionTreeNode;
}

// ─── Stream Types (Smriti v2) ──────────────────────────────────────────────

/**
 * The 4 memory streams: identity (WHO), projects (WHAT), tasks (TODO), flow (HOW).
 */
export type StreamType = "identity" | "projects" | "tasks" | "flow";

/**
 * Configuration for a single memory stream, including its preservation ratio.
 * Preservation ratio determines how much of the stream survives compaction:
 *   - 0.95 = near-immutable (identity)
 *   - 0.80 = stable (projects)
 *   - 0.70 = moderate churn (tasks)
 *   - 0.30 = ephemeral (flow)
 */
export interface StreamConfig {
	type: StreamType;
	/** Filename relative to streams dir (e.g. "identity.md" or "flow/{device}.md") */
	filename: string;
	/** Preservation ratio 0-1. Higher = more persistent. */
	preservation: number;
	/** Human-readable description of this stream's purpose. */
	description: string;
}

/**
 * Signal counts extracted from a session, used to build the affinity matrix
 * for Sinkhorn-Knopp compaction.
 */
export interface StreamSignals {
	/** Preferences, corrections, personal facts. */
	identity: string[];
	/** Decisions, stack changes, architecture notes. */
	projects: string[];
	/** New TODOs, completions, blockers. */
	tasks: string[];
	/** Topic, mood, open questions, ephemeral context. */
	flow: string[];
}

/**
 * Result of compacting a session into the 4 memory streams.
 */
export interface CompactionResult {
	/** The session ID that was compacted. */
	sessionId: string;
	/** ISO timestamp of compaction. */
	timestamp: string;
	/** The mixing matrix (doubly stochastic) produced by Sinkhorn-Knopp. */
	mixingMatrix: number[][];
	/** Token budgets allocated to each stream [identity, projects, tasks, flow]. */
	tokenBudgets: number[];
	/** Number of signals extracted per stream. */
	signalCounts: { identity: number; projects: number; tasks: number; flow: number };
	/** The compressed session delta that was written. */
	delta: SessionDelta;
	/** Whether Sinkhorn-Knopp converged. */
	converged: boolean;
}

/**
 * A compressed session delta — NOT the full transcript, just key points,
 * decisions, artifacts, and tags. This is what gets stored as the session
 * summary after compaction.
 */
export interface SessionDelta {
	sessionId: string;
	title: string;
	timestamp: string;
	/** Key points / decisions from the session. */
	keyPoints: string[];
	/** Decisions made during the session. */
	decisions: string[];
	/** Artifacts produced (files, configs, etc.). */
	artifacts: string[];
	/** Tags for categorization. */
	tags: string[];
	/** Open threads / unresolved questions. */
	openThreads: string[];
	/** Token count of the original session. */
	originalTokens: number;
	/** Token count of this delta. */
	deltaTokens: number;
}

// ─── Phase 1: Self-Evolution Types ─────────────────────────────────────────

/** Pramana — epistemological source type for knowledge edges. */
export type PramanaType =
	| "pratyaksha"   // Direct perception
	| "anumana"      // Inference
	| "shabda"       // Testimony/documentation
	| "upamana"      // Analogy
	| "arthapatti"   // Postulation
	| "anupalabdhi"; // Non-apprehension

/** Viveka — grounding classification for knowledge. */
export type VivekaType = "grounded" | "inferred" | "uncertain";

/**
 * Vasana — a crystallized behavioral tendency.
 *
 * Formed when samskaras (impressions) stabilize via BOCPD change-point
 * detection. Represents deep-seated patterns: preferences, habits,
 * expertise, or anti-patterns.
 */
export interface Vasana {
	/** FNV-1a hash of tendency name + project. */
	id: string;
	/** The tendency expressed as a slug: "prefer-functional-style", "test-before-commit". */
	tendency: string;
	/** Human-readable description. */
	description: string;
	/** Behavioral strength [0, 1] — grows with reinforcement, decays with disuse. */
	strength: number;
	/** BOCPD stability score [0, 1] — how stable the underlying feature time series is. */
	stability: number;
	/** Constructive or destructive tendency. */
	valence: "positive" | "negative" | "neutral";
	/** IDs of samskaras that crystallized into this vasana. */
	sourceSamskaras: string[];
	/** How many times this vasana was reinforced. */
	reinforcementCount: number;
	/** Unix timestamp of last activation. */
	lastActivated: number;
	/** Holdout prediction accuracy [0, 1]. */
	predictiveAccuracy: number;
	/** Project path, or '__global__' for cross-project tendencies. */
	project: string;
	/** Unix timestamp. */
	createdAt: number;
	/** Unix timestamp. */
	updatedAt: number;
}

/**
 * Samskara — a behavioral impression detected from session data.
 *
 * Raw pattern observations that may crystallize into vasanas when stable.
 */
export interface SamskaraRecord {
	/** FNV-1a hash of pattern_type + pattern_content. */
	id: string;
	/** Source session. */
	sessionId: string;
	/** Kind of pattern detected. */
	patternType: "tool-sequence" | "preference" | "decision" | "correction" | "convention";
	/** The actual pattern content / description. */
	patternContent: string;
	/** Observation count across sessions. */
	observationCount: number;
	/** Confidence [0, 1]. */
	confidence: number;
	/** Epistemological source. */
	pramanaType?: PramanaType;
	/** Project scope (null = global). */
	project?: string;
	/** Unix timestamps. */
	createdAt: number;
	updatedAt: number;
}

/**
 * Vidhi — a procedural memory: a learned, parameterized tool sequence.
 *
 * Extracted from repeated successful tool patterns across sessions.
 * Executable via the Vayu DAG engine.
 */
export interface Vidhi {
	/** FNV-1a hash of name + project. */
	id: string;
	/** Project scope. */
	project: string;
	/** Procedure name slug: "add-api-endpoint", "run-test-suite". */
	name: string;
	/** Session IDs from which this procedure was learned. */
	learnedFrom: string[];
	/** Confidence in this procedure [0, 1]. */
	confidence: number;
	/** Ordered steps of the procedure. */
	steps: VidhiStep[];
	/** NLU trigger phrases: "add endpoint", "new API", "create route". */
	triggers: string[];
	/** Thompson Sampling success rate. */
	successRate: number;
	/** Total successful executions. */
	successCount: number;
	/** Total failed executions. */
	failureCount: number;
	/** Extracted parameter schema. */
	parameterSchema: Record<string, VidhiParam>;
	/** Unix timestamps. */
	createdAt: number;
	updatedAt: number;
}

/** A single step in a Vidhi procedure. */
export interface VidhiStep {
	/** Step index (0-based). */
	index: number;
	/** Tool name to invoke. */
	toolName: string;
	/** Argument template — may contain ${param} placeholders. */
	argTemplate: Record<string, unknown>;
	/** Human-readable description of what this step does. */
	description: string;
	/** Whether failure of this step aborts the procedure. */
	critical: boolean;
	/** Expected output pattern (regex) for success detection. */
	successPattern?: string;
}

/** A parameter definition for a Vidhi procedure. */
export interface VidhiParam {
	/** Parameter name. */
	name: string;
	/** JSON Schema type. */
	type: "string" | "number" | "boolean" | "object" | "array";
	/** Human-readable description. */
	description: string;
	/** Whether the parameter is required. */
	required: boolean;
	/** Default value if not provided. */
	defaultValue?: unknown;
	/** Example values seen in source sessions. */
	examples?: unknown[];
}

/** Entry in the consolidation audit log. */
export interface ConsolidationLogEntry {
	id?: number;
	project: string;
	cycleType: "svapna" | "monthly" | "yearly";
	cycleId: string;
	phase?: string;
	phaseDurationMs?: number;
	vasanasCreated: number;
	vidhisCreated: number;
	samskarasProcessed: number;
	sessionsProcessed: number;
	status: "running" | "success" | "failed" | "partial";
	errorMessage?: string;
	createdAt: number;
}

/**
 * Options for the RecallEngine.recall() method.
 */
export interface RecallOptions {
	/** Maximum number of results to return. Default: 10. */
	topK?: number;
	/** Minimum cosine similarity threshold. Default: 0.3. */
	threshold?: number;
	/** Filter results to a specific device (for flow stream). */
	deviceFilter?: string;
	/** Filter results to a date range [start, end] as ISO strings. */
	dateRange?: [string, string];
	/** Filter results by tags. */
	tagFilter?: string[];
}

/**
 * A single result from the RecallEngine.
 */
export interface RecallResult {
	/** The session or stream ID where this was found. */
	sessionId: string;
	/** Title of the source session or stream. */
	title: string;
	/** Relevance score 0-1 (cosine similarity). */
	relevance: number;
	/** Summary or snippet of the matched content. */
	summary: string;
	/** Whether this came from a session file or a memory stream. */
	source: "session" | "stream";
	/** The actual text that matched. */
	matchedContent: string;
}
