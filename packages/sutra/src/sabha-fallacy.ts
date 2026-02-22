/**
 * @chitragupta/sutra — Sabha Hetvabhasa (Logical Fallacy) Detection.
 *
 * Five classical fallacies detected via heuristic NLU (zero LLM cost):
 *   1. Asiddha   — unestablished premise
 *   2. Viruddha  — contradictory reason
 *   3. Anaikantika — inconclusive/over-broad reason
 *   4. Prakarana-sama — circular reasoning
 *   5. Kalatita  — untimely/temporal invalidity
 *
 * Extracted from sabha.ts to keep file sizes under 450 LOC.
 */

import type { NyayaSyllogism, HetvabhasaDetection } from "./sabha-types.js";
import {
	extractKeywords,
	jaccardSimilarity,
	containsAnyWord,
	countMatchingWords,
	NEGATION_WORDS,
	UNIVERSAL_WORDS,
	PAST_INDICATORS,
	FUTURE_INDICATORS,
} from "./sabha-types.js";

/**
 * Detect all Hetvabhasa (logical fallacies) in a Nyaya syllogism.
 *
 * Performs five heuristic checks using keyword matching and Jaccard
 * similarity — zero LLM cost.
 *
 * @param syllogism - The Nyaya syllogism to analyze.
 * @returns Array of detected fallacies (may be empty).
 */
export function detectFallacies(syllogism: NyayaSyllogism): HetvabhasaDetection[] {
	const detections: HetvabhasaDetection[] = [];
	detections.push(...detectAsiddha(syllogism));
	detections.push(...detectViruddha(syllogism));
	detections.push(...detectAnaikantika(syllogism));
	detections.push(...detectPrakaranaSama(syllogism));
	detections.push(...detectKalatita(syllogism));
	return detections;
}

/**
 * Asiddha: hetu references concepts not grounded in udaharana.
 * Check: hetu keywords that don't appear in udaharana.
 */
export function detectAsiddha(s: NyayaSyllogism): HetvabhasaDetection[] {
	const hetuKeywords = extractKeywords(s.hetu);
	const udaharanaKeywords = extractKeywords(s.udaharana);
	if (hetuKeywords.size === 0) return [];

	let grounded = 0;
	for (const kw of hetuKeywords) {
		if (udaharanaKeywords.has(kw)) grounded++;
	}

	const groundedRatio = grounded / hetuKeywords.size;
	if (groundedRatio < 0.2) {
		return [{
			type: "asiddha",
			description: `Hetu references concepts not grounded in udaharana. Only ${Math.round(groundedRatio * 100)}% of reason keywords found in example.`,
			severity: "fatal",
			affectedStep: "hetu",
		}];
	}
	return [];
}

/**
 * Viruddha: hetu contains negation that directly opposes the pratijna.
 * Check: hetu has negation words AND shares key concepts with pratijna.
 */
export function detectViruddha(s: NyayaSyllogism): HetvabhasaDetection[] {
	const hetuHasNegation = containsAnyWord(s.hetu, NEGATION_WORDS);
	if (!hetuHasNegation) return [];

	const hetuKeywords = extractKeywords(s.hetu);
	const pratijnaKeywords = extractKeywords(s.pratijna);

	let overlap = 0;
	for (const kw of hetuKeywords) {
		if (pratijnaKeywords.has(kw)) overlap++;
	}

	const overlapRatio = pratijnaKeywords.size > 0 ? overlap / pratijnaKeywords.size : 0;
	if (overlapRatio >= 0.3) {
		return [{
			type: "viruddha",
			description: `Hetu contains negation while sharing ${overlap} keywords with pratijna. The reason appears to contradict the proposition.`,
			severity: "fatal",
			affectedStep: "hetu",
		}];
	}
	return [];
}

/**
 * Anaikantika: hetu uses overly broad universal quantifiers.
 * Check: presence of "all", "every", "always", etc.
 */
export function detectAnaikantika(s: NyayaSyllogism): HetvabhasaDetection[] {
	const universalCount = countMatchingWords(s.hetu, UNIVERSAL_WORDS);

	if (universalCount >= 2) {
		return [{
			type: "anaikantika",
			description: `Hetu uses ${universalCount} universal quantifiers, making the reason too broad to be conclusive.`,
			severity: "warning",
			affectedStep: "hetu",
		}];
	}

	if (universalCount === 1) {
		const words = s.hetu.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
		if (words.length <= 5) {
			return [{
				type: "anaikantika",
				description: "Hetu is brief and uses a universal quantifier, making it potentially too broad.",
				severity: "warning",
				affectedStep: "hetu",
			}];
		}
	}
	return [];
}

/**
 * Prakarana-sama: nigamana is semantically identical to pratijna.
 * Check: Jaccard similarity > 0.8 between their keyword sets.
 */
export function detectPrakaranaSama(s: NyayaSyllogism): HetvabhasaDetection[] {
	const pratijnaKw = extractKeywords(s.pratijna);
	const nigamanaKw = extractKeywords(s.nigamana);
	const similarity = jaccardSimilarity(pratijnaKw, nigamanaKw);

	if (similarity > 0.8) {
		return [{
			type: "prakarana-sama",
			description: `Nigamana is semantically near-identical to pratijna (Jaccard similarity: ${similarity.toFixed(3)}). The argument is circular.`,
			severity: "warning",
			affectedStep: "nigamana",
		}];
	}
	return [];
}

/**
 * Kalatita: hetu uses past-tense evidence to justify a future-oriented pratijna.
 * Check: hetu has past indicators AND pratijna/nigamana has future indicators.
 */
export function detectKalatita(s: NyayaSyllogism): HetvabhasaDetection[] {
	const hetuHasPast = containsAnyWord(s.hetu, PAST_INDICATORS);
	const pratijnaHasFuture = containsAnyWord(s.pratijna, FUTURE_INDICATORS);
	const nigamanaHasFuture = containsAnyWord(s.nigamana, FUTURE_INDICATORS);

	if (hetuHasPast && (pratijnaHasFuture || nigamanaHasFuture)) {
		return [{
			type: "kalatita",
			description: "Hetu references past events to support a future-oriented claim. Temporal mismatch.",
			severity: "warning",
			affectedStep: "hetu",
		}];
	}
	return [];
}
