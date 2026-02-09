import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @chitragupta/core before importing streams
vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/mock/.chitragupta",
}));

// Mock fs module
vi.mock("fs", () => {
	const store: Map<string, string> = new Map();
	const dirs: Set<string> = new Set();

	return {
		default: {
			existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
			readFileSync: vi.fn((p: string) => {
				if (store.has(p)) return store.get(p)!;
				throw new Error(`ENOENT: ${p}`);
			}),
			writeFileSync: vi.fn((p: string, data: string) => {
				store.set(p, data);
			}),
			mkdirSync: vi.fn((p: string) => {
				dirs.add(p);
			}),
			readdirSync: vi.fn((p: string) => {
				if (p.endsWith("/flow")) {
					// Return whatever .md files we have under flow/
					const files: string[] = [];
					for (const key of store.keys()) {
						if (key.startsWith(p + "/") && key.endsWith(".md")) {
							files.push(key.split("/").pop()!);
						}
					}
					return files;
				}
				return [];
			}),
			// Expose internal store for test manipulation
			__store: store,
			__dirs: dirs,
		},
	};
});

import fs from "fs";
import {
	StreamManager,
	STREAM_CONFIGS,
	STREAM_ORDER,
	PRESERVATION_RATIOS,
	estimateTokens,
} from "@chitragupta/smriti";

// Get access to the mock store for direct manipulation
const mockFs = fs as unknown as {
	existsSync: ReturnType<typeof vi.fn>;
	readFileSync: ReturnType<typeof vi.fn>;
	writeFileSync: ReturnType<typeof vi.fn>;
	mkdirSync: ReturnType<typeof vi.fn>;
	readdirSync: ReturnType<typeof vi.fn>;
	__store: Map<string, string>;
	__dirs: Set<string>;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockFs.__store.clear();
	mockFs.__dirs.clear();
});

// ─── STREAM_CONFIGS ─────────────────────────────────────────────────────────

describe("STREAM_CONFIGS", () => {
	it("has all 4 stream types", () => {
		expect(STREAM_CONFIGS).toHaveProperty("identity");
		expect(STREAM_CONFIGS).toHaveProperty("projects");
		expect(STREAM_CONFIGS).toHaveProperty("tasks");
		expect(STREAM_CONFIGS).toHaveProperty("flow");
	});

	it("identity has preservation ratio 0.95", () => {
		expect(STREAM_CONFIGS.identity.preservation).toBe(0.95);
	});

	it("projects has preservation ratio 0.80", () => {
		expect(STREAM_CONFIGS.projects.preservation).toBe(0.80);
	});

	it("tasks has preservation ratio 0.70", () => {
		expect(STREAM_CONFIGS.tasks.preservation).toBe(0.70);
	});

	it("flow has preservation ratio 0.30", () => {
		expect(STREAM_CONFIGS.flow.preservation).toBe(0.30);
	});

	it("each config has type, filename, preservation, description", () => {
		for (const key of Object.keys(STREAM_CONFIGS) as Array<keyof typeof STREAM_CONFIGS>) {
			const config = STREAM_CONFIGS[key];
			expect(config.type).toBe(key);
			expect(config.filename).toBeTruthy();
			expect(config.preservation).toBeGreaterThan(0);
			expect(config.preservation).toBeLessThanOrEqual(1);
			expect(config.description).toBeTruthy();
		}
	});
});

// ─── STREAM_ORDER ───────────────────────────────────────────────────────────

describe("STREAM_ORDER", () => {
	it("contains 4 stream types in canonical order", () => {
		expect(STREAM_ORDER).toEqual(["identity", "projects", "tasks", "flow"]);
	});
});

// ─── PRESERVATION_RATIOS ────────────────────────────────────────────────────

