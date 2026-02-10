/**
 * Turiya — Meta-Observer & Contextual Model Router.
 *
 * In Vedic philosophy, Turiya (तुरीय) is the "fourth state" — pure
 * consciousness that witnesses waking, dreaming, and deep sleep. It is
 * the sakshi (witness) that observes without being observed.
 *
 * In Chitragupta, Turiya is the meta-observer that makes intelligent
 * model routing decisions based on a 7-dimensional context vector,
 * using LinUCB (contextual linear bandit) to learn optimal tier
 * assignment from experience.
 *
 * Architecture:
 *   Message → extractContext() → 7-dim TuriyaContext
 *       → LinUCB classify() → TuriyaTier + confidence
 *       → recordOutcome() → Thompson Sampling feedback
 *       → getStats() → cost savings report
 *
 * The 7 dimensions:
 *   1. complexity      — task difficulty [0, 1]
 *   2. urgency         — response urgency [0, 1]
 *   3. creativity      — creative freedom needed [0, 1]
 *   4. precision       — accuracy requirement [0, 1]
 *   5. codeRatio       — code-to-prose ratio [0, 1]
 *   6. conversationDepth — normalized turn count [0, 1]
 *   7. memoryLoad      — context/memory needed [0, 1]
 *
 * LinUCB math:
 *   For each arm a (tier), maintain A_a (d x d) and b_a (d x 1).
 *   theta_a = A_a^{-1} * b_a (learned weights)
 *   UCB(a, x) = theta_a^T * x + alpha * sqrt(x^T * A_a^{-1} * x)
 *   Select: argmax_a UCB(a, x)
 *   Update: A_a += x * x^T, b_a += reward * x
 *
 * Reference: Li et al. (2010), "A contextual-bandit approach to
 * personalized news article recommendation."
 */

import type { Context, Message, ToolDefinition } from "./types.js";
import { estimateTokens } from "./token-counter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

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
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** All tiers, ordered cheapest to most powerful. */
const ALL_TIERS: TuriyaTier[] = ["no-llm", "haiku", "sonnet", "opus"];

/** Default cost per request by tier (USD estimate). */
const DEFAULT_TIER_COSTS: Record<TuriyaTier, number> = {
	"no-llm": 0,
	"haiku": 0.0003,
	"sonnet": 0.003,
	"opus": 0.015,
};

/**
 * Feature dimension: 7 context dims + 1 bias = 8.
 * The bias term allows the linear model to learn an intercept.
 */
const D = 8;

// ─── Pattern Detection ──────────────────────────────────────────────────────

/** Patterns for urgency detection. */
const URGENCY_PATTERNS = /\b(urgent|asap|immediately|hurry|critical|emergency|error|bug|crash|broken|fix\s+now|prod\s+down|production\s+issue|p0|p1|blocker)\b/i;

/** Patterns for creativity detection. */
const CREATIVITY_PATTERNS = /\b(brainstorm|creative|imagine|what\s+if|explore|ideas?|suggest|novel|innovative|invent|dream\s+up|blue\s+sky|open.?ended|free.?form|experiment)\b/i;

/** Patterns for precision detection. */
const PRECISION_PATTERNS = /\b(exact|precise|accurate|correct|verify|validate|proof|prove|calculate|compute|math|equation|formula|benchmark|measure|audit|review|check|strict|rigorous)\b/i;

/** Code-related patterns (blocks, file refs, language keywords). */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const CODE_KEYWORD_PATTERN = /\b(function|class|import|export|const|let|var|async|await|interface|type|enum|struct|def|fn|impl|pub|mod|crate|package|module)\b/i;
const FILE_REF_PATTERN = /\b[\w\-]+\.(ts|js|py|rs|go|java|cpp|c|h|tsx|jsx|vue|svelte|rb|php|swift|kt|scala|zig|md|json|yaml|yml|toml|sql|sh|bash|zsh)\b/i;

/** Multi-step / complex task indicators. */
const MULTI_STEP_PATTERN = /\b(first\s.*then|step\s*[1-9]|multiple\s+files|refactor\s+.*across|and\s+then|after\s+that|finally|phase\s+[1-9]|stage\s+[1-9])\b/i;

