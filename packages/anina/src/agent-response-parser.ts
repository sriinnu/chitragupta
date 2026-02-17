/**
 * Shared parsing utilities for agent response text.
 *
 * All specialised agents (debug, docs, refactor, research, review) need to
 * extract structured fields from free-form LLM output.  These two helpers
 * were duplicated across every agent file — this module is the single
 * canonical implementation.
 */

import type { AgentMessage } from "./types.js";

/**
 * Parse a labeled field from an agent's text response.
 *
 * Matches "FIELD: value" patterns (case-insensitive, multiline-aware),
 * capturing everything after the colon on the same line.
 *
 * @param text  - The full text response from the agent.
 * @param field - The label to search for (e.g. "ROOT CAUSE", "CONFIDENCE").
 * @returns The trimmed value after the colon, or `undefined` if not found.
 *
 * @example
 * ```ts
 * const text = "ROOT CAUSE: null dereference on line 42\nCONFIDENCE: 0.9";
 * parseField(text, "ROOT CAUSE");  // "null dereference on line 42"
 * parseField(text, "CONFIDENCE");  // "0.9"
 * parseField(text, "MISSING");     // undefined
 * ```
 */
export function parseField(text: string, field: string): string | undefined {
	// Escape regex special chars in the field name
	const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped}:\\s*(.+?)$`, "im");
	const match = text.match(regex);
	return match ? match[1].trim() : undefined;
}

/**
 * Extract plain text from an {@link AgentMessage}.
 *
 * Filters content parts to only `"text"` blocks and concatenates them
 * with newlines, discarding tool calls, images, and other part types.
 *
 * @param message - The agent message to extract text from.
 * @returns A single string of all text content joined by newlines.
 */
export function extractText(message: AgentMessage): string {
	return message.content
		.filter((p) => p.type === "text")
		.map((p) => (p as { type: "text"; text: string }).text)
		.join("\n");
}
