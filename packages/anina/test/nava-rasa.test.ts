/**
 * @chitragupta/anina — Nava Rasa (नव रस) Contextual Emotional Awareness Tests.
 *
 * Comprehensive tests for the 9-rasa emotional awareness system:
 * simplex constraint, observation mapping, EMA smoothing, behavioral
 * adaptations, rasa shifts, serialization, edge cases, and performance.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	NavaRasa,
	RASA_LABELS,
	DEFAULT_NAVA_RASA_CONFIG,
	SYSTEM_MAX_NAVA_RASA_HISTORY,
} from "../src/chetana/nava-rasa.js";
import type {
	RasaState,
	RasaType,
	RasaObservation,
	RasaBehavioralAdaptation,
	NavaRasaConfig,
	NavaRasaSerializedState,
} from "../src/chetana/nava-rasa.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Assert that a RasaState sums to approximately 1.0 and all values are non-negative. */
function assertSimplexConstraint(state: RasaState, tolerance = 1e-8): void {
	const sum =
		state.shringara + state.vira + state.karuna + state.raudra +
		state.bhayanaka + state.bibhatsa + state.adbhuta + state.hasya +
		state.shanta;
	expect(sum).toBeCloseTo(1.0, 6);
	for (const rasa of RASA_LABELS) {
		expect(state[rasa]).toBeGreaterThanOrEqual(0);
	}
}

