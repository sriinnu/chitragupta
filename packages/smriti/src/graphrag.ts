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
 * - Hybrid search: cosine similarity + PageRank + BM25 text match
 *
 * Persistence delegates to graphrag-persistence.ts (SQLite primary, JSON fallback).
 * When Ollama is not available, gracefully falls back to text-based search.
 */

import type BetterSqlite3 from "better-sqlite3";
import type {
  Session, MemoryResult, MemoryScope,
  GraphNode, GraphEdge, KnowledgeGraph, PramanaType,
} from "./types.js";
import { computePageRank as computePageRankAlgo } from "./graphrag-pagerank.js";
import { IncrementalPageRank } from "./graphrag-pagerank-personalized.js";
import { llmExtractEntities, keywordExtractEntities } from "./graphrag-extraction.js";
import type { ExtractedEntity } from "./graphrag-extraction.js";
import { NERExtractor } from "./ner-extractor.js";
import { ALPHA, BETA, GAMMA, cosineSimilarity, textMatchScore } from "./graphrag-scoring.js";
import {
  createSessionNode, extractConceptsFromNodes, indexSessionTurns,
  buildMemoryNodes, buildMemoryNodesFromContent,
  removeSessionFromGraph, removeMemoryFromGraph,
} from "./graphrag-builder.js";
import { leiden, annotateCommunities } from "./graphrag-leiden.js";
import { EmbeddingService } from "./embedding-service.js";
import {
  getGraphDb, saveToSqlite, loadFromSqlite, migrateInMemoryToSqlite,
  saveToJson, loadFromJson, loadEmbeddingsJson,
  lookupPramana as lookupPramanaFn,
  lookupPramanaBatch as lookupPramanaBatchFn,
  migrateGraphJson,
} from "./graphrag-persistence.js";

// Re-export so index.ts continues to import from here
export { migrateGraphJson };

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration options for the GraphRAG engine. */
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

// ─── GraphRAG Engine ────────────────────────────────────────────────────────

/** Knowledge graph engine with hybrid search, incremental PageRank, and persistence. */
export class GraphRAGEngine {
  private config: GraphRAGConfig;
  private graph: KnowledgeGraph;
  private embeddingCache: Map<string, number[]>;
  private pageRankScores: Map<string, number>;
  private readonly maxEmbeddingCacheSize: number;
  private ollamaAvailable: boolean | null = null;
  private embeddingService: EmbeddingService;
  /** Push-based incremental PageRank engine. */
  private incrementalPR: IncrementalPageRank | null = null;
  /** Whether graph.db schema has been initialized in this process. */
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

  private async checkOllamaAvailability(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;
    try {
      const response = await fetch(`${this.config.endpoint}/api/version`, {
        method: "GET", signal: AbortSignal.timeout(3000),
      });
      this.ollamaAvailable = response.ok;
    } catch {
      this.ollamaAvailable = false;
    }
    return this.ollamaAvailable;
  }

  /** Get (or compute and cache) an embedding vector for the given text. */
  async getEmbedding(text: string): Promise<number[]> {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;
    const vector = await this.embeddingService.getEmbedding(text);
    this.embeddingCache.set(text, vector);
    if (this.embeddingCache.size > this.maxEmbeddingCacheSize) {
      const oldest = this.embeddingCache.keys().next().value;
      if (oldest !== undefined) this.embeddingCache.delete(oldest);
    }
    return vector;
  }

