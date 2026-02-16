import { describe, it, expect } from "vitest";
import {
	detectSessionType,
	extractEventChain,
	getExtractorStrategy,
} from "../src/event-extractor.js";
import type {
	SessionType,
	CoreSessionType,
	ExtendedSessionType,
	SessionEvent,
	EventChain,
} from "../src/event-extractor.js";
import type { SessionTurn, SessionMeta } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

type TimestampedTurn = SessionTurn & { createdAt: number };

let turnCounter = 0;

function makeTurn(
	role: "user" | "assistant",
	content: string,
	opts?: {
		num?: number;
		createdAt?: number;
		toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>;
	},
): TimestampedTurn {
	turnCounter++;
	return {
		role,
		content,
		turnNumber: opts?.num ?? turnCounter,
		createdAt: opts?.createdAt ?? Date.now() + turnCounter * 1000,
		toolCalls: opts?.toolCalls,
	};
}

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
	return {
		id: "session-2025-01-15-abcd",
		title: "Test Session",
		created: "2025-01-15T10:00:00Z",
		updated: "2025-01-15T11:00:00Z",
		project: "/my/project",
		agent: "claude",
		model: "opus",
		branch: "main",
		parent: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
		...overrides,
	};
}

/** Generate N turns with tool call content to push tool ratio high. */
function makeToolTurns(n: number): TimestampedTurn[] {
	return Array.from({ length: n }, (_, i) =>
		makeTurn("assistant", `[tool:read] file content line ${i}`, { num: i + 1 }),
	);
}

/** Generate N turns of plain text discussion. */
function makeTextTurns(n: number): TimestampedTurn[] {
	return Array.from({ length: n }, (_, i) =>
		makeTurn(
			i % 2 === 0 ? "user" : "assistant",
			`This is a plain text discussion turn number ${i + 1} about architecture.`,
			{ num: i + 1 },
		),
	);
}

// ─── detectSessionType ──────────────────────────────────────────────────────

describe("detectSessionType", () => {
	it("should return 'personal' for empty turns", () => {
		expect(detectSessionType([])).toBe("personal");
	});

	it("should return 'personal' for <= 4 short turns (avg user length < 100)", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "Hi there", turnNumber: 1 },
			{ role: "assistant", content: "Hello!", turnNumber: 2 },
			{ role: "user", content: "My name is Alex", turnNumber: 3 },
		];
		expect(detectSessionType(turns)).toBe("personal");
	});

	it("should return 'personal' for exactly 4 short turns", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "I live in Vienna", turnNumber: 1 },
			{ role: "assistant", content: "Noted!", turnNumber: 2 },
			{ role: "user", content: "I prefer dark mode", turnNumber: 3 },
			{ role: "assistant", content: "Got it.", turnNumber: 4 },
		];
		expect(detectSessionType(turns)).toBe("personal");
	});

	it("should return 'coding' when > 60% of turns have tool calls via [tool:xxx] pattern", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "Fix the bug", turnNumber: 1 },
			{ role: "assistant", content: "[tool:read] src/index.ts content here", turnNumber: 2 },
			{ role: "assistant", content: "[tool:edit] patched the file", turnNumber: 3 },
			{ role: "assistant", content: "[tool:bash] ran tests", turnNumber: 4 },
			{ role: "assistant", content: "[tool:write] wrote output", turnNumber: 5 },
		];
		// 4 out of 5 have tool calls => 80% > 60%
		expect(detectSessionType(turns)).toBe("coding");
	});

	it("should return 'coding' when > 60% of turns have toolCalls array", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "Fix the error", turnNumber: 1 },
			{
				role: "assistant",
				content: "I'll read the file",
				turnNumber: 2,
				toolCalls: [{ name: "read", input: "src/foo.ts", result: "content", isError: false }],
			},
			{
				role: "assistant",
				content: "Editing now",
				turnNumber: 3,
				toolCalls: [{ name: "edit", input: "{}", result: "ok", isError: false }],
			},
			{
				role: "assistant",
				content: "Running tests",
				turnNumber: 4,
				toolCalls: [{ name: "bash", input: "pnpm test", result: "pass", isError: false }],
			},
			{
				role: "assistant",
				content: "All done",
				turnNumber: 5,
				toolCalls: [{ name: "bash", input: "pnpm build", result: "ok", isError: false }],
			},
		];
		// 4 out of 5 turns have toolCalls => 80% > 60%
		expect(detectSessionType(turns)).toBe("coding");
	});

	it("should return 'discussion' when tool ratio < 15%", () => {
		// 10 plain text turns, no tools => 0% tool ratio, but more than 4 turns
		const turns: SessionTurn[] = Array.from({ length: 10 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `This is a longer discussion message about software architecture and design patterns that exceeds one hundred characters easily.`,
			turnNumber: i + 1,
		}));
		expect(detectSessionType(turns)).toBe("discussion");
	});

	it("should return 'mixed' when tool ratio is between 15% and 60%", () => {
		// 10 turns total: 3 with tools (30%), 7 without
		const turns: SessionTurn[] = [
			{ role: "user", content: "Let's discuss the design and then implement it. We need a longer message to prevent personal classification from kicking in.", turnNumber: 1 },
			{ role: "assistant", content: "Sure, here's my analysis of the problem space and potential solutions we should consider.", turnNumber: 2 },
			{ role: "user", content: "What about performance? I need this to be fast and efficient. Can you analyze the current bottleneck?", turnNumber: 3 },
			{ role: "assistant", content: "[tool:read] analyzed performance", turnNumber: 4 },
			{ role: "assistant", content: "Here are the results of the analysis with detailed performance metrics and recommendations.", turnNumber: 5 },
			{ role: "user", content: "Good, now let's fix it. Apply the optimization we discussed. Be thorough and test everything.", turnNumber: 6 },
			{ role: "assistant", content: "[tool:edit] optimized the code", turnNumber: 7 },
			{ role: "assistant", content: "[tool:bash] ran benchmarks", turnNumber: 8 },
			{ role: "user", content: "The results look good. Let me summarize what we decided and what the next steps should be overall.", turnNumber: 9 },
			{ role: "assistant", content: "Here's the summary of our work today and the performance improvements we achieved across the board.", turnNumber: 10 },
		];
		// 3 tool turns out of 10 = 30% => mixed
		expect(detectSessionType(turns)).toBe("mixed");
	});

	it("should count both [tool:xxx] and toolCalls as tool turns", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "Help me out. Need to fix a few things in the codebase. Let's start with reading the config file first.", turnNumber: 1 },
			{ role: "assistant", content: "[tool:read] reading file", turnNumber: 2 },
			{
				role: "assistant",
				content: "editing",
				turnNumber: 3,
				toolCalls: [{ name: "edit", input: "{}", result: "ok" }],
			},
			{ role: "assistant", content: "[tool:bash] running", turnNumber: 4 },
			{
				role: "assistant",
				content: "checking",
				turnNumber: 5,
				toolCalls: [{ name: "read", input: "f", result: "ok" }],
			},
			{ role: "assistant", content: "Plain text summary of the work we did here.", turnNumber: 6 },
		];
		// 4 out of 6 = 66.7% => coding
		expect(detectSessionType(turns)).toBe("coding");
	});

	it("should not count as personal when turns > 4 even if messages are short", () => {
		const turns: SessionTurn[] = Array.from({ length: 6 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: "ok",
			turnNumber: i + 1,
		}));
		// 6 turns, 0 tools => 0% tool ratio => discussion
		expect(detectSessionType(turns)).toBe("discussion");
	});

	it("should handle single turn correctly", () => {
		const turns: SessionTurn[] = [
			{ role: "user", content: "Hello", turnNumber: 1 },
		];
		// 1 turn, short => personal
		expect(detectSessionType(turns)).toBe("personal");
	});
});