/** Neutral observation: everything at 0.5. */
const NEUTRAL_OBS: RasaObservation = {
	userSatisfaction: 0.5,
	confidence: 0.5,
	successRate: 0.5,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Delight observation: high user satisfaction + success. */
const DELIGHT_OBS: RasaObservation = {
	userSatisfaction: 0.95,
	confidence: 0.7,
	successRate: 0.9,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Heroic observation: high confidence + success rate. */
const HEROIC_OBS: RasaObservation = {
	userSatisfaction: 0.6,
	confidence: 0.95,
	successRate: 0.95,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Compassion observation: user is struggling. */
const COMPASSION_OBS: RasaObservation = {
	userSatisfaction: 0.1,
	confidence: 0.3,
	successRate: 0.3,
	userStruggling: 0.95,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Fury observation: security threat detected. */
const FURY_OBS: RasaObservation = {
	userSatisfaction: 0.0,
	confidence: 0.5,
	successRate: 0.5,
	userStruggling: 0.0,
	securityThreat: 0.95,
	highRiskAction: 0.3,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Fear observation: high-risk action. */
const FEAR_OBS: RasaObservation = {
	userSatisfaction: 0.2,
	confidence: 0.2,
	successRate: 0.3,
	userStruggling: 0.2,
	securityThreat: 0.3,
	highRiskAction: 0.95,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Disgust observation: bad code quality. */
const DISGUST_OBS: RasaObservation = {
	userSatisfaction: 0.1,
	confidence: 0.4,
	successRate: 0.3,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.95,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Wonder observation: novel situation. */
const WONDER_OBS: RasaObservation = {
	userSatisfaction: 0.5,
	confidence: 0.4,
	successRate: 0.5,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.95,
	benignAnomaly: 0.0,
	allTasksComplete: 0.0,
};

/** Humor observation: benign anomaly. */
const HUMOR_OBS: RasaObservation = {
	userSatisfaction: 0.6,
	confidence: 0.5,
	successRate: 0.5,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.95,
	allTasksComplete: 0.0,
};

/** Peace observation: all tasks complete, low activity. */
const PEACE_OBS: RasaObservation = {
	userSatisfaction: 0.7,
	confidence: 0.6,
	successRate: 0.7,
	userStruggling: 0.0,
	securityThreat: 0.0,
	highRiskAction: 0.0,
	codeQualityLow: 0.0,
	novelSituation: 0.0,
	benignAnomaly: 0.0,
	allTasksComplete: 0.95,
};

// ─── Initialization ──────────────────────────────────────────────────────────

describe("NavaRasa — Initialization", () => {
	it("should initialize with the default shanta-dominant state", () => {
		const nr = new NavaRasa();
		const state = nr.getState();

		expect(state.shanta).toBeGreaterThan(0.5);
		expect(nr.getDominant()).toBe("shanta");
		assertSimplexConstraint(state);
	});

	it("should accept custom initial state", () => {
		const nr = new NavaRasa({
			initialState: [0.5, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
		});
		const state = nr.getState();

		expect(state.shringara).toBeGreaterThan(0.3);
		expect(nr.getDominant()).toBe("shringara");
		assertSimplexConstraint(state);
	});

	it("should normalize initial state that does not sum to 1", () => {
		const nr = new NavaRasa({
			initialState: [5, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 7],
		});
		const state = nr.getState();
		assertSimplexConstraint(state);
	});

	it("should have an initial history of length 1", () => {
		const nr = new NavaRasa();
		const history = nr.getHistory();

		expect(history.length).toBe(1);
		expect(history[0].dominant).toBe("shanta");
	});

	it("should accept an event callback", () => {
		const events: string[] = [];
		const nr = new NavaRasa({}, (event) => events.push(event));

		// No events on construction
		expect(events.length).toBe(0);
	});

	it("should list all 9 rasas", () => {
		expect(RASA_LABELS).toHaveLength(9);
		expect(RASA_LABELS).toContain("shringara");
		expect(RASA_LABELS).toContain("vira");
		expect(RASA_LABELS).toContain("karuna");
		expect(RASA_LABELS).toContain("raudra");
		expect(RASA_LABELS).toContain("bhayanaka");
		expect(RASA_LABELS).toContain("bibhatsa");
		expect(RASA_LABELS).toContain("adbhuta");
		expect(RASA_LABELS).toContain("hasya");
		expect(RASA_LABELS).toContain("shanta");
	});
});

// ─── Simplex Constraint ──────────────────────────────────────────────────────

describe("NavaRasa — Simplex Constraint", () => {
	it("should always sum to 1 after a single update", () => {
		const nr = new NavaRasa();
		nr.update(DELIGHT_OBS);
		assertSimplexConstraint(nr.getState());
	});

	it("should always sum to 1 after many diverse updates", () => {
		const nr = new NavaRasa();
		const observations = [
			DELIGHT_OBS, HEROIC_OBS, COMPASSION_OBS, FURY_OBS,
			FEAR_OBS, DISGUST_OBS, WONDER_OBS, HUMOR_OBS,
			PEACE_OBS, NEUTRAL_OBS, DELIGHT_OBS, FURY_OBS,
		];

		for (const obs of observations) {
			nr.update(obs);
			assertSimplexConstraint(nr.getState());
		}
	});

	it("should never produce negative rasa values", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 100; i++) {
			const obs: RasaObservation = {
				userSatisfaction: Math.random(),
				confidence: Math.random(),
				successRate: Math.random(),
				userStruggling: Math.random(),
				securityThreat: Math.random(),
				highRiskAction: Math.random(),
				codeQualityLow: Math.random(),
				novelSituation: Math.random(),
				benignAnomaly: Math.random(),
				allTasksComplete: Math.random(),
			};
			nr.update(obs);
			const state = nr.getState();
			for (const rasa of RASA_LABELS) {
				expect(state[rasa]).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("should survive 10000 random updates without NaN or Infinity", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 10000; i++) {
			const obs: RasaObservation = {
				userSatisfaction: Math.random(),
				confidence: Math.random(),
				successRate: Math.random(),
				userStruggling: Math.random(),
				securityThreat: Math.random(),
				highRiskAction: Math.random(),
				codeQualityLow: Math.random(),
				novelSituation: Math.random(),
				benignAnomaly: Math.random(),
				allTasksComplete: Math.random(),
			};
			nr.update(obs);
			const state = nr.getState();
			for (const rasa of RASA_LABELS) {
				expect(Number.isFinite(state[rasa])).toBe(true);
				expect(Number.isNaN(state[rasa])).toBe(false);
			}
		}

		assertSimplexConstraint(nr.getState());
	});
});

// ─── Observation Mapping — All 9 Rasas ───────────────────────────────────────

describe("NavaRasa — Observation Mapping", () => {
	it("should push shringara up with high user satisfaction + success", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(DELIGHT_OBS);
		}

		const state = nr.getState();
		expect(state.shringara).toBeGreaterThan(0.15);
	});

	it("should push vira up with high confidence + success rate", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(HEROIC_OBS);
		}

		const state = nr.getState();
		expect(state.vira).toBeGreaterThan(0.15);
	});

	it("should push karuna up when user is struggling", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(COMPASSION_OBS);
		}

		const state = nr.getState();
		expect(state.karuna).toBeGreaterThan(0.15);
	});

	it("should push raudra up when security threat detected", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(FURY_OBS);
		}

		const state = nr.getState();
		expect(state.raudra).toBeGreaterThan(0.15);
	});

	it("should push bhayanaka up when high-risk action detected", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(FEAR_OBS);
		}

		const state = nr.getState();
		expect(state.bhayanaka).toBeGreaterThan(0.15);
	});

	it("should push bibhatsa up when code quality is low", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(DISGUST_OBS);
		}

		const state = nr.getState();
		expect(state.bibhatsa).toBeGreaterThan(0.15);
	});

	it("should push adbhuta up with novel situations", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(WONDER_OBS);
		}

		const state = nr.getState();
		expect(state.adbhuta).toBeGreaterThan(0.15);
	});

	it("should push hasya up with benign anomalies", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(HUMOR_OBS);
		}

		const state = nr.getState();
		expect(state.hasya).toBeGreaterThan(0.15);
	});

	it("should push shanta up when all tasks complete", () => {
		const nr = new NavaRasa({ initialState: [0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12] });

		for (let i = 0; i < 20; i++) {
			nr.update(PEACE_OBS);
		}

		const state = nr.getState();
		expect(state.shanta).toBeGreaterThan(0.15);
	});
});

