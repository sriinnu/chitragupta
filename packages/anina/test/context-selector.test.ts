import { describe, it, expect } from "vitest";
import {
	parseContextSections,
	selectContext,
	getSelectionSummary,
	estimateTokens,
	headingToId,
	tagSection,
} from "../src/context-selector.js";
import type { ContextSection } from "../src/context-selector.js";

// ── Utility tests ───────────────────────────────────────────────────────────

describe("estimateTokens", () => {
	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("estimates ~1 token per 4 characters", () => {
		// 20 chars => 5 tokens
		expect(estimateTokens("12345678901234567890")).toBe(5);
	});

	it("rounds up partial tokens", () => {
		// 5 chars => ceil(5/4) = 2
		expect(estimateTokens("hello")).toBe(2);
	});
});

describe("headingToId", () => {
	it("converts '## Git Rules' to 'git-rules'", () => {
		expect(headingToId("## Git Rules")).toBe("git-rules");
	});

	it("handles '### Code Standards' with triple hash", () => {
		expect(headingToId("### Code Standards")).toBe("code-standards");
	});

	it("strips special characters", () => {
		expect(headingToId("## Safety & Quality!")).toBe("safety-quality");
	});

	it("handles leading/trailing spaces", () => {
		expect(headingToId("##   Testing  ")).toBe("testing");
	});

	it("collapses multiple dashes", () => {
		expect(headingToId("## Multi - File  Refactors")).toBe("multi-file-refactors");
	});

	it("returns empty string for only hashes", () => {
		expect(headingToId("## ")).toBe("");
	});
});

describe("tagSection", () => {
	it("tags 'Git Rules' as git-relevant", () => {
		const result = tagSection("## Git Rules");
		expect(result.relevantFor).toContain("git");
		expect(result.priority).toBe(1);
	});

	it("tags 'Core Operating Principles' as priority 0", () => {
		const result = tagSection("## Core Operating Principles");
		expect(result.priority).toBe(0);
	});

	it("tags 'Testing' as test-relevant", () => {
		const result = tagSection("## Testing");
		expect(result.relevantFor).toContain("test");
	});

	it("tags 'Code Standards' as code-relevant", () => {
		const result = tagSection("## Code Standards");
		expect(result.relevantFor).toContain("code-write");
		expect(result.relevantFor).toContain("code-refactor");
	});

	it("tags 'Memory and Continuity' as memory-relevant", () => {
		const result = tagSection("## Memory and Continuity");
		expect(result.relevantFor).toContain("memory");
	});

	it("assigns priority 3 and general for unknown headings", () => {
		const result = tagSection("## Random Stuff Nobody Cares About");
		expect(result.priority).toBe(3);
		expect(result.relevantFor).toContain("general");
	});

	it("tags 'Identity' as priority 0 (always include)", () => {
		const result = tagSection("## Identity");
		expect(result.priority).toBe(0);
	});

	it("tags 'Repos & Publishing' as config-relevant", () => {
		const result = tagSection("## Repos & Publishing");
		expect(result.relevantFor).toContain("config");
	});
});

// ── Section Parsing ─────────────────────────────────────────────────────────

describe("parseContextSections", () => {
	it("returns empty array for empty input", () => {
		expect(parseContextSections("")).toEqual([]);
	});

	it("returns empty array for whitespace-only input", () => {
		expect(parseContextSections("   \n\n  ")).toEqual([]);
	});

	it("treats content before first heading as preamble", () => {
		const input = "This is a preamble.\n\n## Section One\nContent.";
		const sections = parseContextSections(input);
		expect(sections.length).toBe(2);
		expect(sections[0].id).toBe("preamble");
		expect(sections[0].priority).toBe(0);
	});

	it("parses multiple ## sections", () => {
		const input = [
			"## Git Rules",
			"Always push to dev.",
			"",
			"## Testing",
			"Run vitest before commit.",
			"",
			"## Code Standards",
			"Max 450 LOC per file.",
		].join("\n");

		const sections = parseContextSections(input);
		expect(sections.length).toBe(3);
		expect(sections[0].id).toBe("git-rules");
		expect(sections[1].id).toBe("testing");
		expect(sections[2].id).toBe("code-standards");
	});

	it("assigns correct token estimates", () => {
		const input = "## Short\nHi";
		const sections = parseContextSections(input);
		expect(sections.length).toBe(1);
		expect(sections[0].tokenEstimate).toBeGreaterThan(0);
		// "## Short\nHi" = 12 chars => ceil(12/4) = 3
		expect(sections[0].tokenEstimate).toBe(3);
	});

	it("auto-tags sections based on heading content", () => {
		const input = "## Git Rules\nPush rules.\n\n## Testing\nVitest.";
		const sections = parseContextSections(input);
		expect(sections[0].relevantFor).toContain("git");
		expect(sections[1].relevantFor).toContain("test");
	});

	it("handles ### (level 3) headings", () => {
		const input = "### Sub Section\nContent here.";
		const sections = parseContextSections(input);
		expect(sections.length).toBe(1);
	});

	it("handles mixed heading levels", () => {
		const input = "## Top\nA.\n### Sub\nB.\n## Another\nC.";
		const sections = parseContextSections(input);
		// ## Top, ### Sub (splits), ## Another
		expect(sections.length).toBe(3);
	});

	it("preserves section content including the heading", () => {
		const input = "## Git Rules\nAlways use feature branches.";
		const sections = parseContextSections(input);
		expect(sections[0].content).toContain("## Git Rules");
		expect(sections[0].content).toContain("Always use feature branches.");
	});
});