describe("PRESERVATION_RATIOS", () => {
	it("matches STREAM_ORDER preservation values", () => {
		expect(PRESERVATION_RATIOS).toEqual([0.95, 0.80, 0.70, 0.30]);
	});

	it("is sorted in descending order", () => {
		for (let i = 1; i < PRESERVATION_RATIOS.length; i++) {
			expect(PRESERVATION_RATIOS[i]).toBeLessThanOrEqual(PRESERVATION_RATIOS[i - 1]);
		}
	});
});

// ─── estimateTokens ─────────────────────────────────────────────────────────

describe("estimateTokens", () => {
	it("returns Math.ceil(text.length / 4)", () => {
		expect(estimateTokens("abcd")).toBe(1); // 4/4 = 1
		expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
		expect(estimateTokens("a")).toBe(1); // ceil(1/4) = 1
		expect(estimateTokens("")).toBe(0); // ceil(0/4) = 0
	});

	it("handles longer text", () => {
		const text = "x".repeat(100);
		expect(estimateTokens(text)).toBe(25); // 100/4 = 25
	});

	it("handles non-exact multiples", () => {
		const text = "x".repeat(101);
		expect(estimateTokens(text)).toBe(26); // ceil(101/4) = 26
	});
});

// ─── StreamManager ──────────────────────────────────────────────────────────