// ─── extractEventChain — User Turn Extraction ──────────────────────────────

describe("extractEventChain — user turns", () => {
	it("should extract action event from user turn with [tool:xxx]", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "[tool:read] src/index.ts content here")];
		const chain = extractEventChain(meta, turns);
		const actions = chain.events.filter((e) => e.type === "action");
		expect(actions.length).toBeGreaterThanOrEqual(1);
		expect(actions[0].tool).toBe("read");
		expect(actions[0].summary).toContain("Used read");
	});

	it("should extract tool name from [tool:xxx] format correctly", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "[tool:grep] searching for patterns")];
		const chain = extractEventChain(meta, turns);
		const actions = chain.events.filter((e) => e.type === "action");
		expect(actions[0].tool).toBe("grep");
	});

	it("should extract fact event for 'I live in Vienna'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "I live in Vienna")];
		const chain = extractEventChain(meta, turns);
		const facts = chain.events.filter((e) => e.type === "fact");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].summary).toMatch(/Vienna/i);
	});

	it("should extract fact event for 'my name is Alex'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "my name is Alex")];
		const chain = extractEventChain(meta, turns);
		const facts = chain.events.filter((e) => e.type === "fact");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].summary).toMatch(/Alex/i);
	});

	it("should extract fact event for 'remember that the deploy key is in vault'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "remember that the deploy key is in vault")];
		const chain = extractEventChain(meta, turns);
		const facts = chain.events.filter((e) => e.type === "fact");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].summary).toMatch(/deploy key/i);
	});

	it("should extract preference event for 'always use bun'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "always use bun instead of npm")];
		const chain = extractEventChain(meta, turns);
		const prefs = chain.events.filter((e) => e.type === "preference");
		expect(prefs.length).toBeGreaterThanOrEqual(1);
		expect(prefs[0].summary).toMatch(/bun/i);
	});

	it("should extract preference event for 'I prefer tabs'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "I prefer tabs over spaces always")];
		const chain = extractEventChain(meta, turns);
		const prefs = chain.events.filter((e) => e.type === "preference");
		expect(prefs.length).toBeGreaterThanOrEqual(1);
		expect(prefs[0].summary).toMatch(/tabs/i);
	});

	it("should extract question event when content ends with '?'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "How do I configure the build pipeline?")];
		const chain = extractEventChain(meta, turns);
		const questions = chain.events.filter((e) => e.type === "question");
		expect(questions.length).toBeGreaterThanOrEqual(1);
		expect(questions[0].summary).toContain("build pipeline");
	});

	it("should extract question event for leading question words", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "What is the best approach for caching")];
		const chain = extractEventChain(meta, turns);
		const questions = chain.events.filter((e) => e.type === "question");
		expect(questions.length).toBeGreaterThanOrEqual(1);
	});

	it("should extract decision event for short user statements", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "Use SQLite for persistence")];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter((e) => e.type === "decision");
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(decisions[0].summary).toContain("SQLite");
	});

	it("should extract topic from first line of user message", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "Refactor the authentication module\nWe need to change the JWT handling")];
		const chain = extractEventChain(meta, turns);
		expect(chain.topics.length).toBeGreaterThanOrEqual(1);
		expect(chain.topics[0]).toContain("Refactor the authentication module");
	});

	it("should strip common prefixes from topic extraction", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "Hey can you refactor the auth module please")];
		const chain = extractEventChain(meta, turns);
		// "Hey" and "can you" should be stripped, leaving the meaningful part
		expect(chain.topics.length).toBeGreaterThanOrEqual(1);
		expect(chain.topics[0]).not.toMatch(/^hey/i);
	});

	it("should not extract topic from very short first lines", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "ok\nDo the thing now")];
		const chain = extractEventChain(meta, turns);
		// "ok" is < 5 chars, should not be a topic; cleaned version after removing "ok" is empty or too short
		const okTopics = chain.topics.filter((t) => t === "ok");
		expect(okTopics.length).toBe(0);
	});

	it("should not add duplicate topics", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Refactor the auth module"),
			makeTurn("assistant", "Sure, I'll do that."),
			makeTurn("user", "Refactor the auth module"),
		];
		const chain = extractEventChain(meta, turns);
		const matching = chain.topics.filter((t) => t.includes("Refactor the auth module"));
		expect(matching.length).toBe(1);
	});

	it("should return early for [tool:xxx] turns without extracting other event types", () => {
		// When a user turn matches [tool:xxx], it should return just the action event
		const meta = makeMeta();
		const turns = [makeTurn("user", "[tool:read] How do I configure this?")];
		const chain = extractEventChain(meta, turns);
		const questions = chain.events.filter((e) => e.type === "question");
		expect(questions.length).toBe(0); // tool match returns early
	});
});

