import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs before importing the module
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
      appendFileSync: vi.fn((p: string, data: string) => {
        const existing = store.get(p) ?? "";
        store.set(p, existing + data);
      }),
      mkdirSync: vi.fn((p: string) => {
        dirs.add(p);
      }),
      unlinkSync: vi.fn((p: string) => {
        store.delete(p);
      }),
      readdirSync: vi.fn((dirPath: string, opts?: any) => {
        const results: any[] = [];
        for (const key of store.keys()) {
          if (key.startsWith(dirPath + "/")) {
            const relative = key.slice(dirPath.length + 1);
            const topLevel = relative.split("/")[0];
            if (opts?.withFileTypes) {
              const isDir = relative.includes("/");
              if (!results.some((r: any) => r.name === topLevel)) {
                results.push({
                  name: topLevel,
                  isDirectory: () => isDir,
                });
              }
            } else {
              if (!relative.includes("/")) {
                results.push(relative);
              }
            }
          }
        }
        return results;
      }),
      rmdirSync: vi.fn((p: string) => {
        dirs.delete(p);
      }),
    },
    __store: store,
    __dirs: dirs,
  };
});

import {
  getMemory,
  updateMemory,
  appendMemory,
  deleteMemory,
  listMemoryScopes,
} from "@chitragupta/smriti";
import { MemoryError } from "@chitragupta/core";
import type { MemoryScope } from "@chitragupta/smriti";

describe("MemoryStore", () => {
  let fsModule: any;

  beforeEach(async () => {
    fsModule = await import("fs");
    fsModule.__store.clear();
    fsModule.__dirs.clear();
    // Reset mock call history so mock.calls[0] reflects this test only
    vi.clearAllMocks();
  });

  describe("getMemory", () => {
    it("should return empty string when no memory file exists for global scope", () => {
      const content = getMemory({ type: "global" });
      expect(content).toBe("");
    });

    it("should return content of global memory file", async () => {
      const scope: MemoryScope = { type: "global" };
      await updateMemory(scope, "Global knowledge here");
      const content = getMemory(scope);
      expect(content).toBe("Global knowledge here");
    });

    it("should throw MemoryError for session scope", () => {
      expect(() => getMemory({ type: "session", sessionId: "s-1" })).toThrow(MemoryError);
      expect(() => getMemory({ type: "session", sessionId: "s-1" })).toThrow(
        "Session memory is stored within the session file",
      );
    });

    it("should work with project scope", async () => {
      const scope: MemoryScope = { type: "project", path: "/my/project" };
      await updateMemory(scope, "Project-specific memory");
      const content = getMemory(scope);
      expect(content).toBe("Project-specific memory");
    });

    it("should work with agent scope", async () => {
      const scope: MemoryScope = { type: "agent", agentId: "chitragupta" };
      await updateMemory(scope, "Agent memory");
      const content = getMemory(scope);
      expect(content).toBe("Agent memory");
    });
  });

  describe("updateMemory", () => {
    it("should write memory content for global scope", async () => {
      const scope: MemoryScope = { type: "global" };
      await updateMemory(scope, "Updated global memory");

      expect(fsModule.default.writeFileSync).toHaveBeenCalled();
      const content = getMemory(scope);
      expect(content).toBe("Updated global memory");
    });

    it("should create parent directories", async () => {
      await updateMemory({ type: "global" }, "test");
      expect(fsModule.default.mkdirSync).toHaveBeenCalled();
    });

    it("should throw MemoryError for session scope", () => {
      expect(() =>
        updateMemory({ type: "session", sessionId: "s-1" }, "content"),
      ).toThrow(MemoryError);
    });

    it("should overwrite existing content", async () => {
      const scope: MemoryScope = { type: "global" };
      await updateMemory(scope, "First version");
      await updateMemory(scope, "Second version");
      const content = getMemory(scope);
      expect(content).toBe("Second version");
    });
  });

  describe("appendMemory", () => {
    it("should create file with header when appending to new memory", async () => {
      const scope: MemoryScope = { type: "global" };
      await appendMemory(scope, "First entry");

      // For new files, writeFileSync is used with header
      expect(fsModule.default.writeFileSync).toHaveBeenCalled();
    });

    it("should append to existing memory file", async () => {
      const scope: MemoryScope = { type: "global" };
      // First create the file
      await updateMemory(scope, "# Global Memory\n\nExisting content");
      // Then append
      await appendMemory(scope, "New entry");

      expect(fsModule.default.appendFileSync).toHaveBeenCalled();
    });

    it("should throw MemoryError for session scope", () => {
      expect(() =>
        appendMemory({ type: "session", sessionId: "s-1" }, "content"),
      ).toThrow(MemoryError);
    });

    it("should include timestamp in appended entry", async () => {
      const scope: MemoryScope = { type: "global" };
      // Create the initial file so append uses appendFileSync
      await updateMemory(scope, "# Global Memory");
      await appendMemory(scope, "My new entry");

      // Check the appendFileSync call args
      const appendCall = fsModule.default.appendFileSync.mock.calls[0];
      expect(appendCall[1]).toContain("---"); // separator
      expect(appendCall[1]).toContain("My new entry");
    });
  });

  describe("deleteMemory", () => {
    it("should delete an existing memory file", async () => {
      const scope: MemoryScope = { type: "global" };
      await updateMemory(scope, "To be deleted");
      deleteMemory(scope);
      expect(fsModule.default.unlinkSync).toHaveBeenCalled();
    });

    it("should not throw when file does not exist", () => {
      expect(() => deleteMemory({ type: "global" })).not.toThrow();
    });

    it("should throw MemoryError for session scope", () => {
      expect(() =>
        deleteMemory({ type: "session", sessionId: "s-1" }),
      ).toThrow(MemoryError);
    });
  });

  describe("listMemoryScopes", () => {
    it("should return empty array when no memory files exist", () => {
      const scopes = listMemoryScopes();
      expect(scopes).toEqual([]);
    });

    it("should list global scope when global.md exists", async () => {
      await updateMemory({ type: "global" }, "content");
      const scopes = listMemoryScopes();
      expect(scopes.some((s) => s.type === "global")).toBe(true);
    });
  });
});
