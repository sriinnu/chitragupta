import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs for session-store operations
vi.mock("fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    default: {
      existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
        return store.get(p)!;
      }),
      writeFileSync: vi.fn((p: string, data: string) => {
        store.set(p, data);
      }),
      mkdirSync: vi.fn((p: string, _opts?: any) => {
        // Simulate recursive: true by adding all ancestor directories
        dirs.add(p);
        let parent = p;
        while (true) {
          const next = parent.substring(0, parent.lastIndexOf("/"));
          if (!next || next === parent) break;
          dirs.add(next);
          parent = next;
        }
      }),
      readdirSync: vi.fn((dirPath: string, opts?: any) => {
        const files: any[] = [];
        for (const key of store.keys()) {
          if (key.startsWith(dirPath + "/") && key.endsWith(".md")) {
            const relative = key.slice(dirPath.length + 1);
            if (!relative.includes("/")) {
              if (opts?.withFileTypes) {
                files.push({
                  name: relative,
                  isDirectory: () => false,
                });
              } else {
                files.push(relative);
              }
            }
          }
        }
        for (const d of dirs) {
          if (d.startsWith(dirPath + "/")) {
            const relative = d.slice(dirPath.length + 1);
            const topLevel = relative.split("/")[0];
            if (opts?.withFileTypes) {
              if (!files.some((f: any) => f.name === topLevel)) {
                files.push({
                  name: topLevel,
                  isDirectory: () => true,
                });
              }
            }
          }
        }
        return files;
      }),
      unlinkSync: vi.fn((p: string) => { store.delete(p); }),
      rmdirSync: vi.fn((p: string) => { dirs.delete(p); }),
      appendFileSync: vi.fn((p: string, data: string) => {
        const existing = store.get(p) ?? "";
        store.set(p, existing + data);
      }),
    },
    __store: store,
    __dirs: dirs,
  };
});

import {
  branchSession,
  getSessionTree,
  createSession,
  addTurn,
  loadSession,
  saveSession,
  DatabaseManager,
  initAgentSchema,
} from "@chitragupta/smriti";
import { _resetDbInit } from "@chitragupta/smriti/session-store";
import { SessionError } from "@chitragupta/core";

/** Clear all session/turn data from SQLite to isolate tests. */
function clearDbTables(): void {
  try {
    const dbm = DatabaseManager.instance();
    initAgentSchema(dbm);
    const db = dbm.get("agent");
    db.exec("DELETE FROM turns_fts");
    db.exec("DELETE FROM turns");
    db.exec("DELETE FROM sessions");
  } catch {
    // DB may not be initialized yet — that's fine
  }
}

