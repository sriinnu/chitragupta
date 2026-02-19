/**
 * @chitragupta/anina — Information-theoretic scoring algorithms.
 *
 * Pure functions for TF-IDF, TextRank, MinHash dedup, and Shannon
 * surprisal. Extracted from context-compaction-informational.ts.
 */

import type { AgentMessage } from "./types.js";
import { estimatePartTokens, extractText, collapseToolDetails } from "./context-compaction.js";

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/** Simple tokenizer: lowercase, strip punctuation, filter short tokens. */
function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
}

// ─── TF-IDF ─────────────────────────────────────────────────────────────────

/**
 * Compute TF-IDF importance scores for each message.
 *
 * Messages with high TF-IDF scores contain rare, information-rich terms.
 * Score(d) = (1/|d|) * SUM_t tf(t,d) * log(|D| / df(t))
 */
export function computeTfIdfScores(messages: AgentMessage[]): Map<string, number> {
	const scores = new Map<string, number>();
	const n = messages.length;
	if (n === 0) return scores;

	const docs: string[][] = messages.map((m) => tokenize(extractText(m.content)));

	const df = new Map<string, number>();
	for (const doc of docs) {
		const seen = new Set<string>();
		for (const term of doc) {
			if (!seen.has(term)) { df.set(term, (df.get(term) ?? 0) + 1); seen.add(term); }
		}
	}

	for (let i = 0; i < n; i++) {
		const doc = docs[i];
		if (doc.length === 0) { scores.set(messages[i].id, 0); continue; }
		const tf = new Map<string, number>();
		for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
		let totalTfIdf = 0;
		for (const [term, count] of tf) {
			totalTfIdf += (count / doc.length) * Math.log(n / (df.get(term) ?? 1));
		}
		scores.set(messages[i].id, totalTfIdf / doc.length);
	}
	return scores;
}

// ─── TextRank ───────────────────────────────────────────────────────────────

/**
 * Compute TextRank importance scores using PageRank on a Jaccard similarity graph.
 *
 * TR(i) = (1-d)/n + d * SUM_{j} [ sim(i,j) / outWeight(j) ] * TR(j)
 */
export function textRankMessages(messages: AgentMessage[]): Map<string, number> {
	const scores = new Map<string, number>();
	const n = messages.length;
	if (n === 0) return scores;
	if (n === 1) { scores.set(messages[0].id, 1); return scores; }

	const tokenSets: Set<string>[] = messages.map((m) => new Set(tokenize(extractText(m.content))));

	const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
	const outWeightSum: number[] = new Array(n).fill(0);

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const setA = tokenSets[i], setB = tokenSets[j];
			if (setA.size === 0 || setB.size === 0) continue;
			let intersection = 0;
			for (const t of setA) { if (setB.has(t)) intersection++; }
			const jaccard = intersection / (setA.size + setB.size - intersection);
			sim[i][j] = jaccard; sim[j][i] = jaccard;
			outWeightSum[i] += jaccard; outWeightSum[j] += jaccard;
		}
	}

	const damping = 0.85;
	const ranks: number[] = new Array(n).fill(1 / n);

	for (let iter = 0; iter < 50; iter++) {
		const newRanks: number[] = new Array(n);
		let maxDelta = 0;
		for (let i = 0; i < n; i++) {
			let ws = 0;
			for (let j = 0; j < n; j++) {
				if (i !== j && sim[j][i] > 0 && outWeightSum[j] > 0) {
					ws += (sim[j][i] / outWeightSum[j]) * ranks[j];
				}
			}
			newRanks[i] = (1 - damping) / n + damping * ws;
			const d = Math.abs(newRanks[i] - ranks[i]);
			if (d > maxDelta) maxDelta = d;
		}
		for (let i = 0; i < n; i++) ranks[i] = newRanks[i];
		if (maxDelta < 1e-6) break;
	}

	let maxRank = 0;
	for (let i = 0; i < n; i++) { if (ranks[i] > maxRank) maxRank = ranks[i]; }
	if (maxRank === 0) maxRank = 1;
	for (let i = 0; i < n; i++) scores.set(messages[i].id, ranks[i] / maxRank);
	return scores;
}

