/**
 * @chitragupta/anina — Information-Theoretic Context Compaction.
 *
 * Replaces heuristic-based compaction with mathematically grounded algorithms:
 *
 * 1. **TF-IDF Scoring** — Each message's importance is measured by its
 *    aggregate TF-IDF score across all terms:
 *
 *        tfidf(t, d, D) = tf(t, d) * log(|D| / df(t))
 *        score(d) = SUM_t tfidf(t, d, D) / |d|
 *
 *    High-TF-IDF messages contain rare, distinctive terms and are more
 *    information-dense than generic conversation filler.
 *
 * 2. **TextRank for Message Importance** — Build a similarity graph between
 *    messages and run PageRank. Messages similar to many important messages
 *    are themselves important. This is the unsupervised analog of what a
 *    human would identify as "key messages" in a conversation.
 *
 *    The TextRank formulation:
 *
 *        TR(m_i) = (1-d) + d * SUM_{m_j: sim(i,j) > 0} (sim(i,j) / SUM_k sim(j,k)) * TR(m_j)
 *
 * 3. **MinHash Near-Duplicate Detection** — Generate 64 hash permutations per
 *    message. Jaccard similarity between messages is estimated by fraction of
 *    matching minhash values. Cluster near-duplicates (Jaccard > threshold)
 *    and keep only the best representative from each cluster.
 *
 *    Jaccard(A, B) ~ |{i: h_i(A) = h_i(B)}| / 64
 *
 * 4. **Shannon Surprisal** — For each message, compute information content:
 *
 *        surprisal(m) = -log2(P(m | context))
 *
 *    P(m|context) is approximated using a unigram language model from the
 *    conversation. High-surprisal messages carry novel information.
 *
 * 5. **CompactionMonitor** — Hooks into the agent loop with tiered triggers
 *    at 60%/75%/90% of context limit, applying progressively more aggressive
 *    compaction strategies.
 */

import type { AgentState, AgentMessage } from "./types.js";
import {
	estimatePartTokens,
	estimateTotalTokens,
	extractText,
	collapseToolDetails,
} from "./context-compaction.js";

// ─── TF-IDF Scoring ──────────────────────────────────────────────────────────

/**
 * Simple tokenizer for information-theoretic scoring.
 * Splits on whitespace and punctuation, lowercases, filters short tokens.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2);
}

/**
 * Compute TF-IDF importance scores for each message in a conversation.
 *
 * TF-IDF (Term Frequency - Inverse Document Frequency) measures how
 * distinctive each term is within a message relative to the corpus:
 *
 *     tf(t, d) = count(t in d) / |d|
 *     idf(t) = log(|D| / df(t))
 *     tfidf(t, d) = tf(t, d) * idf(t)
 *     score(d) = (1/|d|) * SUM_t tfidf(t, d, D)
 *
 * Messages with high TF-IDF scores contain rare, information-rich terms.
 * Generic conversation filler scores low and can be pruned.
 *
 * @param messages - Array of agent messages.
 * @returns Map from message ID to TF-IDF importance score.
 */
export function computeTfIdfScores(messages: AgentMessage[]): Map<string, number> {
	const scores = new Map<string, number>();
	const n = messages.length;
	if (n === 0) return scores;

	// Extract text from each message
	const docs: string[][] = messages.map((m) => tokenize(extractText(m.content)));

	// Compute document frequency (df) for each term
	const df = new Map<string, number>();
	for (const doc of docs) {
		const seen = new Set<string>();
		for (const term of doc) {
			if (!seen.has(term)) {
				df.set(term, (df.get(term) ?? 0) + 1);
				seen.add(term);
			}
		}
	}

	// Compute TF-IDF score per message
	for (let i = 0; i < n; i++) {
		const doc = docs[i];
		if (doc.length === 0) {
			scores.set(messages[i].id, 0);
			continue;
		}

		// Term frequency within this document
		const tf = new Map<string, number>();
		for (const term of doc) {
			tf.set(term, (tf.get(term) ?? 0) + 1);
		}

		let totalTfIdf = 0;
		for (const [term, count] of tf) {
			const termTf = count / doc.length;
			const termDf = df.get(term) ?? 1;
			const idf = Math.log(n / termDf);
			totalTfIdf += termTf * idf;
		}

		// Normalize by document length to avoid bias toward long messages
		scores.set(messages[i].id, totalTfIdf / doc.length);
	}

	return scores;
}

