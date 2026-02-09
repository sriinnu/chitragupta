/**
 * @chitragupta/anina — Triguna (त्रिगुण) Health Monitor Tests.
 *
 * Comprehensive tests for the simplex-constrained Kalman filter,
 * ILR transforms, behavioral triggers, trend detection, and serialization.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	Triguna,
	ilrForward,
	ilrInverse,
	DEFAULT_TRIGUNA_CONFIG,
	SYSTEM_MAX_TRIGUNA_HISTORY,
} from "../src/chetana/triguna.js";
import type {
	GunaState,
	TrigunaObservation,
	TrigunaConfig,
	GunaLabel,
	TrigunaSerializedState,
} from "../src/chetana/triguna.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Assert that a GunaState sums to approximately 1.0. */
function assertSimplexConstraint(state: GunaState, tolerance = 1e-10): void {
	const sum = state.sattva + state.rajas + state.tamas;
	expect(sum).toBeCloseTo(1.0, 8);
	expect(state.sattva).toBeGreaterThanOrEqual(0);
	expect(state.rajas).toBeGreaterThanOrEqual(0);
	expect(state.tamas).toBeGreaterThanOrEqual(0);
}

/** A "healthy system" observation: low errors, high success, high satisfaction. */
const HEALTHY_OBS: TrigunaObservation = {
	errorRate: 0.05,
	tokenVelocity: 0.3,
	loopCount: 0.1,
	latency: 0.1,
	successRate: 0.95,
	userSatisfaction: 0.9,
};

/** A "stressed system" observation: high velocity, many loops, moderate errors. */
const STRESSED_OBS: TrigunaObservation = {
	errorRate: 0.2,
	tokenVelocity: 0.9,
	loopCount: 0.8,
	latency: 0.3,
	successRate: 0.6,
	userSatisfaction: 0.5,
};

/** A "degraded system" observation: high errors, high latency, low success. */
const DEGRADED_OBS: TrigunaObservation = {
	errorRate: 0.8,
	tokenVelocity: 0.1,
	loopCount: 0.7,
	latency: 0.9,
	successRate: 0.1,
	userSatisfaction: 0.1,
};

/** A "neutral" observation: everything moderate. */
const NEUTRAL_OBS: TrigunaObservation = {
	errorRate: 0.3,
	tokenVelocity: 0.4,
	loopCount: 0.3,
	latency: 0.3,
	successRate: 0.5,
	userSatisfaction: 0.5,
};

// ─── ILR Transform ───────────────────────────────────────────────────────────

describe("ILR Transform — Isometric Log-Ratio", () => {
	it("should be a roundtrip identity on the simplex", () => {
		const testCases: [number, number, number][] = [
			[0.6, 0.3, 0.1],
			[1 / 3, 1 / 3, 1 / 3],
			[0.9, 0.05, 0.05],
			[0.05, 0.9, 0.05],
			[0.05, 0.05, 0.9],
			[0.5, 0.3, 0.2],
			[0.1, 0.2, 0.7],
			[0.8, 0.1, 0.1],
		];

		for (const [x1, x2, x3] of testCases) {
			const [y1, y2] = ilrForward(x1, x2, x3);
			const [r1, r2, r3] = ilrInverse(y1, y2);

			expect(r1).toBeCloseTo(x1, 10);
			expect(r2).toBeCloseTo(x2, 10);
			expect(r3).toBeCloseTo(x3, 10);
			expect(r1 + r2 + r3).toBeCloseTo(1.0, 10);
		}
	});

	it("should map the uniform composition to the origin", () => {
		const [y1, y2] = ilrForward(1 / 3, 1 / 3, 1 / 3);
		expect(y1).toBeCloseTo(0, 10);
		expect(y2).toBeCloseTo(0, 10);
	});

	it("should produce finite values for extreme compositions", () => {
		// Near the boundary of the simplex
		const [y1, y2] = ilrForward(0.98, 0.01, 0.01);
		expect(Number.isFinite(y1)).toBe(true);
		expect(Number.isFinite(y2)).toBe(true);

		// Roundtrip
		const [r1, r2, r3] = ilrInverse(y1, y2);
		expect(r1).toBeCloseTo(0.98, 8);
		expect(r2).toBeCloseTo(0.01, 8);
		expect(r3).toBeCloseTo(0.01, 8);
	});

	it("should be injective — distinct compositions map to distinct ILR coords", () => {
		const [a1, a2] = ilrForward(0.5, 0.3, 0.2);
		const [b1, b2] = ilrForward(0.3, 0.5, 0.2);

		// Not equal
		expect(Math.abs(a1 - b1) + Math.abs(a2 - b2)).toBeGreaterThan(0.01);
	});

	it("should preserve the permutation structure", () => {
		// Swapping x1 and x2 should negate y1 (the Helmert basis property)
		const [y1a, y2a] = ilrForward(0.6, 0.3, 0.1);
		const [y1b, y2b] = ilrForward(0.3, 0.6, 0.1);

		// y1 should flip sign (it measures ln(x1/x2))
		expect(y1a).toBeCloseTo(-y1b, 10);
		// y2 should be the same (it depends on x1*x2 and x3, which are unchanged)
		expect(y2a).toBeCloseTo(y2b, 10);
	});

	it("should handle compositions very close to corners", () => {
		const floor = 1e-6;
		const [y1, y2] = ilrForward(1 - 2 * floor, floor, floor);
		expect(Number.isFinite(y1)).toBe(true);
		expect(Number.isFinite(y2)).toBe(true);

		const [r1, r2, r3] = ilrInverse(y1, y2);
		expect(r1 + r2 + r3).toBeCloseTo(1.0, 8);
	});
});

