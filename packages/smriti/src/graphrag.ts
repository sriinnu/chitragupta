/**
 * @chitragupta/smriti — GraphRAG engine.
 *
 * Production-grade vector search and knowledge graph powered by a local LLM (Ollama).
 * Builds a graph from sessions and memories, indexes with embeddings,
 * and provides similarity-based search with hybrid scoring.
 *
 * Algorithms:
 * - LLM-based entity extraction (with keyword fallback)
 * - Incremental push-based PageRank — O(1/ε) per edge vs O(V×E×iter) full recompute
 * - Semantic chunking with sentence-boundary awareness and token-overlap
 * - Hybrid search: cosine similarity + PageRank + BM25 text match
 *
 * Persistence: SQLite graph.db (Phase 0.5) with JSON fallback for migration.
 *
 * When Ollama is not available, gracefully falls back to text-based search.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type BetterSqlite3 from "better-sqlite3";
import type {
  Session,
  MemoryResult,
  MemoryScope,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  PramanaType,
} from "./types.js";

import { computePageRank as computePageRankAlgo } from "./graphrag-pagerank.js";
import { IncrementalPageRank } from "./graphrag-pagerank-personalized.js";
import { llmExtractEntities, keywordExtractEntities } from "./graphrag-extraction.js";
import type { ExtractedEntity } from "./graphrag-extraction.js";
import { NERExtractor } from "./ner-extractor.js";
import { ALPHA, BETA, GAMMA, cosineSimilarity, textMatchScore } from "./graphrag-scoring.js";
import {
  createSessionNode,
  extractConceptsFromNodes,
  indexSessionTurns,
  buildMemoryNodes,
  buildMemoryNodesFromContent,
  removeSessionFromGraph,
  removeMemoryFromGraph,
} from "./graphrag-builder.js";
import { EmbeddingService } from "./embedding-service.js";
import { DatabaseManager } from "./db/database.js";
import { initGraphSchema } from "./db/schema.js";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface GraphRAGConfig {
  /** Ollama API endpoint. Defaults to http://localhost:11434 */
  endpoint: string;
  /** Embedding model name. Defaults to nomic-embed-text */
  model: string;
  /** Generation model for entity extraction. Defaults to llama3.2 */
  generationModel: string;
  /** Shared embedding service. If not provided, falls back to hash-only. */
  embeddingService?: EmbeddingService;
  /** Maximum number of entries in the embedding cache. Defaults to 10000. */
  maxEmbeddingCacheSize?: number;
}

const DEFAULT_CONFIG: GraphRAGConfig = {
  endpoint: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  model: "nomic-embed-text",
  generationModel: "llama3.2",
};

// ─── Storage Paths ──────────────────────────────────────────────────────────

function getGraphDir(): string {
  return path.join(getChitraguptaHome(), "graphrag");
}

function getGraphPath(): string {
  return path.join(getGraphDir(), "graph.json");
}

function getEmbeddingsPath(): string {
  return path.join(getGraphDir(), "embeddings.json");
}

function getPageRankPath(): string {
  return path.join(getGraphDir(), "pagerank.json");
}

// ─── GraphRAG Engine ────────────────────────────────────────────────────────

export class GraphRAGEngine {
  private config: GraphRAGConfig;
  private graph: KnowledgeGraph;
  private embeddingCache: Map<string, number[]>;
  private pageRankScores: Map<string, number>;
  private readonly maxEmbeddingCacheSize: number;
  private ollamaAvailable: boolean | null = null;
  private embeddingService: EmbeddingService;
  /** Push-based incremental PageRank engine — avoids full recompute on edge changes. */
  private incrementalPR: IncrementalPageRank | null = null;
  /** Whether the graph.db schema has been initialized in this process. */
  private _graphDbInitialized = false;

  constructor(config?: Partial<GraphRAGConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.graph = { nodes: [], edges: [] };
    this.embeddingCache = new Map();
    this.pageRankScores = new Map();
    this.maxEmbeddingCacheSize = config?.maxEmbeddingCacheSize ?? 10_000;
    this.embeddingService = config?.embeddingService ?? new EmbeddingService();
    this.loadFromDisk();
  }

