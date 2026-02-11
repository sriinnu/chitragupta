// @chitragupta/anina — Agent Runtime
export { Agent } from "./agent.js";
export { ToolExecutor } from "./tool-executor.js";
export { ContextManager, DEFAULT_COMPACTION_CONFIG } from "./context-manager.js";
export type { CompactionConfig, CompactionTier } from "./context-manager.js";
export { SteeringManager } from "./steering.js";
export { MemoryBridge } from "./memory-bridge.js";
export {
	MAX_SUB_AGENTS,
	MAX_AGENT_DEPTH,
	SYSTEM_MAX_AGENT_DEPTH,
	SYSTEM_MAX_SUB_AGENTS,
	DEFAULT_MAX_AGENT_DEPTH,
	DEFAULT_MAX_SUB_AGENTS,
} from "./types.js";
export type {
	AgentConfig,
	AgentEventType,
	AgentMessage,
	AgentState,
	AgentTree,
	AgentTreeNode,
	SpawnConfig,
	SubAgentResult,
	ToolContext,
	ToolHandler,
	ToolResult,
	// Phase 1: Nidra + Pratyabhijna types
	NidraState,
	SvapnaPhase,
	NidraConfig,
	NidraSnapshot,
	PratyabhijnaContext,
	PratyabhijnaConfig,
} from "./types.js";
export { DEFAULT_NIDRA_CONFIG, DEFAULT_PRATYABHIJNA_CONFIG } from "./types.js";

// Kaala Brahma — Agent Tree Lifecycle Manager
export { KaalaBrahma } from "./agent-kaala.js";
export type {
	AgentLifecycleStatus,
	AgentHeartbeat,
	KaalaConfig,
	KillResult,
	HealReport,
	AgentHealthSnapshot,
	TreeHealthReport,
	StatusChangeCallback,
} from "./agent-kaala.js";

// Ollama summarisation configuration
export { configureOllamaSummary } from "./context-compaction.js";
export type { OllamaSummaryConfig } from "./context-compaction.js";

// Information-theoretic context compaction
export {
	computeTfIdfScores,
	textRankMessages,
	minHashDedup,
	shannonSurprisal,
	CompactionMonitor,
	informationalCompact,
} from "./context-compaction-informational.js";
export type { CompactionThresholds } from "./context-compaction-informational.js";

// Agent autonomy — self-healing, self-aware agent wrapper
export { AutonomousAgent, classifyError } from "./agent-autonomy.js";
export type {
	AgentHealthReport,
	AutoHealConfig,
	AutonomyEventType,
	AutonomyEventListener,
} from "./agent-autonomy.js";

// Learning loop — tool usage tracking, Markov prediction, performance scoring
export { LearningLoop } from "./learning-loop.js";
export type {
	ToolUsageStats,
	ToolRecommendation,
	LearnedPatterns,
	LearningLoopState,
} from "./learning-loop.js";

// ─── Soul/Identity ──────────────────────────────────────────────────────────
export { SoulManager, ARCHETYPES } from "./agent-soul.js";
export type { AgentSoul, AgentArchetype } from "./agent-soul.js";

// ─── Reflector ──────────────────────────────────────────────────────────────
export { AgentReflector } from "./agent-reflector.js";
export type { ReflectionResult, PeerReview, ReflectorConfig } from "./agent-reflector.js";

// ─── Coding Agent (Kartru) ──────────────────────────────────────────────────
export { CodingAgent, CODE_TOOL_NAMES } from "./coding-agent.js";
export type { CodingAgentConfig, CodingResult, ProjectConventions } from "./coding-agent.js";

// ─── Coding Orchestrator (Sanyojaka) ────────────────────────────────────────
export { CodingOrchestrator } from "./coding-orchestrator.js";
export type {
	CodingOrchestratorConfig,
	OrchestratorResult,
	OrchestratorProgress,
	OrchestratorMode,
	TaskPlan,
	TaskStep,
	GitState,
	ReviewIssueCompact,
} from "./coding-orchestrator.js";