// ─── EMA Smoothing ───────────────────────────────────────────────────────────

describe("NavaRasa — EMA Smoothing", () => {
	it("should not jump to new dominant on a single observation", () => {
		const nr = new NavaRasa(); // shanta-dominant
		expect(nr.getDominant()).toBe("shanta");

		// One fury observation should not immediately flip to raudra
		nr.update(FURY_OBS);
		// With alpha=0.3 and initial shanta=0.7, one step should keep shanta high
		expect(nr.getState().shanta).toBeGreaterThan(0.2);
	});

	it("should transition gradually with low alpha", () => {
		const nr = new NavaRasa({ smoothingAlpha: 0.1 }); // very smooth
		const initialShanta = nr.getState().shanta;

		nr.update(FURY_OBS);

		// With alpha=0.1, shanta should barely drop
		expect(nr.getState().shanta).toBeGreaterThan(initialShanta * 0.5);
	});

	it("should transition quickly with high alpha", () => {
		const nr = new NavaRasa({ smoothingAlpha: 0.9 });

		// Start shanta-dominant, push hard toward raudra
		for (let i = 0; i < 5; i++) {
			nr.update(FURY_OBS);
		}

		// With alpha=0.9, should respond very quickly
		expect(nr.getState().raudra).toBeGreaterThan(0.1);
	});

	it("should converge — repeated identical observations should stabilize", () => {
		const nr = new NavaRasa();

		// Run many identical observations
		for (let i = 0; i < 50; i++) {
			nr.update(HEROIC_OBS);
		}
		const state1 = nr.getState();

		// Run 10 more
		for (let i = 0; i < 10; i++) {
			nr.update(HEROIC_OBS);
		}
		const state2 = nr.getState();

		// Should have converged — small delta
		for (const rasa of RASA_LABELS) {
			expect(Math.abs(state2[rasa] - state1[rasa])).toBeLessThan(0.02);
		}
	});

	it("should smooth out noise — single outlier should not dominate", () => {
		const nr = new NavaRasa();

		// Establish a shanta baseline (already default)
		for (let i = 0; i < 10; i++) {
			nr.update(PEACE_OBS);
		}
		const baseline = nr.getState();

		// One extreme observation
		nr.update(FURY_OBS);
		const afterOutlier = nr.getState();

		// Shanta should still be significant
		expect(afterOutlier.shanta).toBeGreaterThan(baseline.shanta * 0.3);
	});
});

