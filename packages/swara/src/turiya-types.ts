/**
 * Turiya Types — shared interfaces for the contextual bandit router.
 *
 * Separated from the main TuriyaRouter to keep each module under 450 LOC.
 * Contains all type definitions, configuration interfaces, and the
 * new v2 types for budget-aware routing, preference conditioning,
 * and cascade fallback.
 *
 * @module turiya-types
 */

// ─── Manas Feature Bridge ───────────────────────────────────────────────────

/**
 * Structural features from Manas (zero-cost NLU pre-processor).
 * When provided, Turiya skips redundant regex extraction and uses
 * these features to enrich its 7-dim context vector.
 */
export interface ManasFeatureBridge {
	hasCode: boolean;
	hasErrorStack: boolean;
	questionCount: number;
	imperative: boolean;
	multiStep: boolean;
	technical: boolean;
}

// ─── Core Types ─────────────────────────────────────────────────────────────

/** The 7-dimensional context vector that describes a request. */
export interface TuriyaContext {
	/** Task complexity [0, 1] — from token count, code presence, multi-step indicators. */
	complexity: number;
	/** Response urgency [0, 1] — from time constraints, error context. */
	urgency: number;
	/** Creative freedom needed [0, 1] — from brainstorming, open-ended questions. */
	creativity: number;
	/** Accuracy requirement [0, 1] — from math, code review, factual queries. */
	precision: number;
	/** Code-to-prose ratio [0, 1] — from code blocks, file references. */
	codeRatio: number;
	/** How deep in conversation [0, 1] — normalized turn count. */
	conversationDepth: number;
	/** How much context needed [0, 1] — from retrieval count, memory hits. */
	memoryLoad: number;
}

/** Routing tiers from cheapest to most powerful. */
export type TuriyaTier = "no-llm" | "haiku" | "sonnet" | "opus";

/** All tiers, ordered cheapest to most powerful. */
export const ALL_TIERS: TuriyaTier[] = ["no-llm", "haiku", "sonnet", "opus"];

/** Default cost per request by tier (USD estimate). */
export const DEFAULT_TIER_COSTS: Record<TuriyaTier, number> = {
	"no-llm": 0,
	"haiku": 0.0003,
	"sonnet": 0.003,
	"opus": 0.015,
};

/**
 * Feature dimension: 7 context dims + 1 bias = 8.
 * The bias term allows the linear model to learn an intercept.
 */
export const D = 8;

/** The decision produced by the Turiya router. */
export interface TuriyaDecision {
	/** The selected routing tier. */
	tier: TuriyaTier;
	/** Confidence in this decision [0, 1]. */
	confidence: number;
	/** Estimated cost for this request (USD). */
	costEstimate: number;
	/** The context vector that drove the decision. */
	context: TuriyaContext;
	/** Human-readable rationale. */
	rationale: string;
	/** Internal: which arm was selected (index). */
	armIndex: number;
}

/** Per-tier statistics. */
export interface TuriyaTierStats {
	/** Tier name. */
	tier: TuriyaTier;
	/** Number of requests routed to this tier. */
	calls: number;
	/** Total estimated cost for this tier. */
	totalCost: number;
	/** Average reward observed. */
	averageReward: number;
	/** Thompson alpha posterior. */
	alpha: number;
	/** Thompson beta posterior. */
	beta: number;
}

/** Aggregate routing statistics. */
export interface TuriyaStats {
	/** Total requests routed. */
	totalRequests: number;
	/** Per-tier breakdowns. */
	tiers: TuriyaTierStats[];
	/** Total actual cost. */
	totalCost: number;
	/** Cost if everything had been routed to opus. */
	opusBaselineCost: number;
	/** Savings vs always-opus baseline. */
	costSavings: number;
	/** Savings as percentage. */
	savingsPercent: number;
}

/** Serializable state for persistence. */
export interface TuriyaState {
	totalPlays: number;
	arms: Array<{
		tier: TuriyaTier;
		plays: number;
		totalReward: number;
		totalCost: number;
		alpha: number;
		beta: number;
		/** LinUCB A matrix (flattened, D x D). */
		linA: number[];
		/** LinUCB b vector (D elements). */
		linB: number[];
	}>;
	opusBaselineCost: number;
	linucbAlpha: number;
	/** Budget Lagrangian multiplier (PILOT paper). */
	budgetLambda?: number;
	/** History of preference settings. */
	preferenceHistory?: Array<{ costWeight: number; timestamp: number }>;
}

/** Configuration for TuriyaRouter. */
export interface TuriyaRouterConfig {
	/** LinUCB exploration parameter. Higher = more exploration. Default: 0.5. */
	linucbAlpha?: number;
	/** Estimated cost per request by tier (USD). Configurable. */
	tierCosts?: Partial<Record<TuriyaTier, number>>;
	/** Maximum conversation depth for normalization. Default: 50. */
	maxConversationDepth?: number;
	/** Maximum memory load for normalization. Default: 20. */
	maxMemoryHits?: number;
	/** Daily budget cap in USD. Default: Infinity (no cap). */
	dailyBudget?: number;
	/** Expected requests per day for budget pacing. Default: 100. */
	expectedDailyRequests?: number;
}

// ─── V2 Types (Budget, Preference, Cascade) ─────────────────────────────────

/**
 * User preference dial from LLM Bandit paper.
 * Controls cost vs quality trade-off in arm selection.
 */
export interface TuriyaPreference {
	/** 0 = don't care about cost (maximize quality), 1 = minimize cost. */
	costWeight: number;
}

/**
 * Result of cascade routing (Unified Routing+Cascading paper).
 * When initial tier's confidence is below threshold, escalate one tier up.
 */
export interface TuriyaCascadeResult {
	/** The final decision (possibly escalated). */
	final: TuriyaDecision;
	/** Whether the decision was escalated from the original tier. */
	escalated: boolean;
	/** The original tier before escalation (only set if escalated). */
	originalTier?: TuriyaTier;
}
