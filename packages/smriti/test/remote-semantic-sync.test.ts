import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mockedCore = vi.hoisted(() => {
	let home = "/tmp/chitragupta-remote-sync";
	let settings: Record<string, unknown> = {};
	return {
		getChitraguptaHome: () => home,
		setChitraguptaHome: (value: string) => { home = value; },
		loadGlobalSettings: () => settings,
		setGlobalSettings: (value: Record<string, unknown>) => { settings = value; },
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

vi.mock("@chitragupta/core", () => mockedCore);
vi.mock("@chitragupta/swara", () => ({
	OllamaEmbedding: class { async isConfigured() { return false; } },
}));

import { DatabaseManager } from "../src/db/database.js";
import { indexConsolidationSummary, _resetConsolidationIndexer } from "../src/consolidation-indexer.js";
import { _setSummaryPackerForTests } from "../src/pakt-compression.js";
import { inspectRemoteSemanticSync, syncRemoteSemanticMirror } from "../src/remote-semantic-sync.js";
import { repairSelectiveReembedding } from "../src/selective-reembedding.js";
import { renderConsolidationMetadata } from "../src/consolidation-provenance.js";

let tmpDir: string;

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

> Implemented remote semantic mirror checks.

## Facts Learned

- [decision] keep raw sessions canonical
`;

function writeCuratedDay(markdown = CURATED_DAILY_MD): void {
	const daysDir = path.join(tmpDir, "days", "2026", "02");
	fs.mkdirSync(daysDir, { recursive: true });
	fs.writeFileSync(path.join(daysDir, "10.md"), markdown, "utf-8");
}

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-remote-sync-"));
	DatabaseManager.reset();
	_resetConsolidationIndexer();
	_setSummaryPackerForTests(null);
	mockedCore.setChitraguptaHome(tmpDir);
	mockedCore.setGlobalSettings({
		remoteSemantic: {
			provider: "qdrant",
			enabled: true,
			url: "http://qdrant.test",
			collection: "chitragupta_memory",
			timeoutMs: 2000,
			batchSize: 8,
		},
	});
	DatabaseManager.instance(tmpDir);
});

afterEach(() => {
	_setSummaryPackerForTests(null);
	vi.unstubAllGlobals();
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("remote semantic sync", () => {
	it("mirrors curated consolidation artifacts to Qdrant and records sync state", async () => {
		_setSummaryPackerForTests({
			packSummary: vi.fn(async () => ({
				runtime: "pakt",
				packedText: "@from text\nsummary|remote semantic mirror",
				format: "text",
				savings: 28,
			})),
		});
		writeCuratedDay();
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ status: { error: "not found" } }), { status: 404 });
			}
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "PUT") {
				return new Response(JSON.stringify({ result: true }), { status: 200 });
			}
			if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
				const body = JSON.parse(String(init.body ?? "{}")) as { points?: Array<{ payload?: Record<string, unknown> }> };
				expect(body.points?.[0]?.payload?.originalId).toBe("daily_summary:2026-02-10");
				expect(body.points?.[0]?.payload?.curated).toBe(true);
				expect(body.points?.[0]?.payload?.mdlMetrics).toEqual(
					expect.objectContaining({
						mdlScore: expect.any(Number),
						summaryReduction: expect.any(Number),
					}),
				);
				expect(body.points?.[0]?.payload?.compactionDecision).toEqual(
					expect.objectContaining({
						disposition: expect.any(String),
						reason: expect.any(String),
					}),
				);
				expect(
					body.points?.[0]?.payload?.packedSummary === null
					|| String(body.points?.[0]?.payload?.packedSummary).includes("@from text"),
				).toBe(true);
				return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(result.synced).toBe(1);
		expect(result.status.enabled).toBe(true);
		expect(result.status.syncedCount).toBe(1);
		expect(result.status.missingCount).toBe(0);
		expect(result.status.driftCount).toBe(0);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/collections/chitragupta_memory/points"),
			expect.objectContaining({
				method: "PUT",
				body: expect.stringContaining("\"embeddingEpoch\""),
			}),
		);

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(1);
		expect(inspected.missingCount).toBe(0);
		expect(inspected.driftCount).toBe(0);
		expect(inspected.remoteHealth?.ok).toBe(true);
	});

	it("detects remote drift when a curated artifact changes after sync", async () => {
		writeCuratedDay();
		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
			}
			if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
				return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
		writeCuratedDay(CURATED_DAILY_MD.replace("remote semantic mirror checks", "drifted curated artifact checks"));

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
		expect(inspected.driftCount).toBe(1);
		expect(inspected.issues[0]?.reason).toBe("stale_remote");
	});

	it("detects remote epoch drift when the synced artifact epoch no longer matches local embeddings", async () => {
		writeCuratedDay();
		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
			}
			if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
				return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
		const db = DatabaseManager.instance().get("agent");
		db.prepare("UPDATE remote_semantic_sync SET embedding_epoch = ? WHERE artifact_id = ?").run(
			"legacy-provider:legacy-model:384:provider",
			"daily_summary:2026-02-10",
		);

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
		expect(inspected.driftCount).toBe(1);
		expect(inspected.issues[0]?.reason).toBe("stale_remote_epoch");
	});

		it("detects remote quality drift when compaction metadata changes after sync", async () => {
			writeCuratedDay();
			await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
			}
			if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
				return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
		const db = DatabaseManager.instance().get("agent");
		db.prepare("UPDATE remote_semantic_sync SET quality_hash = ? WHERE artifact_id = ?").run(
			"legacy-quality-hash",
			"daily_summary:2026-02-10",
		);

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
			expect(inspected.driftCount).toBe(1);
			expect(inspected.issues[0]?.reason).toBe("stale_remote_quality");
		});

		it("repairs stale remote quality drift through selective re-embedding without forcing a local rebuild", async () => {
			writeCuratedDay();
			await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
			const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
					return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
				}
				if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
					return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
				}
				if (url.endsWith("/health") && init?.method === "GET") {
					return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
				}
				throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
			});
			vi.stubGlobal("fetch", fetchMock);

			await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
			const db = DatabaseManager.instance().get("agent");
			db.prepare("UPDATE remote_semantic_sync SET quality_hash = ? WHERE artifact_id = ?").run(
				"legacy-quality-hash",
				"daily_summary:2026-02-10",
			);

			const beforeRepair = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
			expect(beforeRepair.issues[0]?.reason).toBe("stale_remote_quality");

			const repaired = await repairSelectiveReembedding({
				dates: ["2026-02-10"],
				levels: ["daily"],
				reasons: ["stale_remote_quality"],
				resyncRemote: true,
			});
			expect(repaired.remoteSynced).toBe(1);
			expect(repaired.reembedded).toBeGreaterThanOrEqual(0);

			const afterRepair = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
			expect(afterRepair.driftCount).toBe(0);
			expect(afterRepair.issues).toEqual([]);
		});

		it("detects remote quality drift when packed embedding input changes but the summary text does not", async () => {
			_setSummaryPackerForTests({
				packSummary: vi.fn(async () => ({
					runtime: "pakt",
					packedText: "@from text\nremote semantic mirror checks|packed-alpha",
					format: "text",
					savings: 24,
				})),
			});
			writeCuratedDay();
			await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
			const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
					return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
				}
				if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
					return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
				}
				if (url.endsWith("/health") && init?.method === "GET") {
					return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
				}
				throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
			});
			vi.stubGlobal("fetch", fetchMock);

			await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
			_setSummaryPackerForTests({
				packSummary: vi.fn(async () => ({
					runtime: "pakt",
					packedText: "@from text\nremote semantic mirror checks|packed-beta",
					format: "text",
					savings: 24,
				})),
			});

			const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
			expect(inspected.syncedCount).toBe(0);
			expect(inspected.driftCount).toBe(1);
			expect(inspected.issues[0]?.reason).toBe("stale_remote_quality");
		});

		it("uses the current artifact compaction state instead of stale packed metadata when mirroring", async () => {
			_setSummaryPackerForTests({ packSummary: vi.fn(async () => null) });
			writeCuratedDay(`${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`);
			await indexConsolidationSummary(
				"daily",
				"2026-02-10",
				`${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`,
			);

			const vectorsDb = DatabaseManager.instance().get("vectors");
			const row = vectorsDb.prepare("SELECT metadata FROM embeddings WHERE id = ?").get("daily_summary:2026-02-10") as {
				metadata: string;
			};
			const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
			metadata.packedSummaryText = "stale-packed-summary";
			metadata.compression = { runtime: "pakt", packedText: "stale-packed-summary", format: "text", savings: 99 };
			vectorsDb.prepare("UPDATE embeddings SET metadata = ? WHERE id = ?").run(
				JSON.stringify(metadata),
				"daily_summary:2026-02-10",
			);

			const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
					return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
				}
				if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
					const body = JSON.parse(String(init.body ?? "{}")) as { points?: Array<{ payload?: Record<string, unknown> }> };
					expect(body.points?.[0]?.payload?.packedSummary).toBeNull();
					expect(body.points?.[0]?.payload?.compression).toBeNull();
					expect(body.points?.[0]?.payload?.packedDecision).toBeNull();
					return new Response(JSON.stringify({ result: { status: "acknowledged" } }), { status: 200 });
				}
				if (url.endsWith("/health") && init?.method === "GET") {
					return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
				}
				throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
			});
			vi.stubGlobal("fetch", fetchMock);

			const result = await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
			expect(result.synced).toBe(1);
		});

		it("reports first-time remote push failures as remote_error instead of missing_remote", async () => {
			writeCuratedDay();
			await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
			}
			if (url.endsWith("/collections/chitragupta_memory/points") && init?.method === "PUT") {
				return new Response(JSON.stringify({ status: { error: "boom" } }), { status: 500 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await syncRemoteSemanticMirror({ dates: ["2026-02-10"], levels: ["daily"] });
		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
		expect(inspected.driftCount).toBe(1);
		expect(inspected.missingCount).toBe(0);
		expect(inspected.issues[0]?.reason).toBe("remote_error");
	});

	it("defers severe compression-quality debt instead of reporting it as missing_remote", async () => {
		_setSummaryPackerForTests({
			packSummary: vi.fn(async () => ({
				runtime: "pakt",
				packedText: "pakt:xyz",
				format: "text",
				savings: 92,
			})),
		});
		writeCuratedDay(`${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`);

		await indexConsolidationSummary(
			"daily",
			"2026-02-10",
			`${CURATED_DAILY_MD}\n${"Deterministic lineage and semantic promotion. ".repeat(24)}`,
		);

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
		expect(inspected.missingCount).toBe(0);
		expect(inspected.driftCount).toBe(0);
		expect(inspected.qualityDeferredCount).toBe(1);
		expect(inspected.issues[0]?.reason).toBe("deferred_quality");
	});

	it("does not mirror stale local embeddings when repairLocal is disabled", async () => {
		writeCuratedDay();
		await indexConsolidationSummary("daily", "2026-02-10", CURATED_DAILY_MD);
		const vectorsDb = DatabaseManager.instance().get("vectors");
		const row = vectorsDb.prepare("SELECT metadata FROM embeddings WHERE id = ?").get("daily_summary:2026-02-10") as {
			metadata: string;
		};
		const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		metadata.embeddingEpoch = {
			providerId: "legacy-provider",
			modelId: "legacy-model",
			dimensions: 384,
			strategy: "provider",
			epoch: "legacy-provider:legacy-model:384:provider",
		};
		vectorsDb.prepare("UPDATE embeddings SET metadata = ? WHERE id = ?").run(
			JSON.stringify(metadata),
			"daily_summary:2026-02-10",
		);

		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/collections/chitragupta_memory") && init?.method === "GET") {
				return new Response(JSON.stringify({ result: { config: { params: { vectors: { size: 128 } } } } }), { status: 200 });
			}
			if (url.endsWith("/health") && init?.method === "GET") {
				return new Response(JSON.stringify({ title: "ok" }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await syncRemoteSemanticMirror({
			dates: ["2026-02-10"],
			levels: ["daily"],
			repairLocal: false,
		});
		expect(result.synced).toBe(0);
		expect(fetchMock).not.toHaveBeenCalledWith(
			expect.stringContaining("/collections/chitragupta_memory/points"),
			expect.anything(),
		);

		const inspected = await inspectRemoteSemanticSync({ dates: ["2026-02-10"], levels: ["daily"] });
		expect(inspected.syncedCount).toBe(0);
		expect(inspected.driftCount).toBe(1);
		expect(inspected.issues[0]?.reason).toBe("remote_error");
		expect(inspected.issues[0]?.error).toContain("embedding epoch is stale");
	});
});
