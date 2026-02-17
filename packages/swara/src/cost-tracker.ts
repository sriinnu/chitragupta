/**
 * Cost calculation and tracking utilities.
 */

import type { TokenUsage, CostBreakdown } from "@chitragupta/core";
import type { ModelDefinition } from "./types.js";

/**
 * Calculate the cost breakdown for a single completion given usage and model pricing.
 *
 * Pricing values on ModelDefinition are per-million tokens (industry standard).
 */
export function calculateCost(
	usage: TokenUsage,
	model: ModelDefinition,
): CostBreakdown {
	const { pricing } = model;
	const perM = 1_000_000;

	const input = (usage.inputTokens * pricing.input) / perM;
	const output = (usage.outputTokens * pricing.output) / perM;

	const cacheRead =
		usage.cacheReadTokens !== undefined && pricing.cacheRead !== undefined
			? (usage.cacheReadTokens * pricing.cacheRead) / perM
			: undefined;

	const cacheWrite =
		usage.cacheWriteTokens !== undefined && pricing.cacheWrite !== undefined
			? (usage.cacheWriteTokens * pricing.cacheWrite) / perM
			: undefined;

	const total =
		input + output + (cacheRead ?? 0) + (cacheWrite ?? 0);

	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		total,
		currency: "USD",
	};
}

/**
 * Session-level cost accumulator.
 *
 * Tracks cumulative costs across multiple LLM calls.
 */
export class CostTracker {
	private costs: CostBreakdown[] = [];

	/**
	 * Add a cost entry from a single completion.
	 */
	add(cost: CostBreakdown): void {
		this.costs.push(cost);
	}

	/**
	 * Compute the aggregated total across all tracked calls.
	 */
	total(): CostBreakdown {
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let hasCacheRead = false;
		let hasCacheWrite = false;

		for (const c of this.costs) {
			input += c.input;
			output += c.output;
			if (c.cacheRead !== undefined) {
				cacheRead += c.cacheRead;
				hasCacheRead = true;
			}
			if (c.cacheWrite !== undefined) {
				cacheWrite += c.cacheWrite;
				hasCacheWrite = true;
			}
		}

		const total = input + output + cacheRead + cacheWrite;

		return {
			input,
			output,
			cacheRead: hasCacheRead ? cacheRead : undefined,
			cacheWrite: hasCacheWrite ? cacheWrite : undefined,
			total,
			currency: "USD",
		};
	}

	/**
	 * Reset all tracked costs.
	 */
	reset(): void {
		this.costs = [];
	}
}