/** Expert domain indicators. */
const EXPERT_PATTERN = /\b(distributed\s+system|consensus|fault.?toleran|zero.?knowledge|cryptograph|sharding|replication|linearizab|serializab|crdts?|raft|paxos|byzantine|merkle|b.?tree|skip\s+list|bloom\s+filter|lock.?free|wait.?free)\b/i;

/** Tool-only / no-LLM indicators. */
const TOOL_ONLY_PATTERN = /^(search|grep|find|ls|cat|read|list|show)\s+/i;
const SIMPLE_MATH_PATTERN = /^\s*\d+[\s\+\-\*\/\^\%\(\)\.]+\d+[\s\+\-\*\/\^\%\(\)\.0-9]*\s*[\?\=]?\s*$/;

// ─── LinUCB Math ────────────────────────────────────────────────────────────

/** Create identity matrix of size d, flattened row-major. */
function identityFlat(d: number): number[] {
	const m = new Array(d * d).fill(0);
	for (let i = 0; i < d; i++) m[i * d + i] = 1;
	return m;
}

/**
 * Cholesky decomposition solve: A * x = b, where A is d x d SPD.
 *
 * A = L * L^T, then forward-solve L * y = b, then back-solve L^T * x = y.
 * O(d^3) for decomposition, O(d^2) for solve. For d=8 this is ~500 ops.
 */
function choleskySolve(A: number[], b: number[], d: number): number[] {
	const L = new Array(d * d).fill(0);

	for (let i = 0; i < d; i++) {
		for (let j = 0; j <= i; j++) {
			let sum = 0;
			for (let k = 0; k < j; k++) {
				sum += L[i * d + k] * L[j * d + k];
			}
			if (i === j) {
				const diagVal = A[i * d + i] - sum;
				L[i * d + j] = Math.sqrt(Math.max(diagVal, 1e-10));
			} else {
				L[i * d + j] = (A[i * d + j] - sum) / L[j * d + j];
			}
		}
	}

	// Forward solve: L * y = b
	const y = new Array(d).fill(0);
	for (let i = 0; i < d; i++) {
		let sum = 0;
		for (let j = 0; j < i; j++) sum += L[i * d + j] * y[j];
		y[i] = (b[i] - sum) / L[i * d + i];
	}

	// Backward solve: L^T * x = y
	const x = new Array(d).fill(0);
	for (let i = d - 1; i >= 0; i--) {
		let sum = 0;
		for (let j = i + 1; j < d; j++) sum += L[j * d + i] * x[j];
		x[i] = (y[i] - sum) / L[i * d + i];
	}

	return x;
}

/**
 * Compute x^T * A^{-1} * x via Cholesky: solve A * z = x, then dot(x, z).
 * Avoids explicit inversion — more numerically stable.
 */
function quadFormInverse(A: number[], x: number[], d: number): number {
	const z = choleskySolve(A, x, d);
	let dot = 0;
	for (let i = 0; i < d; i++) dot += x[i] * z[i];
	return dot;
}

/** Rank-1 update: A += x * x^T (outer product, in-place on flattened matrix). */
function rankOneUpdate(A: number[], x: number[], d: number): void {
	for (let i = 0; i < d; i++) {
		for (let j = 0; j < d; j++) {
			A[i * d + j] += x[i] * x[j];
		}
	}
}

// ─── Beta Distribution Sampling (Thompson Sampling) ─────────────────────────

/** Sample Beta(alpha, beta) via Gamma ratio (Marsaglia & Tsang). */
function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	return (x + y === 0) ? 0.5 : x / (x + y);
}

function sampleGamma(shape: number): number {
	if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let z: number, v: number;
		do { z = boxMuller(); v = 1 + c * z; } while (v <= 0);
		v = v * v * v;
		const u = Math.random();
		if (u < 1 - 0.0331 * (z * z * z * z)) return d * v;
		if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
	}
}

