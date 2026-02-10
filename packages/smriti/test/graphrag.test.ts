import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs to prevent actual disk I/O
vi.mock("fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    default: {
      existsSync: vi.fn((_p: string) => false),
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
        return store.get(p)!;
      }),
      writeFileSync: vi.fn((p: string, data: string) => {
        store.set(p, data);
      }),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      unlinkSync: vi.fn(),
      rmdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    },
    __store: store,
    __dirs: dirs,
  };
});

// Mock fetch to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GraphRAGEngine } from "@chitragupta/smriti";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "@chitragupta/smriti";

describe("GraphRAGEngine", () => {
  let engine: GraphRAGEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    // Make Ollama unavailable by default so we use fallback embedding
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    engine = new GraphRAGEngine({
      endpoint: "http://localhost:11434",
      model: "nomic-embed-text",
      generationModel: "llama3.2",
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const v = [1, 2, 3, 4, 5];
      expect(engine.cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(engine.cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it("should return -1 for opposite vectors", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(engine.cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it("should return 0 for vectors of different lengths", () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(engine.cosineSimilarity(a, b)).toBe(0);
    });

    it("should return 0 for zero vectors", () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(engine.cosineSimilarity(a, b)).toBe(0);
    });

    it("should handle real-world-like vectors", () => {
      const a = [0.5, 0.3, 0.8, 0.1];
      const b = [0.4, 0.2, 0.9, 0.15];
      const sim = engine.cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.9); // Similar vectors
      expect(sim).toBeLessThanOrEqual(1.0);
    });
  });

  describe("computePageRank", () => {
    it("should return empty map for empty graph", () => {
      const ranks = engine.computePageRank({ nodes: [], edges: [] });
      expect(ranks.size).toBe(0);
    });

    it("should assign equal rank to disconnected nodes", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
          { id: "b", type: "session", label: "B", content: "b", metadata: {} },
          { id: "c", type: "session", label: "C", content: "c", metadata: {} },
        ],
        edges: [],
      };

      const ranks = engine.computePageRank(graph);
      expect(ranks.size).toBe(3);

      // All nodes should have the same rank (approximately 1/N each)
      const rankA = ranks.get("a")!;
      const rankB = ranks.get("b")!;
      const rankC = ranks.get("c")!;
      expect(rankA).toBeCloseTo(rankB, 4);
      expect(rankB).toBeCloseTo(rankC, 4);
    });

    it("should give higher rank to nodes with more incoming links", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
          { id: "b", type: "session", label: "B", content: "b", metadata: {} },
          { id: "c", type: "session", label: "C", content: "c", metadata: {} },
          { id: "hub", type: "concept", label: "Hub", content: "hub", metadata: {} },
        ],
        edges: [
          { source: "a", target: "hub", relationship: "links_to", weight: 1 },
          { source: "b", target: "hub", relationship: "links_to", weight: 1 },
          { source: "c", target: "hub", relationship: "links_to", weight: 1 },
        ],
      };

      const ranks = engine.computePageRank(graph);
      const hubRank = ranks.get("hub")!;
      const aRank = ranks.get("a")!;

      // Hub should have higher rank since it receives links from all others
      expect(hubRank).toBeGreaterThan(aRank);
    });

    it("should converge to stable values", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
          { id: "b", type: "session", label: "B", content: "b", metadata: {} },
        ],
        edges: [
          { source: "a", target: "b", relationship: "links_to", weight: 1 },
          { source: "b", target: "a", relationship: "links_to", weight: 1 },
        ],
      };

      const ranks = engine.computePageRank(graph);

      // Symmetric graph -> equal ranks
      expect(ranks.get("a")!).toBeCloseTo(ranks.get("b")!, 3);

      // Ranks should sum to approximately 1
      let totalRank = 0;
      for (const rank of ranks.values()) {
        totalRank += rank;
      }
      expect(totalRank).toBeCloseTo(1.0, 2);
    });

    it("should handle dangling nodes (no outgoing edges)", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
          { id: "dangling", type: "session", label: "D", content: "d", metadata: {} },
        ],
        edges: [
          { source: "a", target: "dangling", relationship: "links_to", weight: 1 },
        ],
      };

      const ranks = engine.computePageRank(graph);
      // Should not throw or produce NaN
      expect(ranks.get("a")).toBeDefined();
      expect(ranks.get("dangling")).toBeDefined();
      expect(Number.isNaN(ranks.get("a")!)).toBe(false);
      expect(Number.isNaN(ranks.get("dangling")!)).toBe(false);
    });

    it("should ignore edges with non-existent endpoints", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
        ],
        edges: [
          { source: "a", target: "ghost", relationship: "links_to", weight: 1 },
          { source: "ghost", target: "a", relationship: "links_to", weight: 1 },
        ],
      };

      // Should not throw
      const ranks = engine.computePageRank(graph);
      expect(ranks.size).toBe(1);
      expect(ranks.get("a")).toBeDefined();
    });
  });

  describe("getPageRank", () => {
    it("should return 0 when no PageRank has been computed", () => {
      expect(engine.getPageRank("nonexistent")).toBe(0);
    });

    it("should return the PageRank score after computation", () => {
      const graph: KnowledgeGraph = {
        nodes: [
          { id: "a", type: "session", label: "A", content: "a", metadata: {} },
          { id: "b", type: "session", label: "B", content: "b", metadata: {} },
        ],
        edges: [
          { source: "a", target: "b", relationship: "links_to", weight: 1 },
        ],
      };
      engine.computePageRank(graph);
      expect(engine.getPageRank("a")).toBeGreaterThan(0);
      expect(engine.getPageRank("b")).toBeGreaterThan(0);
    });
  });

  describe("getEmbedding (fallback)", () => {
    it("should produce a 384-dimensional vector", async () => {
      const embedding = await engine.getEmbedding("Hello world");
      expect(embedding).toHaveLength(384);
    });

    it("should produce a normalized (unit) vector", async () => {
      const embedding = await engine.getEmbedding("Test text for embedding");
      const magnitude = Math.sqrt(
        embedding.reduce((sum, v) => sum + v * v, 0),
      );
      expect(magnitude).toBeCloseTo(1.0, 3);
    });

    it("should cache embeddings", async () => {
      const text = "Same text twice";
      const emb1 = await engine.getEmbedding(text);
      const emb2 = await engine.getEmbedding(text);
      expect(emb1).toBe(emb2); // Same reference from cache
    });

    it("should produce different vectors for different texts", async () => {
      const emb1 = await engine.getEmbedding("TypeScript generics");
      const emb2 = await engine.getEmbedding("Python decorators");
      // Not identical
      const identical = emb1.every((v, i) => v === emb2[i]);
      expect(identical).toBe(false);
    });
  });

  describe("extractEntities (keyword fallback)", () => {
    it("should extract entities from text using keyword frequency", async () => {
      const text =
        "TypeScript TypeScript TypeScript is great for building scalable applications. " +
        "React React React components make frontend development easier. " +
        "Testing testing helps ensure code quality.";

      const entities = await engine.extractEntities(text);
      expect(entities.length).toBeGreaterThan(0);

      const names = entities.map((e) => e.name);
      expect(names).toContain("typescript");
      expect(names).toContain("react");
    });

    it("should return only entities appearing at least twice", async () => {
      const text = "uniqueword1 uniqueword2 uniqueword3";
      const entities = await engine.extractEntities(text);
      expect(entities).toHaveLength(0); // no word appears twice
    });

    it("should cap at 20 entities", async () => {
      // Create text with many repeated words
      const words = Array.from({ length: 30 }, (_, i) => `keyword${i}`);
      const text = words.map((w) => `${w} ${w} ${w}`).join(" ");
      const entities = await engine.extractEntities(text);
      expect(entities.length).toBeLessThanOrEqual(20);
    });

    it("should type all fallback entities as concept", async () => {
      const text = "architecture architecture pattern pattern";
      const entities = await engine.extractEntities(text);
      for (const entity of entities) {
        expect(entity.type).toBe("concept");
      }
    });
  });

  describe("search (hybrid scoring)", () => {
    it("should return empty array for empty graph", async () => {
      const results = await engine.search("test", { nodes: [], edges: [] });
      expect(results).toEqual([]);
    });

    it("should return nodes scored by hybrid scoring", async () => {
      const graph: KnowledgeGraph = {
        nodes: [
          {
            id: "n1",
            type: "session",
            label: "TypeScript Tutorial",
            content: "TypeScript generics and type inference tutorial for beginners",
            embedding: await engine.getEmbedding("TypeScript generics and type inference tutorial"),
            metadata: {},
          },
          {
            id: "n2",
            type: "memory",
            label: "Python Guide",
            content: "Python data analysis with pandas and numpy",
            embedding: await engine.getEmbedding("Python data analysis with pandas"),
            metadata: {},
          },
        ],
        edges: [],
      };

      engine.computePageRank(graph);
      const results = await engine.search("TypeScript generics", graph, 10);
      expect(results.length).toBeGreaterThan(0);
      // TypeScript node should rank first
      expect(results[0].id).toBe("n1");
    });

    it("should respect the topK parameter", async () => {
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 20; i++) {
        nodes.push({
          id: `n${i}`,
          type: "session",
          label: `Node ${i}`,
          content: `Content about testing and software quality for node ${i}`,
          embedding: await engine.getEmbedding(`testing content ${i}`),
          metadata: {},
        });
      }

      const graph: KnowledgeGraph = { nodes, edges: [] };
      engine.computePageRank(graph);

      const results = await engine.search("testing software", graph, 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getGraph / clear", () => {
    it("should return empty graph initially", () => {
      const graph = engine.getGraph();
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });

    it("should clear the graph and caches", async () => {
      // Build some state
      await engine.getEmbedding("cached text");
      engine.computePageRank({
        nodes: [{ id: "a", type: "session", label: "A", content: "a", metadata: {} }],
        edges: [],
      });

      await engine.clear();

      const graph = engine.getGraph();
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      expect(engine.getPageRank("a")).toBe(0);
    });
  });
});
