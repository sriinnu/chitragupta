import { describe, it, expect } from "vitest";
import { classifyComplexity } from "@chitragupta/swara";
import type { Context, StreamOptions } from "@chitragupta/swara";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ctx(text: string, tools?: Array<{ name: string }>): Context {
	return {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text }],
			},
		],
		tools: tools as Context["tools"],
	};
}

function longMessage(wordCount: number): string {
	return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("classifyComplexity (Vichara)", () => {
	describe("trivial signals", () => {
		// Greeting/acknowledgement signals fire (weight 0) but the "brief request"
		// signal also fires (weight 1.0) because word count < 50 and no code keywords.
		// Total score = 1.0, which lands in the "simple" tier [1.0, 2.5).
		// The trivial tier [0, 1.0) requires score strictly below 1.0.
		// We verify the greeting signal is detected in the reason.
		it("should detect greeting signal for 'yes'", () => {
			const result = classifyComplexity(ctx("yes"));
			expect(result.reason).toContain("greeting/acknowledgement");
		});

		it("should detect greeting signal for 'no'", () => {
			const result = classifyComplexity(ctx("no"));
			expect(result.reason).toContain("greeting/acknowledgement");
		});

		it("should detect greeting signal for 'hi'", () => {
			const result = classifyComplexity(ctx("hi"));
			expect(result.reason).toContain("greeting/acknowledgement");
		});

		it("should detect greeting signal for 'hello'", () => {
			const result = classifyComplexity(ctx("hello"));
			expect(result.reason).toContain("greeting/acknowledgement");
		});

		it("should classify greetings as simple (greeting + brief request signals)", () => {
			// greeting (weight 0) + brief request (weight 1.0) = score 1.0 → simple tier
			const result = classifyComplexity(ctx("yes"));
			expect(result.complexity).toBe("simple");
		});
	});

	describe("short questions", () => {
		it("should match 'short question' signal for questions under 10 words", () => {
			const result = classifyComplexity(ctx("what is a monad?"));
			expect(result.reason).toContain("short question");
		});
	});

	describe("simple messages", () => {
		it("should classify a brief request under 50 words with no code keywords as simple", () => {
			const result = classifyComplexity(ctx("tell me about the weather tomorrow"));
			expect(result.complexity).toBe("simple");
		});
	});

	describe("medium complexity", () => {
		it("should detect code-related keywords and include them in reason", () => {
			const result = classifyComplexity(ctx("implement a binary search function"));
			expect(result.reason).toContain("code-related keywords");
		});

		it("should detect 'class' as a code keyword", () => {
			const result = classifyComplexity(ctx("create a class for managing state"));
			expect(result.reason).toContain("code-related keywords");
		});

		it("should detect 'debug' as a code keyword", () => {
			const result = classifyComplexity(ctx("debug the sorting algorithm"));
			expect(result.reason).toContain("code-related keywords");
		});

		it("should classify tool-augmented request with code keywords as medium or higher", () => {
			// code keywords (weight 2.0) + tool-augmented (weight 2.0) = 4.0 → complex tier
			const result = classifyComplexity(
				ctx("implement a parser function", [{ name: "file_read" }]),
			);
			const order = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(order[result.complexity]).toBeGreaterThanOrEqual(order["medium"]);
		});
	});

	describe("complex messages", () => {
		it("should classify multi-step patterns as complex or higher", () => {
			// "first create...then export" fires multi-step (3.0) + code keywords (2.0) = 5.0 → complex
			const result = classifyComplexity(ctx("first create the module then export the functions"));
			expect(["complex", "expert"]).toContain(result.complexity);
		});

		it("should classify long messages (>200 words) as medium or higher", () => {
			// >200 words fires "long message" (weight 3.0). No code keywords in word0..word209.
			// Score = 3.0 → medium tier [2.5, 4.0)
			const result = classifyComplexity(ctx(longMessage(210)));
			const order = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(order[result.complexity]).toBeGreaterThanOrEqual(order["medium"]);
		});
	});

	describe("reasoning patterns", () => {
		it("should detect reasoning depth indicators and increase score", () => {
			const result = classifyComplexity(ctx("analyze the trade-offs between these approaches"));
			expect(result.reason).toContain("reasoning depth indicators");
		});
	});

	describe("expert messages", () => {
		it("should classify expert domain signals as expert", () => {
			const result = classifyComplexity(
				ctx("design a distributed system with fault tolerance and load balancing for scalability"),
			);
			expect(result.complexity).toBe("expert");
		});
	});

	describe("confidence and reason", () => {
		it("should always return confidence between 0.5 and 1.0", () => {
			const inputs = [
				"hi",
				"what time is it?",
				"implement a parser",
				"first analyze then refactor across multiple files",
				"design a distributed system with security audit",
			];
			for (const text of inputs) {
				const result = classifyComplexity(ctx(text));
				expect(result.confidence).toBeGreaterThanOrEqual(0.5);
				expect(result.confidence).toBeLessThanOrEqual(1.0);
			}
		});

		it("should always return a non-empty reason string", () => {
			const result = classifyComplexity(ctx("implement a function"));
			expect(result.reason.length).toBeGreaterThan(0);
		});

		it("should handle empty message and still return a classification", () => {
			const result = classifyComplexity({ messages: [] });
			expect(result.complexity).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0.5);
			expect(result.confidence).toBeLessThanOrEqual(1.0);
		});
	});

	describe("StreamOptions forwarding", () => {
		it("should accept optional StreamOptions without error", () => {
			const opts: StreamOptions = { maxTokens: 1024, temperature: 0.5 };
			const result = classifyComplexity(ctx("hello"), opts);
			expect(result.complexity).toBeDefined();
		});
	});
});
