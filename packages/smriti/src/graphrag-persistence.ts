/**
 * @chitragupta/smriti — GraphRAG persistence layer.
 *
 * Standalone functions for SQLite and JSON persistence of the knowledge graph,
 * PageRank scores, embeddings cache, and pramana lookups. Extracted from the
 * GraphRAGEngine class to keep each module under 450 LOC.
 *
 * Persistence strategy:
 *   Primary:  SQLite graph.db (Phase 0.5)
 *   Fallback: JSON files (graph.json, pagerank.json, embeddings.json)
 *   Migration: JSON -> SQLite on first load when SQLite is empty
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type BetterSqlite3 from "better-sqlite3";
import type { GraphNode, GraphEdge, KnowledgeGraph, PramanaType } from "./types.js";
import { DatabaseManager } from "./db/database.js";
import { initGraphSchema } from "./db/schema.js";

// ─── Storage Paths ──────────────────────────────────────────────────────────

/** @returns Directory path for GraphRAG JSON fallback files. */
export function getGraphDir(): string {
  return path.join(getChitraguptaHome(), "graphrag");
}

/** @returns File path for the legacy graph.json file. */
export function getGraphPath(): string {
  return path.join(getGraphDir(), "graph.json");
}

/** @returns File path for the legacy embeddings.json file. */
export function getEmbeddingsPath(): string {
  return path.join(getGraphDir(), "embeddings.json");
}

/** @returns File path for the legacy pagerank.json file. */
export function getPageRankPath(): string {
  return path.join(getGraphDir(), "pagerank.json");
}

// ─── SQLite Schema Access ───────────────────────────────────────────────────

/**
 * Get the graph database handle, initializing the schema on first access.
 * @returns The graph database handle, or null if unavailable.
 */
export function getGraphDb(
  initialized: boolean,
  markInitialized: () => void,
): BetterSqlite3.Database | null {
  try {
    const dbm = DatabaseManager.instance();
    if (!initialized) {
      initGraphSchema(dbm);
      markInitialized();
    }
    return dbm.get("graph");
  } catch {
    return null;
  }
}

// ─── SQLite Row Helpers ─────────────────────────────────────────────────────

/** Insert or replace a node in the SQLite nodes table. */
export function upsertNodeToDb(db: BetterSqlite3.Database, node: GraphNode): void {
  db.prepare(`
    INSERT OR REPLACE INTO nodes (id, type, label, content, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(node.id, node.type, node.label, node.content, JSON.stringify(node.metadata), Date.now(), Date.now());
}

/** Insert an edge into the SQLite edges table (bi-temporal fields mapped). */
export function insertEdgeToDb(db: BetterSqlite3.Database, edge: GraphEdge): void {
  db.prepare(`
    INSERT OR IGNORE INTO edges (source, target, relationship, weight, pramana, viveka,
      valid_from, valid_until, recorded_at, superseded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.source, edge.target, edge.relationship, edge.weight,
    null, null,
    edge.validFrom ? new Date(edge.validFrom).getTime() : Date.now(),
    edge.validUntil ? new Date(edge.validUntil).getTime() : null,
    edge.recordedAt ? new Date(edge.recordedAt).getTime() : Date.now(),
    edge.supersededAt ? new Date(edge.supersededAt).getTime() : null,
  );
}

// ─── SQLite Persistence ─────────────────────────────────────────────────────

/**
 * Save graph data (nodes, edges, pagerank) to SQLite. Clears existing data
 * and re-inserts everything in a transaction. Embeddings saved as JSON.
 */
export function saveToSqlite(
  db: BetterSqlite3.Database,
  graph: KnowledgeGraph,
  pageRankScores: Map<string, number>,
  embeddingCache: Map<string, number[]>,
): void {
  db.transaction(() => {
    db.prepare("DELETE FROM pagerank").run();
    db.prepare("DELETE FROM edges").run();
    db.prepare("DELETE FROM nodes").run();
    for (const node of graph.nodes) upsertNodeToDb(db, node);
    for (const edge of graph.edges) insertEdgeToDb(db, edge);
    for (const [nodeId, score] of pageRankScores) {
      db.prepare("INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)").run(nodeId, score, Date.now());
    }
  })();
  saveEmbeddingsJson(embeddingCache);
}

/**
 * Load graph data (nodes, edges, pagerank) from SQLite.
 * @returns Object with graph and pageRankScores, or null if empty.
 */
export function loadFromSqlite(
  db: BetterSqlite3.Database,
): { graph: KnowledgeGraph; pageRankScores: Map<string, number> } | null {
  const nodeCount = (db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number }).cnt;
  if (nodeCount === 0) return null;

  const nodeRows = db.prepare("SELECT * FROM nodes").all() as Array<Record<string, unknown>>;
  const nodes: GraphNode[] = nodeRows.map((row) => ({
    id: row.id as string,
    type: row.type as GraphNode["type"],
    label: row.label as string,
    content: (row.content as string) ?? "",
    metadata: (() => { try { return JSON.parse((row.metadata as string) ?? "{}"); } catch { return {}; } })(),
  }));

  const edgeRows = db.prepare("SELECT * FROM edges").all() as Array<Record<string, unknown>>;
  const edges: GraphEdge[] = edgeRows.map((row) => ({
    source: row.source as string,
    target: row.target as string,
    relationship: row.relationship as string,
    weight: row.weight as number,
    validFrom: row.valid_from ? new Date(row.valid_from as number).toISOString() : undefined,
    validUntil: row.valid_until ? new Date(row.valid_until as number).toISOString() : undefined,
    recordedAt: row.recorded_at ? new Date(row.recorded_at as number).toISOString() : undefined,
    supersededAt: row.superseded_at ? new Date(row.superseded_at as number).toISOString() : undefined,
  }));

  const pageRankScores = new Map<string, number>();
  const prRows = db.prepare("SELECT * FROM pagerank").all() as Array<Record<string, unknown>>;
  for (const row of prRows) {
    pageRankScores.set(row.node_id as string, row.score as number);
  }

  return { graph: { nodes, edges }, pageRankScores };
}