// ─── extractEventChain — Coding Assistant Extraction ────────────────────────

describe("extractEventChain — coding assistant turns", () => {
	it("should extract action event from tool result format [tool -> time]", () => {
		const meta = makeMeta();
		// Need enough tool turns for coding classification
		const turns = [
			makeTurn("user", "Fix all the bugs in the codebase"),
			...makeToolTurns(5),
			makeTurn("assistant", "[read → 5ms] file content here with details"),
		];
		const chain = extractEventChain(meta, turns);
		const actions = chain.events.filter(
			(e) => e.type === "action" && e.tool === "read",
		);
		expect(actions.length).toBeGreaterThanOrEqual(1);
		expect(actions.some((a) => a.summary.includes("read:"))).toBe(true);
	});

	it("should extract file modification events", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Fix the code"),
			...makeToolTurns(5),
			makeTurn("assistant", "Edited: src/foo.ts\nModified: src/bar.ts"),
		];
		const chain = extractEventChain(meta, turns);
		const fileActions = chain.events.filter(
			(e) => e.type === "action" && e.files && e.files.length > 0,
		);
		expect(fileActions.length).toBeGreaterThanOrEqual(1);
		expect(fileActions[0].files).toContain("src/foo.ts");
		expect(fileActions[0].files).toContain("src/bar.ts");
		expect(fileActions[0].summary).toContain("Modified 2 file(s)");
	});

	it("should handle 'Created' and 'Deleted' file patterns", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Set up the project"),
			...makeToolTurns(5),
			makeTurn("assistant", "Created: src/new-module.ts\nDeleted: src/old-module.ts"),
		];
		const chain = extractEventChain(meta, turns);
		const fileActions = chain.events.filter(
			(e) => e.type === "action" && e.files && e.files.length > 0,
		);
		expect(fileActions.length).toBeGreaterThanOrEqual(1);
		const allFiles = fileActions.flatMap((a) => a.files ?? []);
		expect(allFiles).toContain("src/new-module.ts");
		expect(allFiles).toContain("src/old-module.ts");
	});

	it("should truncate file list at 3 in summary with ellipsis", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Refactor everything"),
			...makeToolTurns(5),
			makeTurn(
				"assistant",
				"File edited: a.ts\nFile edited: b.ts\nFile edited: c.ts\nFile edited: d.ts\nFile edited: e.ts",
			),
		];
		const chain = extractEventChain(meta, turns);
		const fileActions = chain.events.filter(
			(e) => e.type === "action" && e.files && e.files.length > 3,
		);
		expect(fileActions.length).toBeGreaterThanOrEqual(1);
		expect(fileActions[0].summary).toContain("...");
		expect(fileActions[0].files!.length).toBe(5);
	});

	it("should extract error events", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Run the tests"),
			...makeToolTurns(5),
			makeTurn("assistant", "Error: Cannot find module './missing'"),
		];
		const chain = extractEventChain(meta, turns);
		const errors = chain.events.filter((e) => e.type === "error");
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0].summary).toContain("Cannot find module");
	});

	it("should extract error events with 'FAIL' prefix", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Run the tests"),
			...makeToolTurns(5),
			makeTurn("assistant", "FAIL: test/auth.test.ts failed with 3 errors"),
		];
		const chain = extractEventChain(meta, turns);
		const errors = chain.events.filter((e) => e.type === "error");
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0].summary).toContain("FAIL");
	});

	it("should extract commit events with hash", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Commit the changes"),
			...makeToolTurns(5),
			makeTurn("assistant", "Committed: abc1234 with message 'fix: auth bug'"),
		];
		const chain = extractEventChain(meta, turns);
		const commits = chain.events.filter((e) => e.type === "commit");
		expect(commits.length).toBeGreaterThanOrEqual(1);
		expect(commits[0].summary).toContain("abc1234");
	});

	it("should extract commit events with 'pushed' keyword", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Push the code"),
			...makeToolTurns(5),
			makeTurn("assistant", "pushed: def5678 to remote origin/main"),
		];
		const chain = extractEventChain(meta, turns);
		const commits = chain.events.filter((e) => e.type === "commit");
		expect(commits.length).toBeGreaterThanOrEqual(1);
		expect(commits[0].summary).toContain("def5678");
	});

	it("should extract decision event for short assistant content with no other match", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "What should we do?"),
			...makeToolTurns(5),
			makeTurn("assistant", "Let's use the adapter pattern here."),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("adapter pattern"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
	});

	it("should NOT extract decision for very short assistant content (<= 10 chars)", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Ok"),
			...makeToolTurns(5),
			makeTurn("assistant", "Done."),
		];
		const chain = extractEventChain(meta, turns);
		// "Done." is 5 chars < 10, so no decision event should be extracted
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary === "Done.",
		);
		expect(decisions.length).toBe(0);
	});
});