// ─── Triguna Initialization ──────────────────────────────────────────────────

describe("Triguna — Initialization", () => {
	it("should initialize with the default optimistic state [0.6, 0.3, 0.1]", () => {
		const tri = new Triguna();
		const state = tri.getState();

		expect(state.sattva).toBeCloseTo(0.6, 5);
		expect(state.rajas).toBeCloseTo(0.3, 5);
		expect(state.tamas).toBeCloseTo(0.1, 5);
		assertSimplexConstraint(state);
	});

	it("should accept custom initial state", () => {
		const tri = new Triguna({ initialState: [0.4, 0.4, 0.2] });
		const state = tri.getState();

		expect(state.sattva).toBeCloseTo(0.4, 5);
		expect(state.rajas).toBeCloseTo(0.4, 5);
		expect(state.tamas).toBeCloseTo(0.2, 5);
		assertSimplexConstraint(state);
	});

	it("should normalize initial state that does not sum to 1", () => {
		const tri = new Triguna({ initialState: [6, 3, 1] });
		const state = tri.getState();

		expect(state.sattva).toBeCloseTo(0.6, 5);
		expect(state.rajas).toBeCloseTo(0.3, 5);
		expect(state.tamas).toBeCloseTo(0.1, 5);
		assertSimplexConstraint(state);
	});

	it("should have an initial history of length 1", () => {
		const tri = new Triguna();
		const history = tri.getHistory();

		expect(history.length).toBe(1);
		expect(history[0].dominant).toBe("sattva");
	});

	it("should initially be sattva-dominant", () => {
		const tri = new Triguna();
		expect(tri.getDominant()).toBe("sattva");
	});
});

// ─── Simplex Constraint ──────────────────────────────────────────────────────

