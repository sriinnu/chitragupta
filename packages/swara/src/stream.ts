/**
 * Unified streaming interface and collection helpers.
 */

import type { TokenUsage, StopReason } from "@chitragupta/core";
import { ProviderError } from "@chitragupta/core";
import type { ProviderRegistry } from "./provider-registry.js";
import type { Context, StreamEvent, StreamOptions, ToolCallContent } from "./types.js";

/**
 * Shared default registry — populated via `registerBuiltinProviders()` or
 * direct `registry.register()` calls. The `stream()` function uses this
 * registry unless callers use the lower-level provider API directly.
 */
let defaultRegistry: ProviderRegistry | null = null;

/**
 * Set the default registry used by the top-level `stream()` helper.
 */
export function setDefaultRegistry(registry: ProviderRegistry): void {
	defaultRegistry = registry;
}

/**
 * Get the current default registry.
 */
export function getDefaultRegistry(): ProviderRegistry | null {
	return defaultRegistry;
}

/**
 * Unified stream function.
 *
 * Looks up the provider from the shared registry, then delegates to its
 * `stream()` method.
 */
export async function* stream(
	providerId: string,
	modelId: string,
	context: Context,
	options: StreamOptions = {},
): AsyncIterable<StreamEvent> {
	if (!defaultRegistry) {
		throw new ProviderError(
			"No provider registry configured. Call setDefaultRegistry() or registerBuiltinProviders() first.",
			providerId,
		);
	}

	const provider = defaultRegistry.get(providerId);
	if (!provider) {
		throw new ProviderError(
			`Provider "${providerId}" not found in registry. Available: ${defaultRegistry.getAll().map((p) => p.id).join(", ") || "(none)"}`,
			providerId,
		);
	}

	yield* provider.stream(modelId, context, options);
}

/**
 * Result of collecting a complete stream.
 */
export interface CollectedStream {
	text: string;
	thinking: string;
	toolCalls: ToolCallContent[];
	usage: TokenUsage | null;
	stopReason: StopReason | null;
}

/**
 * Collect all events from a stream into a single result object.
 *
 * Concatenates text deltas, thinking deltas, accumulates tool calls,
 * and captures the final usage/stop reason from the `done` event.
 */
export async function collectStream(
	events: AsyncIterable<StreamEvent>,
): Promise<CollectedStream> {
	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	const toolCalls: ToolCallContent[] = [];
	let usage: TokenUsage | null = null;
	let stopReason: StopReason | null = null;

	for await (const event of events) {
		switch (event.type) {
			case "text":
				textParts.push(event.text);
				break;
			case "thinking":
				thinkingParts.push(event.text);
				break;
			case "tool_call":
				toolCalls.push({
					type: "tool_call",
					id: event.id,
					name: event.name,
					arguments: event.arguments,
				});
				break;
			case "usage":
				usage = event.usage;
				break;
			case "done":
				stopReason = event.stopReason;
				usage = event.usage;
				break;
			case "error":
				throw event.error;
			// start events are informational — skip
		}
	}

	return {
		text: textParts.join(""),
		thinking: thinkingParts.join(""),
		toolCalls,
		usage,
		stopReason,
	};
}
