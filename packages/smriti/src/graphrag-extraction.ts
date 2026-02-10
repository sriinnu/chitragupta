/**
 * @chitragupta/smriti — GraphRAG entity extraction and semantic chunking.
 *
 * LLM-based entity extraction (with keyword fallback) and sentence-boundary-aware
 * semantic chunking with token overlap.
 */

import { STOP_WORDS } from "./graphrag-scoring.js";

// ─── Entity Extraction Types ────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

// ─── Semantic Chunking Parameters ───────────────────────────────────────────

/** Target chunk size in approximate tokens (words). */
const CHUNK_TARGET_TOKENS = 350;
/** Minimum chunk size in tokens. */
const CHUNK_MIN_TOKENS = 200;
/** Maximum chunk size in tokens. */
const CHUNK_MAX_TOKENS = 500;
/** Overlap between consecutive chunks in tokens. */
const CHUNK_OVERLAP_TOKENS = 50;

// ─── Semantic Chunking ──────────────────────────────────────────────────────

/**
 * Split text into sentences using common sentence-ending punctuation.
 * Handles abbreviations and decimal numbers gracefully.
 */
function splitSentences(text: string): string[] {
  // Split on sentence boundaries: period, exclamation, or question mark
  // followed by whitespace and an uppercase letter (or end of string).
  // This avoids splitting on abbreviations like "e.g." or "Dr." in many cases.
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\s*$/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Estimate token count for a text string (approximation: 1 token ~ 1 word).
 *
 * NOTE: This intentionally uses word-based counting, unlike the char/4 heuristic
 * in graphrag-scoring.ts. The chunk size parameters (CHUNK_TARGET_TOKENS etc.)
 * are calibrated to word counts, so they must stay coupled.
 */
function estimateTokens(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Semantically chunk text into overlapping segments based on sentence boundaries.
 *
 * Strategy:
 * 1. Split text into sentences.
 * 2. Greedily accumulate sentences into a chunk until the target token count is reached.
 * 3. Start the next chunk with an overlap of ~CHUNK_OVERLAP_TOKENS from the previous chunk's tail.
 * 4. Each chunk respects sentence boundaries (no mid-sentence splits).
 *
 * Returns an array of { text, startSentence, endSentence } objects.
 */
export function semanticChunk(text: string): { text: string; startSentence: number; endSentence: number }[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  // If the entire text is small enough, return as a single chunk
  const totalTokens = estimateTokens(text);
  if (totalTokens <= CHUNK_MAX_TOKENS) {
    return [{ text, startSentence: 0, endSentence: sentences.length - 1 }];
  }

  const chunks: { text: string; startSentence: number; endSentence: number }[] = [];
  let startIdx = 0;

  while (startIdx < sentences.length) {
    let currentTokens = 0;
    let endIdx = startIdx;

    // Accumulate sentences until we reach the target
    while (endIdx < sentences.length && currentTokens < CHUNK_TARGET_TOKENS) {
      currentTokens += estimateTokens(sentences[endIdx]);
      endIdx++;
    }

    // Ensure minimum chunk size if possible
    if (currentTokens < CHUNK_MIN_TOKENS && endIdx < sentences.length) {
      while (endIdx < sentences.length && currentTokens < CHUNK_MIN_TOKENS) {
        currentTokens += estimateTokens(sentences[endIdx]);
        endIdx++;
      }
    }

    const chunkText = sentences.slice(startIdx, endIdx).join(" ");
    chunks.push({ text: chunkText, startSentence: startIdx, endSentence: endIdx - 1 });

    // Calculate overlap: walk back from the end to find where to start the next chunk
    let overlapTokens = 0;
    let overlapStart = endIdx;
    while (overlapStart > startIdx && overlapTokens < CHUNK_OVERLAP_TOKENS) {
      overlapStart--;
      overlapTokens += estimateTokens(sentences[overlapStart]);
    }

    // Next chunk starts at the overlap point
    startIdx = Math.max(overlapStart, startIdx + 1);

    // Safety: if we haven't advanced, force advance to prevent infinite loops
    if (startIdx >= endIdx) break;
  }

  return chunks;
}

// ─── LLM Entity Extraction ─────────────────────────────────────────────────

/**
 * Use Ollama /api/generate to extract entities from text via LLM.
 */
export async function llmExtractEntities(
  text: string,
  endpoint: string,
  generationModel: string,
): Promise<ExtractedEntity[]> {
  const truncated = text.slice(0, 4000); // Limit input size for LLM context
  const prompt = `Extract key entities, concepts, and topics from the following text. Return ONLY a valid JSON array of objects, each with "name" (string), "type" (one of: "person", "technology", "concept", "organization", "file", "tool", "decision", "topic"), and "description" (brief string). Do not include any text outside the JSON array.

Text:
${truncated}

JSON:`;

  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: generationModel,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Ollama generation error: ${response.status}`);
  }

  const data = (await response.json()) as { response: string };
  const responseText = data.response.trim();

  // Parse the JSON from the LLM response.
  // Try to extract a JSON array even if there's surrounding text.
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain a JSON array");
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown[];

  // Validate and normalize each entity
  const entities: ExtractedEntity[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      typeof (item as Record<string, unknown>).name === "string"
    ) {
      const obj = item as Record<string, unknown>;
      entities.push({
        name: String(obj.name).toLowerCase().trim(),
        type: typeof obj.type === "string" ? obj.type : "concept",
        description: typeof obj.description === "string" ? obj.description : "",
      });
    }
  }

  return entities;
}

/**
 * Fallback keyword-based entity extraction.
 * Extracts significant words that appear multiple times as concept entities.
 */
export function keywordExtractEntities(text: string): ExtractedEntity[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w));

  // Count word frequencies
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Return words that appear at least twice, sorted by frequency
  const entities: ExtractedEntity[] = [];
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  for (const [word, count] of sorted) {
    if (count < 2) break;
    if (entities.length >= 20) break; // Cap at 20 keywords

    entities.push({
      name: word,
      type: "concept",
      description: `Keyword appearing ${count} times`,
    });
  }

  return entities;
}
