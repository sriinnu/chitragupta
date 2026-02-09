import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs to prevent real disk I/O
vi.mock("fs", () => {
  return {
    default: {
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      unlinkSync: vi.fn(),
      rmdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    },
  };
});

// Mock the database layer so FTS5 path throws, forcing BM25 fallback.
// These tests are specifically for the BM25 fallback codepath.
vi.mock("../src/db/database.js", () => ({
  DatabaseManager: {
    instance: () => ({
      get: () => { throw new Error("DB mocked out for BM25 tests"); },
    }),
    reset: vi.fn(),
  },
}));

vi.mock("../src/db/schema.js", () => ({
  initAgentSchema: vi.fn(),
}));

// Mock the session-store and memory-store to provide controlled test data
const mockListSessions = vi.fn<(project?: string) => any[]>(() => []);
const mockLoadSession = vi.fn<(id: string, project: string) => any>(() => ({ meta: {}, turns: [] }));
const mockGetMemory = vi.fn<(scope: any) => string>(() => "");
const mockListMemoryScopes = vi.fn<() => any[]>(() => []);

vi.mock("../src/session-store.js", () => ({
  listSessions: (project?: string) => mockListSessions(project),
  loadSession: (id: string, project: string) => mockLoadSession(id, project),
}));

vi.mock("../src/memory-store.js", () => ({
  getMemory: (scope: any) => mockGetMemory(scope),
  listMemoryScopes: () => mockListMemoryScopes(),
}));

import { searchSessions, searchMemory } from "@chitragupta/smriti";
import type { SessionMeta } from "@chitragupta/smriti";

function makeSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? "s-test-001",
    title: overrides.title ?? "Default Title",
    created: overrides.created ?? "2025-01-01T00:00:00.000Z",
    updated: overrides.updated ?? "2025-01-01T00:00:00.000Z",
    agent: overrides.agent ?? "chitragupta",
    model: overrides.model ?? "test",
    project: overrides.project ?? "/test",
    parent: overrides.parent ?? null,
    branch: overrides.branch ?? null,
    tags: overrides.tags ?? [],
    totalCost: overrides.totalCost ?? 0,
    totalTokens: overrides.totalTokens ?? 0,
  };
}

