// @chitragupta/smriti — Memory & Sessions

/** SQLite database manager with schema initialization for agents, graphs, and vectors. */
export { DatabaseManager, initAllSchemas, initAgentSchema, initGraphSchema, initVectorsSchema } from "./db/index.js";
export type { DatabaseName } from "./db/index.js";

// Types
export type {
	SessionMeta,
	SessionTurn,
	SessionToolCall,
	Session,
	MemoryScope,
	MemoryResult,
	SessionOpts,
	AgentSummary,
	EmbeddingVector,
	GraphNode,
	GraphEdge,
	KnowledgeGraph,
	SessionTreeNode,
	SessionTree,
	StreamType,
	StreamConfig,
	StreamSignals,
	CompactionResult,
	SessionDelta,
	RecallOptions,
	RecallResult,
	// Phase 1: Self-Evolution types
	PramanaType,
	VivekaType,
	Vasana,
	SamskaraRecord,
	Vidhi,
	VidhiStep,
	VidhiParam,
	ConsolidationLogEntry,
	HandoverDelta,
} from "./types.js";

/** Parse session markdown files into structured SessionMeta + turns. */
export { parseSessionMarkdown } from "./markdown-parser.js";
/** Serialize sessions and turns back to markdown format. */
export { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";

/** CRUD operations for session lifecycle — create, save, load, list, delete, and migrate. */
export {
	createSession,
	saveSession,
	loadSession,
	listSessions,
	listSessionsByIds,
	listSessionsByDate,
	listSessionsByDateRange,
	listSessionDates,
	listSessionProjects,
	deleteSession,
	addTurn,
	migrateExistingSessions,
	listTurnsWithTimestamps,
	findSessionByMetadata,
	updateSessionMeta,
	getMaxTurnNumber,
	getTurnsSince,
	getSessionsModifiedSince,
} from "./session-store.js";
export {
	recordObservationBatch,
	upsertDetectedPattern,
	queryDetectedPatterns,
	recordMarkovTransition,
	predictNextStates,
	recordHealOutcome,
	upsertPreference,
} from "./session-db-c8.js";
export type {
	ObservationEvent,
	ObservationBatchResult,
	DetectedPatternInput,
	DetectedPatternRow,
	PatternQueryOptions,
	PredictNextOptions,
	NextStatePrediction,
	HealOutcome,
	HealReportInput,
} from "./session-db-c8.js";

/** Key-value memory store for scoped persistent memory (project, global, user). */
export {
	getMemory,
	updateMemory,
	appendMemory,
	deleteMemory,
	listMemoryScopes,
} from "./memory-store.js";

/** FTS5-backed full-text search across sessions and memory scopes. */
export { searchSessions, searchMemory } from "./search.js";

/** Knowledge graph engine with entity extraction, PageRank scoring, and community detection. */
export { GraphRAGEngine, migrateGraphJson } from "./graphrag.js";
export type { GraphRAGConfig } from "./graphrag.js";

/** Import/export sessions as JSON or markdown for portability. */
export {
	exportSessionToJson,
	exportSessionToMarkdown,
	importSessionFromJson,
	detectExportFormat,
} from "./session-export.js";
export type { ExportedSession, ExportedMessage, ExportedToolCall } from "./session-export.js";

/** Cross-machine snapshot sync for day files and memory across devices. */
export {
	createCrossMachineSnapshot,
	writeCrossMachineSnapshot,
	readCrossMachineSnapshot,
	importCrossMachineSnapshot,
	getCrossMachineSyncStatus,
} from "./cross-machine-sync.js";
export type {
	CrossMachineFileKind,
	CrossMachineImportStrategy,
	CrossMachineSnapshotFile,
	CrossMachineSnapshot,
	CrossMachineSnapshotOptions,
	CrossMachineImportOptions,
	CrossMachineSyncTotals,
	CrossMachineImportResult,
	CrossMachineSyncStatus,
	SnapshotSession,
} from "./cross-machine-sync.js";

/** Encrypted cross-machine sync envelopes for passphrase-protected snapshot transport. */
export {
	writeEncryptedCrossMachineSnapshot,
	readEncryptedCrossMachineSnapshot,
	importEncryptedCrossMachineSnapshot,
} from "./cross-machine-sync-encrypted.js";
export type {
	CrossMachineSnapshotEncryptionOptions,
	CrossMachineEncryptedSnapshotEnvelope,
} from "./cross-machine-sync-encrypted.js";

/** Branch sessions into tree structures for parallel conversation exploration. */
export { branchSession, getSessionTree } from "./branch.js";

/** Four-stream memory architecture (episodic, semantic, procedural, working) with token budgets. */
export {
	StreamManager,
	STREAM_CONFIGS,
	STREAM_ORDER,
	PRESERVATION_RATIOS,
	estimateTokens,
} from "./streams.js";

/** Sinkhorn-Knopp algorithm for doubly-stochastic token budget allocation. */
export {
	sinkhornKnopp,
	buildAffinityMatrix,
	computeTokenBudgets,
	allocateBudgets,
} from "./sinkhorn-knopp.js";

/** Embedding service with local fallback for vector similarity search. */
export { EmbeddingService, fallbackEmbedding } from "./embedding-service.js";

// Recall scoring configuration
export { configureRecallScoring } from "./recall-scoring.js";

// Compactor signals configuration
export { configureCompactorSignals } from "./compactor-signals.js";

/** Vector-indexed recall engine for semantic search across all sessions and streams. */
export { RecallEngine, migrateEmbeddingsJson, vectorToBlob, blobToVector, _resetRecallDbInit } from "./recall.js";

/** Engine-owned remote semantic mirror for curated consolidation artifacts. */
export { inspectRemoteSemanticSync, syncRemoteSemanticMirror } from "./remote-semantic-sync.js";
export type {
	RemoteSemanticMirrorConfig,
	RemoteSemanticSyncIssue,
	RemoteSemanticSyncStatus,
	RemoteSemanticSyncResult,
} from "./remote-semantic-sync.js";

/** Engine-owned PAKT compression policy with pakt-core default and stdio fallback. */
export {
	_setCompressionRuntimeForTests,
	_setSummaryPackerForTests,
	autoProcessTextThroughPolicy,
	compressTextThroughPolicy,
	getCompressionPolicyStatus,
	packCuratedSummaryText,
	packLiveContextText,
} from "./pakt-compression.js";
export type {
	CompressionPolicyStatus,
	CompressionRuntime,
	CompressionRuntimeName,
	CompressionRuntimeStatus,
	PackedLiveContextResult,
	PackedSummaryResult,
	SummaryPacker,
} from "./pakt-compression.js";

/** Canonical bounded-research experiment ledger for overnight/workflow loops. */
export {
	upsertResearchExperiment,
	listResearchExperiments,
} from "./research-experiments.js";
export type {
	ResearchExperimentRecordInput,
	StoredResearchExperiment,
	ListResearchExperimentsOptions,
} from "./research-experiments.js";

/** Session compactor that prunes low-signal turns using stream-weighted scoring. */
export { SessionCompactor } from "./compactor.js";

/** Nesterov-accelerated Sinkhorn in log-domain for fast token budget convergence. */
export {
	sinkhornAccelerated,
	computeTokenBudgetsMHC,
	logsumexp,
} from "./sinkhorn-accelerated.js";
export type { SinkhornAcceleratedOpts, SessionChunk } from "./sinkhorn-accelerated.js";

/** Classify turn content into the four memory streams (episodic, semantic, procedural, working). */
export {
	extractSignals,
	classifyContent,
	extractSignalsFromTurns,
} from "./stream-extractor.js";

/** Hybrid search with RRF fusion across BM25, vector, GraphRAG, and Pramana signals. */
export { HybridSearchEngine, HybridWeightLearner, shouldRetrieve, PRAMANA_RELIABILITY } from "./hybrid-search.js";
export type { HybridSearchResult, HybridSearchConfig, HybridSignal, HybridWeightLearnerState } from "./hybrid-search.js";

/** Thompson Sampling scorer with MMR reranking for adaptive GraphRAG retrieval. */
export { AdaptiveScorer, mmrRerank } from "./graphrag-adaptive-scoring.js";
export type { ScoredCandidate, AdaptiveScorerState } from "./graphrag-adaptive-scoring.js";

/** Topic-biased personalized PageRank with incremental updates for knowledge graphs. */
export {
	computePersonalizedPageRank,
	IncrementalPageRank,
} from "./graphrag-pagerank-personalized.js";
export type { PersonalizedPageRankOpts } from "./graphrag-pagerank-personalized.js";

/** Leiden community detection for identifying topic clusters in knowledge graphs. */
export { leiden, annotateCommunities, communitySummary, filterByCommunity, findBridgeNodes } from "./graphrag-leiden.js";
export type { LeidenConfig, LeidenResult, Community } from "./graphrag-leiden.js";

/** Snapshot-based checkpoint manager for session state persistence and recovery. */
export { CheckpointManager } from "./checkpoint.js";
export type { CheckpointConfig, Checkpoint, CheckpointData } from "./checkpoint.js";

/** Rule-based named entity recognizer for extracting people, projects, tools, and dates. */
export { NERExtractor } from "./ner-extractor.js";
export type { EntityType, ExtractedEntity, NERConfig } from "./ner-extractor.js";

/** Bi-temporal edge engine tracking both valid-time and transaction-time for graph edges. */
export {
	createEdge,
	supersedEdge,
	expireEdge,
	queryEdgesAtTime,
	getEdgeHistory,
	temporalDecay,
	compactEdges,
} from "./bitemporal.js";

/** Pattern-based memory consolidation that detects recurring rules across sessions. */
export { ConsolidationEngine } from "./consolidation.js";
export type {
	KnowledgeRule,
	RuleCategory,
	DetectedPattern,
	ConsolidationResult,
	ConsolidationConfig,
} from "./consolidation.js";

/** Multi-round retrieval with heuristic query decomposition and result fusion. */
export { AnveshanaEngine } from "./multi-round-retrieval.js";
export type {
	SubQuery,
	RoundResult,
	MultiRoundResult,
	MultiRoundConfig,
} from "./multi-round-retrieval.js";

/** Explicit memory store with categorical indexing and BM25 recall. */
export { SmaranStore } from "./smaran.js";
export type { SmaranEntry, SmaranCategory, SmaranConfig } from "./smaran.js";

/** Detect remember/forget/recall intents in user text for implicit memory operations. */
export { detectMemoryIntent, detectCategory } from "./memory-nlu.js";
export type { MemoryIntent } from "./memory-nlu.js";

/** Load and merge identity files (SOUL.md, IDENTITY.md, personality.md, USER.md). */
export { IdentityContext } from "./identity-context.js";
export type { IdentityConfig, IdentityFileType } from "./identity-context.js";

export * from "./index-evolution.js";
