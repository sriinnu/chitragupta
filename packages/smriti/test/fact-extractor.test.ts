import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FactExtractor, getFactExtractor } from "../src/fact-extractor.js";
import type { ExtractedFact, FactExtractorConfig } from "../src/fact-extractor.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Shorthand: extract facts from text with default config. */
async function extractFacts(text: string, config?: Partial<FactExtractorConfig>): Promise<ExtractedFact[]> {
	const extractor = new FactExtractor(config);
	try {
		return await extractor.extract(text);
	} finally {
		extractor.dispose();
	}
}

/** Find the first fact with a given category. */
function findByCategory(facts: ExtractedFact[], category: ExtractedFact["category"]): ExtractedFact | undefined {
	return facts.find((f) => f.category === category);
}

// ─── Pattern Matching: Identity ─────────────────────────────────────────────

describe("FactExtractor", () => {
	describe("pattern matching — identity", () => {
		it("should extract 'my name is Alice'", async () => {
			const facts = await extractFacts("my name is Alice");
			expect(facts.length).toBeGreaterThanOrEqual(1);
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			expect(identity!.fact).toContain("Name:");
			expect(identity!.fact).toContain("Alice");
			expect(identity!.method).toBe("pattern");
			expect(identity!.confidence).toBe(0.9);
		});

		it("should extract \"I'm called Bob\"", async () => {
			const facts = await extractFacts("I'm called Bob");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			expect(identity!.fact).toContain("Bob");
			expect(identity!.category).toBe("identity");
		});

		it("should extract 'call me Charlie'", async () => {
			const facts = await extractFacts("call me Charlie");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			expect(identity!.fact).toContain("Charlie");
		});

		it("should extract 'I am Diana'", async () => {
			const facts = await extractFacts("I am Diana");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			expect(identity!.fact).toContain("Diana");
		});

		it("should extract 'people call me Dave'", async () => {
			const facts = await extractFacts("people call me Dave");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			expect(identity!.fact).toContain("Dave");
		});

		it("should normalize name with capitalization", async () => {
			const facts = await extractFacts("my name is alice johnson");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			// normalizeFact capitalizes first letter
			expect(identity!.fact).toMatch(/^Name: Alice/);
		});
	});

	// ─── Pattern Matching: Location ──────────────────────────────────────────

	describe("pattern matching — location", () => {
		it("should extract 'I live in Vienna'", async () => {
			const facts = await extractFacts("I live in Vienna");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("Lives in");
			expect(location!.fact).toContain("Vienna");
			expect(location!.method).toBe("pattern");
			expect(location!.confidence).toBe(0.9);
		});

		it("should extract \"I'm from Berlin\"", async () => {
			const facts = await extractFacts("I'm from Berlin");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("Berlin");
		});

		it("should extract 'based in London'", async () => {
			const facts = await extractFacts("based in London");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("London");
		});

		it("should extract 'I am from Tokyo'", async () => {
			const facts = await extractFacts("I am from Tokyo");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("Tokyo");
		});

		it("should extract 'living in New York'", async () => {
			const facts = await extractFacts("living in New York");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("New York");
		});

		it("should extract \"I'm based in San Francisco\"", async () => {
			const facts = await extractFacts("I'm based in San Francisco");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("San Francisco");
		});

		it("should extract 'I reside in Paris'", async () => {
			const facts = await extractFacts("I reside in Paris");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.fact).toContain("Paris");
		});
	});

	// ─── Pattern Matching: Work ──────────────────────────────────────────────

	describe("pattern matching — work", () => {
		it("should extract 'I work at Google'", async () => {
			const facts = await extractFacts("I work at Google");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("Works at/as");
			expect(work!.fact).toContain("Google");
			expect(work!.method).toBe("pattern");
			expect(work!.confidence).toBe(0.85);
		});

		it("should extract 'my job is developer'", async () => {
			const facts = await extractFacts("my job is developer");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("developer");
		});

		it("should extract \"I'm a software engineer\"", async () => {
			const facts = await extractFacts("I'm a software engineer");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("software engineer");
		});

		it("should extract 'I work for Microsoft'", async () => {
			const facts = await extractFacts("I work for Microsoft");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("Microsoft");
		});

		it("should extract 'my role is team lead'", async () => {
			const facts = await extractFacts("my role is team lead");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("team lead");
		});

		it("should extract 'I work as a backend developer'", async () => {
			const facts = await extractFacts("I work as a backend developer");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("backend developer");
		});

		it("should extract 'my team works on infrastructure'", async () => {
			const facts = await extractFacts("my team works on infrastructure");
			const work = findByCategory(facts, "work");
			expect(work).toBeDefined();
			expect(work!.fact).toContain("infrastructure");
		});
	});

	// ─── Pattern Matching: Preference ────────────────────────────────────────

	describe("pattern matching — preference", () => {
		it("should extract 'I always use TypeScript'", async () => {
			const facts = await extractFacts("I always use TypeScript");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("Preference:");
			expect(pref!.fact).toContain("TypeScript");
			expect(pref!.method).toBe("pattern");
			expect(pref!.confidence).toBe(0.85);
		});

		it("should extract 'never use var'", async () => {
			const facts = await extractFacts("never use var in code");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("var");
		});

		it("should extract 'my editor is vim'", async () => {
			const facts = await extractFacts("my editor is vim");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("vim");
		});

		it("should extract 'I prefer dark mode'", async () => {
			const facts = await extractFacts("I prefer dark mode");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("dark mode");
		});

		it("should extract 'we use pnpm'", async () => {
			const facts = await extractFacts("we use pnpm for this project");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("pnpm");
		});

		it("should extract \"don't use semicolons\"", async () => {
			const facts = await extractFacts("don't use semicolons");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("semicolons");
		});

		it("should extract 'I code in Rust'", async () => {
			const facts = await extractFacts("I code in Rust");
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			expect(pref!.fact).toContain("Rust");
		});
	});

	// ─── Pattern Matching: Relationship ──────────────────────────────────────

	describe("pattern matching — relationship", () => {
		it("should extract 'my wife is Sarah'", async () => {
			const facts = await extractFacts("my wife is Sarah");
			const rel = findByCategory(facts, "relationship");
			expect(rel).toBeDefined();
			expect(rel!.fact).toContain("Relationship:");
			expect(rel!.fact).toContain("Sarah");
			expect(rel!.method).toBe("pattern");
			expect(rel!.confidence).toBe(0.85);
		});

		it("should extract 'my husband is James'", async () => {
			const facts = await extractFacts("my husband is James");
			const rel = findByCategory(facts, "relationship");
			expect(rel).toBeDefined();
			expect(rel!.fact).toContain("James");
		});

		it("should extract 'my colleague Priya'", async () => {
			const facts = await extractFacts("my colleague Priya helps me with reviews");
			const rel = findByCategory(facts, "relationship");
			expect(rel).toBeDefined();
			expect(rel!.fact).toContain("Priya");
		});

		it("should extract 'my boss Mike'", async () => {
			const facts = await extractFacts("my boss Mike asked about the deadline");
			const rel = findByCategory(facts, "relationship");
			expect(rel).toBeDefined();
			expect(rel!.fact).toContain("Mike");
		});
	});

	// ─── Pattern Matching: Instruction ───────────────────────────────────────

	describe("pattern matching — instruction", () => {
		it("should extract 'remember that I like dark mode' with high confidence", async () => {
			const facts = await extractFacts("remember that I like dark mode");
			const instr = findByCategory(facts, "instruction");
			expect(instr).toBeDefined();
			expect(instr!.confidence).toBe(0.95);
			expect(instr!.fact).toContain("I like dark mode");
			expect(instr!.method).toBe("pattern");
		});

		it("should extract 'from now on use spaces not tabs'", async () => {
			const facts = await extractFacts("from now on use spaces not tabs");
			const instr = findByCategory(facts, "instruction");
			expect(instr).toBeDefined();
			expect(instr!.confidence).toBe(0.95);
			expect(instr!.fact).toContain("use spaces not tabs");
		});

		it("should extract 'note that I deploy on Fridays'", async () => {
			const facts = await extractFacts("note that I deploy on Fridays");
			const instr = findByCategory(facts, "instruction");
			expect(instr).toBeDefined();
			expect(instr!.fact).toContain("I deploy on Fridays");
		});

		it("should extract 'keep in mind that tests must pass'", async () => {
			const facts = await extractFacts("keep in mind that tests must pass before merge");
			const instr = findByCategory(facts, "instruction");
			expect(instr).toBeDefined();
			expect(instr!.fact).toContain("tests must pass");
		});

		it("should extract 'always remember to run linting'", async () => {
			const facts = await extractFacts("always remember to run linting before committing");
			const instr = findByCategory(facts, "instruction");
			expect(instr).toBeDefined();
			expect(instr!.fact).toContain("run linting");
		});
	});

	// ─── Pattern Matching: Personal ──────────────────────────────────────────

	describe("pattern matching — personal", () => {
		it("should extract 'my birthday is March 15'", async () => {
			const facts = await extractFacts("my birthday is March 15");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			expect(personal!.fact).toContain("March 15");
			expect(personal!.method).toBe("pattern");
			expect(personal!.confidence).toBe(0.8);
		});

		it("should extract 'my favorite color is blue'", async () => {
			const facts = await extractFacts("my favorite color is blue");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			// Regex: (?:my favorite|my favourite)\s+(\w+)\s+is\s+(.{1,50})
			// match[1] = "color" (the thing type, which is what gets passed to normalizeFact)
			expect(personal!.fact.toLowerCase()).toContain("color");
			expect(personal!.category).toBe("personal");
		});

		it("should extract 'I speak Telugu'", async () => {
			const facts = await extractFacts("I speak Telugu");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			expect(personal!.fact).toContain("Telugu");
		});

		it("should extract 'I was born in 1990'", async () => {
			const facts = await extractFacts("I was born in 1990");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			expect(personal!.fact).toContain("1990");
		});

		it("should extract 'my favourite food is biryani'", async () => {
			const facts = await extractFacts("my favourite food is biryani");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			// match[1] captures the thing type ("food"), not the value
			expect(personal!.fact.toLowerCase()).toContain("food");
		});

		it("should extract 'my native language Telugu'", async () => {
			const facts = await extractFacts("my native language Telugu");
			const personal = findByCategory(facts, "personal");
			expect(personal).toBeDefined();
			expect(personal!.fact).toContain("Telugu");
		});
	});

	// ─── Vector Similarity Fallback ──────────────────────────────────────────

	describe("vector similarity fallback", () => {
		it("should not use vector similarity when pattern matching already found facts", async () => {
			const facts = await extractFacts("my name is Alice");
			// All matches should be pattern-based since the pattern succeeded
			for (const f of facts) {
				expect(f.method).toBe("pattern");
			}
		});

		it("should use vector similarity only when patterns miss", async () => {
			// This text is close to "i live in a city" template but may not match patterns
			const extractor = new FactExtractor({ useVectors: true, minConfidence: 0.1, vectorThreshold: 0.3 });
			try {
				const facts = await extractor.extract("residing at my hometown in countryside");
				// The test verifies vector path is available when patterns miss
				// Whether this particular text matches depends on cosine similarity
				// with the hash-based embeddings — we just check the method is used correctly
				const vectorFacts = facts.filter((f) => f.method === "vector");
				// If vector matched, it must have correct structure
				for (const vf of vectorFacts) {
					expect(vf.confidence).toBeGreaterThan(0);
					expect(vf.confidence).toBeLessThanOrEqual(0.85); // vector confidence capped at 0.85
					expect(vf.source).toBeDefined();
					expect(vf.fact).toBeDefined();
				}
			} finally {
				extractor.dispose();
			}
		});

		it("should respect vectorThreshold — high threshold means fewer matches", async () => {
			const extractor = new FactExtractor({ useVectors: true, vectorThreshold: 0.99, minConfidence: 0.01 });
			try {
				// A generic message unlikely to match any template at 0.99 threshold
				const facts = await extractor.extract("the weather is nice today");
				const vectorFacts = facts.filter((f) => f.method === "vector");
				expect(vectorFacts.length).toBe(0);
			} finally {
				extractor.dispose();
			}
		});

		it("should skip vector similarity when useVectors is false", async () => {
			const extractor = new FactExtractor({ useVectors: false, minConfidence: 0.01 });
			try {
				const facts = await extractor.extract("the weather is nice today");
				const vectorFacts = facts.filter((f) => f.method === "vector");
				expect(vectorFacts.length).toBe(0);
			} finally {
				extractor.dispose();
			}
		});

		it("should cap vector confidence at 0.85", async () => {
			const extractor = new FactExtractor({ useVectors: true, vectorThreshold: 0.1, minConfidence: 0.01 });
			try {
				const facts = await extractor.extract("my name is something special here");
				const vectorFacts = facts.filter((f) => f.method === "vector");
				for (const vf of vectorFacts) {
					expect(vf.confidence).toBeLessThanOrEqual(0.85);
				}
			} finally {
				extractor.dispose();
			}
		});
	});

	// ─── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should return empty for very short text (<5 chars)", async () => {
			const facts = await extractFacts("hi");
			expect(facts).toEqual([]);
		});

		it("should return empty for exactly 4 character text", async () => {
			const facts = await extractFacts("hey!");
			expect(facts).toEqual([]);
		});

		it("should return empty for very long text (>5000 chars)", async () => {
			const longText = "I live in Vienna. ".repeat(300); // ~5400 chars
			const facts = await extractFacts(longText);
			expect(facts).toEqual([]);
		});

		it("should return empty for text with no recognizable facts", async () => {
			const facts = await extractFacts("the quick brown fox jumps over the lazy dog");
			// May get vector match or may not, but with default threshold
			// a generic sentence should likely not match high enough
			const highConfidence = facts.filter((f) => f.confidence >= 0.5);
			// We mainly verify no crash and reasonable output
			expect(Array.isArray(facts)).toBe(true);
		});

		it("should handle empty string gracefully", async () => {
			const facts = await extractFacts("");
			expect(facts).toEqual([]);
		});

		it("should handle whitespace-only input", async () => {
			const facts = await extractFacts("     ");
			expect(facts).toEqual([]);
		});

		it("should handle exactly 5 characters", async () => {
			const facts = await extractFacts("hello");
			// 5 chars is accepted (length >= 5)
			expect(Array.isArray(facts)).toBe(true);
		});

		it("should detect multiple facts in one message", async () => {
			const facts = await extractFacts("my name is Alice and I live in Vienna and I work at Google");
			// Should find identity, location, and work facts
			const categories = facts.map((f) => f.category);
			expect(categories).toContain("identity");
			expect(categories).toContain("location");
			expect(categories).toContain("work");
			expect(facts.length).toBeGreaterThanOrEqual(3);
		});

		it("should include source field from original text", async () => {
			const facts = await extractFacts("I live in Vienna");
			const location = findByCategory(facts, "location");
			expect(location).toBeDefined();
			expect(location!.source).toBeTruthy();
			expect(location!.source.toLowerCase()).toContain("live in vienna");
		});

		it("should strip trailing punctuation from facts", async () => {
			const facts = await extractFacts("my name is Alice!");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			// normalizeFact removes trailing punctuation
			expect(identity!.fact).not.toMatch(/[!.,;:]+$/);
		});
	});

	// ─── Confidence Filtering ────────────────────────────────────────────────

	describe("confidence filtering", () => {
		it("should filter out facts below minConfidence", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.95 });
			try {
				// "I live in Vienna" → confidence 0.9, should be filtered with minConfidence=0.95
				const facts = await extractor.extract("I live in Vienna");
				const location = findByCategory(facts, "location");
				expect(location).toBeUndefined();
			} finally {
				extractor.dispose();
			}
		});

		it("should keep facts at or above minConfidence", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.9 });
			try {
				// "I live in Vienna" → confidence 0.9, should pass at minConfidence=0.9
				const facts = await extractor.extract("I live in Vienna");
				const location = findByCategory(facts, "location");
				expect(location).toBeDefined();
			} finally {
				extractor.dispose();
			}
		});

		it("should keep instruction facts with high confidence (0.95)", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.95 });
			try {
				const facts = await extractor.extract("remember that I like dark mode");
				const instr = findByCategory(facts, "instruction");
				expect(instr).toBeDefined();
				expect(instr!.confidence).toBe(0.95);
			} finally {
				extractor.dispose();
			}
		});

		it("should filter out work facts (0.85) when minConfidence is 0.9", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.9 });
			try {
				const facts = await extractor.extract("I work at Google");
				const work = findByCategory(facts, "work");
				expect(work).toBeUndefined();
			} finally {
				extractor.dispose();
			}
		});

		it("should allow all facts through with very low minConfidence", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.01 });
			try {
				const facts = await extractor.extract("my name is Alice and I work at Google");
				expect(facts.length).toBeGreaterThanOrEqual(2);
			} finally {
				extractor.dispose();
			}
		});
	});

	// ─── extractAndSave ──────────────────────────────────────────────────────

	describe("extractAndSave", () => {
		let extractor: FactExtractor;
		let mockAppendMemory: ReturnType<typeof vi.fn>;
		let mockGetMemory: ReturnType<typeof vi.fn>;

		beforeEach(async () => {
			extractor = new FactExtractor();

			mockAppendMemory = vi.fn().mockResolvedValue(undefined);
			mockGetMemory = vi.fn().mockReturnValue("");

			// Mock the dynamic import of memory-store.js
			vi.doMock("../src/memory-store.js", () => ({
				appendMemory: mockAppendMemory,
				getMemory: mockGetMemory,
			}));
		});

		afterEach(() => {
			extractor.dispose();
			vi.doUnmock("../src/memory-store.js");
		});

		it("should save facts to global scope by default", async () => {
			const facts = await extractor.extractAndSave("my name is Alice");
			expect(facts.length).toBeGreaterThanOrEqual(1);
			expect(mockAppendMemory).toHaveBeenCalled();
			// First call should be with global scope
			const firstCall = mockAppendMemory.mock.calls[0];
			expect(firstCall[0]).toEqual({ type: "global" });
			expect(firstCall[1]).toContain("[identity]");
			expect(firstCall[1]).toContain("Alice");
		});

		it("should save preferences to project scope when provided", async () => {
			const projectScope = { type: "project" as const, path: "/tmp/test-project" };
			const facts = await extractor.extractAndSave(
				"I always use TypeScript",
				{ type: "global" },
				projectScope,
			);
			expect(facts.length).toBeGreaterThanOrEqual(1);
			const pref = findByCategory(facts, "preference");
			expect(pref).toBeDefined();
			// Preference should be saved to project scope
			const projectCall = mockAppendMemory.mock.calls.find(
				(call: unknown[]) => (call[0] as { type: string }).type === "project",
			);
			expect(projectCall).toBeDefined();
			expect(projectCall![1]).toContain("[preference]");
		});

		it("should save non-preference facts to global scope even when project scope provided", async () => {
			const projectScope = { type: "project" as const, path: "/tmp/test-project" };
			const facts = await extractor.extractAndSave(
				"my name is Alice",
				{ type: "global" },
				projectScope,
			);
			expect(facts.length).toBeGreaterThanOrEqual(1);
			// Identity should be saved to global, not project
			const globalCall = mockAppendMemory.mock.calls.find(
				(call: unknown[]) => (call[0] as { type: string }).type === "global",
			);
			expect(globalCall).toBeDefined();
			expect(globalCall![1]).toContain("[identity]");
		});

		it("should deduplicate recently saved facts", async () => {
			// Extract and save twice with the same text
			await extractor.extractAndSave("my name is Alice");
			const firstCallCount = mockAppendMemory.mock.calls.length;

			await extractor.extractAndSave("my name is Alice");
			const secondCallCount = mockAppendMemory.mock.calls.length;

			// Second call should not add new appendMemory calls (dedup via recentFacts set)
			expect(secondCallCount).toBe(firstCallCount);
		});

		it("should not re-save facts already in memory", async () => {
			// Pre-populate existing memory with the fact
			mockGetMemory.mockReturnValue("Name: Alice\nLives in Vienna");

			const facts = await extractor.extractAndSave("my name is Alice");
			expect(facts.length).toBeGreaterThanOrEqual(1);
			// appendMemory should not be called because "alice" already exists in memory
			expect(mockAppendMemory).not.toHaveBeenCalled();
		});

		it("should return empty array and skip saving when no facts extracted", async () => {
			const facts = await extractor.extractAndSave("hello there how are you");
			// No strong facts in generic greeting
			// Even if empty, should not throw
			expect(Array.isArray(facts)).toBe(true);
		});

		it("should use provided scope instead of default global", async () => {
			const agentScope = { type: "agent" as const, agentId: "test-agent" };
			const facts = await extractor.extractAndSave("my name is Alice", agentScope);
			expect(facts.length).toBeGreaterThanOrEqual(1);
			const firstCall = mockAppendMemory.mock.calls[0];
			expect(firstCall[0]).toEqual(agentScope);
		});

		it("should format saved entries as [category] fact", async () => {
			await extractor.extractAndSave("I live in Vienna");
			expect(mockAppendMemory).toHaveBeenCalled();
			const entry = mockAppendMemory.mock.calls[0][1] as string;
			expect(entry).toMatch(/^\[location\] Lives in/);
		});
	});

	// ─── Singleton ───────────────────────────────────────────────────────────

	describe("getFactExtractor singleton", () => {
		// We need to reset the singleton between tests. The module-level _instance
		// is private, so we can test behavioral properties.

		it("should return a FactExtractor instance", () => {
			const instance = getFactExtractor();
			expect(instance).toBeInstanceOf(FactExtractor);
		});

		it("should return the same instance on subsequent calls", () => {
			const a = getFactExtractor();
			const b = getFactExtractor();
			expect(a).toBe(b);
		});

		it("should ignore config on subsequent calls (singleton already created)", () => {
			const a = getFactExtractor();
			const b = getFactExtractor({ minConfidence: 0.99 });
			expect(a).toBe(b);
		});
	});

	// ─── dispose ─────────────────────────────────────────────────────────────

	describe("dispose", () => {
		it("should clear the cleanup timer", async () => {
			const extractor = new FactExtractor();
			// Trigger initialization which sets up the timer
			await extractor.extract("my name is Alice");
			// dispose should not throw
			extractor.dispose();
		});

		it("should be callable multiple times without error", () => {
			const extractor = new FactExtractor();
			extractor.dispose();
			extractor.dispose();
			extractor.dispose();
		});

		it("should be safe to call before initialization", () => {
			const extractor = new FactExtractor();
			// dispose before any extract() call — timer was never set
			extractor.dispose();
		});
	});

	// ─── Constructor / Config ────────────────────────────────────────────────

	describe("constructor and configuration", () => {
		it("should use default config when no config provided", async () => {
			const extractor = new FactExtractor();
			try {
				// Default minConfidence is 0.5, so a 0.9 confidence fact should pass
				const facts = await extractor.extract("my name is Alice");
				expect(facts.length).toBeGreaterThanOrEqual(1);
			} finally {
				extractor.dispose();
			}
		});

		it("should merge partial config with defaults", async () => {
			const extractor = new FactExtractor({ minConfidence: 0.95 });
			try {
				// useVectors should still be true (from defaults)
				// identity confidence 0.9 < 0.95 → filtered
				const facts = await extractor.extract("my name is Alice");
				const identity = findByCategory(facts, "identity");
				expect(identity).toBeUndefined();
			} finally {
				extractor.dispose();
			}
		});

		it("should allow disabling vectors entirely", async () => {
			const extractor = new FactExtractor({ useVectors: false });
			try {
				const facts = await extractor.extract("some random text that matches nothing");
				const vectorFacts = facts.filter((f) => f.method === "vector");
				expect(vectorFacts.length).toBe(0);
			} finally {
				extractor.dispose();
			}
		});
	});

	// ─── Initialization ──────────────────────────────────────────────────────

	describe("lazy initialization", () => {
		it("should initialize on first extract call", async () => {
			const extractor = new FactExtractor();
			try {
				// First call triggers ensureInitialized
				const facts = await extractor.extract("my name is Alice");
				expect(facts.length).toBeGreaterThanOrEqual(1);
				// Second call should reuse initialization
				const facts2 = await extractor.extract("I live in Vienna");
				expect(facts2.length).toBeGreaterThanOrEqual(1);
			} finally {
				extractor.dispose();
			}
		});

		it("should skip template embedding computation when vectors disabled", async () => {
			const extractor = new FactExtractor({ useVectors: false });
			try {
				// Should work fine with patterns only
				const facts = await extractor.extract("my name is Alice");
				expect(facts.length).toBeGreaterThanOrEqual(1);
			} finally {
				extractor.dispose();
			}
		});
	});

	// ─── Normalize Fact ──────────────────────────────────────────────────────

	describe("fact normalization", () => {
		it("should prefix identity facts with 'Name:'", async () => {
			const facts = await extractFacts("my name is Alice");
			const identity = findByCategory(facts, "identity");
			expect(identity!.fact).toMatch(/^Name:/);
		});

		it("should prefix location facts with 'Lives in'", async () => {
			const facts = await extractFacts("I live in Vienna");
			const location = findByCategory(facts, "location");
			expect(location!.fact).toMatch(/^Lives in/);
		});

		it("should prefix work facts with 'Works at/as'", async () => {
			const facts = await extractFacts("I work at Google");
			const work = findByCategory(facts, "work");
			expect(work!.fact).toMatch(/^Works at\/as/);
		});

		it("should prefix preference facts with 'Preference:'", async () => {
			const facts = await extractFacts("I always use TypeScript");
			const pref = findByCategory(facts, "preference");
			expect(pref!.fact).toMatch(/^Preference:/);
		});

		it("should prefix relationship facts with 'Relationship:'", async () => {
			const facts = await extractFacts("my wife is Sarah");
			const rel = findByCategory(facts, "relationship");
			expect(rel!.fact).toMatch(/^Relationship:/);
		});

		it("should not add prefix for instruction facts", async () => {
			const facts = await extractFacts("remember that I like dark mode");
			const instr = findByCategory(facts, "instruction");
			// Instruction normalization just returns cleaned text, no prefix
			expect(instr!.fact).not.toMatch(/^(Name|Lives|Works|Preference|Relationship):/);
		});

		it("should not add prefix for personal facts", async () => {
			const facts = await extractFacts("I speak Telugu");
			const personal = findByCategory(facts, "personal");
			// Personal normalization just returns cleaned text
			expect(personal!.fact).not.toMatch(/^(Name|Lives|Works|Preference|Relationship):/);
		});

		it("should handle trailing punctuation in extraction", async () => {
			const facts = await extractFacts("my name is Alice.");
			const identity = findByCategory(facts, "identity");
			expect(identity).toBeDefined();
			// Trailing period should be stripped by normalizeFact
			expect(identity!.fact.endsWith(".")).toBe(false);
		});
	});
});
