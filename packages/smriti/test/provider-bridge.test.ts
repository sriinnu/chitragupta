/**
 * @chitragupta/smriti — Provider Bridge tests.
 *
 * Tests loadProviderContext() which assembles memory context for provider
 * sessions by loading global facts, project memory, and recent sessions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock setup ─────────────────────────────────────────────────────────────

const mockGetMemory = vi.fn().mockReturnValue("");
const mockListSessions = vi.fn().mockReturnValue([]);
const mockLoadSession = vi.fn().mockReturnValue({ turns: [] });

vi.mock("../src/memory-store.js", () => ({
	getMemory: (...args: unknown[]) => mockGetMemory(...args),
}));

vi.mock("../src/session-store.js", () => ({
	listSessions: (...args: unknown[]) => mockListSessions(...args),
	loadSession: (...args: unknown[]) => mockLoadSession(...args),
}));

import { loadProviderContext } from "../src/provider-bridge.js";
import type { ProviderContext } from "../src/provider-bridge.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal SessionMeta object. */
function makeSessionMeta(overrides: Record<string, unknown> = {}) {
	return {
		id: "session-2025-06-01-abcd1234",
		title: "Test Session",
		created: "2025-06-01T10:00:00.000Z",
		updated: "2025-06-01T11:00:00.000Z",
		agent: "chitragupta",
		model: "claude-opus-4",
		project: "/test/project",
		parent: null,
		branch: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
		...overrides,
	};
}