// ─── TextRank ────────────────────────────────────────────────────────────────

/**
 * Compute TextRank importance scores for messages.
 *
 * Builds a similarity graph between all pairs of messages using Jaccard
 * similarity on their token sets, then runs a PageRank-style iteration:
 *
 *   TR(i) = (1-d) + d * SUM_{j: sim(i,j)>0} [ sim(i,j) / SUM_k sim(j,k) ] * TR(j)
 *
 * where d = 0.85 (damping). Converges within ~30 iterations for typical
 * conversation lengths. Messages referenced by many other important messages
 * rank highest — a principled "importance by association" measure.
 *
 * @param messages - Array of agent messages.
 * @returns Map from message ID to TextRank score in [0, 1] (normalized).
 */
export function textRankMessages(messages: AgentMessage[]): Map<string, number> {
	const scores = new Map<string, number>();
	const n = messages.length;
	if (n === 0) return scores;
	if (n === 1) {
		scores.set(messages[0].id, 1);
		return scores;
	}

	// Extract token sets per message
	const tokenSets: Set<string>[] = messages.map((m) =>
		new Set(tokenize(extractText(m.content))),
	);

	// Build similarity matrix (Jaccard similarity)
	const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
	const outWeightSum: number[] = new Array(n).fill(0);

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const setA = tokenSets[i];
			const setB = tokenSets[j];
			if (setA.size === 0 || setB.size === 0) continue;

			let intersection = 0;
			for (const t of setA) {
				if (setB.has(t)) intersection++;
			}
			const union = setA.size + setB.size - intersection;
			const jaccard = union > 0 ? intersection / union : 0;

			sim[i][j] = jaccard;
			sim[j][i] = jaccard;
			outWeightSum[i] += jaccard;
			outWeightSum[j] += jaccard;
		}
	}

	// PageRank-style iteration
	const damping = 0.85;
	const ranks: number[] = new Array(n).fill(1 / n);
	const maxIter = 50;
	const epsilon = 1e-6;

	for (let iter = 0; iter < maxIter; iter++) {
		const newRanks: number[] = new Array(n);
		let maxDelta = 0;

		for (let i = 0; i < n; i++) {
			let weightedSum = 0;
			for (let j = 0; j < n; j++) {
				if (i === j || sim[j][i] === 0) continue;
				if (outWeightSum[j] > 0) {
					weightedSum += (sim[j][i] / outWeightSum[j]) * ranks[j];
				}
			}
			newRanks[i] = (1 - damping) / n + damping * weightedSum;
			const delta = Math.abs(newRanks[i] - ranks[i]);
			if (delta > maxDelta) maxDelta = delta;
		}

		for (let i = 0; i < n; i++) ranks[i] = newRanks[i];
		if (maxDelta < epsilon) break;
	}

	// Normalize to [0, 1]
	let maxRank = 0;
	for (let i = 0; i < n; i++) {
		if (ranks[i] > maxRank) maxRank = ranks[i];
	}
	if (maxRank === 0) maxRank = 1;

	for (let i = 0; i < n; i++) {
		scores.set(messages[i].id, ranks[i] / maxRank);
	}

	return scores;
}

// ─── MinHash Near-Duplicate Detection ────────────────────────────────────────

/** Number of hash permutations for MinHash signatures. */
const NUM_HASHES = 64;

/** Large prime for hash function family: h(x) = (a*x + b) mod p. */
const HASH_PRIME = 2147483647; // 2^31 - 1 (Mersenne prime)

