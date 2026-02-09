/**
 * Simple token estimation utilities.
 *
 * Uses the widely-accepted ~4 characters per token heuristic as a fast
 * approximation. For precise counts, integrate a real tokenizer such as
 * tiktoken for OpenAI or the Anthropic tokenizer.
 */

import type { Message, ModelDefinition } from "./types.js";

/** Approximate characters per token. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens for a given text string.
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extract the full text content from a message for token estimation.
 */
function messageText(message: Message): string {
	const parts: string[] = [];
	for (const part of message.content) {
		switch (part.type) {
			case "text":
				parts.push(part.text);
				break;
			case "thinking":
				parts.push(part.text);
				break;
			case "tool_call":
				parts.push(part.name);
				parts.push(part.arguments);
				break;
			case "tool_result":
				parts.push(part.content);
				break;
			case "image":
				// Images consume tokens but estimating from base64 length is unreliable.
				// Use a conservative fixed estimate (~1000 tokens per image).
				parts.push("x".repeat(4000));
				break;
		}
	}
	// Add a small overhead for role/message framing (~4 tokens per message)
	return parts.join(" ") + "    ".repeat(4);
}

/**
 * Estimate the total token count for an array of messages.
 */
export function estimateMessagesTokens(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		total += estimateTokens(messageText(msg));
	}
	return total;
}

/**
 * Check whether a set of messages fits within a model's context window.
 */
export function fitsInContext(
	messages: Message[],
	model: ModelDefinition,
): boolean {
	const used = estimateMessagesTokens(messages);
	return used <= model.contextWindow;
}

/**
 * Calculate what percentage of the context window is consumed by the messages.
 *
 * Returns a value between 0 and 100 (can exceed 100 if over the limit).
 */
export function contextUsagePercent(
	messages: Message[],
	model: ModelDefinition,
): number {
	const used = estimateMessagesTokens(messages);
	if (model.contextWindow <= 0) return 0;
	return (used / model.contextWindow) * 100;
}
