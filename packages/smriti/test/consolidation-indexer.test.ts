/**
 * Tests for consolidation-indexer.ts
 *
 * Verifies:
 * - extractSummaryText for each level (daily/monthly/yearly)
 * - indexConsolidationSummary stores to vectors.db correctly
 * - searchConsolidationSummaries returns ranked results
 * - backfillConsolidationIndices finds unindexed items
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock @chitragupta/core before importing modules
vi.mock("@chitragupta/core", () => {
	let _home = "/tmp/test-chitragupta";
	return {
		getChitraguptaHome: () => _home,
		setChitraguptaHome: (h: string) => { _home = h; },
		SessionError: class SessionError extends Error {},
	};
});

// Mock the swara embedding provider
vi.mock("@chitragupta/swara", () => ({
	OllamaEmbedding: class { async isConfigured() { return false; } },
}));

import { DatabaseManager } from "../src/db/database.js";
import { initVectorsSchema } from "../src/db/schema.js";
import { extractSummaryText, indexConsolidationSummary, searchConsolidationSummaries, backfillConsolidationIndices, _resetConsolidationIndexer } from "../src/consolidation-indexer.js";

// ─── Setup ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-cidx-test-"));
	DatabaseManager.reset();
	_resetConsolidationIndexer();
	const core = vi.mocked(await import("@chitragupta/core")) as unknown as typeof import("@chitragupta/core") & { setChitraguptaHome: (h: string) => void };
	core.setChitraguptaHome(tmpDir);
	// Pre-initialize the DB singleton so consolidation-indexer picks up tmpDir
	const dbm = DatabaseManager.instance(tmpDir);
	initVectorsSchema(dbm);
});

afterEach(() => {
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countEmbeddings(sourceType: string): number {
	const db = DatabaseManager.instance().get("vectors");
	const row = db.prepare("SELECT COUNT(*) as cnt FROM embeddings WHERE source_type = ?").get(sourceType) as { cnt: number };
	return row.cnt;
}

function getFirstEmbedding(sourceType: string): { id: string; source_type: string; source_id: string; text: string } | null {
	const db = DatabaseManager.instance().get("vectors");
	return db.prepare("SELECT id, source_type, source_id, text FROM embeddings WHERE source_type = ?").get(sourceType) as any ?? null;
}

// ─── Sample Markdown ─────────────────────────────────────────────────────────

const DAILY_MD = `# 2026-02-10 — Monday

> 3 sessions | 2 projects | 45 turns

## Facts Learned

- [preference] User prefers dark mode
- [identity] Lives in Vienna

## Project: /my/project

**Branch**: feat/auth | **Providers**: claude | **Sessions**: 2

### Session: session-2026-02-10-abc1

*10:30 | claude | 20 turns | coding session*

> Implemented authentication module

**Topics**: auth, JWT, middleware

- **Decision**: Use JWT with refresh tokens
- **Error**: Token validation failed on first attempt
- **Fact**: User's company uses OAuth2

### Tools Used

- **write**: 5 calls
- **edit**: 3 calls

### Files Modified

- src/auth/jwt.ts
- src/middleware/auth.ts
`;

const MONTHLY_MD = `# Monthly Consolidation — /my/project — 2026-01
> Generated: 2026-02-01T03:00:00Z

## Summary
- **Sessions**: 42
- **Turns**: 580
- **Tools Used**: write, edit, read, grep
- **Total Tokens**: 1,250,000
- **Estimated Cost**: $12.50

## Vasanas Crystallized
| Tendency | Strength | Valence | Stability |
|----------|----------|---------|-----------|
| Test-first development | 0.85 | positive | 0.90 |
| Dark mode preference | 0.72 | positive | 0.88 |

## Vidhis Extracted
_No vidhis extracted this month._

## Top Samskaras
_No active samskaras this month._

## Knowledge Graph Growth
- New nodes: 15
- New edges: 23

## Recommendations
- All metrics within healthy ranges. Keep up the momentum.
- Consider consolidating test utilities across packages.
`;

const YEARLY_MD = `# Yearly Consolidation — /my/project — 2025
> Generated: 2026-01-01T04:00:00Z

## Annual Summary
- **Sessions**: 520
- **Turns**: 7,200
- **Total Tokens**: 15,000,000
- **Estimated Cost**: $150.00
- **Vasanas Crystallized**: 12
- **Vidhis Extracted**: 5
- **Samskaras Active**: 8

## Trends
- Session volume increased significantly in the second half of the year.
- Strong behavioral crystallization: 12 vasanas formed across the year.
- Active procedural learning: 5 vidhis extracted from repeated patterns.

## Top Vasanas of the Year
| Tendency | Strength | Valence | Stability |
|----------|----------|---------|-----------|
| Test-first development | 0.92 | positive | 0.95 |
`;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("extractSummaryText", () => {
	it("extracts high-signal content from daily markdown", () => {
		const text = extractSummaryText(DAILY_MD, "daily");
		expect(text).toContain("2026-02-10");
		expect(text).toContain("Decision");
		expect(text).toContain("JWT");
		expect(text).toContain("Lives in Vienna");
		expect(text).toContain("dark mode");
		// Should not include raw tool count lines
		expect(text).not.toContain("write: 5 calls");
	});

	it("extracts high-signal content from monthly markdown", () => {
		const text = extractSummaryText(MONTHLY_MD, "monthly");
		expect(text).toContain("Monthly Consolidation");
		expect(text).toContain("Sessions: 42");
		expect(text).toContain("Test-first development");
		expect(text).toContain("consolidating test utilities");
	});

	it("extracts high-signal content from yearly markdown", () => {
		const text = extractSummaryText(YEARLY_MD, "yearly");
		expect(text).toContain("Yearly Consolidation");
		expect(text).toContain("Sessions: 520");
		expect(text).toContain("Session volume increased");
		expect(text).toContain("behavioral crystallization");
	});

	it("returns empty string for empty markdown", () => {
		const text = extractSummaryText("", "daily");
		expect(text).toBe("");
	});

	it("truncates to 2000 chars", () => {
		const longMd = "# Title\n" + "- **Fact**: some long content here about things\n".repeat(200);
		const text = extractSummaryText(longMd, "daily");
		expect(text.length).toBeLessThanOrEqual(2000);
	});
});

describe("indexConsolidationSummary", () => {
	it("stores a daily summary embedding in vectors.db", async () => {
		await indexConsolidationSummary("daily", "2026-02-10", DAILY_MD);

		const row = getFirstEmbedding("daily_summary");
		expect(row).toBeTruthy();
		expect(row!.source_type).toBe("daily_summary");
		expect(row!.source_id).toBe("2026-02-10");
		expect(row!.text).toContain("JWT");
	});

	it("stores a monthly summary with project hash", async () => {
		await indexConsolidationSummary("monthly", "2026-01", MONTHLY_MD, "/my/project");

		const row = getFirstEmbedding("monthly_summary");
		expect(row).toBeTruthy();
		expect(row!.source_type).toBe("monthly_summary");
		expect(row!.id).toContain("monthly_summary:2026-01-");
	});

	it("stores a yearly summary in vectors.db", async () => {
		await indexConsolidationSummary("yearly", "2025", YEARLY_MD, "/my/project");

		const row = getFirstEmbedding("yearly_summary");
		expect(row).toBeTruthy();
		expect(row!.source_type).toBe("yearly_summary");
	});

	it("upserts on repeated calls (no duplicates)", async () => {
		await indexConsolidationSummary("daily", "2026-02-10", DAILY_MD);
		await indexConsolidationSummary("daily", "2026-02-10", DAILY_MD);

		expect(countEmbeddings("daily_summary")).toBe(1);
	});

	it("skips indexing for tiny markdown", async () => {
		await indexConsolidationSummary("daily", "2026-02-10", "# Hi");

		expect(countEmbeddings("daily_summary")).toBe(0);
	});
});

describe("searchConsolidationSummaries", () => {
	it("returns results when querying with matching terms", async () => {
		// Use the exact same vocabulary in query as in data for hash-based matching
		await indexConsolidationSummary("daily", "2026-02-10", DAILY_MD);

		// Query with exact terms from the daily summary
		const results = await searchConsolidationSummaries("JWT refresh tokens authentication Decision", "daily");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].period).toBeDefined();
		expect(results[0].score).toBeGreaterThan(0);
		expect(results[0].snippet).toBeDefined();
	});

	it("returns empty array when no summaries exist", async () => {
		const results = await searchConsolidationSummaries("anything", "yearly");
		expect(results).toEqual([]);
	});

	it("respects limit parameter", async () => {
		// Index several summaries with same vocabulary
		for (let d = 1; d <= 5; d++) {
			const date = `2026-02-${String(d).padStart(2, "0")}`;
			await indexConsolidationSummary("daily", date,
				`# ${date}\n**Decision**: Use JWT tokens for auth\n**Fact**: Token expiry ${d} minutes\n> Implemented authentication`);
		}

		const results = await searchConsolidationSummaries("JWT tokens auth authentication", "daily", { limit: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});
});

describe("backfillConsolidationIndices", () => {
	it("returns zero counts when no files exist", async () => {
		const counts = await backfillConsolidationIndices();
		expect(counts.daily).toBe(0);
		expect(counts.monthly).toBe(0);
		expect(counts.yearly).toBe(0);
	});

	it("indexes existing day files when present", async () => {
		// Create a day file at the expected path under the mocked home
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), DAILY_MD, "utf-8");

		const counts = await backfillConsolidationIndices();
		expect(counts.daily).toBeGreaterThanOrEqual(1);
	});

	it("skips already-indexed summaries", async () => {
		// Index first
		await indexConsolidationSummary("daily", "2026-02-10", DAILY_MD);

		// Create the day file
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), DAILY_MD, "utf-8");

		const counts = await backfillConsolidationIndices();
		expect(counts.daily).toBe(0); // Already indexed
	});
});
