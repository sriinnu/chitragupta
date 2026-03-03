/**
 * Deterministic fallback responses for no-LLM routing decisions.
 *
 * Returns a canned response for exact pattern matches (greetings, help, status),
 * or `null` when no pattern matches. A `null` return signals the caller to
 * route the message to an LLM instead of replying with canned text.
 *
 * @param message - The user's raw message.
 * @param intentHint - Optional intent from NLU classification.
 * @returns A canned response string, or `null` if the message needs LLM handling.
 */
export function buildNoLlmTemplateResponse(message: string, intentHint?: string): string | null {
	const trimmed = message.trim();
	if (!trimmed) return "I'm here. Tell me what you want to do next.";

	const normalized = trimmed.toLowerCase();

	// Greetings — these are safe to handle without an LLM
	const greetingPattern = /^(hi+|hello+|hey+|yo+|namaste|namaskaram|hola|bonjour|hallo|ciao|salut|ola|olá|నమస్కారం|హాయ్|नमस्ते|こんにちは|你好)\s*[.!]*$/u;
	if (greetingPattern.test(normalized)) {
		return "Hey. I'm here with you. What do you want to do next?";
	}

	// Model info query — direct to /model command
	if (
		normalized.includes("which model")
		|| normalized.includes("what model")
		|| normalized.includes("model are we using")
	) {
		return "I'm in no-LLM quick mode for this turn. Use /model for the active model details.";
	}

	// Help / navigation — safe to handle without LLM
	if (/^(help|commands|tools|what can you do)\s*[?]*$/i.test(normalized)) {
		return "Use /help for available commands, or ask me anything and I'll route to the right model.";
	}

	// Everything else (questions, coding requests, math, chat, explanations)
	// should NOT get a canned response — return null to signal LLM routing.
	return null;
}