function boxMuller(): number {
	return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// ─── Context Extraction ─────────────────────────────────────────────────────

/**
 * Extract the text content from the last user message.
 */
function extractLastUserText(messages: Message[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	if (!lastUser) return "";
	return lastUser.content
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join(" ");
}

/**
 * Count code blocks and compute code-to-total character ratio.
 */
function computeCodeRatio(text: string): number {
	const codeBlocks = text.match(CODE_BLOCK_PATTERN) ?? [];
	const codeChars = codeBlocks.reduce((sum, block) => sum + block.length, 0);
	const hasKeywords = CODE_KEYWORD_PATTERN.test(text);
	const hasFileRefs = FILE_REF_PATTERN.test(text);

	// Base ratio from code block content
	let ratio = text.length > 0 ? codeChars / text.length : 0;

	// Boost from keywords and file references
	if (hasKeywords) ratio = Math.min(1, ratio + 0.2);
	if (hasFileRefs) ratio = Math.min(1, ratio + 0.1);

	return clamp(ratio);
}

/**
 * Estimate complexity from text features.
 */
function estimateComplexity(text: string, tokenCount: number): number {
	let score = 0;

	// Token count contribution (longer = more complex)
	if (tokenCount > 500) score += 0.3;
	else if (tokenCount > 200) score += 0.2;
	else if (tokenCount > 50) score += 0.1;

	// Code presence
	if (CODE_KEYWORD_PATTERN.test(text)) score += 0.15;
	if (CODE_BLOCK_PATTERN.test(text)) score += 0.15;

	// Multi-step indicators
	if (MULTI_STEP_PATTERN.test(text)) score += 0.2;

	// Expert domain
	if (EXPERT_PATTERN.test(text)) score += 0.3;

	return clamp(score);
}

/**
 * Estimate urgency from text signals.
 */
function estimateUrgency(text: string): number {
	let score = 0;

	if (URGENCY_PATTERNS.test(text)) score += 0.5;

	// Exclamation marks suggest urgency
	const exclamations = (text.match(/!/g) ?? []).length;
	score += Math.min(0.3, exclamations * 0.1);

	// ALL CAPS words (3+ chars) suggest urgency
	const capsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
	score += Math.min(0.2, capsWords * 0.05);

	return clamp(score);
}

/**
 * Estimate creativity requirement.
 */
function estimateCreativity(text: string): number {
	let score = 0;

	if (CREATIVITY_PATTERNS.test(text)) score += 0.5;

	// Questions are often more open-ended
	if (text.includes("?")) score += 0.1;

	// "how" and "why" questions need more creative thinking
	if (/\b(how|why)\b/i.test(text)) score += 0.1;

	return clamp(score);
}

/**
 * Estimate precision requirement.
 */
function estimatePrecision(text: string): number {
	let score = 0;

	if (PRECISION_PATTERNS.test(text)) score += 0.5;

	// Numbers suggest precision-sensitive content
	const numbers = (text.match(/\d+/g) ?? []).length;
	score += Math.min(0.2, numbers * 0.03);

	// Code review / audit signals
	if (/\b(code\s+review|security\s+audit|type\s+check|lint)\b/i.test(text)) score += 0.2;

	return clamp(score);
}

/** Clamp a value to [0, 1]. */
function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}

// ─── TuriyaRouter ───────────────────────────────────────────────────────────

/**
 * Turiya Router — contextual bandit model selection.
 *
 * Uses LinUCB to learn which model tier (no-llm, haiku, sonnet, opus)
 * works best for each type of request, based on a 7-dimensional context
 * vector. Records outcomes via Thompson Sampling for Bayesian feedback.
 *
 * @example
 * ```ts
 * const router = new TuriyaRouter();
 *
 * // Extract context from a conversation
 * const context = router.extractContext(messages, systemPrompt, tools);
 *
 * // Get routing decision
 * const decision = router.classify(context);
 * console.log(decision.tier);       // "sonnet"
 * console.log(decision.confidence); // 0.82
 * console.log(decision.costEstimate); // 0.003
 *
 * // After execution, record the outcome
 * router.recordOutcome(decision, 0.9); // high reward
 *
 * // Check savings
 * const stats = router.getStats();
 * console.log(stats.savingsPercent); // 73.2
 * ```
 */
export class TuriyaRouter {
	private readonly linucbAlpha: number;
	private readonly tierCosts: Record<TuriyaTier, number>;
	private readonly maxConversationDepth: number;
	private readonly maxMemoryHits: number;
	private totalPlays = 0;
	private opusBaselineCost = 0;

	// Per-arm (tier) LinUCB state
	private plays = new Map<TuriyaTier, number>();
	private totalRewards = new Map<TuriyaTier, number>();
	private totalCosts = new Map<TuriyaTier, number>();
	private alphas = new Map<TuriyaTier, number>();
	private betas = new Map<TuriyaTier, number>();
	private linA = new Map<TuriyaTier, number[]>();
	private linB = new Map<TuriyaTier, number[]>();

	constructor(config?: TuriyaRouterConfig) {
		this.linucbAlpha = config?.linucbAlpha ?? 0.5;
		this.tierCosts = { ...DEFAULT_TIER_COSTS, ...config?.tierCosts };
		this.maxConversationDepth = config?.maxConversationDepth ?? 50;
		this.maxMemoryHits = config?.maxMemoryHits ?? 20;

		this.initializeArms();
	}

	/**
	 * Extract a 7-dimensional context vector from conversation state.
	 *
	 * This is the "observation" step — Turiya observes the current state
	 * of the world before deciding which tier to route to.
	 *
	 * @param messages - Conversation messages.
	 * @param systemPrompt - Optional system prompt.
	 * @param tools - Available tools (their presence affects context).
	 * @param memoryHits - Number of memory/retrieval hits (optional).
	 * @returns The 7-dimensional TuriyaContext.
	 */
	extractContext(
		messages: Message[],
		systemPrompt?: string,
		tools?: ToolDefinition[],
		memoryHits?: number,
	): TuriyaContext {
		const text = extractLastUserText(messages);
		const fullText = systemPrompt ? `${systemPrompt} ${text}` : text;
		const tokenCount = estimateTokens(fullText);

		return {
			complexity: estimateComplexity(text, tokenCount),
			urgency: estimateUrgency(text),
			creativity: estimateCreativity(text),
			precision: estimatePrecision(text),
			codeRatio: computeCodeRatio(text),
			conversationDepth: clamp(messages.length / (2 * this.maxConversationDepth)),
			memoryLoad: clamp((memoryHits ?? 0) / this.maxMemoryHits),
		};
	}

	/**
	 * Classify a request and return the recommended tier.
	 *
	 * Uses LinUCB: for each arm (tier), compute
	 *   UCB(a, x) = theta_a^T * x + alpha * sqrt(x^T * A_a^{-1} * x)
	 * where theta_a = A_a^{-1} * b_a, and x is the feature vector.
	 *
	 * On cold start (no data), falls back to heuristic rules.
	 *
	 * @param context - The 7-dimensional context vector.
	 * @returns A TuriyaDecision with tier, confidence, cost estimate, and rationale.
	 */
	classify(context: TuriyaContext): TuriyaDecision {
		const x = this.contextToFeatures(context);

		// If no data yet, use heuristic fallback
		if (this.totalPlays < ALL_TIERS.length * 2) {
			return this.heuristicClassify(context, x);
		}

		// LinUCB arm selection
		let bestTier = ALL_TIERS[0];
		let bestScore = -Infinity;
		let bestExpected = 0;
		let bestUncertainty = 0;

		for (const tier of ALL_TIERS) {
			const A = this.linA.get(tier)!;
			const b = this.linB.get(tier)!;

			// theta = A^{-1} * b (learned weight vector)
			const theta = choleskySolve(A, b, D);

			// Expected reward: x^T * theta
			let expected = 0;
			for (let i = 0; i < D; i++) expected += x[i] * theta[i];

			// Confidence bonus: alpha * sqrt(x^T * A^{-1} * x)
			const qf = quadFormInverse(A, x, D);
			const uncertainty = Math.sqrt(Math.max(0, qf));
			const score = expected + this.linucbAlpha * uncertainty;

			if (score > bestScore) {
				bestScore = score;
				bestTier = tier;
				bestExpected = expected;
				bestUncertainty = uncertainty;
			}
		}

		// Confidence: inverse of uncertainty, scaled to [0, 1]
		const confidence = clamp(1 - bestUncertainty / (bestUncertainty + 1));

		const costEstimate = this.tierCosts[bestTier];
		const armIndex = ALL_TIERS.indexOf(bestTier);

		return {
			tier: bestTier,
			confidence,
			costEstimate,
			context,
			rationale: this.buildRationale(bestTier, context, bestExpected, bestUncertainty),
			armIndex,
		};
	}

	/**
	 * Record the outcome of a routing decision.
	 *
	 * Updates both LinUCB parameters (A_a, b_a) and Thompson Sampling
	 * posteriors (alpha, beta) for the selected tier.
	 *
	 * @param decision - The decision that was made.
	 * @param reward - Observed reward in [0, 1]. Higher = better outcome.
	 *   Reward signals: user didn't re-ask (good), didn't switch model (good),
	 *   output was accepted (good), fast response (good).
	 */
	recordOutcome(decision: TuriyaDecision, reward: number): void {
		const r = clamp(reward);
		const tier = decision.tier;
		const x = this.contextToFeatures(decision.context);

		this.totalPlays++;

		// Update play count and rewards
		this.plays.set(tier, (this.plays.get(tier) ?? 0) + 1);
		this.totalRewards.set(tier, (this.totalRewards.get(tier) ?? 0) + r);
		this.totalCosts.set(tier, (this.totalCosts.get(tier) ?? 0) + decision.costEstimate);

		// Update Thompson posteriors: Beta(alpha + r, beta + (1 - r))
		const alpha = this.alphas.get(tier) ?? 1;
		const beta = this.betas.get(tier) ?? 1;
		this.alphas.set(tier, alpha + r);
		this.betas.set(tier, beta + (1 - r));

		// Update LinUCB: A_a += x * x^T, b_a += r * x
		const A = this.linA.get(tier)!;
		const b = this.linB.get(tier)!;
		rankOneUpdate(A, x, D);
		for (let i = 0; i < D; i++) b[i] += r * x[i];

		// Track opus baseline cost
		this.opusBaselineCost += this.tierCosts["opus"];
	}

	/**
	 * Get comprehensive routing statistics.
	 *
	 * @returns TuriyaStats with per-tier breakdowns and cost savings.
	 */
	getStats(): TuriyaStats {
		let totalCost = 0;

		const tiers: TuriyaTierStats[] = ALL_TIERS.map((tier) => {
			const calls = this.plays.get(tier) ?? 0;
			const cost = this.totalCosts.get(tier) ?? 0;
			const reward = this.totalRewards.get(tier) ?? 0;

			totalCost += cost;

			return {
				tier,
				calls,
				totalCost: cost,
				averageReward: calls > 0 ? reward / calls : 0,
				alpha: this.alphas.get(tier) ?? 1,
				beta: this.betas.get(tier) ?? 1,
			};
		});

		const costSavings = this.opusBaselineCost - totalCost;
		const savingsPercent = this.opusBaselineCost > 0
			? (costSavings / this.opusBaselineCost) * 100
			: 0;

		return {
			totalRequests: this.totalPlays,
			tiers,
			totalCost,
			opusBaselineCost: this.opusBaselineCost,
			costSavings,
			savingsPercent,
		};
	}

	/**
	 * Serialize state for persistence (warm restart).
	 */
	serialize(): TuriyaState {
		return {
			totalPlays: this.totalPlays,
			opusBaselineCost: this.opusBaselineCost,
			linucbAlpha: this.linucbAlpha,
			arms: ALL_TIERS.map((tier) => ({
				tier,
				plays: this.plays.get(tier) ?? 0,
				totalReward: this.totalRewards.get(tier) ?? 0,
				totalCost: this.totalCosts.get(tier) ?? 0,
				alpha: this.alphas.get(tier) ?? 1,
				beta: this.betas.get(tier) ?? 1,
				linA: [...(this.linA.get(tier) ?? identityFlat(D))],
				linB: [...(this.linB.get(tier) ?? new Array(D).fill(0))],
			})),
		};
	}

	/**
	 * Restore from serialized state (warm start).
	 */
	deserialize(state: TuriyaState): void {
		this.totalPlays = state.totalPlays;
		this.opusBaselineCost = state.opusBaselineCost;

		for (const arm of state.arms) {
			this.plays.set(arm.tier, arm.plays);
			this.totalRewards.set(arm.tier, arm.totalReward);
			this.totalCosts.set(arm.tier, arm.totalCost);
			this.alphas.set(arm.tier, arm.alpha);
			this.betas.set(arm.tier, arm.beta);
			this.linA.set(arm.tier, [...arm.linA]);
			this.linB.set(arm.tier, [...arm.linB]);
		}
	}

	/**
	 * Reset all learned state. Useful for testing or when model
	 * landscape changes significantly.
	 */
	reset(): void {
		this.totalPlays = 0;
		this.opusBaselineCost = 0;
		this.initializeArms();
	}

	// ─── Private Methods ────────────────────────────────────────────────────

	/**
	 * Convert TuriyaContext to feature vector with bias term.
	 * [bias, complexity, urgency, creativity, precision, codeRatio, conversationDepth, memoryLoad]
	 */
	private contextToFeatures(ctx: TuriyaContext): number[] {
		return [
			1, // bias term
			ctx.complexity,
			ctx.urgency,
			ctx.creativity,
			ctx.precision,
			ctx.codeRatio,
			ctx.conversationDepth,
			ctx.memoryLoad,
		];
	}

	/**
	 * Heuristic classification for cold start (before enough data for LinUCB).
	 *
	 * Rules:
	 * - Very low complexity + no code + no precision → no-llm or haiku
	 * - Medium complexity or code-heavy → sonnet
	 * - High complexity + expert domain → opus
	 */
	private heuristicClassify(context: TuriyaContext, _x: number[]): TuriyaDecision {
		const { complexity, urgency, precision, codeRatio, creativity } = context;

		// Weighted score for tier selection
		const score = complexity * 0.25 + precision * 0.2 + codeRatio * 0.2
			+ creativity * 0.2 + urgency * 0.15;

		let tier: TuriyaTier;
		let rationale: string;

		if (score < 0.1) {
			tier = "no-llm";
			rationale = "Trivial request — pure tool dispatch, no LLM needed.";
		} else if (score < 0.25) {
			tier = "haiku";
			rationale = "Simple request — lightweight model suffices.";
		} else if (score < 0.55) {
			tier = "sonnet";
			rationale = "Standard request — balanced cost and capability.";
		} else {
			tier = "opus";
			rationale = "Complex request — requires maximum capability.";
		}

		// Override: very high complexity always gets opus
		if (complexity > 0.7) {
			tier = "opus";
			rationale = "High complexity detected — routing to strongest model.";
		}

		// Override: high urgency should never be no-llm
		if (urgency > 0.3 && tier === "no-llm") {
			tier = "haiku";
			rationale = "Urgent request — needs at least a lightweight model.";
		}

		const confidence = 0.6; // Heuristic confidence is moderate
		const armIndex = ALL_TIERS.indexOf(tier);

		return {
			tier,
			confidence,
			costEstimate: this.tierCosts[tier],
			context,
			rationale: `[heuristic] ${rationale}`,
			armIndex,
		};
	}

	/**
	 * Build a human-readable rationale for the routing decision.
	 */
	private buildRationale(
		tier: TuriyaTier,
		context: TuriyaContext,
		expected: number,
		uncertainty: number,
	): string {
		const dominant = this.dominantDimension(context);
		const tierLabel = {
			"no-llm": "tool dispatch (zero cost)",
			"haiku": "lightweight model",
			"sonnet": "balanced model",
			"opus": "maximum capability",
		}[tier];

		return `${tierLabel} — dominant signal: ${dominant} ` +
			`(E[r]=${expected.toFixed(3)}, uncertainty=${uncertainty.toFixed(3)})`;
	}

	/**
	 * Find the dimension with the highest value in the context vector.
	 */
	private dominantDimension(ctx: TuriyaContext): string {
		const dims: Array<[string, number]> = [
			["complexity", ctx.complexity],
			["urgency", ctx.urgency],
			["creativity", ctx.creativity],
			["precision", ctx.precision],
			["codeRatio", ctx.codeRatio],
			["conversationDepth", ctx.conversationDepth],
			["memoryLoad", ctx.memoryLoad],
		];
		dims.sort((a, b) => b[1] - a[1]);
		return dims[0][0];
	}

	/** Initialize all arm states to defaults. */
	private initializeArms(): void {
		for (const tier of ALL_TIERS) {
			this.plays.set(tier, 0);
			this.totalRewards.set(tier, 0);
			this.totalCosts.set(tier, 0);
			this.alphas.set(tier, 1);
			this.betas.set(tier, 1);
			this.linA.set(tier, identityFlat(D));
			this.linB.set(tier, new Array(D).fill(0));
		}
	}
}