/** Build a minimal Session with turns. */
function makeSession(turns: Array<{ role: string; content: string }> = []) {
	return {
		meta: makeSessionMeta(),
		turns: turns.map((t, i) => ({
			turnNumber: i + 1,
			role: t.role,
			content: t.content,
		})),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("loadProviderContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetMemory.mockReturnValue("");
		mockListSessions.mockReturnValue([]);
		mockLoadSession.mockReturnValue({ turns: [] });
	});

	// ── 1. Empty state ──────────────────────────────────────────────────

	describe("empty state", () => {
		it("should return empty assembled string when no memory or sessions exist", async () => {
			const ctx = await loadProviderContext();

			expect(ctx.assembled).toBe("");
			expect(ctx.itemCount).toBe(0);
		});

		it("should return empty strings for all fields when nothing is available", async () => {
			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("");
			expect(ctx.projectMemory).toBe("");
			expect(ctx.recentContext).toBe("");
		});

		it("should return zero itemCount when no content exists", async () => {
			const ctx = await loadProviderContext();

			expect(ctx.itemCount).toBe(0);
		});
	});

	// ── 2. Global facts loading ─────────────────────────────────────────

	describe("global facts loading", () => {
		it("should load global facts from getMemory with global scope", async () => {
			mockGetMemory.mockReturnValue("Name: jaanu\nLives in: Vienna");

			await loadProviderContext();

			expect(mockGetMemory).toHaveBeenCalledWith({ type: "global" });
		});

		it("should populate globalFacts from global memory content", async () => {
			mockGetMemory.mockReturnValue("Name: jaanu\nLives in: Vienna");

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("Name: jaanu\nLives in: Vienna");
		});

		it("should include Known Facts header in assembled output", async () => {
			mockGetMemory.mockReturnValue("Name: jaanu\nLives in: Vienna");

			const ctx = await loadProviderContext();

			expect(ctx.assembled).toContain("## Known Facts");
			expect(ctx.assembled).toContain("Name: jaanu");
			expect(ctx.assembled).toContain("Lives in: Vienna");
		});

		it("should count non-empty lines from global facts in itemCount", async () => {
			mockGetMemory.mockReturnValue("Name: jaanu\nLives in: Vienna");

			const ctx = await loadProviderContext();

			expect(ctx.itemCount).toBe(2);
		});

		it("should trim whitespace from globalFacts in the returned field", async () => {
			mockGetMemory.mockReturnValue("  Name: jaanu  \n  Lives in: Vienna  \n");

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("Name: jaanu  \n  Lives in: Vienna");
		});
	});

	// ── 3. Project memory loading ───────────────────────────────────────

	describe("project memory loading", () => {
		it("should load project memory when project is provided", async () => {
			mockGetMemory.mockImplementation((scope: { type: string; path?: string }) => {
				if (scope.type === "project") return "Stack: TypeScript + React";
				return "";
			});

			const ctx = await loadProviderContext("/my/project");

			expect(mockGetMemory).toHaveBeenCalledWith({ type: "project", path: "/my/project" });
			expect(ctx.projectMemory).toBe("Stack: TypeScript + React");
		});

		it("should include Project Context header in assembled output", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return "Use pnpm not npm";
				return "";
			});

			const ctx = await loadProviderContext("/my/project");

			expect(ctx.assembled).toContain("## Project Context");
			expect(ctx.assembled).toContain("Use pnpm not npm");
		});

		it("should not include project memory when no project is provided", async () => {
			mockGetMemory.mockReturnValue("Some global content");

			const ctx = await loadProviderContext();

			expect(ctx.projectMemory).toBe("");
			expect(ctx.assembled).not.toContain("## Project Context");
		});

		it("should count project memory lines in itemCount", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return "Line 1\nLine 2\nLine 3";
				return "";
			});

			const ctx = await loadProviderContext("/my/project");

			expect(ctx.itemCount).toBe(3);
		});

		it("should load both global and project memory when project is provided", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Global fact";
				if (scope.type === "project") return "Project fact";
				return "";
			});

			const ctx = await loadProviderContext("/my/project");

			expect(ctx.globalFacts).toBe("Global fact");
			expect(ctx.projectMemory).toBe("Project fact");
			expect(ctx.assembled).toContain("## Known Facts");
			expect(ctx.assembled).toContain("## Project Context");
		});
	});

	// ── 4. Recent sessions loading ──────────────────────────────────────

	describe("recent sessions loading", () => {
		it("should load recent sessions from listSessions", async () => {
			const meta1 = makeSessionMeta({
				id: "session-2025-06-01-abcd1234",
				created: "2025-06-01T10:00:00.000Z",
			});
			const meta2 = makeSessionMeta({
				id: "session-2025-06-02-abcd1234",
				created: "2025-06-02T10:00:00.000Z",
			});
			const meta3 = makeSessionMeta({
				id: "session-2025-06-03-abcd1234",
				created: "2025-06-03T10:00:00.000Z",
			});

			mockListSessions.mockReturnValue([meta1, meta2, meta3]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello world" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).not.toBe("");
			expect(ctx.assembled).toContain("## Recent Sessions");
		});

		it("should call listSessions with project when project is provided", async () => {
			await loadProviderContext("/my/project");

			expect(mockListSessions).toHaveBeenCalledWith("/my/project");
		});

		it("should call listSessions without arguments when no project provided", async () => {
			await loadProviderContext();

			expect(mockListSessions).toHaveBeenCalledWith();
		});

		it("should format each session summary with date, provider, turn count, and topic", async () => {
			const meta = makeSessionMeta({
				id: "session-2025-06-15-abcd1234",
				created: "2025-06-15T14:30:00.000Z",
				agent: "claude-code",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([
					{ role: "user", content: "Fix the authentication bug in login" },
					{ role: "assistant", content: "I will look into it." },
				]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("2025-06-15");
			expect(ctx.recentContext).toContain("claude-code");
			expect(ctx.recentContext).toContain("2 turns");
			expect(ctx.recentContext).toContain("Fix the authentication bug in login");
		});

		it("should pass session meta.id and meta.project to loadSession", async () => {
			const meta = makeSessionMeta({
				id: "session-2025-06-15-abcd1234",
				project: "/test/project",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			await loadProviderContext("/test/project");

			expect(mockLoadSession).toHaveBeenCalledWith(
				"session-2025-06-15-abcd1234",
				"/test/project",
			);
		});
	});

	// ── 5. Recent session limit ─────────────────────────────────────────

	describe("recent session limit", () => {
		it("should default to 3 recent sessions", async () => {
			const metas = Array.from({ length: 5 }, (_, i) =>
				makeSessionMeta({
					id: `session-2025-06-0${i + 1}-abcd1234`,
					created: `2025-06-0${i + 1}T10:00:00.000Z`,
				}),
			);

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			// loadSession should be called 3 times (default limit)
			expect(mockLoadSession).toHaveBeenCalledTimes(3);
		});

		it("should respect custom recentSessionLimit of 1", async () => {
			const metas = Array.from({ length: 5 }, (_, i) =>
				makeSessionMeta({
					id: `session-2025-06-0${i + 1}-abcd1234`,
					created: `2025-06-0${i + 1}T10:00:00.000Z`,
				}),
			);

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project", {
				recentSessionLimit: 1,
			});

			expect(mockLoadSession).toHaveBeenCalledTimes(1);
		});

		it("should respect custom recentSessionLimit of 5", async () => {
			const metas = Array.from({ length: 10 }, (_, i) =>
				makeSessionMeta({
					id: `session-2025-06-${String(i + 1).padStart(2, "0")}-abcd1234`,
					created: `2025-06-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
				}),
			);

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			await loadProviderContext("/test/project", {
				recentSessionLimit: 5,
			});

			expect(mockLoadSession).toHaveBeenCalledTimes(5);
		});

		it("should handle fewer sessions than the limit", async () => {
			const metas = [makeSessionMeta()];

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project", {
				recentSessionLimit: 10,
			});

			expect(mockLoadSession).toHaveBeenCalledTimes(1);
		});
	});

	// ── 6. Context length truncation ────────────────────────────────────

	describe("context length truncation", () => {
		it("should truncate globalFacts when exceeding maxContextLength / 3", async () => {
			const longFacts = "A".repeat(2000);
			mockGetMemory.mockReturnValue(longFacts);

			const ctx = await loadProviderContext(undefined, {
				maxContextLength: 4000,
			});

			// maxLen / 3 = ~1333 chars
			expect(ctx.globalFacts.length).toBeLessThan(2000);
			expect(ctx.globalFacts).toContain("...(truncated)");
		});

		it("should truncate projectMemory when exceeding maxContextLength / 3", async () => {
			const longMemory = "B".repeat(2000);
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return longMemory;
				return "";
			});

			const ctx = await loadProviderContext("/test/project", {
				maxContextLength: 4000,
			});

			expect(ctx.projectMemory.length).toBeLessThan(2000);
			expect(ctx.projectMemory).toContain("...(truncated)");
		});

		it("should use default maxContextLength of 4000", async () => {
			const longFacts = "C".repeat(5000);
			mockGetMemory.mockReturnValue(longFacts);

			const ctx = await loadProviderContext();

			// With default 4000, maxLen/3 ~ 1333
			expect(ctx.globalFacts.length).toBeLessThanOrEqual(Math.floor(4000 / 3) + "...(truncated)".length + 1);
			expect(ctx.globalFacts).toContain("...(truncated)");
		});

		it("should not truncate when content is within limits", async () => {
			mockGetMemory.mockReturnValue("Short facts");

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("Short facts");
			expect(ctx.globalFacts).not.toContain("...(truncated)");
		});

		it("should truncate assembled output to maxContextLength total", async () => {
			// Create very long content in all sections
			const longContent = "X".repeat(3000);
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return longContent;
				if (scope.type === "project") return longContent;
				return "";
			});
			// Also add sessions with content
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "X".repeat(1000) }]),
			);

			const ctx = await loadProviderContext("/test/project", {
				maxContextLength: 500,
			});

			expect(ctx.assembled.length).toBeLessThanOrEqual(500);
		});

		it("should truncate with custom maxContextLength", async () => {
			mockGetMemory.mockReturnValue("A".repeat(1000));

			const ctx = await loadProviderContext(undefined, {
				maxContextLength: 600,
			});

			// maxLen/3 = 200
			expect(ctx.globalFacts.length).toBeLessThanOrEqual(200 + "\n...(truncated)".length);
			expect(ctx.globalFacts).toContain("...(truncated)");
		});

		it("should include truncation marker with newline prefix", async () => {
			const longFacts = "D".repeat(5000);
			mockGetMemory.mockReturnValue(longFacts);

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toMatch(/\n\.\.\.\(truncated\)$/);
		});
	});

	// ── 7. Error resilience ─────────────────────────────────────────────

	describe("error resilience", () => {
		it("should return empty globalFacts when getMemory throws for global scope", async () => {
			mockGetMemory.mockImplementation(() => {
				throw new Error("Memory store unavailable");
			});

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("");
			expect(ctx.assembled).toBe("");
		});

		it("should still return a valid context object when getMemory throws", async () => {
			mockGetMemory.mockImplementation(() => {
				throw new Error("Disk failure");
			});

			const ctx = await loadProviderContext();

			expect(ctx).toHaveProperty("globalFacts");
			expect(ctx).toHaveProperty("projectMemory");
			expect(ctx).toHaveProperty("recentContext");
			expect(ctx).toHaveProperty("assembled");
			expect(ctx).toHaveProperty("itemCount");
		});

		it("should return empty recentContext when listSessions throws", async () => {
			mockGetMemory.mockReturnValue("Some facts");
			mockListSessions.mockImplementation(() => {
				throw new Error("SQLite unavailable");
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toBe("");
			// But globalFacts should still work
			expect(ctx.globalFacts).toBe("Some facts");
		});

		it("should skip individual sessions when loadSession throws", async () => {
			const meta1 = makeSessionMeta({
				id: "session-good-1",
				created: "2025-06-01T10:00:00.000Z",
			});
			const meta2 = makeSessionMeta({
				id: "session-bad",
				created: "2025-06-02T10:00:00.000Z",
			});
			const meta3 = makeSessionMeta({
				id: "session-good-2",
				created: "2025-06-03T10:00:00.000Z",
			});

			mockListSessions.mockReturnValue([meta1, meta2, meta3]);
			mockLoadSession.mockImplementation((id: string) => {
				if (id === "session-bad") throw new Error("Corrupt session file");
				return makeSession([{ role: "user", content: `Topic for ${id}` }]);
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("session-good-1");
			expect(ctx.recentContext).not.toContain("session-bad");
			expect(ctx.recentContext).toContain("session-good-2");
		});

		it("should return empty projectMemory when getMemory throws for project scope", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Global ok";
				if (scope.type === "project") throw new Error("Project store error");
				return "";
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.globalFacts).toBe("Global ok");
			expect(ctx.projectMemory).toBe("");
		});

		it("should handle all systems failing gracefully", async () => {
			mockGetMemory.mockImplementation(() => {
				throw new Error("Memory down");
			});
			mockListSessions.mockImplementation(() => {
				throw new Error("Sessions down");
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.globalFacts).toBe("");
			expect(ctx.projectMemory).toBe("");
			expect(ctx.recentContext).toBe("");
			expect(ctx.assembled).toBe("");
			expect(ctx.itemCount).toBe(0);
		});
	});

	// ── 8. Provider detection in session summaries ──────────────────────

	describe("provider detection in session summaries", () => {
		it("should use metadata.provider when available", async () => {
			const meta = makeSessionMeta({
				agent: "chitragupta",
				metadata: { provider: "claude-code" },
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("claude-code");
		});

		it("should fall back to agent field when metadata.provider is absent", async () => {
			const meta = makeSessionMeta({
				agent: "vaayu-agent",
				metadata: undefined,
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("vaayu-agent");
		});

		it("should fall back to agent when metadata exists but has no provider", async () => {
			const meta = makeSessionMeta({
				agent: "codex",
				metadata: { someKey: "someValue" },
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("codex");
		});
	});

	// ── 9. First user message as topic ──────────────────────────────────

	describe("first user message as topic", () => {
		it("should extract topic from first user turn content", async () => {
			const meta = makeSessionMeta();

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([
					{ role: "user", content: "Refactor the authentication module" },
					{ role: "assistant", content: "Sure, I will start." },
				]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("Refactor the authentication module");
		});

		it("should truncate first user message to 100 chars", async () => {
			const longMessage = "X".repeat(200);
			const meta = makeSessionMeta();

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: longMessage }]),
			);

			const ctx = await loadProviderContext("/test/project");

			// The topic in recentContext should be the first 100 chars of the message
			const lines = ctx.recentContext.split("\n");
			const topicPart = lines[0].split("): ")[1] ?? "";
			expect(topicPart.length).toBeLessThanOrEqual(100);
		});

		it("should fall back to meta.title when no user turns exist", async () => {
			const meta = makeSessionMeta({
				title: "Debug session for login flow",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "assistant", content: "I am ready to help." }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("Debug session for login flow");
		});

		it("should use meta.title when session has no turns at all", async () => {
			const meta = makeSessionMeta({
				title: "Empty session",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(makeSession([]));

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("Empty session");
		});

		it("should find the first user turn even if assistant goes first", async () => {
			const meta = makeSessionMeta();

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([
					{ role: "assistant", content: "Welcome!" },
					{ role: "user", content: "Fix the CI pipeline" },
					{ role: "assistant", content: "On it." },
				]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("Fix the CI pipeline");
		});
	});

	// ── 10. Item count ──────────────────────────────────────────────────

	describe("item count", () => {
		it("should count non-empty lines across all sections", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Fact 1\nFact 2";
				if (scope.type === "project") return "Decision 1\nDecision 2\nDecision 3";
				return "";
			});

			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			// 2 (global) + 3 (project) + 1 (session summary line) = 6
			expect(ctx.itemCount).toBe(6);
		});

		it("should not count empty lines", async () => {
			mockGetMemory.mockReturnValue("Line 1\n\n\nLine 2\n\n");

			const ctx = await loadProviderContext();

			expect(ctx.itemCount).toBe(2);
		});

		it("should not count whitespace-only lines", async () => {
			mockGetMemory.mockReturnValue("Line 1\n   \n\t\nLine 2");

			const ctx = await loadProviderContext();

			expect(ctx.itemCount).toBe(2);
		});

		it("should be zero when all sections are empty", async () => {
			const ctx = await loadProviderContext();

			expect(ctx.itemCount).toBe(0);
		});

		it("should count session summary lines in recentContext", async () => {
			const metas = [
				makeSessionMeta({ id: "s1", created: "2025-06-01T10:00:00.000Z" }),
				makeSessionMeta({ id: "s2", created: "2025-06-02T10:00:00.000Z" }),
			];

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			// Each session produces one summary line
			expect(ctx.recentContext.split("\n").filter((l: string) => l.trim()).length).toBe(2);
		});
	});

	// ── 11. Assembly format ─────────────────────────────────────────────

	describe("assembly format", () => {
		it("should separate sections with double newline", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Global fact";
				if (scope.type === "project") return "Project decision";
				return "";
			});

			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			// Should have all three sections separated by \n\n
			expect(ctx.assembled).toContain("## Known Facts\nGlobal fact\n\n## Project Context");
			expect(ctx.assembled).toContain("## Project Context\nProject decision\n\n## Recent Sessions");
		});

		it("should only include non-empty sections", async () => {
			// Only global facts, no project, no sessions
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Only global";
				return "";
			});

			const ctx = await loadProviderContext();

			expect(ctx.assembled).toBe("## Known Facts\nOnly global");
			expect(ctx.assembled).not.toContain("## Project Context");
			expect(ctx.assembled).not.toContain("## Recent Sessions");
		});

		it("should use correct header: ## Known Facts", async () => {
			mockGetMemory.mockReturnValue("Fact content");

			const ctx = await loadProviderContext();

			expect(ctx.assembled).toMatch(/^## Known Facts\n/);
		});

		it("should use correct header: ## Project Context", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return "Project content";
				return "";
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.assembled).toContain("## Project Context\nProject content");
		});

		it("should use correct header: ## Recent Sessions", async () => {
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.assembled).toContain("## Recent Sessions\n-");
		});

		it("should not have trailing double newline when only one section", async () => {
			mockGetMemory.mockReturnValue("Single section");

			const ctx = await loadProviderContext();

			expect(ctx.assembled).not.toMatch(/\n\n$/);
		});

		it("should trim section content in assembled output", async () => {
			mockGetMemory.mockReturnValue("  Content with whitespace  \n  ");

			const ctx = await loadProviderContext();

			// parts.push uses globalFacts.trim()
			expect(ctx.assembled).toBe("## Known Facts\nContent with whitespace");
		});
	});

	// ── 12. Return type shape ───────────────────────────────────────────

	describe("return type shape", () => {
		it("should return a ProviderContext with all required fields", async () => {
			const ctx = await loadProviderContext();

			expect(typeof ctx.globalFacts).toBe("string");
			expect(typeof ctx.projectMemory).toBe("string");
			expect(typeof ctx.recentContext).toBe("string");
			expect(typeof ctx.assembled).toBe("string");
			expect(typeof ctx.itemCount).toBe("number");
		});

		it("should return a promise", () => {
			const result = loadProviderContext();

			expect(result).toBeInstanceOf(Promise);
		});
	});

	// ── 13. Multiple sessions formatting ────────────────────────────────

	describe("multiple sessions formatting", () => {
		it("should format multiple session summaries as bullet points", async () => {
			const metas = [
				makeSessionMeta({
					id: "s1",
					created: "2025-06-01T10:00:00.000Z",
					agent: "claude",
				}),
				makeSessionMeta({
					id: "s2",
					created: "2025-06-02T10:00:00.000Z",
					agent: "codex",
				}),
			];

			let callCount = 0;
			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockImplementation((id: string) => {
				callCount++;
				return makeSession([
					{ role: "user", content: `Topic ${callCount}` },
				]);
			});

			const ctx = await loadProviderContext("/test/project");

			const lines = ctx.recentContext.split("\n");
			expect(lines.length).toBe(2);
			expect(lines[0]).toMatch(/^- /);
			expect(lines[1]).toMatch(/^- /);
		});

		it("should join session summaries with newlines", async () => {
			const metas = [
				makeSessionMeta({ id: "s1", created: "2025-06-01T10:00:00.000Z" }),
				makeSessionMeta({ id: "s2", created: "2025-06-02T10:00:00.000Z" }),
			];

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("\n");
			expect(ctx.recentContext.split("\n").length).toBe(2);
		});
	});

	// ── 14. Date extraction from session ────────────────────────────────

	describe("date extraction from session summaries", () => {
		it("should extract YYYY-MM-DD date from session created field", async () => {
			const meta = makeSessionMeta({
				created: "2025-12-25T18:30:00.000Z",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Christmas coding" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("2025-12-25");
		});

		it("should use first 10 chars of created for date extraction", async () => {
			const meta = makeSessionMeta({
				created: "2024-01-15T08:00:00.000Z",
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "New year session" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("2024-01-15");
			expect(ctx.recentContext).not.toContain("T08:00");
		});
	});

	// ── 15. Whitespace handling ─────────────────────────────────────────

	describe("whitespace handling", () => {
		it("should skip sections that are only whitespace", async () => {
			mockGetMemory.mockReturnValue("   \n  \n   ");

			const ctx = await loadProviderContext();

			expect(ctx.assembled).toBe("");
			expect(ctx.itemCount).toBe(0);
		});

		it("should trim globalFacts in returned field", async () => {
			mockGetMemory.mockReturnValue("\n\n  Facts here  \n\n");

			const ctx = await loadProviderContext();

			expect(ctx.globalFacts).toBe("Facts here");
		});

		it("should trim projectMemory in returned field", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return "\n  Project info  \n";
				return "";
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.projectMemory).toBe("Project info");
		});

		it("should trim recentContext in returned field", async () => {
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).not.toMatch(/^\s/);
			expect(ctx.recentContext).not.toMatch(/\s$/);
		});
	});

	// ── 16. No recent sessions ──────────────────────────────────────────

	describe("no recent sessions", () => {
		it("should not include Recent Sessions header when list is empty", async () => {
			mockGetMemory.mockReturnValue("Some facts");
			mockListSessions.mockReturnValue([]);

			const ctx = await loadProviderContext();

			expect(ctx.assembled).not.toContain("## Recent Sessions");
		});

		it("should not include Recent Sessions header when all loadSession calls fail", async () => {
			const metas = [
				makeSessionMeta({ id: "s1" }),
				makeSessionMeta({ id: "s2" }),
			];

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockImplementation(() => {
				throw new Error("All sessions corrupt");
			});

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toBe("");
			expect(ctx.assembled).not.toContain("## Recent Sessions");
		});
	});

	// ── 17. Turn count in session summary ───────────────────────────────

	describe("turn count in session summary", () => {
		it("should show correct turn count from loaded session", async () => {
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([
					{ role: "user", content: "Q1" },
					{ role: "assistant", content: "A1" },
					{ role: "user", content: "Q2" },
					{ role: "assistant", content: "A2" },
					{ role: "user", content: "Q3" },
				]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("5 turns");
		});

		it("should show 0 turns for empty session", async () => {
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(makeSession([]));

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("0 turns");
		});

		it("should show 1 turn for single-turn session", async () => {
			const meta = makeSessionMeta();
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toContain("1 turns");
		});
	});

	// ── 18. Session summary line format ─────────────────────────────────

	describe("session summary line format", () => {
		it("should format as: - DATE (PROVIDER, N turns): TOPIC", async () => {
			const meta = makeSessionMeta({
				created: "2025-07-04T09:00:00.000Z",
				agent: "test-agent",
				metadata: { provider: "claude-code" },
			});

			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([
					{ role: "user", content: "Implement feature X" },
					{ role: "assistant", content: "Done" },
				]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.recentContext).toBe(
				"- 2025-07-04 (claude-code, 2 turns): Implement feature X",
			);
		});
	});

	// ── 19. Options defaults ────────────────────────────────────────────

	describe("options defaults", () => {
		it("should use default recentSessionLimit of 3 when options is undefined", async () => {
			const metas = Array.from({ length: 5 }, (_, i) =>
				makeSessionMeta({
					id: `s${i}`,
					created: `2025-06-0${i + 1}T10:00:00.000Z`,
				}),
			);
			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			await loadProviderContext("/test/project");

			expect(mockLoadSession).toHaveBeenCalledTimes(3);
		});

		it("should use default maxContextLength of 4000 when options is undefined", async () => {
			// Content that would be truncated at 4000/3 ~ 1333
			const longContent = "Z".repeat(2000);
			mockGetMemory.mockReturnValue(longContent);

			const ctx = await loadProviderContext();

			const expectedSliceLen = Math.floor(4000 / 3);
			expect(ctx.globalFacts).toContain("...(truncated)");
			expect(ctx.globalFacts.startsWith("Z".repeat(expectedSliceLen))).toBe(true);
		});

		it("should handle options object with no properties set", async () => {
			const metas = Array.from({ length: 5 }, (_, i) =>
				makeSessionMeta({
					id: `s${i}`,
					created: `2025-06-0${i + 1}T10:00:00.000Z`,
				}),
			);
			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Hello" }]),
			);

			await loadProviderContext("/test/project", {});

			// Should still use defaults
			expect(mockLoadSession).toHaveBeenCalledTimes(3);
		});
	});

	// ── 20. Integration-style combined scenarios ────────────────────────

	describe("combined scenarios", () => {
		it("should assemble all three sections correctly with real-ish data", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "Name: jaanu\nLives in: Vienna\nPrefers: dark mode";
				if (scope.type === "project") return "Stack: TypeScript + Node\nDB: SQLite";
				return "";
			});

			const metas = [
				makeSessionMeta({
					id: "s1",
					created: "2025-06-15T10:00:00.000Z",
					agent: "chitragupta",
					metadata: { provider: "claude-code" },
				}),
				makeSessionMeta({
					id: "s2",
					created: "2025-06-14T09:00:00.000Z",
					agent: "vaayu",
					metadata: undefined,
				}),
			];

			mockListSessions.mockReturnValue(metas);
			mockLoadSession.mockImplementation((id: string) => {
				if (id === "s1") {
					return makeSession([
						{ role: "user", content: "Add GraphRAG search" },
						{ role: "assistant", content: "Done." },
					]);
				}
				return makeSession([
					{ role: "user", content: "Fix the build" },
				]);
			});

			const ctx = await loadProviderContext("/test/project");

			// Global facts
			expect(ctx.globalFacts).toContain("Name: jaanu");
			expect(ctx.globalFacts).toContain("Lives in: Vienna");

			// Project memory
			expect(ctx.projectMemory).toContain("Stack: TypeScript + Node");
			expect(ctx.projectMemory).toContain("DB: SQLite");

			// Session summaries
			expect(ctx.recentContext).toContain("2025-06-15");
			expect(ctx.recentContext).toContain("claude-code");
			expect(ctx.recentContext).toContain("Add GraphRAG search");
			expect(ctx.recentContext).toContain("2025-06-14");
			expect(ctx.recentContext).toContain("vaayu");
			expect(ctx.recentContext).toContain("Fix the build");

			// Assembled
			expect(ctx.assembled).toContain("## Known Facts");
			expect(ctx.assembled).toContain("## Project Context");
			expect(ctx.assembled).toContain("## Recent Sessions");

			// Item count: 3 (global) + 2 (project) + 2 (session lines) = 7
			expect(ctx.itemCount).toBe(7);
		});

		it("should handle project with memory but no sessions", async () => {
			mockGetMemory.mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "User: testuser";
				if (scope.type === "project") return "Fresh project, no history yet";
				return "";
			});
			mockListSessions.mockReturnValue([]);

			const ctx = await loadProviderContext("/new/project");

			expect(ctx.globalFacts).toBe("User: testuser");
			expect(ctx.projectMemory).toBe("Fresh project, no history yet");
			expect(ctx.recentContext).toBe("");
			expect(ctx.assembled).toContain("## Known Facts");
			expect(ctx.assembled).toContain("## Project Context");
			expect(ctx.assembled).not.toContain("## Recent Sessions");
			expect(ctx.itemCount).toBe(2);
		});

		it("should handle sessions without any memory content", async () => {
			mockGetMemory.mockReturnValue("");

			const meta = makeSessionMeta({
				created: "2025-06-20T12:00:00.000Z",
				agent: "cli-agent",
			});
			mockListSessions.mockReturnValue([meta]);
			mockLoadSession.mockReturnValue(
				makeSession([{ role: "user", content: "Quick question" }]),
			);

			const ctx = await loadProviderContext("/test/project");

			expect(ctx.globalFacts).toBe("");
			expect(ctx.projectMemory).toBe("");
			expect(ctx.recentContext).not.toBe("");
			expect(ctx.assembled).not.toContain("## Known Facts");
			expect(ctx.assembled).not.toContain("## Project Context");
			expect(ctx.assembled).toContain("## Recent Sessions");
			expect(ctx.itemCount).toBe(1);
		});
	});
});
