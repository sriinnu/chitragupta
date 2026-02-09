import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommHub } from "../src/hub.js";
import { fanOut, pipeline, mapReduce, saga, election, gossip } from "../src/patterns.js";

describe("patterns", () => {
  let hub: CommHub;

  beforeEach(() => {
    hub = new CommHub({ enableLogging: false });
  });

  afterEach(() => {
    hub.destroy();
  });

  /**
   * Helper: subscribe an agent that auto-replies with a transformed payload.
   */
  function autoReply(agentId: string, topic: string, transform: (payload: unknown) => unknown): void {
    hub.subscribe(agentId, topic, (env) => {
      hub.reply(env.id, agentId, transform(env.payload));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // fanOut
  // ═══════════════════════════════════════════════════════════════════════

  describe("fanOut", () => {
    it("should send to all target agents and collect responses", async () => {
      autoReply("worker-1", "process", (p) => `processed-1: ${p}`);
      autoReply("worker-2", "process", (p) => `processed-2: ${p}`);
      autoReply("worker-3", "process", (p) => `processed-3: ${p}`);

      const results = await fanOut(
        hub,
        "coordinator",
        "process",
        "data",
        ["worker-1", "worker-2", "worker-3"],
        5000,
      );

      expect(results.size).toBe(3);
      expect(results.get("worker-1")).toBe("processed-1: data");
      expect(results.get("worker-2")).toBe("processed-2: data");
      expect(results.get("worker-3")).toBe("processed-3: data");
    });

    it("should handle partial failures gracefully", async () => {
      autoReply("good", "task", () => "ok");
      // "bad" agent is subscribed but never replies
      hub.subscribe("bad", "task", () => {});

      const results = await fanOut(
        hub,
        "coord",
        "task",
        "data",
        ["good", "bad"],
        100,
      );

      // good agent replied, bad timed out (submitted as error)
      expect(results.size).toBeGreaterThanOrEqual(1);
      expect(results.get("good")).toBe("ok");
    });

    it("should return empty results for empty target list", async () => {
      const results = await fanOut(hub, "coord", "t", "d", [], 100);
      expect(results.size).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // pipeline
  // ═══════════════════════════════════════════════════════════════════════

  describe("pipeline", () => {
    it("should chain stages sequentially, passing output as next input", async () => {
      autoReply("stage-a", "transform", (p) => (p as number) * 2);
      autoReply("stage-b", "transform", (p) => (p as number) + 10);
      autoReply("stage-c", "transform", (p) => `result: ${p}`);

      const result = await pipeline(
        hub,
        [
          { agentId: "stage-a", topic: "transform" },
          { agentId: "stage-b", topic: "transform" },
          { agentId: "stage-c", topic: "transform" },
        ],
        5,
        5000,
      );

      // 5 * 2 = 10, 10 + 10 = 20, "result: 20"
      expect(result).toBe("result: 20");
    });

    it("should return the initial payload when stages is empty", async () => {
      const result = await pipeline(hub, [], "unchanged", 5000);
      expect(result).toBe("unchanged");
    });

    it("should reject if a stage times out", async () => {
      // stage never replies
      hub.subscribe("slow", "task", () => {});

      await expect(
        pipeline(hub, [{ agentId: "slow", topic: "task" }], "data", 50),
      ).rejects.toThrow("timed out");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // mapReduce
  // ═══════════════════════════════════════════════════════════════════════

  describe("mapReduce", () => {
    it("should partition data, map, and reduce", async () => {
      // Map agents: sum their chunk
      autoReply("mapper-1", "__map__", (p: unknown) => {
        const data = p as { chunk: number[] };
        return data.chunk.reduce((a: number, b: number) => a + b, 0);
      });
      autoReply("mapper-2", "__map__", (p: unknown) => {
        const data = p as { chunk: number[] };
        return data.chunk.reduce((a: number, b: number) => a + b, 0);
      });

      // Reduce agent: sum all map results
      autoReply("reducer", "__reduce__", (p: unknown) => {
        const data = p as { results: Array<[string, number]> };
        return data.results.reduce((sum: number, [, val]: [string, number]) => sum + val, 0);
      });

      const result = await mapReduce(
        hub,
        ["mapper-1", "mapper-2"],
        "reducer",
        [1, 2, 3, 4, 5, 6],
        5000,
      );

      // [1,2,3] -> 6, [4,5,6] -> 15, total = 21
      expect(result).toBe(21);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // saga
  // ═══════════════════════════════════════════════════════════════════════

  describe("saga", () => {
    it("should execute all steps successfully", async () => {
      const executed: string[] = [];

      autoReply("svc-a", "step-a", () => {
        executed.push("a");
        return "ok";
      });
      autoReply("svc-b", "step-b", () => {
        executed.push("b");
        return "ok";
      });
      autoReply("svc-a", "undo-a", () => "undone-a");
      autoReply("svc-b", "undo-b", () => "undone-b");

      await saga(
        hub,
        [
          {
            agentId: "svc-a",
            topic: "step-a",
            payload: {},
            compensate: { agentId: "svc-a", topic: "undo-a", payload: {} },
          },
          {
            agentId: "svc-b",
            topic: "step-b",
            payload: {},
            compensate: { agentId: "svc-b", topic: "undo-b", payload: {} },
          },
        ],
        5000,
      );

      expect(executed).toEqual(["a", "b"]);
    });

    it("should compensate completed steps when a step fails", async () => {
      const compensated: string[] = [];

      autoReply("svc-a", "step-a", () => "ok");
      autoReply("svc-a", "undo-a", () => {
        compensated.push("a-undone");
        return "undone";
      });

      // svc-b will not reply, causing timeout -> failure
      hub.subscribe("svc-b", "step-b", () => {});

      await expect(
        saga(
          hub,
          [
            {
              agentId: "svc-a",
              topic: "step-a",
              payload: {},
              compensate: { agentId: "svc-a", topic: "undo-a", payload: {} },
            },
            {
              agentId: "svc-b",
              topic: "step-b",
              payload: {},
              compensate: { agentId: "svc-b", topic: "undo-b", payload: {} },
            },
          ],
          100,
        ),
      ).rejects.toThrow("Saga failed");

      expect(compensated).toContain("a-undone");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // election (bully algorithm)
  // ═══════════════════════════════════════════════════════════════════════

  describe("election", () => {
    it("should elect the highest-indexed candidate (bully algorithm)", async () => {
      const winner = await election(hub, ["low", "mid", "high"], 500);
      expect(winner).toBe("high");
    });

    it("should return the only candidate immediately", async () => {
      const winner = await election(hub, ["solo"], 500);
      expect(winner).toBe("solo");
    });

    it("should throw with zero candidates", async () => {
      await expect(election(hub, [], 500)).rejects.toThrow("zero candidates");
    });

    it("should elect among two candidates", async () => {
      const winner = await election(hub, ["alpha", "beta"], 500);
      expect(winner).toBe("beta");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // gossip
  // ═══════════════════════════════════════════════════════════════════════

  describe("gossip", () => {
    it("should not throw when gossipping with no known peers", () => {
      // No subscribers, no history - should still work
      expect(() => gossip(hub, "agent-a", "topic", { info: "data" }, 3)).not.toThrow();
    });

    it("should send to available peers from message history", () => {
      // Create some message history to discover peers
      hub.subscribe("peer-1", "info", () => {});
      hub.subscribe("peer-2", "info", () => {});
      hub.subscribe("agent-a", "info", () => {});

      // Simulate messages from peers
      hub.send({ from: "peer-1", to: "*", topic: "info", payload: "hello", priority: "normal" });
      hub.send({ from: "peer-2", to: "*", topic: "info", payload: "hello", priority: "normal" });

      // Now gossip from agent-a
      expect(() => gossip(hub, "agent-a", "info", { rumor: "latest" }, 3)).not.toThrow();
    });

    it("should respect the fanout factor", () => {
      hub.subscribe("a", "topic", () => {});
      hub.subscribe("b", "topic", () => {});
      hub.subscribe("c", "topic", () => {});

      // Create history
      hub.send({ from: "b", to: "*", topic: "topic", payload: 1, priority: "normal" });
      hub.send({ from: "c", to: "*", topic: "topic", payload: 2, priority: "normal" });

      // Gossip with fanout=1 should send to at most 1 peer
      const beforeCount = hub.getStats().totalMessages;
      gossip(hub, "a", "topic", { data: true }, 1);
      const afterCount = hub.getStats().totalMessages;

      // At most 1 new message should be sent
      expect(afterCount - beforeCount).toBeLessThanOrEqual(1);
    });
  });
});