// ─── Review Agent (Parikshaka) ──────────────────────────────────────────────
export { ReviewAgent, REVIEW_TOOL_NAMES } from "./review-agent.js";
export type { ReviewAgentConfig, ReviewResult, ReviewIssue, ReviewFocus, ReviewSeverity } from "./review-agent.js";

// ─── Debug Agent (Anveshi) ──────────────────────────────────────────────────
export { DebugAgent, DEBUG_TOOL_NAMES } from "./debug-agent.js";
export type { DebugAgentConfig, DebugResult, BugReport } from "./debug-agent.js";

// ─── Research Agent (Shodhaka) ──────────────────────────────────────────────
export { ResearchAgent, RESEARCH_TOOL_NAMES } from "./research-agent.js";
export type { ResearchAgentConfig, ResearchQuery, ResearchResult } from "./research-agent.js";

// ─── Refactor Agent (Parikartru) ────────────────────────────────────────────
export { RefactorAgent, REFACTOR_TOOL_NAMES } from "./refactor-agent.js";
export type { RefactorAgentConfig, RefactorPlan, RefactorResult, RefactorType } from "./refactor-agent.js";

// ─── Docs Agent (Lekhaka) ──────────────────────────────────────────────────
export { DocsAgent, DOCS_TOOL_NAMES } from "./docs-agent.js";
export type { DocsAgentConfig, DocsResult, DocsTask } from "./docs-agent.js";

// ─── Chetana (Consciousness Layer) ──────────────────────────────────────────
export { ChetanaController } from "./chetana/index.js";
export { BhavaSystem } from "./chetana/index.js";
export { DhyanaSystem } from "./chetana/index.js";
export { AtmaDarshana } from "./chetana/index.js";
export { SankalpaSystem } from "./chetana/index.js";
export { Triguna } from "./chetana/index.js";
export { DEFAULT_CHETANA_CONFIG } from "./chetana/index.js";
export { DEFAULT_TRIGUNA_CONFIG } from "./chetana/index.js";
export type {
	AffectiveState,
	AttentionWeights,
	SelfModel,
	ToolMastery,
	Intention,
	IntentionPriority,
	IntentionStatus,
	ChetanaContext,
	CognitiveReport,
	ChetanaConfig,
	CognitivePriors,
	ChetanaState,
	GunaState,
	GunaSnapshot,
	GunaTrend,
	TrendDirection,
	GunaLabel,
	TrigunaConfig,
	TrigunaSerializedState,
} from "./chetana/index.js";

// ─── Safe Execution Utilities ────────────────────────────────────────────────
export { safeExecSync, validateCommand, parseCommand } from "./safe-exec.js";

// ─── Phase 1: Self-Evolution Engine ─────────────────────────────────────────

// Nidra Daemon (3-state sleep cycle manager)
export { NidraDaemon } from "./nidra-daemon.js";

// Pratyabhijna (self-recognition on session start)
export { Pratyabhijna } from "./pratyabhijna.js";

// Buddhi (बुद्धि — Intellect / Decision Framework)
export { Buddhi } from "./buddhi.js";
export type {
	NyayaReasoning,
	Decision,
	DecisionCategory,
	Alternative,
	DecisionOutcome,
	RecordDecisionParams,
	ListDecisionsOptions,
	DecisionPattern,
} from "./buddhi.js";

// ─── Manas (मनस् — Zero-Cost Input Pre-Processor) ──────────────────────────
export { Manas } from "./manas.js";
export type {
	ManasIntent,
	ManasRoute,
	ManasFeatures,
	ManasClassification,
} from "./manas.js";

// ─── Lokapala (लोकपाल — World Guardians) ────────────────────────────────────
export { LokapalaController } from "./lokapala/index.js";
export { Rakshaka } from "./lokapala/index.js";
export { Gati } from "./lokapala/index.js";
export { Satya } from "./lokapala/index.js";
export { DEFAULT_GUARDIAN_CONFIG, HARD_CEILINGS, FindingRing } from "./lokapala/index.js";
export type {
	Finding,
	FindingSeverity,
	GuardianConfig,
	GuardianDomain,
	GuardianStats,
	ScanContext,
	PerformanceMetrics,
	TurnObservation,
	LokapalaConfig,
} from "./lokapala/index.js";
