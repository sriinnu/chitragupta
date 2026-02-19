/**
 * @chitragupta/smriti — Recall storage helpers.
 *
 * Vector serialization, legacy JSON persistence, path resolution,
 * and JSON-to-SQLite migration for the recall embedding index.
 *
 * Extracted from recall.ts to keep each module under 450 LOC.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import { DatabaseManager } from "./db/database.js";
import { initVectorsSchema } from "./db/schema.js";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Default top-K results returned by recall queries. */
export const DEFAULT_TOP_K = 10;

/** Default cosine similarity threshold for recall matches. */
export const DEFAULT_THRESHOLD = 0.3;

// ─── SQLite Row Types ────────────────────────────────────────────────────────

/** Shape of a row returned from the `embeddings` table. */
export interface EmbeddingRow {
  id: string;
  vector: Buffer;
  source_type: string;
  source_id: string;
  text: string;
  metadata: string | null;
  created_at: string;
}

// ─── Embedding Index Entry ───────────────────────────────────────────────────

/** In-memory representation of an indexed embedding entry. */
export interface EmbeddingEntry {
  id: string;
  vector: number[];
  source: "session" | "stream";
  sourceId: string;
  title: string;
  text: string;
  summary: string;
  tags: string[];
  date: string;
  deviceId?: string;
}

// ─── Path Helpers ────────────────────────────────────────────────────────────

/**
 * Return the directory path for the recall index files.
 * Resolves to `~/.chitragupta/smriti/index`.
 */
export function getIndexDir(): string {
  return path.join(getChitraguptaHome(), "smriti", "index");
}

/**
 * Return the file path for the legacy JSON embeddings store.
 * Resolves to `~/.chitragupta/smriti/index/embeddings.json`.
 */
export function getEmbeddingsPath(): string {
  return path.join(getIndexDir(), "embeddings.json");
}

// ─── Vector Serialization ───────────────────────────────────────────────────

/**
 * Convert a number[] vector to a binary BLOB for SQLite storage.
 * Uses Float32Array for compact, lossless representation.
 */
export function vectorToBlob(vector: number[]): Buffer {
  const float32 = new Float32Array(vector);
  return Buffer.from(float32.buffer);
}

/**
 * Convert a binary BLOB back to a number[] vector.
 * Reconstructs the Float32Array from the raw buffer.
 */
export function blobToVector(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / 4,
  );
  return Array.from(float32);
}

// ─── Migration: JSON -> SQLite ───────────────────────────────────────────────

/**
 * Migrate embeddings from the legacy JSON file (embeddings.json) to SQLite vectors.db.
 *
 * - Reads from ~/.chitragupta/smriti/index/embeddings.json
 * - Inserts all entries into the embeddings table in vectors.db
 * - Renames the JSON file to embeddings.json.bak on success
 * - Returns the count of migrated and skipped entries
 *
 * Safe to call multiple times: skips if JSON file does not exist.
 */
export function migrateEmbeddingsJson(): { migrated: number; skipped: number } {
  const jsonPath = getEmbeddingsPath();

  if (!fs.existsSync(jsonPath)) {
    return { migrated: 0, skipped: 0 };
  }

  let entries: EmbeddingEntry[];
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    entries = JSON.parse(raw) as EmbeddingEntry[];
  } catch {
    return { migrated: 0, skipped: 0 };
  }

  if (!entries || entries.length === 0) {
    return { migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;

  try {
    const dbm = DatabaseManager.instance();
    initVectorsSchema(dbm);
    const db = dbm.get("vectors");

    const txn = db.transaction(() => {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO embeddings (id, vector, text, source_type, source_id, dimensions, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const entry of entries) {
        try {
          const result = insert.run(
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
          if (result.changes > 0) {
            migrated++;
          } else {
            skipped++;
          }
        } catch {
          skipped++;
        }
      }
    });
    txn();

    // Rename JSON file to .bak on success
    try {
      fs.renameSync(jsonPath, jsonPath + ".bak");
    } catch {
      // Non-fatal: file may be locked or read-only
    }
  } catch {
    return { migrated: 0, skipped: entries.length };
  }

  return { migrated, skipped };
}