  /** Compute cosine similarity between two vectors. */
  cosineSimilarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }

  /** Extract named entities from text using LLM (with keyword + NER fallback). */
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

    // NER enrichment (Naama)
    try {
      const nerExtractor = new NERExtractor({ useHeuristic: true });
      const nerEntities = await nerExtractor.extract(text);
      const nerTypeMap: Record<string, string> = {
        file: "file", technology: "concept", tool: "tool", error: "concept",
        decision: "concept", action: "concept", person: "person",
        organization: "organization", location: "concept", concept: "concept",
      };
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

  /** Initialize incremental PageRank from current graph state. */
  private initIncrementalPR(): void {
    this.incrementalPR = new IncrementalPageRank();
    this.incrementalPR.initialize(this.graph);
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  /** Feed removed edges into incremental PR engine. */
  private applyEdgeRemovals(edges: GraphEdge[]): void {
    if (!this.incrementalPR || edges.length === 0) return;
    for (const edge of edges) this.incrementalPR.removeEdge(edge.source, edge.target);
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  /** Feed newly added edges into incremental PR engine. */
  private applyEdgeAdditions(edges: GraphEdge[]): void {
    if (!this.incrementalPR || edges.length === 0) return;
    for (const edge of edges) this.incrementalPR.addEdge(edge.source, edge.target);
    this.pageRankScores = this.incrementalPR.getRanks();
  }

  /**
   * Compute PageRank. With an explicit graph argument uses full power-iteration;
   * without arguments initializes the incremental engine on the internal graph.
   */
  computePageRank(graph?: KnowledgeGraph): Map<string, number> {
    if (graph) {
      this.pageRankScores = computePageRankAlgo(graph);
      return this.pageRankScores;
    }
    this.initIncrementalPR();
    return this.pageRankScores;
  }

  /** Get the PageRank score for a node. Returns 0 if not computed. */
  getPageRank(nodeId: string): number {
    return this.pageRankScores.get(nodeId) ?? 0;
  }

  /** Force a full PageRank recompute and persist. */
  recomputePageRank(): void {
    this.initIncrementalPR();
    this.saveToDisk();
  }

  // ─── Graph Building ───────────────────────────────────────────────

  /** Build a full knowledge graph from sessions and memories. */
  async buildGraph(sessions: Session[], memories: MemoryResult[]): Promise<KnowledgeGraph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const session of sessions) {
      nodes.push(await createSessionNode(this, session));
      await indexSessionTurns(this, session, nodes, edges);
    }
    for (const memory of memories) await buildMemoryNodes(this, memory, nodes, edges);
    await extractConceptsFromNodes(this, nodes, edges);
    this.graph = { nodes, edges };
    if (this.graph.nodes.length > 0 && this.graph.edges.length > 0) {
      annotateCommunities(this.graph, leiden(this.graph));
    }
    this.initIncrementalPR();
    this.saveToDisk();
    return this.graph;
  }

  // ─── Hybrid Search ───────────────────────────────────────────────

  /** Search the knowledge graph using hybrid scoring (cosine + PageRank + BM25). */
  async search(query: string, graph?: KnowledgeGraph, topK: number = 10): Promise<GraphNode[]> {
    const searchGraph = graph ?? this.graph;
    if (searchGraph.nodes.length === 0) return [];
    const queryEmbedding = await this.getEmbedding(query);
    if (this.pageRankScores.size === 0) this.computePageRank(searchGraph);

    let maxPageRank = 0;
    for (const node of searchGraph.nodes) {
      const pr = this.pageRankScores.get(node.id) ?? 0;
      if (pr > maxPageRank) maxPageRank = pr;
    }

    const scored: { node: GraphNode; score: number }[] = [];
    for (const node of searchGraph.nodes) {
      let cosineSim = 0;
      if (node.embedding && node.embedding.length > 0) {
        cosineSim = Math.max(0, cosineSimilarity(queryEmbedding, node.embedding));
      }
      const rawPR = this.pageRankScores.get(node.id) ?? 0;
      const normPR = maxPageRank > 0 ? rawPR / maxPageRank : 0;
      const textScore = textMatchScore(query, node.content + " " + node.label);
      const finalScore = ALPHA * cosineSim + BETA * normPR + GAMMA * textScore;
      if (finalScore > 0) scored.push({ node, score: finalScore });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.node);
  }

  // ─── Incremental Indexing ─────────────────────────────────────────

  /** Index a single session incrementally. */
  async indexSession(session: Session): Promise<void> {
    const edgesBefore = [...this.graph.edges];
    removeSessionFromGraph(this.graph, session.meta.id);
    const edgesAfterSet = new Set(this.graph.edges);
    const removedEdges = edgesBefore.filter((e) => !edgesAfterSet.has(e));
    const edgeCountBeforeAdd = this.graph.edges.length;

    this.graph.nodes.push(await createSessionNode(this, session));
    await indexSessionTurns(this, session, this.graph.nodes, this.graph.edges);
    const newEdges = this.graph.edges.slice(edgeCountBeforeAdd);

    if (!this.incrementalPR) { this.initIncrementalPR(); }
    else { this.applyEdgeRemovals(removedEdges); this.applyEdgeAdditions(newEdges); }
    this.saveToDisk();
  }

  /** Index a memory scope incrementally. */
  async indexMemory(scope: MemoryScope, content: string): Promise<void> {
    const edgesBefore = [...this.graph.edges];
    removeMemoryFromGraph(this.graph, scope);
    const edgesAfterSet = new Set(this.graph.edges);
    const removedEdges = edgesBefore.filter((e) => !edgesAfterSet.has(e));
    const edgeCountBeforeAdd = this.graph.edges.length;

    await buildMemoryNodesFromContent(this, scope, content, this.graph.nodes, this.graph.edges);
    const newEdges = this.graph.edges.slice(edgeCountBeforeAdd);

    if (!this.incrementalPR) { this.initIncrementalPR(); }
    else { this.applyEdgeRemovals(removedEdges); this.applyEdgeAdditions(newEdges); }
    this.saveToDisk();
  }

  // ─── Pramana Lookup (delegates) ──────────────────────────────────

  /** Look up the dominant pramana type for a given node ID. */
  lookupPramana(nodeId: string): PramanaType {
    return lookupPramanaFn(this.getGraphDbHandle(), nodeId);
  }

  /** Batch look up pramana types for multiple node IDs. */
  lookupPramanaBatch(nodeIds: string[]): Map<string, PramanaType> {
    return lookupPramanaBatchFn(this.getGraphDbHandle(), nodeIds);
  }

  // ─── Persistence (delegates) ─────────────────────────────────────

  /** Get graph database handle via persistence layer. */
  private getGraphDbHandle(): BetterSqlite3.Database | null {
    return getGraphDb(this._graphDbInitialized, () => { this._graphDbInitialized = true; });
  }

  /** Save graph state to SQLite (primary) or JSON (fallback). */
  private saveToDisk(): void {
    try {
      const db = this.getGraphDbHandle();
      if (db) { saveToSqlite(db, this.graph, this.pageRankScores, this.embeddingCache); return; }
    } catch { /* SQLite write failed — fall through to JSON */ }
    saveToJson(this.graph, this.pageRankScores, this.embeddingCache);
  }

  /** Load graph state from SQLite (primary) or JSON (fallback). */
  private loadFromDisk(): void {
    let loaded = false;
    try {
      const db = this.getGraphDbHandle();
      if (db) {
        const sqliteData = loadFromSqlite(db);
        if (sqliteData) {
          this.graph = sqliteData.graph;
          this.pageRankScores = sqliteData.pageRankScores;
        } else {
          const jsonData = loadFromJson();
          this.graph = jsonData.graph;
          this.pageRankScores = jsonData.pageRankScores;
          if (this.graph.nodes.length > 0) {
            try { migrateInMemoryToSqlite(db, this.graph, this.pageRankScores); } catch { /* non-fatal */ }
          }
        }
        loaded = true;
      }
    } catch { /* SQLite unavailable */ }

    if (!loaded) {
      const jsonData = loadFromJson();
      this.graph = jsonData.graph;
      this.pageRankScores = jsonData.pageRankScores;
    }

    // Embeddings always from JSON (Phase 0.6 moves to vectors.db)
    for (const [k, v] of loadEmbeddingsJson(this.maxEmbeddingCacheSize)) {
      this.embeddingCache.set(k, v);
    }

    if (this.graph.edges.length > 0) this.initIncrementalPR();
  }

  /** Get the current in-memory knowledge graph. */
  getGraph(): KnowledgeGraph { return this.graph; }

  /** Clear all graph data, caches, and persisted state. */
  async clear(): Promise<void> {
    this.graph = { nodes: [], edges: [] };
    this.embeddingCache = new Map();
    this.pageRankScores = new Map();
    this.incrementalPR = null;
    try {
      const db = this.getGraphDbHandle();
      if (db) db.exec("DELETE FROM pagerank; DELETE FROM edges; DELETE FROM nodes;");
    } catch { /* non-fatal */ }
    this.saveToDisk();
  }

  /** Reset the Ollama availability flag to force re-check. */
  resetAvailability(): void {
    this.ollamaAvailable = null;
    this.embeddingService.resetAvailability();
  }

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
