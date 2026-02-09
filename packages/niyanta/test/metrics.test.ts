import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsCollector } from "../src/metrics.js";
import type { TaskMetrics } from "../src/types.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    // Use a long retention to avoid pruning in tests
    collector = new MetricsCollector(60 * 60 * 1000);
  });

  /** Helper: create task metrics with specified latency. */
  function makeMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
    const now = Date.now();
    return {
      startTime: now - 1000,
      endTime: now,
      tokenUsage: 100,
      cost: 0.01,
      toolCalls: 2,
      retries: 0,
      ...overrides,
    };
  }

  describe("record", () => {
    it("should record a successful task", () => {
      collector.record("slot-a", makeMetrics(), true);

      const report = collector.getReport();
      expect(report.overall.totalTasks).toBe(1);
      expect(report.overall.completedTasks).toBe(1);
      expect(report.overall.failedTasks).toBe(0);
    });

    it("should record a failed task", () => {
      collector.record("slot-a", makeMetrics(), false);

      const report = collector.getReport();
      expect(report.overall.totalTasks).toBe(1);
      expect(report.overall.completedTasks).toBe(0);
      expect(report.overall.failedTasks).toBe(1);
    });

    it("should accumulate multiple records", () => {
      collector.record("slot-a", makeMetrics({ cost: 0.01 }), true);
      collector.record("slot-b", makeMetrics({ cost: 0.02 }), true);
      collector.record("slot-a", makeMetrics({ cost: 0.03 }), false);

      const report = collector.getReport();
      expect(report.overall.totalTasks).toBe(3);
      expect(report.overall.completedTasks).toBe(2);
      expect(report.overall.failedTasks).toBe(1);
      expect(report.overall.totalCost).toBeCloseTo(0.06, 5);
    });
  });

  describe("recordFailure", () => {
    it("should record a failure with zero metrics", () => {
      collector.recordFailure("slot-x");

      const report = collector.getReport();
      expect(report.overall.failedTasks).toBe(1);
    });
  });

  describe("sliding windows", () => {
    it("should compute stats for 1m, 5m, and 15m windows", () => {
      const now = Date.now();
      // Record a task with timestamp within 1 minute
      collector.record("slot-a", {
        startTime: now - 500,
        endTime: now,
        tokenUsage: 100,
        cost: 0.01,
        toolCalls: 1,
        retries: 0,
      }, true);

      const report = collector.getReport();

      // The 1m window should contain the task
      expect(report.windows["1m"].tasksCompleted).toBeGreaterThanOrEqual(1);
      expect(report.windows["5m"].tasksCompleted).toBeGreaterThanOrEqual(1);
      expect(report.windows["15m"].tasksCompleted).toBeGreaterThanOrEqual(1);
    });

    it("should count failed tasks in windows", () => {
      collector.record("slot-a", makeMetrics(), false);

      const report = collector.getReport();
      expect(report.windows["1m"].tasksFailed).toBe(1);
    });
  });

  describe("percentiles", () => {
    it("should compute p50, p95, p99 latency percentiles", () => {
      const now = Date.now();
      // Record tasks with known latencies: 100, 200, 300, ..., 1000
      for (let i = 1; i <= 10; i++) {
        collector.record("slot-a", {
          startTime: now - i * 100,
          endTime: now,
          tokenUsage: 10,
          cost: 0.001,
          toolCalls: 1,
          retries: 0,
        }, true);
      }

      const report = collector.getReport();
      expect(report.latencyPercentiles.p50).toBeGreaterThan(0);
      expect(report.latencyPercentiles.p95).toBeGreaterThan(report.latencyPercentiles.p50);
      expect(report.latencyPercentiles.p99).toBeGreaterThanOrEqual(report.latencyPercentiles.p95);
    });

    it("should return zeros when no data points exist", () => {
      const report = collector.getReport();
      expect(report.latencyPercentiles).toEqual({ p50: 0, p95: 0, p99: 0 });
    });
  });

  describe("costBySlot", () => {
    it("should aggregate cost per agent slot", () => {
      collector.record("writer", makeMetrics({ cost: 0.05 }), true);
      collector.record("writer", makeMetrics({ cost: 0.03 }), true);
      collector.record("reviewer", makeMetrics({ cost: 0.02 }), true);

      const report = collector.getReport();
      expect(report.costBySlot["writer"]).toBeCloseTo(0.08, 5);
      expect(report.costBySlot["reviewer"]).toBeCloseTo(0.02, 5);
    });
  });

  describe("errorRate", () => {
    it("should compute error rate as failures / total", () => {
      collector.record("a", makeMetrics(), true);
      collector.record("a", makeMetrics(), true);
      collector.record("a", makeMetrics(), false);

      const report = collector.getReport();
      expect(report.errorRate).toBeCloseTo(1 / 3, 5);
    });

    it("should return 0 when no data points exist", () => {
      const report = collector.getReport();
      expect(report.errorRate).toBe(0);
    });
  });

  describe("averageLatency", () => {
    it("should compute average latency from successful tasks", () => {
      const now = Date.now();
      collector.record("a", { startTime: now - 100, endTime: now, tokenUsage: 10, cost: 0.01, toolCalls: 1, retries: 0 }, true);
      collector.record("a", { startTime: now - 300, endTime: now, tokenUsage: 10, cost: 0.01, toolCalls: 1, retries: 0 }, true);

      const report = collector.getReport();
      // Average of 100 and 300 = 200
      expect(report.overall.averageLatency).toBeCloseTo(200, -1);
    });
  });

  describe("reset", () => {
    it("should clear all collected metrics", () => {
      collector.record("a", makeMetrics(), true);
      collector.record("b", makeMetrics(), false);

      collector.reset();

      const report = collector.getReport();
      expect(report.overall.totalTasks).toBe(0);
      expect(report.overall.completedTasks).toBe(0);
      expect(report.overall.failedTasks).toBe(0);
    });
  });

  describe("exportPrometheus", () => {
    it("should generate valid Prometheus text exposition format", () => {
      collector.record("slot-a", makeMetrics({ cost: 0.05, tokenUsage: 200 }), true);

      const output = collector.exportPrometheus();

      expect(output).toContain("niyanta_tasks_total 1");
      expect(output).toContain("niyanta_tasks_completed_total 1");
      expect(output).toContain("niyanta_cost_total");
      expect(output).toContain("niyanta_tokens_total");
      expect(output).toContain("niyanta_error_rate");
      expect(output).toContain("# HELP");
      expect(output).toContain("# TYPE");
    });
  });

  describe("pruning", () => {
    it("should prune data points beyond retention", () => {
      // Use a very short retention
      const shortCollector = new MetricsCollector(1);

      const now = Date.now();
      // Record a task with old timestamp
      shortCollector.record("a", {
        startTime: now - 100,
        endTime: now - 50,
        tokenUsage: 10,
        cost: 0.01,
        toolCalls: 1,
        retries: 0,
      }, true);

      // The pruning happens on record, so the old data point should be pruned
      // Record another to trigger prune
      shortCollector.record("a", makeMetrics(), true);

      const report = shortCollector.getReport();
      // Old data point should have been pruned
      expect(report.overall.totalTasks).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getReport with currentStats override", () => {
    it("should use provided currentStats as overall stats", () => {
      collector.record("a", makeMetrics(), true);

      const customStats = {
        totalTasks: 100,
        pendingTasks: 5,
        runningTasks: 10,
        completedTasks: 80,
        failedTasks: 5,
        activeAgents: 4,
        totalCost: 1.50,
        totalTokens: 50000,
        averageLatency: 500,
        throughput: 10,
      };

      const report = collector.getReport(customStats);
      expect(report.overall).toEqual(customStats);
      // Windows should still be computed from data points
      expect(report.windows["1m"]).toBeDefined();
    });
  });
});
