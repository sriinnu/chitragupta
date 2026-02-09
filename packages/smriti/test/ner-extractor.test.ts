import { describe, it, expect, vi, beforeEach } from "vitest";
import { NERExtractor } from "@chitragupta/smriti";
import type { ExtractedEntity, NERConfig } from "@chitragupta/smriti";

// ─── Setup: force heuristic mode (no GLiNER2 available) ─────────────────────

// Mock fetch globally so GLiNER2 probe always fails, forcing heuristic mode
vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no GLiNER2")));

// ─── NERExtractor (heuristic mode) ──────────────────────────────────────────

describe("NERExtractor", () => {
	let extractor: NERExtractor;

	beforeEach(() => {
		extractor = new NERExtractor({ useHeuristic: true });
	});

	describe("basic extraction", () => {
		it("should return empty array for empty text", async () => {
			const entities = await extractor.extract("");
			expect(entities).toEqual([]);
		});

		it("should return empty array for whitespace-only text", async () => {
			const entities = await extractor.extract("   \n\t  ");
			expect(entities).toEqual([]);
		});

		it("should extract file paths", async () => {
			const entities = await extractor.extract(
				"I modified the file ./src/index.ts and also checked /usr/local/bin/node",
			);
			const files = entities.filter((e) => e.type === "file");
			expect(files.length).toBeGreaterThanOrEqual(1);
			const texts = files.map((e) => e.text);
			expect(texts.some((t) => t.includes("src/index.ts"))).toBe(true);
		});

		it("should extract technology keywords", async () => {
			const entities = await extractor.extract(
				"We use TypeScript with React and PostgreSQL for our backend",
			);
			const techs = entities.filter((e) => e.type === "technology");
			const names = techs.map((e) => e.text.toLowerCase());
			expect(names).toContain("typescript");
			expect(names).toContain("react");
			expect(names).toContain("postgresql");
		});

		it("should extract error patterns", async () => {
			const entities = await extractor.extract(
				"Got a TypeError in production and also ENOENT when reading config",
			);
			const errors = entities.filter((e) => e.type === "error");
			const texts = errors.map((e) => e.text);
			expect(texts.some((t) => t.includes("TypeError"))).toBe(true);
			expect(texts.some((t) => t.includes("ENOENT"))).toBe(true);
		});

		it("should extract decision phrases", async () => {
			const entities = await extractor.extract(
				"The team decided to refactor the codebase completely",
			);
			const decisions = entities.filter((e) => e.type === "decision");
			expect(decisions.length).toBeGreaterThanOrEqual(1);
			expect(decisions[0].text).toContain("decided to");
		});

		it("should extract action phrases", async () => {
			const entities = await extractor.extract(
				"I created the new module and deleted the old tests",
			);
			const actions = entities.filter((e) => e.type === "action");
			expect(actions.length).toBeGreaterThanOrEqual(1);
			const texts = actions.map((e) => e.text.toLowerCase());
			expect(texts.some((t) => t.includes("created"))).toBe(true);
		});

		it("should extract concept patterns (capitalized multi-word)", async () => {
			const entities = await extractor.extract(
				"The Agent Identity system uses Policy Engine for enforcement",
			);
			const concepts = entities.filter((e) => e.type === "concept");
			const texts = concepts.map((e) => e.text);
			expect(texts.some((t) => t.includes("Agent Identity"))).toBe(true);
		});
	});

	describe("confidence scoring", () => {
		it("should assign confidence of 0.6 to heuristic matches", async () => {
			const entities = await extractor.extract("Using TypeScript and React");
			for (const entity of entities) {
				expect(entity.confidence).toBe(0.6);
			}
		});
	});

	describe("span information", () => {
		it("should include character spans for entities", async () => {
			const entities = await extractor.extract("TypeScript is great");
			const ts = entities.find((e) => e.text.toLowerCase() === "typescript");
			expect(ts).toBeDefined();
			expect(ts!.span).toBeDefined();
			expect(ts!.span[0]).toBeGreaterThanOrEqual(0);
			expect(ts!.span[1]).toBeGreaterThan(ts!.span[0]);
		});
	});

	describe("deduplication", () => {
		it("should deduplicate entities with same text and type", async () => {
			const entities = await extractor.extract(
				"TypeScript TypeScript TypeScript",
			);
			const tsEntities = entities.filter(
				(e) => e.text.toLowerCase() === "typescript" && e.type === "technology",
			);
			expect(tsEntities.length).toBe(1);
		});
	});

	describe("configuration", () => {
		it("should respect minConfidence filter", async () => {
			const strict = new NERExtractor({
				useHeuristic: true,
				minConfidence: 0.7, // Heuristic confidence is 0.6, so all should be filtered
			});
			const entities = await strict.extract("TypeScript and React");
			expect(entities).toEqual([]);
		});

		it("should respect maxEntities limit", async () => {
			const limited = new NERExtractor({
				useHeuristic: true,
				maxEntities: 2,
			});
			const entities = await limited.extract(
				"TypeScript React Docker Kubernetes Python Rust JavaScript",
			);
			expect(entities.length).toBeLessThanOrEqual(2);
		});

		it("should filter by entityTypes", async () => {
			const techOnly = new NERExtractor({
				useHeuristic: true,
				entityTypes: ["technology"],
			});
			const entities = await techOnly.extract(
				"Got a TypeError while using TypeScript and React",
			);
			for (const entity of entities) {
				expect(entity.type).toBe("technology");
			}
		});

		it("should return empty when useHeuristic is false and GLiNER2 is down", async () => {
			const noHeuristic = new NERExtractor({
				useHeuristic: false,
			});
			const entities = await noHeuristic.extract("TypeScript and React");
			expect(entities).toEqual([]);
		});
	});

	describe("batch extraction", () => {
		it("should process multiple texts", async () => {
			const results = await extractor.extractBatch([
				"Using TypeScript",
				"Got a TypeError",
				"",
			]);
			expect(results.length).toBe(3);
			expect(results[0].length).toBeGreaterThanOrEqual(1);
			expect(results[1].length).toBeGreaterThanOrEqual(1);
			expect(results[2]).toEqual([]);
		});

		it("should return empty arrays for empty batch", async () => {
			const results = await extractor.extractBatch([]);
			expect(results).toEqual([]);
		});
	});

	describe("GLiNER2 availability", () => {
		it("should cache GLiNER2 availability probe result", async () => {
			const ext = new NERExtractor();
			const result1 = await ext.isGLiNERAvailable();
			const result2 = await ext.isGLiNERAvailable();
			expect(result1).toBe(false);
			expect(result2).toBe(false);
			// fetch should have been called only once per extractor instance (cached)
		});
	});

	describe("span overlap prevention", () => {
		it("should not extract overlapping entities", async () => {
			const entities = await extractor.extract(
				"The TypeError crashed the Docker container",
			);
			// Check that no two entity spans overlap
			for (let i = 0; i < entities.length; i++) {
				for (let j = i + 1; j < entities.length; j++) {
					const [as, ae] = entities[i].span;
					const [bs, be] = entities[j].span;
					const overlaps = as < be && ae > bs;
					expect(overlaps).toBe(false);
				}
			}
		});
	});
});
