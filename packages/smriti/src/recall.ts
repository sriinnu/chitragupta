/**
 * @chitragupta/smriti — RecallEngine.
 *
 * Vector search across ALL sessions and memory streams.
 * "What did we discuss about X?" -> embed query -> search index -> return ranked results.
 *
 * Design principles:
 *   - Recall, not routing. User asks a question, we search EVERYTHING.
 *   - Vector stores are indexes, not storage. The .md files are the source of truth.
 *   - Embeddings mirror the .md files; they can be rebuilt at any time.
 *
 * Uses Ollama nomic-embed-text for embeddings, with a hash-based fallback
 * when Ollama is unavailable (reusing the approach from graphrag.ts).
 *
 * Persistence layer: SQLite vectors.db (embeddings table).
 * In-memory array is the working copy; SQLite is the durable store.
 * Falls back to JSON embeddings.json if SQLite is unavailable.
 */

import fs from "fs";
import { DatabaseManager } from "./db/database.js";
import { initVectorsSchema } from "./db/schema.js";
import type {
  Session,
  RecallOptions,
  RecallResult,
  StreamType,
} from "./types.js";
import { listSessions, loadSession } from "./session-store.js";
import { StreamManager, STREAM_ORDER } from "./streams.js";
import {
  cosineSimilarity,
  getEmbedding,
  summarizeSession,
  extractIndexText,
  resetOllamaAvailability,
} from "./recall-scoring.js";
import {
  DEFAULT_TOP_K,
  DEFAULT_THRESHOLD,
  getIndexDir,
  getEmbeddingsPath,
  vectorToBlob,
  blobToVector,
} from "./recall-storage.js";
import type { EmbeddingRow, EmbeddingEntry } from "./recall-storage.js";

// Re-export public symbols from recall-storage so index.ts needs no changes
export { vectorToBlob, blobToVector } from "./recall-storage.js";
export { migrateEmbeddingsJson } from "./recall-storage.js";

// ─── DB Init Flag ────────────────────────────────────────────────────────────

let _dbInitialized = false;

/**
 * Reset the DB initialization flag (for testing).
 */
export function _resetRecallDbInit(): void {
  _dbInitialized = false;
}

// ─── RecallEngine ────────────────────────────────────────────────────────────

/**
 * Vector search across all sessions and memory streams.
 *
 * Usage:
 *   const engine = new RecallEngine();
 *   const results = await engine.recall("what did we decide about the database?");
 */
export class RecallEngine {
  private entries: EmbeddingEntry[] = [];
  private loaded: boolean = false;

  constructor() {
    this.loadIndex();
  }

  // ─── SQLite Access ────────────────────────────────────────────────

  private getVectorsDb() {
    const dbm = DatabaseManager.instance();
    if (!_dbInitialized) {
      try {
        initVectorsSchema(dbm);
        _dbInitialized = true;
      } catch (err) {
        process.stderr.write(`[chitragupta] vectors DB schema init failed: ${err instanceof Error ? err.message : err}\n`);
        throw err;
      }
    }
    return dbm.get("vectors");
  }

  // ─── Index Management ────────────────────────────────────────────

  private loadIndex(): void {
    try {
      const db = this.getVectorsDb();
      const rows = db.prepare("SELECT * FROM embeddings").all() as EmbeddingRow[];
      this.entries = rows.map((row) => {
        let metadata: { title?: string; summary?: string; tags?: string[]; date?: string; deviceId?: string } = {};
        try { metadata = JSON.parse(row.metadata ?? "{}"); } catch { /* corrupted metadata */ }
        return {
          id: row.id,
          vector: blobToVector(row.vector),
          source: row.source_type as "session" | "stream",
          sourceId: row.source_id,
          title: metadata.title ?? "",
          text: row.text,
          summary: metadata.summary ?? "",
          tags: metadata.tags ?? [],
          date: metadata.date ?? new Date(row.created_at).toISOString(),
          deviceId: metadata.deviceId,
        };
      });
    } catch {
      // SQLite unavailable — try JSON fallback for migration
      this.loadIndexJson();
    }
    this.loaded = true;
  }