describe("searchSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockReturnValue([]);
    mockLoadSession.mockReturnValue({ meta: {}, turns: [] });
  });

  it("should return empty array for empty query", () => {
    expect(searchSessions("")).toEqual([]);
    expect(searchSessions("   ")).toEqual([]);
  });

  it("should return empty array when no sessions exist", () => {
    mockListSessions.mockReturnValue([]);
    const results = searchSessions("typescript");
    expect(results).toEqual([]);
  });

  it("should find sessions by title match", () => {
    const meta1 = makeSessionMeta({
      id: "s-1",
      title: "TypeScript generics tutorial",
    });
    const meta2 = makeSessionMeta({
      id: "s-2",
      title: "Python data analysis",
    });

    mockListSessions.mockReturnValue([meta1, meta2]);
    mockLoadSession.mockImplementation((id: string) => ({
      meta: id === "s-1" ? meta1 : meta2,
      turns: [{ turnNumber: 1, role: "user", content: id === "s-1" ? "Explain TypeScript generics" : "Show me pandas" }],
    }));

    const results = searchSessions("typescript generics");
    expect(results.length).toBeGreaterThan(0);
    // TypeScript session should rank higher
    expect(results[0].id).toBe("s-1");
  });

  it("should find sessions by content match", () => {
    const meta1 = makeSessionMeta({ id: "s-1", title: "Session One" });
    const meta2 = makeSessionMeta({ id: "s-2", title: "Session Two" });

    mockListSessions.mockReturnValue([meta1, meta2]);
    mockLoadSession.mockImplementation((id: string) => ({
      meta: id === "s-1" ? meta1 : meta2,
      turns: [
        {
          turnNumber: 1,
          role: "user",
          content: id === "s-1"
            ? "I need help with React hooks useEffect"
            : "How to deploy Docker containers",
        },
      ],
    }));

    const results = searchSessions("React hooks");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("s-1");
  });

  it("should apply recency boost to recently updated sessions", () => {
    const oldMeta = makeSessionMeta({
      id: "s-old",
      title: "TypeScript patterns",
      updated: "2020-01-01T00:00:00.000Z",
    });
    const newMeta = makeSessionMeta({
      id: "s-new",
      title: "TypeScript patterns",
      updated: new Date().toISOString(),
    });

    mockListSessions.mockReturnValue([oldMeta, newMeta]);
    mockLoadSession.mockImplementation((id: string) => ({
      meta: id === "s-old" ? oldMeta : newMeta,
      turns: [
        { turnNumber: 1, role: "user", content: "TypeScript design patterns discussion" },
      ],
    }));

    const results = searchSessions("TypeScript patterns");
    expect(results.length).toBe(2);
    // The recently updated session should rank first due to recency boost
    expect(results[0].id).toBe("s-new");
  });

  it("should give higher weight to title matches", () => {
    const titleMatch = makeSessionMeta({
      id: "s-title",
      title: "kubernetes deployment strategies",
    });
    const contentMatch = makeSessionMeta({
      id: "s-content",
      title: "Random discussion",
    });

    mockListSessions.mockReturnValue([titleMatch, contentMatch]);
    mockLoadSession.mockImplementation((id: string) => ({
      meta: id === "s-title" ? titleMatch : contentMatch,
      turns: [
        {
          turnNumber: 1,
          role: "user",
          content: id === "s-title"
            ? "Help with my cluster"
            : "kubernetes deployment strategies for microservices with kubernetes deployment",
        },
      ],
    }));

    const results = searchSessions("kubernetes deployment");
    expect(results.length).toBeGreaterThan(0);
    // Title match should rank higher since title is repeated 3x for weight boost
    expect(results[0].id).toBe("s-title");
  });

  it("should handle sessions that fail to load gracefully", () => {
    const meta = makeSessionMeta({ id: "s-broken", title: "Broken" });
    mockListSessions.mockReturnValue([meta]);
    mockLoadSession.mockImplementation(() => {
      throw new Error("Corrupted file");
    });

    // Should not throw -- just index based on meta only
    expect(() => searchSessions("anything")).not.toThrow();
  });
});

describe("searchMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMemoryScopes.mockReturnValue([]);
    mockGetMemory.mockReturnValue("");
  });

  it("should return empty array for empty query", () => {
    expect(searchMemory("")).toEqual([]);
  });

  it("should return empty array when no memory scopes exist", () => {
    mockListMemoryScopes.mockReturnValue([]);
    const results = searchMemory("test");
    expect(results).toEqual([]);
  });

  it("should find relevant memory by content", () => {
    mockListMemoryScopes.mockReturnValue([
      { type: "global" },
      { type: "agent", agentId: "chitragupta" },
    ]);
    mockGetMemory.mockImplementation((scope: any) => {
      if (scope.type === "global") return "The user prefers TypeScript and React for frontend development.";
      if (scope.type === "agent") return "Agent configuration settings for deployment.";
      return "";
    });

    const results = searchMemory("TypeScript React frontend");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].scope.type).toBe("global");
    expect(results[0].relevance).toBe(1); // highest score is normalized to 1
  });

  it("should normalize relevance scores to 0-1 range", () => {
    mockListMemoryScopes.mockReturnValue([
      { type: "global" },
      { type: "agent", agentId: "test" },
    ]);
    mockGetMemory.mockImplementation((scope: any) => {
      if (scope.type === "global") return "TypeScript best practices and patterns.";
      if (scope.type === "agent") return "TypeScript is mentioned once here.";
      return "";
    });

    const results = searchMemory("TypeScript");
    for (const result of results) {
      expect(result.relevance).toBeGreaterThanOrEqual(0);
      expect(result.relevance).toBeLessThanOrEqual(1);
    }
    // Top result should have relevance = 1 (normalized max)
    if (results.length > 0) {
      expect(results[0].relevance).toBe(1);
    }
  });
});
