import { describe, it, expect, vi, afterEach } from "vitest";
import { semanticChunk, llmExtractEntities, keywordExtractEntities } from "../src/graphrag-extraction.js";

describe("graphrag-extraction", () => {

	// ── semanticChunk ───────────────────────────────────────────────────

	describe("semanticChunk", () => {
		it("returns empty array for empty text", () => {
			expect(semanticChunk("")).toEqual([]);
		});

		it("returns single chunk for short text", () => {
			const text = "This is a short sentence. Another short one.";
			const chunks = semanticChunk(text);
			expect(chunks).toHaveLength(1);
			expect(chunks[0].startSentence).toBe(0);
		});

		it("single chunk contains the full text for short input", () => {
			const text = "Hello world. This is a test.";
			const chunks = semanticChunk(text);
			expect(chunks).toHaveLength(1);
			expect(chunks[0].text).toBe(text);
		});

		it("returns multiple chunks for long text", () => {
			// Generate a text longer than CHUNK_MAX_TOKENS (500 words)
			const sentences: string[] = [];
			for (let i = 0; i < 100; i++) {
				sentences.push(`This is sentence number ${i} which has some words in it to pad the length.`);
			}
			const text = sentences.join(" ");
			const chunks = semanticChunk(text);
			expect(chunks.length).toBeGreaterThan(1);
		});

		it("chunks have startSentence and endSentence", () => {
			const sentences: string[] = [];
			for (let i = 0; i < 100; i++) {
				sentences.push(`Sentence ${i} has some padding words to fill the token budget nicely here.`);
			}
			const text = sentences.join(" ");
			const chunks = semanticChunk(text);
			for (const chunk of chunks) {
				expect(chunk.startSentence).toBeGreaterThanOrEqual(0);
				expect(chunk.endSentence).toBeGreaterThanOrEqual(chunk.startSentence);
			}
		});

		it("first chunk starts at sentence 0", () => {
			const sentences: string[] = [];
			for (let i = 0; i < 100; i++) {
				sentences.push(`Sentence ${i} has padding words to fill the budget and force multiple chunks here now.`);
			}
			const text = sentences.join(" ");
			const chunks = semanticChunk(text);
			expect(chunks[0].startSentence).toBe(0);
		});

		it("chunks overlap (later chunk starts before previous chunk ends)", () => {
			const sentences: string[] = [];
			for (let i = 0; i < 100; i++) {
				sentences.push(`Sentence ${i} padding words to fill token budget and force overlapping chunks here.`);
			}
			const text = sentences.join(" ");
			const chunks = semanticChunk(text);
			if (chunks.length >= 2) {
				// Second chunk should start before or at the end of the first
				expect(chunks[1].startSentence).toBeLessThanOrEqual(chunks[0].endSentence);
			}
		});

		it("handles text with no sentence boundaries", () => {
			const text = "just one long text without any ending punctuation followed by uppercase";
			const chunks = semanticChunk(text);
			expect(chunks.length).toBeGreaterThanOrEqual(1);
		});

		it("handles text with only whitespace after filtering", () => {
			const text = "   ";
			const chunks = semanticChunk(text);
			// After splitting on sentences, all empty => no chunks
			expect(chunks).toEqual([]);
		});

		it("all chunks contain non-empty text", () => {
			const sentences: string[] = [];
			for (let i = 0; i < 80; i++) {
				sentences.push(`Sentence ${i} with enough words to ensure multiple chunks are created here.`);
			}
			const text = sentences.join(" ");
			const chunks = semanticChunk(text);
			for (const chunk of chunks) {
				expect(chunk.text.length).toBeGreaterThan(0);
			}
		});
	});

	// ── keywordExtractEntities ──────────────────────────────────────────

	describe("keywordExtractEntities", () => {
		it("returns empty array for empty text", () => {
			expect(keywordExtractEntities("")).toEqual([]);
		});

		it("returns empty array for short unique words", () => {
			expect(keywordExtractEntities("hi lo")).toEqual([]);
		});

		it("extracts words appearing at least twice", () => {
			const text = "typescript typescript javascript javascript python";
			const entities = keywordExtractEntities(text);
			const names = entities.map(e => e.name);
			expect(names).toContain("typescript");
			expect(names).toContain("javascript");
		});

		it("ignores words with 4 or fewer characters", () => {
			const text = "test test test code code code";
			const entities = keywordExtractEntities(text);
			const names = entities.map(e => e.name);
			// "test" and "code" are 4 chars, should be excluded (> 4 required)
			expect(names).not.toContain("test");
			expect(names).not.toContain("code");
		});

		it("ignores stop words", () => {
			const text = "would would would should should should";
			const entities = keywordExtractEntities(text);
			expect(entities).toEqual([]);
		});

		it("limits to max 20 entities", () => {
			const words: string[] = [];
			for (let i = 0; i < 30; i++) {
				const word = "keyword" + String(i).padStart(2, "0");
				words.push(word, word); // Each word appears twice
			}
			const entities = keywordExtractEntities(words.join(" "));
			expect(entities.length).toBeLessThanOrEqual(20);
		});

		it("sorts by frequency descending", () => {
			const text = "alpha alpha alpha alpha beta beta beta gamma gamma";
			const entities = keywordExtractEntities(text);
			const names = entities.map(e => e.name);
			expect(names[0]).toBe("alpha");
			if (names.length > 1) expect(names[1]).toBe("gamma");
		});

		it("all entities have type 'concept'", () => {
			const text = "typescript typescript javascript javascript";
			const entities = keywordExtractEntities(text);
			for (const e of entities) {
				expect(e.type).toBe("concept");
			}
		});

		it("entity description includes count", () => {
			const text = "react react react react";
			const entities = keywordExtractEntities(text);
			expect(entities[0].description).toContain("4");
		});

		it("removes punctuation before extracting", () => {
			const text = "typescript, typescript! javascript. javascript?";
			const entities = keywordExtractEntities(text);
			const names = entities.map(e => e.name);
			expect(names).toContain("typescript");
			expect(names).toContain("javascript");
		});

		it("lowercases all words", () => {
			const text = "TypeScript TypeScript JavaScript JavaScript";
			const entities = keywordExtractEntities(text);
			for (const e of entities) {
				expect(e.name).toBe(e.name.toLowerCase());
			}
		});
	});

	// ── llmExtractEntities ──────────────────────────────────────────────

	describe("llmExtractEntities", () => {
		const originalFetch = globalThis.fetch;
		afterEach(() => { globalThis.fetch = originalFetch; });

		it("returns parsed entities on valid response", async () => {
			const mockResponse = JSON.stringify([
				{ name: "TypeScript", type: "technology", description: "A language" },
				{ name: "React", type: "technology", description: "A framework" },
			]);
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: mockResponse }),
			});
			const entities = await llmExtractEntities("Some text about TypeScript and React", "http://localhost:11434", "llama3");
			expect(entities).toHaveLength(2);
			expect(entities[0].name).toBe("typescript");
			expect(entities[0].type).toBe("technology");
		});

		it("lowercases entity names", async () => {
			const mockResponse = JSON.stringify([{ name: "HELLO", type: "concept", description: "test" }]);
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: mockResponse }),
			});
			const entities = await llmExtractEntities("text", "http://localhost:11434", "llama3");
			expect(entities[0].name).toBe("hello");
		});

		it("throws on HTTP error", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
			await expect(llmExtractEntities("text", "http://localhost:11434", "llama3")).rejects.toThrow("503");
		});

		it("throws when response has no JSON array", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: "no json here" }),
			});
			await expect(llmExtractEntities("text", "http://localhost:11434", "llama3")).rejects.toThrow("JSON array");
		});

		it("handles response with surrounding text around JSON", async () => {
			const mockResponse = 'Here are the entities:\n[{"name":"test","type":"concept","description":"x"}]\nDone!';
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: mockResponse }),
			});
			const entities = await llmExtractEntities("text", "http://localhost:11434", "llama3");
			expect(entities).toHaveLength(1);
			expect(entities[0].name).toBe("test");
		});

		it("defaults type to 'concept' when missing", async () => {
			const mockResponse = JSON.stringify([{ name: "thing" }]);
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: mockResponse }),
			});
			const entities = await llmExtractEntities("text", "http://localhost:11434", "llama3");
			expect(entities[0].type).toBe("concept");
		});

		it("skips items without a name field", async () => {
			const mockResponse = JSON.stringify([{ type: "concept" }, { name: "valid", type: "topic", description: "ok" }]);
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ response: mockResponse }),
			});
			const entities = await llmExtractEntities("text", "http://localhost:11434", "llama3");
			expect(entities).toHaveLength(1);
			expect(entities[0].name).toBe("valid");
		});
	});
});
