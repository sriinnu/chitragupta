import type { GunaLabel, GunaState } from "./chetana/triguna.js";

export type RoutingTier = "no-llm" | "haiku" | "sonnet" | "opus";
export type RoutingComplexity = "trivial" | "simple" | "medium" | "complex" | "expert";

export interface TrigunaRoutingInfluence {
	dominant: GunaLabel;
	costWeightBias: number;
	minimumTier?: RoutingTier;
	maximumTier?: RoutingTier;
	minimumComplexity?: RoutingComplexity;
	avoidSkipLLM: boolean;
	rationale: string;
}

function getDominantGuna(state: GunaState): GunaLabel {
	if (state.rajas >= state.sattva && state.rajas >= state.tamas) return "rajas";
	if (state.tamas >= state.sattva && state.tamas >= state.rajas) return "tamas";
	return "sattva";
}

/**
 * Translate live triguna state into conservative model-routing pressure.
 *
 * Sattva stays neutral.
 * Rajas biases toward cheaper/faster routing.
 * Tamas prevents zero-LLM shortcuts and raises the model floor.
 */
export function deriveTrigunaRoutingInfluence(
	state: GunaState | null | undefined,
): TrigunaRoutingInfluence | undefined {
	if (!state) return undefined;
	const dominant = getDominantGuna(state);
	const dominantValue = state[dominant];
	if (dominantValue < 0.45) return undefined;

	if (dominant === "tamas") {
		const severe = state.tamas >= 0.7;
		return {
			dominant,
			costWeightBias: -0.35,
			minimumTier: severe ? "sonnet" : "haiku",
			minimumComplexity: severe ? "complex" : "medium",
			avoidSkipLLM: true,
			rationale: severe
				? "tamas dominant: raise the model floor and keep an LLM in the loop"
				: "tamas elevated: avoid zero-LLM shortcuts while degraded",
		};
	}

	if (dominant === "rajas") {
		return {
			dominant,
			costWeightBias: 0.2,
			maximumTier: state.rajas >= 0.75 ? "sonnet" : undefined,
			avoidSkipLLM: false,
			rationale: state.rajas >= 0.75
				? "rajas dominant: cool routing by capping the hottest tier"
				: "rajas elevated: bias toward cheaper and faster tiers",
		};
	}

	return {
		dominant,
		costWeightBias: 0,
		avoidSkipLLM: false,
		rationale: "sattva dominant: routing remains neutral",
	};
}