// ─── Dominant Rasa Detection ─────────────────────────────────────────────────

describe("NavaRasa — Dominant Rasa", () => {
	it("should return shanta when initialized with default config", () => {
		const nr = new NavaRasa();
		expect(nr.getDominant()).toBe("shanta");
	});

	it("should return shringara when shringara is highest", () => {
		const nr = new NavaRasa({
			initialState: [0.5, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1],
		});
		expect(nr.getDominant()).toBe("shringara");
	});

	it("should return raudra when raudra is highest", () => {
		const nr = new NavaRasa({
			initialState: [0.05, 0.05, 0.05, 0.5, 0.05, 0.05, 0.05, 0.05, 0.15],
		});
		expect(nr.getDominant()).toBe("raudra");
	});

	it("should handle all 9 dominant configurations", () => {
		for (let idx = 0; idx < 9; idx++) {
			const init: [number, number, number, number, number, number, number, number, number] =
				[0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
			init[idx] = 0.6;
			const nr = new NavaRasa({ initialState: init });
			expect(nr.getDominant()).toBe(RASA_LABELS[idx]);
		}
	});
});

// ─── Behavioral Adaptations ──────────────────────────────────────────────────

describe("NavaRasa — Behavioral Adaptations", () => {
	it("should return shanta adaptation by default", () => {
		const nr = new NavaRasa();
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("shanta");
		expect(adapt.autonomy).toBe("high");
		expect(adapt.verbosity).toBe("minimal");
		expect(adapt.confirmations).toBe(false);
	});

	it("should return correct adaptation for shringara", () => {
		const nr = new NavaRasa({ initialState: [0.9, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("shringara");
		expect(adapt.autonomy).toBe("high");
		expect(adapt.verbosity).toBe("normal");
		expect(adapt.confirmations).toBe(false);
	});

	it("should return correct adaptation for vira", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.9, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("vira");
		expect(adapt.autonomy).toBe("full");
		expect(adapt.verbosity).toBe("terse");
		expect(adapt.confirmations).toBe(false);
	});

	it("should return correct adaptation for karuna", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.9, 0.01, 0.01, 0.01, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("karuna");
		expect(adapt.autonomy).toBe("low");
		expect(adapt.verbosity).toBe("detailed");
		expect(adapt.confirmations).toBe(true);
	});

	it("should return correct adaptation for raudra", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.01, 0.9, 0.01, 0.01, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("raudra");
		expect(adapt.autonomy).toBe("none");
		expect(adapt.verbosity).toBe("alert");
		expect(adapt.confirmations).toBe(true);
	});

	it("should return correct adaptation for bhayanaka", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.01, 0.01, 0.9, 0.01, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("bhayanaka");
		expect(adapt.autonomy).toBe("low");
		expect(adapt.verbosity).toBe("cautious");
		expect(adapt.confirmations).toBe(true);
	});

	it("should return correct adaptation for bibhatsa", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.01, 0.01, 0.01, 0.9, 0.01, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("bibhatsa");
		expect(adapt.autonomy).toBe("medium");
		expect(adapt.verbosity).toBe("critical");
		expect(adapt.confirmations).toBe(false);
	});

	it("should return correct adaptation for adbhuta", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.9, 0.01, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("adbhuta");
		expect(adapt.autonomy).toBe("medium");
		expect(adapt.verbosity).toBe("detailed");
		expect(adapt.confirmations).toBe(false);
	});

	it("should return correct adaptation for hasya", () => {
		const nr = new NavaRasa({ initialState: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.9, 0.04] });
		const adapt = nr.getAdaptation();

		expect(adapt.source).toBe("hasya");
		expect(adapt.autonomy).toBe("medium");
		expect(adapt.verbosity).toBe("light");
		expect(adapt.confirmations).toBe(false);
	});

	it("should adapt when dominant rasa changes through updates", () => {
		const nr = new NavaRasa(); // starts shanta
		expect(nr.getAdaptation().source).toBe("shanta");

		// Push toward raudra
		for (let i = 0; i < 30; i++) {
			nr.update(FURY_OBS);
		}

		const adapt = nr.getAdaptation();
		expect(adapt.source).toBe("raudra");
		expect(adapt.autonomy).toBe("none");
		expect(adapt.confirmations).toBe(true);
	});

	it("should require confirmations for karuna, raudra, bhayanaka", () => {
		const confirmRasas: RasaType[] = ["karuna", "raudra", "bhayanaka"];

		for (const rasa of confirmRasas) {
			const init: [number, number, number, number, number, number, number, number, number] =
				[0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
			const idx = RASA_LABELS.indexOf(rasa);
			init[idx] = 0.92;
			const nr = new NavaRasa({ initialState: init });
			expect(nr.getAdaptation().confirmations).toBe(true);
		}
	});
});

