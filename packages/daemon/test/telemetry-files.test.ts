import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeTelemetryFingerprint,
	getTelemetryInstancesDir,
	readTelemetryTimeline,
	scanTelemetryInstances,
} from "../src/telemetry-files.js";

describe("telemetry-files", () => {
	let tmpHome: string;
	const prevHome = process.env.CHITRAGUPTA_HOME;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-telemetry-test-"));
		process.env.CHITRAGUPTA_HOME = tmpHome;
		fs.mkdirSync(getTelemetryInstancesDir(), { recursive: true });
	});

	afterEach(() => {
		if (prevHome == null) delete process.env.CHITRAGUPTA_HOME;
		else process.env.CHITRAGUPTA_HOME = prevHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("removes stale heartbeat files and records timeline events", () => {
		const dir = getTelemetryInstancesDir();
		const stalePath = path.join(dir, "1111.json");
		const freshPath = path.join(dir, "2222.json");

		fs.writeFileSync(stalePath, JSON.stringify({ pid: 1111, heartbeatSeq: 1, state: "idle" }));
		fs.writeFileSync(freshPath, JSON.stringify({ pid: 2222, heartbeatSeq: 2, state: "busy" }));

		const staleMs = Date.now() - 120_000;
		fs.utimesSync(stalePath, staleMs / 1000, staleMs / 1000);

		const result = scanTelemetryInstances({
			staleMs: 10_000,
			cleanupStale: true,
			cleanupCorrupt: true,
			cleanupOrphan: false,
		});

		expect(result.removedStale).toBe(1);
		expect(result.instances).toHaveLength(1);
		expect(fs.existsSync(stalePath)).toBe(false);

		const timeline = readTelemetryTimeline(10);
		expect(timeline.length).toBeGreaterThanOrEqual(1);
		expect(timeline[0].type).toBe("stale_removed");
	});

	it("removes corrupt heartbeat files", () => {
		const dir = getTelemetryInstancesDir();
		const corruptPath = path.join(dir, "3333.json");
		fs.writeFileSync(corruptPath, "{not-json");

		const result = scanTelemetryInstances({
			staleMs: 10_000,
			cleanupStale: true,
			cleanupCorrupt: true,
			cleanupOrphan: false,
		});

		expect(result.removedCorrupt).toBe(1);
		expect(result.instances).toHaveLength(0);
		expect(fs.existsSync(corruptPath)).toBe(false);
	});

	it("removes orphan heartbeat files when PID is dead", () => {
		const dir = getTelemetryInstancesDir();
		const orphanPath = path.join(dir, "9999999.json");
		fs.writeFileSync(orphanPath, JSON.stringify({ pid: 9_999_999, heartbeatSeq: 1, state: "idle" }));

		const result = scanTelemetryInstances({
			staleMs: 10_000,
			cleanupStale: false,
			cleanupCorrupt: false,
			cleanupOrphan: true,
		});

		expect(result.removedOrphan).toBe(1);
		expect(result.instances).toHaveLength(0);
		expect(fs.existsSync(orphanPath)).toBe(false);
	});

	it("computes stable fingerprints from instance state", () => {
		const a = computeTelemetryFingerprint([{ pid: 1, heartbeatSeq: 2, state: "idle" }]);
		const b = computeTelemetryFingerprint([{ pid: 1, heartbeatSeq: 2, state: "idle" }]);
		const c = computeTelemetryFingerprint([{ pid: 1, heartbeatSeq: 3, state: "idle" }]);

		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^[0-9a-f]{8}$/);
	});
});

