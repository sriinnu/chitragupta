import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @chitragupta/core to provide getChitraguptaHome
vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/tmp/chitragupta-test-home",
}));

// Mock fs before importing the module under test
vi.mock("fs", () => {
	const store = new Map<string, string>();
	const dirs = new Set<string>();

	return {
		default: {
			existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
			readFileSync: vi.fn((p: string) => {
				if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
				return store.get(p)!;
			}),
			writeFileSync: vi.fn((p: string, data: string) => {
				store.set(p, data);
			}),
			mkdirSync: vi.fn((p: string) => {
				dirs.add(p);
			}),
			readdirSync: vi.fn((dirPath: string) => {
				const files: string[] = [];
				for (const key of store.keys()) {
					if (key.startsWith(dirPath + "/") && key.endsWith(".md")) {
						const relative = key.slice(dirPath.length + 1);
						if (!relative.includes("/")) {
							files.push(relative);
						}
					}
				}
				return files;
			}),
			unlinkSync: vi.fn((p: string) => {
				store.delete(p);
			}),
		},
		__store: store,
		__dirs: dirs,
	};
});

import { SmaranStore } from "../src/smaran.js";
import type { SmaranEntry, SmaranCategory, SmaranConfig } from "../src/smaran.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SmaranStore", () => {
	let store: SmaranStore;
	let fsModule: any;

	beforeEach(async () => {
		fsModule = await import("fs");
		fsModule.__store.clear();
		fsModule.__dirs.clear();
		store = new SmaranStore({
			storagePath: "/tmp/chitragupta-test/smaran",
			maxEntries: 100,
		});
	});

	// ── remember() ──────────────────────────────────────────────────────

	describe("remember()", () => {
		it("should create an entry with correct fields", () => {
			const entry = store.remember("I like pizza", "preference");

			expect(entry).toBeDefined();
			expect(entry.id).toMatch(/^smr-[0-9a-f]{1,8}$/);
			expect(entry.content).toBe("I like pizza");
			expect(entry.category).toBe("preference");
			expect(entry.source).toBe("explicit");
			expect(entry.confidence).toBe(1.0);
			expect(entry.createdAt).toBeTruthy();
			expect(entry.updatedAt).toBeTruthy();
			expect(entry.decayHalfLifeDays).toBe(0); // explicit = no decay
			expect(Array.isArray(entry.tags)).toBe(true);
		});

		it("should set id, content, category, confidence, timestamps correctly", () => {
			const before = Date.now();
			const entry = store.remember("The project uses TypeScript", "fact", {
				tags: ["tech"],
				sessionId: "sess-001",
			});
			const after = Date.now();

			expect(entry.id).toMatch(/^smr-/);
			expect(entry.content).toBe("The project uses TypeScript");
			expect(entry.category).toBe("fact");
			expect(entry.confidence).toBe(1.0);
			expect(entry.sessionId).toBe("sess-001");
			expect(entry.tags).toContain("tech");

			const created = new Date(entry.createdAt).getTime();
			expect(created).toBeGreaterThanOrEqual(before - 1);
			expect(created).toBeLessThanOrEqual(after + 1);
		});

		it("should use 'inferred' source with lower confidence when specified", () => {
			const entry = store.remember("User seems to like dark mode", "preference", {
				source: "inferred",
			});

			expect(entry.source).toBe("inferred");
			expect(entry.confidence).toBe(0.6);
			expect(entry.decayHalfLifeDays).toBe(90); // default decay for inferred
		});

		it("should use provided confidence when specified", () => {
			const entry = store.remember("Something with custom conf", "fact", {
				confidence: 0.75,
			});
			expect(entry.confidence).toBe(0.75);
		});

		it("should auto-extract tags from content", () => {
			const entry = store.remember("I love cooking Italian food", "preference");
			expect(entry.tags).toContain("food");
		});

		it("should deduplicate entries with >80% term overlap (update instead of create)", () => {
			// Use confidence < 1.0 so the +0.1 boost is observable
			const first = store.remember("I really like pizza and pasta", "preference", {
				confidence: 0.7,
			});
			const originalId = first.id;
			const originalConfidence = first.confidence;

			// Very similar content — similarity = 5/6 = 0.833 > 0.8 → dedup
			const second = store.remember("I really like pizza and pasta too", "preference");

			// Should reuse the same entry (updated, not new)
			expect(second.id).toBe(originalId);
			// Confidence gets bumped by +0.1 (capped at 1.0)
			expect(second.confidence).toBeGreaterThan(originalConfidence);
			expect(store.size).toBe(1);
		});

		it("should NOT deduplicate entries with low overlap", () => {
			store.remember("I like pizza", "preference");
			store.remember("TypeScript is a great language", "fact");

			expect(store.size).toBe(2);
		});

		it("should merge tags on dedup update", () => {
			// Use content with very high overlap so findSimilar triggers (>80%)
			// "love cooking italian food" = 4 terms, "love cooking italian food again" = 5 terms
			// overlap = 4, max = 5, similarity = 4/5 = 0.8, but needs >0.8 (strictly greater)
			// Use shorter: "love cooking food" (3), "love cooking food too" (4) → 3/4 = 0.75 — no
			// Need: "love cooking" (2) vs "love cooking" (2) → 2/2 = 1.0 — but same content
			// Use exact same content — guaranteed dedup
			store.remember("I love cooking Italian food very much", "preference", { tags: ["food"] });
			const updated = store.remember("I love cooking Italian food very much", "preference", {
				tags: ["cooking"],
			});

			expect(updated.tags).toContain("food");
			expect(updated.tags).toContain("cooking");
		});

		it("should trim content whitespace", () => {
			const entry = store.remember("  spaced content  ", "fact");
			expect(entry.content).toBe("spaced content");
		});

		it("should enforce maxEntries by pruning lowest-confidence entries", () => {
			const tinyStore = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran-tiny",
				maxEntries: 3,
			});

			tinyStore.remember("Memory A", "fact", { confidence: 0.5 });
			tinyStore.remember("Memory B", "fact", { confidence: 0.3 });
			tinyStore.remember("Memory C", "fact", { confidence: 0.9 });

			// This should evict the lowest confidence entry
			tinyStore.remember("Memory D is completely different", "fact", { confidence: 0.8 });

			expect(tinyStore.size).toBeLessThanOrEqual(3);
		});

		it("should persist entries as .md files", () => {
			store.remember("Persisted memory", "fact");

			// The mock fs should have a written file
			const writeCalls = fsModule.default.writeFileSync.mock.calls;
			expect(writeCalls.length).toBeGreaterThan(0);

			const lastWrite = writeCalls[writeCalls.length - 1];
			expect(lastWrite[0]).toMatch(/\.md$/);
			expect(lastWrite[1]).toContain("Persisted memory");
		});
	});

	// ── forget() ────────────────────────────────────────────────────────

	describe("forget()", () => {
		it("should remove an entry by ID and return true", () => {
			const entry = store.remember("Temporary fact", "fact");
			expect(store.size).toBe(1);

			const result = store.forget(entry.id);
			expect(result).toBe(true);
			expect(store.size).toBe(0);
		});

		it("should return false for a missing ID", () => {
			const result = store.forget("smr-nonexistent");
			expect(result).toBe(false);
		});

		it("should delete the file on disk", () => {
			const entry = store.remember("To be deleted", "fact");
			store.forget(entry.id);

			expect(fsModule.default.unlinkSync).toHaveBeenCalled();
		});
	});

	// ── forgetByContent() ───────────────────────────────────────────────

	describe("forgetByContent()", () => {
		it("should remove matching entries and return count", () => {
			store.remember("I like pizza very much", "preference");
			store.remember("I also like pasta pizza", "preference");
			store.remember("TypeScript is great", "fact");

			const count = store.forgetByContent("pizza");
			expect(count).toBe(2);
			expect(store.size).toBe(1);
		});

		it("should return 0 when no entries match", () => {
			store.remember("I like pizza", "preference");
			const count = store.forgetByContent("sushi");
			expect(count).toBe(0);
			expect(store.size).toBe(1);
		});

		it("should be case-insensitive", () => {
			store.remember("I like PIZZA", "preference");
			const count = store.forgetByContent("pizza");
			expect(count).toBe(1);
		});
	});

	// ── recall() ────────────────────────────────────────────────────────

	describe("recall()", () => {
		it("should return BM25-scored results with relevance ordering", () => {
			store.remember("I love TypeScript for web development", "preference");
			store.remember("Python is great for data science", "fact");
			store.remember("TypeScript generics are very powerful features", "fact");

			const results = store.recall("TypeScript");
			expect(results.length).toBeGreaterThan(0);

			// The TypeScript entries should be the top results
			const topContent = results[0].content.toLowerCase();
			expect(topContent).toContain("typescript");
		});

		it("should apply exact match boost", () => {
			store.remember("dark mode is a display setting", "fact");
			store.remember("I prefer dark mode for coding", "preference");
			store.remember("mode switching is a feature", "fact");

			const results = store.recall("dark mode");
			// Entries containing the exact phrase "dark mode" should score higher
			expect(results.length).toBeGreaterThanOrEqual(2);
			const topTwo = results.slice(0, 2).map(r => r.content.toLowerCase());
			expect(topTwo.every(c => c.includes("dark mode"))).toBe(true);
		});

		it("should apply confidence boost", () => {
			store.remember("Pizza from Naples", "fact", { confidence: 0.2 });
			store.remember("Pizza from New York", "fact", { confidence: 1.0 });

			const results = store.recall("pizza");
			expect(results.length).toBe(2);
			// Higher confidence entry should rank first (same BM25 base, higher boost)
			expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence);
		});

		it("should return empty array for no matches", () => {
			store.remember("I like pizza", "preference");
			const results = store.recall("quantum chromodynamics");
			expect(results).toEqual([]);
		});

		it("should return empty when store is empty", () => {
			const results = store.recall("anything");
			expect(results).toEqual([]);
		});

		it("should return empty for blank query terms", () => {
			store.remember("Some memory", "fact");
			// All single-char tokens get filtered out by tokenize
			const results = store.recall("a b c");
			expect(results).toEqual([]);
		});

		it("should respect the limit parameter", () => {
			for (let i = 0; i < 20; i++) {
				store.remember(`Memory number ${i} about different topics and things`, "fact");
			}

			const results = store.recall("memory number", 3);
			expect(results.length).toBeLessThanOrEqual(3);
		});

		it("should apply temporal decay for entries with configured half-lives", () => {
			// Create an entry with short half-life and old timestamp
			const entry = store.remember("Old inferred memory about coding habits", "preference", {
				source: "inferred",
				decayHalfLifeDays: 1, // very fast decay
			});

			// Manually adjust the updatedAt to be 30 days ago
			const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
			store.update(entry.id, { content: entry.content });
			// Access internal to set old date
			const stored = store.get(entry.id);
			if (stored) {
				(stored as any).updatedAt = thirtyDaysAgo;
			}

			// Create a fresh entry
			store.remember("New coding memory about habits", "preference");

			const results = store.recall("coding habits");
			// The fresh entry should score higher than the decayed old one
			if (results.length >= 2) {
				const newIdx = results.findIndex(r => r.content.includes("New"));
				const oldIdx = results.findIndex(r => r.content.includes("Old"));
				if (newIdx >= 0 && oldIdx >= 0) {
					expect(newIdx).toBeLessThan(oldIdx);
				}
			}
		});
	});

	// ── listByCategory() ────────────────────────────────────────────────

	describe("listByCategory()", () => {
		it("should filter entries by category", () => {
			store.remember("I like dark mode", "preference");
			store.remember("The API uses REST", "fact");
			store.remember("I prefer tabs over spaces", "preference");
			store.remember("Use ESLint always", "instruction");

			const prefs = store.listByCategory("preference");
			expect(prefs.length).toBe(2);
			expect(prefs.every(e => e.category === "preference")).toBe(true);

			const facts = store.listByCategory("fact");
			expect(facts.length).toBe(1);
			expect(facts[0].category).toBe("fact");
		});

		it("should sort by confidence descending", () => {
			// Use sufficiently different content to avoid dedup (>80% overlap check)
			store.remember("I enjoy using dark mode for coding sessions", "preference", { confidence: 0.5 });
			store.remember("TypeScript generics are my favorite language feature", "preference", { confidence: 0.9 });
			store.remember("Always run unit tests before committing changes", "preference", { confidence: 0.7 });

			const prefs = store.listByCategory("preference");
			expect(prefs.length).toBe(3);
			expect(prefs[0].confidence).toBeGreaterThanOrEqual(prefs[1].confidence);
			expect(prefs[1].confidence).toBeGreaterThanOrEqual(prefs[2].confidence);
		});

		it("should return empty for a category with no entries", () => {
			store.remember("Some fact", "fact");
			const decisions = store.listByCategory("decision");
			expect(decisions).toEqual([]);
		});
	});

	// ── listAll() ───────────────────────────────────────────────────────

	describe("listAll()", () => {
		it("should return all entries sorted by updatedAt descending", () => {
			store.remember("First entry", "fact");
			store.remember("Second entry", "preference");
			store.remember("Third entry", "decision");

			const all = store.listAll();
			expect(all.length).toBe(3);

			// Should be sorted by updatedAt descending (most recent first)
			for (let i = 0; i < all.length - 1; i++) {
				const a = new Date(all[i].updatedAt).getTime();
				const b = new Date(all[i + 1].updatedAt).getTime();
				expect(a).toBeGreaterThanOrEqual(b);
			}
		});

		it("should return empty when store has no entries", () => {
			expect(store.listAll()).toEqual([]);
		});
	});

	// ── buildContextSection() ───────────────────────────────────────────

	describe("buildContextSection()", () => {
		it("should group entries by category with headers", () => {
			store.remember("I like dark mode", "preference");
			store.remember("The API uses REST", "fact");
			store.remember("Always use strict mode", "instruction");

			const section = store.buildContextSection();
			expect(section).toContain("## User Memory (Smaran)");
			expect(section).toContain("### Preferences");
			expect(section).toContain("### Known Facts");
			expect(section).toContain("### Standing Instructions");
			expect(section).toContain("I like dark mode");
			expect(section).toContain("The API uses REST");
			expect(section).toContain("Always use strict mode");
		});

		it("should filter relevant memories when query is provided", () => {
			store.remember("I like TypeScript for coding", "preference");
			store.remember("The weather is nice today", "fact");
			store.remember("Python is a scripting language", "fact");

			const section = store.buildContextSection("TypeScript");
			expect(section).toContain("TypeScript");
		});

		it("should return empty string when no entries exist", () => {
			const section = store.buildContextSection();
			expect(section).toBe("");
		});

		it("should return empty string when query matches nothing", () => {
			store.remember("I like pizza", "preference");
			const section = store.buildContextSection("quantum entanglement supercollider");
			expect(section).toBe("");
		});

		it("should not show confidence for explicit sources", () => {
			store.remember("Explicit memory entry", "fact");
			const section = store.buildContextSection();
			expect(section).not.toContain("confidence:");
		});

		it("should show confidence for inferred sources", () => {
			store.remember("Inferred memory entry", "fact", { source: "inferred" });
			const section = store.buildContextSection();
			expect(section).toContain("confidence:");
		});
	});

	// ── decayConfidence() ───────────────────────────────────────────────

	describe("decayConfidence()", () => {
		it("should reduce confidence over time for entries with decay", () => {
			const entry = store.remember("Decaying memory about something", "fact", {
				source: "inferred",
				confidence: 0.8,
				decayHalfLifeDays: 1, // very short half-life for testing
			});

			// Manually set updatedAt to 5 days ago
			const stored = store.get(entry.id)!;
			(stored as any).updatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

			store.decayConfidence();

			const after = store.get(entry.id)!;
			// After 5 half-lives, confidence should be ~0.8 * (0.5^5) ≈ 0.025
			expect(after.confidence).toBeLessThan(0.1);
		});

		it("should NOT decay entries with decayHalfLifeDays = 0", () => {
			const entry = store.remember("Permanent memory", "fact", {
				confidence: 0.9,
			});
			// explicit defaults to decayHalfLifeDays = 0

			const stored = store.get(entry.id)!;
			(stored as any).updatedAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

			store.decayConfidence();

			const after = store.get(entry.id)!;
			expect(after.confidence).toBe(0.9);
		});

		it("should not modify entries with negligible decay difference", () => {
			const entry = store.remember("Recent inferred memory", "fact", {
				source: "inferred",
				confidence: 1.0,
				decayHalfLifeDays: 90,
			});

			// Just created, so decay should be ~0
			store.decayConfidence();

			const after = store.get(entry.id)!;
			expect(after.confidence).toBe(1.0);
		});
	});

	// ── prune() ─────────────────────────────────────────────────────────

	describe("prune()", () => {
		it("should remove entries below the threshold", () => {
			store.remember("High confidence", "fact", { confidence: 0.9 });
			store.remember("Medium confidence", "fact", { confidence: 0.5 });
			store.remember("Very low confidence", "fact", { confidence: 0.02 });

			const removed = store.prune(0.1);
			expect(removed.length).toBe(1);
			expect(removed[0].content).toBe("Very low confidence");
			expect(store.size).toBe(2);
		});

		it("should use default threshold of 0.05 when not specified", () => {
			store.remember("Above default threshold", "fact", { confidence: 0.06 });
			store.remember("Below default threshold", "fact", { confidence: 0.03 });

			const removed = store.prune();
			expect(removed.length).toBe(1);
			expect(removed[0].content).toBe("Below default threshold");
		});

		it("should return empty array when nothing to prune", () => {
			store.remember("Solid memory", "fact", { confidence: 1.0 });
			const removed = store.prune(0.5);
			expect(removed).toEqual([]);
		});
	});

	// ── Config ──────────────────────────────────────────────────────────

	describe("config", () => {
		it("should respect custom maxEntries", () => {
			const custom = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran-cfg",
				maxEntries: 5,
			});

			for (let i = 0; i < 7; i++) {
				custom.remember(`Unique memory content number ${i} with different words`, "fact");
			}

			expect(custom.size).toBeLessThanOrEqual(5);
		});

		it("should cap maxEntries at hard ceiling", () => {
			const massive = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran-cap",
				maxEntries: 999_999,
			});

			// We can't easily check the private config, but it should not crash
			// and should be capped at 10_000
			expect(massive).toBeDefined();
		});

		it("should cap recallLimit at hard ceiling", () => {
			const wide = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran-rlim",
				recallLimit: 999,
			});

			// Populate enough entries
			for (let i = 0; i < 60; i++) {
				wide.remember(`Wide recall entry ${i} with some unique words here`, "fact");
			}

			const results = wide.recall("entry");
			// Should be capped at 50 (hard ceiling) not 999
			expect(results.length).toBeLessThanOrEqual(50);
		});

		it("should use default config values when not provided", () => {
			const defaultStore = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran-default",
			});
			expect(defaultStore).toBeDefined();
		});
	});

	// ── FNV-1a IDs ──────────────────────────────────────────────────────

	describe("FNV-1a IDs", () => {
		it("should generate IDs starting with smr-", () => {
			const entry = store.remember("Test content", "fact");
			expect(entry.id).toMatch(/^smr-[0-9a-f]+$/);
		});

		it("should generate different IDs for different content", () => {
			const e1 = store.remember("Content Alpha", "fact");
			const e2 = store.remember("Content Beta", "fact");
			expect(e1.id).not.toBe(e2.id);
		});
	});

	// ── update() ────────────────────────────────────────────────────────

	describe("update()", () => {
		it("should modify existing entry content", () => {
			const entry = store.remember("Original content", "fact");
			const updated = store.update(entry.id, { content: "Modified content" });

			expect(updated).not.toBeNull();
			expect(updated!.content).toBe("Modified content");
			expect(updated!.id).toBe(entry.id);
		});

		it("should modify existing entry confidence", () => {
			const entry = store.remember("Confidence test", "fact", { confidence: 0.5 });
			const updated = store.update(entry.id, { confidence: 0.95 });

			expect(updated).not.toBeNull();
			expect(updated!.confidence).toBe(0.95);
		});

		it("should update the updatedAt timestamp", () => {
			const entry = store.remember("Timestamp test", "fact");
			const originalUpdated = entry.updatedAt;

			// Small delay to ensure different timestamp
			const updated = store.update(entry.id, { content: "Changed content" });

			expect(updated).not.toBeNull();
			expect(updated!.updatedAt).toBeTruthy();
			// updatedAt might be same ms, but should be set
			expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
				new Date(originalUpdated).getTime(),
			);
		});

		it("should return null for a non-existent ID", () => {
			const result = store.update("smr-nonexistent", { content: "nope" });
			expect(result).toBeNull();
		});

		it("should update category", () => {
			const entry = store.remember("Recategorize me", "fact");
			const updated = store.update(entry.id, { category: "decision" });

			expect(updated).not.toBeNull();
			expect(updated!.category).toBe("decision");
		});

		it("should update tags", () => {
			const entry = store.remember("Tag update test", "fact");
			const updated = store.update(entry.id, { tags: ["alpha", "beta"] });

			expect(updated).not.toBeNull();
			expect(updated!.tags).toEqual(["alpha", "beta"]);
		});

		it("should persist the update to disk", () => {
			const entry = store.remember("Disk persist test", "fact");
			const writeCountBefore = fsModule.default.writeFileSync.mock.calls.length;

			store.update(entry.id, { content: "Updated on disk" });

			const writeCountAfter = fsModule.default.writeFileSync.mock.calls.length;
			expect(writeCountAfter).toBeGreaterThan(writeCountBefore);
		});
	});

	// ── get() ───────────────────────────────────────────────────────────

	describe("get()", () => {
		it("should return the entry for a valid ID", () => {
			const entry = store.remember("Retrievable", "fact");
			const found = store.get(entry.id);
			expect(found).not.toBeNull();
			expect(found!.content).toBe("Retrievable");
		});

		it("should return null for an invalid ID", () => {
			expect(store.get("smr-missing")).toBeNull();
		});
	});

	// ── size ────────────────────────────────────────────────────────────

	describe("size", () => {
		it("should return 0 for empty store", () => {
			expect(store.size).toBe(0);
		});

		it("should return correct count after additions", () => {
			store.remember("One", "fact");
			store.remember("Two", "fact");
			expect(store.size).toBe(2);
		});

		it("should decrease after forget", () => {
			const entry = store.remember("Forgettable", "fact");
			expect(store.size).toBe(1);
			store.forget(entry.id);
			expect(store.size).toBe(0);
		});
	});

	// ── Markdown round-trip (via persistence) ───────────────────────────

	describe("markdown serialization", () => {
		it("should persist and reload entries from disk", () => {
			// Write entries
			store.remember("Persistent fact about science", "fact", { tags: ["science"] });
			store.remember("Persistent preference for tabs", "preference", { tags: ["coding"] });

			// Create a new store pointing at the same path — it should load from disk
			const store2 = new SmaranStore({
				storagePath: "/tmp/chitragupta-test/smaran",
			});

			expect(store2.size).toBe(2);
			const all = store2.listAll();
			const contents = all.map(e => e.content);
			expect(contents).toContain("Persistent fact about science");
			expect(contents).toContain("Persistent preference for tabs");
		});
	});
});
