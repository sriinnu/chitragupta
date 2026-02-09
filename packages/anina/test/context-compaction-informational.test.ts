import { describe, it, expect } from "vitest";
import {
	computeTfIdfScores,
	textRankMessages,
	minHashDedup,
	shannonSurprisal,
	CompactionMonitor,
	informationalCompact,
} from "../src/context-compaction-informational.js";
import type { AgentMessage, AgentState } from "../src/types.js";
import type { ContentPart } from "@chitragupta/swara";

// ─── Helpers ────────────────────────────────────────────────────────────────

let msgIdCounter = 0;
function makeMsg(
	role: "user" | "assistant" | "system",
	text: string,
	timestampOffset: number = 0,
): AgentMessage {
	msgIdCounter++;
	return {
		id: `msg-${msgIdCounter}`,
		role,
		content: [{ type: "text", text } as ContentPart],
		timestamp: 1700000000000 + timestampOffset * 1000,
	};
}

function makeState(messages: AgentMessage[], systemPrompt: string = "You are a helpful assistant."): AgentState {
	return {
		messages,
		model: "test-model",
		providerId: "test-provider",
		tools: [],
		systemPrompt,
		thinkingLevel: "none",
		isStreaming: false,
		sessionId: "test-session",
		agentProfileId: "test-profile",
	};
}

// ─── TF-IDF Scoring ─────────────────────────────────────────────────────────

describe("computeTfIdfScores", () => {
	it("returns empty map for empty messages", () => {
		expect(computeTfIdfScores([]).size).toBe(0);
	});

	it("common terms get lower scores than rare terms", () => {
		const messages = [
			makeMsg("user", "the the the the the the the the the the", 1),
			makeMsg("assistant", "quantum entanglement teleportation superposition decoherence", 2),
			makeMsg("user", "the the the the the the", 3),
		];
		const scores = computeTfIdfScores(messages);

		// "the" appears in multiple documents and is very common -> low TF-IDF
		// "quantum entanglement..." has unique terms -> high TF-IDF
		const commonScore = scores.get(messages[0].id) ?? 0;
		const rareScore = scores.get(messages[1].id) ?? 0;
		expect(rareScore).toBeGreaterThan(commonScore);
	});

	it("empty messages get score 0", () => {
		const messages = [
			makeMsg("user", "", 1),
			makeMsg("assistant", "some actual content here", 2),
		];
		const scores = computeTfIdfScores(messages);
		expect(scores.get(messages[0].id)).toBe(0);
	});

	it("a unique message among duplicates has high TF-IDF", () => {
		const messages = [
			makeMsg("user", "please help me fix the build error", 1),
			makeMsg("assistant", "please help me fix the build error", 2),
			makeMsg("user", "please help me fix the build error", 3),
			makeMsg("assistant", "implementing graph database indexing with btree traversal algorithms", 4),
		];
		const scores = computeTfIdfScores(messages);
		const uniqueScore = scores.get(messages[3].id) ?? 0;
		const duplicateScore = scores.get(messages[0].id) ?? 0;
		expect(uniqueScore).toBeGreaterThan(duplicateScore);
	});
});

// ─── TextRank ────────────────────────────────────────────────────────────────

describe("textRankMessages", () => {
	it("returns empty map for empty input", () => {
		expect(textRankMessages([]).size).toBe(0);
	});

	it("returns score 1 for a single message", () => {
		const messages = [makeMsg("user", "hello world", 1)];
		const scores = textRankMessages(messages);
		expect(scores.get(messages[0].id)).toBe(1);
	});

	it("messages similar to many others rank higher", () => {
		const messages = [
			makeMsg("user", "implement the file reader tool for typescript", 1),
			makeMsg("assistant", "the file reader tool reads typescript source files", 2),
			makeMsg("user", "test the typescript file reader", 3),
			makeMsg("assistant", "reading files and parsing typescript syntax", 4),
			makeMsg("user", "what is the weather in paris today", 5), // unrelated
		];
		const scores = textRankMessages(messages);

		// The file-reader messages share many terms and should rank higher
		// The weather message is unrelated and should rank lower
		const weatherScore = scores.get(messages[4].id) ?? 0;
		const fileReaderScore = scores.get(messages[1].id) ?? 0;
		expect(fileReaderScore).toBeGreaterThan(weatherScore);
	});

	it("all scores are in [0, 1]", () => {
		const messages = [
			makeMsg("user", "create a new project with typescript", 1),
			makeMsg("assistant", "setting up the project structure now", 2),
			makeMsg("user", "add tests for the parser module", 3),
		];
		const scores = textRankMessages(messages);
		for (const score of scores.values()) {
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		}
	});
});