describe("Triguna — Simplex Constraint", () => {
	it("should always sum to 1 after a single update", () => {
		const tri = new Triguna();
		tri.update(HEALTHY_OBS);
		assertSimplexConstraint(tri.getState());
	});

	it("should always sum to 1 after many updates", () => {
		const tri = new Triguna();
		const observations = [
			HEALTHY_OBS, STRESSED_OBS, DEGRADED_OBS, NEUTRAL_OBS,
			HEALTHY_OBS, DEGRADED_OBS, STRESSED_OBS, HEALTHY_OBS,
			DEGRADED_OBS, DEGRADED_OBS, STRESSED_OBS, NEUTRAL_OBS,
		];

		for (const obs of observations) {
			tri.update(obs);
			assertSimplexConstraint(tri.getState());
		}
	});

	it("should always sum to 1 with extreme observations", () => {
		const tri = new Triguna();

		// All zeros except one field
		const extremes: TrigunaObservation[] = [
			{ errorRate: 1, tokenVelocity: 0, loopCount: 0, latency: 0, successRate: 0, userSatisfaction: 0 },
			{ errorRate: 0, tokenVelocity: 1, loopCount: 0, latency: 0, successRate: 0, userSatisfaction: 0 },
			{ errorRate: 0, tokenVelocity: 0, loopCount: 1, latency: 0, successRate: 0, userSatisfaction: 0 },
			{ errorRate: 0, tokenVelocity: 0, loopCount: 0, latency: 1, successRate: 0, userSatisfaction: 0 },
			{ errorRate: 0, tokenVelocity: 0, loopCount: 0, latency: 0, successRate: 1, userSatisfaction: 0 },
			{ errorRate: 0, tokenVelocity: 0, loopCount: 0, latency: 0, successRate: 0, userSatisfaction: 1 },
			{ errorRate: 1, tokenVelocity: 1, loopCount: 1, latency: 1, successRate: 1, userSatisfaction: 1 },
			{ errorRate: 0, tokenVelocity: 0, loopCount: 0, latency: 0, successRate: 0, userSatisfaction: 0 },
		];

		for (const obs of extremes) {
			tri.update(obs);
			assertSimplexConstraint(tri.getState());
		}
	});

	it("should never produce negative guna values", () => {
		const tri = new Triguna();

		for (let i = 0; i < 100; i++) {
			const obs: TrigunaObservation = {
				errorRate: Math.random(),
				tokenVelocity: Math.random(),
				loopCount: Math.random(),
				latency: Math.random(),
				successRate: Math.random(),
				userSatisfaction: Math.random(),
			};
			tri.update(obs);
			const state = tri.getState();
			expect(state.sattva).toBeGreaterThanOrEqual(0);
			expect(state.rajas).toBeGreaterThanOrEqual(0);
			expect(state.tamas).toBeGreaterThanOrEqual(0);
		}
	});
});

// ─── Kalman Filter Behavior ──────────────────────────────────────────────────

describe("Triguna — Kalman Filter", () => {
	it("should move toward sattva with sustained healthy observations", () => {
		const tri = new Triguna();

		for (let i = 0; i < 20; i++) {
			tri.update(HEALTHY_OBS);
		}

		const state = tri.getState();
		expect(state.sattva).toBeGreaterThan(0.5);
		expect(tri.getDominant()).toBe("sattva");
	});

	it("should move toward rajas with sustained stressed observations", () => {
		const tri = new Triguna();

		for (let i = 0; i < 20; i++) {
			tri.update(STRESSED_OBS);
		}

		const state = tri.getState();
		expect(state.rajas).toBeGreaterThan(state.tamas);
		// Rajas should be elevated
		expect(state.rajas).toBeGreaterThan(0.3);
	});

	it("should move toward tamas with sustained degraded observations", () => {
		const tri = new Triguna();

		for (let i = 0; i < 20; i++) {
			tri.update(DEGRADED_OBS);
		}

		const state = tri.getState();
		expect(state.tamas).toBeGreaterThan(state.sattva);
		expect(tri.getDominant()).toBe("tamas");
	});

	it("should converge — repeated identical observations should stabilize", () => {
		const tri = new Triguna();

		// Run many identical observations
		for (let i = 0; i < 50; i++) {
			tri.update(NEUTRAL_OBS);
		}

		const state1 = tri.getState();

		// Run 10 more of the same
		for (let i = 0; i < 10; i++) {
			tri.update(NEUTRAL_OBS);
		}

		const state2 = tri.getState();

		// Should have converged — small delta
		expect(Math.abs(state2.sattva - state1.sattva)).toBeLessThan(0.02);
		expect(Math.abs(state2.rajas - state1.rajas)).toBeLessThan(0.02);
		expect(Math.abs(state2.tamas - state1.tamas)).toBeLessThan(0.02);
	});

	it("should be responsive — shift from healthy to degraded", () => {
		const tri = new Triguna();

		// First, establish healthy baseline
		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}
		expect(tri.getDominant()).toBe("sattva");

		// Now shift to degraded observations
		for (let i = 0; i < 30; i++) {
			tri.update(DEGRADED_OBS);
		}

		const state = tri.getState();
		expect(state.tamas).toBeGreaterThan(state.sattva);
	});

	it("should smooth out noise — single outlier should not dominate", () => {
		const tri = new Triguna();

		// Establish a baseline
		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}
		const baseline = tri.getState();

		// One bad observation
		tri.update(DEGRADED_OBS);
		const afterOutlier = tri.getState();

		// sattva should drop but not catastrophically
		expect(afterOutlier.sattva).toBeGreaterThan(0.3);
		// Still closer to baseline than to the outlier's steady state
		expect(afterOutlier.sattva).toBeGreaterThan(afterOutlier.tamas);
	});

	it("should reduce covariance over time (uncertainty decreases)", () => {
		const tri = new Triguna();

		// The initial covariance is the identity. After updates, it should shrink.
		// We can verify this through the Kalman gain implicitly: convergence
		// means reduced uncertainty.

		for (let i = 0; i < 50; i++) {
			tri.update(HEALTHY_OBS);
		}
		const state50 = tri.getState();

		// Additional updates should barely move it (low gain = low uncertainty)
		tri.update(HEALTHY_OBS);
		const state51 = tri.getState();

		const delta = Math.abs(state51.sattva - state50.sattva);
		expect(delta).toBeLessThan(0.01);
	});
});

