/**
 * Tests for fact-extractor-ner.ts — pure regex NER layer.
 */

import { describe, it, expect } from "vitest";
import { extractNEREntities, jaccardNER } from "../src/fact-extractor-ner.js";

// ─── extractNEREntities ──────────────────────────────────────────────────────

describe("extractNEREntities", () => {
	describe("TECHNOLOGY", () => {
		it("detects known tech keywords", () => {
			const entities = extractNEREntities("We use TypeScript with React and PostgreSQL");
			const techs = entities.filter((e) => e.type === "TECHNOLOGY").map((e) => e.value);
			expect(techs).toContain("TypeScript");
			expect(techs).toContain("React");
			expect(techs).toContain("PostgreSQL");
		});

		it("detects versioned tech (React 18, Node.js 22)", () => {
			const entities = extractNEREntities("Upgraded to React 18 and Node.js 22 last week");
			const techs = entities.filter((e) => e.type === "TECHNOLOGY").map((e) => e.value);
			expect(techs.some((v) => v.includes("React 18") || v === "React")).toBe(true);
			expect(techs.some((v) => v.includes("Node.js"))).toBe(true);
		});

		it("assigns confidence 0.85 to tech entities", () => {
			const entities = extractNEREntities("Using Docker for deployment");
			const docker = entities.find((e) => e.value === "Docker");
			expect(docker).toBeDefined();
			expect(docker!.confidence).toBe(0.85);
			expect(docker!.source).toBe("ner");
		});

		it("does not false-positive on noise tokens", () => {
			const entities = extractNEREntities("I am using this right now");
			// "I", "this" etc. should NOT appear as tech
			const techs = entities.filter((e) => e.type === "TECHNOLOGY").map((e) => e.value);
			expect(techs).not.toContain("I");
			expect(techs).not.toContain("this");
		});
	});

	describe("PERSON", () => {
		it("detects titled names (Dr., Prof., Ms.)", () => {
			const entities = extractNEREntities("Dr. Sarah Chen presented the results");
			const persons = entities.filter((e) => e.type === "PERSON").map((e) => e.value);
			expect(persons.some((v) => v.includes("Sarah Chen"))).toBe(true);
		});

		it("assigns confidence 0.9 to titled names", () => {
			const entities = extractNEREntities("Prof. Alan Turing invented the computer");
			const titled = entities.find((e) => e.type === "PERSON" && e.confidence === 0.9);
			expect(titled).toBeDefined();
		});

		it("detects bare capitalized name sequences", () => {
			const entities = extractNEREntities("Asked about this, Alice Johnson replied");
			const persons = entities.filter((e) => e.type === "PERSON").map((e) => e.value);
			expect(persons.some((v) => v.includes("Alice Johnson"))).toBe(true);
		});

		it("filters out ALL-CAPS sequences as persons", () => {
			const entities = extractNEREntities("The API returned an ENOENT error");
			const persons = entities.filter((e) => e.type === "PERSON").map((e) => e.value);
			expect(persons).not.toContain("API");
			expect(persons).not.toContain("ENOENT");
		});
	});

	describe("PROJECT", () => {
		it("detects camelCase projects", () => {
			const entities = extractNEREntities("Working on chitraguptaDaemon and myProject");
			const projects = entities.filter((e) => e.type === "PROJECT").map((e) => e.value);
			expect(projects.some((v) => v.includes("chitraguptaDaemon") || v.includes("myProject"))).toBe(true);
		});

		it("detects kebab-case projects", () => {
			const entities = extractNEREntities("Deployed auth-service and api-gateway today");
			const projects = entities.filter((e) => e.type === "PROJECT").map((e) => e.value);
			expect(projects.some((v) => v.includes("auth-service"))).toBe(true);
			expect(projects.some((v) => v.includes("api-gateway"))).toBe(true);
		});

		it("detects GitHub owner/repo format", () => {
			const entities = extractNEREntities("Check sriinnu/AUriva for the source");
			const projects = entities.filter((e) => e.type === "PROJECT").map((e) => e.value);
			expect(projects).toContain("sriinnu/AUriva");
		});

		it("assigns confidence 0.85 to github repos", () => {
			const entities = extractNEREntities("See anthropics/claude-code for examples");
			const proj = entities.find((e) => e.type === "PROJECT" && e.value.includes("/"));
			expect(proj?.confidence).toBe(0.85);
		});
	});

	describe("ORGANIZATION", () => {
		it("detects org suffix names", () => {
			const entities = extractNEREntities("Working with Acme Corp on the project");
			const orgs = entities.filter((e) => e.type === "ORGANIZATION").map((e) => e.value);
			expect(orgs.some((v) => v.includes("Acme Corp"))).toBe(true);
		});

		it("detects ALL-CAPS acronyms not in noise list", () => {
			const entities = extractNEREntities("The NSA contacted CERN about the discovery");
			const orgs = entities.filter((e) => e.type === "ORGANIZATION").map((e) => e.value);
			expect(orgs.some((v) => v === "NSA" || v === "CERN")).toBe(true);
		});

		it("does not include noise acronyms like API, URL", () => {
			const entities = extractNEREntities("The API returns a URL as response");
			const orgs = entities.filter((e) => e.type === "ORGANIZATION").map((e) => e.value);
			expect(orgs).not.toContain("API");
			expect(orgs).not.toContain("URL");
		});
	});

	describe("METRIC", () => {
		it("detects numeric + unit metrics", () => {
			const entities = extractNEREntities("Query took 45ms, memory is 256MB, accuracy 95%");
			const metrics = entities.filter((e) => e.type === "METRIC").map((e) => e.value);
			expect(metrics.some((v) => v.includes("45ms") || v.includes("45"))).toBe(true);
			expect(metrics.some((v) => v.includes("256MB") || v.includes("256"))).toBe(true);
			expect(metrics.some((v) => v.includes("95%") || v.includes("95"))).toBe(true);
		});

		it("assigns confidence 0.9 to metrics", () => {
			const entities = extractNEREntities("Processed 3000 lines of code");
			const metric = entities.find((e) => e.type === "METRIC");
			expect(metric?.confidence).toBe(0.9);
		});
	});

	describe("DATE", () => {
		it("detects relative dates", () => {
			const entities = extractNEREntities("We shipped yesterday and meet next week");
			const dates = entities.filter((e) => e.type === "DATE").map((e) => e.value);
			expect(dates).toContain("yesterday");
			expect(dates).toContain("next week");
		});

		it("detects absolute dates (March 5, Jan 2026)", () => {
			const entities = extractNEREntities("The release is scheduled for March 5, 2026");
			const dates = entities.filter((e) => e.type === "DATE").map((e) => e.value);
			expect(dates.some((v) => v.toLowerCase().includes("march"))).toBe(true);
		});

		it("assigns confidence 0.85 to dates", () => {
			const entities = extractNEREntities("Meeting is tomorrow afternoon");
			const date = entities.find((e) => e.type === "DATE" && e.value === "tomorrow");
			expect(date?.confidence).toBe(0.85);
		});
	});

	describe("deduplication", () => {
		it("does not return the same value+type twice", () => {
			const entities = extractNEREntities("TypeScript TypeScript TypeScript is great");
			const techs = entities.filter((e) => e.type === "TECHNOLOGY" && e.value === "TypeScript");
			expect(techs.length).toBe(1);
		});
	});

	describe("result ordering", () => {
		it("returns entities sorted by startIndex", () => {
			const entities = extractNEREntities("Using Docker and Kubernetes for deployment");
			for (let i = 1; i < entities.length; i++) {
				expect(entities[i].startIndex).toBeGreaterThanOrEqual(entities[i - 1].startIndex);
			}
		});
	});

	describe("source field", () => {
		it("always has source = 'ner'", () => {
			const entities = extractNEREntities("TypeScript auth-service yesterday Dr. Smith");
			for (const e of entities) {
				expect(e.source).toBe("ner");
			}
		});
	});

	describe("empty / short input", () => {
		it("returns empty array for empty string", () => {
			expect(extractNEREntities("")).toEqual([]);
		});

		it("returns empty for very short text (length <= 2)", () => {
			const entities = extractNEREntities("hi");
			// Minimal text should not trigger any entity
			expect(entities.length).toBe(0);
		});
	});
});

// ─── jaccardNER ──────────────────────────────────────────────────────────────

describe("jaccardNER", () => {
	it("identical strings → 1.0", () => {
		expect(jaccardNER("hello world", "hello world")).toBe(1);
	});

	it("disjoint strings → 0.0", () => {
		expect(jaccardNER("foo bar", "baz qux")).toBe(0);
	});

	it("partial overlap → 0 < score < 1", () => {
		const score = jaccardNER("typescript react", "typescript vue");
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThan(1);
	});

	it("empty strings → 1.0 (both empty = identical)", () => {
		expect(jaccardNER("", "")).toBe(1);
	});

	it("one empty, one non-empty → 0.0", () => {
		expect(jaccardNER("", "hello")).toBe(0);
		expect(jaccardNER("hello", "")).toBe(0);
	});

	it("case-insensitive comparison", () => {
		expect(jaccardNER("TypeScript", "typescript")).toBe(1);
	});
});