/**
 * Migrate in-memory graph data into SQLite. Used when SQLite is empty
 * but JSON data was loaded into memory.
 */
export function migrateInMemoryToSqlite(
  db: BetterSqlite3.Database,
  graph: KnowledgeGraph,
  pageRankScores: Map<string, number>,
): void {
  db.transaction(() => {
    for (const node of graph.nodes) upsertNodeToDb(db, node);
    for (const edge of graph.edges) insertEdgeToDb(db, edge);
    for (const [nodeId, score] of pageRankScores) {
      db.prepare("INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)").run(nodeId, score, Date.now());
    }
  })();
}

// ─── JSON Fallback Persistence ──────────────────────────────────────────────

/** Save graph and pagerank to JSON files (legacy fallback). */
export function saveToJson(
  graph: KnowledgeGraph,
  pageRankScores: Map<string, number>,
  embeddingCache: Map<string, number[]>,
): void {
  try {
    const dir = getGraphDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getGraphPath(), JSON.stringify(graph, null, "\t"), "utf-8");
    saveEmbeddingsJson(embeddingCache);
    const pageRankObj: Record<string, number> = {};
    for (const [key, value] of pageRankScores) pageRankObj[key] = value;
    fs.writeFileSync(getPageRankPath(), JSON.stringify(pageRankObj, null, "\t"), "utf-8");
  } catch {
    // Non-fatal: graph persistence failure does not affect in-memory operation
  }
}

/** Load graph and pagerank from JSON files (legacy fallback). */
export function loadFromJson(): { graph: KnowledgeGraph; pageRankScores: Map<string, number> } {
  let graph: KnowledgeGraph = { nodes: [], edges: [] };
  const pageRankScores = new Map<string, number>();

  try {
    const graphPath = getGraphPath();
    if (fs.existsSync(graphPath)) {
      graph = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as KnowledgeGraph;
    }
  } catch {
    graph = { nodes: [], edges: [] };
  }

  try {
    const prPath = getPageRankPath();
    if (fs.existsSync(prPath)) {
      const ranks = JSON.parse(fs.readFileSync(prPath, "utf-8")) as Record<string, number>;
      for (const [key, value] of Object.entries(ranks)) pageRankScores.set(key, value);
    }
  } catch {
    // Corrupted PageRank cache — will be re-computed on next query
  }

  return { graph, pageRankScores };
}

// ─── Embeddings JSON ────────────────────────────────────────────────────────

/** Save embedding cache to JSON file. */
export function saveEmbeddingsJson(embeddingCache: Map<string, number[]>): void {
  try {
    const dir = getGraphDir();
    fs.mkdirSync(dir, { recursive: true });
    const embeddings: Record<string, number[]> = {};
    for (const [key, value] of embeddingCache) embeddings[key] = value;
    fs.writeFileSync(getEmbeddingsPath(), JSON.stringify(embeddings, null, "\t"), "utf-8");
  } catch {
    // Non-fatal
  }
}