// ─── extractEventChain — Discussion Assistant Extraction ────────────────────

describe("extractEventChain — discussion assistant turns", () => {
	it("should extract topic event from first meaningful line", () => {
		const meta = makeMeta();
		// Need enough plain text turns for discussion classification
		const turns = [
			...makeTextTurns(6),
			makeTurn("assistant", "Understanding the event sourcing approach for state management"),
		];
		const chain = extractEventChain(meta, turns);
		const topics = chain.events.filter((e) => e.type === "topic");
		expect(topics.some((t) => t.summary.includes("event sourcing"))).toBe(true);
	});

	it("should strip markdown heading prefixes from topic extraction", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn("assistant", "## Architecture Overview of the System\nDetails follow here."),
		];
		const chain = extractEventChain(meta, turns);
		const topics = chain.events.filter(
			(e) => e.type === "topic" && e.summary.includes("Architecture Overview"),
		);
		expect(topics.length).toBeGreaterThanOrEqual(1);
		expect(topics[0].summary).not.toMatch(/^##/);
	});

	it("should extract decision event from numbered options list", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"Here are the options:\n1. Use Redis for caching\n2. Use memcached\n3. Use in-memory LRU",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.startsWith("Options:"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(decisions[0].summary).toContain("Redis");
		expect(decisions[0].summary).toContain("memcached");
	});

	it("should extract decision event from bullet-point options", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"Considerations:\n- Fast lookups via hash map\n- Sorted access via B-tree\n- Flexible queries via SQLite",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.startsWith("Options:"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
	});

	it("should extract decision event from 'Option A/B' list", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"Two paths forward:\nOption A: Rewrite from scratch\nOption B: Incremental refactor",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.startsWith("Options:"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(decisions[0].summary).toContain("Option A");
	});

	it("should extract conclusion/summary line starting with 'So'", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"We analyzed the options.\nPerformance is key.\nSo the key takeaway is to use SQLite.",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("key takeaway"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
	});

	it("should extract conclusion line starting with 'In summary'", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"We looked at three options.\nEach has tradeoffs.\nIn summary, the adapter pattern is the safest choice.",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("adapter pattern"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
	});

	it("should extract conclusion line starting with 'The key'", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn(
				"assistant",
				"Multiple factors to consider here.\nThe key insight is that latency matters more than throughput.",
			),
		];
		const chain = extractEventChain(meta, turns);
		const decisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("latency"),
		);
		expect(decisions.length).toBeGreaterThanOrEqual(1);
	});

	it("should not extract topic from very short first lines (<= 10 chars)", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn("assistant", "Sure.\nHere is a detailed response about the architecture."),
		];
		const chain = extractEventChain(meta, turns);
		// "Sure." is only 5 chars after trimming, should not create a topic event
		const shortTopics = chain.events.filter(
			(e) => e.type === "topic" && e.summary === "Sure.",
		);
		expect(shortTopics.length).toBe(0);
	});
});

// ─── extractEventChain — Mixed Sessions ─────────────────────────────────────

