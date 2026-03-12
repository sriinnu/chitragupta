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
		loadGlobalSettings: () => ({}),
		createLogger: () => ({
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		}),
		generateTraceId: () => "trace-test",
		generateSpanId: () => "span-test",
		SessionError: class SessionError extends Error {},
	};
});

// Mock the swara embedding provider
vi.mock("@chitragupta/swara", () => ({
	OllamaEmbedding: class { async isConfigured() { return false; } },
}));

import { DatabaseManager } from "../src/db/database.js";
import { initVectorsSchema } from "../src/db/schema.js";
import { _setSummaryPackerForTests } from "../src/pakt-compression.js";
import {
	extractSummaryText,
	indexConsolidationSummary,
	searchConsolidationSummaries,
	backfillConsolidationIndices,
	inspectConsolidationVectorSync,
	repairConsolidationVectorSync,
	_resetConsolidationIndexer,
} from "../src/consolidation-indexer.js";
import {
	planSelectiveReembedding,
	repairSelectiveReembedding,
} from "../src/selective-reembedding.js";
import { renderConsolidationMetadata } from "../src/consolidation-provenance.js";
import { computeMdlCompactionMetrics } from "../src/mdl-compaction.js";

// ─── Setup ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-cidx-test-"));
	DatabaseManager.reset();
	_resetConsolidationIndexer();
	_setSummaryPackerForTests(null);
	const core = vi.mocked(await import("@chitragupta/core")) as unknown as typeof import("@chitragupta/core") & { setChitraguptaHome: (h: string) => void };
	core.setChitraguptaHome(tmpDir);
	// Pre-initialize the DB singleton so consolidation-indexer picks up tmpDir
	const dbm = DatabaseManager.instance(tmpDir);
	initVectorsSchema(dbm);
});

