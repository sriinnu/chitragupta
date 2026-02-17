/**
 * @chitragupta/niyanta — Multi-Armed Bandit for Strategy Selection.
 *
 * Learns which orchestration strategy performs best through online
 * experimentation using three complementary bandit algorithms:
 *
 * 1. **UCB1 (Upper Confidence Bound)** — Deterministic optimism:
 *
 *        score(a) = mu(a) + c * sqrt( ln(N) / n(a) )
 *
 *    where mu(a) = average reward of strategy a, N = total plays,
 *    n(a) = plays of strategy a, c = exploration constant.
 *    UCB1 achieves O(ln(N)) regret — provably optimal for the
 *    stochastic bandit setting (Auer et al., 2002).
 *
 * 2. **Thompson Sampling** — Bayesian exploration:
 *    Each strategy has a Beta(alpha, beta) posterior distribution.
 *    On each round: sample from each posterior, pick the highest.
 *    After observing reward r in [0,1]:
 *      alpha += r, beta += (1 - r)
 *    Thompson Sampling is Bayes-optimal and empirically matches
 *    or beats UCB1 in most settings.
 *
 * 3. **LinUCB (Contextual Linear Bandit)** — Context-aware:
 *
 *        score(a, x) = x^T * theta_a + alpha * sqrt( x^T * A_a^{-1} * x )
 *
 *    where x is a feature vector [task_complexity, agent_count,
 *    memory_pressure, avg_latency, error_rate], and A_a = I + SUM x_i x_i^T.
 *    This learns a separate linear model per strategy, adapting to context.
 *    From Li et al. (2010), "A contextual-bandit approach to personalized
 *    news article recommendation."
 *
 * All three modes are available and switchable at runtime.
 */

import type { OrchestratorStrategy, OrchestratorTask } from "./types.js";

// ─── Strategy Bandit Types ───────────────────────────────────────────────────

/** Per-strategy statistics. */
export interface StrategyStats {
	/** Name of the strategy. */
	name: OrchestratorStrategy;
	/** Number of times this strategy has been selected. */
	plays: number;
	/** Cumulative reward received. */
	totalReward: number;
	/** Average reward (totalReward / plays). */
	averageReward: number;
	/** UCB1 score (only meaningful in UCB1 mode). */
	ucb1Score: number;
	/** Thompson alpha parameter. */
	alpha: number;
	/** Thompson beta parameter. */
	beta: number;
}

/** Contextual features for LinUCB. */
export interface BanditContext {
	/** Task complexity estimate [0, 1]. */
	taskComplexity: number;
	/** Number of active agents [0, 1] (normalized). */
	agentCount: number;
	/** Memory pressure [0, 1]. */
	memoryPressure: number;
	/** Average latency [0, 1] (normalized). */
	avgLatency: number;
	/** Error rate [0, 1]. */
	errorRate: number;
}

/** Bandit operating mode. */
export type BanditMode = "ucb1" | "thompson" | "linucb";

/** Serializable state for persistence. */
export interface StrategyBanditState {
	mode: BanditMode;
	totalPlays: number;
	strategies: Array<{
		name: OrchestratorStrategy;
		plays: number;
		totalReward: number;
		alpha: number;
		beta: number;
		/** LinUCB A matrix (flattened, d x d). */
		linA: number[];
		/** LinUCB b vector (d elements). */
		linB: number[];
	}>;
	explorationConstant: number;
	linucbAlpha: number;
}

// ─── LinUCB Helpers ──────────────────────────────────────────────────────────

/** Feature dimension for LinUCB (5 context features + 1 bias). */
const D = 6;

/** Create identity matrix of size d, flattened. */
function identityFlat(d: number): number[] {
	const m = new Array(d * d).fill(0);
	for (let i = 0; i < d; i++) m[i * d + i] = 1;
	return m;
}

/**
 * Solve A * x = b for x, where A is a d x d symmetric positive-definite
 * matrix (stored flattened). Uses Cholesky decomposition.
 *
 * Cholesky: A = L * L^T, then solve L * y = b (forward), L^T * x = y (backward).
 *
 * Complexity: O(d^3) for decomposition, O(d^2) for solve. For d=6 this is trivial.
 */
