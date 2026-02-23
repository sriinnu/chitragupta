/**
 * @module agent-skills-scoring
 * @description Multi-signal relevance scoring for agent skills.
 *
 * Combines three complementary signals:
 *
 * | Signal   | Weight | Property                           |
 * |----------|--------|------------------------------------|
 * | SimHash  | 0.4    | Locality-sensitive global shape    |
 * | Jaccard  | 0.3    | Exact bigram overlap               |
 * | BM25     | 0.3    | Term importance with length norm   |
 *
 * Final score = 0.4 * simhash + 0.3 * jaccard + 0.3 * bm25_normalized
 *
 * @packageDocumentation
 */

import {
	type AgentSkillEntry,
	tokenize,
	extractFeatures,
	computeSimHash,
	skillSimilarity,
} from "./agent-skills-fingerprint.js";

/** A skill scored against a query, sorted by relevance. */
export interface ScoredSkill {
	/** The skill entry. */
	entry: AgentSkillEntry;
	/** Combined relevance score in [0, 1]. */
	score: number;
	/** Individual signal breakdown. */
	signals: {
		/** SimHash cosine-like similarity (weight 0.4). */
		simhash: number;
		/** Jaccard similarity of bigram sets (weight 0.3). */
		jaccard: number;
		/** BM25 score normalized to [0, 1] (weight 0.3). */
		bm25: number;
	};
}

// ── Jaccard Similarity ───────────────────────────────────────────────────────

/** Extract bigram set from text for Jaccard computation. */
function bigramSet(text: string): Set<string> {
	const tokens = tokenize(text);
	const s = new Set<string>();
	for (let i = 0; i < tokens.length - 1; i++) {
		s.add(`${tokens[i]} ${tokens[i + 1]}`);
	}
	return s;
}

/** Jaccard similarity of two sets: |A ∩ B| / |A ∪ B|. */
function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	const smaller = a.size <= b.size ? a : b;
	const larger = a.size <= b.size ? b : a;
	for (const x of smaller) {
		if (larger.has(x)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ── BM25 ─────────────────────────────────────────────────────────────────────

/**
 * BM25 score of a query against a document.
 *
 * BM25(q, d) = sum_{t in q} IDF(t) * (tf(t,d) * (k1+1)) / (tf(t,d) + k1 * (1 - b + b * |d|/avgdl))
 * IDF(t) = ln((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 */
function bm25(
	queryTokens: string[],
	docTokens: string[],
	avgdl: number,
	N: number,
	df: Map<string, number>,
	k1 = 1.2,
	b = 0.75,
): number {
	const docLen = docTokens.length;
	const tf = new Map<string, number>();
	for (const t of docTokens) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	let score = 0;
	for (const t of queryTokens) {
		const dtf = tf.get(t) ?? 0;
		if (dtf === 0) continue;
		const docFreq = df.get(t) ?? 0;
		const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
		const num = dtf * (k1 + 1);
		const denom = dtf + k1 * (1 - b + b * docLen / avgdl);
		score += idf * (num / denom);
	}
	return score;
}

// ── Combined Scoring ─────────────────────────────────────────────────────────

/**
 * Score and rank skills against a natural language query using three
 * complementary signals (SimHash, Jaccard, BM25).
 *
 * BM25 is normalized to [0, 1] by dividing by the max score in the set.
 *
 * @param query - Natural language query string.
 * @param skills - Array of AgentSkillEntry objects (with precomputed simhash).
 * @returns Skills sorted by descending relevance score.
 */
export function scoreSkillRelevance(
	query: string,
	skills: AgentSkillEntry[],
): ScoredSkill[] {
	if (skills.length === 0) return [];

	const queryFeatures = extractFeatures(query, []);
	const queryHash = computeSimHash(queryFeatures);
	const queryBigrams = bigramSet(query);
	const queryTokens = tokenize(query);

	// Build corpus stats for BM25
	const corpusTokens: string[][] = skills.map((s) =>
		tokenize(s.manifest.description),
	);
	const N = skills.length;
	const avgdl = corpusTokens.reduce((s, d) => s + d.length, 0) / N;
	const df = new Map<string, number>();
	for (const doc of corpusTokens) {
		const seen = new Set(doc);
		for (const t of seen) {
			df.set(t, (df.get(t) ?? 0) + 1);
		}
	}

	// Compute raw scores
	const raw: Array<{
		entry: AgentSkillEntry;
		simSig: number;
		jaccSig: number;
		bm25Raw: number;
	}> = [];

	for (let i = 0; i < skills.length; i++) {
		const entry = skills[i];
		const simSig = skillSimilarity(queryHash, entry.simhash);
		const skillBigrams = bigramSet(entry.manifest.description);
		const jaccSig = jaccard(queryBigrams, skillBigrams);
		const bm25Raw = bm25(queryTokens, corpusTokens[i], avgdl, N, df);
		raw.push({ entry, simSig, jaccSig, bm25Raw });
	}

	// Normalize BM25 to [0, 1]
	const maxBm25 = Math.max(...raw.map((r) => r.bm25Raw), 1e-10);

	const scored: ScoredSkill[] = raw.map((r) => {
		const bm25Norm = r.bm25Raw / maxBm25;
		const score = 0.4 * r.simSig + 0.3 * r.jaccSig + 0.3 * bm25Norm;
		return {
			entry: r.entry,
			score,
			signals: {
				simhash: r.simSig,
				jaccard: r.jaccSig,
				bm25: bm25Norm,
			},
		};
	});

	scored.sort((a, b) => b.score - a.score);
	return scored;
}
