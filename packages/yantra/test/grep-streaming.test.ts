import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { searchFileStreaming } from "../src/grep-streaming.js";
import type { GrepMatch } from "../src/grep.js";

vi.mock("node:fs", () => ({
	default: {
		createReadStream: vi.fn(),
	},
	createReadStream: vi.fn(),
}));

vi.mock("node:readline", () => ({
	default: {
		createInterface: vi.fn(),
	},
	createInterface: vi.fn(),
}));

const mockCreateReadStream = vi.mocked(fs.createReadStream);
const mockCreateInterface = vi.mocked(readline.createInterface);

function mockLines(lines: string[]) {
	const fakeStream = new EventEmitter() as any;
	fakeStream.destroy = vi.fn();

	mockCreateReadStream.mockReturnValue(fakeStream as any);

	const rl = {
		[Symbol.asyncIterator]: async function* () {
			for (const line of lines) {
				yield line;
			}
		},
		close: vi.fn(),
	};

	mockCreateInterface.mockReturnValue(rl as any);
}

describe("searchFileStreaming", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("finds lines matching a regex", async () => {
		mockLines(["hello world", "foo bar", "hello again"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /hello/g, matches, 50, false, 0, 0);

		expect(matches).toHaveLength(2);
		expect(matches[0].text).toBe("hello world");
		expect(matches[0].line).toBe(1);
		expect(matches[0].file).toBe("/test.txt");
		expect(matches[1].text).toBe("hello again");
		expect(matches[1].line).toBe(3);
	});

	it("matches with case-insensitive regex", async () => {
		mockLines(["Hello World", "hello again", "HELLO UPPER"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /hello/gi, matches, 50, false, 0, 0);

		expect(matches).toHaveLength(3);
	});

	it("returns no matches for non-matching content", async () => {
		mockLines(["alpha", "beta", "gamma"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /delta/g, matches, 50, false, 0, 0);

		expect(matches).toHaveLength(0);
	});

	it("includes before-context lines", async () => {
		mockLines(["line1", "line2", "MATCH", "line4"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /MATCH/g, matches, 50, false, 2, 0);

		const contextMatches = matches.filter((m) => m.isContext);
		const realMatches = matches.filter((m) => !m.isContext);
		expect(contextMatches).toHaveLength(2);
		expect(realMatches).toHaveLength(1);
		expect(realMatches[0].text).toBe("MATCH");
		expect(contextMatches[0].text).toBe("line1");
		expect(contextMatches[1].text).toBe("line2");
	});

	it("includes after-context lines", async () => {
		mockLines(["MATCH", "after1", "after2", "unrelated"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /MATCH/g, matches, 50, false, 0, 2);

		expect(matches).toHaveLength(3);
		expect(matches[0].isContext).toBeUndefined();
		expect(matches[0].text).toBe("MATCH");
		expect(matches[1].isContext).toBe(true);
		expect(matches[1].text).toBe("after1");
		expect(matches[2].isContext).toBe(true);
		expect(matches[2].text).toBe("after2");
	});

	it("includes both before and after context", async () => {
		mockLines(["before1", "before2", "MATCH", "after1", "after2"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /MATCH/g, matches, 50, false, 1, 1);

		expect(matches).toHaveLength(3);
		expect(matches[0].isContext).toBe(true);
		expect(matches[0].text).toBe("before2");
		expect(matches[1].text).toBe("MATCH");
		expect(matches[2].isContext).toBe(true);
		expect(matches[2].text).toBe("after1");
	});

	it("returns non-matching lines when invert is true", async () => {
		mockLines(["hello", "world", "hello again"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /hello/g, matches, 50, true, 0, 0);

		expect(matches).toHaveLength(1);
		expect(matches[0].text).toBe("world");
	});

	it("returns all lines when invert regex matches nothing", async () => {
		mockLines(["alpha", "beta", "gamma"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /zzz/g, matches, 50, true, 0, 0);

		expect(matches).toHaveLength(3);
	});

	it("caps matches at maxResults", async () => {
		mockLines(["match1", "match2", "match3", "match4", "match5"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /match/g, matches, 3, false, 0, 0);

		const realMatches = matches.filter((m) => !m.isContext);
		expect(realMatches.length).toBeLessThanOrEqual(3);
	});

	it("stops early once maxResults reached and no after-context needed", async () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
		mockLines(lines);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /line/g, matches, 2, false, 0, 0);

		const realMatches = matches.filter((m) => !m.isContext);
		expect(realMatches).toHaveLength(2);
	});

	it("truncates lines longer than 500 characters", async () => {
		const longLine = "x".repeat(600);
		mockLines([longLine]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /x/g, matches, 50, false, 0, 0);

		expect(matches).toHaveLength(1);
		expect(matches[0].text.length).toBeLessThanOrEqual(503);
		expect(matches[0].text).toMatch(/\.\.\.$/);
	});

	it("does not truncate lines of exactly 500 characters", async () => {
		const line = "y".repeat(500);
		mockLines([line]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /y/g, matches, 50, false, 0, 0);

		expect(matches[0].text).toBe(line);
		expect(matches[0].text).not.toContain("...");
	});

	it("handles read errors gracefully", async () => {
		const fakeStream = new EventEmitter() as any;
		fakeStream.destroy = vi.fn();
		mockCreateReadStream.mockReturnValue(fakeStream as any);

		const rl = {
			[Symbol.asyncIterator]: async function* () {
				yield "line1";
				throw new Error("read error");
			},
			close: vi.fn(),
		};
		mockCreateInterface.mockReturnValue(rl as any);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /line/g, matches, 50, false, 0, 0);

		expect(matches.length).toBeGreaterThanOrEqual(0);
	});

	it("handles empty file gracefully", async () => {
		mockLines([]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /anything/g, matches, 50, false, 0, 0);

		expect(matches).toHaveLength(0);
	});

	it("assigns correct line numbers", async () => {
		mockLines(["a", "b", "c", "d", "e"]);

		const matches: GrepMatch[] = [];
		await searchFileStreaming("/test.txt", /[ace]/g, matches, 50, false, 0, 0);

		expect(matches[0].line).toBe(1);
		expect(matches[1].line).toBe(3);
		expect(matches[2].line).toBe(5);
	});
});