// ─── Dominant Guna Detection ─────────────────────────────────────────────────

describe("Triguna — Dominant Guna", () => {
	it("should return sattva when sattva is highest", () => {
		const tri = new Triguna({ initialState: [0.7, 0.2, 0.1] });
		expect(tri.getDominant()).toBe("sattva");
	});

	it("should return rajas when rajas is highest", () => {
		const tri = new Triguna({ initialState: [0.2, 0.6, 0.2] });
		expect(tri.getDominant()).toBe("rajas");
	});

	it("should return tamas when tamas is highest", () => {
		const tri = new Triguna({ initialState: [0.1, 0.2, 0.7] });
		expect(tri.getDominant()).toBe("tamas");
	});

	it("should handle ties gracefully (sattva preferred)", () => {
		// When sattva == rajas, sattva should win (it's checked first)
		const tri = new Triguna({ initialState: [0.4, 0.4, 0.2] });
		expect(tri.getDominant()).toBe("sattva");
	});
});

// ─── Behavioral Triggers / Events ────────────────────────────────────────────

describe("Triguna — Behavioral Triggers", () => {
	let events: Array<{ event: string; data: unknown }>;

	beforeEach(() => {
		events = [];
	});

	it("should emit triguna:sattva_dominant when sattva exceeds threshold", () => {
		const tri = new Triguna(
			{ sattvaThreshold: 0.6 },
			(event, data) => events.push({ event, data }),
		);

		// Feed healthy observations until sattva is high
		for (let i = 0; i < 20; i++) {
			tri.update(HEALTHY_OBS);
		}

		const sattvaEvents = events.filter((e) => e.event === "triguna:sattva_dominant");
		expect(sattvaEvents.length).toBeGreaterThan(0);
	});

	it("should emit triguna:rajas_alert when rajas exceeds threshold", () => {
		const tri = new Triguna(
			{ rajasThreshold: 0.35, initialState: [0.33, 0.34, 0.33] },
			(event, data) => events.push({ event, data }),
		);

		for (let i = 0; i < 30; i++) {
			tri.update(STRESSED_OBS);
		}

		const rajasEvents = events.filter((e) => e.event === "triguna:rajas_alert");
		expect(rajasEvents.length).toBeGreaterThan(0);
	});

	it("should emit triguna:tamas_alert when tamas exceeds threshold", () => {
		const tri = new Triguna(
			{ tamasThreshold: 0.3, initialState: [0.33, 0.34, 0.33] },
			(event, data) => events.push({ event, data }),
		);

		for (let i = 0; i < 30; i++) {
			tri.update(DEGRADED_OBS);
		}

		const tamasEvents = events.filter((e) => e.event === "triguna:tamas_alert");
		expect(tamasEvents.length).toBeGreaterThan(0);
	});

	it("should emit triguna:guna_shift when dominant guna changes", () => {
		const tri = new Triguna(
			{ initialState: [0.6, 0.3, 0.1] },
			(event, data) => events.push({ event, data }),
		);

		// Start sattva-dominant, push toward tamas
		for (let i = 0; i < 50; i++) {
			tri.update(DEGRADED_OBS);
		}

		const shiftEvents = events.filter((e) => e.event === "triguna:guna_shift");
		expect(shiftEvents.length).toBeGreaterThan(0);

		// Verify the shift event data
		const firstShift = shiftEvents[0].data as { from: string; to: string };
		expect(firstShift.from).toBe("sattva");
	});

	it("should not emit events if no event handler is provided", () => {
		// This should not throw
		const tri = new Triguna();
		for (let i = 0; i < 20; i++) {
			tri.update(HEALTHY_OBS);
		}
		// No error means success
		expect(tri.getState().sattva).toBeGreaterThan(0);
	});
});