describe("branchSession", () => {
  let fsModule: any;

  beforeEach(async () => {
    DatabaseManager.reset();
    _resetDbInit();
    fsModule = await import("fs");
    fsModule.__store.clear();
    fsModule.__dirs.clear();
  });

  it("should create a branched session copying all turns", async () => {
    const original = createSession({
      project: "/test",
      title: "Original Session",
      tags: ["original"],
    });

    await addTurn(original.meta.id, "/test", {
      turnNumber: 1,
      role: "user",
      content: "Hello",
    });
    await addTurn(original.meta.id, "/test", {
      turnNumber: 2,
      role: "assistant",
      content: "Hi there!",
    });

    const branched = branchSession(original.meta.id, "/test", "experiment");

    expect(branched.meta.id).not.toBe(original.meta.id);
    expect(branched.meta.parent).toBe(original.meta.id);
    expect(branched.meta.branch).toBe("experiment");
    expect(branched.meta.title).toContain("[branch: experiment]");
    expect(branched.meta.tags).toContain("branch:experiment");
    expect(branched.turns).toHaveLength(2);
    expect(branched.turns[0].content).toBe("Hello");
    expect(branched.turns[1].content).toBe("Hi there!");
  });

  it("should branch from a specific turn number", async () => {
    const original = createSession({
      project: "/test",
      title: "Multi-turn",
    });

    await addTurn(original.meta.id, "/test", { turnNumber: 1, role: "user", content: "Turn 1" });
    await addTurn(original.meta.id, "/test", { turnNumber: 2, role: "assistant", content: "Turn 2" });
    await addTurn(original.meta.id, "/test", { turnNumber: 3, role: "user", content: "Turn 3" });

    const branched = branchSession(original.meta.id, "/test", "from-turn-2", 2);

    // Should only have turns 1 and 2
    expect(branched.turns).toHaveLength(2);
    expect(branched.turns[0].content).toBe("Turn 1");
    expect(branched.turns[1].content).toBe("Turn 2");
  });

  it("should throw when branching from a turn that does not exist", async () => {
    const original = createSession({ project: "/test" });
    await addTurn(original.meta.id, "/test", { turnNumber: 1, role: "user", content: "Only turn" });

    expect(() =>
      branchSession(original.meta.id, "/test", "bad-branch", 0),
    ).toThrow(SessionError);
  });

  it("should deep-clone turns to avoid reference sharing", async () => {
    const original = createSession({ project: "/test" });
    await addTurn(original.meta.id, "/test", {
      turnNumber: 1,
      role: "assistant",
      content: "Response",
      toolCalls: [{ name: "read_file", input: "{}", result: "ok" }],
    });

    const branched = branchSession(original.meta.id, "/test", "clone-test");

    // Modify the branched turns
    branched.turns[0].content = "Modified";
    branched.turns[0].toolCalls![0].name = "write_file";

    // Original should be unchanged when reloaded
    const reloaded = loadSession(original.meta.id, "/test");
    expect(reloaded.turns[0].content).toBe("Response");
  });

  it("should carry over cost and token data proportionally", async () => {
    const original = createSession({ project: "/test" });
    await addTurn(original.meta.id, "/test", { turnNumber: 1, role: "user", content: "A" });
    await addTurn(original.meta.id, "/test", { turnNumber: 2, role: "assistant", content: "B" });
    await addTurn(original.meta.id, "/test", { turnNumber: 3, role: "user", content: "C" });
    await addTurn(original.meta.id, "/test", { turnNumber: 4, role: "assistant", content: "D" });

    // Manually set cost/tokens on the original
    const loaded = loadSession(original.meta.id, "/test");
    loaded.meta.totalCost = 1.0;
    loaded.meta.totalTokens = 4000;
    saveSession(loaded);

    const branched = branchSession(original.meta.id, "/test", "partial", 2);
    // 2 of 4 turns = 50%
    expect(branched.meta.totalCost).toBeCloseTo(0.5, 2);
    expect(branched.meta.totalTokens).toBe(2000);
  });
});

describe("getSessionTree", () => {
  let fsModule: any;

  beforeEach(async () => {
    DatabaseManager.reset();
    _resetDbInit();
    clearDbTables();
    fsModule = await import("fs");
    fsModule.__store.clear();
    fsModule.__dirs.clear();
  });

  it("should return a tree with empty synthetic root when no sessions exist", () => {
    const tree = getSessionTree("/empty/project");
    expect(tree.root).toBeDefined();
    expect(tree.root.session.id).toBe("__root__");
    expect(tree.root.children).toHaveLength(0);
  });

  it("should build a simple tree from a single session", () => {
    createSession({ project: "/test", title: "Root Session" });
    const tree = getSessionTree("/test");

    // Single root session should be the tree root directly
    expect(tree.root.session.title).toBe("Root Session");
    expect(tree.root.children).toHaveLength(0);
  });

  it("should build a parent-child tree from branched sessions", async () => {
    const parent = createSession({ project: "/test", title: "Parent" });
    await addTurn(parent.meta.id, "/test", { turnNumber: 1, role: "user", content: "Start" });

    const child = branchSession(parent.meta.id, "/test", "child-branch");

    const tree = getSessionTree("/test");

    // Should be a tree with parent as root and child underneath
    expect(tree.root.session.title).toBe("Parent");
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0].session.id).toBe(child.meta.id);
  });

  it("should wrap multiple root sessions under a synthetic root", () => {
    createSession({ project: "/test", title: "Session A" });
    createSession({ project: "/test", title: "Session B" });

    const tree = getSessionTree("/test");

    // Multiple roots -> synthetic __root__
    expect(tree.root.session.id).toBe("__root__");
    expect(tree.root.children).toHaveLength(2);
  });
});
