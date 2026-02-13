// @chitragupta/smriti — Memory & Sessions

// Database layer (SQLite)
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

// Markdown parser / writer
export { parseSessionMarkdown } from "./markdown-parser.js";
export { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";

// Session store
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

// Memory store
export {
	getMemory,
	updateMemory,
	appendMemory,
	deleteMemory,
	listMemoryScopes,
} from "./memory-store.js";

// Search
export { searchSessions, searchMemory } from "./search.js";

// GraphRAG engine
export { GraphRAGEngine, migrateGraphJson } from "./graphrag.js";
export type { GraphRAGConfig } from "./graphrag.js";

// Session export/import
export {
	exportSessionToJson,
	exportSessionToMarkdown,
	importSessionFromJson,
	detectExportFormat,
} from "./session-export.js";
export type { ExportedSession, ExportedMessage, ExportedToolCall } from "./session-export.js";

// Branching
export { branchSession, getSessionTree } from "./branch.js";

// Streams (Smriti v2)
export {
	StreamManager,
	STREAM_CONFIGS,
	STREAM_ORDER,
	PRESERVATION_RATIOS,
	estimateTokens,
} from "./streams.js";

// Sinkhorn-Knopp (doubly stochastic mixing matrix)
export {
	sinkhornKnopp,
	buildAffinityMatrix,
	computeTokenBudgets,
	allocateBudgets,
} from "./sinkhorn-knopp.js";

// Embedding service
export { EmbeddingService, fallbackEmbedding } from "./embedding-service.js";

// Recall scoring configuration
export { configureRecallScoring } from "./recall-scoring.js";

// Compactor signals configuration
export { configureCompactorSignals } from "./compactor-signals.js";

// Recall engine (vector search across all sessions & streams)
export { RecallEngine, migrateEmbeddingsJson, vectorToBlob, blobToVector, _resetRecallDbInit } from "./recall.js";

// Session compaction
export { SessionCompactor } from "./compactor.js";

// Accelerated Sinkhorn-Knopp (Nesterov momentum + log-domain)
export {
	sinkhornAccelerated,
	computeTokenBudgetsMHC,
	logsumexp,
} from "./sinkhorn-accelerated.js";
export type { SinkhornAcceleratedOpts, SessionChunk } from "./sinkhorn-accelerated.js";

// Stream Extractor (4-stream signal classification)
export {
	extractSignals,
	classifyContent,
	extractSignalsFromTurns,
} from "./stream-extractor.js";

// Hybrid Search — Samshodhana (RRF fusion: BM25 + Vector + GraphRAG + Pramana)
export { HybridSearchEngine, HybridWeightLearner, shouldRetrieve, PRAMANA_RELIABILITY } from "./hybrid-search.js";
export type { HybridSearchResult, HybridSearchConfig, HybridSignal, HybridWeightLearnerState } from "./hybrid-search.js";

// Adaptive GraphRAG scoring (Thompson Sampling + MMR)
export { AdaptiveScorer, mmrRerank } from "./graphrag-adaptive-scoring.js";
export type { ScoredCandidate, AdaptiveScorerState } from "./graphrag-adaptive-scoring.js";

// Personalized PageRank (topic-biased + incremental)
export {
	computePersonalizedPageRank,
	IncrementalPageRank,
} from "./graphrag-pagerank-personalized.js";
export type { PersonalizedPageRankOpts } from "./graphrag-pagerank-personalized.js";

// Checkpoint Manager (Sthiti)
export { CheckpointManager } from "./checkpoint.js";
export type { CheckpointConfig, Checkpoint, CheckpointData } from "./checkpoint.js";

// Named Entity Recognition (Naama)
export { NERExtractor } from "./ner-extractor.js";
export type { EntityType, ExtractedEntity, NERConfig } from "./ner-extractor.js";

// Bi-Temporal Edge Engine (Dvikala)
export {
	createEdge,
	supersedEdge,
	expireEdge,
	queryEdgesAtTime,
	getEdgeHistory,
	temporalDecay,
	compactEdges,
} from "./bitemporal.js";

// Memory Consolidation (Samskaara)
export { ConsolidationEngine } from "./consolidation.js";
export type {
	KnowledgeRule,
	RuleCategory,
	DetectedPattern,
	ConsolidationResult,
	ConsolidationConfig,
} from "./consolidation.js";

// Multi-Round Retrieval — Anveshana (heuristic query decomposition + fusion)
export { AnveshanaEngine } from "./multi-round-retrieval.js";
export type {
	SubQuery,
	RoundResult,
	MultiRoundResult,
	MultiRoundConfig,
} from "./multi-round-retrieval.js";

// Smaran — Explicit Memory Store (structured, categorical, BM25 recall)
export { SmaranStore } from "./smaran.js";
export type { SmaranEntry, SmaranCategory, SmaranConfig } from "./smaran.js";

// Memory NLU — detect "remember"/"forget"/"recall" commands in user text
export { detectMemoryIntent, detectCategory } from "./memory-nlu.js";
export type { MemoryIntent } from "./memory-nlu.js";

// Identity Context — load SOUL.md, IDENTITY.md, personality.md, USER.md
export { IdentityContext } from "./identity-context.js";
export type { IdentityConfig, IdentityFileType } from "./identity-context.js";

// ─── Phase 1: Self-Evolution Engine ─────────────────────────────────────────

// Vasana Engine (BOCPD behavioral crystallization)
export { VasanaEngine } from "./vasana-engine.js";
export type { VasanaConfig, CrystallizationResult, PromotionResult } from "./vasana-engine.js";

// Svapna Consolidation (5-phase dream cycle)
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

// Vidhi Engine (procedural memory — learned tool sequences)
export { VidhiEngine } from "./vidhi-engine.js";
export type { VidhiConfig, ExtractionResult } from "./vidhi-engine.js";

// Periodic Consolidation (monthly/yearly reports)
export { PeriodicConsolidation } from "./periodic-consolidation.js";
export type {
	PeriodicConfig,
	ConsolidationStats,
	ConsolidationReport,
	ReportEntry,
} from "./periodic-consolidation.js";

// Akasha — Shared Knowledge Field (stigmergic traces)
export { AkashaField } from "./akasha.js";
export type { StigmergicTrace, TraceType, AkashaConfig } from "./akasha.js";

// Kala Chakra — Multi-Scale Temporal Awareness (काल चक्र)
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

// Pancha Vritti -- Five Fluctuations of Mind (Yoga Sutras 1.5-11)
export { PanchaVritti, VRITTI_CONFIDENCE_WEIGHTS, VRITTI_TYPES } from "./pancha-vritti.js";
export type {
	VrittiType,
	VrittiClassification,
	VrittiConfig,
	VrittiStats,
	ClassificationContext,
	VrittiSerializedState,
} from "./pancha-vritti.js";

// Day Consolidation — Diary Writer (daily cross-project summaries)
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

// Unified Recall Engine — searches ALL layers (FTS5, memory, day files)
export { recall } from "./unified-recall.js";
export type { RecallAnswer, RecallOptions as UnifiedRecallOptions } from "./unified-recall.js";

// Event Chain Extractor (session turns → typed event chains)
export {
	detectSessionType,
	extractEventChain,
} from "./event-extractor.js";
export type {
	SessionType,
	SessionEvent,
	EventChain,
} from "./event-extractor.js";

// Fact Extractor (real-time personal fact detection from user turns)
export { FactExtractor, getFactExtractor } from "./fact-extractor.js";
export type { ExtractedFact, FactExtractorConfig } from "./fact-extractor.js";

// Provider Bridge (memory injection on session start — provider-agnostic)
export { loadProviderContext } from "./provider-bridge.js";
export type { ProviderContext } from "./provider-bridge.js";

// Consolidation Indexer (vector-indexed daily/monthly/yearly summaries)
export { indexConsolidationSummary, searchConsolidationSummaries, backfillConsolidationIndices, extractSummaryText } from "./consolidation-indexer.js";
export type { ConsolidationLevel, ConsolidationSummaryIndex } from "./consolidation-indexer.js";

// Hierarchical Temporal Search (top-down drill: years → months → days)
export { hierarchicalTemporalSearch } from "./hierarchical-temporal-search.js";
export type { TemporalSearchResult } from "./hierarchical-temporal-search.js";