// ─── MinHash Dedup ──────────────────────────────────────────────────────────

describe("minHashDedup", () => {
	it("returns empty array for empty input", () => {
		expect(minHashDedup([])).toEqual([]);
	});

	it("near-duplicate messages cluster together", () => {
		const messages = [
			makeMsg("user", "please read the file at /src/index.ts and show me the contents", 1),
			makeMsg("user", "please read the file at /src/index.ts and show me its contents", 2),
			makeMsg("assistant", "implementing binary search tree with balanced rotation algorithms", 3),
		];
		const clusters = minHashDedup(messages, 0.5);

		// The first two messages are near-duplicates and should cluster
		// Message 3 is completely different
		expect(clusters.length).toBeLessThanOrEqual(2);

		// Find the cluster containing message[0]
		const cluster0 = clusters.find((c) => c.some((m) => m.id === messages[0].id));
		expect(cluster0).toBeDefined();
		// If they cluster, they should be in the same cluster
		if (cluster0!.length > 1) {
			expect(cluster0!.some((m) => m.id === messages[1].id)).toBe(true);
		}
	});

	it("distinct messages do not cluster", () => {
		const messages = [
			makeMsg("user", "compile the rust crate with cargo build release mode", 1),
			makeMsg("assistant", "quantum physics explains the wave particle duality", 2),
			makeMsg("user", "bake chocolate chip cookies at three hundred fifty degrees", 3),
		];
		const clusters = minHashDedup(messages, 0.6);

		// All three messages should be in separate clusters
		expect(clusters.length).toBe(3);
		for (const cluster of clusters) {
			expect(cluster.length).toBe(1);
		}
	});

	it("identical messages definitely cluster together", () => {
		const text = "the quick brown fox jumps over the lazy dog near the river bank";
		const messages = [
			makeMsg("user", text, 1),
			makeMsg("user", text, 2),
			makeMsg("user", text, 3),
		];
		const clusters = minHashDedup(messages, 0.5);
		// All three identical messages should form one cluster
		expect(clusters.length).toBe(1);
		expect(clusters[0].length).toBe(3);
	});
});

// ─── Shannon Surprisal ──────────────────────────────────────────────────────

describe("shannonSurprisal", () => {
	it("returns empty map for empty input", () => {
		expect(shannonSurprisal([]).size).toBe(0);
	});

	it("surprising messages have higher scores than common ones", () => {
		const messages = [
			makeMsg("user", "the the the the the the the the", 1),
			makeMsg("assistant", "the the the the the the", 2),
			makeMsg("user", "the the the the", 3),
			makeMsg("assistant", "supercalifragilistic cryptographic nondeterminism", 4), // rare words
		];
		const surprisals = shannonSurprisal(messages);

		const commonSurprisal = surprisals.get(messages[0].id) ?? 0;
		const rareSurprisal = surprisals.get(messages[3].id) ?? 0;
		expect(rareSurprisal).toBeGreaterThan(commonSurprisal);
	});

	it("all surprisal values are non-negative", () => {
		const messages = [
			makeMsg("user", "implement the parser for yaml frontmatter", 1),
			makeMsg("assistant", "parsing yaml with indentation-based nesting", 2),
		];
		const surprisals = shannonSurprisal(messages);
		for (const s of surprisals.values()) {
			expect(s).toBeGreaterThanOrEqual(0);
		}
	});
});

// ─── CompactionMonitor ──────────────────────────────────────────────────────