describe("StreamManager", () => {
	let manager: StreamManager;

	beforeEach(() => {
		manager = new StreamManager();
	});

	// ── read ──────────────────────────────────────────────────────────

	describe("read()", () => {
		it("returns file content when file exists", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/identity.md";
			mockFs.__store.set(filePath, "# Identity Stream\n\nSome content\n");

			const result = manager.read("identity");
			expect(result).toBe("# Identity Stream\n\nSome content\n");
		});

		it("returns empty string when file does not exist", () => {
			const result = manager.read("identity");
			expect(result).toBe("");
		});

		it("returns empty string on read error", () => {
			mockFs.existsSync.mockImplementationOnce(() => { throw new Error("boom"); });
			const result = manager.read("identity");
			expect(result).toBe("");
		});
	});

	// ── readContent ───────────────────────────────────────────────────

	describe("readContent()", () => {
		it("returns body without header/footer", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/identity.md";
			const fileContent = [
				"# Identity Stream",
				"",
				"> WHO — personal preferences, corrections, facts, style. Near-immutable.",
				"> Preservation ratio: 0.95",
				"",
				"My name is Bob and I prefer tabs.",
				"",
				"---",
				"",
				"## Meta",
				"",
				"- last_updated: 2024-01-01T00:00:00.000Z",
				"- token_count: 50",
				"",
			].join("\n");
			mockFs.__store.set(filePath, fileContent);

			const result = manager.readContent("identity");
			expect(result).toContain("My name is Bob");
			// Should NOT contain the header or footer
			expect(result).not.toContain("# Identity Stream");
			expect(result).not.toContain("## Meta");
		});

		it("returns empty string when file does not exist", () => {
			const result = manager.readContent("projects");
			expect(result).toBe("");
		});
	});

	// ── write ─────────────────────────────────────────────────────────

	describe("write()", () => {
		it("calls writeFileSync with header + content + footer", () => {
			manager.write("identity", "I prefer dark mode.");

			expect(mockFs.writeFileSync).toHaveBeenCalled();
			const [filePath, written] = mockFs.writeFileSync.mock.calls[0];
			expect(filePath).toContain("identity.md");
			expect(written).toContain("# Identity Stream");
			expect(written).toContain("I prefer dark mode.");
			expect(written).toContain("## Meta");
			expect(written).toContain("token_count:");
		});

		it("calls mkdirSync to ensure directories exist", () => {
			manager.write("identity", "content");
			expect(mockFs.mkdirSync).toHaveBeenCalled();
		});

		it("writes flow stream with device-specific path", () => {
			manager.write("flow", "current topic: testing", "laptop");

			const [filePath] = mockFs.writeFileSync.mock.calls[0];
			expect(filePath).toContain("flow/laptop.md");
		});
	});

	// ── append ────────────────────────────────────────────────────────

	describe("append()", () => {
		it("creates new file when stream does not exist", () => {
			manager.append("tasks", "- Buy groceries");

			expect(mockFs.writeFileSync).toHaveBeenCalled();
			const [filePath, written] = mockFs.writeFileSync.mock.calls[0];
			expect(filePath).toContain("tasks.md");
			expect(written).toContain("# Tasks Stream");
			expect(written).toContain("- Buy groceries");
		});

		it("appends with timestamp separator when stream exists", () => {
			const existingPath = "/mock/.chitragupta/smriti/streams/tasks.md";
			const existing = [
				"# Tasks Stream",
				"",
				"> TODO — pending tasks, completed items, archived entries.",
				"> Preservation ratio: 0.70",
				"",
				"- Existing task",
				"",
				"---",
				"",
				"## Meta",
				"",
				"- last_updated: 2024-01-01T00:00:00.000Z",
				"- token_count: 30",
				"",
			].join("\n");
			mockFs.__store.set(existingPath, existing);

			manager.append("tasks", "- New task");

			const [, written] = mockFs.writeFileSync.mock.calls[0];
			expect(written).toContain("- Existing task");
			expect(written).toContain("- New task");
			// Should have a timestamp separator between
			expect(written).toMatch(/\*\d{4}-\d{2}-\d{2}T/);
		});
	});

	// ── getTokenCount ─────────────────────────────────────────────────

	describe("getTokenCount()", () => {
		it("returns estimated tokens for stream content", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/identity.md";
			mockFs.__store.set(filePath, "x".repeat(100)); // 100 chars = 25 tokens

			const count = manager.getTokenCount("identity");
			expect(count).toBe(25);
		});

		it("returns 0 for non-existent stream", () => {
			const count = manager.getTokenCount("identity");
			expect(count).toBe(0);
		});
	});

	// ── getAllTokenCounts ──────────────────────────────────────────────

	describe("getAllTokenCounts()", () => {
		it("returns record with all 4 stream types", () => {
			const counts = manager.getAllTokenCounts();
			expect(counts).toHaveProperty("identity");
			expect(counts).toHaveProperty("projects");
			expect(counts).toHaveProperty("tasks");
			expect(counts).toHaveProperty("flow");
		});

		it("returns 0 for all streams when none exist", () => {
			const counts = manager.getAllTokenCounts();
			expect(counts.identity).toBe(0);
			expect(counts.projects).toBe(0);
			expect(counts.tasks).toBe(0);
			expect(counts.flow).toBe(0);
		});

		it("returns correct counts when streams have content", () => {
			mockFs.__store.set("/mock/.chitragupta/smriti/streams/identity.md", "x".repeat(40));
			mockFs.__store.set("/mock/.chitragupta/smriti/streams/projects.md", "x".repeat(80));

			const counts = manager.getAllTokenCounts();
			expect(counts.identity).toBe(10);
			expect(counts.projects).toBe(20);
			expect(counts.tasks).toBe(0);
			expect(counts.flow).toBe(0);
		});
	});

	// ── getStreamBudgets ──────────────────────────────────────────────

	describe("getStreamBudgets()", () => {
		it("allocates proportionally to preservation ratios", () => {
			const budgets = manager.getStreamBudgets(1000);

			// Total preservation = 0.95 + 0.80 + 0.70 + 0.30 = 2.75
			// identity: floor(1000 * 0.95/2.75) = floor(345.45) = 345
			// projects: floor(1000 * 0.80/2.75) = floor(290.90) = 290
			// tasks:    floor(1000 * 0.70/2.75) = floor(254.54) = 254
			// flow:     floor(1000 * 0.30/2.75) = floor(109.09) = 109
			// remainder: 1000 - (345+290+254+109) = 2 -> identity

			expect(budgets.identity).toBeGreaterThan(budgets.projects);
			expect(budgets.projects).toBeGreaterThan(budgets.tasks);
			expect(budgets.tasks).toBeGreaterThan(budgets.flow);
		});

		it("identity gets the most budget", () => {
			const budgets = manager.getStreamBudgets(1000);
			const max = Math.max(budgets.identity, budgets.projects, budgets.tasks, budgets.flow);
			expect(budgets.identity).toBe(max);
		});

		it("remainder goes to identity", () => {
			const budgets = manager.getStreamBudgets(1000);
			const total = budgets.identity + budgets.projects + budgets.tasks + budgets.flow;
			expect(total).toBe(1000);
		});

		it("handles small budgets", () => {
			const budgets = manager.getStreamBudgets(10);
			const total = budgets.identity + budgets.projects + budgets.tasks + budgets.flow;
			expect(total).toBe(10);
		});

		it("handles zero budget", () => {
			const budgets = manager.getStreamBudgets(0);
			const total = budgets.identity + budgets.projects + budgets.tasks + budgets.flow;
			expect(total).toBe(0);
		});
	});

	// ── enforcePreservation ───────────────────────────────────────────

	describe("enforcePreservation()", () => {
		it("returns 0 when under budget", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/identity.md";
			mockFs.__store.set(filePath, "short content");

			const trimmed = manager.enforcePreservation("identity", 10000);
			expect(trimmed).toBe(0);
		});

		it("returns 0 for empty/non-existent stream", () => {
			const trimmed = manager.enforcePreservation("identity", 100);
			expect(trimmed).toBe(0);
		});

		it("returns 0 when stream has a single entry that cannot be split", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/tasks.md";
			const longContent = [
				"# Tasks Stream",
				"",
				"> TODO — pending tasks, completed items, archived entries.",
				"> Preservation ratio: 0.70",
				"",
				"x".repeat(500),
				"",
				"---",
				"",
				"## Meta",
				"",
				"- last_updated: 2024-01-01T00:00:00.000Z",
				"- token_count: 125",
				"",
			].join("\n");
			mockFs.__store.set(filePath, longContent);

			const trimmed = manager.enforcePreservation("tasks", 5);
			expect(trimmed).toBe(0);
		});
	});

	// ── exists ────────────────────────────────────────────────────────

	describe("exists()", () => {
		it("returns true when stream file exists", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/identity.md";
			mockFs.__store.set(filePath, "content");

			expect(manager.exists("identity")).toBe(true);
		});

		it("returns false when stream file does not exist", () => {
			expect(manager.exists("identity")).toBe(false);
		});

		it("checks flow stream with device id", () => {
			const filePath = "/mock/.chitragupta/smriti/streams/flow/laptop.md";
			mockFs.__store.set(filePath, "flow content");

			expect(manager.exists("flow", "laptop")).toBe(true);
			expect(manager.exists("flow", "desktop")).toBe(false);
		});
	});

	// ── listFlowDevices ───────────────────────────────────────────────

	describe("listFlowDevices()", () => {
		it("lists .md files in flow dir, stripping extension", () => {
			const flowDir = "/mock/.chitragupta/smriti/streams/flow";
			mockFs.__dirs.add(flowDir);
			mockFs.__store.set(`${flowDir}/laptop.md`, "flow");
			mockFs.__store.set(`${flowDir}/desktop.md`, "flow");

			const devices = manager.listFlowDevices();
			expect(devices).toContain("laptop");
			expect(devices).toContain("desktop");
			expect(devices).toHaveLength(2);
		});

		it("returns empty array if flow dir does not exist", () => {
			const devices = manager.listFlowDevices();
			expect(devices).toEqual([]);
		});
	});

	// ── getRoot ───────────────────────────────────────────────────────

	describe("getRoot()", () => {
		it("returns the streams root path", () => {
			const root = manager.getRoot();
			expect(root).toBe("/mock/.chitragupta/smriti/streams");
		});
	});
});