/** Load embedding cache from JSON file, trimming to maxCacheSize. */
export function loadEmbeddingsJson(maxCacheSize: number): Map<string, number[]> {
  const cache = new Map<string, number[]>();
  try {
    const embPath = getEmbeddingsPath();
    if (fs.existsSync(embPath)) {
      const embeddings = JSON.parse(fs.readFileSync(embPath, "utf-8")) as Record<string, number[]>;
      for (const [key, value] of Object.entries(embeddings)) cache.set(key, value);
      while (cache.size > maxCacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
  } catch {
    // Corrupted embeddings cache — will be re-computed on demand
  }
  return cache;
}

// ─── Pramana Lookups ────────────────────────────────────────────────────────

/**
 * Look up the dominant pramana type for a given node ID.
 * Falls back to 'shabda' if no pramana data is found.
 */
export function lookupPramana(db: BetterSqlite3.Database | null, nodeId: string): PramanaType {
  if (!db) return "shabda";
  try {
    const row = db.prepare(`
      SELECT pramana, COUNT(*) as cnt FROM edges
      WHERE (source = ? OR target = ?) AND pramana IS NOT NULL
      GROUP BY pramana ORDER BY cnt DESC LIMIT 1
    `).get(nodeId, nodeId) as { pramana: string; cnt: number } | undefined;
    if (row?.pramana) return row.pramana as PramanaType;
  } catch {
    // Database unavailable or query error
  }
  return "shabda";
}

/**
 * Batch look up pramana types for multiple node IDs.
 * More efficient than calling lookupPramana() individually.
 */
export function lookupPramanaBatch(
  db: BetterSqlite3.Database | null,
  nodeIds: string[],
): Map<string, PramanaType> {
  const result = new Map<string, PramanaType>();
  if (nodeIds.length === 0) return result;

  if (!db) {
    for (const id of nodeIds) result.set(id, "shabda");
    return result;
  }

  try {
    const placeholders = nodeIds.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT node_id, pramana FROM (
        SELECT source AS node_id, pramana, COUNT(*) AS cnt FROM edges
        WHERE source IN (${placeholders}) AND pramana IS NOT NULL
        GROUP BY source, pramana
        UNION ALL
        SELECT target AS node_id, pramana, COUNT(*) AS cnt FROM edges
        WHERE target IN (${placeholders}) AND pramana IS NOT NULL
        GROUP BY target, pramana
      ) GROUP BY node_id HAVING cnt = MAX(cnt)
    `).all(...nodeIds, ...nodeIds) as Array<{ node_id: string; pramana: string }>;
    for (const row of rows) result.set(row.node_id, row.pramana as PramanaType);
  } catch {
    // Fall through — defaults applied below
  }

  for (const id of nodeIds) {
    if (!result.has(id)) result.set(id, "shabda");
  }
  return result;
}

// ─── Migration Helper ──────────────────────────────────────────────────────

/**
 * Migrate graph data from legacy JSON files (graph.json, pagerank.json) into
 * SQLite graph.db. Renames originals to .bak after migration.
 * @returns Count of migrated nodes and edges.
 */
export function migrateGraphJson(): { nodes: number; edges: number } {
  const graphPath = getGraphPath();
  const prPath = getPageRankPath();

  if (!fs.existsSync(graphPath)) return { nodes: 0, edges: 0 };

  try {
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as KnowledgeGraph;
    if (!graph.nodes || graph.nodes.length === 0) return { nodes: 0, edges: 0 };

    const pageRankScores = new Map<string, number>();
    try {
      if (fs.existsSync(prPath)) {
        const ranks = JSON.parse(fs.readFileSync(prPath, "utf-8")) as Record<string, number>;
        for (const [key, value] of Object.entries(ranks)) pageRankScores.set(key, value);
      }
    } catch { /* Ignore corrupt pagerank */ }

    const dbm = DatabaseManager.instance();
    initGraphSchema(dbm);
    const db = dbm.get("graph");

    db.transaction(() => {
      const upsertStmt = db.prepare(`
        INSERT OR REPLACE INTO nodes (id, type, label, content, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const edgeStmt = db.prepare(`
        INSERT OR IGNORE INTO edges (source, target, relationship, weight, pramana, viveka,
          valid_from, valid_until, recorded_at, superseded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const prStmt = db.prepare(
        "INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)",
      );
      const now = Date.now();

      for (const node of graph.nodes) {
        upsertStmt.run(node.id, node.type, node.label, node.content, JSON.stringify(node.metadata), now, now);
      }
      for (const edge of graph.edges) {
        edgeStmt.run(
          edge.source, edge.target, edge.relationship, edge.weight, null, null,
          edge.validFrom ? new Date(edge.validFrom).getTime() : now,
          edge.validUntil ? new Date(edge.validUntil).getTime() : null,
          edge.recordedAt ? new Date(edge.recordedAt).getTime() : now,
          edge.supersededAt ? new Date(edge.supersededAt).getTime() : null,
        );
      }
      for (const [nodeId, score] of pageRankScores) prStmt.run(nodeId, score, now);
    })();

    try { fs.renameSync(graphPath, graphPath + ".bak"); } catch { /* Best effort */ }
    try { if (fs.existsSync(prPath)) fs.renameSync(prPath, prPath + ".bak"); } catch { /* Best effort */ }

    return { nodes: graph.nodes.length, edges: graph.edges.length };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}
