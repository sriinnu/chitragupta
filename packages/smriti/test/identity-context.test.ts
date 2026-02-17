import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock os before importing the module under test
vi.mock("os", () => ({
	default: {
		homedir: vi.fn(() => "/home/testuser"),
	},
}));

// Mock fs before importing the module under test
vi.mock("fs", () => {
	const store = new Map<string, string>();

	return {
		default: {
			existsSync: vi.fn((p: string) => store.has(p)),
			readFileSync: vi.fn((p: string) => {
				if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
				return store.get(p)!;
			}),
		},
		__store: store,
	};
});

import { IdentityContext } from "../src/identity-context.js";
import type { IdentityConfig, IdentityFileType } from "../src/identity-context.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Set a file in the mock filesystem. */
async function setFile(filePath: string, content: string): Promise<void> {
	const fsModule = await import("fs") as any;
	fsModule.__store.set(filePath, content);
}

/** Clear the mock filesystem. */
async function clearFiles(): Promise<void> {
	const fsModule = await import("fs") as any;
	fsModule.__store.clear();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("IdentityContext", () => {
	beforeEach(async () => {
		await clearFiles();
	});

	// ── load() ──────────────────────────────────────────────────────────

	describe("load()", () => {
		it("should return empty string when no files found", () => {
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.load()).toBe("");
		});

		it("should load SOUL.md and format with correct header", async () => {
			await setFile("/project/SOUL.md", "You are a helpful assistant.\n\nBe kind and thoughtful.");
			const ctx = new IdentityContext({ projectPath: "/project" });

			const result = ctx.load();
			expect(result).toContain("## Identity & Values");
			expect(result).toContain("### Soul (Operating Contract)");
			expect(result).toContain("You are a helpful assistant.");
			expect(result).toContain("Be kind and thoughtful.");
		});

		it("should load multiple identity files and concatenate sections", async () => {
			await setFile("/project/SOUL.md", "Soul content here.");
			await setFile("/project/IDENTITY.md", "Identity content here.");
			await setFile("/project/USER.md", "User profile content here.");

			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).toContain("### Soul (Operating Contract)");
			expect(result).toContain("Soul content here.");
			expect(result).toContain("### Identity");
			expect(result).toContain("Identity content here.");
			expect(result).toContain("### User Profile");
			expect(result).toContain("User profile content here.");
		});

		it("should strip YAML frontmatter", async () => {
			const content = [
				"---",
				"title: Soul Definition",
				"version: 1.0",
				"---",
				"",
				"Core values and principles.",
			].join("\n");

			await setFile("/project/SOUL.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).not.toContain("title: Soul Definition");
			expect(result).not.toContain("version: 1.0");
			expect(result).toContain("Core values and principles.");
		});

		it("should strip top-level heading", async () => {
			const content = "# My Soul Document\n\nThe actual content starts here.";
			await setFile("/project/SOUL.md", content);

			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).not.toContain("# My Soul Document");
			expect(result).toContain("The actual content starts here.");
		});

		it("should strip both YAML frontmatter and top-level heading", async () => {
			const content = [
				"---",
				"title: Soul",
				"---",
				"",
				"# Soul",
				"",
				"Actual content.",
			].join("\n");

			await setFile("/project/SOUL.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).not.toContain("title: Soul");
			expect(result).not.toMatch(/^# Soul$/m);
			expect(result).toContain("Actual content.");
		});

		it("should truncate to maxCharsPerFile", async () => {
			const longContent = "A".repeat(5000);
			await setFile("/project/SOUL.md", longContent);

			const ctx = new IdentityContext({
				projectPath: "/project",
				maxCharsPerFile: 100,
			});
			const result = ctx.load();

			expect(result).toContain("[...truncated]");
			// The soul content should be truncated
			const soulSection = result.split("### Soul (Operating Contract)")[1];
			expect(soulSection).toBeDefined();
			// The raw A's plus truncation marker
			expect(soulSection!.includes("[...truncated]")).toBe(true);
		});

		it("should not truncate when content is within maxCharsPerFile", async () => {
			await setFile("/project/SOUL.md", "Short content.");
			const ctx = new IdentityContext({
				projectPath: "/project",
				maxCharsPerFile: 3000,
			});
			const result = ctx.load();

			expect(result).not.toContain("[...truncated]");
			expect(result).toContain("Short content.");
		});

		it("should handle lowercase filename (soul.md)", async () => {
			await setFile("/project/soul.md", "Lowercase soul content.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).toContain("### Soul (Operating Contract)");
			expect(result).toContain("Lowercase soul content.");
		});

		it("should prefer uppercase filename over lowercase", async () => {
			await setFile("/project/SOUL.md", "Uppercase content.");
			await setFile("/project/soul.md", "Lowercase content.");

			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			// FILE_NAMES lists SOUL.md first, so it should be found first
			expect(result).toContain("Uppercase content.");
		});
	});

	// ── loadUserPreferences() ───────────────────────────────────────────

	describe("loadUserPreferences()", () => {
		it("should return empty string when no USER.md exists", () => {
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.loadUserPreferences()).toBe("");
		});

		it("should extract preference sections from USER.md", async () => {
			const content = [
				"# User Profile",
				"",
				"## About Me",
				"I am a developer.",
				"",
				"## Preferences",
				"I like dark mode.",
				"I prefer tabs.",
				"",
				"## Work History",
				"Worked at Acme Corp.",
				"",
				"## Style Guide",
				"Always use TypeScript.",
				"",
			].join("\n");

			await setFile("/project/USER.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.loadUserPreferences();

			// Should include sections with preference keywords
			expect(result).toContain("Preferences");
			expect(result).toContain("I like dark mode.");
			expect(result).toContain("Style Guide");
			expect(result).toContain("Always use TypeScript.");

			// Should NOT include sections without preference keywords
			expect(result).not.toContain("About Me");
			expect(result).not.toContain("Work History");
		});

		it("should return empty if USER.md has no preference sections", async () => {
			const content = [
				"# User Profile",
				"",
				"## Bio",
				"Just a person.",
				"",
				"## Work",
				"Employed somewhere.",
			].join("\n");

			await setFile("/project/USER.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.loadUserPreferences();
			expect(result).toBe("");
		});

		it("should match 'values' as a preference section", async () => {
			const content = [
				"## Core Values",
				"Integrity and transparency.",
			].join("\n");

			await setFile("/project/USER.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.loadUserPreferences();
			expect(result).toContain("Core Values");
			expect(result).toContain("Integrity");
		});

		it("should match 'care about' as a preference section", async () => {
			const content = [
				"## Things I Care About",
				"Code quality and testing.",
			].join("\n");

			await setFile("/project/USER.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.loadUserPreferences();
			expect(result).toContain("Things I Care About");
		});

		it("should match 'contract' as a preference section", async () => {
			const content = [
				"## Operating Contract",
				"Always be honest.",
			].join("\n");

			await setFile("/project/USER.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.loadUserPreferences();
			expect(result).toContain("Operating Contract");
		});
	});

	// ── hasIdentityFiles() ──────────────────────────────────────────────

	describe("hasIdentityFiles()", () => {
		it("should return false when no files exist", () => {
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.hasIdentityFiles()).toBe(false);
		});

		it("should return true when at least one identity file exists", async () => {
			await setFile("/project/SOUL.md", "Soul content.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.hasIdentityFiles()).toBe(true);
		});

		it("should return true for USER.md only", async () => {
			await setFile("/project/USER.md", "User content.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.hasIdentityFiles()).toBe(true);
		});
	});

	// ── getFoundPaths() ─────────────────────────────────────────────────

	describe("getFoundPaths()", () => {
		it("should return null for all types when no files exist", () => {
			const ctx = new IdentityContext({ projectPath: "/project" });
			const paths = ctx.getFoundPaths();

			expect(paths.soul).toBeNull();
			expect(paths.identity).toBeNull();
			expect(paths.personality).toBeNull();
			expect(paths.user).toBeNull();
		});

		it("should return the path for found files", async () => {
			await setFile("/project/SOUL.md", "Soul.");
			await setFile("/project/USER.md", "User.");

			const ctx = new IdentityContext({ projectPath: "/project" });
			const paths = ctx.getFoundPaths();

			expect(paths.soul).toBe("/project/SOUL.md");
			expect(paths.user).toBe("/project/USER.md");
			expect(paths.identity).toBeNull();
			expect(paths.personality).toBeNull();
		});

		it("should return null for missing file types", async () => {
			await setFile("/project/SOUL.md", "Soul only.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			const paths = ctx.getFoundPaths();

			expect(paths.identity).toBeNull();
			expect(paths.personality).toBeNull();
			expect(paths.user).toBeNull();
		});
	});

	// ── clearCache() ────────────────────────────────────────────────────

	describe("clearCache()", () => {
		it("should force reload on next call", async () => {
			const ctx = new IdentityContext({ projectPath: "/project" });

			// First call — no files
			expect(ctx.load()).toBe("");

			// Add a file
			await setFile("/project/SOUL.md", "Cached soul.");

			// Without clearCache, should still be empty (cached)
			expect(ctx.load()).toBe("");

			// After clearCache, should find the file
			ctx.clearCache();
			const result = ctx.load();
			expect(result).toContain("Cached soul.");
		});

		it("should allow detecting newly added files", async () => {
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.hasIdentityFiles()).toBe(false);

			await setFile("/project/IDENTITY.md", "New identity.");
			ctx.clearCache();
			expect(ctx.hasIdentityFiles()).toBe(true);
		});

		it("should reflect file removal after cache clear", async () => {
			await setFile("/project/SOUL.md", "Existing soul.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			expect(ctx.hasIdentityFiles()).toBe(true);

			// Remove the file
			await clearFiles();
			ctx.clearCache();
			expect(ctx.hasIdentityFiles()).toBe(false);
		});
	});

	// ── File search order ───────────────────────────────────────────────

	describe("file search order", () => {
		it("should find files in the project path", async () => {
			await setFile("/project/SOUL.md", "Project soul.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			const paths = ctx.getFoundPaths();
			expect(paths.soul).toBe("/project/SOUL.md");
		});

		it("should find files in parent directories", async () => {
			await setFile("/project/SOUL.md", "Closer soul.");
			// No file in /project/sub, but /project has it
			const ctx = new IdentityContext({ projectPath: "/project/sub/dir" });
			// Parent of /project/sub/dir is /project/sub, then /project
			// So it should find /project/SOUL.md
			// Actually path.dirname("/project/sub/dir") = "/project/sub"
			// Then path.dirname("/project/sub") = "/project"
			const result = ctx.load();
			expect(result).toContain("Closer soul.");
		});

		it("should find files in home directory", async () => {
			await setFile("/home/testuser/SOUL.md", "Home soul.");
			const ctx = new IdentityContext(); // no project path
			const result = ctx.load();
			expect(result).toContain("Home soul.");
		});

		it("should prefer project path over parent directories", async () => {
			await setFile("/project/SOUL.md", "Project soul.");
			await setFile("/SOUL.md", "Root soul.");

			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();
			expect(result).toContain("Project soul.");
			expect(result).not.toContain("Root soul.");
		});

		it("should prefer project path over home directory", async () => {
			await setFile("/project/SOUL.md", "Project soul.");
			await setFile("/home/testuser/SOUL.md", "Home soul.");

			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();
			expect(result).toContain("Project soul.");
			expect(result).not.toContain("Home soul.");
		});
	});

	// ── Config: include list ────────────────────────────────────────────

	describe("config: include list", () => {
		it("should respect custom include list", async () => {
			await setFile("/project/SOUL.md", "Soul content.");
			await setFile("/project/USER.md", "User content.");
			await setFile("/project/IDENTITY.md", "Identity content.");

			const ctx = new IdentityContext({
				projectPath: "/project",
				include: ["soul", "user"],
			});
			const result = ctx.load();

			expect(result).toContain("Soul (Operating Contract)");
			expect(result).toContain("User Profile");
			expect(result).not.toContain("### Identity");
		});

		it("should load only specified file types", async () => {
			await setFile("/project/SOUL.md", "Soul.");
			await setFile("/project/USER.md", "User.");
			await setFile("/project/PERSONALITY.md", "Personality.");
			await setFile("/project/IDENTITY.md", "Identity.");

			const ctx = new IdentityContext({
				projectPath: "/project",
				include: ["personality"],
			});
			const result = ctx.load();

			expect(result).toContain("### Personality & Voice");
			expect(result).not.toContain("### Soul");
			expect(result).not.toContain("### User Profile");
			expect(result).not.toContain("### Identity");
		});

		it("should include agents type when specified", async () => {
			await setFile("/project/AGENTS.md", "Agent behavior rules.");

			const ctx = new IdentityContext({
				projectPath: "/project",
				include: ["agents"],
			});
			const result = ctx.load();

			expect(result).toContain("### Agent Behavior");
			expect(result).toContain("Agent behavior rules.");
		});
	});

	// ── Config: explicit paths ──────────────────────────────────────────

	describe("config: explicit paths", () => {
		it("should use explicit paths when provided", async () => {
			await setFile("/custom/location/my-soul.md", "Custom soul content.");

			const ctx = new IdentityContext({
				paths: {
					soul: "/custom/location/my-soul.md",
					identity: "/nonexistent/identity.md",
					personality: "/nonexistent/personality.md",
					user: "/nonexistent/user.md",
					agents: "/nonexistent/agents.md",
				},
			});
			const result = ctx.load();

			expect(result).toContain("Custom soul content.");
		});

		it("should fall through to auto-detection if explicit path does not exist", async () => {
			await setFile("/project/SOUL.md", "Auto-detected soul.");

			const ctx = new IdentityContext({
				projectPath: "/project",
				paths: {
					soul: "/nonexistent/soul.md",
					identity: "/nonexistent/identity.md",
					personality: "/nonexistent/personality.md",
					user: "/nonexistent/user.md",
					agents: "/nonexistent/agents.md",
				},
			});
			const result = ctx.load();

			// Explicit path doesn't exist, so it should fall back to project path
			expect(result).toContain("Auto-detected soul.");
		});

		it("should prioritize explicit path over auto-detected file", async () => {
			await setFile("/explicit/SOUL.md", "Explicit soul.");
			await setFile("/project/SOUL.md", "Auto-detected soul.");

			const ctx = new IdentityContext({
				projectPath: "/project",
				paths: {
					soul: "/explicit/SOUL.md",
					identity: "/nonexistent/identity.md",
					personality: "/nonexistent/personality.md",
					user: "/nonexistent/user.md",
					agents: "/nonexistent/agents.md",
				},
			});
			const result = ctx.load();

			expect(result).toContain("Explicit soul.");
			expect(result).not.toContain("Auto-detected soul.");
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should skip empty files", async () => {
			await setFile("/project/SOUL.md", "   ");
			const ctx = new IdentityContext({ projectPath: "/project" });
			// readFileSafe checks content.trim().length > 0 — empty/whitespace should be skipped
			// But existsSync returns true... readFileSync returns "   "... trim().length is 0
			expect(ctx.load()).toBe("");
		});

		it("should handle files with only YAML frontmatter", async () => {
			const content = [
				"---",
				"title: Empty Soul",
				"---",
				"",
			].join("\n");

			await setFile("/project/SOUL.md", content);
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();
			// After stripping frontmatter, content is effectively empty
			// But the file is non-empty so it loads; the section just has an empty body
			expect(result).toContain("### Soul (Operating Contract)");
		});

		it("should handle personality.md file type", async () => {
			await setFile("/project/PERSONALITY.md", "Be bold and opinionated.");
			const ctx = new IdentityContext({ projectPath: "/project" });
			const result = ctx.load();

			expect(result).toContain("### Personality & Voice");
			expect(result).toContain("Be bold and opinionated.");
		});

		it("should handle no projectPath (only home dir)", async () => {
			await setFile("/home/testuser/SOUL.md", "Home soul.");
			const ctx = new IdentityContext();
			const result = ctx.load();
			expect(result).toContain("Home soul.");
		});
	});

	// ── typeLabel mapping ───────────────────────────────────────────────

	describe("type labels", () => {
		it("should use 'Soul (Operating Contract)' for soul type", async () => {
			await setFile("/project/SOUL.md", "Soul.");
			const ctx = new IdentityContext({ projectPath: "/project", include: ["soul"] });
			expect(ctx.load()).toContain("### Soul (Operating Contract)");
		});

		it("should use 'Identity' for identity type", async () => {
			await setFile("/project/IDENTITY.md", "Identity.");
			const ctx = new IdentityContext({ projectPath: "/project", include: ["identity"] });
			expect(ctx.load()).toContain("### Identity");
		});

		it("should use 'Personality & Voice' for personality type", async () => {
			await setFile("/project/PERSONALITY.md", "Personality.");
			const ctx = new IdentityContext({ projectPath: "/project", include: ["personality"] });
			expect(ctx.load()).toContain("### Personality & Voice");
		});

		it("should use 'User Profile' for user type", async () => {
			await setFile("/project/USER.md", "User.");
			const ctx = new IdentityContext({ projectPath: "/project", include: ["user"] });
			expect(ctx.load()).toContain("### User Profile");
		});

		it("should use 'Agent Behavior' for agents type", async () => {
			await setFile("/project/AGENTS.md", "Agents.");
			const ctx = new IdentityContext({ projectPath: "/project", include: ["agents"] });
			expect(ctx.load()).toContain("### Agent Behavior");
		});
	});
});
