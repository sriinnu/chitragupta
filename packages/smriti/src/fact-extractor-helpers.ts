import type { ExtractedFact } from "./fact-extractor.js";

/** Minimum word count per category for a fact to be substantive. */
const MIN_WORDS: Record<ExtractedFact["category"], number> = {
	identity: 1,
	location: 1,
	work: 1,
	preference: 1,
	relationship: 1,
	instruction: 3,
	personal: 1,
};

/** Minimum character length per category (after cleaning). */
const MIN_LENGTH: Record<ExtractedFact["category"], number> = {
	identity: 2,
	location: 2,
	work: 2,
	preference: 3,
	relationship: 2,
	instruction: 10,
	personal: 2,
};

/** Low-value tokens that pollute memory when extracted from code conversations. */
const NOISE_PATTERNS: RegExp[] = [
	/^(?:this|that|it|the|a|an|some|any|all)$/i,
	/^(?:circular deps?|deps?|fix|bug|error|issue|test|build|run|check)$/i,
	/^(?:file|folder|dir|path|module|package|import|export)$/i,
	/^[a-z]$/i,
];

/** Normalize an extracted fact into a clean statement. */
export function normalizeFact(category: ExtractedFact["category"], raw: string): string | null {
	const cleaned = raw.replace(/[.!?,;:]+$/, "").trim();
	if (cleaned.length < MIN_LENGTH[category]) return null;
	const wordCount = cleaned.split(/\s+/).filter((word) => word.length > 0).length;
	if (wordCount < MIN_WORDS[category]) return null;
	if (wordCount <= 2) {
		for (const noise of NOISE_PATTERNS) {
			if (noise.test(cleaned)) return null;
		}
	}
	switch (category) {
		case "identity":
			return `Name: ${capitalize(cleaned)}`;
		case "location":
			return `Lives in ${capitalize(cleaned)}`;
		case "work":
			return `Works at/as ${cleaned}`;
		case "preference":
			return `Preference: ${cleaned}`;
		case "relationship":
			return `Relationship: ${cleaned}`;
		case "instruction":
		case "personal":
		default:
			return cleaned;
	}
}

export function shouldAnalyzeForFacts(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 8 || trimmed.length > 5000) return false;
	const lower = trimmed.toLowerCase();
	if (/^\/[a-z0-9_-]+/i.test(lower)) return false;
	if (
		/^(hi|hii|hello|hey|yo|thanks|thank you|ok|okay|cool|fine|namaste|namaskaram)\b/.test(lower) &&
		trimmed.length < 64
	) {
		return false;
	}
	const hasMemorySignal =
		/\b(remember|don't forget|note this|save this|from now on|always|call me|my name is|i am|i'm|i live|i work|i prefer|we use|our stack)\b/i.test(
			lower,
		);
	const hasFirstPerson = /\b(i|i'm|i am|my|we|our)\b/i.test(lower);
	const hasPatternCue =
		/\b(based in|living in|located in|never use|don't use|avoid|keep in mind|note that|remember that)\b/i.test(
			lower,
		);
	const isQuestion = /\?\s*$/.test(lower);
	if (isQuestion && !hasMemorySignal) return false;
	return hasMemorySignal || hasFirstPerson || hasPatternCue;
}

export function nerEntityToCategory(type: string): ExtractedFact["category"] | null {
	switch (type) {
		case "PERSON":
			return "relationship";
		case "TECHNOLOGY":
		case "PROJECT":
			return "preference";
		case "ORGANIZATION":
			return "work";
		case "METRIC":
			return "personal";
		case "DATE":
			return null;
		default:
			return null;
	}
}

export function shouldUseVectorFallback(text: string): boolean {
	const lower = text.toLowerCase();
	if (!shouldAnalyzeForFacts(text)) return false;
	if (/^\s*(which|what|when|where|why|how)\b/.test(lower) && /\?\s*$/.test(lower)) return false;
	return true;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