  // ─── Ollama Availability (for entity extraction) ──────────────────

  private async checkOllamaAvailability(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;

    try {
      const response = await fetch(`${this.config.endpoint}/api/version`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      this.ollamaAvailable = response.ok;
    } catch {
      this.ollamaAvailable = false;
    }

    return this.ollamaAvailable;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;

    const vector = await this.embeddingService.getEmbedding(text);
    this.embeddingCache.set(text, vector);
    // LRU eviction: remove oldest entries if cache exceeds max
    if (this.embeddingCache.size > this.maxEmbeddingCacheSize) {
      const oldest = this.embeddingCache.keys().next().value;
      if (oldest !== undefined) {
        this.embeddingCache.delete(oldest);
      }
    }
    return vector;
  }

  // ─── Cosine Similarity (delegate) ──────────────────────────────────

  cosineSimilarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }

  // ─── Entity Extraction (delegates) ─────────────────────────────────

  async extractEntities(text: string): Promise<ExtractedEntity[]> {
    const isAvailable = await this.checkOllamaAvailability();

    let baseEntities: ExtractedEntity[];
    if (isAvailable) {
      try {
        baseEntities = await llmExtractEntities(text, this.config.endpoint, this.config.generationModel);
      } catch {
        baseEntities = keywordExtractEntities(text);
      }
    } else {
      baseEntities = keywordExtractEntities(text);
    }

    // ─── NER enrichment (Naama): extract file paths, errors, technologies,
    //     tool names, decisions — things keyword extraction might miss. ────
    try {
      const nerExtractor = new NERExtractor({ useHeuristic: true });
      const nerEntities = await nerExtractor.extract(text);

      // NER entity type → GraphRAG entity type mapping
      const nerTypeMap: Record<string, string> = {
        file: "file",
        technology: "concept",
        tool: "tool",
        error: "concept",
        decision: "concept",
        action: "concept",
        person: "person",
        organization: "organization",
        location: "concept",
        concept: "concept",
      };

      // Deduplicate by normalized name against base entities
      const seen = new Set(baseEntities.map((e) => e.name.toLowerCase()));
      for (const ne of nerEntities) {
        const normalized = ne.text.toLowerCase().trim();
        if (!seen.has(normalized) && normalized.length > 0) {
          baseEntities.push({
            name: normalized,
            type: nerTypeMap[ne.type] ?? "concept",
            description: `NER-detected ${ne.type} (confidence: ${ne.confidence.toFixed(2)})`,
          });
          seen.add(normalized);
        }
      }
    } catch {
      // NER extraction failed — continue with base entities only
    }

    return baseEntities;
  }

  // ─── Incremental PageRank ────────────────────────────────────────

