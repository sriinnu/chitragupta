/**
 * Tests for the code mode formatting helpers.
 *
 * Tests the actual exported helper functions from code.ts.
 */

import { describe, it, expect } from "vitest";
import {
	formatTokens,
	formatCost,
	formatMs,
	padRight,
	padLeft,
} from "../src/modes/code.js";

// ═══════════════════════════════════════════════════════════════════════════
// formatTokens
// ═══════════════════════════════════════════════════════════════════════════

describe("formatTokens", () => {
	it("should format millions", () => {
		expect(formatTokens(1_500_000)).toBe("1.5M");
		expect(formatTokens(1_000_000)).toBe("1.0M");
		expect(formatTokens(10_000_000)).toBe("10.0M");
	});

	it("should format thousands", () => {
		expect(formatTokens(5_000)).toBe("5.0k");
		expect(formatTokens(1_000)).toBe("1.0k");
		expect(formatTokens(999_999)).toBe("1000.0k");
	});

	it("should format small numbers as-is", () => {
		expect(formatTokens(500)).toBe("500");
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// formatCost
// ═══════════════════════════════════════════════════════════════════════════

describe("formatCost", () => {
	it("should format very small costs with 6 decimal places", () => {
		expect(formatCost(0.0001)).toBe("$0.000100");
		expect(formatCost(0.0009)).toBe("$0.000900");
	});

	it("should format small costs with 4 decimal places", () => {
		expect(formatCost(0.001)).toBe("$0.0010");
		expect(formatCost(0.009)).toBe("$0.0090");
	});

	it("should format normal costs with 4 decimal places", () => {
		expect(formatCost(0.05)).toBe("$0.0500");
		expect(formatCost(1.2345)).toBe("$1.2345");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// formatMs
// ═══════════════════════════════════════════════════════════════════════════

describe("formatMs", () => {
	it("should format milliseconds", () => {
		expect(formatMs(50)).toBe("50ms");
		expect(formatMs(999)).toBe("999ms");
	});

	it("should format seconds", () => {
		expect(formatMs(1000)).toBe("1.0s");
		expect(formatMs(5500)).toBe("5.5s");
		expect(formatMs(59999)).toBe("60.0s");
	});

	it("should format minutes and seconds", () => {
		expect(formatMs(60_000)).toBe("1m 0s");
		expect(formatMs(90_000)).toBe("1m 30s");
		expect(formatMs(300_000)).toBe("5m 0s");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// padRight / padLeft
// ═══════════════════════════════════════════════════════════════════════════

describe("padRight", () => {
	it("should pad shorter strings", () => {
		expect(padRight("hi", 5)).toBe("hi   ");
		expect(padRight("", 3)).toBe("   ");
	});

	it("should not truncate longer strings", () => {
		expect(padRight("hello world", 5)).toBe("hello world");
	});

	it("should return exact string when length matches", () => {
		expect(padRight("abc", 3)).toBe("abc");
	});
});

describe("padLeft", () => {
	it("should pad shorter strings", () => {
		expect(padLeft("42", 5)).toBe("   42");
		expect(padLeft("", 3)).toBe("   ");
	});

	it("should not truncate longer strings", () => {
		expect(padLeft("hello world", 5)).toBe("hello world");
	});

	it("should return exact string when length matches", () => {
		expect(padLeft("abc", 3)).toBe("abc");
	});
});
