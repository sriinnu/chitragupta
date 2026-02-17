/**
 * @chitragupta/smriti — Real-Time Fact Extractor
 *
 * The nervous system's first synapse: intercepts every user turn,
 * detects personal facts, preferences, and key statements, then
 * persists them to global memory IMMEDIATELY.
 *
 * Uses two detection strategies:
 *   1. Pattern matching (fast, <1ms) — catches explicit declarations
 *   2. Vector similarity (robust, ~5ms) — catches typos, variations, slang
 *
 * This is what makes "I live in Vienna" work across all providers.
 * Without this, Chitragupta is a logger. With it, Chitragupta remembers.
 */

import { EmbeddingService, fallbackEmbedding } from "./embedding-service.js";
import { cosineSimilarity } from "./graphrag-scoring.js";
import type { MemoryScope } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A fact extracted from user input. */
export interface ExtractedFact {
	/** Fact category. */
	category: "identity" | "location" | "work" | "preference" | "relationship" | "instruction" | "personal";
	/** The extracted fact statement, normalized. */
	fact: string;
	/** Original text that triggered extraction. */
	source: string;
	/** Confidence score 0-1. */
	confidence: number;
	/** Detection method. */
	method: "pattern" | "vector";
}

/** Configuration for the fact extractor. */
export interface FactExtractorConfig {
	/** Minimum confidence to save a fact. Default: 0.5. */
	minConfidence: number;
	/** Whether to use vector similarity (slower but catches typos). Default: true. */
	useVectors: boolean;
	/** Cosine similarity threshold for vector-based detection. Default: 0.65. */
	vectorThreshold: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: FactExtractorConfig = {
	minConfidence: 0.5,
	useVectors: true,
	vectorThreshold: 0.65,
};

/**
 * Pattern-based fact detection rules.
 * Each rule has a category, regex pattern, and confidence multiplier.
 */
const FACT_PATTERNS: Array<{
	category: ExtractedFact["category"];
	patterns: RegExp[];
	confidence: number;
}> = [
	{
		category: "identity",
		patterns: [
			/(?:my name is|i'm called|call me|i am|i'm)\s+([a-z][a-z\s]{1,30})/i,
			/(?:they call me|people call me|everyone calls me)\s+([a-z][a-z\s]{1,30})/i,
		],
		confidence: 0.9,
	},
	{
		category: "location",
		patterns: [
			/(?:i live in|i'm from|i am from|based in|i'm based in|i reside in|living in|i'm in)\s+([a-z][a-z\s,]{1,50})/i,
			/(?:my home is in|my city is|i'm located in|located in)\s+([a-z][a-z\s,]{1,50})/i,
		],
		confidence: 0.9,
	},
	{
		category: "work",
		patterns: [
			/(?:i work at|i work for|my company is|i'm at|employed at|employed by)\s+([a-z][a-z\s&.]{1,50})/i,
			/(?:my job is|my role is|i'm a|i am a|i work as)\s+([a-z][a-z\s]{1,50})/i,
			/(?:my team|our team|my department)\s+(?:is|works on)\s+([a-z][a-z\s]{1,50})/i,
		],
		confidence: 0.85,
	},
	{
		category: "preference",
		patterns: [
			/(?:always use|i prefer|i use|i like using|we use|we always)\s+([a-z][a-z\s./-]{1,50})/i,
			/(?:never use|don't use|avoid|i hate|stop using)\s+([a-z][a-z\s./-]{1,50})/i,
			/(?:my editor is|my ide is|i code in|i develop in|my stack is)\s+([a-z][a-z\s./-]{1,50})/i,
		],
		confidence: 0.85,
	},
	{
		category: "relationship",
		patterns: [
			/(?:my wife|my husband|my partner|my girlfriend|my boyfriend)\s+(?:is|'s)\s+([a-z][a-z\s]{1,30})/i,
			/(?:my colleague|my friend|my boss|my manager|my coworker)\s+([a-z][a-z\s]{1,30})/i,
		],
		confidence: 0.85,
	},
	{
		category: "instruction",
		patterns: [
			/(?:remember that|don't forget|note that|keep in mind|save (?:that|this))\s+(.{5,200})/i,
			/(?:from now on|going forward|always remember)\s+(.{5,200})/i,
		],
		confidence: 0.95,
	},
	{
		category: "personal",
		patterns: [
			/(?:my birthday is|i was born on|i was born in)\s+([a-z0-9][a-z0-9\s,]{1,30})/i,
			/(?:my favorite|my favourite)\s+(\w+)\s+is\s+(.{1,50})/i,
			/(?:i speak|my language is|my native language)\s+([a-z][a-z\s,]{1,30})/i,
		],
		confidence: 0.8,
	},
];

/**
 * Vector templates — canonical fact statements used for similarity matching.
 * When user input is semantically close to one of these, it's a fact.
 * This catches typos, variations, and non-standard phrasing.
 */
const VECTOR_TEMPLATES: Array<{
	category: ExtractedFact["category"];
	template: string;
}> = [
	{ category: "identity", template: "my name is" },
	{ category: "identity", template: "people call me" },
	{ category: "location", template: "i live in a city" },
	{ category: "location", template: "i am from a country" },
	{ category: "location", template: "i am based in a place" },
	{ category: "work", template: "i work at a company" },
	{ category: "work", template: "my job role is" },
	{ category: "preference", template: "i always prefer to use this tool" },
	{ category: "preference", template: "never use that library" },
	{ category: "relationship", template: "my family member is named" },
	{ category: "instruction", template: "remember this important fact" },
	{ category: "instruction", template: "always do this from now on" },
	{ category: "personal", template: "my birthday is on a date" },
	{ category: "personal", template: "my favorite thing is" },
];

// ─── Fact Extractor ─────────────────────────────────────────────────────────

/**
 * Real-time fact extractor.
 *
 * @example
 * ```ts
 * const extractor = new FactExtractor();
 * const facts = await extractor.extract("i live in vienna");
 * // → [{ category: "location", fact: "Lives in vienna", confidence: 0.9 }]
 *
 * await extractor.extractAndSave("call me jaanu", { type: "global" });
 * // → fact saved to global memory immediately
 * ```
 */
export class FactExtractor {
	private config: FactExtractorConfig;
	private embeddingService: EmbeddingService;
	private templateEmbeddings: Map<string, number[]> = new Map();
	private initialized = false;
	/** Recently saved facts (dedup cache). Cleared periodically. */
	private recentFacts: Set<string> = new Set();
	private recentFactsCleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config?: Partial<FactExtractorConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.embeddingService = new EmbeddingService();
	}

	/**
	 * Initialize vector templates (lazy, on first use).
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		if (!this.config.useVectors) {
			this.initialized = true;
			return;
		}

		// Pre-compute template embeddings
		for (const tmpl of VECTOR_TEMPLATES) {
			const embedding = fallbackEmbedding(tmpl.template);
			this.templateEmbeddings.set(tmpl.template, embedding);
		}

		this.initialized = true;

		// Cleanup dedup cache every 10 minutes
		this.recentFactsCleanupTimer = setInterval(() => {
			this.recentFacts.clear();
		}, 10 * 60 * 1000);
		if (this.recentFactsCleanupTimer.unref) {
			this.recentFactsCleanupTimer.unref();
		}
	}

	/**
	 * Extract facts from user input text.
	 * Uses pattern matching first, then vector similarity for misses.
	 */
	async extract(text: string): Promise<ExtractedFact[]> {
		await this.ensureInitialized();

		const facts: ExtractedFact[] = [];

		// Skip very short or very long messages
		if (text.length < 5 || text.length > 5000) return facts;

		// Strategy 1: Pattern matching (fast)
		for (const rule of FACT_PATTERNS) {
			for (const pattern of rule.patterns) {
				const match = text.match(pattern);
				if (match) {
					const extracted = match[1]?.trim() || match[0].trim();
					const fact = normalizeFact(rule.category, extracted);
					if (fact) {
						facts.push({
							category: rule.category,
							fact,
							source: match[0].trim(),
							confidence: rule.confidence,
							method: "pattern",
						});
					}
				}
			}
		}

		// Strategy 2: Vector similarity (catches typos, variations)
		if (this.config.useVectors && facts.length === 0) {
			const inputEmbedding = fallbackEmbedding(text.toLowerCase().slice(0, 200));

			let bestScore = 0;
			let bestTemplate: typeof VECTOR_TEMPLATES[number] | null = null;

			for (const tmpl of VECTOR_TEMPLATES) {
				const tmplEmbedding = this.templateEmbeddings.get(tmpl.template);
				if (!tmplEmbedding) continue;

				const score = cosineSimilarity(inputEmbedding, tmplEmbedding);
				if (score > bestScore) {
					bestScore = score;
					bestTemplate = tmpl;
				}
			}

			if (bestTemplate && bestScore >= this.config.vectorThreshold) {
				const fact = normalizeFact(bestTemplate.category, text.trim());
				if (fact) {
					facts.push({
						category: bestTemplate.category,
						fact,
						source: text.trim().slice(0, 200),
						confidence: Math.min(bestScore, 0.85), // Cap vector confidence slightly lower
						method: "vector",
					});
				}
			}
		}

		// Filter by minimum confidence
		return facts.filter((f) => f.confidence >= this.config.minConfidence);
	}

	/**
	 * Extract facts and save to memory immediately.
	 * Deduplicates against recently saved facts.
	 *
	 * @param text - User input text.
	 * @param scope - Memory scope to save to (default: global).
	 * @param projectScope - Optional project scope for project-level preferences.
	 * @returns Extracted and saved facts.
	 */
	async extractAndSave(
		text: string,
		scope?: MemoryScope,
		projectScope?: MemoryScope,
	): Promise<ExtractedFact[]> {
		const facts = await this.extract(text);
		if (facts.length === 0) return [];

		const { appendMemory, getMemory } = await import("./memory-store.js");
		const globalScope: MemoryScope = scope ?? { type: "global" };

		// Check existing memory for dedup
		const existingMemory = getMemory(globalScope).toLowerCase();

		for (const fact of facts) {
			// Dedup: skip if already saved recently or exists in memory
			const dedupeKey = `${fact.category}:${fact.fact.toLowerCase().slice(0, 50)}`;
			if (this.recentFacts.has(dedupeKey)) continue;
			if (existingMemory.includes(fact.fact.toLowerCase().slice(0, 30))) continue;

			// Save to appropriate scope
			const entry = `[${fact.category}] ${fact.fact}`;

			if (fact.category === "preference" && projectScope) {
				// Preferences can be project-scoped
				await appendMemory(projectScope, entry);
			} else {
				// Everything else is global
				await appendMemory(globalScope, entry);
			}

			this.recentFacts.add(dedupeKey);
		}

		return facts;
	}

	/**
	 * Cleanup resources.
	 */
	dispose(): void {
		if (this.recentFactsCleanupTimer) {
			clearInterval(this.recentFactsCleanupTimer);
			this.recentFactsCleanupTimer = null;
		}
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize an extracted fact into a clean statement.
 */
function normalizeFact(category: ExtractedFact["category"], raw: string): string | null {
	const cleaned = raw.replace(/[.!?,;:]+$/, "").trim();
	if (cleaned.length < 2) return null;

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
			return cleaned;
		case "personal":
			return cleaned;
		default:
			return cleaned;
	}
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance: FactExtractor | null = null;

/**
 * Get the global fact extractor instance.
 */
export function getFactExtractor(config?: Partial<FactExtractorConfig>): FactExtractor {
	if (!_instance) {
		_instance = new FactExtractor(config);
	}
	return _instance;
}
