/**
 * Tests for tool-formatter — byte/token formatting and rich tool footer output.
 */
import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import {
	formatBytes,
	estimateTokens,
	formatTokens,
	formatToolFooter,
} from "../src/tool-formatter.js";

// ─── formatBytes ─────────────────────────────────────────────────────────────

describe("formatBytes", () => {
	it("formats bytes below 1KB", () => {
		expect(formatBytes(89)).toBe("89B");
		expect(formatBytes(0)).toBe("0B");
		expect(formatBytes(1023)).toBe("1023B");
	});

	it("formats kilobytes", () => {
		expect(formatBytes(1024)).toBe("1.0KB");
		expect(formatBytes(4600)).toBe("4.5KB");
	});

	it("formats megabytes", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0MB");
		expect(formatBytes(1200000)).toBe("1.1MB");
	});
});

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe("estimateTokens", () => {
	it("estimates ~4 bytes per token", () => {
		expect(estimateTokens(400)).toBe(100);
	});

	it("returns minimum 1 token", () => {
		expect(estimateTokens(0)).toBe(1);
		expect(estimateTokens(1)).toBe(1);
	});

	it("rounds to nearest integer", () => {
		expect(estimateTokens(10)).toBe(3);
	});
});

// ─── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
	it("formats small counts with ~ prefix", () => {
		expect(formatTokens(350)).toBe("~350");
	});

	it("formats thousands with k suffix", () => {
		expect(formatTokens(1200)).toBe("~1.2k");
	});

	it("formats millions with M suffix", () => {
		expect(formatTokens(2500000)).toBe("~2.5M");
	});

	it("handles exact boundaries", () => {
		expect(formatTokens(999)).toBe("~999");
		expect(formatTokens(1000)).toBe("~1.0k");
		expect(formatTokens(1000000)).toBe("~1.0M");
	});
});

// ─── formatToolFooter ────────────────────────────────────────────────────────

describe("formatToolFooter", () => {
	it("renders header with tool name", () => {
		const result = formatToolFooter({
			toolName: "bash",
			elapsedMs: 42.3,
			outputBytes: 4600,
		});
		const stripped = stripAnsi(result);
		expect(stripped).toContain("bash");
	});

	it("shows output size and token estimate", () => {
		const result = formatToolFooter({
			toolName: "read",
			elapsedMs: 5,
			outputBytes: 2048,
		});
		const stripped = stripAnsi(result);
		expect(stripped).toContain("2.0KB");
		expect(stripped).toContain("tokens");
	});

	it("shows timing in milliseconds", () => {
		const result = formatToolFooter({
			toolName: "grep",
			elapsedMs: 42.3,
			outputBytes: 100,
		});
		const stripped = stripAnsi(result);
		expect(stripped).toContain("42.3ms");
	});

	it("shows timing in seconds for long operations", () => {
		const result = formatToolFooter({
			toolName: "bash",
			elapsedMs: 2500,
			outputBytes: 100,
		});
		const stripped = stripAnsi(result);
		expect(stripped).toContain("2.50s");
	});

	it("shows error indicator when isError=true", () => {
		const result = formatToolFooter({
			toolName: "bash",
			elapsedMs: 10,
			outputBytes: 100,
			isError: true,
		});
		const stripped = stripAnsi(result);
		expect(stripped).toContain("error");
	});

	describe("tool-specific metadata", () => {
		it("bash: shows exit code", () => {
			const result = formatToolFooter({
				toolName: "bash",
				elapsedMs: 10,
				outputBytes: 100,
				metadata: { exitCode: 0 },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("exit:");
			expect(stripped).toContain("0");
		});

		it("bash: shows truncated/timed out flags", () => {
			const result = formatToolFooter({
				toolName: "bash",
				elapsedMs: 10,
				outputBytes: 100,
				metadata: { truncated: true, timedOut: true },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("truncated");
			expect(stripped).toContain("timed out");
		});

		it("read: shows line counts", () => {
			const result = formatToolFooter({
				toolName: "read",
				elapsedMs: 5,
				outputBytes: 500,
				metadata: { displayedLines: 50, totalLines: 100 },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("lines:");
			expect(stripped).toContain("50");
			expect(stripped).toContain("100");
		});

		it("grep: shows match count", () => {
			const result = formatToolFooter({
				toolName: "grep",
				elapsedMs: 15,
				outputBytes: 300,
				metadata: { matchCount: 42 },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("matches:");
			expect(stripped).toContain("42");
		});

		it("edit: shows edits applied", () => {
			const result = formatToolFooter({
				toolName: "edit",
				elapsedMs: 8,
				outputBytes: 200,
				metadata: { editsApplied: 3 },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("edits:");
			expect(stripped).toContain("3");
		});

		it("diff: shows additions and deletions", () => {
			const result = formatToolFooter({
				toolName: "diff",
				elapsedMs: 5,
				outputBytes: 100,
				metadata: { additions: 10, deletions: 5 },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("+10");
			expect(stripped).toContain("-5");
		});

		it("default: shows numeric metadata values", () => {
			const result = formatToolFooter({
				toolName: "custom_tool",
				elapsedMs: 10,
				outputBytes: 100,
				metadata: { count: 7, label: "test" },
			});
			const stripped = stripAnsi(result);
			expect(stripped).toContain("count:");
			expect(stripped).toContain("7");
		});
	});
});