  /**
   * Initialize (or reinitialize) the incremental PageRank engine from
   * the current graph state. Performs one full Gauss-Seidel computation
   * internally, then subsequent edge changes are O(1/ε) each via
   * push-based residual propagation.
   */
  private initIncrementalPR(): void {
    this.incrementalPR = new IncrementalPageRank();
    this.incrementalPR.initialize(this.graph);
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  /**
   * Feed removed edges into the incremental PR engine so it can adjust
   * scores via residual propagation rather than a full recompute.
   */
  private applyEdgeRemovals(edges: GraphEdge[]): void {
    if (!this.incrementalPR || edges.length === 0) return;
    for (const edge of edges) {
      this.incrementalPR.removeEdge(edge.source, edge.target);
    }
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  /**
   * Feed newly added edges into the incremental PR engine.
   */
  private applyEdgeAdditions(edges: GraphEdge[]): void {
    if (!this.incrementalPR || edges.length === 0) return;
    for (const edge of edges) {
      this.incrementalPR.addEdge(edge.source, edge.target);
    }
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  // ─── PageRank (delegates) ──────────────────────────────────────────

  /**
   * Compute PageRank for the given graph (or the internal graph if none provided).
   *
   * When called with an explicit graph argument, uses the full power-iteration
   * algorithm (useful for one-off computations on external graphs and tests).
   * When called without arguments, initializes the incremental PageRank engine
   * on the internal graph.
   */
  computePageRank(graph?: KnowledgeGraph): Map<string, number> {
    if (graph) {
      // Explicit graph provided (tests, external callers) — full power-iteration
      this.pageRankScores = computePageRankAlgo(graph);
      return this.pageRankScores;
    }
    // No explicit graph — use incremental engine on this.graph
    this.initIncrementalPR();
    return this.pageRankScores;
  }

  getPageRank(nodeId: string): number {
    return this.pageRankScores.get(nodeId) ?? 0;
  }

  /**
   * Force a full PageRank recompute from the current graph state.
   * Reinitializes the incremental engine from scratch. Useful after
   * graph compaction or any structural change that bypasses the
   * normal indexSession/indexMemory paths.
   */
  recomputePageRank(): void {
    this.initIncrementalPR();
    this.saveToDisk();
  }

  // ─── Graph Building ───────────────────────────────────────────────

  async buildGraph(sessions: Session[], memories: MemoryResult[]): Promise<KnowledgeGraph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const session of sessions) {
      const sessionNode = await createSessionNode(this, session);
      nodes.push(sessionNode);
      await indexSessionTurns(this, session, nodes, edges);
    }

    for (const memory of memories) {
      await buildMemoryNodes(this, memory, nodes, edges);
    }

    await extractConceptsFromNodes(this, nodes, edges);

    this.graph = { nodes, edges };
    // Full graph build — initialize incremental PR from scratch
    this.initIncrementalPR();
    this.saveToDisk();

    return this.graph;
  }

  // ─── Hybrid Search ───────────────────────────────────────────────

  async search(query: string, graph?: KnowledgeGraph, topK: number = 10): Promise<GraphNode[]> {
    const searchGraph = graph ?? this.graph;
    if (searchGraph.nodes.length === 0) return [];

    const queryEmbedding = await this.getEmbedding(query);

    if (this.pageRankScores.size === 0) {
      this.computePageRank(searchGraph);
    }

    let maxPageRank = 0;
    for (const node of searchGraph.nodes) {
      const pr = this.pageRankScores.get(node.id) ?? 0;
      if (pr > maxPageRank) maxPageRank = pr;
    }

    const scored: { node: GraphNode; score: number }[] = [];

    for (const node of searchGraph.nodes) {
      let cosineSim = 0;
      if (node.embedding && node.embedding.length > 0) {
        cosineSim = cosineSimilarity(queryEmbedding, node.embedding);
        cosineSim = Math.max(0, cosineSim);
      }

      const rawPageRank = this.pageRankScores.get(node.id) ?? 0;
      const normalizedPageRank = maxPageRank > 0 ? rawPageRank / maxPageRank : 0;
      const textScore = textMatchScore(query, node.content + " " + node.label);
      const finalScore = ALPHA * cosineSim + BETA * normalizedPageRank + GAMMA * textScore;

      if (finalScore > 0) {
        scored.push({ node, score: finalScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.node);
  }

  // ─── Incremental Indexing ─────────────────────────────────────────

  async indexSession(session: Session): Promise<void> {
    // Snapshot edges before removal so we can feed removals to incremental PR
    const edgesBefore = [...this.graph.edges];
    removeSessionFromGraph(this.graph, session.meta.id);
    const edgesAfterRemoval = this.graph.edges;

    // Determine which edges were removed
    const edgesAfterSet = new Set(edgesAfterRemoval);
    const removedEdges = edgesBefore.filter((e) => !edgesAfterSet.has(e));

    // Track edge count before adding new ones
    const edgeCountBeforeAdd = this.graph.edges.length;

    const sessionNode = await createSessionNode(this, session);
    this.graph.nodes.push(sessionNode);
    await indexSessionTurns(this, session, this.graph.nodes, this.graph.edges);

    // Determine newly added edges
    const newEdges = this.graph.edges.slice(edgeCountBeforeAdd);

    // Incremental PageRank update — O(1/ε) per edge instead of full recompute
    if (!this.incrementalPR) {
      this.initIncrementalPR();
    } else {
      this.applyEdgeRemovals(removedEdges);
      this.applyEdgeAdditions(newEdges);
    }

    this.saveToDisk();
  }

  async indexMemory(scope: MemoryScope, content: string): Promise<void> {
    // Snapshot edges before removal
    const edgesBefore = [...this.graph.edges];
    removeMemoryFromGraph(this.graph, scope);
    const edgesAfterRemoval = this.graph.edges;

    // Determine which edges were removed
    const edgesAfterSet = new Set(edgesAfterRemoval);
    const removedEdges = edgesBefore.filter((e) => !edgesAfterSet.has(e));

    // Track edge count before adding new ones
    const edgeCountBeforeAdd = this.graph.edges.length;

    await buildMemoryNodesFromContent(this, scope, content, this.graph.nodes, this.graph.edges);

    // Determine newly added edges
    const newEdges = this.graph.edges.slice(edgeCountBeforeAdd);

    // Incremental PageRank update — O(1/ε) per edge instead of full recompute
    if (!this.incrementalPR) {
      this.initIncrementalPR();
    } else {
      this.applyEdgeRemovals(removedEdges);
      this.applyEdgeAdditions(newEdges);
    }

    this.saveToDisk();
  }

  // ─── Pramana Lookup ──────────────────────────────────────────────

  /**
   * Look up the dominant pramana type for a given node ID.
   *
   * Queries the edges table for edges involving this node (as source or target)
   * and returns the most common non-null pramana value. Falls back to 'shabda'
   * (testimony/documentation) if no pramana data is found.
   *
   * @param nodeId - The graph node ID to look up.
   * @returns The dominant PramanaType for this node.
   */
  lookupPramana(nodeId: string): PramanaType {
    const db = this.getGraphDb();
    if (!db) return "shabda";

    try {
      const row = db.prepare(`
        SELECT pramana, COUNT(*) as cnt
        FROM edges
        WHERE (source = ? OR target = ?) AND pramana IS NOT NULL
        GROUP BY pramana
        ORDER BY cnt DESC
        LIMIT 1
      `).get(nodeId, nodeId) as { pramana: string; cnt: number } | undefined;

      if (row?.pramana) return row.pramana as PramanaType;
    } catch {
      // Database unavailable or query error — fall through to default
    }

    return "shabda";
  }

  /**
   * Batch look up pramana types for multiple node IDs.
   *
   * More efficient than calling lookupPramana() individually for each node.
   * Returns a Map from node ID to PramanaType. Missing entries default to 'shabda'.
   *
   * @param nodeIds - Array of node IDs to look up.
   * @returns Map from node ID to its dominant PramanaType.
   */
  lookupPramanaBatch(nodeIds: string[]): Map<string, PramanaType> {
    const result = new Map<string, PramanaType>();
    if (nodeIds.length === 0) return result;

    const db = this.getGraphDb();
    if (!db) {
      for (const id of nodeIds) result.set(id, "shabda");
      return result;
    }

    try {
      // Single query: for each node, get the most common pramana
      const placeholders = nodeIds.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT node_id, pramana FROM (
          SELECT source AS node_id, pramana, COUNT(*) AS cnt
          FROM edges
          WHERE source IN (${placeholders}) AND pramana IS NOT NULL
          GROUP BY source, pramana
          UNION ALL
          SELECT target AS node_id, pramana, COUNT(*) AS cnt
          FROM edges
          WHERE target IN (${placeholders}) AND pramana IS NOT NULL
          GROUP BY target, pramana
        )
        GROUP BY node_id
        HAVING cnt = MAX(cnt)
      `).all(...nodeIds, ...nodeIds) as Array<{ node_id: string; pramana: string }>;

      for (const row of rows) {
        result.set(row.node_id, row.pramana as PramanaType);
      }
    } catch {
      // Fall through — defaults applied below
    }

    // Fill defaults for missing entries
    for (const id of nodeIds) {
      if (!result.has(id)) result.set(id, "shabda");
    }

    return result;
  }

  // ─── SQLite Persistence Helpers ─────────────────────────────────

  /**
   * Get the graph database handle, initializing the schema on first access.
   * Returns null if the database layer is unavailable (e.g. mocked fs in tests).
   */
  private getGraphDb(): BetterSqlite3.Database | null {
    try {
      const dbm = DatabaseManager.instance();
      if (!this._graphDbInitialized) {
        initGraphSchema(dbm);
        this._graphDbInitialized = true;
      }
      return dbm.get("graph");
    } catch {
      return null;
    }
  }

  /** Insert or replace a node in the SQLite nodes table. */
  private upsertNode(db: BetterSqlite3.Database, node: GraphNode): void {
    db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, label, content, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id,
      node.type,
      node.label,
      node.content,
      JSON.stringify(node.metadata),
      Date.now(),
      Date.now(),
    );
  }

  /** Insert an edge into the SQLite edges table (bi-temporal fields mapped). */
  private insertEdge(db: BetterSqlite3.Database, edge: GraphEdge): void {
    db.prepare(`
      INSERT OR IGNORE INTO edges (source, target, relationship, weight, pramana, viveka,
        valid_from, valid_until, recorded_at, superseded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      edge.source,
      edge.target,
      edge.relationship,
      edge.weight,
      null, // pramana — not yet used
      null, // viveka — not yet used
      edge.validFrom ? new Date(edge.validFrom).getTime() : Date.now(),
      edge.validUntil ? new Date(edge.validUntil).getTime() : null,
      edge.recordedAt ? new Date(edge.recordedAt).getTime() : Date.now(),
      edge.supersededAt ? new Date(edge.supersededAt).getTime() : null,
    );
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private saveToDisk(): void {
    try {
      const db = this.getGraphDb();
      if (db) {
        db.transaction(() => {
          // Clear and re-insert all data
          db.prepare("DELETE FROM pagerank").run();
          db.prepare("DELETE FROM edges").run();
          db.prepare("DELETE FROM nodes").run();

          for (const node of this.graph.nodes) {
            this.upsertNode(db, node);
          }
          for (const edge of this.graph.edges) {
            this.insertEdge(db, edge);
          }
          for (const [nodeId, score] of this.pageRankScores) {
            db.prepare(
              "INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)",
            ).run(nodeId, score, Date.now());
          }
        })();

        // Embeddings still go to JSON (Phase 0.6 moves to vectors.db)
        this.saveEmbeddingsJson();
        return;
      }
    } catch {
      // SQLite write failed — fall through to JSON fallback
    }

    // JSON fallback (backward compat / migration path)
    this.saveToDiskJson();
  }

  private loadFromDisk(): void {
    let loadedFromSqlite = false;

    try {
      const db = this.getGraphDb();
      if (db) {
        // Check if graph.db has data
        const nodeCount = (db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number }).cnt;

        if (nodeCount > 0) {
          // Load nodes from SQLite
          const nodeRows = db.prepare("SELECT * FROM nodes").all() as Array<Record<string, unknown>>;
          this.graph.nodes = nodeRows.map((row) => ({
            id: row.id as string,
            type: row.type as GraphNode["type"],
            label: row.label as string,
            content: (row.content as string) ?? "",
            metadata: (() => { try { return JSON.parse((row.metadata as string) ?? "{}"); } catch { return {}; } })(),
            // Note: embedding not stored in nodes table — it's in vectors.db (Phase 0.6)
          }));

          // Load edges from SQLite
          const edgeRows = db.prepare("SELECT * FROM edges").all() as Array<Record<string, unknown>>;
          this.graph.edges = edgeRows.map((row) => ({
            source: row.source as string,
            target: row.target as string,
            relationship: row.relationship as string,
            weight: row.weight as number,
            validFrom: row.valid_from ? new Date(row.valid_from as number).toISOString() : undefined,
            validUntil: row.valid_until ? new Date(row.valid_until as number).toISOString() : undefined,
            recordedAt: row.recorded_at ? new Date(row.recorded_at as number).toISOString() : undefined,
            supersededAt: row.superseded_at ? new Date(row.superseded_at as number).toISOString() : undefined,
          }));

          // Load pagerank scores from SQLite
          const prRows = db.prepare("SELECT * FROM pagerank").all() as Array<Record<string, unknown>>;
          for (const row of prRows) {
            this.pageRankScores.set(row.node_id as string, row.score as number);
          }

          loadedFromSqlite = true;
        } else {
          // No data in SQLite — check for JSON files to migrate
          this.loadFromDiskJson();
          if (this.graph.nodes.length > 0) {
            // Migrate: write JSON data into SQLite
            try {
              db.transaction(() => {
                for (const node of this.graph.nodes) {
                  this.upsertNode(db, node);
                }
                for (const edge of this.graph.edges) {
                  this.insertEdge(db, edge);
                }
                for (const [nodeId, score] of this.pageRankScores) {
                  db.prepare(
                    "INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)",
                  ).run(nodeId, score, Date.now());
                }
              })();
            } catch {
              // Migration failed — not fatal, JSON data is still loaded in memory
            }
          }
          loadedFromSqlite = true; // Already loaded from JSON into memory
        }
      }
    } catch {
      // SQLite unavailable — fall through to JSON
    }

    if (!loadedFromSqlite) {
      this.loadFromDiskJson();
    }

    // Embeddings cache always loaded from JSON (Phase 0.6 moves to vectors.db)
    this.loadEmbeddingsJson();

    // Initialize the incremental PR engine from persisted graph so
    // subsequent indexSession/indexMemory calls can update incrementally
    // instead of doing a full power-iteration recompute.
    if (this.graph.edges.length > 0) {
      this.initIncrementalPR();
    }
  }

  // ─── JSON Fallback Persistence (legacy / migration) ───────────────

  private saveToDiskJson(): void {
    try {
      const dir = getGraphDir();
      fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(getGraphPath(), JSON.stringify(this.graph, null, "\t"), "utf-8");
      this.saveEmbeddingsJson();

      const pageRankObj: Record<string, number> = {};
      for (const [key, value] of this.pageRankScores) {
        pageRankObj[key] = value;
      }
      fs.writeFileSync(getPageRankPath(), JSON.stringify(pageRankObj, null, "\t"), "utf-8");
    } catch {
      // Non-fatal: graph persistence failure does not affect in-memory operation
    }
  }

  private saveEmbeddingsJson(): void {
    try {
      const dir = getGraphDir();
      fs.mkdirSync(dir, { recursive: true });

      const embeddings: Record<string, number[]> = {};
      for (const [key, value] of this.embeddingCache) {
        embeddings[key] = value;
      }
      fs.writeFileSync(getEmbeddingsPath(), JSON.stringify(embeddings, null, "\t"), "utf-8");
    } catch {
      // Non-fatal
    }
  }

  private loadFromDiskJson(): void {
    try {
      const graphPath = getGraphPath();
      if (fs.existsSync(graphPath)) {
        const raw = fs.readFileSync(graphPath, "utf-8");
        this.graph = JSON.parse(raw) as KnowledgeGraph;
      }
    } catch {
      // Corrupted graph file — reset to empty and rebuild from scratch
      this.graph = { nodes: [], edges: [] };
    }

    try {
      const prPath = getPageRankPath();
      if (fs.existsSync(prPath)) {
        const raw = fs.readFileSync(prPath, "utf-8");
        const ranks = JSON.parse(raw) as Record<string, number>;
        for (const [key, value] of Object.entries(ranks)) {
          this.pageRankScores.set(key, value);
        }
      }
    } catch {
      // Corrupted PageRank cache — will be re-computed on next query
      this.pageRankScores = new Map();
    }
  }

  private loadEmbeddingsJson(): void {
    try {
      const embPath = getEmbeddingsPath();
      if (fs.existsSync(embPath)) {
        const raw = fs.readFileSync(embPath, "utf-8");
        const embeddings = JSON.parse(raw) as Record<string, number[]>;
        for (const [key, value] of Object.entries(embeddings)) {
          this.embeddingCache.set(key, value);
        }
        // Trim persisted cache if it exceeds configured max
        while (this.embeddingCache.size > this.maxEmbeddingCacheSize) {
          const oldest = this.embeddingCache.keys().next().value;
          if (oldest !== undefined) {
            this.embeddingCache.delete(oldest);
          }
        }
      }
    } catch {
      // Corrupted embeddings cache — will be re-computed on demand
      this.embeddingCache = new Map();
    }
  }

  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  async clear(): Promise<void> {
    this.graph = { nodes: [], edges: [] };
    this.embeddingCache = new Map();
    this.pageRankScores = new Map();
    this.incrementalPR = null;

    // Clear SQLite tables directly
    try {
      const db = this.getGraphDb();
      if (db) {
        db.exec("DELETE FROM pagerank; DELETE FROM edges; DELETE FROM nodes;");
      }
    } catch {
      // Non-fatal — in-memory state is already cleared
    }

    this.saveToDisk();
  }

  resetAvailability(): void {
    this.ollamaAvailable = null;
    this.embeddingService.resetAvailability();
  }

  // ─── Graph Neighbor Queries ───────────────────────────────────────

  /**
   * Get edges connected to a node, optionally filtered by direction.
   * Uses the in-memory graph for fast access.
   */
  getNeighbors(nodeId: string, direction: "in" | "out" | "both" = "both"): GraphEdge[] {
    return this.graph.edges.filter((edge) => {
      if (direction === "out") return edge.source === nodeId;
      if (direction === "in") return edge.target === nodeId;
      return edge.source === nodeId || edge.target === nodeId;
    });
  }
}

// ─── Migration Helper ──────────────────────────────────────────────────────

/**
 * Migrate graph data from legacy JSON files (graph.json, pagerank.json) into
 * SQLite graph.db. If graph.json exists and has data, it is read, inserted
 * into SQLite, and renamed to graph.json.bak.
 *
 * @returns The count of migrated nodes and edges, or { nodes: 0, edges: 0 } if
 *          there was nothing to migrate.
 */
export function migrateGraphJson(): { nodes: number; edges: number } {
  const graphPath = getGraphPath();
  const prPath = getPageRankPath();

  if (!fs.existsSync(graphPath)) {
    return { nodes: 0, edges: 0 };
  }

  try {
    const raw = fs.readFileSync(graphPath, "utf-8");
    const graph = JSON.parse(raw) as KnowledgeGraph;
    if (!graph.nodes || graph.nodes.length === 0) {
      return { nodes: 0, edges: 0 };
    }

    // Load pagerank if present
    const pageRankScores = new Map<string, number>();
    try {
      if (fs.existsSync(prPath)) {
        const prRaw = fs.readFileSync(prPath, "utf-8");
        const ranks = JSON.parse(prRaw) as Record<string, number>;
        for (const [key, value] of Object.entries(ranks)) {
          pageRankScores.set(key, value);
        }
      }
    } catch {
      // Ignore corrupt pagerank
    }

    // Write into SQLite
    const dbm = DatabaseManager.instance();
    initGraphSchema(dbm);
    const db = dbm.get("graph");

    db.transaction(() => {
      const upsertNodeStmt = db.prepare(`
        INSERT OR REPLACE INTO nodes (id, type, label, content, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertEdgeStmt = db.prepare(`
        INSERT OR IGNORE INTO edges (source, target, relationship, weight, pramana, viveka,
          valid_from, valid_until, recorded_at, superseded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertPRStmt = db.prepare(
        "INSERT OR REPLACE INTO pagerank (node_id, score, updated_at) VALUES (?, ?, ?)",
      );

      const now = Date.now();
      for (const node of graph.nodes) {
        upsertNodeStmt.run(
          node.id, node.type, node.label, node.content,
          JSON.stringify(node.metadata), now, now,
        );
      }
      for (const edge of graph.edges) {
        insertEdgeStmt.run(
          edge.source, edge.target, edge.relationship, edge.weight,
          null, null,
          edge.validFrom ? new Date(edge.validFrom).getTime() : now,
          edge.validUntil ? new Date(edge.validUntil).getTime() : null,
          edge.recordedAt ? new Date(edge.recordedAt).getTime() : now,
          edge.supersededAt ? new Date(edge.supersededAt).getTime() : null,
        );
      }
      for (const [nodeId, score] of pageRankScores) {
        upsertPRStmt.run(nodeId, score, now);
      }
    })();

    // Rename JSON files to .bak
    try {
      fs.renameSync(graphPath, graphPath + ".bak");
    } catch {
      // Best effort
    }
    try {
      if (fs.existsSync(prPath)) {
        fs.renameSync(prPath, prPath + ".bak");
      }
    } catch {
      // Best effort
    }

    return { nodes: graph.nodes.length, edges: graph.edges.length };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}
