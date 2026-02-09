import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { loadContextFiles, buildContextString } from "../src/context-files.js";
import type { ContextFiles } from "../src/context-files.js";

vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
	},
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

const PROJECT_DIR = "/home/user/project";

describe("loadContextFiles", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty object when no files exist", () => {
		mockExistsSync.mockReturnValue(false);

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBeUndefined();
		expect(result.systemOverride).toBeUndefined();
		expect(result.appendInstructions).toBeUndefined();
	});

	it("loads CHITRAGUPTA.md from project root", () => {
		mockExistsSync.mockImplementation((p) => {
			return p === path.join(PROJECT_DIR, "CHITRAGUPTA.md");
		});
		mockReadFileSync.mockReturnValue("# Project Instructions\nDo this.");

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBe("# Project Instructions\nDo this.");
	});

	it("trims whitespace from CHITRAGUPTA.md content", () => {
		mockExistsSync.mockImplementation((p) => {
			return p === path.join(PROJECT_DIR, "CHITRAGUPTA.md");
		});
		mockReadFileSync.mockReturnValue("  content with spaces  \n");

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBe("content with spaces");
	});

	it("returns undefined for empty CHITRAGUPTA.md", () => {
		mockExistsSync.mockImplementation((p) => {
			return p === path.join(PROJECT_DIR, "CHITRAGUPTA.md");
		});
		mockReadFileSync.mockReturnValue("   \n  ");

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBeUndefined();
	});

	it("loads .chitragupta/SYSTEM.md", () => {
		mockExistsSync.mockImplementation((p) => {
			return p === path.join(PROJECT_DIR, ".chitragupta", "SYSTEM.md");
		});
		mockReadFileSync.mockReturnValue("Custom system prompt");

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.systemOverride).toBe("Custom system prompt");
	});

	it("loads .chitragupta/APPEND.md", () => {
		mockExistsSync.mockImplementation((p) => {
			return p === path.join(PROJECT_DIR, ".chitragupta", "APPEND.md");
		});
		mockReadFileSync.mockReturnValue("Appended instructions");

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.appendInstructions).toBe("Appended instructions");
	});

	it("returns all found files", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockImplementation((p) => {
			const filePath = p.toString();
			if (filePath.includes("CHITRAGUPTA.md")) return "project";
			if (filePath.includes("SYSTEM.md")) return "system";
			if (filePath.includes("APPEND.md")) return "append";
			return "";
		});

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBe("project");
		expect(result.systemOverride).toBe("system");
		expect(result.appendInstructions).toBe("append");
	});

	it("returns undefined for files that throw on read", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockImplementation(() => {
			throw new Error("Permission denied");
		});

		const result = loadContextFiles(PROJECT_DIR);
		expect(result.projectInstructions).toBeUndefined();
		expect(result.systemOverride).toBeUndefined();
		expect(result.appendInstructions).toBeUndefined();
	});
});

describe("buildContextString", () => {
	it("uses systemOverride when present", () => {
		const files: ContextFiles = {
			systemOverride: "Custom system",
			projectInstructions: "Should be ignored",
		};

		const result = buildContextString(files);
		expect(result).toBe("Custom system");
		expect(result).not.toContain("Should be ignored");
	});

	it("appends APPEND.md even with systemOverride", () => {
		const files: ContextFiles = {
			systemOverride: "Custom system",
			appendInstructions: "Extra append",
		};

		const result = buildContextString(files);
		expect(result).toBe("Custom system\n\nExtra append");
	});

	it("ignores projectInstructions when systemOverride is present", () => {
		const files: ContextFiles = {
			systemOverride: "Override",
			projectInstructions: "Project",
			appendInstructions: "Append",
		};

		const result = buildContextString(files);
		expect(result).toBe("Override\n\nAppend");
		expect(result).not.toContain("Project");
	});

	it("concatenates projectInstructions and appendInstructions", () => {
		const files: ContextFiles = {
			projectInstructions: "Project notes",
			appendInstructions: "Append notes",
		};

		const result = buildContextString(files);
		expect(result).toBe("Project notes\n\nAppend notes");
	});

	it("returns only projectInstructions when no append", () => {
		const files: ContextFiles = {
			projectInstructions: "Project only",
		};

		const result = buildContextString(files);
		expect(result).toBe("Project only");
	});

	it("returns only appendInstructions when no project", () => {
		const files: ContextFiles = {
			appendInstructions: "Append only",
		};

		const result = buildContextString(files);
		expect(result).toBe("Append only");
	});

	it("returns empty string when no files loaded", () => {
		const files: ContextFiles = {};

		const result = buildContextString(files);
		expect(result).toBe("");
	});
});
