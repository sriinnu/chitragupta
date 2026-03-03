import { describe, it, expect } from "vitest";
import {
	buildConditionalContext,
	filterContext,
} from "../src/conditional-context.js";
import type { ConditionalContextResult } from "../src/conditional-context.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

const SAMPLE_CONTEXT = [
	"# Project Instructions",
	"",
	"## Identity",
	"You are Chitragupta, an AI coding assistant.",
	"",
	"## Git Rules",
	"Always push to dev branch first.",
	"Never force-push to main.",
	"",
	"## Testing",
	"Run vitest before every commit.",
	"Always update tests when changing source.",
	"",
	"## Code Standards",
	"Max 450 LOC per file.",
	"TypeScript strict mode, no any.",
	"",
	"## Memory and Continuity",
	"Use Chitragupta MCP for session recall.",
	"Call chitragupta_recall for past decisions.",
	"",
	"## Communication",
	"Be sharp, casual, and lightly sarcastic.",
	"Never vague.",
].join("\n");

const SECOND_CONTEXT = [
	"## Security",
	"Never commit .env files.",
	"Always sanitize inputs.",
	"",
	"## Architecture",
	"Prefer wiring and correctness first.",
	"No silent failures.",
].join("\n");

// ── buildConditionalContext ─────────────────────────────────────────────────

describe("buildConditionalContext", () => {
	it("returns filtered context for git tasks", () => {
		const result = buildConditionalContext(
			"commit and push the changes",
			[SAMPLE_CONTEXT],
		);
		expect(result.taskType).toBe("git");
		expect(result.context).toContain("Chitragupta"); // Identity (priority 0)
		expect(result.context).toContain("push to dev branch");
		// Should NOT contain memory or communication sections
		expect(result.context).not.toContain("session recall");
		expect(result.context).not.toContain("sarcastic");
	});

	it("returns filtered context for test tasks", () => {
		const result = buildConditionalContext(
			"write unit tests for the parser",
			[SAMPLE_CONTEXT],
		);
		expect(result.taskType).toBe("test");
		expect(result.context).toContain("vitest");
		expect(result.context).toContain("450 LOC"); // code standards relevant for test
	});

	it("returns filtered context for memory tasks", () => {
		const result = buildConditionalContext(
			"recall what we decided about auth",
			[SAMPLE_CONTEXT],
		);
		expect(result.taskType).toBe("memory");
		expect(result.context).toContain("session recall");
	});

	it("handles multiple context files", () => {
		const result = buildConditionalContext(
			"review this code for security issues",
			[SAMPLE_CONTEXT, SECOND_CONTEXT],
		);
		expect(result.taskType).toBe("code-review");
		// Should include security from second file
		expect(result.context).toContain("sanitize inputs");
	});

	it("handles empty context files array", () => {
		const result = buildConditionalContext("fix the bug", []);
		expect(result.taskType).toBe("code-fix");
		expect(result.context).toBe("");
		expect(result.includedSections).toEqual([]);
	});

	it("handles empty prompt", () => {
		const result = buildConditionalContext("", [SAMPLE_CONTEXT]);
		expect(result.taskType).toBe("general");
	});

	it("respects overrideTaskType", () => {
		const result = buildConditionalContext(
			"this looks like a git task",
			[SAMPLE_CONTEXT],
			{ overrideTaskType: "test" },
		);
		expect(result.taskType).toBe("test");
		expect(result.classification).toBeNull();
		expect(result.context).toContain("vitest");
	});

	it("respects custom token budget", () => {
		const fullResult = buildConditionalContext(
			"implement the new feature",
			[SAMPLE_CONTEXT],
			{ tokenBudget: 10000 },
		);

		const tightResult = buildConditionalContext(
			"implement the new feature",
			[SAMPLE_CONTEXT],
			{ tokenBudget: 20 }, // Very tight budget
		);

		// Tight budget should produce less context
		expect(tightResult.context.length).toBeLessThanOrEqual(fullResult.context.length);
		expect(tightResult.tokenEstimate).toBeLessThanOrEqual(tightResult.tokenBudget);
	});

	it("provides classification metadata when not overridden", () => {
		const result = buildConditionalContext(
			"fix the TypeError in auth.ts",
			[SAMPLE_CONTEXT],
		);
		expect(result.classification).not.toBeNull();
		expect(result.classification?.type).toBe("code-fix");
		expect(result.classification?.confidence).toBeGreaterThan(0);
	});

	it("reports included and excluded sections", () => {
		const result = buildConditionalContext(
			"commit the changes",
			[SAMPLE_CONTEXT],
		);
		expect(result.includedSections.length).toBeGreaterThan(0);
		expect(result.excludedSections.length).toBeGreaterThan(0);
		// Excluded should contain sections not relevant to git
		expect(result.excludedSections.some(
			(id) => id === "memory-and-continuity" || id === "communication",
		)).toBe(true);
	});

	it("always includes preamble content", () => {
		const contextWithPreamble = "This is critical preamble.\n\n## Git Rules\nPush rules.\n\n## Testing\nTest rules.";
		const result = buildConditionalContext(
			"commit changes",
			[contextWithPreamble],
		);
		expect(result.context).toContain("critical preamble");
	});

	it("reports token budget in result", () => {
		const result = buildConditionalContext("fix bug", [SAMPLE_CONTEXT], { tokenBudget: 3000 });
		expect(result.tokenBudget).toBe(3000);
	});

	it("defaults to 4000 token budget", () => {
		const result = buildConditionalContext("fix bug", [SAMPLE_CONTEXT]);
		expect(result.tokenBudget).toBe(4000);
	});
});

