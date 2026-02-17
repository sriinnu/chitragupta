/**
 * Provider registry — stores and retrieves ProviderDefinitions by ID.
 */

import type { ModelDefinition, ProviderDefinition } from "./types.js";

/**
 * A registry for managing LLM provider definitions.
 *
 * Stores providers by their unique ID and provides lookup, enumeration,
 * and model aggregation across all registered providers.
 */
export interface ProviderRegistry {
	/** Register a provider definition. Overwrites any existing provider with the same ID. */
	register(provider: ProviderDefinition): void;
	/** Get a provider by its unique ID. Returns `undefined` if not found. */
	get(id: string): ProviderDefinition | undefined;
	/** Get all registered providers. */
	getAll(): ProviderDefinition[];
	/** Check whether a provider with the given ID is registered. */
	has(id: string): boolean;
	/** Remove a provider by ID. No-op if not found. */
	remove(id: string): void;
	/** Aggregate and return all model definitions from all registered providers. */
	getModels(): ModelDefinition[];
}

/**
 * Create a new provider registry instance.
 *
 * The registry stores provider definitions in a Map keyed by provider ID.
 * Unlike the plugin registry, re-registering the same ID silently overwrites
 * the previous entry (useful for hot-reloading providers).
 *
 * @returns A new {@link ProviderRegistry} instance.
 *
 * @example
 * ```ts
 * const registry = createProviderRegistry();
 * registry.register(anthropicProvider);
 * registry.register(openaiProvider);
 * const models = registry.getModels(); // all models from both providers
 * ```
 */
export function createProviderRegistry(): ProviderRegistry {
	const providers = new Map<string, ProviderDefinition>();

	return {
		register(provider: ProviderDefinition): void {
			providers.set(provider.id, provider);
		},

		get(id: string): ProviderDefinition | undefined {
			return providers.get(id);
		},

		getAll(): ProviderDefinition[] {
			return Array.from(providers.values());
		},

		has(id: string): boolean {
			return providers.has(id);
		},

		remove(id: string): void {
			providers.delete(id);
		},

		getModels(): ModelDefinition[] {
			const models: ModelDefinition[] = [];
			for (const provider of providers.values()) {
				models.push(...provider.models);
			}
			return models;
		},
	};
}