// ─── Rasa Shift Events ───────────────────────────────────────────────────────

describe("NavaRasa — Rasa Shift Events", () => {
	let events: Array<{ event: string; data: unknown }>;

	beforeEach(() => {
		events = [];
	});

	it("should emit nava_rasa:rasa_shift when dominant rasa changes", () => {
		const nr = new NavaRasa(
			{},
			(event, data) => events.push({ event, data }),
		);

		// Start shanta-dominant, push toward raudra
		for (let i = 0; i < 50; i++) {
			nr.update(FURY_OBS);
		}

		const shiftEvents = events.filter((e) => e.event === "nava_rasa:rasa_shift");
		expect(shiftEvents.length).toBeGreaterThan(0);
	});

	it("should include from/to in shift event data", () => {
		const nr = new NavaRasa(
			{},
			(event, data) => events.push({ event, data }),
		);

		for (let i = 0; i < 50; i++) {
			nr.update(FURY_OBS);
		}

		const shiftEvents = events.filter((e) => e.event === "nava_rasa:rasa_shift");
		if (shiftEvents.length > 0) {
			const data = shiftEvents[0].data as { from: string; to: string; state: RasaState };
			expect(data.from).toBe("shanta");
			expect(typeof data.to).toBe("string");
			expect(data.state).toBeDefined();
		}
	});

	it("should not emit events when dominant does not change", () => {
		const nr = new NavaRasa(
			{},
			(event, data) => events.push({ event, data }),
		);

		// Feed peaceful observations — shanta stays dominant
		for (let i = 0; i < 10; i++) {
			nr.update(PEACE_OBS);
		}

		const shiftEvents = events.filter((e) => e.event === "nava_rasa:rasa_shift");
		expect(shiftEvents.length).toBe(0);
	});

	it("should not emit events if no event handler is provided", () => {
		const nr = new NavaRasa();

		// This should not throw
		for (let i = 0; i < 20; i++) {
			nr.update(FURY_OBS);
		}
		expect(nr.getState().raudra).toBeGreaterThan(0);
	});

	it("should emit multiple shift events for multiple transitions", () => {
		const nr = new NavaRasa(
			{ smoothingAlpha: 0.8 },
			(event, data) => events.push({ event, data }),
		);

		// Push to raudra
		for (let i = 0; i < 20; i++) {
			nr.update(FURY_OBS);
		}

		// Then push to shringara
		for (let i = 0; i < 30; i++) {
			nr.update(DELIGHT_OBS);
		}

		const shiftEvents = events.filter((e) => e.event === "nava_rasa:rasa_shift");
		// Should have at least 2 shifts: shanta→raudra and raudra→something
		expect(shiftEvents.length).toBeGreaterThanOrEqual(2);
	});
});

// ─── History ─────────────────────────────────────────────────────────────────

