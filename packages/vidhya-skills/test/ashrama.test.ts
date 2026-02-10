import { describe, it, expect, beforeEach } from "vitest";
import {
	createInitialState,
	AshramamMachine,
} from "../src/ashrama.js";
import type {
	AshramamStage,
	AshramamState,
	AshramamHysteresis,
} from "../src/types-v2.js";
import {
	DEFAULT_HYSTERESIS,
	ASHRAMA_ORDER,
} from "../src/types-v2.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(
	stage: AshramamStage,
	overrides?: Partial<AshramamState>
): AshramamState {
	const now = new Date().toISOString();
	return {
		stage,
		enteredAt: now,
		history: [
			{
				from: stage,
				to: stage,
				timestamp: now,
				reason: "test setup",
				healthAtTransition: 0,
			},
		],
		lastEvaluatedAt: now,
		consecutiveDaysInactive: 0,
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Ashrama", () => {
	let machine: AshramamMachine;

	beforeEach(() => {
		machine = new AshramamMachine();
	});

	// ── createInitialState ───────────────────────────────────────────────

	describe("createInitialState", () => {
		it("creates a state with brahmacharya by default", () => {
			const state = createInitialState();
			expect(state.stage).toBe("brahmacharya");
		});

		it("creates state with specified initial stage", () => {
			const state = createInitialState("grihastha");
			expect(state.stage).toBe("grihastha");
		});

		it("has initial history entry", () => {
			const state = createInitialState();
			expect(state.history).toHaveLength(1);
			expect(state.history[0].reason).toBe("initial creation");
			expect(state.history[0].healthAtTransition).toBe(0);
		});

		it("has valid ISO 8601 timestamps", () => {
			const state = createInitialState();
			expect(new Date(state.enteredAt).toISOString()).toBe(state.enteredAt);
			expect(new Date(state.lastEvaluatedAt).toISOString()).toBe(state.lastEvaluatedAt);
		});

		it("starts with zero consecutive inactive days", () => {
			const state = createInitialState();
			expect(state.consecutiveDaysInactive).toBe(0);
		});

		it("from and to in initial history match the stage", () => {
			const state = createInitialState("vanaprastha");
			expect(state.history[0].from).toBe("vanaprastha");
			expect(state.history[0].to).toBe("vanaprastha");
		});
	});

	// ── Constructor ──────────────────────────────────────────────────────

	describe("constructor", () => {
		it("uses default hysteresis when no config is provided", () => {
			const m = new AshramamMachine();
			const config = m.getConfig();
			expect(config.promotionThreshold).toBe(DEFAULT_HYSTERESIS.promotionThreshold);
			expect(config.demotionThreshold).toBe(DEFAULT_HYSTERESIS.demotionThreshold);
			expect(config.archivalDays).toBe(DEFAULT_HYSTERESIS.archivalDays);
			expect(config.minObservations).toBe(DEFAULT_HYSTERESIS.minObservations);
		});

		it("accepts partial configuration", () => {
			const m = new AshramamMachine({ promotionThreshold: 0.8 });
			const config = m.getConfig();
			expect(config.promotionThreshold).toBe(0.8);
			expect(config.demotionThreshold).toBe(DEFAULT_HYSTERESIS.demotionThreshold);
		});

		it("clamps values to ceiling limits", () => {
			const m = new AshramamMachine({
				promotionThreshold: 999,
				archivalDays: 9999,
			});
			const config = m.getConfig();
			expect(config.promotionThreshold).toBe(0.95); // HYSTERESIS_CEILINGS
			expect(config.archivalDays).toBe(365);
		});

		it("clamps minimum observations to at least 1", () => {
			const m = new AshramamMachine({ minObservations: 0 });
			const config = m.getConfig();
			expect(config.minObservations).toBe(1);
		});

		it("throws when promotionThreshold <= demotionThreshold", () => {
			expect(() => new AshramamMachine({
				promotionThreshold: 0.3,
				demotionThreshold: 0.3,
			})).toThrow("Hysteresis gap violation");
		});

		it("throws when promotionThreshold < demotionThreshold", () => {
			expect(() => new AshramamMachine({
				promotionThreshold: 0.2,
				demotionThreshold: 0.4,
			})).toThrow("Hysteresis gap violation");
		});

		it("ensures hysteresis gap: promotion > demotion", () => {
			const m = new AshramamMachine({
				promotionThreshold: 0.7,
				demotionThreshold: 0.2,
			});
			const config = m.getConfig();
			expect(config.promotionThreshold).toBeGreaterThan(config.demotionThreshold);
		});
	});

	// ── canTransition ────────────────────────────────────────────────────

	describe("canTransition", () => {
		it("allows brahmacharya -> grihastha", () => {
			const state = makeState("brahmacharya");
			const result = machine.canTransition(state, "grihastha");
			expect(result.allowed).toBe(true);
		});

		it("allows grihastha -> vanaprastha", () => {
			const state = makeState("grihastha");
			const result = machine.canTransition(state, "vanaprastha");
			expect(result.allowed).toBe(true);
		});

		it("allows grihastha -> brahmacharya (quarantine)", () => {
			const state = makeState("grihastha");
			const result = machine.canTransition(state, "brahmacharya");
			expect(result.allowed).toBe(true);
		});

		it("allows vanaprastha -> grihastha (restore)", () => {
			const state = makeState("vanaprastha");
			const result = machine.canTransition(state, "grihastha");
			expect(result.allowed).toBe(true);
		});

		it("allows vanaprastha -> sannyasa (archive)", () => {
			const state = makeState("vanaprastha");
			const result = machine.canTransition(state, "sannyasa");
			expect(result.allowed).toBe(true);
		});

		it("allows sannyasa -> brahmacharya (resurrect)", () => {
			const state = makeState("sannyasa");
			const result = machine.canTransition(state, "brahmacharya");
			expect(result.allowed).toBe(true);
		});

		it("rejects brahmacharya -> vanaprastha (skip)", () => {
			const state = makeState("brahmacharya");
			const result = machine.canTransition(state, "vanaprastha");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("invalid transition");
		});

		it("rejects brahmacharya -> sannyasa (skip)", () => {
			const state = makeState("brahmacharya");
			const result = machine.canTransition(state, "sannyasa");
			expect(result.allowed).toBe(false);
		});

		it("rejects sannyasa -> grihastha (must go via brahmacharya)", () => {
			const state = makeState("sannyasa");
			const result = machine.canTransition(state, "grihastha");
			expect(result.allowed).toBe(false);
		});

		it("rejects sannyasa -> vanaprastha", () => {
			const state = makeState("sannyasa");
			const result = machine.canTransition(state, "vanaprastha");
			expect(result.allowed).toBe(false);
		});

		it("rejects self-transition (same stage)", () => {
			const state = makeState("grihastha");
			const result = machine.canTransition(state, "grihastha");
			expect(result.allowed).toBe(false);
			expect(result.reason).toBe("already in target stage");
		});

		it("rejects vanaprastha -> brahmacharya", () => {
			const state = makeState("vanaprastha");
			const result = machine.canTransition(state, "brahmacharya");
			expect(result.allowed).toBe(false);
		});
	});

	// ── transition ───────────────────────────────────────────────────────

	describe("transition", () => {
		it("transitions brahmacharya -> grihastha", () => {
			const state = makeState("brahmacharya");
			const newState = machine.transition(state, "grihastha", "promoted", 0.8);
			expect(newState.stage).toBe("grihastha");
		});

		it("records transition in history", () => {
			const state = makeState("brahmacharya");
			const newState = machine.transition(state, "grihastha", "promoted", 0.8);
			expect(newState.history.length).toBe(state.history.length + 1);

			const last = newState.history[newState.history.length - 1];
			expect(last.from).toBe("brahmacharya");
			expect(last.to).toBe("grihastha");
			expect(last.reason).toBe("promoted");
			expect(last.healthAtTransition).toBe(0.8);
		});

		it("updates enteredAt timestamp", () => {
			const state = makeState("brahmacharya");
			const oldEnteredAt = state.enteredAt;
			// Small delay to ensure different timestamp
			const newState = machine.transition(state, "grihastha", "promoted", 0.7);
			expect(new Date(newState.enteredAt).getTime()).toBeGreaterThanOrEqual(
				new Date(oldEnteredAt).getTime()
			);
		});

		it("resets inactivity counter when promoting to grihastha", () => {
			const state = makeState("vanaprastha", { consecutiveDaysInactive: 50 });
			const newState = machine.transition(state, "grihastha", "restored", 0.8);
			expect(newState.consecutiveDaysInactive).toBe(0);
		});

		it("preserves inactivity counter for non-grihastha transitions", () => {
			const state = makeState("grihastha", { consecutiveDaysInactive: 10 });
			const newState = machine.transition(state, "vanaprastha", "deprecated", 0.1);
			expect(newState.consecutiveDaysInactive).toBe(10);
		});

		it("throws on invalid transition", () => {
			const state = makeState("brahmacharya");
			expect(() =>
				machine.transition(state, "sannyasa", "invalid", 0)
			).toThrow("Transition not allowed");
		});

		it("defaults healthScore to 0 when not provided", () => {
			const state = makeState("brahmacharya");
			const newState = machine.transition(state, "grihastha", "promoted");
			const last = newState.history[newState.history.length - 1];
			expect(last.healthAtTransition).toBe(0);
		});
	});

	// ── evaluate (auto-transitions) ──────────────────────────────────────

	describe("evaluate", () => {
		it("promotes brahmacharya -> grihastha on high health + trust + observations", () => {
			const state = makeState("brahmacharya");
			const newState = machine.evaluate(state, 0.7, 0.6, 10);
			expect(newState.stage).toBe("grihastha");
		});

		it("does not promote brahmacharya if health < promotionThreshold", () => {
			const state = makeState("brahmacharya");
			const newState = machine.evaluate(state, 0.5, 0.6, 10);
			expect(newState.stage).toBe("brahmacharya");
		});

		it("does not promote brahmacharya if trust < 0.5", () => {
			const state = makeState("brahmacharya");
			const newState = machine.evaluate(state, 0.8, 0.4, 10);
			expect(newState.stage).toBe("brahmacharya");
		});

		it("does not promote brahmacharya if observations < minObservations", () => {
			const state = makeState("brahmacharya");
			const newState = machine.evaluate(state, 0.8, 0.6, 3);
			expect(newState.stage).toBe("brahmacharya");
		});

		it("demotes grihastha -> vanaprastha on low health", () => {
			const state = makeState("grihastha");
			const newState = machine.evaluate(state, 0.2, 0.8, 10);
			expect(newState.stage).toBe("vanaprastha");
		});

		it("does not demote grihastha if health >= demotionThreshold", () => {
			const state = makeState("grihastha");
			const newState = machine.evaluate(state, 0.3, 0.8, 10);
			expect(newState.stage).toBe("grihastha");
		});

		it("does not demote grihastha if observations < minObservations", () => {
			const state = makeState("grihastha");
			const newState = machine.evaluate(state, 0.1, 0.8, 3);
			expect(newState.stage).toBe("grihastha");
		});

		it("restores vanaprastha -> grihastha on high health recovery", () => {
			const state = makeState("vanaprastha");
			const newState = machine.evaluate(state, 0.7, 0.8, 10);
			expect(newState.stage).toBe("grihastha");
		});

		it("archives vanaprastha -> sannyasa after archivalDays inactive", () => {
			const state = makeState("vanaprastha", {
				consecutiveDaysInactive: 91, // default archivalDays = 90
			});
			const newState = machine.evaluate(state, 0.1, 0.5, 10);
			expect(newState.stage).toBe("sannyasa");
		});

		it("does not archive vanaprastha if inactive < archivalDays", () => {
			const state = makeState("vanaprastha", {
				consecutiveDaysInactive: 89,
			});
			const newState = machine.evaluate(state, 0.1, 0.5, 10);
			expect(newState.stage).toBe("vanaprastha");
		});

		it("prefers restore over archive when health recovers in vanaprastha", () => {
			const state = makeState("vanaprastha", {
				consecutiveDaysInactive: 100,
			});
			// Health is high enough for promotion — restore wins over archival
			const newState = machine.evaluate(state, 0.7, 0.8, 10);
			expect(newState.stage).toBe("grihastha");
		});

		it("does nothing for sannyasa (no auto-transitions)", () => {
			const state = makeState("sannyasa");
			const newState = machine.evaluate(state, 1.0, 1.0, 1000);
			expect(newState.stage).toBe("sannyasa");
		});

		it("updates lastEvaluatedAt even when no transition occurs", () => {
			const state = makeState("grihastha");
			const before = new Date(state.lastEvaluatedAt).getTime();
			const newState = machine.evaluate(state, 0.5, 0.8, 10);
			expect(newState.stage).toBe("grihastha");
			expect(new Date(newState.lastEvaluatedAt).getTime()).toBeGreaterThanOrEqual(before);
		});
	});

	// ── History tracking ─────────────────────────────────────────────────

	describe("history tracking", () => {
		it("accumulates transitions across multiple promotions/demotions", () => {
			let state = makeState("brahmacharya");
			state = machine.transition(state, "grihastha", "promoted", 0.7);
			state = machine.transition(state, "vanaprastha", "deprecated", 0.2);
			state = machine.transition(state, "grihastha", "restored", 0.8);

			expect(state.history).toHaveLength(4); // 1 initial + 3 transitions
			expect(state.history[1].from).toBe("brahmacharya");
			expect(state.history[1].to).toBe("grihastha");
			expect(state.history[2].from).toBe("grihastha");
			expect(state.history[2].to).toBe("vanaprastha");
			expect(state.history[3].from).toBe("vanaprastha");
			expect(state.history[3].to).toBe("grihastha");
		});

		it("getHistory returns a copy (not the original array)", () => {
			const state = makeState("brahmacharya");
			const history = machine.getHistory(state);
			history.push({
				from: "grihastha",
				to: "vanaprastha",
				timestamp: new Date().toISOString(),
				reason: "injected",
				healthAtTransition: 0,
			});
			expect(machine.getHistory(state).length).toBe(1); // Original unchanged
		});
	});

	// ── recordInactiveDay / recordActivity ───────────────────────────────

	describe("recordInactiveDay", () => {
		it("increments consecutiveDaysInactive", () => {
			const state = makeState("vanaprastha", { consecutiveDaysInactive: 5 });
			const updated = machine.recordInactiveDay(state);
			expect(updated.consecutiveDaysInactive).toBe(6);
		});

		it("updates lastEvaluatedAt", () => {
			const state = makeState("vanaprastha");
			const updated = machine.recordInactiveDay(state);
			expect(new Date(updated.lastEvaluatedAt).getTime()).toBeGreaterThanOrEqual(
				new Date(state.lastEvaluatedAt).getTime()
			);
		});
	});

	describe("recordActivity", () => {
		it("resets consecutiveDaysInactive to 0", () => {
			const state = makeState("vanaprastha", { consecutiveDaysInactive: 30 });
			const updated = machine.recordActivity(state);
			expect(updated.consecutiveDaysInactive).toBe(0);
		});

		it("updates lastEvaluatedAt", () => {
			const state = makeState("grihastha");
			const updated = machine.recordActivity(state);
			expect(new Date(updated.lastEvaluatedAt).getTime()).toBeGreaterThanOrEqual(
				new Date(state.lastEvaluatedAt).getTime()
			);
		});
	});

	// ── isMatchable / isExecutable / getMatchWeight ──────────────────────

	describe("isMatchable", () => {
		it("returns true for grihastha", () => {
			expect(machine.isMatchable("grihastha")).toBe(true);
		});

		it("returns true for vanaprastha", () => {
			expect(machine.isMatchable("vanaprastha")).toBe(true);
		});

		it("returns false for brahmacharya", () => {
			expect(machine.isMatchable("brahmacharya")).toBe(false);
		});

		it("returns false for sannyasa", () => {
			expect(machine.isMatchable("sannyasa")).toBe(false);
		});
	});

	describe("isExecutable", () => {
		it("returns true for grihastha", () => {
			expect(machine.isExecutable("grihastha")).toBe(true);
		});

		it("returns true for vanaprastha", () => {
			expect(machine.isExecutable("vanaprastha")).toBe(true);
		});

		it("returns false for brahmacharya", () => {
			expect(machine.isExecutable("brahmacharya")).toBe(false);
		});

		it("returns false for sannyasa", () => {
			expect(machine.isExecutable("sannyasa")).toBe(false);
		});
	});

	describe("getMatchWeight", () => {
		it("returns 1.0 for grihastha", () => {
			expect(machine.getMatchWeight("grihastha")).toBe(1.0);
		});

		it("returns 0.5 for vanaprastha", () => {
			expect(machine.getMatchWeight("vanaprastha")).toBe(0.5);
		});

		it("returns 0.0 for brahmacharya", () => {
			expect(machine.getMatchWeight("brahmacharya")).toBe(0.0);
		});

		it("returns 0.0 for sannyasa", () => {
			expect(machine.getMatchWeight("sannyasa")).toBe(0.0);
		});
	});

	// ── getConfig ────────────────────────────────────────────────────────

	describe("getConfig", () => {
		it("returns a copy of the config", () => {
			const config1 = machine.getConfig();
			const config2 = machine.getConfig();
			expect(config1).toEqual(config2);
			expect(config1).not.toBe(config2); // Different object references
		});

		it("returns clamped config values", () => {
			const m = new AshramamMachine({
				promotionThreshold: 0.9,
				demotionThreshold: 0.1,
				archivalDays: 500,  // Will be clamped to 365
			});
			const config = m.getConfig();
			expect(config.archivalDays).toBe(365);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles exact threshold boundary for promotion (health == promotionThreshold)", () => {
			const state = makeState("brahmacharya");
			const newState = machine.evaluate(state, 0.6, 0.5, 5);
			// health >= 0.6 AND trust >= 0.5 AND obs >= 5 => should promote
			expect(newState.stage).toBe("grihastha");
		});

		it("handles exact threshold boundary for demotion (health < demotionThreshold)", () => {
			const state = makeState("grihastha");
			// health 0.3 is NOT < 0.3 (the demotion threshold), so no demotion
			const newState = machine.evaluate(state, 0.3, 0.8, 10);
			expect(newState.stage).toBe("grihastha");
		});

		it("handles exact archivalDays boundary", () => {
			const state = makeState("vanaprastha", {
				consecutiveDaysInactive: 90,
			});
			// exactly 90 = archivalDays => should archive (>= check)
			const newState = machine.evaluate(state, 0.1, 0.5, 10);
			expect(newState.stage).toBe("sannyasa");
		});

		it("full lifecycle: brahmacharya -> grihastha -> vanaprastha -> sannyasa", () => {
			let state = createInitialState();
			expect(state.stage).toBe("brahmacharya");

			state = machine.evaluate(state, 0.8, 0.6, 10);
			expect(state.stage).toBe("grihastha");

			state = machine.evaluate(state, 0.1, 0.6, 10);
			expect(state.stage).toBe("vanaprastha");

			// Simulate becoming inactive for archival
			state = { ...state, consecutiveDaysInactive: 91 };
			state = machine.evaluate(state, 0.1, 0.5, 10);
			expect(state.stage).toBe("sannyasa");

			// Final history should have initial + 3 transitions = 4 entries
			expect(state.history.length).toBe(4);
		});

		it("custom hysteresis config controls transition behavior", () => {
			const strict = new AshramamMachine({
				promotionThreshold: 0.9,
				demotionThreshold: 0.1,
				minObservations: 20,
			});

			const state = makeState("brahmacharya");
			// 0.8 health doesn't meet 0.9 threshold
			const noPromo = strict.evaluate(state, 0.8, 0.6, 25);
			expect(noPromo.stage).toBe("brahmacharya");

			// 0.9 health meets the strict threshold
			const promoted = strict.evaluate(state, 0.9, 0.6, 25);
			expect(promoted.stage).toBe("grihastha");
		});
	});
});