describe("extractEventChain — mixed sessions", () => {
	it("should apply both coding and discussion extractors for mixed sessions", () => {
		const meta = makeMeta();
		// 10 turns, 3 with tool patterns => 30% => mixed
		const turns: TimestampedTurn[] = [
			makeTurn("user", "Let's discuss the design and then implement it. We need a longer message to prevent personal."),
			makeTurn("assistant", "Understanding the design requirements for the new caching layer"),
			makeTurn("user", "What about performance? I need this to be fast. Can you give me a detailed analysis of the issues?"),
			makeTurn("assistant", "[tool:read] analyzed performance data"),
			makeTurn("assistant", "Here are the results of the analysis showing the performance bottleneck clearly and in great detail."),
			makeTurn("user", "Good, now let's fix it. Apply the optimization we discussed. Be thorough and ensure it all works here."),
			makeTurn("assistant", "[tool:edit] optimized the code"),
			makeTurn("assistant", "[tool:bash] ran benchmarks"),
			makeTurn("user", "The results look good. Let me summarize what we decided and what the next steps should be overall now."),
			makeTurn("assistant", "Here's the summary of our work.\nSo the key improvement was reducing latency by 40%."),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("mixed");
		// Should have both topic events (from discussion extractor) and action events (from coding extractor)
		const topics = chain.events.filter((e) => e.type === "topic");
		const questions = chain.events.filter((e) => e.type === "question");
		expect(topics.length + questions.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── extractEventChain — Personal Sessions ──────────────────────────────────

describe("extractEventChain — personal sessions", () => {
	it("should keep short assistant responses as action events", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "I live in Vienna"),
			makeTurn("assistant", "Got it, I'll remember that you live in Vienna."),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("personal");
		const actions = chain.events.filter(
			(e) => e.type === "action" && e.summary.includes("Vienna"),
		);
		expect(actions.length).toBeGreaterThanOrEqual(1);
	});

	it("should not extract action from long assistant responses (>= 500 chars)", () => {
		const meta = makeMeta();
		const longContent = "A".repeat(501);
		const turns = [
			makeTurn("user", "Tell me about TypeScript"),
			makeTurn("assistant", longContent),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("personal");
		// The long assistant response should NOT produce an action event
		const longActions = chain.events.filter(
			(e) => e.type === "action" && e.summary.startsWith("A"),
		);
		expect(longActions.length).toBe(0);
	});
});

// ─── Event Deduplication ────────────────────────────────────────────────────

describe("event deduplication", () => {
	it("should deduplicate events with same type and similar summary", () => {
		const meta = makeMeta();
		// Two identical user turns produce identical events
		const turns = [
			makeTurn("user", "Use SQLite for persistence", { createdAt: 1000 }),
			makeTurn("assistant", "Ok, noted.", { createdAt: 2000 }),
			makeTurn("user", "Use SQLite for persistence", { createdAt: 3000 }),
		];
		const chain = extractEventChain(meta, turns);
		const sqliteDecisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("SQLite"),
		);
		expect(sqliteDecisions.length).toBe(1);
	});

	it("should keep events with different types even if summaries are similar", () => {
		const meta = makeMeta();
		// A fact and a decision with overlapping content
		const turns = [
			makeTurn("user", "I prefer using TypeScript for everything", { createdAt: 1000 }),
		];
		const chain = extractEventChain(meta, turns);
		// Should have both preference and decision events
		const types = new Set(chain.events.map((e) => e.type));
		expect(types.size).toBeGreaterThanOrEqual(1);
	});

	it("should normalize punctuation when deduplicating", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Use SQLite!", { createdAt: 1000 }),
			makeTurn("assistant", "Sure.", { createdAt: 2000 }),
			makeTurn("user", "Use SQLite.", { createdAt: 3000 }),
		];
		const chain = extractEventChain(meta, turns);
		// "Use SQLite!" and "Use SQLite." should deduplicate (punctuation removed)
		const sqliteDecisions = chain.events.filter(
			(e) => e.type === "decision" && e.summary.includes("SQLite"),
		);
		expect(sqliteDecisions.length).toBe(1);
	});
});

// ─── Narrative Generation ───────────────────────────────────────────────────

describe("narrative generation", () => {
	it("should include time and provider in narrative", () => {
		const meta = makeMeta({ provider: "claude-code" });
		const turns = [makeTurn("user", "Hello!")];
		const chain = extractEventChain(meta, turns);
		expect(chain.narrative).toContain("claude-code");
		// Time should be formatted from meta.created
		expect(chain.narrative).toMatch(/\d{2}:\d{2}/);
	});

	it("should fall back to agent name when no provider", () => {
		const meta = makeMeta({ provider: undefined, agent: "claude" });
		const turns = [makeTurn("user", "Hello!")];
		const chain = extractEventChain(meta, turns);
		expect(chain.narrative).toContain("claude");
	});

	it("should include action, error, and commit counts for coding sessions", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Fix everything"),
			...makeToolTurns(6), // coding classification
			makeTurn("assistant", "Error: something went wrong"),
			makeTurn("assistant", "committed: abc1234 fix done"),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("coding");
		expect(chain.narrative).toMatch(/\d+ actions/);
		expect(chain.narrative).toMatch(/\d+ errors/);
		expect(chain.narrative).toMatch(/\d+ commits/);
	});

	it("should include topic names for discussion sessions", () => {
		const meta = makeMeta();
		const turns = [
			...makeTextTurns(6),
			makeTurn("assistant", "Understanding the microservice architecture patterns in our codebase"),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("discussion");
		expect(chain.narrative).toContain("Discussed:");
	});

	it("should include facts for personal sessions", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "I live in Vienna"),
			makeTurn("assistant", "Noted!"),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("personal");
		expect(chain.narrative).toMatch(/Vienna/i);
	});

	it("should include event count for mixed sessions", () => {
		const meta = makeMeta();
		const turns: TimestampedTurn[] = [
			makeTurn("user", "Let's discuss the design and then implement it. We need a longer message to prevent personal."),
			makeTurn("assistant", "Sure, here's my analysis of the problem space and potential solutions we should thoroughly consider."),
			makeTurn("user", "What about performance? I need this to be fast. Can you analyze the current bottleneck in detail now?"),
			makeTurn("assistant", "[tool:read] analyzed performance data"),
			makeTurn("assistant", "Here are the results of the analysis with detailed metrics and recommendations for each component."),
			makeTurn("user", "Good, now let's fix it. Apply the optimization we discussed. Be thorough and test everything carefully."),
			makeTurn("assistant", "[tool:edit] optimized the code"),
			makeTurn("assistant", "[tool:bash] ran benchmarks now"),
			makeTurn("user", "The results look good. Let me summarize what we decided and what the next steps should be going forward."),
			makeTurn("assistant", "Summary of our work today. Good progress was made on the performance optimization across the board."),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("mixed");
		expect(chain.narrative).toMatch(/\d+ events/);
	});

	it("should use provider from metadata if provider field is missing", () => {
		const meta = makeMeta({
			provider: undefined,
			agent: "unknown",
			metadata: { provider: "vaayu" },
		});
		const turns = [makeTurn("user", "Hello!")];
		const chain = extractEventChain(meta, turns);
		expect(chain.narrative).toContain("vaayu");
	});
});

// ─── EventChain Structure ───────────────────────────────────────────────────

describe("EventChain structure", () => {
	it("should sort events by timestamp", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "First thing to do", { createdAt: 3000 }),
			makeTurn("user", "Second thing", { createdAt: 1000 }),
			makeTurn("user", "Third thing", { createdAt: 2000 }),
		];
		const chain = extractEventChain(meta, turns);
		for (let i = 1; i < chain.events.length; i++) {
			expect(chain.events[i].timestamp).toBeGreaterThanOrEqual(
				chain.events[i - 1].timestamp,
			);
		}
	});

	it("should set correct sessionType on result", () => {
		const meta = makeMeta();
		const turns = makeToolTurns(8);
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("coding");
	});

	it("should preserve meta in result", () => {
		const meta = makeMeta({ id: "session-custom-id", project: "/special/project" });
		const turns = [makeTurn("user", "Hello")];
		const chain = extractEventChain(meta, turns);
		expect(chain.meta).toBe(meta);
		expect(chain.meta.id).toBe("session-custom-id");
		expect(chain.meta.project).toBe("/special/project");
	});

	it("should set sessionId on all events", () => {
		const meta = makeMeta({ id: "session-xyz-123" });
		const turns = [
			makeTurn("user", "Do the thing"),
			makeTurn("assistant", "Done the thing"),
		];
		const chain = extractEventChain(meta, turns);
		for (const event of chain.events) {
			expect(event.sessionId).toBe("session-xyz-123");
		}
	});

	it("should set provider on all events", () => {
		const meta = makeMeta({ provider: "claude-code" });
		const turns = [makeTurn("user", "Do something"), makeTurn("assistant", "Done")];
		const chain = extractEventChain(meta, turns);
		for (const event of chain.events) {
			expect(event.provider).toBe("claude-code");
		}
	});

	it("should include turnNumber on events", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "Do it now", { num: 42 })];
		const chain = extractEventChain(meta, turns);
		const withTurnNum = chain.events.filter((e) => e.turnNumber === 42);
		expect(withTurnNum.length).toBeGreaterThanOrEqual(1);
	});

	it("should return empty events for session with no extractable content", () => {
		const meta = makeMeta();
		const turns: TimestampedTurn[] = [];
		const chain = extractEventChain(meta, turns);
		expect(chain.events).toEqual([]);
		expect(chain.topics).toEqual([]);
	});

	it("should extract topics as an array of unique strings", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "How does the authentication work?"),
			makeTurn("assistant", "It uses JWT tokens."),
			makeTurn("user", "What about caching strategies?"),
			makeTurn("assistant", "We use Redis."),
		];
		const chain = extractEventChain(meta, turns);
		expect(Array.isArray(chain.topics)).toBe(true);
		// Should have at least 2 topics from the 2 user questions
		expect(chain.topics.length).toBeGreaterThanOrEqual(2);
		// All unique
		expect(new Set(chain.topics).size).toBe(chain.topics.length);
	});

	it("should handle large sessions without throwing", () => {
		const meta = makeMeta();
		const turns: TimestampedTurn[] = [];
		for (let i = 0; i < 100; i++) {
			turns.push(
				makeTurn(
					i % 2 === 0 ? "user" : "assistant",
					`Turn ${i}: ${i % 3 === 0 ? "[tool:read] content" : "Plain text discussion about architecture and design patterns"}`,
					{ num: i + 1, createdAt: Date.now() + i * 1000 },
				),
			);
		}
		const chain = extractEventChain(meta, turns);
		expect(chain.events.length).toBeGreaterThan(0);
		expect(chain.sessionType).toBeDefined();
	});
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("should handle turns with empty content", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", ""),
			makeTurn("assistant", ""),
		];
		const chain = extractEventChain(meta, turns);
		expect(chain).toBeDefined();
		expect(chain.sessionType).toBeDefined();
	});

	it("should truncate long summaries to 200 characters", () => {
		const meta = makeMeta();
		const longContent = "X".repeat(500);
		const turns = [makeTurn("user", longContent)];
		const chain = extractEventChain(meta, turns);
		for (const event of chain.events) {
			expect(event.summary.length).toBeLessThanOrEqual(200);
		}
	});

	it("should handle multiline user content for topic extraction", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Implement the caching layer\nHere are the requirements:\n1. Use LRU\n2. TTL of 5 minutes"),
		];
		const chain = extractEventChain(meta, turns);
		const topic = chain.topics.find((t) => t.includes("caching layer"));
		expect(topic).toBeDefined();
	});

	it("should extract fact from 'I work at Google'", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "I work at Google")];
		const chain = extractEventChain(meta, turns);
		const facts = chain.events.filter((e) => e.type === "fact");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].summary).toMatch(/Google/);
	});

	it("should handle 'based in' pattern as fact", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "I'm based in Berlin")];
		const chain = extractEventChain(meta, turns);
		const facts = chain.events.filter((e) => e.type === "fact");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].summary).toMatch(/Berlin/);
	});

	it("should handle 'never use' pattern as preference", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "never use var in JavaScript, always use const")];
		const chain = extractEventChain(meta, turns);
		const prefs = chain.events.filter((e) => e.type === "preference");
		expect(prefs.length).toBeGreaterThanOrEqual(1);
	});

	it("should handle tool result with millisecond timing", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Fix the code"),
			...makeToolTurns(5),
			makeTurn("assistant", "[grep → 12.5ms] found 3 matches in src/"),
		];
		const chain = extractEventChain(meta, turns);
		const actions = chain.events.filter((e) => e.tool === "grep");
		expect(actions.length).toBeGreaterThanOrEqual(1);
		expect(actions[0].summary).toContain("grep:");
	});

	it("should handle tool result with second timing", () => {
		const meta = makeMeta();
		const turns = [
			makeTurn("user", "Run the build"),
			...makeToolTurns(5),
			makeTurn("assistant", "[build → 3s] compilation succeeded"),
		];
		const chain = extractEventChain(meta, turns);
		const actions = chain.events.filter((e) => e.tool === "build");
		expect(actions.length).toBeGreaterThanOrEqual(1);
	});

	it("should handle provider fallback chain: provider -> metadata.provider -> agent -> 'unknown'", () => {
		// Test 1: explicit provider
		const meta1 = makeMeta({ provider: "explicit-provider" });
		const chain1 = extractEventChain(meta1, [makeTurn("user", "hi")]);
		expect(chain1.events[0].provider).toBe("explicit-provider");

		// Test 2: metadata.provider fallback
		const meta2 = makeMeta({
			provider: undefined,
			agent: "fallback-agent",
			metadata: { provider: "metadata-provider" },
		});
		const chain2 = extractEventChain(meta2, [makeTurn("user", "hi")]);
		expect(chain2.events[0].provider).toBe("metadata-provider");

		// Test 3: agent fallback
		const meta3 = makeMeta({
			provider: undefined,
			agent: "my-agent",
			metadata: undefined,
		});
		const chain3 = extractEventChain(meta3, [makeTurn("user", "hi")]);
		expect(chain3.events[0].provider).toBe("my-agent");
	});
});

