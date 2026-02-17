/**
 * Marga — Model Router.
 *
 * Routes requests to the cheapest adequate model based on task complexity.
 * Supports local-first and all-cloud tier strategies, automatic escalation
 * on provider failure, and dynamic tier reconfiguration.
 *
 * Named "Marga" (Sanskrit: path/route) — the path each request takes
 * through the constellation of available models.
 */

import { ProviderError } from "@chitragupta/core";
import type { ProviderRegistry } from "./provider-registry.js";
import type { Context, StreamEvent, StreamOptions } from "./types.js";
import { classifyComplexity } from "./router-classifier.js";
import type { ClassificationResult, TaskComplexity } from "./router-classifier.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A model tier binding a complexity level to a specific provider/model. */
export interface ModelTier {
	/** The complexity level this tier serves. */
	complexity: TaskComplexity;
	/** Provider ID (must match a registered provider). */
	providerId: string;
	/** Model ID within the provider. */
	modelId: string;
	/** Approximate cost per 1k tokens (input+output average). 0 for local models. */
	costPer1kTokens: number;
	/** Maximum output tokens for this tier. */
	maxTokens: number;
}

/** The decision produced by the router for a given request. */
export interface RoutingDecision {
	/** The selected tier. */
	tier: ModelTier;
	/** The complexity classification that drove the decision. */
	classification: ClassificationResult;
	/** If the request was escalated from a lower tier due to failure. */
	escalatedFrom?: ModelTier;
}

/** Configuration for the model router. */
export interface ModelRouterConfig {
	/** Ordered tiers from cheapest to most powerful. */
	tiers: ModelTier[];
	/** Provider registry for looking up provider instances. */
	registry: ProviderRegistry;
	/** Whether to automatically escalate to a higher tier on provider error. */
	autoEscalate?: boolean;
	/** Maximum number of escalation attempts before giving up. */
	maxEscalations?: number;
}

// ─── Complexity Ordering ────────────────────────────────────────────────────

const COMPLEXITY_ORDER: Record<TaskComplexity, number> = {
	trivial: 0,
	simple: 1,
	medium: 2,
	complex: 3,
	expert: 4,
};

// ─── Default Tier Strategies ────────────────────────────────────────────────

/** Local-first strategy: free local models for light work, cloud for heavy. */
export const DEFAULT_TIERS: ModelTier[] = [
	{ complexity: "trivial", providerId: "ollama", modelId: "llama3.2:1b", costPer1kTokens: 0, maxTokens: 2048 },
	{ complexity: "simple", providerId: "ollama", modelId: "llama3.2:3b", costPer1kTokens: 0, maxTokens: 4096 },
	{ complexity: "medium", providerId: "ollama", modelId: "qwen2.5-coder:7b", costPer1kTokens: 0, maxTokens: 8192 },
	{ complexity: "complex", providerId: "anthropic", modelId: "claude-sonnet-4-5-20250929", costPer1kTokens: 3.0, maxTokens: 16384 },
	{ complexity: "expert", providerId: "anthropic", modelId: "claude-opus-4-6", costPer1kTokens: 15.0, maxTokens: 32768 },
];

/** All-cloud strategy: pay-per-token across providers. */
export const CLOUD_TIERS: ModelTier[] = [
	{ complexity: "trivial", providerId: "anthropic", modelId: "claude-haiku-3-5", costPer1kTokens: 0.25, maxTokens: 4096 },
	{ complexity: "simple", providerId: "openai", modelId: "gpt-4o-mini", costPer1kTokens: 0.15, maxTokens: 4096 },
	{ complexity: "medium", providerId: "anthropic", modelId: "claude-sonnet-4-5-20250929", costPer1kTokens: 3.0, maxTokens: 8192 },
	{ complexity: "complex", providerId: "openai", modelId: "gpt-4o", costPer1kTokens: 2.5, maxTokens: 16384 },
	{ complexity: "expert", providerId: "anthropic", modelId: "claude-opus-4-6", costPer1kTokens: 15.0, maxTokens: 32768 },
];

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Model router that selects the cheapest adequate model for each request.
 *
 * Given a set of tiers (complexity -> model bindings) and a provider registry,
 * the router classifies the request, selects the matching tier, and streams
 * the response. On provider failure with `autoEscalate` enabled, it climbs
 * to the next higher tier and retries.
 *
 * @example
 * ```ts
 * const router = new ModelRouter({
 *   tiers: DEFAULT_TIERS,
 *   registry,
 *   autoEscalate: true,
 *   maxEscalations: 2,
 * });
 *
 * const decision = router.route(context);
 * console.log(`Routing to ${decision.tier.modelId}`);
 *
 * for await (const event of router.complete(context)) {
 *   // handle stream events
 * }
 * ```
 */
export class ModelRouter {
	private tiers: ModelTier[];
	private readonly registry: ProviderRegistry;
	private readonly autoEscalate: boolean;
	private readonly maxEscalations: number;

	constructor(config: ModelRouterConfig) {
		this.tiers = [...config.tiers];
		this.registry = config.registry;
		this.autoEscalate = config.autoEscalate ?? false;
		this.maxEscalations = config.maxEscalations ?? 2;
	}