// ─── MinHash ────────────────────────────────────────────────────────────────

const NUM_HASHES = 64;
const HASH_PRIME = 2147483647;

function generateHashCoefficients(): Array<{ a: number; b: number }> {
	const coeffs: Array<{ a: number; b: number }> = [];
	let seed = 42;
	const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
	for (let i = 0; i < NUM_HASHES; i++) {
		coeffs.push({ a: (next() % (HASH_PRIME - 1)) + 1, b: next() % HASH_PRIME });
	}
	return coeffs;
}

const HASH_COEFFS = generateHashCoefficients();

function stringHash(s: string): number {
	let hash = 0;
	for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
	return hash >>> 0;
}

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

function minhashJaccard(sigA: Uint32Array, sigB: Uint32Array): number {
	let matches = 0;
	for (let k = 0; k < NUM_HASHES; k++) { if (sigA[k] === sigB[k]) matches++; }
	return matches / NUM_HASHES;
}

/**
 * Detect near-duplicate messages using MinHash with 64 permutations.
 * Groups messages into clusters where all pairs have Jaccard >= threshold.
 */
export function minHashDedup(messages: AgentMessage[], threshold: number = 0.6): AgentMessage[][] {
	if (messages.length === 0) return [];
	const sigs: Uint32Array[] = messages.map((m) => computeMinHash(new Set(tokenize(extractText(m.content)))));
	const clusters: Array<{ representative: number; members: number[] }> = [];
	const assigned = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		if (assigned.has(i)) continue;
		const cluster = { representative: i, members: [i] };
		assigned.add(i);
		for (let j = i + 1; j < messages.length; j++) {
			if (assigned.has(j)) continue;
			if (minhashJaccard(sigs[i], sigs[j]) >= threshold) {
				cluster.members.push(j); assigned.add(j);
			}
		}
		clusters.push(cluster);
	}
	return clusters.map((c) => c.members.map((idx) => messages[idx]));
}

// ─── Shannon Surprisal ──────────────────────────────────────────────────────

/**
 * Compute Shannon surprisal for each message relative to the conversation's
 * unigram language model. High-surprisal = novel information.
 */
export function shannonSurprisal(messages: AgentMessage[]): Map<string, number> {
	const surprisals = new Map<string, number>();
	if (messages.length === 0) return surprisals;

	const globalCounts = new Map<string, number>();
	let totalTokenCount = 0;
	const docTokens: string[][] = [];

	for (const msg of messages) {
		const tokens = tokenize(extractText(msg.content));
		docTokens.push(tokens);
		for (const t of tokens) { globalCounts.set(t, (globalCounts.get(t) ?? 0) + 1); totalTokenCount++; }
	}

	if (totalTokenCount === 0) {
		for (const msg of messages) surprisals.set(msg.id, 0);
		return surprisals;
	}

	const vocabSize = globalCounts.size;
	for (let i = 0; i < messages.length; i++) {
		const tokens = docTokens[i];
		if (tokens.length === 0) { surprisals.set(messages[i].id, 0); continue; }
		let total = 0;
		for (const t of tokens) {
			total += -Math.log2(((globalCounts.get(t) ?? 0) + 1) / (totalTokenCount + vocabSize));
		}
		surprisals.set(messages[i].id, total / tokens.length);
	}
	return surprisals;
}

// ─── Score Normalization ────────────────────────────────────────────────────

/** Normalize a score map to [0, 1] range using min-max normalization. */
export function normalizeScores(scores: Map<string, number>): Map<string, number> {
	const result = new Map<string, number>();
	if (scores.size === 0) return result;
	let min = Infinity, max = -Infinity;
	for (const v of scores.values()) { if (v < min) min = v; if (v > max) max = v; }
	const range = max - min;
	if (range === 0) { for (const [k] of scores) result.set(k, 0.5); return result; }
	for (const [k, v] of scores) result.set(k, (v - min) / range);
	return result;
}

// ─── Composite Helpers ──────────────────────────────────────────────────────

