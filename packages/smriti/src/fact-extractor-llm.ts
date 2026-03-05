/**
 * LLM Fallback for Fact Extraction.
 *
 * When pattern + NER confidence is low for a sentence, this module
 * routes it to an LLM for structured extraction. Keeps the core
 * fact-extractor.ts provider-agnostic — inject the provider at call time.
 *
 * @module fact-extractor-llm
 */

import type { ExtractedFact } from "./fact-extractor.js";
import { jaccardNER } from "./fact-extractor-ner.js";

// ─── Provider Interface ───────────────────────────────────────────────────────

/**
 * Injectable LLM provider for fact extraction fallback.
 * Implement this to wire any provider (swara, OpenAI, etc.) into the extractor.
 */
export interface FactExtractorLLMProvider {
	/**
	 * Extract structured facts from a set of low-confidence sentences.
	 * Should return JSON-parseable array of {value, type, confidence}.
	 */
	extractFacts(
		sentences: string[],
	): Promise<Array<{ value: string; type: string; confidence: number }>>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Confidence below which a sentence is routed to LLM for re-extraction. */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Trust discount applied to LLM-extracted facts. LLM can hallucinate. */
const LLM_TRUST_DISCOUNT = 0.9;

/** Jaccard similarity above which two facts are considered the same. */
const DEDUP_JACCARD_THRESHOLD = 0.8;

// ─── LLM Fallback ─────────────────────────────────────────────────────────────

/**
 * Augment a set of existing facts with LLM extraction for low-confidence sentences.
 *
 * Flow:
 * 1. Split text into sentences
 * 2. For sentences where ALL existing facts have confidence < threshold, queue for LLM
 * 3. Call llm.extractFacts(lowConfSentences) — skipped if llm is not provided
 * 4. Map LLM results → ExtractedFact with method: "pattern" and 0.9 trust discount
 * 5. Dedup: Jaccard > 0.8 on word tokens = same fact, keep higher confidence
 *
 * @param text - Original input text.
 * @param existingFacts - Facts already extracted by pattern/vector/NER.
 * @param llm - Optional LLM provider. If absent, returns existingFacts unchanged.
 * @param lowConfidenceThreshold - Sentences below this threshold are LLM candidates.
 * @returns Merged and deduped facts array.
 */
export async function extractFactsWithFallback(
	text: string,
	existingFacts: ExtractedFact[],
	llm?: FactExtractorLLMProvider,
	lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD,
): Promise<ExtractedFact[]> {
	if (!llm) return existingFacts;

	const sentences = splitIntoSentences(text);
	const lowConfSentences = sentences.filter((s) => isLowConfidence(s, existingFacts, lowConfidenceThreshold));

	if (lowConfSentences.length === 0) return existingFacts;

	let llmResults: Array<{ value: string; type: string; confidence: number }> = [];
	try {
		llmResults = await llm.extractFacts(lowConfSentences);
	} catch {
		// LLM failure is non-fatal — return what we have
		return existingFacts;
	}

	const llmFacts: ExtractedFact[] = llmResults
		.filter((r) => r.value && r.confidence > 0)
		.map((r) => ({
			category: mapLLMTypeToCategory(r.type),
			fact: r.value.trim(),
			source: r.value.trim(),
			confidence: Math.min(r.confidence * LLM_TRUST_DISCOUNT, 0.95),
			method: "pattern" as const, // backward compat — "llm" not in union
		}));

	return mergeAndDedup(existingFacts, llmFacts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split text into sentences on . ! ? boundaries. */
function splitIntoSentences(text: string): string[] {
	return text
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 5);
}

/** True when all facts matching this sentence have confidence below threshold. */
function isLowConfidence(
	sentence: string,
	facts: ExtractedFact[],
	threshold: number,
): boolean {
	const matching = facts.filter((f) => sentence.toLowerCase().includes(f.source.toLowerCase().slice(0, 30)));
	if (matching.length === 0) return true;
	return matching.every((f) => f.confidence < threshold);
}

/** Map LLM-returned type string to ExtractedFact category. */
function mapLLMTypeToCategory(type: string): ExtractedFact["category"] {
	const t = type.toLowerCase();
	if (t.includes("identity") || t.includes("name") || t.includes("person")) return "identity";
	if (t.includes("location") || t.includes("place") || t.includes("city")) return "location";
	if (t.includes("work") || t.includes("job") || t.includes("company")) return "work";
	if (t.includes("prefer") || t.includes("tool") || t.includes("tech")) return "preference";
	if (t.includes("relation") || t.includes("colleague") || t.includes("friend")) return "relationship";
	if (t.includes("instruction") || t.includes("rule") || t.includes("always")) return "instruction";
	return "personal";
}

/**
 * Merge LLM facts into existing facts.
 * Dedup: if Jaccard similarity on word tokens > threshold, keep the one with higher confidence.
 */
function mergeAndDedup(existing: ExtractedFact[], incoming: ExtractedFact[]): ExtractedFact[] {
	const result = [...existing];

	for (const inc of incoming) {
		let matched = false;
		for (let i = 0; i < result.length; i++) {
			const sim = jaccardNER(result[i].fact, inc.fact);
			if (sim >= DEDUP_JACCARD_THRESHOLD) {
				// Same fact — keep higher confidence
				if (inc.confidence > result[i].confidence) {
					result[i] = { ...result[i], confidence: inc.confidence };
				}
				matched = true;
				break;
			}
		}
		if (!matched) {
			result.push(inc);
		}
	}

	return result;
}
