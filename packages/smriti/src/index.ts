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
} from "./session-store.js";

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
} from "./cross-machine-sync.js";

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

// ─── Phase 1: Self-Evolution Engine ─────────────────────────────────────────

/** BOCPD-based behavioral crystallization that detects stable usage patterns. */
export { VasanaEngine } from "./vasana-engine.js";
export type { VasanaConfig, CrystallizationResult, PromotionResult, DeviationType } from "./vasana-engine.js";

/** Five-phase dream-cycle consolidation: score, replay, associate, recombine, compress. */
export { SvapnaConsolidation } from "./svapna-consolidation.js";
export type {
	SvapnaConfig,
	SvapnaResult,
	ScoredTurn,
	ReplayResult,
	CrossSessionAssociation,
	RecombineResult,
	CrystallizeResult,
	ProceduralizeResult,
	CompressResult,
} from "./svapna-consolidation.js";

/** Procedural memory engine that learns and recalls tool-call sequences from past sessions. */
export { VidhiEngine } from "./vidhi-engine.js";
export type { VidhiConfig, ExtractionResult } from "./vidhi-engine.js";

/** Periodic consolidation engine that generates monthly and yearly summary reports. */
export { PeriodicConsolidation } from "./periodic-consolidation.js";
export type {
	PeriodicConfig,
	ConsolidationStats,
	ConsolidationReport,
	ReportEntry,
} from "./periodic-consolidation.js";

/** Shared knowledge field with stigmergic traces for cross-agent collective memory. */
export { AkashaField } from "./akasha.js";
export type { StigmergicTrace, TraceType, AkashaConfig, AkashaEvent } from "./akasha.js";

/** Multi-scale temporal awareness from turns to years for time-contextualized retrieval. */
export { KalaChakra, TEMPORAL_SCALES } from "./kala-chakra.js";
export type {
	TemporalScale,
	KalaContext,
	TurnContext,
	SessionContext,
	DayContext,
	WeekContext,
	MonthContext,
	QuarterContext,
	YearContext,
	CurrentState,
	KalaChakraConfig,
} from "./kala-chakra.js";

/** Five mental fluctuation classifier (pramana, viparyaya, vikalpa, nidra, smriti). */
export { PanchaVritti, VRITTI_CONFIDENCE_WEIGHTS, VRITTI_TYPES } from "./pancha-vritti.js";
export type {
	VrittiType,
	VrittiClassification,
	VrittiConfig,
	VrittiStats,
	ClassificationContext,
	VrittiSerializedState,
} from "./pancha-vritti.js";

/** Daily diary writer that consolidates cross-project session summaries. */
export {
	consolidateDay,
	getDaysRoot,
	getDayFilePath,
	readDayFile,
	listDayFiles,
	searchDayFiles,
	isDayConsolidated,
	getUnconsolidatedDates,
} from "./day-consolidation.js";
export type { DayConsolidationResult } from "./day-consolidation.js";

/** Unified recall that searches all memory layers: FTS5, vector, memory scopes, and day files. */
export { recall } from "./unified-recall.js";
export type { RecallAnswer, RecallOptions as UnifiedRecallOptions } from "./unified-recall.js";

/** Extract typed event chains from session turns for pattern analysis. */
export {
	detectSessionType,
	extractEventChain,
	getExtractorStrategy,
} from "./event-extractor.js";
export type {
	SessionType,
	CoreSessionType,
	ExtendedSessionType,
	SessionEvent,
	EventChain,
} from "./event-extractor.js";

/** Real-time personal fact extractor that detects preferences, names, and context from user turns. */
export { FactExtractor, getFactExtractor } from "./fact-extractor.js";
export type { ExtractedFact, FactExtractorConfig } from "./fact-extractor.js";

/** Provider-agnostic memory bridge that injects context on session start. */
export { loadProviderContext } from "./provider-bridge.js";
export type { ProviderContext } from "./provider-bridge.js";

/** Vector-indexed consolidation summaries for semantic search across daily/monthly/yearly reports. */
export { indexConsolidationSummary, searchConsolidationSummaries, backfillConsolidationIndices, extractSummaryText } from "./consolidation-indexer.js";
export type { ConsolidationLevel, ConsolidationSummaryIndex } from "./consolidation-indexer.js";

/** Top-down temporal drill search: years to months to days for time-scoped retrieval. */
export { hierarchicalTemporalSearch } from "./hierarchical-temporal-search.js";
export type { TemporalSearchResult } from "./hierarchical-temporal-search.js";