describe("NavaRasa — History", () => {
	it("should record snapshots on each update", () => {
		const nr = new NavaRasa();

		nr.update(DELIGHT_OBS);
		nr.update(FURY_OBS);
		nr.update(PEACE_OBS);

		const history = nr.getHistory();
		// 1 initial + 3 updates = 4
		expect(history.length).toBe(4);
	});

	it("should respect the limit parameter", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 10; i++) {
			nr.update(DELIGHT_OBS);
		}

		const recent = nr.getHistory(3);
		expect(recent.length).toBe(3);
	});

	it("should trim history to maxHistory", () => {
		const nr = new NavaRasa({ maxHistory: 5 });

		for (let i = 0; i < 20; i++) {
			nr.update(DELIGHT_OBS);
		}

		const history = nr.getHistory();
		expect(history.length).toBeLessThanOrEqual(5);
	});

	it("should clamp maxHistory to system ceiling", () => {
		const nr = new NavaRasa({ maxHistory: SYSTEM_MAX_NAVA_RASA_HISTORY + 100 });

		for (let i = 0; i < SYSTEM_MAX_NAVA_RASA_HISTORY + 50; i++) {
			nr.update(NEUTRAL_OBS);
		}

		const history = nr.getHistory();
		expect(history.length).toBeLessThanOrEqual(SYSTEM_MAX_NAVA_RASA_HISTORY);
	});

	it("should return deep copies of history snapshots", () => {
		const nr = new NavaRasa();
		nr.update(DELIGHT_OBS);

		const history = nr.getHistory();
		const snap = history[0];

		// Mutating the returned snapshot should not affect internal state
		snap.state.shringara = 999;
		const history2 = nr.getHistory();
		expect(history2[0].state.shringara).not.toBe(999);
	});

	it("should have timestamps in non-decreasing order", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 5; i++) {
			nr.update(DELIGHT_OBS);
		}

		const history = nr.getHistory();
		for (let i = 1; i < history.length; i++) {
			expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
		}
	});

	it("should handle getHistory with limit larger than history", () => {
		const nr = new NavaRasa();
		nr.update(DELIGHT_OBS);

		const history = nr.getHistory(1000);
		expect(history.length).toBe(2); // 1 initial + 1 update
	});
});

// ─── Reset ───────────────────────────────────────────────────────────────────

describe("NavaRasa — Reset", () => {
	it("should restore the initial state after reset", () => {
		const nr = new NavaRasa();

		// Perturb it
		for (let i = 0; i < 20; i++) {
			nr.update(FURY_OBS);
		}
		expect(nr.getDominant()).not.toBe("shanta");

		// Reset
		nr.reset();
		const state = nr.getState();
		expect(state.shanta).toBeGreaterThan(0.5);
		expect(nr.getDominant()).toBe("shanta");
		assertSimplexConstraint(state);
	});

	it("should clear history on reset (leaving 1 initial snapshot)", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 10; i++) {
			nr.update(DELIGHT_OBS);
		}
		expect(nr.getHistory().length).toBe(11);

		nr.reset();
		expect(nr.getHistory().length).toBe(1);
	});

	it("should restore correct dominant after reset", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 30; i++) {
			nr.update(FURY_OBS);
		}
		nr.reset();
		expect(nr.getDominant()).toBe("shanta");
	});
});

// ─── Serialization ───────────────────────────────────────────────────────────

describe("NavaRasa — Serialization", () => {
	it("should serialize and deserialize to identical state", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 5; i++) {
			nr.update(DELIGHT_OBS);
		}

		const serialized = nr.serialize();
		const restored = NavaRasa.deserialize(serialized);

		const origState = nr.getState();
		const restoredState = restored.getState();

		for (const rasa of RASA_LABELS) {
			expect(restoredState[rasa]).toBeCloseTo(origState[rasa], 10);
		}
		expect(restored.getDominant()).toBe(nr.getDominant());
	});

	it("should preserve history through serialization", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 5; i++) {
			nr.update(DELIGHT_OBS);
		}

		const serialized = nr.serialize();
		const restored = NavaRasa.deserialize(serialized);

		expect(restored.getHistory().length).toBe(nr.getHistory().length);
	});

	it("should continue updating correctly after deserialization", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 5; i++) {
			nr.update(DELIGHT_OBS);
		}

		const serialized = nr.serialize();
		const restored = NavaRasa.deserialize(serialized);

		// Update the restored instance
		restored.update(FURY_OBS);
		const state = restored.getState();

		assertSimplexConstraint(state);
		expect(restored.getHistory().length).toBe(7); // 6 original + 1 new
	});

	it("should serialize to a plain JSON-compatible object", () => {
		const nr = new NavaRasa();
		nr.update(DELIGHT_OBS);

		const serialized = nr.serialize();
		const json = JSON.stringify(serialized);
		const parsed = JSON.parse(json) as NavaRasaSerializedState;

		expect(parsed.rasaState).toBeDefined();
		expect(parsed.prevDominant).toBeDefined();
		expect(Array.isArray(parsed.history)).toBe(true);
	});

	it("should roundtrip through JSON", () => {
		const nr = new NavaRasa();
		for (let i = 0; i < 10; i++) {
			nr.update(HEROIC_OBS);
		}

		const json = JSON.stringify(nr.serialize());
		const restored = NavaRasa.deserialize(JSON.parse(json));

		const origState = nr.getState();
		const restoredState = restored.getState();

		for (const rasa of RASA_LABELS) {
			expect(restoredState[rasa]).toBeCloseTo(origState[rasa], 10);
		}
	});

	it("should deserialize with custom config and event handler", () => {
		const nr = new NavaRasa();
		for (let i = 0; i < 5; i++) {
			nr.update(DELIGHT_OBS);
		}

		const events: string[] = [];
		const serialized = nr.serialize();
		const restored = NavaRasa.deserialize(
			serialized,
			{ smoothingAlpha: 0.5 },
			(event) => events.push(event),
		);

		// Push to a different rasa to trigger event
		for (let i = 0; i < 30; i++) {
			restored.update(FURY_OBS);
		}

		expect(events.length).toBeGreaterThan(0);
	});
});