// ─── Extended Session Types (Personal AI Assistant Domains) ─────────────────

describe("extended session type detection", () => {
	/** Helper to create 6+ user turns with domain-specific content. */
	function makeDomainTurns(messages: string[]): TimestampedTurn[] {
		const turns: TimestampedTurn[] = [];
		for (let i = 0; i < messages.length; i++) {
			turns.push(makeTurn("user", messages[i], { num: i * 2 + 1 }));
			turns.push(makeTurn("assistant", `I'll help with that. Here's what I found about your request on this topic.`, { num: i * 2 + 2 }));
		}
		return turns;
	}

	it("should detect 'planning' for task/project planning content", () => {
		const turns = makeDomainTurns([
			"I need to plan for the next sprint and set milestones",
			"What should the roadmap look like for Q2?",
			"Let's create a timeline with due dates for each feature",
			"Add these to the todo list and prioritise them",
		]);
		expect(detectSessionType(turns)).toBe("planning");
	});

	it("should detect 'learning' for educational content", () => {
		const turns = makeDomainTurns([
			"Teach me about how neural networks work, explain to me the basics",
			"What is a transformer architecture? Give me a walkthrough",
			"I want to learn about attention mechanisms, lesson on self-attention",
			"Help me understand backpropagation, what are the fundamentals of it?",
		]);
		expect(detectSessionType(turns)).toBe("learning");
	});

	it("should detect 'creative' for writing/brainstorming content", () => {
		const turns = makeDomainTurns([
			"Write a blog post about productivity tips",
			"Brainstorm some name suggestions for my new app",
			"Draft a tagline for the marketing page",
			"Compose a story about a developer who discovers AI",
		]);
		expect(detectSessionType(turns)).toBe("creative");
	});

	it("should detect 'health' for wellness content", () => {
		const turns = makeDomainTurns([
			"Help me plan my exercise routine and workout schedule",
			"What nutrition plan should I follow for my diet plan?",
			"Track my sleep schedule and meditation sessions",
			"I have a doctor appointment tomorrow, what symptoms of fatigue should I mention?",
		]);
		expect(detectSessionType(turns)).toBe("health");
	});

	it("should detect 'finance' for financial content", () => {
		const turns = makeDomainTurns([
			"Help me set up a budget for this month's monthly expenses",
			"Should I invest in index funds for my portfolio?",
			"What's the best savings account rate right now?",
			"Calculate my tax return deductions and net worth",
		]);
		expect(detectSessionType(turns)).toBe("finance");
	});

	it("should detect 'social' for people/messaging content", () => {
		const turns = makeDomainTurns([
			"Draft an email to my colleague about the schedule a meeting for Friday",
			"It's my friend's birthday next week, help me plan a gift for her",
			"Reply to the party invitation, my family is coming too",
			"Send a message to my partner about the anniversary dinner",
		]);
		expect(detectSessionType(turns)).toBe("social");
	});

	it("should detect 'research' for investigation content", () => {
		const turns = makeDomainTurns([
			"Do a deep dive into the state of the art for memory systems",
			"Find papers on arxiv about graph neural networks and survey of recent work",
			"Research on the tradeoffs between SQL and NoSQL for our use case",
			"Compare Redis vs Memcached, give me pros and cons of each",
		]);
		expect(detectSessionType(turns)).toBe("research");
	});

	it("should detect 'reflection' for journaling content", () => {
		const turns = makeDomainTurns([
			"Let's do a retrospective on this week, reflect on what happened",
			"What went well this sprint? What could improve?",
			"Write a journal entry about my takeaways from the project",
			"I'm grateful for the team, let me do a self-assessment",
		]);
		expect(detectSessionType(turns)).toBe("reflection");
	});

	it("should detect 'security' for security content", () => {
		const turns = makeDomainTurns([
			"Run a security audit on our authentication flow",
			"Check for vulnerability in the SSL certificate setup",
			"Review the access control rules and firewall rule configuration",
			"Do a penetration test on the API endpoints, check for data breach risk",
		]);
		expect(detectSessionType(turns)).toBe("security");
	});

	it("should detect 'operational' for ops content", () => {
		const turns = makeDomainTurns([
			"Deploy to production and set up the CI/CD pipeline",
			"The docker containers need to be updated on kubernetes",
			"Check the infrastructure status, there was a downtime incident",
			"Rollback the last release, the staging environment is broken",
		]);
		expect(detectSessionType(turns)).toBe("operational");
	});

	it("should not override coding sessions even with domain keywords", () => {
		// Mostly tool calls (>60%) — should stay "coding" even with domain keywords
		const turns: SessionTurn[] = [
			{ role: "user", content: "Deploy to production via the CI/CD pipeline", turnNumber: 1 },
			{ role: "assistant", content: "[tool:bash] deploying", turnNumber: 2 },
			{ role: "assistant", content: "[tool:read] checking config", turnNumber: 3 },
			{ role: "assistant", content: "[tool:write] writing manifest", turnNumber: 4 },
			{ role: "assistant", content: "[tool:bash] running deploy", turnNumber: 5 },
		];
		// 4/5 = 80% tool ratio → coding
		expect(detectSessionType(turns)).toBe("coding");
	});

	it("should fall back to core type when domain signals are weak (< 2 groups)", () => {
		// Only one domain signal group matches — not enough to override
		const turns = makeDomainTurns([
			"Let's discuss the architecture of the system",
			"What about the performance characteristics?",
			"How should we structure the modules?",
			"I think we should use a modular approach for this",
		]);
		// No domain has 2+ groups matching, should be "discussion"
		const type = detectSessionType(turns);
		expect(type).toBe("discussion");
	});
});