/**
 * Pre-generate hash function coefficients for the MinHash family.
 * Each function is h_k(x) = ((a_k * x + b_k) mod p) mod tableSize.
 */
function generateHashCoefficients(): Array<{ a: number; b: number }> {
	const coeffs: Array<{ a: number; b: number }> = [];
	// Use deterministic coefficients for reproducibility
	let seed = 42;
	const nextSeed = (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	};

	for (let i = 0; i < NUM_HASHES; i++) {
		coeffs.push({
			a: (nextSeed() % (HASH_PRIME - 1)) + 1,
			b: nextSeed() % HASH_PRIME,
		});
	}
	return coeffs;
}

const HASH_COEFFS = generateHashCoefficients();

/** Compute a simple string -> integer hash. */
function stringHash(s: string): number {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
	}
	return hash >>> 0; // force unsigned
}

/**
 * Compute the MinHash signature for a token set.
 *
 * For each of 64 hash functions h_k, the MinHash value is:
 *
 *   sig_k(S) = min_{x in S} h_k(x)
 *
 * The probability that sig_k(A) = sig_k(B) equals the Jaccard similarity
 * J(A, B) = |A intersect B| / |A union B|, by the min-wise independence
 * property of random hash functions.
 *
 * @param tokens - Set of string tokens.
 * @returns Array of 64 MinHash values.
 */
function computeMinHash(tokens: Set<string>): Uint32Array {
	const sig = new Uint32Array(NUM_HASHES).fill(0xFFFFFFFF);

	for (const token of tokens) {
		const h = stringHash(token);
		for (let k = 0; k < NUM_HASHES; k++) {
			const { a, b } = HASH_COEFFS[k];
			const hashed = ((a * h + b) % HASH_PRIME) >>> 0;
			if (hashed < sig[k]) sig[k] = hashed;
		}
	}

	return sig;
}

/** Estimate Jaccard similarity from two MinHash signatures. */
function minhashJaccard(sigA: Uint32Array, sigB: Uint32Array): number {
	let matches = 0;
	for (let k = 0; k < NUM_HASHES; k++) {
		if (sigA[k] === sigB[k]) matches++;
	}
	return matches / NUM_HASHES;
}

/**
 * Detect near-duplicate messages using MinHash with 64 permutations.
 *
 * Groups messages into clusters where all pairs within a cluster have
 * estimated Jaccard similarity >= threshold. Uses a greedy single-linkage
 * approach: for each message, if it is sufficiently similar to any existing
 * cluster representative, it joins that cluster.
 *
 * Within each cluster, the "best" message is the one with the most unique
 * content (longest extracted text). Callers can keep just the best from
 * each cluster to deduplicate the conversation.
 *
 * @param messages - Array of agent messages.
 * @param threshold - Jaccard similarity threshold for dedup. Default: 0.6.
 * @returns Array of clusters (arrays of messages). Each cluster has >= 1 member.
 */
export function minHashDedup(
	messages: AgentMessage[],
	threshold: number = 0.6,
): AgentMessage[][] {
	if (messages.length === 0) return [];

	// Compute MinHash signatures
	const sigs: Uint32Array[] = messages.map((m) => {
		const tokens = new Set(tokenize(extractText(m.content)));
		return computeMinHash(tokens);
	});

	// Greedy clustering
	const clusters: Array<{ representative: number; members: number[] }> = [];
	const assigned = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		if (assigned.has(i)) continue;

		// Start a new cluster with message i
		const cluster = { representative: i, members: [i] };
		assigned.add(i);

		for (let j = i + 1; j < messages.length; j++) {
			if (assigned.has(j)) continue;
			const sim = minhashJaccard(sigs[i], sigs[j]);
			if (sim >= threshold) {
				cluster.members.push(j);
				assigned.add(j);
			}
		}

		clusters.push(cluster);
	}

	return clusters.map((c) => c.members.map((idx) => messages[idx]));
}

