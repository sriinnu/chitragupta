/**
 * Sabha Provider Factory — Wire 8.
 *
 * Creates a SabhaProvider backed by a real LLM provider resolved from
 * settings/environment. Used by KartavyaEngine to gate niyama approvals
 * through Sabha deliberation before activation.
 *
 * @module sabha-provider-factory
 */

import { createLogger } from "@chitragupta/core";
import type { ModelDefinition, ProviderDefinition } from "@chitragupta/swara";

const log = createLogger("cli:sabha-provider");

/** Minimal SabhaProvider shape (duck-typed to avoid importing sutra types). */
export interface SabhaProviderLike {
	deliberate(
		topic: string,
		context: string,
		options?: Record<string, unknown>,
	): Promise<unknown>;
}

function selectSabhaModel(
	provider: ProviderDefinition,
	preferredModel: string | undefined,
): string | undefined {
	const requested = preferredModel?.trim();
	if (requested) {
		const exact = provider.models.find((model) => model.id === requested);
		if (exact) return exact.id;
	}

	const streamingCandidate = provider.models.find((model) => supportsSabha(model));
	if (streamingCandidate) return streamingCandidate.id;
	return provider.models[0]?.id;
}

function supportsSabha(model: ModelDefinition): boolean {
	return model.capabilities.streaming;
}

/**
 * Create a SabhaProvider backed by a real LLM provider.
 *
 * Resolves providers from settings/env (same as serve mode), then wraps
 * in a deliberation prompt. Returns undefined if no provider available.
 */
export async function createSabhaProvider(): Promise<SabhaProviderLike | undefined> {
	try {
		const { loadGlobalSettings } = await import("@chitragupta/core");
		const { createProviderRegistry } = await import("@chitragupta/swara/provider-registry");
		const { resolvePreferredProvider } = await import("./bootstrap.js");

		const settings = loadGlobalSettings();
		const registry = createProviderRegistry();
		const resolved = resolvePreferredProvider(undefined, settings, registry);
		if (!resolved) {
			log.debug("No LLM provider available for Sabha deliberation");
			return undefined;
		}

		const { provider } = resolved;
		const preferredModel =
			process.env.CHITRAGUPTA_SABHA_MODEL?.trim() ||
			settings.defaultModel?.trim();
		const model = selectSabhaModel(provider, preferredModel);
		if (!model) {
			log.debug("No compatible model available for Sabha deliberation", {
				providerId: provider.id,
			});
			return undefined;
		}

		return {
			async deliberate(topic: string, context: string, options?: Record<string, unknown>) {
				const roles = (options?.roles as string[]) ?? ["safety-reviewer", "product-owner", "security-auditor"];
				const prompt =
					`You are a risk assessment panel with roles: ${roles.join(", ")}.\n\n` +
					`Evaluate the following proposed auto-execution:\n\n` +
					`**Topic:** ${topic}\n**Context:**\n${context}\n\n` +
					`Respond with ONLY a JSON object (no markdown):\n` +
					`{ "verdict": "approved"|"rejected"|"no-consensus",\n` +
					`  "confidence": 0.0-1.0,\n` +
					`  "rationale": "brief explanation",\n` +
					`  "perspectives": [{ "role": "...", "position": "approve"|"reject"|"abstain", "reasoning": "..." }] }`;

				try {
					const reqCtx = { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }] }] };
					const response = await provider.stream(model, reqCtx, {});
					let text = "";
					for await (const chunk of response) {
						if (chunk.type === "text") text += (chunk as { text: string }).text;
					}
					const jsonMatch = text.match(/\{[\s\S]*\}/);
					if (!jsonMatch) return { verdict: "no-consensus", confidence: 0.3, rationale: "Could not parse LLM response" };
					const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
					if (!parsed.verdict || typeof parsed.confidence !== "number") {
						return { verdict: "no-consensus", confidence: 0, rationale: "Invalid response schema" };
					}
					return parsed;
				} catch (err) {
					log.debug("Sabha deliberation failed", { error: err instanceof Error ? err.message : String(err) });
					return { verdict: "no-consensus", confidence: 0, rationale: "LLM call failed" };
				}
			},
		};
	} catch {
		return undefined;
	}
}