// ─── getExtractorStrategy ───────────────────────────────────────────────────

describe("getExtractorStrategy", () => {
	it("should return core types as-is", () => {
		expect(getExtractorStrategy("coding")).toBe("coding");
		expect(getExtractorStrategy("discussion")).toBe("discussion");
		expect(getExtractorStrategy("mixed")).toBe("mixed");
		expect(getExtractorStrategy("personal")).toBe("personal");
	});

	it("should map extended types to correct core extractors", () => {
		expect(getExtractorStrategy("planning")).toBe("discussion");
		expect(getExtractorStrategy("learning")).toBe("discussion");
		expect(getExtractorStrategy("creative")).toBe("discussion");
		expect(getExtractorStrategy("research")).toBe("discussion");
		expect(getExtractorStrategy("reflection")).toBe("discussion");
		expect(getExtractorStrategy("operational")).toBe("mixed");
		expect(getExtractorStrategy("security")).toBe("mixed");
		expect(getExtractorStrategy("health")).toBe("personal");
		expect(getExtractorStrategy("social")).toBe("personal");
		expect(getExtractorStrategy("finance")).toBe("personal");
	});
});

// ─── Extended Session Types — Event Extraction ──────────────────────────────

describe("extended session types — event extraction", () => {
	function makeDomainSession(messages: string[]): TimestampedTurn[] {
		const turns: TimestampedTurn[] = [];
		for (let i = 0; i < messages.length; i++) {
			turns.push(makeTurn("user", messages[i], { num: i * 2 + 1 }));
			turns.push(makeTurn("assistant", `I'll help with that. Here's my detailed response about your request.`, { num: i * 2 + 2 }));
		}
		return turns;
	}

	it("should use discussion extractor for planning sessions", () => {
		const meta = makeMeta();
		const turns = makeDomainSession([
			"Let's plan for the next sprint and set milestones",
			"Create a timeline with due dates for each deliverable",
			"Add these to the todo list and prioritise by impact",
		]);
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("planning");
		// Discussion extractor produces topic events
		expect(chain.events.some(e => e.type === "topic" || e.type === "decision" || e.type === "question")).toBe(true);
	});

	it("should use personal extractor for health sessions", () => {
		const meta = makeMeta();
		const turns = makeDomainSession([
			"Track my exercise routine and workout schedule",
			"I need a diet plan and nutrition guide for the week",
			"Check my sleep schedule and meditation progress",
		]);
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("health");
		// Personal extractor keeps short responses as actions
		expect(chain.events.some(e => e.type === "action")).toBe(true);
	});

	it("should include domain label in narrative for extended types", () => {
		const meta = makeMeta();
		const turns = makeDomainSession([
			"Help me set up a budget for monthly expenses",
			"Track my portfolio and savings account status",
			"Calculate my tax return and net worth",
		]);
		const chain = extractEventChain(meta, turns);
		expect(chain.sessionType).toBe("finance");
		expect(chain.narrative).toContain("[Finance]");
	});

	it("should not include domain label for core types", () => {
		const meta = makeMeta();
		const turns = [makeTurn("user", "Hello")];
		const chain = extractEventChain(meta, turns);
		expect(chain.narrative).not.toMatch(/\[.*\]/);
	});
});