// ─── Shannon Surprisal ───────────────────────────────────────────────────────

/**
 * Compute Shannon surprisal for each message relative to the conversation's
 * unigram language model.
 *
 * The unigram model estimates P(token) from the entire conversation:
 *
 *     P(t) = count(t) / totalTokens
 *
 * Each message's surprisal is the average negative log-probability of its tokens:
 *
 *     surprisal(m) = -(1/|m|) * SUM_{t in m} log2(P(t))
 *
 * High-surprisal messages use rare vocabulary relative to the conversation norm,
 * indicating novel information content. Low-surprisal messages are predictable
 * and carry less new information.
 *
 * @param messages - Array of agent messages.
 * @returns Map from message ID to surprisal value (bits).
 */
export function shannonSurprisal(messages: AgentMessage[]): Map<string, number> {
	const surprisals = new Map<string, number>();
	if (messages.length === 0) return surprisals;

	// Build the global unigram model
	const globalCounts = new Map<string, number>();
	let totalTokenCount = 0;
	const docTokens: string[][] = [];

	for (const msg of messages) {
		const tokens = tokenize(extractText(msg.content));
		docTokens.push(tokens);
		for (const t of tokens) {
			globalCounts.set(t, (globalCounts.get(t) ?? 0) + 1);
			totalTokenCount++;
		}
	}

	if (totalTokenCount === 0) {
		for (const msg of messages) surprisals.set(msg.id, 0);
		return surprisals;
	}

	// Compute per-message surprisal with Laplace smoothing
	const vocabSize = globalCounts.size;

	for (let i = 0; i < messages.length; i++) {
		const tokens = docTokens[i];
		if (tokens.length === 0) {
			surprisals.set(messages[i].id, 0);
			continue;
		}

		let totalSurprisal = 0;
		for (const t of tokens) {
			// Laplace-smoothed probability
			const count = globalCounts.get(t) ?? 0;
			const prob = (count + 1) / (totalTokenCount + vocabSize);
			totalSurprisal += -Math.log2(prob);
		}

		surprisals.set(messages[i].id, totalSurprisal / tokens.length);
	}

	return surprisals;
}

// ─── CompactionMonitor ───────────────────────────────────────────────────────

/** Compaction tier thresholds as fractions of context limit. */
export interface CompactionThresholds {
	/** Gentle tier: collapse tool details only. Default: 0.60. */
	gentle: number;
	/** Moderate tier: MinHash dedup + TextRank pruning. Default: 0.75. */
	moderate: number;
	/** Aggressive tier: full informational rewrite. Default: 0.90. */
	aggressive: number;
}

const DEFAULT_THRESHOLDS: CompactionThresholds = {
	gentle: 0.60,
	moderate: 0.75,
	aggressive: 0.90,
};

/**
 * Monitor that hooks into the agent loop to trigger auto-compaction
 * at progressive tiers as context usage grows.
 *
 * Tier 1 (gentle, 60%): Collapse tool call arguments and results to
 *   short summaries. Preserves all message text.
 *
 * Tier 2 (moderate, 75%): Apply MinHash dedup to remove near-duplicate
 *   messages, then use TextRank to prune the least important remaining
 *   messages.
 *
 * Tier 3 (aggressive, 90%): Full informational compaction using TF-IDF,
 *   TextRank, surprisal, and MinHash to produce a maximally compressed
 *   yet information-preserving message sequence.
 *
 * The monitor is stateless between calls — each invocation evaluates the
 * current state independently.
 */
export class CompactionMonitor {
	private thresholds: CompactionThresholds;

	constructor(thresholds?: Partial<CompactionThresholds>) {
		this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
	}

	/**
	 * Set new compaction thresholds.
	 *
	 * @param thresholds - Partial threshold overrides.
	 */
	setThresholds(thresholds: Partial<CompactionThresholds>): void {
		this.thresholds = { ...this.thresholds, ...thresholds };
	}

