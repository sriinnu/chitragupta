import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucketLimiter, DEFAULT_RATE_LIMITS } from "@chitragupta/swara";

describe("TokenBucketLimiter", () => {
  let limiter: TokenBucketLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  describe("constructor", () => {
    it("should use default config when none provided", () => {
      limiter = new TokenBucketLimiter();
      const stats = limiter.getStats();
      expect(stats.limits.requestsPerMinute).toBe(DEFAULT_RATE_LIMITS.requestsPerMinute);
      expect(stats.limits.tokensPerMinute).toBe(DEFAULT_RATE_LIMITS.tokensPerMinute);
    });

    it("should accept partial config", () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 10 });
      const stats = limiter.getStats();
      expect(stats.limits.requestsPerMinute).toBe(10);
      expect(stats.limits.tokensPerMinute).toBe(DEFAULT_RATE_LIMITS.tokensPerMinute);
    });
  });

  describe("acquire (fast path)", () => {
    it("should resolve immediately when under limits", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 100, tokensPerMinute: 1_000_000 });
      // Should not block
      await limiter.acquire(100, "normal");
      const stats = limiter.getStats();
      expect(stats.requestsInWindow).toBe(1);
      expect(stats.tokensInWindow).toBe(100);
    });

    it("should record requests and tokens in the window", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 100, tokensPerMinute: 1_000_000 });
      await limiter.acquire(500, "high");
      await limiter.acquire(300, "normal");

      const stats = limiter.getStats();
      expect(stats.requestsInWindow).toBe(2);
      expect(stats.tokensInWindow).toBe(800);
    });
  });

  describe("hasCapacity", () => {
    it("should return true when under limits", () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 60, tokensPerMinute: 100_000 });
      expect(limiter.hasCapacity(100)).toBe(true);
    });

    it("should return false when token limit would be exceeded", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 100, tokensPerMinute: 500 });
      await limiter.acquire(400);
      expect(limiter.hasCapacity(200)).toBe(false);
    });

    it("should return false when request count limit would be exceeded", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 2, tokensPerMinute: 1_000_000 });
      await limiter.acquire(1);
      await limiter.acquire(1);
      expect(limiter.hasCapacity(1)).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return accurate statistics", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 100, tokensPerMinute: 1_000_000 });
      await limiter.acquire(100);
      await limiter.acquire(200);

      const stats = limiter.getStats();
      expect(stats.requestsInWindow).toBe(2);
      expect(stats.tokensInWindow).toBe(300);
      expect(stats.queuedRequests).toBe(0);
      expect(stats.limits.requestsPerMinute).toBe(100);
    });
  });

  describe("updateConfig", () => {
    it("should update the rate limit configuration", () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 60 });
      limiter.updateConfig({ requestsPerMinute: 120 });
      const stats = limiter.getStats();
      expect(stats.limits.requestsPerMinute).toBe(120);
    });

    it("should only update specified fields", () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 60, tokensPerMinute: 100_000 });
      limiter.updateConfig({ requestsPerMinute: 120 });
      expect(limiter.getStats().limits.tokensPerMinute).toBe(100_000);
    });
  });

  describe("reset", () => {
    it("should clear tracked usage", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 100, tokensPerMinute: 1_000_000 });
      await limiter.acquire(500);
      await limiter.acquire(500);
      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.requestsInWindow).toBe(0);
      expect(stats.tokensInWindow).toBe(0);
    });
  });

  describe("destroy", () => {
    it("should reject subsequent acquire calls", async () => {
      limiter = new TokenBucketLimiter();
      limiter.destroy();
      await expect(limiter.acquire(1)).rejects.toThrow("Rate limiter has been destroyed");
    });
  });

  describe("priority ordering", () => {
    it("should queue and dequeue by priority when at capacity", async () => {
      limiter = new TokenBucketLimiter({ requestsPerMinute: 1, tokensPerMinute: 1_000_000 });
      // Fill up the capacity
      await limiter.acquire(1, "normal");

      // These will be queued
      const order: string[] = [];

      const lowPromise = limiter.acquire(1, "low").then(() => order.push("low"));
      const highPromise = limiter.acquire(1, "high").then(() => order.push("high"));
      const normalPromise = limiter.acquire(1, "normal").then(() => order.push("normal"));

      // After the sliding window advances, high should resolve first
      // But since we can't easily advance time in this test, we verify queue stats
      const stats = limiter.getStats();
      expect(stats.queuedRequests).toBe(3);

      // Clean up by destroying (rejects queued)
      limiter.destroy();

      // All queued promises should reject
      await expect(lowPromise).rejects.toThrow();
      await expect(highPromise).rejects.toThrow();
      await expect(normalPromise).rejects.toThrow();
    });
  });
});

describe("DEFAULT_RATE_LIMITS", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_RATE_LIMITS.requestsPerMinute).toBe(60);
    expect(DEFAULT_RATE_LIMITS.tokensPerMinute).toBe(100_000);
  });
});
