import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker, calculateCost } from "@chitragupta/swara";
import type { ModelDefinition } from "@chitragupta/swara";
import type { TokenUsage, CostBreakdown } from "@chitragupta/core";

const testModel: ModelDefinition = {
  id: "test-model",
  name: "Test Model",
  contextWindow: 200000,
  maxOutputTokens: 8192,
  pricing: {
    input: 3.0,    // $3 per million input tokens
    output: 15.0,  // $15 per million output tokens
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  capabilities: {
    vision: true,
    thinking: true,
    toolUse: true,
    streaming: true,
  },
};

const modelNoCachePricing: ModelDefinition = {
  ...testModel,
  id: "no-cache-model",
  pricing: {
    input: 2.0,
    output: 8.0,
  },
};

describe("calculateCost", () => {
  it("should calculate basic input/output costs", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
    };
    const cost = calculateCost(usage, testModel);
    // 1000 * 3 / 1M = 0.003
    expect(cost.input).toBeCloseTo(0.003, 6);
    // 500 * 15 / 1M = 0.0075
    expect(cost.output).toBeCloseTo(0.0075, 6);
    expect(cost.total).toBeCloseTo(0.0105, 6);
    expect(cost.currency).toBe("USD");
  });

  it("should calculate cache read/write costs when present", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 50000,
      cacheWriteTokens: 10000,
    };
    const cost = calculateCost(usage, testModel);

    // cache read: 50000 * 0.3 / 1M = 0.015
    expect(cost.cacheRead).toBeCloseTo(0.015, 6);
    // cache write: 10000 * 3.75 / 1M = 0.0375
    expect(cost.cacheWrite).toBeCloseTo(0.0375, 6);

    const expectedTotal = cost.input + cost.output + cost.cacheRead! + cost.cacheWrite!;
    expect(cost.total).toBeCloseTo(expectedTotal, 6);
  });

  it("should leave cacheRead/cacheWrite undefined when not present in usage", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
    };
    const cost = calculateCost(usage, testModel);
    expect(cost.cacheRead).toBeUndefined();
    expect(cost.cacheWrite).toBeUndefined();
  });

  it("should leave cacheRead/cacheWrite undefined when model has no cache pricing", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 50000,
      cacheWriteTokens: 10000,
    };
    const cost = calculateCost(usage, modelNoCachePricing);
    expect(cost.cacheRead).toBeUndefined();
    expect(cost.cacheWrite).toBeUndefined();
  });

  it("should handle zero tokens", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
    };
    const cost = calculateCost(usage, testModel);
    expect(cost.input).toBe(0);
    expect(cost.output).toBe(0);
    expect(cost.total).toBe(0);
  });

  it("should handle large token counts", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    const cost = calculateCost(usage, testModel);
    // 1M * 3 / 1M = 3.0
    expect(cost.input).toBeCloseTo(3.0, 4);
    // 1M * 15 / 1M = 15.0
    expect(cost.output).toBeCloseTo(15.0, 4);
    expect(cost.total).toBeCloseTo(18.0, 4);
  });
});

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe("add / total", () => {
    it("should return zero total when no costs have been added", () => {
      const total = tracker.total();
      expect(total.input).toBe(0);
      expect(total.output).toBe(0);
      expect(total.total).toBe(0);
      expect(total.currency).toBe("USD");
    });

    it("should accumulate costs from a single entry", () => {
      const cost: CostBreakdown = {
        input: 0.003,
        output: 0.0075,
        total: 0.0105,
        currency: "USD",
      };
      tracker.add(cost);
      const total = tracker.total();
      expect(total.input).toBeCloseTo(0.003, 6);
      expect(total.output).toBeCloseTo(0.0075, 6);
      expect(total.total).toBeCloseTo(0.0105, 6);
    });

    it("should accumulate costs from multiple entries", () => {
      tracker.add({ input: 0.01, output: 0.05, total: 0.06, currency: "USD" });
      tracker.add({ input: 0.02, output: 0.10, total: 0.12, currency: "USD" });
      tracker.add({ input: 0.03, output: 0.15, total: 0.18, currency: "USD" });

      const total = tracker.total();
      expect(total.input).toBeCloseTo(0.06, 6);
      expect(total.output).toBeCloseTo(0.30, 6);
      expect(total.total).toBeCloseTo(0.36, 6);
    });

    it("should accumulate cache costs when present", () => {
      tracker.add({
        input: 0.01,
        output: 0.05,
        cacheRead: 0.001,
        cacheWrite: 0.005,
        total: 0.066,
        currency: "USD",
      });
      tracker.add({
        input: 0.01,
        output: 0.05,
        cacheRead: 0.002,
        total: 0.062,
        currency: "USD",
      });

      const total = tracker.total();
      expect(total.cacheRead).toBeCloseTo(0.003, 6);
      expect(total.cacheWrite).toBeCloseTo(0.005, 6);
    });

    it("should leave cache fields undefined when no entries have cache costs", () => {
      tracker.add({ input: 0.01, output: 0.05, total: 0.06, currency: "USD" });
      const total = tracker.total();
      expect(total.cacheRead).toBeUndefined();
      expect(total.cacheWrite).toBeUndefined();
    });
  });

  describe("reset", () => {
    it("should clear all tracked costs", () => {
      tracker.add({ input: 0.01, output: 0.05, total: 0.06, currency: "USD" });
      tracker.add({ input: 0.02, output: 0.10, total: 0.12, currency: "USD" });
      tracker.reset();

      const total = tracker.total();
      expect(total.input).toBe(0);
      expect(total.output).toBe(0);
      expect(total.total).toBe(0);
    });

    it("should allow adding costs after reset", () => {
      tracker.add({ input: 1, output: 2, total: 3, currency: "USD" });
      tracker.reset();
      tracker.add({ input: 0.5, output: 1, total: 1.5, currency: "USD" });

      const total = tracker.total();
      expect(total.input).toBeCloseTo(0.5, 6);
      expect(total.total).toBeCloseTo(1.5, 6);
    });
  });
});