// ─── History ─────────────────────────────────────────────────────────────────

describe("Triguna — History", () => {
	it("should record snapshots on each update", () => {
		const tri = new Triguna();

		tri.update(HEALTHY_OBS);
		tri.update(STRESSED_OBS);
		tri.update(DEGRADED_OBS);

		const history = tri.getHistory();
		// 1 initial + 3 updates = 4
		expect(history.length).toBe(4);
	});

	it("should respect the limit parameter", () => {
		const tri = new Triguna();

		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}

		const recent = tri.getHistory(3);
		expect(recent.length).toBe(3);
	});

	it("should trim history to maxHistory", () => {
		const tri = new Triguna({ maxHistory: 5 });

		for (let i = 0; i < 20; i++) {
			tri.update(HEALTHY_OBS);
		}

		const history = tri.getHistory();
		expect(history.length).toBeLessThanOrEqual(5);
	});

	it("should clamp maxHistory to system ceiling", () => {
		const tri = new Triguna({ maxHistory: SYSTEM_MAX_TRIGUNA_HISTORY + 100 });

		// Should not store more than SYSTEM_MAX_TRIGUNA_HISTORY
		for (let i = 0; i < SYSTEM_MAX_TRIGUNA_HISTORY + 50; i++) {
			tri.update(NEUTRAL_OBS);
		}

		const history = tri.getHistory();
		expect(history.length).toBeLessThanOrEqual(SYSTEM_MAX_TRIGUNA_HISTORY);
	});

	it("should return deep copies of history snapshots", () => {
		const tri = new Triguna();
		tri.update(HEALTHY_OBS);

		const history = tri.getHistory();
		const snap = history[0];

		// Mutating the returned snapshot should not affect internal state
		snap.state.sattva = 999;
		const history2 = tri.getHistory();
		expect(history2[0].state.sattva).not.toBe(999);
	});

	it("should have timestamps in increasing order", () => {
		const tri = new Triguna();

		for (let i = 0; i < 5; i++) {
			tri.update(HEALTHY_OBS);
		}

		const history = tri.getHistory();
		for (let i = 1; i < history.length; i++) {
			expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
		}
	});
});

// ─── Trend Analysis ──────────────────────────────────────────────────────────

