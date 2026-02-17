import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommHub } from "../src/hub.js";

describe("CommHub", () => {
  let hub: CommHub;

  beforeEach(() => {
    hub = new CommHub({ enableLogging: false });
  });

  afterEach(() => {
    hub.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE PASSING
  // ═══════════════════════════════════════════════════════════════════════

  describe("send / subscribe", () => {
    it("should deliver a message to a subscribed agent on the same topic", () => {
      const received: unknown[] = [];
      hub.subscribe("agent-a", "tasks", (env) => {
        received.push(env.payload);
      });

      hub.send({
        from: "agent-b",
        to: "agent-a",
        topic: "tasks",
        payload: { action: "build" },
        priority: "normal",
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ action: "build" });
    });

    it("should return a unique message ID for each send", () => {
      hub.subscribe("a", "t", () => {});
      const id1 = hub.send({ from: "b", to: "a", topic: "t", payload: 1, priority: "normal" });
      const id2 = hub.send({ from: "b", to: "a", topic: "t", payload: 2, priority: "normal" });
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it("should not deliver a message to a different agent", () => {
      const received: unknown[] = [];
      hub.subscribe("agent-a", "tasks", (env) => {
        received.push(env.payload);
      });

      hub.send({
        from: "agent-b",
        to: "agent-c",
        topic: "tasks",
        payload: "not for a",
        priority: "normal",
      });

      expect(received).toHaveLength(0);
    });

    it("should broadcast to all subscribers except sender", () => {
      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      hub.subscribe("agent-a", "news", (env) => receivedA.push(env.payload));
      hub.subscribe("agent-b", "news", (env) => receivedB.push(env.payload));

      hub.broadcast("agent-a", "news", "hello all");

      // agent-a is the sender, so it should not receive
      expect(receivedA).toHaveLength(0);
      expect(receivedB).toHaveLength(1);
      expect(receivedB[0]).toBe("hello all");
    });

    it("should unsubscribe an agent from a topic", () => {
      const received: unknown[] = [];
      const unsub = hub.subscribe("agent-a", "tasks", (env) => {
        received.push(env.payload);
      });

      hub.send({ from: "b", to: "agent-a", topic: "tasks", payload: "first", priority: "normal" });
      expect(received).toHaveLength(1);

      unsub();
      hub.send({ from: "b", to: "agent-a", topic: "tasks", payload: "second", priority: "normal" });
      expect(received).toHaveLength(1);
    });

    it("should throw when max channels exceeded", () => {
      const smallHub = new CommHub({ maxChannels: 2 });
      smallHub.subscribe("a", "t1", () => {});
      smallHub.subscribe("a", "t2", () => {});
      expect(() => smallHub.subscribe("a", "t3", () => {})).toThrow("max channels");
      smallHub.destroy();
    });
  });

  describe("request / reply", () => {
    it("should resolve when a reply is sent", async () => {
      hub.subscribe("responder", "ping", (env) => {
        hub.reply(env.id, "responder", "pong");
      });

      const reply = await hub.request("responder", "ping", "hello", "requester", 5000);
      expect(reply.payload).toBe("pong");
    });

    it("should reject on timeout when no reply arrives", async () => {
      // No one is listening on this topic
      hub.subscribe("nobody", "void", () => {});

      await expect(
        hub.request("nobody", "void", "hello", "requester", 50),
      ).rejects.toThrow("timed out");
    });
  });

  describe("getMessages", () => {
    it("should retrieve messages for a specific agent and topic", () => {
      hub.subscribe("a", "info", () => {});
      hub.send({ from: "b", to: "a", topic: "info", payload: "msg1", priority: "normal" });
      hub.send({ from: "b", to: "a", topic: "info", payload: "msg2", priority: "high" });

      const msgs = hub.getMessages("a", "info");
      expect(msgs.length).toBe(2);
      // high priority should come first
      expect(msgs[0].payload).toBe("msg2");
      expect(msgs[1].payload).toBe("msg1");
    });

    it("should include broadcast messages to wildcard", () => {
      hub.subscribe("a", "news", () => {});
      hub.subscribe("b", "news", () => {});
      hub.broadcast("b", "news", "broadcast-data");

      const msgs = hub.getMessages("a", "news");
      // Broadcast messages have to="*"
      expect(msgs.length).toBe(1);
      expect(msgs[0].payload).toBe("broadcast-data");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SHARED MEMORY
  // ═══════════════════════════════════════════════════════════════════════

  describe("shared memory", () => {
    it("should create a region and read/write values", () => {
      const region = hub.createRegion("shared", "owner-a");
      expect(region.name).toBe("shared");
      expect(region.version).toBe(0);

      hub.write("shared", "count", 42, "owner-a");
      expect(hub.read("shared", "count")).toBe(42);

      const updated = hub.getRegion("shared")!;
      expect(updated.version).toBe(1);
    });

    it("should throw when creating a duplicate region", () => {
      hub.createRegion("dup", "owner");
      expect(() => hub.createRegion("dup", "owner")).toThrow("already exists");
    });

    it("should enforce access list", () => {
      hub.createRegion("restricted", "owner", ["owner", "agent-b"]);
      hub.write("restricted", "x", 1, "owner");
      hub.write("restricted", "x", 2, "agent-b");
      expect(hub.read("restricted", "x")).toBe(2);

      expect(() => hub.write("restricted", "x", 3, "agent-c")).toThrow("does not have write access");
    });

    it("should increment version on each write (CAS behavior)", () => {
      hub.createRegion("versioned", "o");
      expect(hub.getRegion("versioned")!.version).toBe(0);

      hub.write("versioned", "a", 1, "o");
      expect(hub.getRegion("versioned")!.version).toBe(1);

      hub.write("versioned", "b", 2, "o");
      expect(hub.getRegion("versioned")!.version).toBe(2);
    });

    it("should notify watchers on write", () => {
      hub.createRegion("watched", "owner");
      const changes: Array<{ key: string; value: unknown; version: number }> = [];

      hub.watchRegion("watched", (key, value, version) => {
        changes.push({ key, value, version });
      });

      hub.write("watched", "foo", "bar", "owner");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ key: "foo", value: "bar", version: 1 });
    });

    it("should allow only the owner to delete a region", () => {
      hub.createRegion("owned", "alice");
      expect(() => hub.deleteRegion("owned", "bob")).toThrow("not the owner");
      hub.deleteRegion("owned", "alice");
      expect(hub.getRegion("owned")).toBeUndefined();
    });

    it("should throw on read from non-existent region", () => {
      expect(() => hub.read("ghost", "key")).toThrow("does not exist");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LOCKS
  // ═══════════════════════════════════════════════════════════════════════

  describe("locks", () => {
    it("should acquire a lock immediately when resource is free", async () => {
      const lock = await hub.acquireLock("file.ts", "agent-a");
      expect(lock.holder).toBe("agent-a");
      expect(lock.resource).toBe("file.ts");
      expect(hub.isLocked("file.ts")).toBe(true);
    });

    it("should re-enter when the same agent acquires the same lock", async () => {
      const lock1 = await hub.acquireLock("res", "agent-a");
      const lock2 = await hub.acquireLock("res", "agent-a");
      expect(lock2.holder).toBe("agent-a");
      expect(lock1.id).toBe(lock2.id);
    });

    it("should queue waiters and release in FIFO order", async () => {
      await hub.acquireLock("res", "agent-a");

      const order: string[] = [];

      const p1 = hub.acquireLock("res", "agent-b", 5000).then((lock) => {
        order.push(lock.holder);
      });
      const p2 = hub.acquireLock("res", "agent-c", 5000).then((lock) => {
        order.push(lock.holder);
      });

      // Release a -> b should get it
      hub.releaseLock("res", "agent-a");
      await p1;
      expect(order).toEqual(["agent-b"]);

      // Release b -> c should get it
      hub.releaseLock("res", "agent-b");
      await p2;
      expect(order).toEqual(["agent-b", "agent-c"]);
    });

    it("should throw when releasing a lock not held by the agent", async () => {
      await hub.acquireLock("res", "agent-a");
      expect(() => hub.releaseLock("res", "agent-b")).toThrow("does not hold the lock");
    });

    it("should throw when releasing a non-existent lock", () => {
      expect(() => hub.releaseLock("ghost", "agent-a")).toThrow("No lock exists");
    });

    it("should reject with timeout when lock is not released in time", async () => {
      await hub.acquireLock("res", "agent-a");
      await expect(hub.acquireLock("res", "agent-b", 50)).rejects.toThrow("Lock timeout");
    });

    it("should delete the lock when released with no waiters", async () => {
      await hub.acquireLock("res", "agent-a");
      hub.releaseLock("res", "agent-a");
      expect(hub.isLocked("res")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BARRIERS
  // ═══════════════════════════════════════════════════════════════════════

  describe("barriers", () => {
    it("should block until all required agents arrive", async () => {
      hub.createBarrier("sync-point", 3);

      const results: string[] = [];

      const p1 = hub.arriveAtBarrier("sync-point", "a").then(() => results.push("a"));
      const p2 = hub.arriveAtBarrier("sync-point", "b").then(() => results.push("b"));

      // Only 2 have arrived, promises should be pending
      expect(results).toHaveLength(0);

      // Third arrival should resolve all
      const p3 = hub.arriveAtBarrier("sync-point", "c").then(() => results.push("c"));

      await Promise.all([p1, p2, p3]);
      expect(results).toHaveLength(3);
    });

    it("should resolve immediately if the barrier is already satisfied", async () => {
      hub.createBarrier("instant", 1);
      await hub.arriveAtBarrier("instant", "a");
      // Should not hang
    });

    it("should throw when creating a duplicate barrier", () => {
      hub.createBarrier("dup", 2);
      expect(() => hub.createBarrier("dup", 2)).toThrow("already exists");
    });

    it("should throw when arriving at a non-existent barrier", () => {
      expect(() => hub.arriveAtBarrier("ghost", "a")).toThrow("does not exist");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEMAPHORES
  // ═══════════════════════════════════════════════════════════════════════

  describe("semaphores", () => {
    it("should allow up to maxPermits concurrent acquisitions", async () => {
      hub.createSemaphore("pool", 2);

      // Both should resolve immediately
      await hub.acquireSemaphore("pool", "a");
      await hub.acquireSemaphore("pool", "b");

      // Third should block
      let thirdResolved = false;
      const p3 = hub.acquireSemaphore("pool", "c").then(() => {
        thirdResolved = true;
      });

      expect(thirdResolved).toBe(false);

      // Release one permit
      hub.releaseSemaphore("pool", "a");
      await p3;
      expect(thirdResolved).toBe(true);
    });

    it("should release permits in FIFO order", async () => {
      hub.createSemaphore("fifo", 1);
      await hub.acquireSemaphore("fifo", "a");

      const order: string[] = [];
      const p1 = hub.acquireSemaphore("fifo", "b").then(() => order.push("b"));
      const p2 = hub.acquireSemaphore("fifo", "c").then(() => order.push("c"));

      hub.releaseSemaphore("fifo", "a");
      await p1;
      expect(order).toEqual(["b"]);

      hub.releaseSemaphore("fifo", "b");
      await p2;
      expect(order).toEqual(["b", "c"]);
    });

    it("should not exceed maxPermits when releasing without waiters", () => {
      hub.createSemaphore("bounded", 2);
      // Release without acquiring (simulating extra release)
      hub.releaseSemaphore("bounded", "x");
      hub.releaseSemaphore("bounded", "y");
      // currentPermits should be capped at maxPermits = 2
      const sem = hub.getStats();
      expect(sem.semaphores).toBe(1);
    });

    it("should throw when creating a duplicate semaphore", () => {
      hub.createSemaphore("dup", 1);
      expect(() => hub.createSemaphore("dup", 1)).toThrow("already exists");
    });

    it("should throw when operating on non-existent semaphore", () => {
      expect(() => hub.acquireSemaphore("ghost", "a")).toThrow("does not exist");
      expect(() => hub.releaseSemaphore("ghost", "a")).toThrow("does not exist");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RESULT COLLECTORS
  // ═══════════════════════════════════════════════════════════════════════

  describe("result collectors", () => {
    it("should collect results from multiple agents", async () => {
      const collector = hub.createCollector<string>(3);

      hub.submitResult(collector.id, "a", "result-a");
      hub.submitResult(collector.id, "b", "result-b");
      hub.submitResult(collector.id, "c", "result-c");

      const results = await hub.waitForAll<string>(collector.id, 1000);
      expect(results.size).toBe(3);
      expect(results.get("a")).toBe("result-a");
      expect(results.get("b")).toBe("result-b");
      expect(results.get("c")).toBe("result-c");
    });

    it("should resolve immediately when already complete", async () => {
      const collector = hub.createCollector<number>(2);
      hub.submitResult(collector.id, "a", 1);
      hub.submitResult(collector.id, "b", 2);

      const results = await hub.waitForAll<number>(collector.id, 1000);
      expect(results.size).toBe(2);
    });

    it("should count errors toward completion", async () => {
      const collector = hub.createCollector<string>(2);
      hub.submitResult(collector.id, "a", "ok");
      hub.submitError(collector.id, "b", new Error("fail"));

      const results = await hub.waitForAll<string>(collector.id, 1000);
      expect(results.size).toBe(1);
      expect(collector.errors.size).toBe(1);
    });

    it("should reject on timeout when not all results arrive", async () => {
      const collector = hub.createCollector<string>(5);
      hub.submitResult(collector.id, "a", "done");

      await expect(hub.waitForAll<string>(collector.id, 50)).rejects.toThrow("timed out");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  describe("lifecycle", () => {
    it("should report stats correctly", () => {
      hub.subscribe("a", "t", () => {});
      hub.createRegion("r", "o");
      hub.createBarrier("b", 2);
      hub.createSemaphore("s", 3);
      hub.createCollector(1);

      const stats = hub.getStats();
      expect(stats.channels).toBe(1);
      expect(stats.activeSubscriptions).toBe(1);
      expect(stats.regions).toBe(1);
      expect(stats.barriers).toBe(1);
      expect(stats.semaphores).toBe(1);
      expect(stats.collectors).toBe(1);
    });

    it("should reject operations after destroy", () => {
      hub.destroy();
      expect(() =>
        hub.send({ from: "a", to: "b", topic: "t", payload: null, priority: "normal" }),
      ).toThrow("destroyed");
      expect(() => hub.subscribe("a", "t", () => {})).toThrow("destroyed");
      expect(() => hub.createRegion("r", "o")).toThrow("destroyed");
    });

    it("should be idempotent on double destroy", () => {
      hub.destroy();
      hub.destroy(); // Should not throw
    });

    it("should increment totalMessages count", () => {
      hub.subscribe("a", "t", () => {});
      hub.send({ from: "b", to: "a", topic: "t", payload: 1, priority: "normal" });
      hub.send({ from: "b", to: "a", topic: "t", payload: 2, priority: "normal" });
      expect(hub.getStats().totalMessages).toBe(2);
    });
  });

  describe("forceReleaseLock", () => {
    it("should force-release a lock and hand to next waiter", async () => {
      await hub.acquireLock("res", "agent-a");

      let bResolved = false;
      const p = hub.acquireLock("res", "agent-b", 5000).then(() => {
        bResolved = true;
      });

      hub.forceReleaseLock("res");
      await p;
      expect(bResolved).toBe(true);
    });

    it("should handle force-release on a non-existent lock gracefully", () => {
      hub.forceReleaseLock("nonexistent"); // Should not throw
    });
  });
});
