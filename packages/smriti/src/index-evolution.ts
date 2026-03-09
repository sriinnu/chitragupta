/** BOCPD-based behavioral crystallization that detects stable usage patterns. */
export { VasanaEngine } from "./vasana-engine.js";
export type { VasanaConfig, CrystallizationResult, PromotionResult, DeviationType } from "./vasana-engine.js";

/** Five-phase dream-cycle consolidation: score, replay, associate, recombine, compress. */
export { SwapnaConsolidation } from "./swapna-consolidation.js";
export type {
	SwapnaConfig,
	SwapnaResult,
	ScoredTurn,
	ReplayResult,
	CrossSessionAssociation,
	RecombineResult,
	CrystallizeResult,
	ProceduralizeResult,
	CompressResult,
} from "./swapna-consolidation.js";

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

/** Temporal trending engine — detects trends, regressions, and velocity across time. */
export { NatashaObserver } from "./natasha-observer.js";
export type { NatashaSummary } from "./natasha-observer.js";
export type {
	TrendWindow,
	TrendSignal,
	TrendDirection,
	RegressionAlert,
	RegressionSeverity,
	VelocityMetrics,
	NatashaConfig,
	NatashaDb,
} from "./natasha-types.js";
export { DEFAULT_NATASHA_CONFIG, TREND_WINDOWS } from "./natasha-types.js";

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
	readDayFileMetadata,
	listDayFiles,
	searchDayFiles,
	isDayConsolidated,
	getUnconsolidatedDates,
} from "./day-consolidation.js";
export type { DayConsolidationResult } from "./day-consolidation.js";

/** Provenance metadata embedded in derived consolidation artifacts. */
export {
	renderConsolidationMetadata,
	parseConsolidationMetadata,
	stripConsolidationMetadata,
	toSourceSessionReference,
} from "./consolidation-provenance.js";
export type {
	ConsolidationMetadata,
	DayConsolidationMetadata,
	PeriodicConsolidationMetadata,
	SourceSessionReference,
	ProjectSessionReference,
} from "./consolidation-provenance.js";

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
/** NER augmentation layer — detects people, projects, tech, metrics, dates in free text. */
export { extractNEREntities, jaccardNER } from "./fact-extractor-ner.js";
export type { NEREntity, NEREntityType } from "./fact-extractor-ner.js";
/** LLM fallback for low-confidence sentences — injectable provider interface. */
export { extractFactsWithFallback } from "./fact-extractor-llm.js";
export type { FactExtractorLLMProvider } from "./fact-extractor-llm.js";

/** Provider-agnostic memory bridge that injects context on session start. */
export { loadProviderContext } from "./provider-bridge.js";
export type { ProviderContext } from "./provider-bridge.js";

/** Vector-indexed consolidation summaries for semantic search across daily/monthly/yearly reports. */
export { indexConsolidationSummary, searchConsolidationSummaries, backfillConsolidationIndices, extractSummaryText } from "./consolidation-indexer.js";
export type { ConsolidationLevel, ConsolidationSummaryIndex } from "./consolidation-indexer.js";

/** Top-down temporal drill search: years to months to days for time-scoped retrieval. */
export { hierarchicalTemporalSearch } from "./hierarchical-temporal-search.js";
export type { TemporalSearchResult } from "./hierarchical-temporal-search.js";

/** Persistent critique memory for task evaluation findings with BM25 search and deduplication. */
export { CritiqueStore } from "./critique-store.js";
export type { CritiqueFinding, CritiqueStoreConfig, CritiqueStats, CritiqueSeverity } from "./critique-store.js";

/** Durable orchestration checkpoint/resume system with idempotency guarantees for multi-step jobs. */
export { OrchestratorCheckpoint } from "./orchestrator-checkpoint.js";
export type {
	StepStatus,
	StepCheckpoint,
	JobCheckpoint,
	OrchestratorCheckpointConfig,
	StepDefinition,
	JobListFilter,
} from "./orchestrator-checkpoint.js";

/** Durable episodic developer memory for error pattern recall and experience tagging. */
export { EpisodicMemoryStore } from "./episodic-store.js";
export type { Episode, EpisodeInput, EpisodicQuery } from "./episodic-types.js";

/** Predictive context pre-fetcher — anticipates memory needs before they're requested. */
export { TranscendenceEngine } from "./transcendence.js";
export type {
	ContextPrediction,
	CachedContext,
	PrefetchResult,
	CacheStats,
	TemporalPattern,
	CoOccurrence,
	TranscendenceConfig,
	TranscendenceDb,
	PredictionSource,
} from "./transcendence-types.js";
export { DEFAULT_TRANSCENDENCE_CONFIG } from "./transcendence-types.js";
