// @chitragupta/niyanta — Agent Orchestrator
export * from "./types.js";
export { Orchestrator, OrchestratorError } from "./orchestrator.js";
export { TaskRouter, jaccardSimilarity } from "./router.js";
export {
	roundRobinAssign,
	leastLoadedAssign,
	specializedAssign,
	hierarchicalDecompose,
	competitiveRace,
	swarmCoordinate,
	mergeSwarmResults,
} from "./strategies.js";
export type { SlotStats, SwarmContext } from "./strategies.js";
export { decompose, suggestPlan } from "./planner.js";
export {
	CODE_REVIEW_PLAN,
	TDD_PLAN,
	REFACTOR_PLAN,
	BUG_HUNT_PLAN,
	DOCUMENTATION_PLAN,
} from "./presets.js";
export { MetricsCollector } from "./metrics.js";

// Strategy bandit (UCB1 / Thompson / LinUCB)
export { StrategyBandit } from "./strategy-bandit.js";
export type {
	StrategyStats,
	BanditContext,
	BanditMode,
	StrategyBanditState,
} from "./strategy-bandit.js";

// Autonomous orchestrator (bandit-driven strategy selection + self-healing)
export { AutonomousOrchestrator } from "./orchestrator-autonomous.js";
export type {
	TaskPerformanceRecord,
	AutonomousOrchestratorConfig,
	StrategyBan,
} from "./orchestrator-autonomous.js";

// Orchestration Patterns (Vyuha)
export {
	singlePattern,
	independentPattern,
	centralizedPattern,
	decentralizedPattern,
	hybridPattern,
} from "./orchestration-patterns.js";
export type { PatternConfig, PatternResult } from "./orchestration-patterns.js";

// DAG Workflow Engine (Krama)
export { DAGEngine } from "./dag-workflow.js";
export type { DAGNode, DAGWorkflow, DAGExecutionResult } from "./dag-workflow.js";

// Evaluator (Pariksha)
export { AgentEvaluator } from "./evaluator.js";
export type { EvalCriterion, EvalResult, EvaluationReport, EvaluatorConfig } from "./evaluator.js";

// Kartavya (कर्तव्य — Auto-Execution Pipeline)
export { KartavyaEngine } from "./kartavya.js";
export type {
	Kartavya,
	KartavyaStatus,
	KartavyaTrigger,
	KartavyaAction,
	KartavyaActionType,
	KartavyaConfig,
	TriggerType,
	TriggerContext,
	NiyamaProposal,
	VasanaInput,
	DatabaseLike as KartavyaDatabaseLike,
} from "./kartavya.js";
