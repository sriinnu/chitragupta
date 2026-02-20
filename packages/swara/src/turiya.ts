/**
 * Turiya — Meta-Observer & Contextual Model Router (v2).
 *
 * v2: budget-aware (PILOT), preference-conditioned (LLM Bandit),
 * cascade routing (Unified Routing+Cascading). LinUCB contextual bandit
 * across 4 tiers: no-llm, haiku, sonnet, opus.
 *
 * @module turiya
 */

import type { Message, ToolDefinition } from "./types.js";
import type {
	ManasFeatureBridge,
	TuriyaContext,
	TuriyaTier,
	TuriyaDecision,
	TuriyaTierStats,
	TuriyaStats,
	TuriyaState,
	TuriyaRouterConfig,
	TuriyaPreference,
	TuriyaCascadeResult,
} from "./turiya-types.js";
import { ALL_TIERS, DEFAULT_TIER_COSTS, D } from "./turiya-types.js";
import {
	identityFlat,
	choleskySolve,
	quadFormInverse,
	rankOneUpdate,
	updateBudgetLambda,
	preferenceBlendedScore,
} from "./turiya-math.js";
import { clamp, buildContext } from "./turiya-context.js";

// Re-export all types for backwards compatibility
export type {
	ManasFeatureBridge,
	TuriyaContext,
	TuriyaTier,
	TuriyaDecision,
	TuriyaTierStats,
	TuriyaStats,
	TuriyaState,
	TuriyaRouterConfig,
	TuriyaPreference,
	TuriyaCascadeResult,
};

// ─── TuriyaRouter ───────────────────────────────────────────────────────────

/**
 * Turiya Router — contextual bandit model selection with budget and preference.
 *
 * Uses LinUCB to learn which model tier (no-llm, haiku, sonnet, opus)
 * works best for each type of request. v2 adds budget-constrained selection
 * (PILOT), user preference conditioning (LLM Bandit), and cascade fallback.
 *
 * @example
 * ```ts
 * const router = new TuriyaRouter({ dailyBudget: 5.0 });
 * const context = router.extractContext(messages);
 * const decision = router.classify(context, { costWeight: 0.3 });
 * const cascade = router.cascadeDecision(decision);
 * router.recordOutcome(cascade.final, 0.9);
 * ```
 */
export class TuriyaRouter {
	private readonly linucbAlpha: number;
	private readonly tierCosts: Record<TuriyaTier, number>;
	private readonly maxConversationDepth: number;
	private readonly maxMemoryHits: number;
	private readonly budgetPerStep: number;
	private totalPlays = 0;
	private opusBaselineCost = 0;

	/** PILOT: Lagrangian multiplier for budget constraint. Grows as budget depletes. */
	private budgetLambda = 0;

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

		const dailyBudget = config?.dailyBudget ?? Infinity;
		const expectedRequests = config?.expectedDailyRequests ?? 100;
		this.budgetPerStep = dailyBudget / expectedRequests;