  private saveIndex(): void {
    try {
      const db = this.getVectorsDb();
      const txn = db.transaction(() => {
        db.prepare("DELETE FROM embeddings").run();

        const insert = db.prepare(`
          INSERT INTO embeddings (id, vector, text, source_type, source_id, dimensions, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const entry of this.entries) {
          insert.run(
            entry.id,
            vectorToBlob(entry.vector),
            entry.text,
            entry.source,
            entry.sourceId,
            entry.vector.length,
            JSON.stringify({
              title: entry.title,
              summary: entry.summary,
              tags: entry.tags,
              date: entry.date,
              deviceId: entry.deviceId,
            }),
            new Date(entry.date).getTime(),
          );
        }
      });
      txn();
    } catch {
      // Non-fatal: try JSON fallback
      this.saveIndexJson();
    }
  }

  // ─── JSON Fallback (legacy) ────────────────────────────────────────

  private loadIndexJson(): void {
    try {
      const indexPath = getEmbeddingsPath();
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf-8");
        this.entries = JSON.parse(raw) as EmbeddingEntry[];
      }
    } catch {
      this.entries = [];
    }
  }

  private saveIndexJson(): void {
    try {
      const dir = getIndexDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        getEmbeddingsPath(),
        JSON.stringify(this.entries, null, "\t"),
        "utf-8",
      );
    } catch {
      // Non-fatal
    }
  }

  // ─── Session Indexing ────────────────────────────────────────────

  /** Index a session's turns into the embedding store. */
  async indexSession(session: Session): Promise<void> {
    if (!this.loaded) this.loadIndex();

    this.entries = this.entries.filter(
      (e) => !(e.source === "session" && e.sourceId === session.meta.id),
    );

    const indexText = extractIndexText(session);
    const summary = summarizeSession(session);

    const chunkSize = 4000;
    const chunks: string[] = [];

    if (indexText.length <= chunkSize) {
      chunks.push(indexText);
    } else {
      for (let i = 0; i < indexText.length; i += chunkSize - 500) {
        chunks.push(indexText.slice(i, i + chunkSize));
        if (i + chunkSize >= indexText.length) break;
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      const vector = await getEmbedding(chunks[i]);

      this.entries.push({
        id: chunks.length > 1 ? `${session.meta.id}-chunk-${i}` : session.meta.id,
        vector,
        source: "session",
        sourceId: session.meta.id,
        title: session.meta.title,
        text: chunks[i],
        summary,
        tags: session.meta.tags,
        date: session.meta.updated,
      });
    }

    this.saveIndex();
  }

  /** Index a memory stream into the embedding store. */
  async indexStream(streamType: StreamType, content: string, deviceId?: string): Promise<void> {
    if (!this.loaded) this.loadIndex();

    const sourceId = deviceId ? `stream-${streamType}-${deviceId}` : `stream-${streamType}`;

    this.entries = this.entries.filter(
      (e) => !(e.source === "stream" && e.sourceId === sourceId),
    );

    if (!content || content.trim().length === 0) return;

    const vector = await getEmbedding(content.slice(0, 8000));

    this.entries.push({
      id: sourceId,
      vector,
      source: "stream",
      sourceId,
      title: `${streamType} stream${deviceId ? ` (${deviceId})` : ""}`,
      text: content.slice(0, 4000),
      summary: content.slice(0, 300),
      tags: [streamType],
      date: new Date().toISOString(),
      deviceId,
    });

    this.saveIndex();
  }

  // ─── Recall (Search) ─────────────────────────────────────────────

  /** Search all indexed embeddings for the given query string. */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult[]> {
    if (!this.loaded) this.loadIndex();
    if (this.entries.length === 0) return [];

    const topK = options?.topK ?? DEFAULT_TOP_K;
    const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

    const queryVector = await getEmbedding(query);

    const scored: { entry: EmbeddingEntry; score: number }[] = [];

    for (const entry of this.entries) {
      if (options?.deviceFilter && entry.deviceId !== options.deviceFilter) continue;

      if (options?.dateRange) {
        const entryDate = new Date(entry.date).getTime();
        const rangeStart = new Date(options.dateRange[0]).getTime();
        const rangeEnd = new Date(options.dateRange[1]).getTime();
        if (entryDate < rangeStart || entryDate > rangeEnd) continue;
      }

      if (options?.tagFilter && options.tagFilter.length > 0) {
        const hasTag = options.tagFilter.some((tag) => entry.tags.includes(tag));
        if (!hasTag) continue;
      }

      const score = cosineSimilarity(queryVector, entry.vector);
      if (score >= threshold) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const results: RecallResult[] = [];

    for (const { entry, score } of scored) {
      if (results.length >= topK) break;
      if (seen.has(entry.sourceId)) continue;
      seen.add(entry.sourceId);

      results.push({
        sessionId: entry.sourceId,
        title: entry.title,
        relevance: Math.max(0, Math.min(1, score)),
        summary: entry.summary,
        source: entry.source,
        matchedContent: entry.text.slice(0, 1000),
      });
    }

    return results;
  }

  // ─── Re-index ────────────────────────────────────────────────────

  /** Re-index all sessions and streams from scratch. */
  async reindexAll(): Promise<void> {
    this.entries = [];

    const allMetas = listSessions();
    for (const meta of allMetas) {
      try {
        const session = loadSession(meta.id, meta.project);
        await this.indexSession(session);
      } catch {
        // Skip sessions that fail to load
      }
    }

    const streamManager = new StreamManager();
    for (const streamType of STREAM_ORDER) {
      if (streamType === "flow") {
        const devices = streamManager.listFlowDevices();
        for (const device of devices) {
          const content = streamManager.readContent("flow", device);
          if (content) {
            await this.indexStream("flow", content, device);
          }
        }
      } else {
        const content = streamManager.readContent(streamType);
        if (content) {
          await this.indexStream(streamType, content);
        }
      }
    }

    this.saveIndex();
  }

  /** Return the number of entries in the in-memory index. */
  getIndexSize(): number {
    return this.entries.length;
  }

  /** Reset the embedding provider availability cache. */
  resetOllamaAvailability(): void {
    resetOllamaAvailability();
  }
}
