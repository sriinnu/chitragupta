/**
 * @chitragupta/niyanta — Multi-Armed Bandit for Strategy Selection.
 *
 * Learns which orchestration strategy performs best through online
 * experimentation using three complementary bandit algorithms:
 *
 * 1. **UCB1** — Deterministic optimism: score(a) = mu(a) + c * sqrt(ln(N)/n(a))
 * 2. **Thompson Sampling** — Bayesian: sample from Beta(alpha, beta) posteriors
 * 3. **LinUCB** — Contextual: x^T * theta_a + alpha * sqrt(x^T * A^{-1} * x)
 *
 * Math primitives (Cholesky, Beta sampling, etc.) live in bandit-policies.ts.
 */

import type { OrchestratorStrategy } from "./types.js";
import {
	D,
	identityFlat,
	choleskySolve,
	quadFormInverse,
	rankOneUpdate,
	contextToFeatures,
	sampleBeta,
} from "./bandit-policies.js";

// ─── Strategy Bandit Types ───────────────────────────────────────────────────

/** Per-strategy statistics. */
export interface StrategyStats {
	name: OrchestratorStrategy;
	plays: number;
	totalReward: number;
	averageReward: number;
	ucb1Score: number;
	alpha: number;
	beta: number;
}

/** Contextual features for LinUCB. */
export interface BanditContext {
	taskComplexity: number;
	agentCount: number;
	memoryPressure: number;
	avgLatency: number;
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
		linA: number[];
		linB: number[];
	}>;
	explorationConstant: number;
	linucbAlpha: number;
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
 * @example
 * ```ts
 * const bandit = new StrategyBandit();
 * const strategy = bandit.selectStrategy();
 * bandit.recordReward(strategy, 0.85);
 * ```
 */
export class StrategyBandit {
	private mode: BanditMode = "thompson";
	private totalPlays = 0;
	private explorationConstant = 1.41;
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

	/** Select the best strategy according to the current bandit mode. */
	selectStrategy(context?: BanditContext): OrchestratorStrategy {
		switch (this.mode) {
			case "ucb1": return this.selectUCB1();
			case "thompson": return this.selectThompson();
			case "linucb": return this.selectLinUCB(context);
		}
	}

	/** Record the reward for a previously selected strategy. */
	recordReward(strategy: OrchestratorStrategy, reward: number, context?: BanditContext): void {
		const r = Math.max(0, Math.min(1, reward));
		this.totalPlays++;
		this.plays.set(strategy, (this.plays.get(strategy) ?? 0) + 1);
		this.rewards.set(strategy, (this.rewards.get(strategy) ?? 0) + r);

		this.alphas.set(strategy, (this.alphas.get(strategy) ?? 1) + r);
		this.betas.set(strategy, (this.betas.get(strategy) ?? 1) + (1 - r));

		if (this.mode === "linucb" || context) {
			const x = contextToFeatures(context);
			const A = this.linA.get(strategy) ?? identityFlat(D);
			const b = this.linB.get(strategy) ?? new Array(D).fill(0);
			rankOneUpdate(A, x, D);
			for (let i = 0; i < D; i++) b[i] += r * x[i];
			this.linA.set(strategy, A);
			this.linB.set(strategy, b);
		}
	}

	/** Get per-strategy statistics. */
	getStats(): StrategyStats[] {
		return ALL_STRATEGIES.map((name) => {
			const plays = this.plays.get(name) ?? 0;
			const totalReward = this.rewards.get(name) ?? 0;
			const avgReward = plays > 0 ? totalReward / plays : 0;
			let ucb1 = Infinity;
			if (plays > 0 && this.totalPlays > 0) {
				ucb1 = avgReward + this.explorationConstant * Math.sqrt(Math.log(this.totalPlays) / plays);
			}
			return {
				name, plays, totalReward, averageReward: avgReward,
				ucb1Score: ucb1, alpha: this.alphas.get(name) ?? 1, beta: this.betas.get(name) ?? 1,
			};
		});
	}

	/** Set the bandit selection mode. */
	setMode(mode: BanditMode): void { this.mode = mode; }

	/** Serialize for persistence. */
	serialize(): StrategyBanditState {
		return {
			mode: this.mode, totalPlays: this.totalPlays,
			explorationConstant: this.explorationConstant, linucbAlpha: this.linucbAlpha,
			strategies: ALL_STRATEGIES.map((name) => ({
				name, plays: this.plays.get(name) ?? 0,
				totalReward: this.rewards.get(name) ?? 0,
				alpha: this.alphas.get(name) ?? 1, beta: this.betas.get(name) ?? 1,
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

	/** UCB1: pick strategy maximizing mu(a) + c * sqrt(ln(N) / n(a)). */
	private selectUCB1(): OrchestratorStrategy {
		let best = ALL_STRATEGIES[0];
		let bestScore = -Infinity;
		for (const name of ALL_STRATEGIES) {
			const plays = this.plays.get(name) ?? 0;
			if (plays === 0) return name;
			const score = (this.rewards.get(name) ?? 0) / plays
				+ this.explorationConstant * Math.sqrt(Math.log(this.totalPlays) / plays);
			if (score > bestScore) { bestScore = score; best = name; }
		}
		return best;
	}

	/** Thompson Sampling: sample from each Beta posterior, pick highest. */
	private selectThompson(): OrchestratorStrategy {
		let best = ALL_STRATEGIES[0];
		let bestSample = -Infinity;
		for (const name of ALL_STRATEGIES) {
			const sample = sampleBeta(this.alphas.get(name) ?? 1, this.betas.get(name) ?? 1);
			if (sample > bestSample) { bestSample = sample; best = name; }
		}
		return best;
	}

	/** LinUCB: x^T * theta_a + alpha * sqrt(x^T * A^{-1} * x). */
	private selectLinUCB(context?: BanditContext): OrchestratorStrategy {
		const x = contextToFeatures(context);
		let best = ALL_STRATEGIES[0];
		let bestScore = -Infinity;
		for (const name of ALL_STRATEGIES) {
			const A = this.linA.get(name) ?? identityFlat(D);
			const b = this.linB.get(name) ?? new Array(D).fill(0);
			const theta = choleskySolve(A, b, D);
			let expected = 0;
			for (let i = 0; i < D; i++) expected += x[i] * theta[i];
			const uncertainty = Math.sqrt(Math.max(0, quadFormInverse(A, x, D)));
			const score = expected + this.linucbAlpha * uncertainty;
			if (score > bestScore) { bestScore = score; best = name; }
		}
		return best;
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