// ── filterContext ───────────────────────────────────────────────────────────

describe("filterContext", () => {
	it("returns a string (simplified API)", () => {
		const result = filterContext("commit changes", [SAMPLE_CONTEXT]);
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("filters based on prompt classification", () => {
		const gitContext = filterContext("push to origin", [SAMPLE_CONTEXT]);
		const testContext = filterContext("write tests", [SAMPLE_CONTEXT]);

		// Git context should have git rules
		expect(gitContext).toContain("push to dev branch");

		// Test context should have testing section
		expect(testContext).toContain("vitest");
	});

	it("respects custom token budget", () => {
		const small = filterContext("fix bug", [SAMPLE_CONTEXT], 30);
		const large = filterContext("fix bug", [SAMPLE_CONTEXT], 10000);
		expect(small.length).toBeLessThanOrEqual(large.length);
	});

	it("handles empty inputs gracefully", () => {
		expect(filterContext("", [])).toBe("");
		expect(filterContext("hello", [])).toBe("");
	});
});

// ── Integration: end-to-end scenarios ───────────────────────────────────────

describe("end-to-end scenarios", () => {
	it("reduces context size compared to raw concatenation", () => {
		const rawTotal = SAMPLE_CONTEXT.length + SECOND_CONTEXT.length;
		const filtered = filterContext(
			"commit the code",
			[SAMPLE_CONTEXT, SECOND_CONTEXT],
		);
		// Filtered should be meaningfully smaller than raw total
		expect(filtered.length).toBeLessThan(rawTotal);
	});

	it("classifies and filters a real-world prompt", () => {
		const result = buildConditionalContext(
			"the build is failing with a TypeError in packages/anina/src/agent.ts line 42",
			[SAMPLE_CONTEXT, SECOND_CONTEXT],
		);
		expect(result.taskType).toBe("code-fix");
		// Should include testing (relevant for code-fix)
		expect(result.context).toContain("vitest");
		// Should NOT include memory or communication
		expect(result.context).not.toContain("session recall");
	});

	it("handles a complex multi-signal prompt", () => {
		const result = buildConditionalContext(
			"refactor the auth module, extract the validation logic into a separate function, and make sure tests still pass",
			[SAMPLE_CONTEXT],
		);
		// Could be refactor or test; refactor should win due to stronger signals
		expect(["code-refactor", "test"]).toContain(result.taskType);
	});
});
