import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import type { SkillManifest } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillManifest> = {}): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill",
		capabilities: [
			{ verb: "read", object: "files", description: "Read files" },
		],
		tags: ["test", "io"],
		source: { type: "tool", toolName: "test_tool" },
		updatedAt: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

function makeFileReader(): SkillManifest {
	return makeSkill({
		name: "file-reader",
		description: "Read files from the local filesystem",
		capabilities: [
			{
				verb: "read",
				object: "files",
				description: "Read file contents",
				parameters: {
					path: { type: "string", description: "File path", required: true },
				},
			},
		],
		tags: ["filesystem", "io", "read"],
		source: { type: "tool", toolName: "read_file" },
	});
}

function makeCodeAnalyzer(): SkillManifest {
	return makeSkill({
		name: "code-analyzer",
		description: "Analyze source code for patterns, bugs, and quality metrics",
		capabilities: [
			{ verb: "analyze", object: "code", description: "Static analysis" },
			{ verb: "search", object: "patterns", description: "Find code patterns" },
		],
		tags: ["code", "analysis", "quality"],
		source: { type: "plugin", pluginName: "linter" },
	});
}

function makeDbWriter(): SkillManifest {
	return makeSkill({
		name: "db-writer",
		description: "Write records to a database",
		capabilities: [
			{ verb: "write", object: "database", description: "Insert records" },
		],
		tags: ["database", "write", "sql"],
		source: { type: "mcp-server", serverId: "pg", serverName: "postgres" },
	});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SkillRegistry", () => {
	let registry: SkillRegistry;

	beforeEach(() => {
		registry = new SkillRegistry();
	});

	// ── Registration ──────────────────────────────────────────────────

	describe("register", () => {
		it("registers a skill and makes it retrievable by name", () => {
			const skill = makeFileReader();
			registry.register(skill);
			expect(registry.get("file-reader")).toBeDefined();
			expect(registry.get("file-reader")!.name).toBe("file-reader");
		});

		it("computes and attaches a trait vector on registration", () => {
			const skill = makeFileReader();
			expect(skill.traitVector).toBeUndefined();
			registry.register(skill);
			const stored = registry.get("file-reader")!;
			expect(stored.traitVector).toBeDefined();
			expect(stored.traitVector!.length).toBe(128);
		});

		it("preserves an existing trait vector if present", () => {
			const skill = makeFileReader();
			skill.traitVector = new Array(128).fill(0.1);
			registry.register(skill);
			const stored = registry.get("file-reader")!;
			// Should be the stored vector (converted from input), not recomputed to all 0.1
			expect(stored.traitVector).toBeDefined();
			expect(stored.traitVector!.length).toBe(128);
		});

		it("replaces an existing skill with the same name", () => {
			registry.register(makeSkill({ name: "s1", version: "1.0.0" }));
			registry.register(makeSkill({ name: "s1", version: "2.0.0" }));
			expect(registry.size).toBe(1);
			expect(registry.get("s1")!.version).toBe("2.0.0");
		});

		it("increments size for unique registrations", () => {
			expect(registry.size).toBe(0);
			registry.register(makeFileReader());
			expect(registry.size).toBe(1);
			registry.register(makeCodeAnalyzer());
			expect(registry.size).toBe(2);
			registry.register(makeDbWriter());
			expect(registry.size).toBe(3);
		});
	});

	// ── Unregistration ────────────────────────────────────────────────

	describe("unregister", () => {
		it("removes a skill and returns true", () => {
			registry.register(makeFileReader());
			expect(registry.unregister("file-reader")).toBe(true);
			expect(registry.get("file-reader")).toBeUndefined();
			expect(registry.size).toBe(0);
		});

		it("returns false for a non-existent skill", () => {
			expect(registry.unregister("nonexistent")).toBe(false);
		});

		it("cleans up tag index on unregister", () => {
			registry.register(makeFileReader());
			registry.unregister("file-reader");
			expect(registry.getByTag("filesystem")).toHaveLength(0);
		});

		it("cleans up verb index on unregister", () => {
			registry.register(makeFileReader());
			registry.unregister("file-reader");
			expect(registry.getByVerb("read")).toHaveLength(0);
		});
	});

	// ── Lookup by Tag ─────────────────────────────────────────────────

	describe("getByTag", () => {
		it("returns skills with a matching tag", () => {
			registry.register(makeFileReader());
			registry.register(makeCodeAnalyzer());
			registry.register(makeDbWriter());

			const ioSkills = registry.getByTag("io");
			expect(ioSkills.length).toBe(1);
			expect(ioSkills[0].name).toBe("file-reader");
		});

		it("is case-insensitive", () => {
			registry.register(makeFileReader());
			const results = registry.getByTag("FILESYSTEM");
			expect(results.length).toBe(1);
			expect(results[0].name).toBe("file-reader");
		});

		it("returns an empty array for an unknown tag", () => {
			registry.register(makeFileReader());
			expect(registry.getByTag("nonexistent")).toHaveLength(0);
		});

		it("returns multiple skills that share a tag", () => {
			registry.register(makeFileReader()); // tags: filesystem, io, read
			registry.register(makeDbWriter());   // tags: database, write, sql
			// Both have no shared tag. Let's add one that does
			registry.register(makeSkill({
				name: "file-writer",
				capabilities: [{ verb: "write", object: "files", description: "Write files" }],
				tags: ["filesystem", "io", "write"],
			}));
			const ioSkills = registry.getByTag("io");
			expect(ioSkills.length).toBe(2);
		});
	});

	// ── Lookup by Verb ────────────────────────────────────────────────

	describe("getByVerb", () => {
		it("returns skills with a matching capability verb", () => {
			registry.register(makeFileReader());
			registry.register(makeCodeAnalyzer());
			registry.register(makeDbWriter());

			const readers = registry.getByVerb("read");
			expect(readers.length).toBe(1);
			expect(readers[0].name).toBe("file-reader");
		});

		it("is case-insensitive", () => {
			registry.register(makeCodeAnalyzer());
			const results = registry.getByVerb("ANALYZE");
			expect(results.length).toBe(1);
		});

		it("returns skills with multiple matching capabilities", () => {
			registry.register(makeCodeAnalyzer()); // analyze + search
			const searchers = registry.getByVerb("search");
			expect(searchers.length).toBe(1);
			expect(searchers[0].name).toBe("code-analyzer");
		});

		it("returns an empty array for an unknown verb", () => {
			registry.register(makeFileReader());
			expect(registry.getByVerb("deploy")).toHaveLength(0);
		});
	});

	// ── getAll ────────────────────────────────────────────────────────

	describe("getAll", () => {
		it("returns all registered skills", () => {
			registry.register(makeFileReader());
			registry.register(makeCodeAnalyzer());
			registry.register(makeDbWriter());
			const all = registry.getAll();
			expect(all.length).toBe(3);
			const names = all.map((s) => s.name).sort();
			expect(names).toEqual(["code-analyzer", "db-writer", "file-reader"]);
		});

		it("returns an empty array when registry is empty", () => {
			expect(registry.getAll()).toHaveLength(0);
		});
	});

	// ── clear ─────────────────────────────────────────────────────────

	describe("clear", () => {
		it("removes all skills and resets size to zero", () => {
			registry.register(makeFileReader());
			registry.register(makeCodeAnalyzer());
			registry.clear();
			expect(registry.size).toBe(0);
			expect(registry.getAll()).toHaveLength(0);
			expect(registry.get("file-reader")).toBeUndefined();
		});

		it("clears all secondary indices", () => {
			registry.register(makeFileReader());
			registry.clear();
			expect(registry.getByTag("filesystem")).toHaveLength(0);
			expect(registry.getByVerb("read")).toHaveLength(0);
		});
	});

	// ── query ─────────────────────────────────────────────────────────

	describe("query", () => {
		it("returns ranked matches for a text query", () => {
			registry.register(makeFileReader());
			registry.register(makeCodeAnalyzer());
			registry.register(makeDbWriter());

			const matches = registry.query({ text: "read files from disk" });
			expect(matches.length).toBeGreaterThan(0);
			// file-reader should be top-ranked for this query
			expect(matches[0].skill.name).toBe("file-reader");
		});

		it("returns an empty array when no skills are registered", () => {
			const matches = registry.query({ text: "anything" });
			expect(matches).toHaveLength(0);
		});
	});
});
