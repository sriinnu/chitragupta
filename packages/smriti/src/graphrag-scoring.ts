/**
 * @chitragupta/smriti — GraphRAG scoring utilities.
 *
 * Hybrid scoring: cosine similarity, BM25-lite text matching, and token utilities
 * used by the main GraphRAGEngine search pipeline.
 */

// ─── Hybrid Scoring Weights ─────────────────────────────────────────────────

/** Weight for cosine similarity in hybrid score. */
export const ALPHA = 0.6;
/** Weight for PageRank score in hybrid score. */
export const BETA = 0.25;
/** Weight for text match (BM25-lite) score in hybrid score. */
export const GAMMA = 0.15;

// ─── Stop Words ──────────────────────────────────────────────────────────────

/**
 * Simple stop words for text match scoring.
 */
export const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "was",
  "are", "be", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "not", "no",
]);

// ─── Cosine Similarity ──────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─── Token Estimation ──────────────────────────────────────────────────────────

/**
 * Estimate token count from text length.
 * Uses the common ~4 characters per token heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Text Match Scoring (BM25-lite) ─────────────────────────────────────────

/**
 * Tokenize text for text match scoring.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Compute a simple text-match score between a query and document text.
 * Uses term overlap with logarithmic TF saturation and query coverage bonus.
 * Returns a value normalized to roughly 0-1 range.
 */
export function textMatchScore(query: string, docText: string): number {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(docText);

  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  // Build document term frequency map
  const docTf = new Map<string, number>();
  for (const token of docTokens) {
    docTf.set(token, (docTf.get(token) ?? 0) + 1);
  }

  let score = 0;
  let matchedTerms = 0;

  for (const qTerm of queryTokens) {
    const tf = docTf.get(qTerm) ?? 0;
    if (tf > 0) {
      // Logarithmic saturation of term frequency
      score += 1 + Math.log(1 + tf);
      matchedTerms++;
    }
  }

  // Query coverage bonus: proportion of query terms found
  const coverage = matchedTerms / queryTokens.length;
  score *= (0.5 + 0.5 * coverage);

  // Normalize by query length to keep score in a reasonable range
  score /= queryTokens.length;

  // Clamp to 0-1
  return Math.min(score, 1);
}