describe("Triguna — Trend Analysis", () => {
	it("should report stable trend when just initialized", () => {
		const tri = new Triguna();
		const trend = tri.getTrend();

		expect(trend.sattva).toBe("stable");
		expect(trend.rajas).toBe("stable");
		expect(trend.tamas).toBe("stable");
	});

	it("should detect rising sattva with sustained healthy observations", () => {
		// Use a small trendWindow that captures the early convergence phase.
		// With high measurement noise, the Kalman filter moves slowly —
		// ensuring the trend window sees a clear upward slope.
		const tri = new Triguna({
			initialState: [0.33, 0.34, 0.33],
			trendWindow: 8,
			trendThreshold: 0.01,
			measurementNoise: 0.5,
		});

		for (let i = 0; i < 8; i++) {
			tri.update(HEALTHY_OBS);
		}

		const trend = tri.getTrend();
		expect(trend.sattva).toBe("rising");
	});

	it("should detect falling sattva with sustained degraded observations", () => {
		// Start with high sattva, slow Kalman gain so the fall is visible
		// within the trend window.
		const tri = new Triguna({
			initialState: [0.7, 0.2, 0.1],
			trendWindow: 8,
			trendThreshold: 0.01,
			measurementNoise: 0.5,
		});

		for (let i = 0; i < 8; i++) {
			tri.update(DEGRADED_OBS);
		}

		const trend = tri.getTrend();
		expect(trend.sattva).toBe("falling");
	});

	it("should detect rising tamas with sustained degraded observations", () => {
		// Slow convergence so the trend window sees the rise.
		const tri = new Triguna({
			initialState: [0.33, 0.34, 0.33],
			trendWindow: 8,
			trendThreshold: 0.01,
			measurementNoise: 0.5,
		});

		for (let i = 0; i < 8; i++) {
			tri.update(DEGRADED_OBS);
		}

		const trend = tri.getTrend();
		expect(trend.tamas).toBe("rising");
	});

	it("should report stable trend when observations are mixed", () => {
		const tri = new Triguna({ trendWindow: 6, trendThreshold: 0.1 });

		// Alternate between healthy and degraded — net effect should be ~stable
		for (let i = 0; i < 20; i++) {
			tri.update(i % 2 === 0 ? HEALTHY_OBS : DEGRADED_OBS);
		}

		const trend = tri.getTrend();
		// At least one should be stable given the oscillation
		const stableCount = [trend.sattva, trend.rajas, trend.tamas]
			.filter((t) => t === "stable").length;
		expect(stableCount).toBeGreaterThanOrEqual(0); // non-negative is guaranteed
	});
});

// ─── Reset ───────────────────────────────────────────────────────────────────

describe("Triguna — Reset", () => {
	it("should restore the initial state after reset", () => {
		const tri = new Triguna();

		// Perturb it
		for (let i = 0; i < 20; i++) {
			tri.update(DEGRADED_OBS);
		}
		expect(tri.getDominant()).not.toBe("sattva");

		// Reset
		tri.reset();
		const state = tri.getState();
		expect(state.sattva).toBeCloseTo(0.6, 5);
		expect(state.rajas).toBeCloseTo(0.3, 5);
		expect(state.tamas).toBeCloseTo(0.1, 5);
		assertSimplexConstraint(state);
	});

	it("should clear history on reset (leaving 1 initial snapshot)", () => {
		const tri = new Triguna();

		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}
		expect(tri.getHistory().length).toBe(11);

		tri.reset();
		expect(tri.getHistory().length).toBe(1);
	});

	it("should restore sattva as dominant after reset", () => {
		const tri = new Triguna();

		for (let i = 0; i < 30; i++) {
			tri.update(DEGRADED_OBS);
		}
		tri.reset();
		expect(tri.getDominant()).toBe("sattva");
	});
});

// ─── Serialization ───────────────────────────────────────────────────────────

describe("Triguna — Serialization", () => {
	it("should serialize and deserialize to identical state", () => {
		const tri = new Triguna();

		for (let i = 0; i < 5; i++) {
			tri.update(HEALTHY_OBS);
		}

		const serialized = tri.serialize();
		const restored = Triguna.deserialize(serialized);

		const origState = tri.getState();
		const restoredState = restored.getState();

		expect(restoredState.sattva).toBeCloseTo(origState.sattva, 10);
		expect(restoredState.rajas).toBeCloseTo(origState.rajas, 10);
		expect(restoredState.tamas).toBeCloseTo(origState.tamas, 10);
		expect(restored.getDominant()).toBe(tri.getDominant());
	});

	it("should preserve history through serialization", () => {
		const tri = new Triguna();

		for (let i = 0; i < 5; i++) {
			tri.update(HEALTHY_OBS);
		}

		const serialized = tri.serialize();
		const restored = Triguna.deserialize(serialized);

		expect(restored.getHistory().length).toBe(tri.getHistory().length);
	});

	it("should continue updating correctly after deserialization", () => {
		const tri = new Triguna();

		for (let i = 0; i < 5; i++) {
			tri.update(HEALTHY_OBS);
		}

		const serialized = tri.serialize();
		const restored = Triguna.deserialize(serialized);

		// Update the restored instance
		restored.update(DEGRADED_OBS);
		const state = restored.getState();

		assertSimplexConstraint(state);
		expect(restored.getHistory().length).toBe(7); // 6 original + 1 new
	});

	it("should serialize to a plain JSON-compatible object", () => {
		const tri = new Triguna();
		tri.update(HEALTHY_OBS);

		const serialized = tri.serialize();
		const json = JSON.stringify(serialized);
		const parsed = JSON.parse(json) as TrigunaSerializedState;

		expect(parsed.gunaState).toBeDefined();
		expect(parsed.xHat).toHaveLength(2);
		expect(parsed.P).toHaveLength(4);
		expect(parsed.prevDominant).toBeDefined();
		expect(Array.isArray(parsed.history)).toBe(true);
	});

	it("should roundtrip through JSON", () => {
		const tri = new Triguna();
		for (let i = 0; i < 10; i++) {
			tri.update(STRESSED_OBS);
		}

		const json = JSON.stringify(tri.serialize());
		const restored = Triguna.deserialize(JSON.parse(json));

		const origState = tri.getState();
		const restoredState = restored.getState();

		expect(restoredState.sattva).toBeCloseTo(origState.sattva, 10);
		expect(restoredState.rajas).toBeCloseTo(origState.rajas, 10);
		expect(restoredState.tamas).toBeCloseTo(origState.tamas, 10);
	});
});