function choleskySolve(A: number[], b: number[], d: number): number[] {
	// Cholesky decomposition: A = L * L^T
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
 * Compute x^T * A^{-1} * x using Cholesky: solve A * z = x, then dot(x, z).
 *
 * This avoids explicitly inverting A, which is more numerically stable.
 */
function quadFormInverse(A: number[], x: number[], d: number): number {
	const z = choleskySolve(A, x, d);
	let dot = 0;
	for (let i = 0; i < d; i++) dot += x[i] * z[i];
	return dot;
}

/**
 * Rank-1 update: A += x * x^T (outer product, in-place on flattened matrix).
 */
function rankOneUpdate(A: number[], x: number[], d: number): void {
	for (let i = 0; i < d; i++) {
		for (let j = 0; j < d; j++) {
			A[i * d + j] += x[i] * x[j];
		}
	}
}

/** Convert BanditContext to feature vector (with bias term). */
function contextToFeatures(ctx?: BanditContext): number[] {
	if (!ctx) return [1, 0.5, 0.5, 0.5, 0.5, 0.5]; // default with bias
	return [
		1, // bias
		ctx.taskComplexity,
		ctx.agentCount,
		ctx.memoryPressure,
		ctx.avgLatency,
		ctx.errorRate,
	];
}

// ─── Beta Distribution Sampling ──────────────────────────────────────────────

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

// ─── Strategy Bandit Class ───────────────────────────────────────────────────

/** All strategies that the bandit can choose from. */
const ALL_STRATEGIES: OrchestratorStrategy[] = [
	"round-robin", "least-loaded", "specialized",
	"hierarchical", "swarm", "competitive",
];

/**
 * Multi-armed bandit that learns which orchestration strategy to use.
 *
 * Supports three selection modes:
 *
 * - **ucb1**: Deterministic upper-confidence bound. Good when you want
 *   predictable, theory-backed exploration with O(ln N) regret.
 *
 * - **thompson**: Bayesian sampling. Empirically the best general-purpose
 *   bandit algorithm. Naturally balances exploration and exploitation.
 *
 * - **linucb**: Contextual bandit that considers task features. Best when
 *   the optimal strategy depends on the task characteristics.
 *
 * @example
 * ```ts
 * const bandit = new StrategyBandit();
 * const strategy = bandit.selectStrategy();
 * // ... execute task with selected strategy ...
 * bandit.recordReward(strategy, 0.85); // success metric
 * ```
 */
export class StrategyBandit {
	private mode: BanditMode = "thompson";
	private totalPlays = 0;
	private explorationConstant = 1.41; // sqrt(2), standard UCB1
	private linucbAlpha = 0.5;

	private plays = new Map<OrchestratorStrategy, number>();
	private rewards = new Map<OrchestratorStrategy, number>();
	private alphas = new Map<OrchestratorStrategy, number>();
	private betas = new Map<OrchestratorStrategy, number>();
	private linA = new Map<OrchestratorStrategy, number[]>();
	private linB = new Map<OrchestratorStrategy, number[]>();

	constructor() {
		this.initializeStrategies();
	}

	/**
	 * Select the best strategy according to the current bandit mode.
	 *
	 * @param context - Optional contextual features (required for linucb mode).
	 * @returns The name of the selected strategy.
	 */
	selectStrategy(context?: BanditContext): OrchestratorStrategy {
		switch (this.mode) {
			case "ucb1": return this.selectUCB1();
			case "thompson": return this.selectThompson();
			case "linucb": return this.selectLinUCB(context);
		}
	}

	/**
	 * Record the reward for a previously selected strategy.
	 *
	 * @param strategy - The strategy that was used.
	 * @param reward - Observed reward in [0, 1].
	 * @param context - Contextual features (used by linucb for model updates).
	 */
	recordReward(
		strategy: OrchestratorStrategy,
		reward: number,
		context?: BanditContext,
	): void {
		const clampedReward = Math.max(0, Math.min(1, reward));

		this.totalPlays++;
		this.plays.set(strategy, (this.plays.get(strategy) ?? 0) + 1);
		this.rewards.set(strategy, (this.rewards.get(strategy) ?? 0) + clampedReward);

		// Update Thompson posteriors
		const alpha = this.alphas.get(strategy) ?? 1;
		const beta = this.betas.get(strategy) ?? 1;
		this.alphas.set(strategy, alpha + clampedReward);
		this.betas.set(strategy, beta + (1 - clampedReward));

		// Update LinUCB model
		if (this.mode === "linucb" || context) {
			const x = contextToFeatures(context);
			const A = this.linA.get(strategy) ?? identityFlat(D);
			const b = this.linB.get(strategy) ?? new Array(D).fill(0);

			rankOneUpdate(A, x, D);
			for (let i = 0; i < D; i++) b[i] += clampedReward * x[i];

			this.linA.set(strategy, A);
			this.linB.set(strategy, b);
		}
	}

	/**
	 * Get per-strategy statistics.
	 *
	 * @returns Array of stats for each strategy.
	 */
	getStats(): StrategyStats[] {
		return ALL_STRATEGIES.map((name) => {
			const plays = this.plays.get(name) ?? 0;
			const totalReward = this.rewards.get(name) ?? 0;
			const avgReward = plays > 0 ? totalReward / plays : 0;
			const alpha = this.alphas.get(name) ?? 1;
			const beta = this.betas.get(name) ?? 1;

			// Compute UCB1 score
			let ucb1 = Infinity;
			if (plays > 0 && this.totalPlays > 0) {
				ucb1 = avgReward + this.explorationConstant * Math.sqrt(
					Math.log(this.totalPlays) / plays,
				);
			}

			return {
				name,
				plays,
				totalReward,
				averageReward: avgReward,
				ucb1Score: ucb1,
				alpha,
				beta,
			};
		});
	}

	/** Set the bandit selection mode. */
	setMode(mode: BanditMode): void {
		this.mode = mode;
	}

	/** Serialize for persistence. */
	serialize(): StrategyBanditState {
		return {
			mode: this.mode,
			totalPlays: this.totalPlays,
			explorationConstant: this.explorationConstant,
			linucbAlpha: this.linucbAlpha,
			strategies: ALL_STRATEGIES.map((name) => ({
				name,
				plays: this.plays.get(name) ?? 0,
				totalReward: this.rewards.get(name) ?? 0,
				alpha: this.alphas.get(name) ?? 1,
				beta: this.betas.get(name) ?? 1,
				linA: this.linA.get(name) ?? identityFlat(D),
				linB: this.linB.get(name) ?? new Array(D).fill(0),
			})),
		};
	}

	/** Restore from serialized state (warm start). */
	deserialize(state: StrategyBanditState): void {
		this.mode = state.mode;
		this.totalPlays = state.totalPlays;
		this.explorationConstant = state.explorationConstant;
		this.linucbAlpha = state.linucbAlpha;

		for (const s of state.strategies) {
			this.plays.set(s.name, s.plays);
			this.rewards.set(s.name, s.totalReward);
			this.alphas.set(s.name, s.alpha);
			this.betas.set(s.name, s.beta);
			this.linA.set(s.name, [...s.linA]);
			this.linB.set(s.name, [...s.linB]);
		}
	}

	// ─── Private Selection Methods ────────────────────────────────────

	/**
	 * UCB1 selection: pick strategy maximizing mu(a) + c * sqrt(ln(N) / n(a)).
	 *
	 * Any unplayed strategy gets infinite score (forced exploration).
	 */
	private selectUCB1(): OrchestratorStrategy {
		let bestStrategy = ALL_STRATEGIES[0];
		let bestScore = -Infinity;

		for (const name of ALL_STRATEGIES) {
			const plays = this.plays.get(name) ?? 0;

			if (plays === 0) return name; // unplayed => explore immediately

			const avgReward = (this.rewards.get(name) ?? 0) / plays;
			const exploration = this.explorationConstant * Math.sqrt(
				Math.log(this.totalPlays) / plays,
			);
			const score = avgReward + exploration;

			if (score > bestScore) {
				bestScore = score;
				bestStrategy = name;
			}
		}

		return bestStrategy;
	}

	/**
	 * Thompson Sampling: sample from each strategy's Beta posterior, pick highest.
	 */
	private selectThompson(): OrchestratorStrategy {
		let bestStrategy = ALL_STRATEGIES[0];
		let bestSample = -Infinity;

		for (const name of ALL_STRATEGIES) {
			const alpha = this.alphas.get(name) ?? 1;
			const beta = this.betas.get(name) ?? 1;
			const sample = sampleBeta(alpha, beta);

			if (sample > bestSample) {
				bestSample = sample;
				bestStrategy = name;
			}
		}

		return bestStrategy;
	}

	/**
	 * LinUCB selection: x^T * theta_a + alpha * sqrt(x^T * A_a^{-1} * x).
	 *
	 * theta_a = A_a^{-1} * b_a is the learned weight vector.
	 * The second term is the confidence bound (exploration bonus).
	 */
	private selectLinUCB(context?: BanditContext): OrchestratorStrategy {
		const x = contextToFeatures(context);
		let bestStrategy = ALL_STRATEGIES[0];
		let bestScore = -Infinity;

		for (const name of ALL_STRATEGIES) {
			const A = this.linA.get(name) ?? identityFlat(D);
			const b = this.linB.get(name) ?? new Array(D).fill(0);

			// theta = A^{-1} * b
			const theta = choleskySolve(A, b, D);

			// Expected reward: x^T * theta
			let expected = 0;
			for (let i = 0; i < D; i++) expected += x[i] * theta[i];

			// Confidence bonus: alpha * sqrt(x^T * A^{-1} * x)
			const uncertainty = Math.sqrt(Math.max(0, quadFormInverse(A, x, D)));
			const score = expected + this.linucbAlpha * uncertainty;

			if (score > bestScore) {
				bestScore = score;
				bestStrategy = name;
			}
		}

		return bestStrategy;
	}

	/** Initialize all strategy states. */
	private initializeStrategies(): void {
		for (const name of ALL_STRATEGIES) {
			this.plays.set(name, 0);
			this.rewards.set(name, 0);
			this.alphas.set(name, 1);
			this.betas.set(name, 1);
			this.linA.set(name, identityFlat(D));
			this.linB.set(name, new Array(D).fill(0));
		}
	}
}
