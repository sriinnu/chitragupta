/**
 * @chitragupta/smriti — Recall scoring algorithms.
 *
 * Vector similarity, embedding generation, and text extraction helpers
 * used by the RecallEngine. Delegates embedding to EmbeddingService.
 */

import type { Session } from "./types.js";
import { EmbeddingService } from "./embedding-service.js";

// ─── Configuration ───────────────────────────────────────────────────────────

let _embeddingService = new EmbeddingService();

/**
 * Configure the recall scoring module.
 */
export function configureRecallScoring(options: {
  ollamaEndpoint?: string;
  embeddingModel?: string;
  embeddingService?: EmbeddingService;
}): void {
  if (options.embeddingService) {
    _embeddingService = options.embeddingService;
  }
}

// ─── Cosine Similarity ───────────────────────────────────────────────────────────

// Re-export from canonical location to avoid duplication
export { cosineSimilarity } from "./graphrag-scoring.js";

// ─── Embedding Helpers ───────────────────────────────────────────────────────

/**
 * Get an embedding vector for text. Delegates to the configured EmbeddingService.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  return _embeddingService.getEmbedding(text);
}

// ─── Text Summarization Helpers ──────────────────────────────────────────────

/**
 * Extract a summary snippet from session turns.
 */
export function summarizeSession(session: Session): string {
  const parts: string[] = [];
  for (const turn of session.turns) {
    if (turn.role === "user") {
      parts.push(turn.content.slice(0, 200));
    }
    if (parts.join(" ").length > 400) break;
  }
  return parts.join(" | ").slice(0, 500);
}

/**
 * Extract key points from a session as a text block for indexing.
 */
export function extractIndexText(session: Session): string {
  const parts: string[] = [];

  parts.push(session.meta.title);
  parts.push(session.meta.title);
  parts.push(session.meta.tags.join(" "));

  for (const turn of session.turns) {
    parts.push(turn.content.slice(0, 1000));

    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        parts.push(tc.name);
        parts.push(tc.input.slice(0, 200));
      }
    }
  }

  return parts.join("\n").slice(0, 8000);
}

/**
 * Reset the embedding provider availability cache.
 */
export function resetOllamaAvailability(): void {
  _embeddingService.resetAvailability();
}