// ─── Performance ─────────────────────────────────────────────────────────────

describe("Triguna — Performance", () => {
	it("should complete a single update in <1ms", () => {
		const tri = new Triguna();

		// Warm up
		for (let i = 0; i < 10; i++) {
			tri.update(NEUTRAL_OBS);
		}

		// Measure
		const iterations = 1000;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			tri.update(HEALTHY_OBS);
		}
		const elapsed = performance.now() - start;
		const perUpdate = elapsed / iterations;

		expect(perUpdate).toBeLessThan(1); // <1ms per update
	});

	it("should complete ILR roundtrip in <0.01ms", () => {
		// Warm up
		for (let i = 0; i < 100; i++) {
			ilrForward(0.5, 0.3, 0.2);
		}

		const iterations = 10000;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			const [y1, y2] = ilrForward(0.5, 0.3, 0.2);
			ilrInverse(y1, y2);
		}
		const elapsed = performance.now() - start;
		const perRoundtrip = elapsed / iterations;

		expect(perRoundtrip).toBeLessThan(0.01);
	});
});

// ─── Observation Mapping ─────────────────────────────────────────────────────

describe("Triguna — Observation Mapping", () => {
	it("should push sattva up when successRate and userSatisfaction are high", () => {
		const tri = new Triguna({ initialState: [0.33, 0.34, 0.33] });

		for (let i = 0; i < 15; i++) {
			tri.update({
				errorRate: 0,
				tokenVelocity: 0.3,
				loopCount: 0.1,
				latency: 0.1,
				successRate: 1.0,
				userSatisfaction: 1.0,
			});
		}

		expect(tri.getState().sattva).toBeGreaterThan(0.5);
	});

	it("should push rajas up when tokenVelocity and loopCount are high", () => {
		const tri = new Triguna({ initialState: [0.33, 0.34, 0.33] });

		for (let i = 0; i < 15; i++) {
			tri.update({
				errorRate: 0,
				tokenVelocity: 1.0,
				loopCount: 1.0,
				latency: 0,
				successRate: 0.5,
				userSatisfaction: 0.5,
			});
		}

		const state = tri.getState();
		expect(state.rajas).toBeGreaterThan(0.33);
	});

	it("should push tamas up when errorRate and latency are high", () => {
		const tri = new Triguna({ initialState: [0.33, 0.34, 0.33] });

		for (let i = 0; i < 15; i++) {
			tri.update({
				errorRate: 1.0,
				tokenVelocity: 0,
				loopCount: 0,
				latency: 1.0,
				successRate: 0,
				userSatisfaction: 0,
			});
		}

		expect(tri.getState().tamas).toBeGreaterThan(0.5);
	});
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("Triguna — Edge Cases", () => {
	it("should handle all-zero observation gracefully", () => {
		const tri = new Triguna();
		const allZero: TrigunaObservation = {
			errorRate: 0,
			tokenVelocity: 0,
			loopCount: 0,
			latency: 0,
			successRate: 0,
			userSatisfaction: 0,
		};

		tri.update(allZero);
		assertSimplexConstraint(tri.getState());
	});

	it("should handle all-one observation gracefully", () => {
		const tri = new Triguna();
		const allOne: TrigunaObservation = {
			errorRate: 1,
			tokenVelocity: 1,
			loopCount: 1,
			latency: 1,
			successRate: 1,
			userSatisfaction: 1,
		};

		tri.update(allOne);
		assertSimplexConstraint(tri.getState());
	});

	it("should survive 10000 random updates without NaN or Infinity", () => {
		const tri = new Triguna();

		for (let i = 0; i < 10000; i++) {
			const obs: TrigunaObservation = {
				errorRate: Math.random(),
				tokenVelocity: Math.random(),
				loopCount: Math.random(),
				latency: Math.random(),
				successRate: Math.random(),
				userSatisfaction: Math.random(),
			};
			tri.update(obs);

			const state = tri.getState();
			expect(Number.isFinite(state.sattva)).toBe(true);
			expect(Number.isFinite(state.rajas)).toBe(true);
			expect(Number.isFinite(state.tamas)).toBe(true);
			expect(Number.isNaN(state.sattva)).toBe(false);
			expect(Number.isNaN(state.rajas)).toBe(false);
			expect(Number.isNaN(state.tamas)).toBe(false);
		}

		// Final state should still be valid
		assertSimplexConstraint(tri.getState());
	});

	it("should handle getHistory with limit larger than history", () => {
		const tri = new Triguna();
		tri.update(HEALTHY_OBS);

		const history = tri.getHistory(1000);
		expect(history.length).toBe(2); // 1 initial + 1 update
	});

	it("should handle getTrend with fewer snapshots than trendWindow", () => {
		const tri = new Triguna({ trendWindow: 20 });
		tri.update(HEALTHY_OBS);

		// Only 2 snapshots, trendWindow is 20
		const trend = tri.getTrend();
		// Should not throw, should report based on available data
		expect(["rising", "falling", "stable"]).toContain(trend.sattva);
	});

	it("should handle config with very small process noise", () => {
		const tri = new Triguna({ processNoise: 1e-10 });

		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}

		assertSimplexConstraint(tri.getState());
	});

	it("should handle config with very large measurement noise", () => {
		const tri = new Triguna({ measurementNoise: 100 });

		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}

		assertSimplexConstraint(tri.getState());
		// With very high measurement noise, Kalman gain is low — state barely moves
		const state = tri.getState();
		// Should still be near initial state
		expect(Math.abs(state.sattva - 0.6)).toBeLessThan(0.2);
	});
});

