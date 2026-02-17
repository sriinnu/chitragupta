/**
 * Shared utilities for Anthropic format converters.
 */

/**
 * Extract text content from a tool_result block's content field.
 * Handles: string, null/undefined, array of content blocks, dict/object.
 */
export function extractToolResultContent(content: unknown): string {
	if (content == null) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b: Record<string, unknown>) => b.type === "text")
			.map((b: Record<string, unknown>) => (b as { text: string }).text)
			.join("");
	}
	if (typeof content === "object") return JSON.stringify(content);
	return String(content);
}