	/**
	 * Check current context usage and apply compaction if needed.
	 *
	 * @param state - Current agent state (messages, tools, system prompt).
	 * @param contextLimit - Maximum context window in tokens.
	 * @returns The (possibly compacted) messages array and the tier applied.
	 */
	checkAndCompact(
		state: AgentState,
		contextLimit: number,
	): { messages: AgentMessage[]; tier: "none" | "gentle" | "moderate" | "aggressive" } {
		const currentTokens = estimateTotalTokens(state);
		const usage = currentTokens / contextLimit;

		if (usage < this.thresholds.gentle) {
			return { messages: state.messages, tier: "none" };
		}

		if (usage < this.thresholds.moderate) {
			// Tier 1: gentle — collapse tool details only
			return { messages: collapseToolDetails(state.messages), tier: "gentle" };
		}

		if (usage < this.thresholds.aggressive) {
			// Tier 2: moderate — dedup + TextRank pruning
			const deduped = deduplicateMessages(state.messages);
			const targetTokens = Math.floor(contextLimit * 0.5);
			const pruned = textRankPrune(deduped, targetTokens);
			return { messages: pruned, tier: "moderate" };
		}

		// Tier 3: aggressive — full informational compaction
		const targetTokens = Math.floor(contextLimit * 0.4);
		const compacted = informationalCompact(state.messages, targetTokens);
		return { messages: compacted, tier: "aggressive" };
	}
}

// ─── Deduplication Helper ────────────────────────────────────────────────────

/**
 * Remove near-duplicate messages, keeping the longest from each cluster.
 */
function deduplicateMessages(messages: AgentMessage[]): AgentMessage[] {
	const clusters = minHashDedup(messages, 0.6);
	const result: AgentMessage[] = [];

	for (const cluster of clusters) {
		// Keep the message with the most content
		let best = cluster[0];
		let bestLen = extractText(best.content).length;
		for (let i = 1; i < cluster.length; i++) {
			const len = extractText(cluster[i].content).length;
			if (len > bestLen) {
				best = cluster[i];
				bestLen = len;
			}
		}
		result.push(best);
	}

	// Sort by timestamp to maintain conversation order
	result.sort((a, b) => a.timestamp - b.timestamp);
	return result;
}

/**
 * Prune messages using TextRank scores to fit within a token budget.
 * Always keeps system messages and the most recent user message.
 */