	/**
	 * Classify the request and select the matching tier.
	 *
	 * @param context - The conversation context.
	 * @param options - Optional stream options (forwarded to classifier).
	 * @returns A routing decision with the selected tier and classification.
	 */
	route(context: Context, options?: StreamOptions): RoutingDecision {
		const classification = classifyComplexity(context, options);
		const tier = this.findTier(classification.complexity);

		if (!tier) {
			// Fallback: use the most powerful available tier
			const fallback = this.getMostPowerfulAvailable();
			if (!fallback) {
				throw new ProviderError(
					"No matching tier found and no providers available for fallback",
					"router",
				);
			}
			return { tier: fallback, classification };
		}

		return { tier, classification };
	}

	/**
	 * Route the request and stream the response from the selected provider.
	 *
	 * On provider error with `autoEscalate` enabled, the router climbs to
	 * the next higher tier (up to `maxEscalations` times) and retries.
	 *
	 * @param context - The conversation context.
	 * @param options - Optional stream options.
	 * @yields Stream events from the selected provider.
	 */
	async *complete(context: Context, options?: StreamOptions): AsyncIterable<StreamEvent> {
		const decision = this.route(context, options);
		let currentTier = decision.tier;
		let escalations = 0;
		let escalatedFrom: ModelTier | undefined;

		while (true) {
			const provider = this.registry.get(currentTier.providerId);
			if (!provider) {
				if (this.autoEscalate && escalations < this.maxEscalations) {
					const next = this.findNextHigherTier(currentTier);
					if (next) {
						escalatedFrom = currentTier;
						currentTier = next;
						escalations++;
						continue;
					}
				}
				throw new ProviderError(
					`Provider "${currentTier.providerId}" not found in registry`,
					currentTier.providerId,
				);
			}

			const streamOptions: StreamOptions = {
				...options,
				maxTokens: options?.maxTokens ?? currentTier.maxTokens,
			};

			try {
				const stream = provider.stream(currentTier.modelId, context, streamOptions);

				for await (const event of stream) {
					// Intercept errors for potential escalation
					if (event.type === "error" && this.autoEscalate && escalations < this.maxEscalations) {
						const next = this.findNextHigherTier(currentTier);
						if (next) {
							escalatedFrom = currentTier;
							currentTier = next;
							escalations++;
							break;
						}
					}
					yield event;

					// If we reached "done", we're finished
					if (event.type === "done") {
						return;
					}
				}

				// If we broke out of the inner loop for escalation, continue outer loop
				if (escalatedFrom === currentTier || escalations > 0) {
					// Check if we actually escalated (currentTier changed above)
					if (escalatedFrom && currentTier !== escalatedFrom) {
						continue;
					}
				}

				// Stream completed normally
				return;
			} catch (err) {
				if (this.autoEscalate && escalations < this.maxEscalations) {
					const next = this.findNextHigherTier(currentTier);
					if (next) {
						escalatedFrom = currentTier;
						currentTier = next;
						escalations++;
						continue;
					}
				}

				// Re-throw as ProviderError if not already
				if (err instanceof ProviderError) {
					throw err;
				}
				throw new ProviderError(
					`Stream failed for ${currentTier.providerId}/${currentTier.modelId}: ${err instanceof Error ? err.message : String(err)}`,
					currentTier.providerId,
					undefined,
					err instanceof Error ? err : undefined,
				);
			}
		}
	}

	/** Replace the current tier set. */
	setTiers(tiers: ModelTier[]): void {
		this.tiers = [...tiers];
	}

	/** Get a copy of the current tier set. */
	getTiers(): ModelTier[] {
		return [...this.tiers];
	}

	/**
	 * Find the cheapest tier whose provider is registered.
	 * @returns The cheapest available tier, or `undefined` if none.
	 */
	getCheapestAvailable(): ModelTier | undefined {
		return [...this.tiers]
			.filter((t) => this.registry.has(t.providerId))
			.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens)[0];
	}

	/**
	 * Find the most powerful (most expensive) tier whose provider is registered.
	 * @returns The most expensive available tier, or `undefined` if none.
	 */
	getMostPowerfulAvailable(): ModelTier | undefined {
		return [...this.tiers]
			.filter((t) => this.registry.has(t.providerId))
			.sort((a, b) => b.costPer1kTokens - a.costPer1kTokens)[0];
	}

	// ─── Private Helpers ──────────────────────────────────────────────────────

	/** Find the tier matching a given complexity level. */
	private findTier(complexity: TaskComplexity): ModelTier | undefined {
		return this.tiers.find((t) => t.complexity === complexity);
	}

	/**
	 * Find the next higher tier above the given one.
	 * "Higher" means the next complexity level up that also has an
	 * available provider in the registry.
	 */
	private findNextHigherTier(current: ModelTier): ModelTier | undefined {
		const currentOrder = COMPLEXITY_ORDER[current.complexity];
		return this.tiers
			.filter(
				(t) =>
					COMPLEXITY_ORDER[t.complexity] > currentOrder &&
					this.registry.has(t.providerId),
			)
			.sort((a, b) => COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity])[0];
	}
}