// ─── Config ──────────────────────────────────────────────────────────────────

describe("NavaRasa — Configuration", () => {
	it("should use default config when none provided", () => {
		const nr = new NavaRasa();
		expect(nr.getDominant()).toBe("shanta");
	});

	it("should merge partial config with defaults", () => {
		const nr = new NavaRasa({ smoothingAlpha: 0.5 });
		const state = nr.getState();
		// Should still have default initial state
		expect(state.shanta).toBeGreaterThan(0.5);
	});

	it("should clamp smoothingAlpha to system bounds", () => {
		// Too low
		const nr1 = new NavaRasa({ smoothingAlpha: 0.001 });
		nr1.update(FURY_OBS);
		assertSimplexConstraint(nr1.getState());

		// Too high
		const nr2 = new NavaRasa({ smoothingAlpha: 5.0 });
		nr2.update(FURY_OBS);
		assertSimplexConstraint(nr2.getState());
	});

	it("should clamp softmaxTemperature to minimum", () => {
		const nr = new NavaRasa({ softmaxTemperature: 0.001 });
		nr.update(FURY_OBS);
		assertSimplexConstraint(nr.getState());
	});

	it("should have sensible defaults", () => {
		expect(DEFAULT_NAVA_RASA_CONFIG.smoothingAlpha).toBeGreaterThan(0);
		expect(DEFAULT_NAVA_RASA_CONFIG.smoothingAlpha).toBeLessThanOrEqual(1);
		expect(DEFAULT_NAVA_RASA_CONFIG.softmaxTemperature).toBeGreaterThan(0);
		expect(DEFAULT_NAVA_RASA_CONFIG.maxHistory).toBeGreaterThan(0);
		expect(DEFAULT_NAVA_RASA_CONFIG.simplexFloor).toBeGreaterThan(0);
		expect(DEFAULT_NAVA_RASA_CONFIG.initialState).toHaveLength(9);
	});
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("NavaRasa — Edge Cases", () => {
	it("should handle all-zero observation gracefully", () => {
		const nr = new NavaRasa();
		const allZero: RasaObservation = {
			userSatisfaction: 0,
			confidence: 0,
			successRate: 0,
			userStruggling: 0,
			securityThreat: 0,
			highRiskAction: 0,
			codeQualityLow: 0,
			novelSituation: 0,
			benignAnomaly: 0,
			allTasksComplete: 0,
		};

		nr.update(allZero);
		assertSimplexConstraint(nr.getState());
	});

	it("should handle all-one observation gracefully", () => {
		const nr = new NavaRasa();
		const allOne: RasaObservation = {
			userSatisfaction: 1,
			confidence: 1,
			successRate: 1,
			userStruggling: 1,
			securityThreat: 1,
			highRiskAction: 1,
			codeQualityLow: 1,
			novelSituation: 1,
			benignAnomaly: 1,
			allTasksComplete: 1,
		};

		nr.update(allOne);
		assertSimplexConstraint(nr.getState());
	});

	it("should handle rapid alternation between extreme rasas", () => {
		const nr = new NavaRasa();

		for (let i = 0; i < 50; i++) {
			nr.update(i % 2 === 0 ? FURY_OBS : PEACE_OBS);
			assertSimplexConstraint(nr.getState());
		}
	});

	it("should handle very low softmax temperature (sharp peaks)", () => {
		const nr = new NavaRasa({ softmaxTemperature: 0.1 });

		for (let i = 0; i < 10; i++) {
			nr.update(FURY_OBS);
			assertSimplexConstraint(nr.getState());
		}
	});

	it("should handle very high softmax temperature (uniform)", () => {
		const nr = new NavaRasa({ softmaxTemperature: 100 });

		for (let i = 0; i < 10; i++) {
			nr.update(FURY_OBS);
			assertSimplexConstraint(nr.getState());
		}

		// With very high temperature, distribution should be fairly uniform
		const state = nr.getState();
		for (const rasa of RASA_LABELS) {
			expect(state[rasa]).toBeGreaterThan(0.01);
		}
	});
});

// ─── Performance ─────────────────────────────────────────────────────────────

describe("NavaRasa — Performance", () => {
	it("should complete a single update in <1ms", () => {
		const nr = new NavaRasa();

		// Warm up
		for (let i = 0; i < 10; i++) {
			nr.update(NEUTRAL_OBS);
		}

		// Measure
		const iterations = 1000;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			nr.update(DELIGHT_OBS);
		}
		const elapsed = performance.now() - start;
		const perUpdate = elapsed / iterations;

		expect(perUpdate).toBeLessThan(1); // <1ms per update
	});
});

// ─── Integration Pattern ─────────────────────────────────────────────────────

describe("NavaRasa — Chetana Integration Pattern", () => {
	it("should be constructible with partial config (matching ChetanaConfig pattern)", () => {
		const nr = new NavaRasa({ smoothingAlpha: 0.5 });
		expect(nr.getState().shanta).toBeGreaterThan(0.5);
	});

	it("should accept an onEvent callback (matching Chetana event pattern)", () => {
		const events: string[] = [];
		const nr = new NavaRasa(
			{ smoothingAlpha: 0.8 },
			(event) => events.push(event),
		);

		// Push from shanta to raudra
		for (let i = 0; i < 30; i++) {
			nr.update(FURY_OBS);
		}

		expect(events.length).toBeGreaterThan(0);
		expect(events).toContain("nava_rasa:rasa_shift");
	});

	it("should produce a behavioral adaptation usable by ChetanaController", () => {
		const nr = new NavaRasa();

		const adaptation = nr.getAdaptation();

		// Adaptation should be a valid structured object
		expect(typeof adaptation.autonomy).toBe("string");
		expect(typeof adaptation.verbosity).toBe("string");
		expect(typeof adaptation.confirmations).toBe("boolean");
		expect(typeof adaptation.source).toBe("string");
		expect(RASA_LABELS).toContain(adaptation.source);
	});

	it("should complement BhavaSystem data — observation can be built from BhavaSystem state", () => {
		const nr = new NavaRasa();

		// Simulate building an observation from BhavaSystem affect data
		const obs: RasaObservation = {
			userSatisfaction: 0.8,   // from BhavaSystem valence
			confidence: 0.7,         // from BhavaSystem confidence
			successRate: 0.85,       // from AtmaDarshana tool mastery
			userStruggling: 0.1,     // from correction rate
			securityThreat: 0.0,     // from Dharma policy
			highRiskAction: 0.0,     // from tool metadata
			codeQualityLow: 0.2,     // from lint/analysis
			novelSituation: 0.3,     // from Dhyana attention novelty
			benignAnomaly: 0.0,      // from anomaly detector
			allTasksComplete: 0.0,   // from Sankalpa goal status
		};

		const state = nr.update(obs);
		assertSimplexConstraint(state);
	});
});