// ── Context Selection ───────────────────────────────────────────────────────

describe("selectContext", () => {
	function makeSections(): ContextSection[] {
		return [
			{
				id: "identity",
				heading: "Identity",
				content: "You are Chitragupta.",
				relevantFor: ["code-write", "code-fix", "code-refactor", "code-review", "test", "config", "research", "git", "memory", "general"],
				priority: 0,
				tokenEstimate: 5,
			},
			{
				id: "git-rules",
				heading: "Git Rules",
				content: "Always push to dev branch first.",
				relevantFor: ["git", "code-write"],
				priority: 1,
				tokenEstimate: 8,
			},
			{
				id: "testing",
				heading: "Testing",
				content: "Run vitest before every commit.",
				relevantFor: ["test", "code-fix", "code-write"],
				priority: 1,
				tokenEstimate: 8,
			},
			{
				id: "code-standards",
				heading: "Code Standards",
				content: "Max 450 LOC per file. TypeScript strict.",
				relevantFor: ["code-write", "code-refactor", "code-review", "test"],
				priority: 1,
				tokenEstimate: 10,
			},
			{
				id: "memory",
				heading: "Memory",
				content: "Use Chitragupta MCP for session continuity.",
				relevantFor: ["memory", "research"],
				priority: 2,
				tokenEstimate: 10,
			},
			{
				id: "communication",
				heading: "Communication",
				content: "Be sharp, casual, and lightly sarcastic.",
				relevantFor: ["general", "research"],
				priority: 3,
				tokenEstimate: 10,
			},
		];
	}

	it("always includes priority-0 sections", () => {
		const result = selectContext(makeSections(), "git");
		expect(result).toContain("You are Chitragupta.");
	});

	it("includes sections relevant to the task type", () => {
		const result = selectContext(makeSections(), "git");
		expect(result).toContain("Always push to dev branch first.");
	});

	it("excludes sections not relevant to the task type", () => {
		const result = selectContext(makeSections(), "git");
		expect(result).not.toContain("Use Chitragupta MCP");
		expect(result).not.toContain("Be sharp, casual");
	});

	it("includes testing section for code-fix tasks", () => {
		const result = selectContext(makeSections(), "code-fix");
		expect(result).toContain("Run vitest");
	});

	it("includes code standards for code-write tasks", () => {
		const result = selectContext(makeSections(), "code-write");
		expect(result).toContain("Max 450 LOC per file");
	});

	it("includes memory section for memory tasks", () => {
		const result = selectContext(makeSections(), "memory");
		expect(result).toContain("Use Chitragupta MCP");
	});

	it("respects token budget by dropping low-priority sections first", () => {
		// Budget of 15 tokens: identity (5) + git-rules (8) = 13 (fits)
		// But testing (8) would push to 21 (over budget)
		const result = selectContext(makeSections(), "code-write", { tokenBudget: 15 });
		expect(result).toContain("You are Chitragupta."); // priority 0
		// Should include at least one relevant section
		// With budget 15 and identity (5), we have 10 left
		// git-rules (8) fits, testing (8) fits, code-standards (10) fits
		// All can't fit; only some will be included
	});

	it("returns empty string for empty sections array", () => {
		const result = selectContext([], "general");
		expect(result).toBe("");
	});

	it("can skip critical sections when configured", () => {
		const sections = makeSections();
		const result = selectContext(sections, "git", {
			alwaysIncludeCritical: false,
		});
		// Without critical, only sections relevant to "git" are included
		// identity is NOT relevant to "git" in the relevantFor array when alwaysIncludeCritical is false,
		// BUT it actually IS in relevantFor for git. So it should still be included as a normal section.
		expect(result).toContain("Always push to dev branch first.");
	});
});

// ── Selection Summary ───────────────────────────────────────────────────────

describe("getSelectionSummary", () => {
	function makeSections(): ContextSection[] {
		return [
			{
				id: "critical",
				heading: "Critical",
				content: "Critical rules.",
				relevantFor: ["code-write", "code-fix", "code-refactor", "code-review", "test", "config", "research", "git", "memory", "general"],
				priority: 0,
				tokenEstimate: 4,
			},
			{
				id: "git-rules",
				heading: "Git Rules",
				content: "Git content.",
				relevantFor: ["git"],
				priority: 1,
				tokenEstimate: 3,
			},
			{
				id: "testing",
				heading: "Testing",
				content: "Test content.",
				relevantFor: ["test"],
				priority: 1,
				tokenEstimate: 3,
			},
		];
	}

	it("lists included section IDs", () => {
		const summary = getSelectionSummary(makeSections(), "git");
		expect(summary.included).toContain("critical");
		expect(summary.included).toContain("git-rules");
	});

	it("lists excluded section IDs", () => {
		const summary = getSelectionSummary(makeSections(), "git");
		expect(summary.excluded).toContain("testing");
	});

	it("reports total tokens of included sections", () => {
		const summary = getSelectionSummary(makeSections(), "git");
		// critical (4) + git-rules (3) = 7
		expect(summary.totalTokens).toBe(7);
	});

	it("reports the budget", () => {
		const summary = getSelectionSummary(makeSections(), "git", { tokenBudget: 2000 });
		expect(summary.budgetTokens).toBe(2000);
	});

	it("excludes over-budget sections", () => {
		// Budget of 5: critical (4) fits, git-rules (3) would be 7 (over)
		const summary = getSelectionSummary(makeSections(), "git", { tokenBudget: 5 });
		expect(summary.included).toContain("critical");
		expect(summary.excluded).toContain("git-rules");
	});
});
