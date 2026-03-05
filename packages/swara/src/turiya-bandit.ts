/**
 * Turiya Bandit Helpers — heuristic classification, rationale, and dominance.
 *
 * Pure functions extracted from TuriyaRouter to keep turiya.ts under 450 LOC.
 * All operate on explicit parameters — no `this` context needed.
 *
 * @module turiya-bandit
 */

import type {
	TuriyaContext,
	TuriyaTier,
	TuriyaDecision,
} from "./turiya-types.js";
import { ALL_TIERS } from "./turiya-types.js";

/**
 * Heuristic classification for cold start (before enough data for LinUCB).
 *
 * IMPORTANT: no-llm is only for explicit memory/session/status/help commands.
 * All other messages (questions, chat, coding, math, explanations) must go
 * to an LLM tier. When in doubt, send to haiku — no-llm is the exception.
 *
 * @param context - 7-dimensional context vector.
 * @param tierCosts - Per-tier cost map (from TuriyaRouter config).
 * @returns Heuristic TuriyaDecision with confidence 0.6.
 */
export function heuristicClassify(
	context: TuriyaContext,
	tierCosts: Record<TuriyaTier, number>,
): TuriyaDecision {
	const { complexity, urgency, precision, codeRatio, creativity } = context;
	const score = complexity * 0.25 + precision * 0.2 + codeRatio * 0.2
		+ creativity * 0.2 + urgency * 0.15;

	let tier: TuriyaTier;
	let rationale: string;

	// no-llm is ONLY valid when all feature dimensions are near-zero AND
	// conversationDepth is low — this means pure tool dispatch commands.
	const allDimensionsNearZero = complexity < 0.01 && urgency < 0.01
		&& precision < 0.01 && codeRatio < 0.01 && creativity < 0.01
		&& context.conversationDepth < 0.01;

	if (allDimensionsNearZero) {
		tier = "no-llm";
		rationale = "Pure tool dispatch — all context dimensions near zero.";
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

	return {
		tier,
		confidence: 0.6,
		costEstimate: tierCosts[tier],
		context,
		rationale: `[heuristic] ${rationale}`,
		armIndex: ALL_TIERS.indexOf(tier),
	};
}

/**
 * Build a human-readable rationale string for a routing decision.
 *
 * @param tier - Selected tier.
 * @param context - Context vector (for dominant dimension display).
 * @param expected - Expected reward from LinUCB.
 * @param uncertainty - Uncertainty term from LinUCB.
 * @returns Formatted rationale string.
 */
export function buildRationale(
	tier: TuriyaTier,
	context: TuriyaContext,
	expected: number,
	uncertainty: number,
): string {
	const dominant = dominantDimension(context);
	const tierLabel: Record<TuriyaTier, string> = {
		"no-llm": "tool dispatch (zero cost)",
		"haiku": "lightweight model",
		"sonnet": "balanced model",
		"opus": "maximum capability",
	};

	return `${tierLabel[tier]} — dominant signal: ${dominant} ` +
		`(E[r]=${expected.toFixed(3)}, uncertainty=${uncertainty.toFixed(3)})`;
}

/**
 * Find the dimension with the highest value in the context vector.
 *
 * @param ctx - TuriyaContext to inspect.
 * @returns Name of the dominant dimension.
 */
export function dominantDimension(ctx: TuriyaContext): string {
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