describe("CompactionMonitor", () => {
	it("returns 'none' tier when usage is below 60%", () => {
		const monitor = new CompactionMonitor();
		const messages = [makeMsg("user", "short message", 1)];
		const state = makeState(messages);
		const { tier } = monitor.checkAndCompact(state, 100000);
		expect(tier).toBe("none");
	});

	it("returns 'gentle' tier at 60-75% usage", () => {
		const monitor = new CompactionMonitor();
		// estimateTotalTokens adds: systemPrompt(~7) + perMsg(4) + provider(100) = ~111 overhead
		// Need total ~650 tokens (65% of 1000), so message chars = (650-111)*4 ≈ 2156
		const longText = "x".repeat(2000);
		const messages = [makeMsg("user", longText, 1)];
		const state = makeState(messages);
		const { tier } = monitor.checkAndCompact(state, 1000);
		expect(tier).toBe("gentle");
	});

	it("returns 'moderate' tier at 75-90% usage", () => {
		const monitor = new CompactionMonitor();
		// Need total ~800 tokens (80% of 1000), so message chars = (800-111)*4 ≈ 2756
		const longText = "x".repeat(2700);
		const messages = [makeMsg("user", longText, 1)];
		const state = makeState(messages);
		const { tier } = monitor.checkAndCompact(state, 1000);
		expect(tier).toBe("moderate");
	});

	it("returns 'aggressive' tier at 90%+ usage", () => {
		const monitor = new CompactionMonitor();
		const longText = "x".repeat(4000);
		const messages = [makeMsg("user", longText, 1)];
		const state = makeState(messages);
		const { tier } = monitor.checkAndCompact(state, 1000);
		expect(tier).toBe("aggressive");
	});

	it("custom thresholds override defaults", () => {
		const monitor = new CompactionMonitor({ gentle: 0.3, moderate: 0.5, aggressive: 0.7 });
		// At 40% of 1000 tokens = 400 tokens = 1600 chars
		const text = "x".repeat(1600);
		const messages = [makeMsg("user", text, 1)];
		const state = makeState(messages);
		const { tier } = monitor.checkAndCompact(state, 1000);
		// 1600 chars / 4 = 400 tokens, plus overhead. With custom gentle=0.3, this should be gentle or moderate
		expect(["gentle", "moderate"]).toContain(tier);
	});
});

// ─── informationalCompact ───────────────────────────────────────────────────

describe("informationalCompact", () => {
	it("preserves messages when count is <= 3", () => {
		const messages = [
			makeMsg("user", "start a new project", 1),
			makeMsg("assistant", "sure, creating the project now", 2),
		];
		const result = informationalCompact(messages, 10000);
		expect(result.length).toBe(2);
	});

	it("output has fewer tokens than input for large conversation", () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(
				makeMsg(
					i % 2 === 0 ? "user" : "assistant",
					`This is message number ${i} discussing ${i % 3 === 0 ? "database design patterns" : i % 3 === 1 ? "api endpoint configuration" : "frontend rendering pipeline"} with some additional context about software engineering.`,
					i,
				),
			);
		}

		const targetTokens = 50; // Very tight budget
		const result = informationalCompact(messages, targetTokens);

		// Should have fewer messages than input
		expect(result.length).toBeLessThan(messages.length);
	});

	it("system messages are always preserved", () => {
		const messages: AgentMessage[] = [
			makeMsg("system", "You are a code review assistant specializing in TypeScript.", 0),
			...Array.from({ length: 10 }, (_, i) =>
				makeMsg(
					i % 2 === 0 ? "user" : "assistant",
					`Discussion point ${i} about implementing the ${i % 2 === 0 ? "parser" : "writer"} module.`,
					i + 1,
				),
			),
		];

		const result = informationalCompact(messages, 100);
		const systemMsgs = result.filter((m) => m.role === "system");
		expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
	});

	it("the last message is always preserved", () => {
		const messages: AgentMessage[] = Array.from({ length: 15 }, (_, i) =>
			makeMsg(
				i % 2 === 0 ? "user" : "assistant",
				`Message ${i}: ${i < 10 ? "generic filler content" : "critical final instructions for deployment"}`,
				i,
			),
		);

		const result = informationalCompact(messages, 80);
		const lastOriginal = messages[messages.length - 1];
		const lastCompacted = result[result.length - 1];
		expect(lastCompacted.id).toBe(lastOriginal.id);
	});
});