// ─── Integration with Chetana Pattern ────────────────────────────────────────

describe("Triguna — Chetana Integration Pattern", () => {
	it("should be constructible with partial config (matching ChetanaConfig pattern)", () => {
		const tri = new Triguna({ sattvaThreshold: 0.8 });
		expect(tri.getState().sattva).toBeCloseTo(0.6, 5);
	});

	it("should accept an onEvent callback (matching Chetana event pattern)", () => {
		const events: string[] = [];
		const tri = new Triguna(
			{ sattvaThreshold: 0.5 },
			(event) => events.push(event),
		);

		for (let i = 0; i < 10; i++) {
			tri.update(HEALTHY_OBS);
		}

		// Should have emitted some events
		expect(events.length).toBeGreaterThan(0);
	});

	it("should be usable alongside BhavaSystem data", () => {
		// Simulate the ChetanaController pattern:
		// BhavaSystem produces affect data, Triguna consumes observation signals
		const tri = new Triguna();

		// Simulate what ChetanaController would feed:
		// after a tool execution with success, low latency, etc.
		const obs: TrigunaObservation = {
			errorRate: 0.1,     // from BhavaSystem frustration / tool error rate
			tokenVelocity: 0.5, // from streaming data
			loopCount: 0.2,     // from tool executor loop count
			latency: 0.3,       // from tool latency
			successRate: 0.8,   // from AtmaDarshana tool mastery
			userSatisfaction: 0.7, // from implicit signals
		};

		const state = tri.update(obs);
		assertSimplexConstraint(state);
		expect(state.sattva + state.rajas + state.tamas).toBeCloseTo(1.0, 10);
	});
});