function textRankPrune(messages: AgentMessage[], targetTokens: number): AgentMessage[] {
	if (messages.length <= 2) return messages;

	const trScores = textRankMessages(messages);

	// Always keep: system messages, the first message, the last 2 messages
	const keepIndices = new Set<number>();
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === "system") keepIndices.add(i);
	}
	keepIndices.add(0);
	keepIndices.add(messages.length - 1);
	if (messages.length > 1) keepIndices.add(messages.length - 2);

	// Sort remaining by TextRank score descending
	const candidates: Array<{ index: number; score: number }> = [];
	for (let i = 0; i < messages.length; i++) {
		if (!keepIndices.has(i)) {
			candidates.push({ index: i, score: trScores.get(messages[i].id) ?? 0 });
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	// Greedily add highest-TextRank messages until budget is met
	let currentTokens = 0;
	for (const idx of keepIndices) {
		currentTokens += estimatePartTokens(messages[idx].content);
	}

	for (const cand of candidates) {
		const cost = estimatePartTokens(messages[cand.index].content);
		if (currentTokens + cost <= targetTokens) {
			keepIndices.add(cand.index);
			currentTokens += cost;
		}
	}

	// Return in original order
	const kept = [...keepIndices].sort((a, b) => a - b);
	return kept.map((i) => messages[i]);
}

// ─── Full Informational Compaction ───────────────────────────────────────────

/**
 * Perform full information-theoretic compaction on a message array.
 *
 * Combines all four scoring algorithms to produce the most information-dense
 * subset of messages that fits within the target token budget:
 *
 * 1. Compute TF-IDF, TextRank, and Shannon surprisal scores
 * 2. Combine into a composite importance score:
 *        composite(m) = 0.30 * tfidf(m) + 0.35 * textrank(m) + 0.35 * surprisal(m)
 * 3. Remove near-duplicates via MinHash
 * 4. Collapse tool details in surviving messages
 * 5. Greedily select messages by composite score until budget is filled
 *
 * System messages and the most recent messages are always preserved.
 *
 * @param messages - Full message array.
 * @param targetTokens - Target token budget for the compacted result.
 * @returns Compacted array of messages fitting within the budget.
 */
export function informationalCompact(
	messages: AgentMessage[],
	targetTokens: number,
): AgentMessage[] {
	if (messages.length <= 3) return collapseToolDetails(messages);

	// Step 1: Compute all scores
	const tfidfScores = computeTfIdfScores(messages);
	const trScores = textRankMessages(messages);
	const surprisalScores = shannonSurprisal(messages);

	// Normalize each score set to [0, 1]
	const normalizedTfIdf = normalizeScores(tfidfScores);
	const normalizedTR = normalizeScores(trScores);
	const normalizedSurprisal = normalizeScores(surprisalScores);

	// Step 2: Compute composite score
	const composite = new Map<string, number>();
	for (const msg of messages) {
		const tfidf = normalizedTfIdf.get(msg.id) ?? 0;
		const tr = normalizedTR.get(msg.id) ?? 0;
		const surp = normalizedSurprisal.get(msg.id) ?? 0;
		composite.set(msg.id, 0.30 * tfidf + 0.35 * tr + 0.35 * surp);
	}

	// Step 3: Deduplicate — but always preserve the very last input message
	const lastOriginal = messages[messages.length - 1];
	let deduped = deduplicateMessages(messages);
	if (!deduped.some((m) => m.id === lastOriginal.id)) {
		deduped.push(lastOriginal);
		deduped.sort((a, b) => a.timestamp - b.timestamp);
	}

	// Step 4: Collapse tool details
	const collapsed = collapseToolDetails(deduped);

	// Step 5: Greedy selection by composite score
	const keepIndices = new Set<number>();
	// Always keep system messages, first, and last 2
	for (let i = 0; i < collapsed.length; i++) {
		if (collapsed[i].role === "system") keepIndices.add(i);
	}
	if (collapsed.length > 0) keepIndices.add(0);
	if (collapsed.length > 1) keepIndices.add(collapsed.length - 1);
	if (collapsed.length > 2) keepIndices.add(collapsed.length - 2);

	const candidates: Array<{ index: number; score: number }> = [];
	for (let i = 0; i < collapsed.length; i++) {
		if (!keepIndices.has(i)) {
			candidates.push({
				index: i,
				score: composite.get(collapsed[i].id) ?? 0,
			});
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	let currentTokens = 0;
	for (const idx of keepIndices) {
		currentTokens += estimatePartTokens(collapsed[idx].content);
	}

	for (const cand of candidates) {
		const cost = estimatePartTokens(collapsed[cand.index].content);
		if (currentTokens + cost <= targetTokens) {
			keepIndices.add(cand.index);
			currentTokens += cost;
		}
	}

	const kept = [...keepIndices].sort((a, b) => a - b);
	return kept.map((i) => collapsed[i]);
}

// ─── Score Normalization ─────────────────────────────────────────────────────

/**
 * Normalize a score map to [0, 1] range using min-max normalization.
 */
function normalizeScores(scores: Map<string, number>): Map<string, number> {
	const result = new Map<string, number>();
	if (scores.size === 0) return result;

	let min = Infinity;
	let max = -Infinity;
	for (const v of scores.values()) {
		if (v < min) min = v;
		if (v > max) max = v;
	}

	const range = max - min;
	if (range === 0) {
		for (const [k] of scores) result.set(k, 0.5);
		return result;
	}

	for (const [k, v] of scores) {
		result.set(k, (v - min) / range);
	}
	return result;
}