afterEach(() => {
	_setSummaryPackerForTests(null);
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

function getEmbeddingMetadata(sourceType: string): Record<string, unknown> | null {
	const db = DatabaseManager.instance().get("vectors");
	const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get(sourceType) as { metadata?: string | null } | null;
	if (!row?.metadata) return null;
	return JSON.parse(row.metadata) as Record<string, unknown>;
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

const CURATED_DAILY_MD = `${renderConsolidationMetadata({
	kind: "day",
	formatVersion: 1,
	date: "2026-02-10",
	generatedAt: "2026-02-10T03:00:00.000Z",
	sessionCount: 2,
	projectCount: 1,
	sourceSessionIds: ["session-a", "session-b"],
	sourceSessions: [
		{ id: "session-a", project: "/my/project", title: "A", created: "2026-02-10T01:00:00.000Z", updated: "2026-02-10T01:10:00.000Z", provider: "claude", branch: null },
		{ id: "session-b", project: "/my/project", title: "B", created: "2026-02-10T02:00:00.000Z", updated: "2026-02-10T02:10:00.000Z", provider: "claude", branch: null },
	],
	projects: [{ project: "/my/project", sessionIds: ["session-a", "session-b"] }],
})}

# 2026-02-10 — Monday

> Implemented semantic sync checks for consolidated recall.

## Facts Learned

- [preference] User prefers deterministic session lineage

## Project: /my/project

**Decision**: Keep raw sessions canonical, promote only curated artifacts
`;

const LOW_MDL_DAILY_MD = `${renderConsolidationMetadata({
	kind: "day",
	formatVersion: 1,
	date: "2026-02-12",
	generatedAt: "2026-02-12T03:00:00.000Z",
	sessionCount: 1,
	projectCount: 1,
	sourceSessionIds: ["session-low-mdl"],
	sourceSessions: [
		{ id: "session-low-mdl", project: "/my/project", title: "Low MDL", created: "2026-02-12T01:00:00.000Z", updated: "2026-02-12T01:10:00.000Z", provider: "claude", branch: null },
	],
	projects: [{ project: "/my/project", sessionIds: ["session-low-mdl"] }],
})}

# 2026-02-12 — Wednesday

${Array.from({ length: 180 }, (_, index) => `Noise shard ${index} unrelated-token-${index} drift-noise-${index} entropy-noise-${index}.`).join("\n")}

## Facts Learned

- [decision] Keep only the essential semantic policy signal
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

	it("stores curated provenance metadata and content hash when available", async () => {
		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const metadata = getEmbeddingMetadata("daily_summary");
		expect(metadata?.curated).toBe(true);
		expect(metadata?.sourceSessionIds).toEqual(["session-a", "session-b"]);
		expect(typeof metadata?.contentHash).toBe("string");
		expect((metadata?.embeddingEpoch as { epoch?: string } | undefined)?.epoch).toBeTruthy();
		expect((metadata?.mdlMetrics as { mdlScore?: number } | undefined)?.mdlScore).toBeTypeOf("number");
	});

	it("stores packed curated summaries as derived metadata without replacing semantic text", async () => {
		_setSummaryPackerForTests({
			packSummary: vi.fn(async () => ({
				runtime: "pakt",
				packedText: "@from text\nsummary|deterministic lineage",
				format: "text",
				savings: 31,
			})),
		});

		await indexConsolidationSummary("daily", "2026-02-10", `${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`);
		const row = getFirstEmbedding("daily_summary");
		const metadata = getEmbeddingMetadata("daily_summary");

		expect(row?.text).toContain("deterministic session lineage");
		expect(metadata?.packedSummaryText).toContain("@from text");
		expect((metadata?.compression as { runtime?: string })?.runtime).toBe("pakt");
	});

		it("rejects packed curated summaries that lose too much signal", async () => {
		_setSummaryPackerForTests({
			packSummary: vi.fn(async () => ({
				runtime: "pakt",
				packedText: "pakt:xyz",
				format: "text",
				savings: 92,
			})),
		});

		await indexConsolidationSummary("daily", "2026-02-10", `${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`);
		const metadata = getEmbeddingMetadata("daily_summary");

		expect(metadata?.packedSummaryText).toBeNull();
		expect(metadata?.compression).toBeNull();
			expect((metadata?.packedDecision as { accepted?: boolean; reason?: string } | undefined)?.accepted).toBe(false);
			expect((metadata?.packedDecision as { accepted?: boolean; reason?: string } | undefined)?.reason).toBe("low_retention");
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
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		const counts = await backfillConsolidationIndices();
		expect(counts.daily).toBeGreaterThanOrEqual(1);
	});

	it("skips already-indexed summaries", async () => {
		// Index first
		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);

		// Create the day file
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		const counts = await backfillConsolidationIndices();
		expect(counts.daily).toBe(0); // Already indexed
	});
});

describe("semantic sync inspection and repair", () => {
	it("detects and repairs missing curated daily summary vectors", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		const before = await inspectConsolidationVectorSync();
		expect(before.scanned).toBeGreaterThanOrEqual(1);
		expect(before.missingCount).toBe(1);

		const repaired = await repairConsolidationVectorSync();
		expect(repaired.reindexed).toBe(1);

		const after = await inspectConsolidationVectorSync();
		expect(after.missingCount).toBe(0);
		expect(after.driftCount).toBe(0);
	});

	it("detects recall drift when the curated artifact changed after indexing", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		const dayPath = path.join(daysDir, "10.md");
		fs.writeFileSync(dayPath, CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		fs.writeFileSync(dayPath, CURATED_DAILY_MD.replace("semantic sync checks", "drift repair checks"), "utf-8");

		const status = await inspectConsolidationVectorSync();
		expect(status.missingCount).toBe(0);
		expect(status.driftCount).toBe(1);
		expect(status.issues[0]?.reason).toBe("stale_hash");
	});

	it("detects stale embedding epochs when curated text is unchanged", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const db = DatabaseManager.instance().get("vectors");
		const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get("daily_summary") as { metadata: string };
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		db.prepare("UPDATE embeddings SET metadata = ? WHERE source_type = ?").run(JSON.stringify(metadata), "daily_summary");

		const status = await inspectConsolidationVectorSync();
		expect(status.missingCount).toBe(0);
		expect(status.driftCount).toBe(1);
		expect(status.issues[0]?.reason).toBe("stale_epoch");
	});

	it("plans selective re-embedding for stale-epoch curated artifacts", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const db = DatabaseManager.instance().get("vectors");
		const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get("daily_summary") as { metadata: string };
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		db.prepare("UPDATE embeddings SET metadata = ? WHERE source_type = ?").run(JSON.stringify(metadata), "daily_summary");

		const plan = await planSelectiveReembedding({ candidateLimit: 5 });
		expect(plan.scanned).toBeGreaterThanOrEqual(1);
		expect(plan.candidateCount).toBe(1);
		expect(plan.candidates[0]).toEqual(expect.objectContaining({
			id: expect.stringContaining("daily_summary:2026-02-10"),
			localReasons: expect.arrayContaining(["stale_epoch"]),
		}));
	});

	it("uses MDL thresholds to skip low-priority re-embedding candidates", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const db = DatabaseManager.instance().get("vectors");
		const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get("daily_summary") as { metadata: string };
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		db.prepare("UPDATE embeddings SET metadata = ? WHERE source_type = ?").run(JSON.stringify(metadata), "daily_summary");

			const plan = await planSelectiveReembedding({
				candidateLimit: 5,
				minMdlScore: 0.95,
				reasons: ["stale_epoch"],
			});
			expect(plan.candidateCount).toBe(0);
		});

		it("honors explicit stale reasons beyond epoch drift", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		fs.writeFileSync(
			path.join(daysDir, "10.md"),
			CURATED_DAILY_MD.replace(
				"**Decision**: Keep raw sessions canonical, promote only curated artifacts",
				"**Decision**: Prefer selective re-embedding repair over broad semantic rewrites",
			),
			"utf-8",
		);

		const plan = await planSelectiveReembedding({
			candidateLimit: 1,
			reasons: ["stale_hash"],
		});
			expect(plan.candidateCount).toBe(1);
			expect(plan.candidates[0]?.localReasons).toContain("stale_hash");
		});

		it("selects low-MDL curated artifacts even without epoch drift", async () => {
			const daysDir = path.join(tmpDir, "days", "2026", "02");
			fs.mkdirSync(daysDir, { recursive: true });
			fs.writeFileSync(path.join(daysDir, "12.md"), LOW_MDL_DAILY_MD, "utf-8");

			await indexConsolidationSummary("daily", "2026-02-12", LOW_MDL_DAILY_MD);

			const plan = await planSelectiveReembedding({
				dates: ["2026-02-12"],
				levels: ["daily"],
				candidateLimit: 5,
			});

			expect(plan.candidateCount).toBe(1);
			expect(plan.candidates[0]?.localReasons).toContain("low_mdl");
			expect(plan.candidates[0]?.localReasons).not.toContain("stale_epoch");
		});

		it("selects rejected packed curated artifacts even without epoch drift", async () => {
			const daysDir = path.join(tmpDir, "days", "2026", "02");
			fs.mkdirSync(daysDir, { recursive: true });
			fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");
			_setSummaryPackerForTests({
				packSummary: vi.fn(async () => ({
					runtime: "pakt",
					packedText: "pakt:xyz",
					format: "text",
					savings: 92,
				})),
			});

			await indexConsolidationSummary("daily", "2026-02-10", `${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`);

			const plan = await planSelectiveReembedding({
				dates: ["2026-02-10"],
				levels: ["daily"],
				candidateLimit: 5,
			});

			expect(plan.candidateCount).toBe(1);
			expect(plan.candidates[0]?.localReasons).toContain("rejected_packed");
			expect(plan.candidates[0]?.localReasons).not.toContain("stale_epoch");
		});

	it("does not truncate explicit artifact id repairs to candidateLimit", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");
		fs.writeFileSync(
			path.join(daysDir, "11.md"),
			CURATED_DAILY_MD
				.replaceAll("2026-02-10", "2026-02-11")
				.replace("remote semantic mirror checks", "second curated summary"),
			"utf-8",
		);

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		await indexConsolidationSummary(
			"daily",
			"2026-02-11",
			CURATED_DAILY_MD
				.replaceAll("2026-02-10", "2026-02-11")
				.replace("remote semantic mirror checks", "second curated summary"),
		);

		const db = DatabaseManager.instance().get("vectors");
		const rows = db.prepare("SELECT id, metadata FROM embeddings WHERE source_type = ?").all("daily_summary") as Array<{
			id: string;
			metadata: string;
		}>;
		for (const row of rows) {
			const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
			metadata.embeddingEpoch = {
				providerId: "legacy-provider",
				modelId: "legacy-model",
				dimensions: 384,
				strategy: "provider",
				epoch: "legacy-provider:legacy-model:384:provider",
			};
			db.prepare("UPDATE embeddings SET metadata = ? WHERE id = ?").run(JSON.stringify(metadata), row.id);
		}

		const ids = rows.map((row) => row.id).sort();
		const plan = await planSelectiveReembedding({
			ids,
			candidateLimit: 1,
		});
		expect(plan.candidateCount).toBe(2);
		expect(plan.candidates.map((candidate) => candidate.id).sort()).toEqual(ids);
	});

	it("repairs selective re-embedding candidates and clears epoch drift", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const db = DatabaseManager.instance().get("vectors");
		const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get("daily_summary") as { metadata: string };
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		db.prepare("UPDATE embeddings SET metadata = ? WHERE source_type = ?").run(JSON.stringify(metadata), "daily_summary");

		const repaired = await repairSelectiveReembedding({ candidateLimit: 5 });
		expect(repaired.plan.candidateCount).toBe(1);
		expect(repaired.reembedded).toBe(1);

		const status = await inspectConsolidationVectorSync();
		expect(status.issues.map((issue) => issue.reason)).not.toContain("stale_epoch");
	});

	it("does not count re-embedding when local vector writes fail", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		fs.writeFileSync(path.join(daysDir, "10.md"), CURATED_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const db = DatabaseManager.instance().get("vectors");
		const row = db.prepare("SELECT metadata FROM embeddings WHERE source_type = ?").get("daily_summary") as { metadata: string };
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		db.prepare("UPDATE embeddings SET metadata = ? WHERE source_type = ?").run(JSON.stringify(metadata), "daily_summary");

		const originalPrepare = db.prepare.bind(db);
		const prepareSpy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
			if (sql.includes("INSERT OR REPLACE INTO embeddings")) {
				throw new Error("disk full");
			}
			return originalPrepare(sql);
		}) as typeof db.prepare);

		const repaired = await repairSelectiveReembedding({ candidateLimit: 5 });
		expect(repaired.plan.candidateCount).toBe(1);
		expect(repaired.reembedded).toBe(0);

		prepareSpy.mockRestore();

		const status = await inspectConsolidationVectorSync();
		expect(status.issues.map((issue) => issue.reason)).toContain("stale_epoch");
	});

	it("rebuilds low-MDL daily artifacts during selective repair", async () => {
		const daysDir = path.join(tmpDir, "days", "2026", "02");
		fs.mkdirSync(daysDir, { recursive: true });
		const lowMdlPath = path.join(daysDir, "12.md");
		fs.writeFileSync(lowMdlPath, LOW_MDL_DAILY_MD, "utf-8");

		await indexConsolidationSummary("daily", "2026-02-12", LOW_MDL_DAILY_MD);

		const preRepairPlan = await planSelectiveReembedding({
			dates: ["2026-02-12"],
			levels: ["daily"],
			reasons: ["low_mdl"],
		});
		expect(preRepairPlan.candidateCount).toBe(1);

		const dayConsolidation = await import("../src/day-consolidation.js");
		const consolidateSpy = vi.spyOn(dayConsolidation, "consolidateDay").mockImplementation(async () => {
			const rebuiltMarkdown = `${renderConsolidationMetadata({
				kind: "day",
				formatVersion: 1,
				date: "2026-02-12",
				generatedAt: "2026-02-12T04:00:00.000Z",
				sessionCount: 1,
				projectCount: 1,
				sourceSessionIds: ["session-low-mdl"],
				sourceSessions: [
					{
						id: "session-low-mdl",
						project: "/my/project",
						title: "Low MDL",
						created: "2026-02-12T01:00:00.000Z",
						updated: "2026-02-12T01:10:00.000Z",
						provider: "claude",
						branch: null,
					},
				],
				projects: [{ project: "/my/project", sessionIds: ["session-low-mdl"] }],
			})}

# 2026-02-12 — Wednesday

## Facts Learned

- [decision] keep raw sessions canonical
- [decision] quality-driven semantic rebuild
- [fact] deterministic session lineage matters
- [fact] provenance remains attached to repaired artifacts
- [fact] canonical sessions preserve deterministic semantic rebuild quality
- [fact] semantic rebuild improves recall quality and preserves provenance

## Project: /my/project

**Decision**: Keep raw sessions canonical and rebuild low-MDL artifacts when quality improves.

**Summary**: Quality-driven semantic rebuild preserves provenance, deterministic lineage, and canonical sessions.
`;
			const rebuiltMetrics = computeMdlCompactionMetrics({
				originalText: rebuiltMarkdown,
				summaryText: extractSummaryText(rebuiltMarkdown, "daily"),
			});
			expect(rebuiltMetrics.mdlScore).toBeGreaterThan(0.6);
			fs.writeFileSync(lowMdlPath, rebuiltMarkdown, "utf-8");
			await indexConsolidationSummary("daily", "2026-02-12", rebuiltMarkdown);
			return rebuiltMarkdown;
		});

		try {
			const repaired = await repairSelectiveReembedding({
				dates: ["2026-02-12"],
				levels: ["daily"],
				reasons: ["low_mdl"],
				resyncRemote: false,
			});
			expect(repaired.plan.candidateCount).toBe(1);
			expect(repaired.reembedded).toBe(1);
			expect(repaired.qualityDeferred).toBe(0);
		} finally {
			consolidateSpy.mockRestore();
		}
	});
});