		this.initializeArms();
	}

	/**
	 * Extract a 7-dimensional context vector from conversation state.
	 * Delegates to turiya-context.buildContext for pattern extraction.
	 */
	extractContext(
		messages: Message[],
		systemPrompt?: string,
		_tools?: ToolDefinition[],
		memoryHits?: number,
		manasFeatures?: ManasFeatureBridge,
	): TuriyaContext {
		return buildContext(
			messages,
			systemPrompt,
			memoryHits ?? 0,
			this.maxConversationDepth,
			this.maxMemoryHits,
			manasFeatures,
		);
	}

	/**
	 * Classify a request and return the recommended tier.
	 *
	 * v2: Incorporates budget penalty (PILOT) and user preference (LLM Bandit).
	 * score = (1 - costWeight) * UCB + costWeight * costScore - lambda * tierCost
	 *
	 * @param context - The 7-dimensional context vector.
	 * @param preference - Optional cost/quality preference dial.
	 * @returns A TuriyaDecision with tier, confidence, cost estimate, and rationale.
	 */
	classify(context: TuriyaContext, preference?: TuriyaPreference): TuriyaDecision {
		const x = this.contextToFeatures(context);

		if (this.totalPlays < ALL_TIERS.length * 2) {
			return this.heuristicClassify(context);
		}

		const costWeight = preference?.costWeight ?? 0;
		const maxCost = this.tierCosts["opus"];
		let bestTier = ALL_TIERS[0];
		let bestScore = -Infinity;
		let bestExpected = 0;
		let bestUncertainty = 0;

		for (const tier of ALL_TIERS) {
			const A = this.linA.get(tier)!;
			const b = this.linB.get(tier)!;

			const theta = choleskySolve(A, b, D);
			let expected = 0;
			for (let i = 0; i < D; i++) expected += x[i] * theta[i];

			const qf = quadFormInverse(A, x, D);
			const uncertainty = Math.sqrt(Math.max(0, qf));
			const rewardScore = expected + this.linucbAlpha * uncertainty;

			// LLM Bandit: blend reward with cost preference
			const costScore = maxCost > 0 ? 1 - (this.tierCosts[tier] / maxCost) : 1;
			const blended = preferenceBlendedScore(rewardScore, costScore, costWeight);

			// PILOT: subtract Lagrangian budget penalty
			const score = blended - this.budgetLambda * this.tierCosts[tier];

			if (score > bestScore) {
				bestScore = score;
				bestTier = tier;
				bestExpected = expected;
				bestUncertainty = uncertainty;
			}
		}

		const confidence = clamp(1 - bestUncertainty / (bestUncertainty + 1));
		const armIndex = ALL_TIERS.indexOf(bestTier);

		return {
			tier: bestTier,
			confidence,
			costEstimate: this.tierCosts[bestTier],
			context,
			rationale: this.buildRationale(bestTier, context, bestExpected, bestUncertainty),
			armIndex,
		};
	}

	/**
	 * Cascade decision: if initial tier's confidence is below threshold,
	 * return a fallback tier one step up. Max 1 escalation.
	 * Based on "Unified Routing and Cascading" (2024).
	 *
	 * @param decision - The initial routing decision.
	 * @param qualityThreshold - Confidence threshold for escalation. Default: 0.4.
	 * @returns Cascade result with possible escalation.
	 */
	cascadeDecision(
		decision: TuriyaDecision,
		qualityThreshold?: number,
	): TuriyaCascadeResult {
		const threshold = qualityThreshold ?? 0.4;
		if (decision.confidence >= threshold || decision.tier === "opus") {
			return { final: decision, escalated: false };
		}

		const tierIndex = ALL_TIERS.indexOf(decision.tier);
		const nextTier = ALL_TIERS[Math.min(tierIndex + 1, ALL_TIERS.length - 1)];

		return {
			final: {
				...decision,
				tier: nextTier,
				costEstimate: this.tierCosts[nextTier],
				rationale: `[cascade] ${decision.rationale}`,
				armIndex: ALL_TIERS.indexOf(nextTier),
			},
			escalated: true,
			originalTier: decision.tier,
		};
	}

	/**
	 * Record the outcome of a routing decision.
	 * Updates LinUCB (A_a, b_a), Thompson posteriors, and budget lambda.
	 */
	recordOutcome(decision: TuriyaDecision, reward: number): void {
		const r = clamp(reward);
		const tier = decision.tier;
		const x = this.contextToFeatures(decision.context);

		this.totalPlays++;
		this.plays.set(tier, (this.plays.get(tier) ?? 0) + 1);
		this.totalRewards.set(tier, (this.totalRewards.get(tier) ?? 0) + r);
		this.totalCosts.set(tier, (this.totalCosts.get(tier) ?? 0) + decision.costEstimate);

		// Thompson posteriors: Beta(alpha + r, beta + (1 - r))
		const alpha = this.alphas.get(tier) ?? 1;
		const beta = this.betas.get(tier) ?? 1;
		this.alphas.set(tier, alpha + r);
		this.betas.set(tier, beta + (1 - r));

		// LinUCB: A_a += x * x^T, b_a += r * x
		const A = this.linA.get(tier)!;
		const b = this.linB.get(tier)!;
		rankOneUpdate(A, x, D);
		for (let i = 0; i < D; i++) b[i] += r * x[i];

		this.opusBaselineCost += this.tierCosts["opus"];

		// PILOT: update Lagrangian multiplier for budget constraint
		if (this.budgetPerStep < Infinity) {
			this.budgetLambda = updateBudgetLambda(
				this.budgetLambda,
				decision.costEstimate,
				this.budgetPerStep,
				0.01,
			);
		}
	}

	/** Get comprehensive routing statistics. */
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

	/** Get current budget lambda value. */
	getBudgetLambda(): number {
		return this.budgetLambda;
	}

	/** Serialize state for persistence (warm restart). */
	serialize(): TuriyaState {
		return {
			totalPlays: this.totalPlays,
			opusBaselineCost: this.opusBaselineCost,
			linucbAlpha: this.linucbAlpha,
			budgetLambda: this.budgetLambda,
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

	/** Restore from serialized state (warm start). */
	deserialize(state: TuriyaState): void {
		this.totalPlays = state.totalPlays;
		this.opusBaselineCost = state.opusBaselineCost;
		this.budgetLambda = state.budgetLambda ?? 0;

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

	/** Reset all learned state. */
	reset(): void {
		this.totalPlays = 0;
		this.opusBaselineCost = 0;
		this.budgetLambda = 0;
		this.initializeArms();
	}

	// ─── Private Methods ────────────────────────────────────────────────────

	/** Convert TuriyaContext to feature vector with bias term. */
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

	/** Heuristic classification for cold start (before enough data for LinUCB). */
	private heuristicClassify(context: TuriyaContext): TuriyaDecision {
		const { complexity, urgency, precision, codeRatio, creativity } = context;
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

		if (complexity > 0.7) {
			tier = "opus";
			rationale = "High complexity detected — routing to strongest model.";
		}
		if (urgency > 0.3 && tier === "no-llm") {
			tier = "haiku";
			rationale = "Urgent request — needs at least a lightweight model.";
		}

		return {
			tier,
			confidence: 0.6,
			costEstimate: this.tierCosts[tier],
			context,
			rationale: `[heuristic] ${rationale}`,
			armIndex: ALL_TIERS.indexOf(tier),
		};
	}

	/** Build a human-readable rationale for the routing decision. */
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

	/** Find the dimension with the highest value in the context vector. */
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
