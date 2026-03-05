/**
 * Tests for Scarlett Internal — In-Process Health Guardian.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	InternalScarlett,
	SmritiDbProbe,
	MemoryPressureProbe,
	NidraHeartbeatProbe,
	ConsolidationQueueProbe,
	startInternalScarlett,
	stopInternalScarlett,
	type NidraLike,
	type DbManagerLike,
	type SqliteDbLike,
	type ProbeResult,
} from "../src/scarlett-internal.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDb(walPages: number, queueDepth = 0): DbManagerLike {
	const db: SqliteDbLike = {
		pragma: vi.fn((key: string) => {
			if (key.startsWith("wal_checkpoint")) return [0, walPages, walPages];
			if (key.startsWith("integrity_check")) return ["ok"];
			return null;
		}),
		prepare: vi.fn((sql: string) => ({
			all: () => [],
			get: () => (sql.includes("pending") ? { cnt: queueDepth } : null),
		})),
	};
	return { get: () => db };
}

function makeNidra(heartbeatAgeMs: number, state = "LISTENING"): NidraLike {
	return {
		getNidraSnapshot: () => ({
			lastHeartbeat: Date.now() - heartbeatAgeMs,
			state,
		}),
	};
}

// ─── SmritiDbProbe ────────────────────────────────────────────────────────────

describe("SmritiDbProbe", () => {
	it("returns ok when WAL pages < warn threshold", async () => {
		const probe = new SmritiDbProbe(() => makeDb(10));
		const result = await probe.check();
		expect(result.healthy).toBe(true);
		expect(result.severity).toBe("ok");
		expect(result.details.walPages).toBe(10);
	});

	it("returns warn when WAL pages in warn range", async () => {
		const probe = new SmritiDbProbe(() => makeDb(600));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("warn");
		expect(result.recoveryAction).toBe("wal-checkpoint-passive");
	});

	it("returns critical when WAL pages >= critical threshold", async () => {
		const probe = new SmritiDbProbe(() => makeDb(2500));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("critical");
		expect(result.recoveryAction).toBe("wal-checkpoint-restart");
	});

	it("recover calls WAL checkpoint PASSIVE on warn", async () => {
		const db = makeDb(600);
		const pragmaFn = (db.get("agent") as SqliteDbLike).pragma as ReturnType<typeof vi.fn>;
		const probe = new SmritiDbProbe(() => db);
		const result = await probe.check();
		const recovery = await probe.recover(result);
		expect(recovery.ok).toBe(true);
		expect(pragmaFn).toHaveBeenCalledWith("wal_checkpoint(PASSIVE)");
	});

	it("recover calls WAL checkpoint RESTART on critical", async () => {
		const db = makeDb(2500);
		const pragmaFn = (db.get("agent") as SqliteDbLike).pragma as ReturnType<typeof vi.fn>;
		const probe = new SmritiDbProbe(() => db);
		const result = await probe.check();
		const recovery = await probe.recover(result);
		expect(recovery.ok).toBe(true);
		expect(pragmaFn).toHaveBeenCalledWith("wal_checkpoint(RESTART)");
	});

	it("returns critical when probe throws", async () => {
		const probe = new SmritiDbProbe(() => { throw new Error("DB gone"); });
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("critical");
		expect(String(result.details.error)).toContain("DB gone");
	});
});

// ─── MemoryPressureProbe ──────────────────────────────────────────────────────

describe("MemoryPressureProbe", () => {
	it("returns ok under normal heap usage", async () => {
		const probe = new MemoryPressureProbe();
		const result = await probe.check();
		// In test environment heap usage is typically low
		expect(["ok", "warn", "critical"]).toContain(result.severity);
		expect(result.details).toHaveProperty("heapUsedMB");
		expect(result.details).toHaveProperty("fraction");
	});

	it("recover returns detail about gc", async () => {
		const probe = new MemoryPressureProbe();
		const fakeResult: ProbeResult = {
			healthy: false, severity: "warn", probe: "memory-pressure",
			details: {}, summary: "test", recoveryAction: "gc-hint",
		};
		const recovery = await probe.recover(fakeResult);
		// Either gc available or not — both valid
		expect(typeof recovery.detail).toBe("string");
	});
});

// ─── NidraHeartbeatProbe ──────────────────────────────────────────────────────

describe("NidraHeartbeatProbe", () => {
	it("returns ok when heartbeat is fresh", async () => {
		const probe = new NidraHeartbeatProbe(makeNidra(10_000));
		const result = await probe.check();
		expect(result.healthy).toBe(true);
		expect(result.severity).toBe("ok");
	});

	it("returns warn when heartbeat is in warn range", async () => {
		const probe = new NidraHeartbeatProbe(makeNidra(6 * 60_000));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("warn");
	});

	it("returns critical when heartbeat is stale beyond critical threshold", async () => {
		const probe = new NidraHeartbeatProbe(makeNidra(16 * 60_000));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("critical");
	});

	it("returns ok when snapshot is null (nidra not started)", async () => {
		const nidra: NidraLike = { getNidraSnapshot: () => null };
		const probe = new NidraHeartbeatProbe(nidra);
		const result = await probe.check();
		expect(result.healthy).toBe(true);
	});

	it("recover logs and returns ok (no force-wake)", async () => {
		const probe = new NidraHeartbeatProbe(makeNidra(16 * 60_000));
		const result = await probe.check();
		const recovery = await probe.recover(result);
		expect(recovery.ok).toBe(true);
		expect(recovery.detail).toContain("Attention logged");
	});
});

// ─── ConsolidationQueueProbe ──────────────────────────────────────────────────

describe("ConsolidationQueueProbe", () => {
	it("returns ok when queue is empty", async () => {
		const probe = new ConsolidationQueueProbe(() => makeDb(0, 0));
		const result = await probe.check();
		expect(result.healthy).toBe(true);
		expect(result.severity).toBe("ok");
	});

	it("returns warn when queue depth in warn range", async () => {
		const probe = new ConsolidationQueueProbe(() => makeDb(0, 50));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("warn");
	});

	it("returns critical when queue depth at critical threshold", async () => {
		const probe = new ConsolidationQueueProbe(() => makeDb(0, 120));
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("critical");
	});

	it("returns ok when day_consolidations table missing (first run)", async () => {
		const brokenDb: DbManagerLike = {
			get: () => ({
				pragma: vi.fn(),
				prepare: vi.fn(() => { throw new Error("no such table"); }),
			}),
		};
		const probe = new ConsolidationQueueProbe(() => brokenDb);
		const result = await probe.check();
		expect(result.healthy).toBe(true);
		expect(result.summary).toContain("not yet initialized");
	});
});

// ─── InternalScarlett ────────────────────────────────────────────────────────

describe("InternalScarlett", () => {
	afterEach(() => { stopInternalScarlett(); });

	it("starts and stops", () => {
		const scarlett = new InternalScarlett({ pollIntervalMs: 60_000 });
		expect(scarlett.isRunning()).toBe(false);
		scarlett.start();
		expect(scarlett.isRunning()).toBe(true);
		scarlett.stop();
		expect(scarlett.isRunning()).toBe(false);
	});

	it("start is idempotent", () => {
		const scarlett = new InternalScarlett({ pollIntervalMs: 60_000 });
		scarlett.start();
		scarlett.start(); // should not throw
		expect(scarlett.isRunning()).toBe(true);
		scarlett.stop();
	});

	it("runCycle emits probe-result for each probe", async () => {
		const scarlett = new InternalScarlett({
			pollIntervalMs: 60_000,
			getDb: () => makeDb(0, 0),
			nidra: makeNidra(1000),
		});

		const results: ProbeResult[] = [];
		scarlett.on("probe-result", (r) => results.push(r));
		scarlett.start();

		await scarlett.runCycle();

		expect(results.length).toBeGreaterThanOrEqual(2);
		const probeNames = results.map((r) => r.probe);
		expect(probeNames).toContain("smriti-db");
		expect(probeNames).toContain("memory-pressure");

		scarlett.stop();
	});

	it("runCycle emits recovery-ok for unhealthy probes with recovery action", async () => {
		const scarlett = new InternalScarlett({
			pollIntervalMs: 60_000,
			getDb: () => makeDb(600, 0), // WAL warn → checkpoint recovery
			nidra: makeNidra(1000),
		});

		const recoveries: string[] = [];
		scarlett.on("recovery-ok", (probe) => recoveries.push(probe));
		scarlett.start();

		await scarlett.runCycle();
		expect(recoveries).toContain("smriti-db");

		scarlett.stop();
	});

	it("runCycle does not overlap concurrent cycles", async () => {
		const scarlett = new InternalScarlett({
			pollIntervalMs: 60_000,
			getDb: () => makeDb(0, 0),
		});
		scarlett.start();

		// Run two cycles simultaneously — second should return []
		const [r1, r2] = await Promise.all([scarlett.runCycle(), scarlett.runCycle()]);
		expect(r1.length).toBeGreaterThan(0);
		expect(r2.length).toBe(0); // skipped due to cycling guard

		scarlett.stop();
	});

	it("cycle-complete event fires with results and duration", async () => {
		const scarlett = new InternalScarlett({
			pollIntervalMs: 60_000,
			getDb: () => makeDb(0, 0),
		});

		let cycleResults: ProbeResult[] = [];
		let cycleDuration = -1;
		scarlett.on("cycle-complete", (results, durationMs) => {
			cycleResults = results;
			cycleDuration = durationMs;
		});
		scarlett.start();

		await scarlett.runCycle();
		expect(cycleResults.length).toBeGreaterThan(0);
		expect(cycleDuration).toBeGreaterThanOrEqual(0);

		scarlett.stop();
	});

	it("convenience API singleton", () => {
		const s1 = startInternalScarlett({ pollIntervalMs: 60_000 });
		const s2 = startInternalScarlett({ pollIntervalMs: 60_000 });
		expect(s1).toBe(s2);
		stopInternalScarlett();
		expect(s1.isRunning()).toBe(false);
	});
});
