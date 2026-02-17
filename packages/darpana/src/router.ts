/**
 * Darpana router — resolve incoming model name to provider + upstream model.
 */
import type { DarpanaConfig, ResolvedRoute } from "./types.js";

/**
 * Resolve an Anthropic model name to a provider and upstream model name.
 *
 * Resolution order:
 * 1. Exact alias match (e.g. "sonnet" → "openai/gpt-4.1")
 * 2. Fuzzy alias match (model contains alias key: "claude-sonnet-4-20250514" matches "sonnet")
 * 3. Explicit "provider/model" syntax (e.g. "openai/gpt-4.1")
 * 4. Search all providers for a matching model name
 * 5. First provider with wildcard models (empty models map = accept anything)
 */
export function resolveRoute(model: string, config: DarpanaConfig): ResolvedRoute {
	const stripped = model.replace(/^anthropic\//, "");

	// 1. Exact alias
	if (config.aliases[stripped]) {
		return parseProviderModel(config.aliases[stripped], config);
	}

	// 2. Fuzzy alias — check if model string contains an alias key
	for (const [alias, target] of Object.entries(config.aliases)) {
		if (stripped.toLowerCase().includes(alias.toLowerCase())) {
			return parseProviderModel(target, config);
		}
	}

	// 3. Explicit provider/model syntax
	if (stripped.includes("/")) {
		return parseProviderModel(stripped, config);
	}

	// 4. Search providers for exact model match
	for (const [providerName, provider] of Object.entries(config.providers)) {
		if (provider.models && stripped in provider.models) {
			const overrides = provider.models[stripped];
			return {
				providerName,
				provider,
				upstreamModel: overrides?.upstreamName ?? stripped,
			};
		}
	}

	// 5. First provider with explicit wildcard (empty models map, not passthrough)
	for (const [providerName, provider] of Object.entries(config.providers)) {
		if (provider.type !== "passthrough" && provider.models && Object.keys(provider.models).length === 0) {
			return { providerName, provider, upstreamModel: stripped };
		}
	}

	throw new Error(`No provider found for model: ${model}`);
}

/**
 * Parse "provider/model" into a resolved route.
 */
function parseProviderModel(spec: string, config: DarpanaConfig): ResolvedRoute {
	const slashIdx = spec.indexOf("/");
	if (slashIdx === -1) {
		throw new Error(`Invalid provider/model spec: ${spec}`);
	}

	const providerName = spec.slice(0, slashIdx);
	const modelName = spec.slice(slashIdx + 1);
	const provider = config.providers[providerName];

	if (!provider) {
		throw new Error(`Unknown provider: ${providerName}`);
	}

	const overrides = provider.models?.[modelName];
	return {
		providerName,
		provider,
		upstreamModel: overrides?.upstreamName ?? modelName,
	};
}
