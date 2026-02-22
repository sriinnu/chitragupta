/**
 * Deterministic fallback responses for no-LLM routing decisions.
 */
export function buildNoLlmTemplateResponse(message: string, intentHint?: string): string {
	const trimmed = message.trim();
	if (!trimmed) return "I'm here. Tell me what you want to do next.";

	const normalized = trimmed.toLowerCase();
	const greetingPattern = /^(hi+|hello+|hey+|yo+|namaste|namaskaram|hola|bonjour|hallo|ciao|salut|ola|olá|నమస్కారం|హాయ్|नमस्ते|こんにちは|你好)\b/u;
	if (greetingPattern.test(normalized)) {
		return "Hey. I'm here with you. What do you want to do next?";
	}

	if (
		normalized.includes("which model")
		|| normalized.includes("what model")
		|| normalized.includes("model are we using")
	) {
		return "I'm in no-LLM quick mode for this turn. Use /model for the active model details.";
	}

	if (intentHint === "smalltalk" || intentHint === "conversation") {
		return "I'm here. Tell me the next thing you want, and I'll keep it quick.";
	}

	if (trimmed.endsWith("?")) {
		return "I can help. Ask for a quick answer, a plan, or a command.";
	}

	return "I'm here. Tell me the next task.";
}

