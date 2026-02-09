import { describe, it, expect, vi, afterEach } from "vitest";
import { RequestQueue, DEFAULT_QUEUE_CONFIG } from "@chitragupta/swara";

describe("RequestQueue", () => {
  let queue: RequestQueue;

  afterEach(() => {
    queue?.destroy();
  });

  describe("constructor", () => {
    it("should use defaults when no config provided", () => {
      queue = new RequestQueue();
      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.active).toBe(0);
    });

    it("should accept partial config", () => {
      queue = new RequestQueue({ concurrency: 5 });
      // Verify queue was created successfully
      expect(queue.isIdle()).toBe(true);
    });
  });

  describe("enqueue", () => {
    it("should enqueue and execute a request", async () => {
      queue = new RequestQueue({ concurrency: 3 });
      const handle = queue.enqueue(async () => "result");
      const result = await handle.promise;
      expect(result).toBe("result");
    });

    it("should return a handle with unique id", () => {
      queue = new RequestQueue({ concurrency: 3 });
      const handle1 = queue.enqueue(async () => "a");
      const handle2 = queue.enqueue(async () => "b");
      expect(handle1.id).not.toBe(handle2.id);
    });

    it("should throw when queue is destroyed", () => {
      queue = new RequestQueue();
      queue.destroy();
      expect(() => queue.enqueue(async () => "x")).toThrow(
        "Request queue has been destroyed",
      );
    });

    it("should pass an AbortSignal to the execute function", async () => {
      queue = new RequestQueue({ concurrency: 1 });
      let receivedSignal: AbortSignal | undefined;

      const handle = queue.enqueue(async (signal) => {
        receivedSignal = signal;
        return "done";
      });

      await handle.promise;
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal!.aborted).toBe(false);
    });
  });

  describe("concurrency", () => {
    it("should respect concurrency limit", async () => {
      queue = new RequestQueue({ concurrency: 2 });
      let activeCount = 0;
      let maxActive = 0;

      const makeTask = () =>
        queue.enqueue(async () => {
          activeCount++;
          maxActive = Math.max(maxActive, activeCount);
          await new Promise((r) => setTimeout(r, 50));
          activeCount--;
          return "done";
        });

      const handles = [makeTask(), makeTask(), makeTask(), makeTask()];
      await Promise.all(handles.map((h) => h.promise));

      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it("should process all requests even with concurrency limit", async () => {
      queue = new RequestQueue({ concurrency: 1 });
      const results: number[] = [];

      const h1 = queue.enqueue(async () => {
        results.push(1);
        return 1;
      });
      const h2 = queue.enqueue(async () => {
        results.push(2);
        return 2;
      });
      const h3 = queue.enqueue(async () => {
        results.push(3);
        return 3;
      });

      await Promise.all([h1.promise, h2.promise, h3.promise]);
      expect(results).toHaveLength(3);
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe("priority ordering", () => {
    it("should process high priority requests before low priority", async () => {
      queue = new RequestQueue({ concurrency: 1 });
      const order: string[] = [];

      // First request: blocks the queue
      const blocker = queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 100));
        order.push("blocker");
        return "blocker";
      }, "normal");

      // Queue in reverse priority order
      const low = queue.enqueue(async () => {
        order.push("low");
        return "low";
      }, "low");

      const normal = queue.enqueue(async () => {
        order.push("normal");
        return "normal";
      }, "normal");

      const high = queue.enqueue(async () => {
        order.push("high");
        return "high";
      }, "high");

      await Promise.all([
        blocker.promise,
        low.promise,
        normal.promise,
        high.promise,
      ]);

      // blocker finishes first (it was already running)
      // then high, normal, low based on priority
      expect(order[0]).toBe("blocker");
      expect(order[1]).toBe("high");
      expect(order[2]).toBe("normal");
      expect(order[3]).toBe("low");
    });
  });

  describe("cancelRequest", () => {
    it("should cancel a pending request", async () => {
      queue = new RequestQueue({ concurrency: 1 });

      // Block the queue
      const blocker = queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "done";
      });

      // This will be queued (pending)
      const pending = queue.enqueue(async () => "should not run");
      const cancelled = queue.cancelRequest(pending.id);
      expect(cancelled).toBe(true);

      await expect(pending.promise).rejects.toThrow("Request cancelled");
      await blocker.promise;
    });

    it("should return false for non-existent request id", () => {
      queue = new RequestQueue();
      expect(queue.cancelRequest("req_999")).toBe(false);
    });
  });

  describe("cancelAll", () => {
    it("should cancel all pending requests", async () => {
      queue = new RequestQueue({ concurrency: 1 });

      // Block the queue
      const blocker = queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "done";
      });

      const p1 = queue.enqueue(async () => "a");
      const p2 = queue.enqueue(async () => "b");

      // Attach catch handlers BEFORE cancelling to prevent unhandled rejections
      const p1Rejection = p1.promise.catch(() => {});
      const p2Rejection = p2.promise.catch(() => {});
      const blockerRejection = blocker.promise.catch(() => {});

      const cancelledCount = queue.cancelAll();
      expect(cancelledCount).toBeGreaterThanOrEqual(2);

      await expect(p1.promise).rejects.toThrow();
      await expect(p2.promise).rejects.toThrow();

      // The blocker was active, so it gets aborted too
      await expect(blocker.promise).rejects.toThrow();

      // Ensure our safety catches resolve
      await p1Rejection;
      await p2Rejection;
      await blockerRejection;
    });
  });

  describe("getStats", () => {
    it("should track completed requests", async () => {
      queue = new RequestQueue({ concurrency: 3 });
      await queue.enqueue(async () => "a").promise;
      await queue.enqueue(async () => "b").promise;

      const stats = queue.getStats();
      expect(stats.completed).toBe(2);
      expect(stats.total).toBe(2);
    });

    it("should track failed requests", async () => {
      queue = new RequestQueue({ concurrency: 3 });
      const handle = queue.enqueue(async () => {
        throw new Error("fail");
      });

      await expect(handle.promise).rejects.toThrow("fail");

      const stats = queue.getStats();
      expect(stats.failed).toBe(1);
    });
  });

  describe("isIdle", () => {
    it("should return true when queue is empty", () => {
      queue = new RequestQueue();
      expect(queue.isIdle()).toBe(true);
    });

    it("should return false when requests are active", () => {
      queue = new RequestQueue({ concurrency: 1 });
      const handle = queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 500));
      });

      // Attach a no-op catch to prevent unhandled rejection when afterEach destroys the queue
      handle.promise.catch(() => {});

      // Immediately after enqueue, the request should be active
      expect(queue.isIdle()).toBe(false);
    });
  });

  describe("drain", () => {
    it("should resolve immediately when queue is idle", async () => {
      queue = new RequestQueue();
      // Should not hang
      await queue.drain();
    });

    it("should wait until all requests complete", async () => {
      queue = new RequestQueue({ concurrency: 2 });
      let completed = 0;

      queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 50));
        completed++;
      });
      queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 50));
        completed++;
      });

      await queue.drain();
      expect(completed).toBe(2);
    });
  });

  describe("setConcurrency", () => {
    it("should clamp concurrency to at least 1", () => {
      queue = new RequestQueue({ concurrency: 5 });
      queue.setConcurrency(0);
      // Should be clamped to 1
      // We verify by checking it still processes
      const handle = queue.enqueue(async () => "ok");
      return expect(handle.promise).resolves.toBe("ok");
    });
  });

  describe("destroy", () => {
    it("should cancel all pending and active requests", async () => {
      queue = new RequestQueue({ concurrency: 1 });

      const h1 = queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return "done";
      });

      const h2 = queue.enqueue(async () => "queued");

      // Attach catch handlers BEFORE destroying to prevent unhandled rejections
      const h1Safety = h1.promise.catch(() => {});
      const h2Safety = h2.promise.catch(() => {});

      queue.destroy();

      await expect(h1.promise).rejects.toThrow();
      await expect(h2.promise).rejects.toThrow();

      await h1Safety;
      await h2Safety;
    });
  });
});

describe("DEFAULT_QUEUE_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_QUEUE_CONFIG.concurrency).toBe(3);
    expect(DEFAULT_QUEUE_CONFIG.defaultTimeoutMs).toBe(120_000);
  });
});
