import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	keywordExtractSignals,
	llmExtractSignals,
	extractDelta,
	writeDeltaMarkdown,
	configureCompactorSignals,
	OLLAMA_ENDPOINT,
} from "../src/compactor-signals.js";
import type { Session, StreamSignals, SessionDelta } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		meta: {
			id: "sess-1",
			title: "Test Session",
			created: "2026-01-01T00:00:00Z",
			updated: "2026-01-01T01:00:00Z",
			agent: "chitragupta",
			model: "claude-3",
			project: "/tmp/project",
			parent: null,
			branch: null,
			tags: ["test", "unit"],
			totalCost: 0.05,
			totalTokens: 500,
			...overrides.meta,
		},
		turns: overrides.turns ?? [],
	};
}

function makeTurn(
	turnNumber: number,
	role: "user" | "assistant",
	content: string,
	toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
) {
	return { turnNumber, role: role as "user" | "assistant", content, toolCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("compactor-signals.ts", () => {
	describe("configureCompactorSignals", () => {
		it("should update the ollama endpoint", () => {
			configureCompactorSignals({ ollamaEndpoint: "http://custom:9999" });
			expect(OLLAMA_ENDPOINT).toBe("http://custom:9999");
			// Restore
			configureCompactorSignals({ ollamaEndpoint: "http://localhost:11434" });
		});

		it("should update the generation model without error", () => {
			expect(() => configureCompactorSignals({ generationModel: "phi3" })).not.toThrow();
		});
	});

	describe("keywordExtractSignals", () => {
		it("should return empty arrays for a session with no matching patterns", () => {
			const session = makeSession({
				turns: [makeTurn(1, "user", "The quick brown fox jumps over the lazy dog repeatedly")],
			});
			const signals = keywordExtractSignals(session);
			expect(signals.identity).toEqual([]);
			expect(signals.projects).toEqual([]);
			expect(signals.tasks).toEqual([]);
			expect(signals.flow).toEqual([]);
		});

		it("should detect identity patterns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "I prefer TypeScript over JavaScript for all my projects. My preference is tabs over spaces in code. I always use strict mode in my projects. Call me Srini when talking to me. Correct, I meant the ESM version."),
				],
			});
			const signals = keywordExtractSignals(session);
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.identity.some((s) => s.includes("I prefer TypeScript"))).toBe(true);
		});

		it("should detect project patterns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "We decided to use PostgreSQL for the database. The architecture should be microservices-based for scalability. We implemented the new caching layer yesterday."),
				],
			});
			const signals = keywordExtractSignals(session);
			expect(signals.projects.length).toBeGreaterThan(0);
			expect(signals.projects.some((s) => s.includes("decided"))).toBe(true);
		});

		it("should detect task patterns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "I need to fix the login bug before release. The migration task is completed successfully. We are blocked on the API approval from the vendor."),
				],
			});
			const signals = keywordExtractSignals(session);
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("should detect flow patterns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "The team is currently focused on the auth module changes. Bob is wondering if this approach will scale well enough. The group is stuck on the serialization problem for now."),
				],
			});
			const signals = keywordExtractSignals(session);
			expect(signals.flow.length).toBeGreaterThan(0);
			expect(signals.flow.some((s) => s.includes("currently"))).toBe(true);
		});

		it("should truncate matches to 200 chars", () => {
			const longSentence = "I prefer " + "x".repeat(300) + " for my code";
			const session = makeSession({
				turns: [makeTurn(1, "user", longSentence)],
			});
			const signals = keywordExtractSignals(session);
			for (const s of signals.identity) {
				expect(s.length).toBeLessThanOrEqual(200);
			}
		});

		it("should filter out sentences under 10 chars", () => {
			const session = makeSession({
				turns: [makeTurn(1, "user", "I prefer. Short. I always use ESM for modules")],
			});
			const signals = keywordExtractSignals(session);
			// "I prefer" (8 chars) and "Short" (5 chars) should be filtered
			// Only "I always use ESM for modules" should match
			const allSignals = [...signals.identity, ...signals.projects, ...signals.tasks, ...signals.flow];
			for (const s of allSignals) {
				expect(s.length).toBeGreaterThan(10);
			}
		});

		it("should prioritize identity > projects > tasks > flow (exclusive match)", () => {
			// A sentence that matches both identity and project patterns
			// "I prefer the monorepo architecture" — matches identity (I prefer) and project (architecture, monorepo)
			const session = makeSession({
				turns: [makeTurn(1, "user", "I prefer the monorepo architecture for this project setup")],
			});
			const signals = keywordExtractSignals(session);
			// Should be in identity, NOT in projects
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.projects.length).toBe(0);
		});

		it("should process both user and assistant turns", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "What should I build for this project today?"),
					makeTurn(2, "assistant", "I suggest we implement the caching layer with Redis for performance"),
				],
			});
			const signals = keywordExtractSignals(session);
			const allSignals = [...signals.identity, ...signals.projects, ...signals.tasks, ...signals.flow];
			expect(allSignals.length).toBeGreaterThan(0);
		});
	});

	describe("llmExtractSignals", () => {
		let originalFetch: typeof globalThis.fetch;

		beforeEach(() => {
			originalFetch = globalThis.fetch;
		});

		afterEach(() => {
			globalThis.fetch = originalFetch;
		});

		it("should fall back to keywordExtractSignals on fetch failure", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

			const session = makeSession({
				turns: [makeTurn(1, "user", "I prefer TypeScript over JavaScript for all my projects")],
			});
			const signals = await llmExtractSignals(session);
			// Should fall back to keyword extraction which detects identity
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("should fall back when Ollama response is not ok", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
			});

			const session = makeSession({
				turns: [makeTurn(1, "user", "We decided to use PostgreSQL for the database layer")],
			});
			const signals = await llmExtractSignals(session);
			// Falls back to keyword extraction
			expect(signals.projects.length).toBeGreaterThan(0);
		});
	});

	describe("extractDelta", () => {
		it("should create delta with keyPoints from identity + flow signals", () => {
			const session = makeSession({ turns: [makeTurn(1, "user", "Some content here")] });
			const signals: StreamSignals = {
				identity: ["Uses TypeScript", "Prefers tabs"],
				projects: [],
				tasks: [],
				flow: ["Working on auth module", "Considering Redis vs Memcached"],
			};

			const delta = extractDelta(session, signals);
			expect(delta.keyPoints).toContain("Uses TypeScript");
			expect(delta.keyPoints).toContain("Prefers tabs");
			expect(delta.keyPoints).toContain("Working on auth module");
			expect(delta.keyPoints).toContain("Considering Redis vs Memcached");
		});

		it("should create delta with decisions from projects signals", () => {
			const session = makeSession({ turns: [makeTurn(1, "user", "Some content here")] });
			const signals: StreamSignals = {
				identity: [],
				projects: ["Chose PostgreSQL", "Microservices architecture"],
				tasks: [],
				flow: [],
			};

			const delta = extractDelta(session, signals);
			expect(delta.decisions).toContain("Chose PostgreSQL");
			expect(delta.decisions).toContain("Microservices architecture");
		});

		it("should extract artifacts from tool calls with write/create/edit in name", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "assistant", "Writing files", [
						{ name: "write_file", input: '"/src/index.ts"', result: "ok" },
						{ name: "create_file", input: '"/src/utils.ts"', result: "ok" },
						{ name: "edit_file", input: '"/src/config.ts"', result: "ok" },
						{ name: "read_file", input: '"/src/foo.ts"', result: "content" },
					]),
				],
			});
			const signals: StreamSignals = { identity: [], projects: [], tasks: [], flow: [] };

			const delta = extractDelta(session, signals);
			expect(delta.artifacts).toHaveLength(3);
			expect(delta.artifacts.some((a) => a.includes("write_file"))).toBe(true);
			expect(delta.artifacts.some((a) => a.includes("create_file"))).toBe(true);
			expect(delta.artifacts.some((a) => a.includes("edit_file"))).toBe(true);
			// read_file should NOT be included
			expect(delta.artifacts.some((a) => a.includes("read_file"))).toBe(false);
		});

		it("should extract open threads from flow signals with question patterns", () => {
			const signals: StreamSignals = {
				identity: [],
				projects: [],
				tasks: [],
				flow: [
					"Should we use Redis?",
					"Working on auth module",
					"wondering about caching strategy",
					"tbd on deployment",
					"happy with progress",
				],
			};
			const session = makeSession({ turns: [makeTurn(1, "user", "content")] });

			const delta = extractDelta(session, signals);
			expect(delta.openThreads).toContain("Should we use Redis?");
			expect(delta.openThreads.some((t) => t.includes("wondering"))).toBe(true);
			expect(delta.openThreads.some((t) => t.includes("tbd"))).toBe(true);
			// "happy with progress" has no question patterns
			expect(delta.openThreads).not.toContain("happy with progress");
		});

		it("should deduplicate entries", () => {
			const signals: StreamSignals = {
				identity: ["Same thing", "Same thing"],
				projects: ["Same decision", "Same decision"],
				tasks: [],
				flow: [],
			};
			const session = makeSession({ turns: [makeTurn(1, "user", "content")] });

			const delta = extractDelta(session, signals);
			expect(delta.keyPoints.filter((k) => k === "Same thing")).toHaveLength(1);
			expect(delta.decisions.filter((d) => d === "Same decision")).toHaveLength(1);
		});

		it("should cap keyPoints at 20, decisions at 15, artifacts at 20, openThreads at 10", () => {
			const signals: StreamSignals = {
				identity: Array.from({ length: 25 }, (_, i) => `identity-${i}`),
				projects: Array.from({ length: 20 }, (_, i) => `project-${i}`),
				tasks: [],
				flow: Array.from({ length: 15 }, (_, i) => `open question ${i}?`),
			};
			const session = makeSession({ turns: [makeTurn(1, "user", "content")] });

			const delta = extractDelta(session, signals);
			expect(delta.keyPoints.length).toBeLessThanOrEqual(20);
			expect(delta.decisions.length).toBeLessThanOrEqual(15);
			expect(delta.openThreads.length).toBeLessThanOrEqual(10);
		});

		it("should calculate originalTokens and deltaTokens", () => {
			const session = makeSession({
				turns: [
					makeTurn(1, "user", "This is some content for the session"),
					makeTurn(2, "assistant", "And this is the response from the assistant"),
				],
			});
			const signals: StreamSignals = {
				identity: ["User prefers TypeScript"],
				projects: ["Chose PostgreSQL"],
				tasks: [],
				flow: [],
			};

			const delta = extractDelta(session, signals);
			expect(delta.originalTokens).toBeGreaterThan(0);
			expect(delta.deltaTokens).toBeGreaterThan(0);
			expect(delta.deltaTokens).toBeLessThanOrEqual(delta.originalTokens);
		});

		it("should include session metadata", () => {
			const session = makeSession({ turns: [makeTurn(1, "user", "content")] });
			const signals: StreamSignals = { identity: [], projects: [], tasks: [], flow: [] };

			const delta = extractDelta(session, signals);
			expect(delta.sessionId).toBe("sess-1");
			expect(delta.title).toBe("Test Session");
			expect(delta.tags).toEqual(["test", "unit"]);
			expect(delta.timestamp).toBeTruthy();
		});
	});

	describe("writeDeltaMarkdown", () => {
		function makeDelta(overrides: Partial<SessionDelta> = {}): SessionDelta {
			return {
				sessionId: "sess-1",
				title: "Test Session",
				timestamp: "2026-01-01T00:00:00Z",
				keyPoints: ["Point one", "Point two"],
				decisions: ["Decision A"],
				artifacts: ["write_file: /src/index.ts"],
				tags: ["test", "unit"],
				openThreads: ["Should we use Redis?"],
				originalTokens: 1000,
				deltaTokens: 100,
				...overrides,
			};
		}

		it("should produce valid YAML frontmatter with --- delimiters", () => {
			const md = writeDeltaMarkdown(makeDelta());
			const lines = md.split("\n");
			expect(lines[0]).toBe("---");
			// Find second ---
			const secondDelimiter = lines.indexOf("---", 1);
			expect(secondDelimiter).toBeGreaterThan(1);
		});

		it("should include session_id, title, timestamp, token counts, compression_ratio", () => {
			const md = writeDeltaMarkdown(makeDelta());
			expect(md).toContain("session_id: sess-1");
			expect(md).toContain('title: "Test Session"');
			expect(md).toContain("timestamp: 2026-01-01T00:00:00Z");
			expect(md).toContain("original_tokens: 1000");
			expect(md).toContain("delta_tokens: 100");
			expect(md).toContain("compression_ratio: 0.100");
		});

		it("should write tags as YAML list", () => {
			const md = writeDeltaMarkdown(makeDelta({ tags: ["alpha", "beta"] }));
			expect(md).toContain("tags:");
			expect(md).toContain("  - alpha");
			expect(md).toContain("  - beta");
		});

		it("should write empty tags as 'tags: []'", () => {
			const md = writeDeltaMarkdown(makeDelta({ tags: [] }));
			expect(md).toContain("tags: []");
		});

		it("should include Key Points section", () => {
			const md = writeDeltaMarkdown(makeDelta());
			expect(md).toContain("## Key Points");
			expect(md).toContain("- Point one");
			expect(md).toContain("- Point two");
		});

		it("should include Decisions section", () => {
			const md = writeDeltaMarkdown(makeDelta());
			expect(md).toContain("## Decisions");
			expect(md).toContain("- Decision A");
		});

		it("should include Artifacts section", () => {
			const md = writeDeltaMarkdown(makeDelta());
			expect(md).toContain("## Artifacts");
			expect(md).toContain("- write_file: /src/index.ts");
		});

		it("should include Open Threads section", () => {
			const md = writeDeltaMarkdown(makeDelta());
			expect(md).toContain("## Open Threads");
			expect(md).toContain("- Should we use Redis?");
		});

		it("should omit empty sections", () => {
			const md = writeDeltaMarkdown(makeDelta({
				keyPoints: [],
				decisions: [],
				artifacts: [],
				openThreads: [],
			}));
			expect(md).not.toContain("## Key Points");
			expect(md).not.toContain("## Decisions");
			expect(md).not.toContain("## Artifacts");
			expect(md).not.toContain("## Open Threads");
		});

		it("should include final compression summary line", () => {
			const md = writeDeltaMarkdown(makeDelta({ originalTokens: 500, deltaTokens: 50 }));
			expect(md).toContain("*Compressed from 500 tokens to 50 tokens*");
		});

		it("should handle title with double quotes", () => {
			const md = writeDeltaMarkdown(makeDelta({ title: 'A "quoted" title' }));
			expect(md).toContain('title: "A \\"quoted\\" title"');
		});

		it("should handle zero originalTokens (compression_ratio = 0)", () => {
			const md = writeDeltaMarkdown(makeDelta({ originalTokens: 0, deltaTokens: 0 }));
			expect(md).toContain("compression_ratio: 0");
		});
	});
});
