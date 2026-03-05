/**
 * Tests for Scarlett Signal Bridge — Wire 1 of the nervous system.
 */

import { describe, it, expect, vi } from "vitest";
import {
	injectProbeSignal,
	injectCycleSignals,
	type TranscendenceEngineRef,
	type RegressionAlertLike,
} from "../src/scarlett-signal-bridge.js";
import type { ProbeResult } from "../src/scarlett-internal.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEngine(): { engine: TranscendenceEngineRef; calls: RegressionAlertLike[][] } {
	const calls: RegressionAlertLike[][] = [];
	const engine: TranscendenceEngineRef = {
		ingestRegressions: vi.fn((alerts) => { calls.push(alerts); }),
	};
	return { engine, calls };
}

function makeProbe(
	probe: string,
	severity: "ok" | "warn" | "critical",
	summary = "test summary",
): ProbeResult {
	return {
		healthy: severity === "ok",
		severity,
		probe,
		details: {},
		summary,
	};
}

// ─── injectProbeSignal ────────────────────────────────────────────────────────

describe("injectProbeSignal", () => {
	it("skips healthy (ok) probes", () => {
		const { engine, calls } = makeEngine();
		injectProbeSignal(makeProbe("smriti-db", "ok"), engine);
		expect(calls).toHaveLength(0);
	});

	it("injects warn probe as warning severity", () => {
		const { engine, calls } = makeEngine();
		injectProbeSignal(makeProbe("smriti-db", "warn", "WAL elevated"), engine);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].severity).toBe("warning");
		expect(calls[0][0].errorSignature).toBe("smriti");
		expect(calls[0][0].description).toBe("WAL elevated");
	});

	it("injects critical probe as critical severity", () => {
		const { engine, calls } = makeEngine();
		injectProbeSignal(makeProbe("nidra-heartbeat", "critical", "Nidra stale"), engine);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].severity).toBe("critical");
		expect(calls[0][0].errorSignature).toBe("nidra");
	});

	it("maps all known probe names to correct entities", () => {
		const probeToEntity: Array<[string, string]> = [
			["smriti-db", "smriti"],
			["nidra-heartbeat", "nidra"],
			["consolidation-queue", "consolidation"],
			["memory-pressure", "memory"],
		];

		for (const [probe, expectedEntity] of probeToEntity) {
			const { engine, calls } = makeEngine();
			injectProbeSignal(makeProbe(probe, "warn"), engine);
			expect(calls[0][0].errorSignature).toBe(expectedEntity);
		}
	});

	it("uses probe name as entity for unknown probes", () => {
		const { engine, calls } = makeEngine();
		injectProbeSignal(makeProbe("future-probe", "warn"), engine);
		expect(calls[0][0].errorSignature).toBe("future-probe");
	});

	it("sets occurrence count by severity: critical=5, warning=3", () => {
		const { engine: e1, calls: c1 } = makeEngine();
		injectProbeSignal(makeProbe("smriti-db", "critical"), e1);
		expect(c1[0][0].currentOccurrences).toBe(5);

		const { engine: e2, calls: c2 } = makeEngine();
		injectProbeSignal(makeProbe("smriti-db", "warn"), e2);
		expect(c2[0][0].currentOccurrences).toBe(3);
	});

	it("sets previousOccurrences to 0 (external signal, no history)", () => {
		const { engine, calls } = makeEngine();
		injectProbeSignal(makeProbe("memory-pressure", "warn"), engine);
		expect(calls[0][0].previousOccurrences).toBe(0);
	});
});

// ─── injectCycleSignals ───────────────────────────────────────────────────────

describe("injectCycleSignals", () => {
	it("returns 0 and makes no call when all probes are healthy", () => {
		const { engine, calls } = makeEngine();
		const count = injectCycleSignals(
			[makeProbe("smriti-db", "ok"), makeProbe("memory-pressure", "ok")],
			engine,
		);
		expect(count).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("returns count of unhealthy probes injected", () => {
		const { engine, calls } = makeEngine();
		const count = injectCycleSignals(
			[
				makeProbe("smriti-db", "critical"),
				makeProbe("memory-pressure", "ok"),
				makeProbe("nidra-heartbeat", "warn"),
			],
			engine,
		);
		expect(count).toBe(2);
		expect(calls).toHaveLength(1); // single batched call
		expect(calls[0]).toHaveLength(2);
	});

	it("batches all unhealthy probes into a single ingestRegressions call", () => {
		const { engine, calls } = makeEngine();
		injectCycleSignals(
			[
				makeProbe("smriti-db", "critical"),
				makeProbe("nidra-heartbeat", "critical"),
				makeProbe("consolidation-queue", "warn"),
			],
			engine,
		);
		expect(calls).toHaveLength(1);
		const entities = calls[0].map((a) => a.errorSignature);
		expect(entities).toContain("smriti");
		expect(entities).toContain("nidra");
		expect(entities).toContain("consolidation");
	});

	it("handles empty results array", () => {
		const { engine, calls } = makeEngine();
		const count = injectCycleSignals([], engine);
		expect(count).toBe(0);
		expect(calls).toHaveLength(0);
	});
});
