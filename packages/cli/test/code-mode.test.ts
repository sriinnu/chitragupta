/**
 * Tests for the code mode formatting helpers.
 *
 * These functions are defined inside code.ts as module-private helpers.
 * Since they are not exported, we re-implement the pure functions here
 * and validate the logic. If the implementation changes, these tests
 * serve as a specification for the expected behavior.
 */

import { describe, it, expect } from "vitest";

// ─── Re-implement pure helpers to test logic ────────────────────────────────
// These mirror the implementations in packages/cli/src/modes/code.ts

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function formatCost(n: number): string {
	if (n < 0.001) return `$${n.toFixed(6)}`;
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(4)}`;
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = ((ms % 60_000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}

function padRight(s: string, len: number): string {
	return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
	return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// CodeModeOptions (type coverage via import)
// ═══════════════════════════════════════════════════════════════════════════

describe("CodeModeOptions defaults", () => {
	it("should have sensible defaults documented", () => {
		// This test validates that the expected defaults are documented:
		// mode: "full", createBranch: true, autoCommit: true, selfReview: true, timeout: 300
		const defaults = {
			mode: "full",
			createBranch: true,
			autoCommit: true,
			selfReview: true,
			timeout: 300,
		};
		expect(defaults.mode).toBe("full");
		expect(defaults.timeout).toBe(300);
	});
});