/** Remove near-duplicate messages, keeping the longest from each cluster. */
export function deduplicateMessages(messages: AgentMessage[]): AgentMessage[] {
	const clusters = minHashDedup(messages, 0.6);
	const result: AgentMessage[] = [];
	for (const cluster of clusters) {
		let best = cluster[0];
		let bestLen = extractText(best.content).length;
		for (let i = 1; i < cluster.length; i++) {
			const len = extractText(cluster[i].content).length;
			if (len > bestLen) { best = cluster[i]; bestLen = len; }
		}
		result.push(best);
	}
	result.sort((a, b) => a.timestamp - b.timestamp);
	return result;
}

/** Prune messages using TextRank scores to fit within a token budget. */
export function textRankPrune(messages: AgentMessage[], targetTokens: number): AgentMessage[] {
	if (messages.length <= 2) return messages;
	const trScores = textRankMessages(messages);

	const keepIndices = new Set<number>();
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === "system") keepIndices.add(i);
	}
	keepIndices.add(0);
	keepIndices.add(messages.length - 1);
	if (messages.length > 1) keepIndices.add(messages.length - 2);

	const candidates: Array<{ index: number; score: number }> = [];
	for (let i = 0; i < messages.length; i++) {
		if (!keepIndices.has(i)) candidates.push({ index: i, score: trScores.get(messages[i].id) ?? 0 });
	}
	candidates.sort((a, b) => b.score - a.score);

	let currentTokens = 0;
	for (const idx of keepIndices) currentTokens += estimatePartTokens(messages[idx].content);
	for (const cand of candidates) {
		const cost = estimatePartTokens(messages[cand.index].content);
		if (currentTokens + cost <= targetTokens) { keepIndices.add(cand.index); currentTokens += cost; }
	}

	return [...keepIndices].sort((a, b) => a - b).map((i) => messages[i]);
}

/**
 * Full information-theoretic compaction. Combines TF-IDF, TextRank,
 * surprisal, and MinHash to produce a maximally compressed yet
 * information-preserving message sequence within the target token budget.
 */
export function informationalCompact(messages: AgentMessage[], targetTokens: number): AgentMessage[] {
	if (messages.length <= 3) return collapseToolDetails(messages);

	const tfidfScores = computeTfIdfScores(messages);
	const trScores = textRankMessages(messages);
	const surprisalScores = shannonSurprisal(messages);

	const nTfIdf = normalizeScores(tfidfScores);
	const nTR = normalizeScores(trScores);
	const nSurp = normalizeScores(surprisalScores);

	const composite = new Map<string, number>();
	for (const msg of messages) {
		composite.set(msg.id, 0.30 * (nTfIdf.get(msg.id) ?? 0) + 0.35 * (nTR.get(msg.id) ?? 0) + 0.35 * (nSurp.get(msg.id) ?? 0));
	}

	const lastOriginal = messages[messages.length - 1];
	let deduped = deduplicateMessages(messages);
	if (!deduped.some((m) => m.id === lastOriginal.id)) {
		deduped.push(lastOriginal);
		deduped.sort((a, b) => a.timestamp - b.timestamp);
	}

	const collapsed = collapseToolDetails(deduped);

	const keepIndices = new Set<number>();
	for (let i = 0; i < collapsed.length; i++) {
		if (collapsed[i].role === "system") keepIndices.add(i);
	}
	if (collapsed.length > 0) keepIndices.add(0);
	if (collapsed.length > 1) keepIndices.add(collapsed.length - 1);
	if (collapsed.length > 2) keepIndices.add(collapsed.length - 2);

	const candidates: Array<{ index: number; score: number }> = [];
	for (let i = 0; i < collapsed.length; i++) {
		if (!keepIndices.has(i)) candidates.push({ index: i, score: composite.get(collapsed[i].id) ?? 0 });
	}
	candidates.sort((a, b) => b.score - a.score);

	let currentTokens = 0;
	for (const idx of keepIndices) currentTokens += estimatePartTokens(collapsed[idx].content);
	for (const cand of candidates) {
		const cost = estimatePartTokens(collapsed[cand.index].content);
		if (currentTokens + cost <= targetTokens) { keepIndices.add(cand.index); currentTokens += cost; }
	}

	return [...keepIndices].sort((a, b) => a - b).map((i) => collapsed[i]);
}
