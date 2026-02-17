import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { BudgetTracker } from "../src/budget-tracker.js";

// ─── Mock fs and @chitragupta/core's getChitraguptaHome ────────────────────────────

vi.mock("fs");
vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@chitragupta/core")>();
	return {
		...actual,
		getChitraguptaHome: () => "/tmp/test-chitragupta-home",
	};
});

const DAILY_COST_PATH = path.join("/tmp/test-chitragupta-home", "daily-cost.json");

function todayISO(): string {
	return new Date().toISOString().split("T")[0];
}

/**
 * Set up a simulated in-memory file store for the daily cost JSON.
 * writeFileSync captures the written content; readFileSync returns it.
 */
function setupDailyCostStore(initial?: { date: string; cost: number }): void {
	let stored: string | null = initial ? JSON.stringify(initial) : null;

	vi.mocked(fs.existsSync).mockImplementation(() => stored !== null);
	vi.mocked(fs.readFileSync).mockImplementation(() => {
		if (stored === null) throw new Error("ENOENT");
		return stored;
	});
	vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
		stored = data as string;
	});
	vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
}

describe("BudgetTracker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: no daily cost file on disk
		setupDailyCostStore();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ─── Construction ────────────────────────────────────────────────────────

	describe("construction", () => {
		it("should use default values when no config is provided", () => {
			const tracker = new BudgetTracker();
			const status = tracker.getStatus();
			expect(status.sessionLimit).toBe(0);
			expect(status.dailyLimit).toBe(0);
			expect(status.sessionCost).toBe(0);
			expect(status.dailyCost).toBe(0);
		});

		it("should store configured maxSessionCost", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 5.0 });
			const status = tracker.getStatus();
			expect(status.sessionLimit).toBe(5.0);
		});

		it("should store configured maxDailyCost", () => {
			const tracker = new BudgetTracker({ maxDailyCost: 10.0 });
			const status = tracker.getStatus();
			expect(status.dailyLimit).toBe(10.0);
		});

		it("should clamp warningThreshold above 1 to 1", () => {
			// With threshold clamped to 1.0, sessionWarning requires
			// cost >= limit * 1.0 AND cost < limit, which is impossible.
			// So no matter how close to the limit we get, warning is never true
			// until cost == limit, at which point exceeded is also true and
			// the warning condition (cost < limit) fails.
			const tracker = new BudgetTracker({
				maxSessionCost: 1.0,
				warningThreshold: 1.5,
			});
			tracker.recordCost(0.99);
			const status = tracker.getStatus();
			// 0.99 < 1.0 * 1.0 = 1.0, so warning is false
			expect(status.sessionWarning).toBe(false);
			expect(status.sessionExceeded).toBe(false);
		});

		it("should clamp negative warningThreshold to 0", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 1.0,
				warningThreshold: -0.5,
			});
			// With threshold 0, any cost > 0 triggers warning (cost >= 0 AND cost < limit)
			tracker.recordCost(0.01);
			const status = tracker.getStatus();
			expect(status.sessionWarning).toBe(true);
		});
	});

	// ─── recordCost ──────────────────────────────────────────────────────────

	describe("recordCost", () => {
		it("should accumulate session cost across multiple calls", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			tracker.recordCost(1.5);
			tracker.recordCost(2.5);
			const status = tracker.getStatus();
			expect(status.sessionCost).toBe(4.0);
		});

		it("should return updated BudgetStatus", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			const status = tracker.recordCost(3.0);
			expect(status.sessionCost).toBe(3.0);
		});

		it("should ignore zero cost", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			tracker.recordCost(0);
			expect(tracker.getStatus().sessionCost).toBe(0);
		});

		it("should ignore negative cost", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			tracker.recordCost(2.0);
			tracker.recordCost(-1.0);
			expect(tracker.getStatus().sessionCost).toBe(2.0);
		});

		it("should persist daily cost to disk on each record", () => {
			const tracker = new BudgetTracker({ maxDailyCost: 10 });
			tracker.recordCost(1.5);
			expect(fs.writeFileSync).toHaveBeenCalled();
			const [filePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string, string];
			expect(filePath).toBe(DAILY_COST_PATH);
			const parsed = JSON.parse(content);
			expect(parsed.date).toBe(todayISO());
			expect(parsed.cost).toBe(1.5);
		});
	});

	// ─── getStatus ───────────────────────────────────────────────────────────

	describe("getStatus", () => {
		it("should return all required fields", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 5.0,
				maxDailyCost: 20.0,
			});
			const status = tracker.getStatus();
			expect(status).toHaveProperty("sessionCost");
			expect(status).toHaveProperty("dailyCost");
			expect(status).toHaveProperty("sessionLimit");
			expect(status).toHaveProperty("dailyLimit");
			expect(status).toHaveProperty("sessionWarning");
			expect(status).toHaveProperty("sessionExceeded");
			expect(status).toHaveProperty("dailyWarning");
			expect(status).toHaveProperty("dailyExceeded");
		});

		it("should compute correct limits", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 5.0,
				maxDailyCost: 20.0,
			});
			const status = tracker.getStatus();
			expect(status.sessionLimit).toBe(5.0);
			expect(status.dailyLimit).toBe(20.0);
		});

		it("should report zero costs when nothing recorded", () => {
			const tracker = new BudgetTracker();
			const status = tracker.getStatus();
			expect(status.sessionCost).toBe(0);
			expect(status.dailyCost).toBe(0);
		});

		it("should not show warning or exceeded for zero-cost state", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			const status = tracker.getStatus();
			expect(status.sessionWarning).toBe(false);
			expect(status.sessionExceeded).toBe(false);
		});
	});

	// ─── canProceed ──────────────────────────────────────────────────────────

	describe("canProceed", () => {
		it("should return allowed=true when under all limits", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 10,
				maxDailyCost: 50,
			});
			tracker.recordCost(1.0);
			const result = tracker.canProceed();
			expect(result.allowed).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it("should return allowed=false when session limit exceeded", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 2.0 });
			tracker.recordCost(2.5);
			const result = tracker.canProceed();
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Session budget exceeded");
		});

		it("should return allowed=false when session limit exactly met", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 2.0 });
			tracker.recordCost(2.0);
			const result = tracker.canProceed();
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Session budget exceeded");
		});

		it("should return allowed=false when daily limit exceeded", () => {
			// Seed initial daily cost on disk
			setupDailyCostStore({ date: todayISO(), cost: 49.0 });
			const tracker = new BudgetTracker({ maxDailyCost: 50 });
			tracker.recordCost(2.0); // daily becomes 49 + 2 = 51, written to store
			const result = tracker.canProceed();
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Daily budget exceeded");
		});

		it("should prioritize session exceeded over daily exceeded", () => {
			setupDailyCostStore({ date: todayISO(), cost: 100 });
			const tracker = new BudgetTracker({
				maxSessionCost: 1.0,
				maxDailyCost: 10.0,
			});
			tracker.recordCost(5.0);
			const result = tracker.canProceed();
			expect(result.allowed).toBe(false);
			// Session exceeded is checked first
			expect(result.reason).toContain("Session budget exceeded");
		});
	});

	// ─── Warning thresholds ──────────────────────────────────────────────────

	describe("warning thresholds", () => {
		it("should trigger session warning at default 80% threshold", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10.0 });
			tracker.recordCost(8.0); // exactly 80%
			const status = tracker.getStatus();
			expect(status.sessionWarning).toBe(true);
			expect(status.sessionExceeded).toBe(false);
		});

		it("should not trigger session warning below threshold", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10.0 });
			tracker.recordCost(7.9); // just under 80%
			const status = tracker.getStatus();
			expect(status.sessionWarning).toBe(false);
		});

		it("should not show warning when exceeded (warning requires cost < limit)", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10.0 });
			tracker.recordCost(10.0); // at limit
			const status = tracker.getStatus();
			expect(status.sessionWarning).toBe(false);
			expect(status.sessionExceeded).toBe(true);
		});

		it("should trigger daily warning at threshold", () => {
			setupDailyCostStore({ date: todayISO(), cost: 0 });
			const tracker = new BudgetTracker({
				maxDailyCost: 10.0,
				warningThreshold: 0.5,
			});
			tracker.recordCost(5.0); // daily becomes 0 + 5 = 5, which is 50%
			const status = tracker.getStatus();
			expect(status.dailyWarning).toBe(true);
			expect(status.dailyExceeded).toBe(false);
		});

		it("should use custom warningThreshold", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 100.0,
				warningThreshold: 0.9,
			});
			tracker.recordCost(85.0); // 85% -- under 90% threshold
			expect(tracker.getStatus().sessionWarning).toBe(false);
			tracker.recordCost(5.0); // now 90%
			expect(tracker.getStatus().sessionWarning).toBe(true);
		});
	});

	// ─── Unlimited mode (0 limits) ───────────────────────────────────────────

	describe("unlimited mode (0 limits)", () => {
		it("should never show sessionExceeded when maxSessionCost is 0", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 0 });
			tracker.recordCost(999999);
			const status = tracker.getStatus();
			expect(status.sessionExceeded).toBe(false);
			expect(status.sessionWarning).toBe(false);
		});

		it("should never show dailyExceeded when maxDailyCost is 0", () => {
			const tracker = new BudgetTracker({ maxDailyCost: 0 });
			tracker.recordCost(999999);
			const status = tracker.getStatus();
			expect(status.dailyExceeded).toBe(false);
			expect(status.dailyWarning).toBe(false);
		});

		it("should always allow proceed with unlimited budgets", () => {
			const tracker = new BudgetTracker({
				maxSessionCost: 0,
				maxDailyCost: 0,
			});
			tracker.recordCost(1000000);
			expect(tracker.canProceed().allowed).toBe(true);
		});

		it("should default to unlimited when no config given", () => {
			const tracker = new BudgetTracker();
			tracker.recordCost(1000);
			expect(tracker.canProceed().allowed).toBe(true);
		});
	});

	// ─── Daily cost persistence ──────────────────────────────────────────────

	describe("daily cost persistence", () => {
		it("should write daily cost to the correct path", () => {
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			tracker.recordCost(5.0);
			expect(fs.writeFileSync).toHaveBeenCalledWith(
				DAILY_COST_PATH,
				expect.any(String),
				"utf-8",
			);
		});

		it("should create the directory before writing", () => {
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			tracker.recordCost(5.0);
			expect(fs.mkdirSync).toHaveBeenCalledWith(
				path.dirname(DAILY_COST_PATH),
				{ recursive: true },
			);
		});

		it("should read existing daily cost from disk", () => {
			setupDailyCostStore({ date: todayISO(), cost: 7.5 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(7.5);
		});

		it("should accumulate daily cost with existing on-disk value", () => {
			setupDailyCostStore({ date: todayISO(), cost: 10.0 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			tracker.recordCost(5.0);
			// After recordCost: daily = 10 + 5 = 15, written to store
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(15.0);
		});

		it("should accumulate multiple daily costs correctly", () => {
			setupDailyCostStore({ date: todayISO(), cost: 0 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			tracker.recordCost(3.0);
			tracker.recordCost(7.0);
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(10.0);
		});
	});

	// ─── Date rollover ───────────────────────────────────────────────────────

	describe("date rollover", () => {
		it("should reset daily cost if stored date does not match today", () => {
			setupDailyCostStore({ date: "1999-01-01", cost: 500.0 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			// Old date means daily cost resets to 0
			expect(status.dailyCost).toBe(0);
		});

		it("should start fresh accumulation after rollover", () => {
			setupDailyCostStore({ date: "2020-06-15", cost: 999 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			tracker.recordCost(3.0);
			// loadDailyCost returns 0 (old date), so new daily = 0 + 3 = 3
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(3.0);
		});
	});

	// ─── Error resilience ────────────────────────────────────────────────────

	describe("error resilience", () => {
		it("should return 0 daily cost when file read throws", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockImplementation(() => {
				throw new Error("disk failure");
			});
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(0);
		});

		it("should return 0 daily cost when file contains invalid JSON", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(0);
		});

		it("should return 0 daily cost when cost field is negative", () => {
			setupDailyCostStore({ date: todayISO(), cost: -5 });
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(0);
		});

		it("should not throw when writeFileSync fails", () => {
			vi.mocked(fs.writeFileSync).mockImplementation(() => {
				throw new Error("disk full");
			});
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			// Should not throw
			expect(() => tracker.recordCost(5.0)).not.toThrow();
		});

		it("should not throw when mkdirSync fails", () => {
			vi.mocked(fs.mkdirSync).mockImplementation(() => {
				throw new Error("permission denied");
			});
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			expect(() => tracker.recordCost(5.0)).not.toThrow();
		});

		it("should return 0 when cost field is not a number", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({ date: todayISO(), cost: "ten dollars" })
			);
			const tracker = new BudgetTracker({ maxDailyCost: 100 });
			const status = tracker.getStatus();
			expect(status.dailyCost).toBe(0);
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle very small fractional costs", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 1.0 });
			tracker.recordCost(0.0001);
			tracker.recordCost(0.0002);
			expect(tracker.getStatus().sessionCost).toBeCloseTo(0.0003);
		});

		it("should handle very large costs", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 1e9 });
			tracker.recordCost(5e8);
			tracker.recordCost(5e8);
			const status = tracker.getStatus();
			expect(status.sessionCost).toBe(1e9);
			expect(status.sessionExceeded).toBe(true);
		});

		it("should still track session cost even with unlimited budgets", () => {
			const tracker = new BudgetTracker();
			tracker.recordCost(42.0);
			expect(tracker.getStatus().sessionCost).toBe(42.0);
		});

		it("should handle multiple successive zero/negative costs gracefully", () => {
			const tracker = new BudgetTracker({ maxSessionCost: 10 });
			tracker.recordCost(0);
			tracker.recordCost(-5);
			tracker.recordCost(0);
			expect(tracker.getStatus().sessionCost).toBe(0);
		});
	});
});
