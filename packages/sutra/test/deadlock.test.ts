import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommHub } from "../src/hub.js";
import { detectDeadlocks, resolveDeadlock } from "../src/deadlock.js";

describe("deadlock detection", () => {
  let hub: CommHub;

  beforeEach(() => {
    hub = new CommHub({ enableLogging: false, lockTimeout: 60_000 });
  });

  afterEach(() => {
    hub.destroy();
  });

  describe("detectDeadlocks", () => {
    it("should return empty when no locks exist", () => {
      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks).toEqual([]);
    });

    it("should return empty when locks exist but no waiting cycle", async () => {
      // Agent A holds res-1, Agent B holds res-2 -- no cycle
      await hub.acquireLock("res-1", "agent-a");
      await hub.acquireLock("res-2", "agent-b");

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks).toEqual([]);
    });

    it("should detect a simple 2-agent deadlock cycle", async () => {
      // Agent A holds res-1
      await hub.acquireLock("res-1", "agent-a");
      // Agent B holds res-2
      await hub.acquireLock("res-2", "agent-b");

      // Agent A tries to acquire res-2 (blocked by B)
      hub.acquireLock("res-2", "agent-a", 60_000).catch(() => {});
      // Agent B tries to acquire res-1 (blocked by A)
      hub.acquireLock("res-1", "agent-b", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks.length).toBeGreaterThanOrEqual(1);

      const cycle = deadlocks[0].cycle;
      expect(cycle).toContain("agent-a");
      expect(cycle).toContain("agent-b");

      const resources = deadlocks[0].resources;
      expect(resources.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect a 3-agent deadlock cycle", async () => {
      // A holds r1, B holds r2, C holds r3
      await hub.acquireLock("r1", "a");
      await hub.acquireLock("r2", "b");
      await hub.acquireLock("r3", "c");

      // A -> r2 (waits for B), B -> r3 (waits for C), C -> r1 (waits for A)
      hub.acquireLock("r2", "a", 60_000).catch(() => {});
      hub.acquireLock("r3", "b", 60_000).catch(() => {});
      hub.acquireLock("r1", "c", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks.length).toBeGreaterThanOrEqual(1);

      const allAgents = new Set(deadlocks.flatMap((d) => d.cycle));
      expect(allAgents.has("a")).toBe(true);
      expect(allAgents.has("b")).toBe(true);
      expect(allAgents.has("c")).toBe(true);
    });

    it("should return empty when agents wait but there is no cycle", async () => {
      // A holds r1, B waits on r1 -- no cycle, just waiting
      await hub.acquireLock("r1", "a");
      hub.acquireLock("r1", "b", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks).toEqual([]);
    });
  });

  describe("resolveDeadlock", () => {
    it("should force-release a lock using the 'youngest' strategy", async () => {
      await hub.acquireLock("r1", "old-agent");

      // Make a small time gap
      await new Promise((r) => setTimeout(r, 5));

      await hub.acquireLock("r2", "young-agent");

      // Set up deadlock
      hub.acquireLock("r2", "old-agent", 60_000).catch(() => {});
      hub.acquireLock("r1", "young-agent", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks.length).toBeGreaterThanOrEqual(1);

      const victim = resolveDeadlock(hub, deadlocks[0], "youngest");
      // The youngest (most recently acquired) should be the victim
      expect(typeof victim).toBe("string");
      expect(["old-agent", "young-agent"]).toContain(victim);
    });

    it("should force-release using the 'lowest-priority' strategy", async () => {
      await hub.acquireLock("r1", "agent-a");
      await hub.acquireLock("r2", "agent-b");

      hub.acquireLock("r2", "agent-a", 60_000).catch(() => {});
      hub.acquireLock("r1", "agent-b", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks.length).toBeGreaterThanOrEqual(1);

      const victim = resolveDeadlock(hub, deadlocks[0], "lowest-priority");
      // lowest-priority uses the first agent in the cycle
      expect(typeof victim).toBe("string");
      expect(deadlocks[0].cycle).toContain(victim);
    });

    it("should force-release using the 'random' strategy", async () => {
      await hub.acquireLock("r1", "agent-a");
      await hub.acquireLock("r2", "agent-b");

      hub.acquireLock("r2", "agent-a", 60_000).catch(() => {});
      hub.acquireLock("r1", "agent-b", 60_000).catch(() => {});

      const deadlocks = detectDeadlocks(hub);
      expect(deadlocks.length).toBeGreaterThanOrEqual(1);

      const victim = resolveDeadlock(hub, deadlocks[0], "random");
      expect(typeof victim).toBe("string");
    });

    it("should throw for an empty cycle", () => {
      expect(() =>
        resolveDeadlock(hub, { cycle: [], resources: [] }, "youngest"),
      ).toThrow("empty deadlock cycle");
    });

    it("should throw for a cycle with no resources", () => {
      expect(() =>
        resolveDeadlock(hub, { cycle: ["a", "b"], resources: [] }, "youngest"),
      ).toThrow("no resources");
    });
  });
});
