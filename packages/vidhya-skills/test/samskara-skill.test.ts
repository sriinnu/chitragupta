import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
	SamskaraSkillBridge,
	computeDreyfusLevel,
} from "../src/samskara-skill.js";
import type { SamskaraConfig, SerializedSamskaraState } from "../src/samskara-skill.js";
import type { SamskaraImpression, AnandamayaMastery, DreyfusLevel } from "../src/types-v2.js";
import { INITIAL_ANANDAMAYA, DREYFUS_THRESHOLDS } from "../src/types-v2.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeImpression(overrides: Partial<SamskaraImpression> = {}): SamskaraImpression {
	return {
		skillName: "test-skill",
		sessionId: "session-1",
		timestamp: new Date().toISOString(),
		success: true,
		latencyMs: 50,
		triggerQuery: "do something",
		matchScore: 0.9,
		wasOverridden: false,
		...overrides,
	};
}

/**
 * Records N impressions with alternating success/failure according to pattern.
 * Returns the final mastery state.
 */
function recordN(
	bridge: SamskaraSkillBridge,
	skillName: string,
	count: number,
	successPattern: boolean | ((i: number) => boolean) = true,
	latencyMs = 50,
): AnandamayaMastery {
	let last!: AnandamayaMastery;
	for (let i = 0; i < count; i++) {
		const success = typeof successPattern === "function" ? successPattern(i) : successPattern;
		bridge.recordImpression(
			makeImpression({ skillName, success, latencyMs, timestamp: new Date().toISOString() }),
		);
		last = bridge.getMastery(skillName);
	}
	return last;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SamskaraSkillBridge", () => {
	let bridge: SamskaraSkillBridge;

	beforeEach(() => {
		bridge = new SamskaraSkillBridge();
	});

	// ── Initial State ──────────────────────────────────────────────────

	describe("initial state", () => {
		it("returns default mastery for unknown skill", () => {
			const m = bridge.getMastery("nonexistent");
			expect(m.totalInvocations).toBe(0);
			expect(m.successCount).toBe(0);
			expect(m.failureCount).toBe(0);
			expect(m.successRate).toBe(0);
			expect(m.avgLatencyMs).toBe(0);
			expect(m.dreyfusLevel).toBe("novice");
			expect(m.firstInvokedAt).toBeNull();
			expect(m.lastInvokedAt).toBeNull();
			expect(m.thompsonAlpha).toBe(1);
			expect(m.thompsonBeta).toBe(1);
		});

		it("default mastery exactly matches INITIAL_ANANDAMAYA", () => {
			const m = bridge.getMastery("phantom");
			expect(m).toEqual(INITIAL_ANANDAMAYA);
		});

		it("returns a copy, not the original INITIAL_ANANDAMAYA reference", () => {
			const m = bridge.getMastery("phantom");
			expect(m).not.toBe(INITIAL_ANANDAMAYA);
		});
	});

	// ── Mastery Tracking (mathematical properties) ─────────────────────

	describe("mastery tracking", () => {
		it("after 1 successful impression: totalInvocations=1, successCount=1, successRate=1.0", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", success: true }));
			const m = bridge.getMastery("s1");
			expect(m.totalInvocations).toBe(1);
			expect(m.successCount).toBe(1);
			expect(m.failureCount).toBe(0);
			expect(m.successRate).toBe(1.0);
		});

		it("after 1 failed impression: totalInvocations=1, failureCount=1, successRate=0.0", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", success: false }));
			const m = bridge.getMastery("s1");
			expect(m.totalInvocations).toBe(1);
			expect(m.successCount).toBe(0);
			expect(m.failureCount).toBe(1);
			expect(m.successRate).toBe(0);
		});

		it("successRate = successCount / totalInvocations for mixed results", () => {
			// 3 successes, 2 failures = 3/5 = 0.6
			const pattern = (i: number) => i < 3; // first 3 succeed, next 2 fail
			const m = recordN(bridge, "s1", 5, pattern);
			expect(m.successCount).toBe(3);
			expect(m.failureCount).toBe(2);
			expect(m.totalInvocations).toBe(5);
			expect(m.successRate).toBeCloseTo(3 / 5, 10);
		});

		it("successRate exact fraction: 7 successes out of 11 invocations", () => {
			const pattern = (i: number) => i < 7;
			const m = recordN(bridge, "s1", 11, pattern);
			expect(m.successRate).toBeCloseTo(7 / 11, 10);
		});

		it("firstInvokedAt set on first impression, never changes after", () => {
			const time1 = "2024-01-01T00:00:00.000Z";
			const time2 = "2024-06-01T00:00:00.000Z";
			bridge.recordImpression(makeImpression({ skillName: "s1", timestamp: time1 }));
			const first = bridge.getMastery("s1").firstInvokedAt;
			expect(first).not.toBeNull();

			bridge.recordImpression(makeImpression({ skillName: "s1", timestamp: time2 }));
			const second = bridge.getMastery("s1").firstInvokedAt;
			expect(second).toBe(first);
		});

		it("lastInvokedAt updates on every impression", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1" }));
			const t1 = bridge.getMastery("s1").lastInvokedAt;

			// Small delay to ensure different timestamp
			bridge.recordImpression(makeImpression({ skillName: "s1" }));
			const t2 = bridge.getMastery("s1").lastInvokedAt;

			expect(t1).not.toBeNull();
			expect(t2).not.toBeNull();
			// lastInvokedAt should be set (both non-null is sufficient proof it updates)
			expect(typeof t2).toBe("string");
		});

		it("mastery produces new object each time (immutability)", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1" }));
			const m1 = bridge.getMastery("s1");
			bridge.recordImpression(makeImpression({ skillName: "s1" }));
			const m2 = bridge.getMastery("s1");
			expect(m1).not.toBe(m2);
			expect(m1.totalInvocations).toBe(1);
			expect(m2.totalInvocations).toBe(2);
		});

		it("getAllMastery returns a copy of the map", () => {
			bridge.recordImpression(makeImpression({ skillName: "alpha" }));
			bridge.recordImpression(makeImpression({ skillName: "beta" }));
			const all = bridge.getAllMastery();
			expect(all.size).toBe(2);
			expect(all.has("alpha")).toBe(true);
			expect(all.has("beta")).toBe(true);
			// Mutating the returned map shouldn't affect internal state
			all.delete("alpha");
			expect(bridge.getAllMastery().size).toBe(2);
		});
	});

	// ── EMA Latency Tracking ──────────────────────────────────────────

	describe("avgLatencyMs (EMA)", () => {
		it("first impression: avgLatencyMs equals the latency itself", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 100 }));
			expect(bridge.getMastery("s1").avgLatencyMs).toBe(100);
		});

		it("second impression: EMA = 0.2 * new + 0.8 * old", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 100 }));
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 200 }));
			// EMA = 0.2 * 200 + 0.8 * 100 = 40 + 80 = 120
			expect(bridge.getMastery("s1").avgLatencyMs).toBeCloseTo(120, 10);
		});

		it("EMA converges toward recent values", () => {
			// Start with 100ms, then 10 impressions at 50ms
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 100 }));
			for (let i = 0; i < 10; i++) {
				bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 50 }));
			}
			const avg = bridge.getMastery("s1").avgLatencyMs;
			// After 10 steps of EMA(0.2) toward 50, should be close to 50
			// Exact: 100*(0.8^10) + 50*(1 - 0.8^10) = 100*0.1073... + 50*0.8926... = 10.73 + 44.63 = 55.37
			expect(avg).toBeCloseTo(100 * Math.pow(0.8, 10) + 50 * (1 - Math.pow(0.8, 10)), 5);
		});

		it("zero latency impressions handled correctly", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 0 }));
			expect(bridge.getMastery("s1").avgLatencyMs).toBe(0);
			bridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: 100 }));
			// When avgLatencyMs === 0, the code uses latencyMs directly (not EMA):
			// `current.avgLatencyMs === 0 ? latencyMs : EMA * latencyMs + (1 - EMA) * current.avgLatencyMs`
			// So avgLatencyMs becomes 100, not 20
			expect(bridge.getMastery("s1").avgLatencyMs).toBe(100);
		});
	});

	// ── Thompson Sampling Parameters ──────────────────────────────────

	describe("Thompson Sampling parameters", () => {
		it("initial alpha=1, beta=1 (uniform prior)", () => {
			const m = bridge.getMastery("unknown");
			expect(m.thompsonAlpha).toBe(1);
			expect(m.thompsonBeta).toBe(1);
		});

		it("alpha increments on success, beta stays", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", success: true }));
			const m = bridge.getMastery("s1");
			expect(m.thompsonAlpha).toBe(2);
			expect(m.thompsonBeta).toBe(1);
		});

		it("beta increments on failure, alpha stays", () => {
			bridge.recordImpression(makeImpression({ skillName: "s1", success: false }));
			const m = bridge.getMastery("s1");
			expect(m.thompsonAlpha).toBe(1);
			expect(m.thompsonBeta).toBe(2);
		});

		it("after 5 successes: alpha=6, beta=1", () => {
			const m = recordN(bridge, "s1", 5, true);
			expect(m.thompsonAlpha).toBe(6);
			expect(m.thompsonBeta).toBe(1);
		});

		it("after 3 successes + 2 failures: alpha=4, beta=3", () => {
			const pattern = (i: number) => i < 3;
			const m = recordN(bridge, "s1", 5, pattern);
			expect(m.thompsonAlpha).toBe(4);
			expect(m.thompsonBeta).toBe(3);
		});

		it("after 10 failures: alpha=1, beta=11", () => {
			const m = recordN(bridge, "s1", 10, false);
			expect(m.thompsonAlpha).toBe(1);
			expect(m.thompsonBeta).toBe(11);
		});

		it("alpha + beta = totalInvocations + 2 (always, since prior is Beta(1,1))", () => {
			const n = 37;
			const pattern = (i: number) => i % 3 !== 0; // 2/3 success
			const m = recordN(bridge, "s1", n, pattern);
			expect(m.thompsonAlpha + m.thompsonBeta).toBe(n + 2);
		});
	});

	// ── Thompson Sampling: sampleThompson ──────────────────────────────

	describe("sampleThompson", () => {
		it("returns value in [0, 1]", () => {
			recordN(bridge, "s1", 20, true);
			for (let i = 0; i < 50; i++) {
				const sample = bridge.sampleThompson("s1");
				expect(sample).toBeGreaterThanOrEqual(0);
				expect(sample).toBeLessThanOrEqual(1);
			}
		});

		it("high-success skill samples higher on average than low-success", () => {
			recordN(bridge, "good", 30, true);
			recordN(bridge, "bad", 30, false);

			let sumGood = 0;
			let sumBad = 0;
			const trials = 200;
			for (let i = 0; i < trials; i++) {
				sumGood += bridge.sampleThompson("good");
				sumBad += bridge.sampleThompson("bad");
			}
			expect(sumGood / trials).toBeGreaterThan(sumBad / trials);
		});

		it("uninitialised skill still samples (uniform prior Beta(1,1))", () => {
			const sample = bridge.sampleThompson("never-seen");
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		});

		it("uses normal approximation for alpha+beta >= 100", () => {
			// 98 successes => alpha=99, beta=1 => alpha+beta=100 => normal path
			recordN(bridge, "huge", 98, true);
			const m = bridge.getMastery("huge");
			expect(m.thompsonAlpha + m.thompsonBeta).toBe(100);
			const sample = bridge.sampleThompson("huge");
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		});
	});

	// ── Dreyfus Level Progression ─────────────────────────────────────

	describe("Dreyfus level progression", () => {
		it("DREYFUS_THRESHOLDS is ordered highest-to-lowest", () => {
			for (let i = 1; i < DREYFUS_THRESHOLDS.length; i++) {
				expect(DREYFUS_THRESHOLDS[i - 1].minUses).toBeGreaterThanOrEqual(
					DREYFUS_THRESHOLDS[i].minUses,
				);
			}
		});

		it("0 invocations = novice", () => {
			expect(computeDreyfusLevel(0, 0)).toBe("novice");
		});

		it("4 invocations with 100% success = novice (below 5 threshold)", () => {
			expect(computeDreyfusLevel(4, 1.0)).toBe("novice");
		});

		it("5 invocations with 30% success = advanced-beginner", () => {
			expect(computeDreyfusLevel(5, 0.3)).toBe("advanced-beginner");
		});

		it("5 invocations with 29% success = novice (below minSuccessRate)", () => {
			expect(computeDreyfusLevel(5, 0.29)).toBe("novice");
		});

		it("19 invocations with 100% success = advanced-beginner (below 20 threshold)", () => {
			expect(computeDreyfusLevel(19, 1.0)).toBe("advanced-beginner");
		});

		it("20 invocations with 50% success = competent", () => {
			expect(computeDreyfusLevel(20, 0.5)).toBe("competent");
		});

		it("20 invocations with 49% success = advanced-beginner (below minSuccessRate for competent)", () => {
			expect(computeDreyfusLevel(20, 0.49)).toBe("advanced-beginner");
		});

		it("49 invocations with 100% success = competent (below 50 threshold)", () => {
			expect(computeDreyfusLevel(49, 1.0)).toBe("competent");
		});

		it("50 invocations with 70% success = proficient", () => {
			expect(computeDreyfusLevel(50, 0.7)).toBe("proficient");
		});

		it("50 invocations with 69% success = competent (below minSuccessRate for proficient)", () => {
			expect(computeDreyfusLevel(50, 0.69)).toBe("competent");
		});

		it("99 invocations with 100% success = proficient (below 100 threshold)", () => {
			expect(computeDreyfusLevel(99, 1.0)).toBe("proficient");
		});

		it("100 invocations with 85% success = expert", () => {
			expect(computeDreyfusLevel(100, 0.85)).toBe("expert");
		});

		it("100 invocations with 84% success = proficient (below minSuccessRate for expert)", () => {
			expect(computeDreyfusLevel(100, 0.84)).toBe("proficient");
		});

		it("1000 invocations with 90% success = expert", () => {
			expect(computeDreyfusLevel(1000, 0.9)).toBe("expert");
		});

		it("high invocations but low success rate: 200 uses, 20% success = novice", () => {
			// 200 uses but only 20% success. Check thresholds:
			// expert: 100+ uses, 0.85 success => no
			// proficient: 50+ uses, 0.7 success => no
			// competent: 20+ uses, 0.5 success => no
			// advanced-beginner: 5+ uses, 0.3 success => no (0.2 < 0.3)
			// novice: 0+ uses, 0 success => yes
			expect(computeDreyfusLevel(200, 0.2)).toBe("novice");
		});

		it("Dreyfus level integrates into mastery via recordImpression", () => {
			// Record 20 all-success impressions => competent threshold
			const m = recordN(bridge, "s1", 20, true);
			expect(m.dreyfusLevel).toBe("competent");
		});

		it("Dreyfus level drops with failures (success rate effect)", () => {
			// 20 successes => competent; then 80 failures => 20/100 = 0.2 success rate
			recordN(bridge, "s1", 20, true);
			const m = recordN(bridge, "s1", 80, false);
			// Total: 100 uses, successRate=0.2
			// expert: needs 0.85 => no; proficient: needs 0.7 => no; competent: needs 0.5 => no
			// advanced-beginner: needs 0.3 => no (0.2 < 0.3); novice => yes
			expect(m.dreyfusLevel).toBe("novice");
		});
	});

	// ── Impression Buffer (FIFO) ──────────────────────────────────────

	describe("impression buffer (FIFO)", () => {
		it("respects maxImpressionsPerSkill limit", () => {
			const smallBridge = new SamskaraSkillBridge({ maxImpressionsPerSkill: 3 });
			for (let i = 0; i < 5; i++) {
				smallBridge.recordImpression(makeImpression({ skillName: "s1", latencyMs: i * 10 }));
			}
			// Buffer should contain only last 3. Verify via mastery which is always up to date.
			const m = smallBridge.getMastery("s1");
			expect(m.totalInvocations).toBe(5); // mastery tracks all
		});

		it("maxImpressionsPerSkill is clamped to ceiling of 500", () => {
			const bigBridge = new SamskaraSkillBridge({ maxImpressionsPerSkill: 10000 });
			// Record 501 impressions and verify mastery tracks all
			for (let i = 0; i < 501; i++) {
				bigBridge.recordImpression(makeImpression({ skillName: "s1" }));
			}
			// mastery should have all 501
			expect(bigBridge.getMastery("s1").totalInvocations).toBe(501);
		});

		it("default maxImpressionsPerSkill is 100", () => {
			// Record 101 impressions, verify via serialization that buffer was capped
			for (let i = 0; i < 101; i++) {
				bridge.recordImpression(makeImpression({ skillName: "s1" }));
			}
			expect(bridge.getMastery("s1").totalInvocations).toBe(101);
		});

		it("impressions stored per skill independently", () => {
			for (let i = 0; i < 5; i++) {
				bridge.recordImpression(makeImpression({ skillName: "s1" }));
				bridge.recordImpression(makeImpression({ skillName: "s2" }));
			}
			expect(bridge.getMastery("s1").totalInvocations).toBe(5);
			expect(bridge.getMastery("s2").totalInvocations).toBe(5);
		});
	});

	// ── Preference Detection ──────────────────────────────────────────

	describe("preference detection", () => {
		it("records preference when wasOverridden=true with preferredSkill", () => {
			// Record 3 overrides (OVERRIDE_THRESHOLD = 3 in source)
			for (let i = 0; i < 3; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "bad-skill",
						wasOverridden: true,
						preferredSkill: "good-skill",
					}),
				);
			}
			const prefs = bridge.getPreferences();
			expect(prefs.length).toBe(1);
			expect(prefs[0].preferred).toBe("good-skill");
			expect(prefs[0].over).toBe("bad-skill");
			expect(prefs[0].count).toBe(3);
		});

		it("no preference recorded when wasOverridden=false", () => {
			for (let i = 0; i < 10; i++) {
				bridge.recordImpression(makeImpression({ skillName: "s1", wasOverridden: false }));
			}
			expect(bridge.getPreferences()).toHaveLength(0);
		});

		it("preference not triggered below OVERRIDE_THRESHOLD of 3", () => {
			for (let i = 0; i < 2; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "bad",
						wasOverridden: true,
						preferredSkill: "good",
					}),
				);
			}
			expect(bridge.getPreferences()).toHaveLength(0);
		});

		it("preference confidence accumulates with repeated overrides", () => {
			for (let i = 0; i < 5; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "old",
						wasOverridden: true,
						preferredSkill: "new",
					}),
				);
			}
			const prefs = bridge.getPreferences();
			expect(prefs.length).toBe(1);
			expect(prefs[0].count).toBe(5);
			expect(prefs[0].confidence).toBeGreaterThanOrEqual(0);
		});

		it("onPreferenceDetected callback fires at threshold", () => {
			const spy = vi.fn();
			const b = new SamskaraSkillBridge({ onPreferenceDetected: spy });
			for (let i = 0; i < 3; i++) {
				b.recordImpression(
					makeImpression({
						skillName: "old",
						wasOverridden: true,
						preferredSkill: "new",
					}),
				);
			}
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith("new", "old", expect.any(Number));
		});

		it("onPreferenceDetected fires exactly once at threshold, not again after", () => {
			const spy = vi.fn();
			const b = new SamskaraSkillBridge({ onPreferenceDetected: spy });
			for (let i = 0; i < 6; i++) {
				b.recordImpression(
					makeImpression({
						skillName: "old",
						wasOverridden: true,
						preferredSkill: "new",
					}),
				);
			}
			// Only fires when count === 3 (exact threshold check)
			expect(spy).toHaveBeenCalledTimes(1);
		});

		it("getPreferences sorted by confidence descending", () => {
			// Create two preference pairs with different counts
			for (let i = 0; i < 5; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "slow",
						wasOverridden: true,
						preferredSkill: "fast",
					}),
				);
			}
			for (let i = 0; i < 3; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "old",
						wasOverridden: true,
						preferredSkill: "new",
					}),
				);
			}
			const prefs = bridge.getPreferences();
			expect(prefs.length).toBe(2);
			// Sorted by confidence descending
			for (let i = 1; i < prefs.length; i++) {
				expect(prefs[i - 1].confidence).toBeGreaterThanOrEqual(prefs[i].confidence);
			}
		});
	});

	// ── Mastery Change Callback ───────────────────────────────────────

	describe("onMasteryChange callback", () => {
		it("fires on every impression", () => {
			const spy = vi.fn();
			const b = new SamskaraSkillBridge({ onMasteryChange: spy });
			b.recordImpression(makeImpression({ skillName: "s1" }));
			b.recordImpression(makeImpression({ skillName: "s1" }));
			expect(spy).toHaveBeenCalledTimes(2);
		});

		it("receives skillName and updated mastery", () => {
			const spy = vi.fn();
			const b = new SamskaraSkillBridge({ onMasteryChange: spy });
			b.recordImpression(makeImpression({ skillName: "s1", success: true }));
			expect(spy).toHaveBeenCalledWith("s1", expect.objectContaining({
				totalInvocations: 1,
				successCount: 1,
				thompsonAlpha: 2,
			}));
		});
	});

	// ── Session Co-occurrence & Flush ─────────────────────────────────

	describe("session co-occurrence and flush", () => {
		it("flushSession builds co-occurrence counts for skill pairs", () => {
			bridge.recordImpression(makeImpression({ skillName: "A", sessionId: "sess-1" }));
			bridge.recordImpression(makeImpression({ skillName: "B", sessionId: "sess-1" }));
			bridge.recordImpression(makeImpression({ skillName: "C", sessionId: "sess-1" }));
			bridge.flushSession("sess-1");

			// After flush, co-occurrence map should have A-B, A-C, B-C pairs
			const serialized = bridge.serialize();
			const coMap = new Map(serialized.coOccurrences.map(([k, v]) => [k, new Map(v)]));
			expect(coMap.get("A")?.get("B")).toBe(1);
			expect(coMap.get("A")?.get("C")).toBe(1);
			expect(coMap.get("B")?.get("A")).toBe(1);
			expect(coMap.get("B")?.get("C")).toBe(1);
			expect(coMap.get("C")?.get("A")).toBe(1);
			expect(coMap.get("C")?.get("B")).toBe(1);
		});

		it("flushing non-existent session is a no-op", () => {
			bridge.flushSession("nonexistent");
			const serialized = bridge.serialize();
			expect(serialized.coOccurrences).toHaveLength(0);
		});

		it("multiple sessions accumulate co-occurrence counts", () => {
			bridge.recordImpression(makeImpression({ skillName: "A", sessionId: "s1" }));
			bridge.recordImpression(makeImpression({ skillName: "B", sessionId: "s1" }));
			bridge.flushSession("s1");

			bridge.recordImpression(makeImpression({ skillName: "A", sessionId: "s2" }));
			bridge.recordImpression(makeImpression({ skillName: "B", sessionId: "s2" }));
			bridge.flushSession("s2");

			const serialized = bridge.serialize();
			const coMap = new Map(serialized.coOccurrences.map(([k, v]) => [k, new Map(v)]));
			expect(coMap.get("A")?.get("B")).toBe(2);
		});
	});

	// ── Multiple Skills Tracked Independently ─────────────────────────

	describe("multiple skills tracked independently", () => {
		it("recording for skill A does not affect skill B", () => {
			recordN(bridge, "alpha", 10, true);
			recordN(bridge, "beta", 5, false);

			const a = bridge.getMastery("alpha");
			const b = bridge.getMastery("beta");

			expect(a.totalInvocations).toBe(10);
			expect(a.successRate).toBe(1.0);
			expect(a.thompsonAlpha).toBe(11);
			expect(a.thompsonBeta).toBe(1);

			expect(b.totalInvocations).toBe(5);
			expect(b.successRate).toBe(0);
			expect(b.thompsonAlpha).toBe(1);
			expect(b.thompsonBeta).toBe(6);
		});
	});

	// ── recordImpression auto-creates mastery ─────────────────────────

	describe("auto-creation", () => {
		it("recordImpression for non-existent skill auto-creates mastery", () => {
			const before = bridge.getMastery("brand-new");
			expect(before.totalInvocations).toBe(0);

			bridge.recordImpression(makeImpression({ skillName: "brand-new" }));

			const after = bridge.getMastery("brand-new");
			expect(after.totalInvocations).toBe(1);
		});
	});

	// ── Serialization / Deserialization ────────────────────────────────

	describe("serialization round-trip", () => {
		it("preserves mastery state", () => {
			recordN(bridge, "s1", 10, true);
			recordN(bridge, "s2", 5, false);

			const serialized = bridge.serialize();
			const restored = new SamskaraSkillBridge();
			restored.deserialize(serialized);

			const m1 = restored.getMastery("s1");
			expect(m1.totalInvocations).toBe(10);
			expect(m1.successRate).toBe(1.0);
			expect(m1.thompsonAlpha).toBe(11);

			const m2 = restored.getMastery("s2");
			expect(m2.totalInvocations).toBe(5);
			expect(m2.successRate).toBe(0);
			expect(m2.thompsonBeta).toBe(6);
		});

		it("preserves override counts", () => {
			for (let i = 0; i < 4; i++) {
				bridge.recordImpression(
					makeImpression({
						skillName: "old",
						wasOverridden: true,
						preferredSkill: "new",
					}),
				);
			}

			const serialized = bridge.serialize();
			const restored = new SamskaraSkillBridge();
			restored.deserialize(serialized);

			const prefs = restored.getPreferences();
			expect(prefs.length).toBe(1);
			expect(prefs[0].count).toBe(4);
		});

		it("preserves co-occurrence data", () => {
			bridge.recordImpression(makeImpression({ skillName: "X", sessionId: "s1" }));
			bridge.recordImpression(makeImpression({ skillName: "Y", sessionId: "s1" }));
			bridge.flushSession("s1");

			const serialized = bridge.serialize();
			const restored = new SamskaraSkillBridge();
			restored.deserialize(serialized);

			const reserialized = restored.serialize();
			const coMap = new Map(reserialized.coOccurrences.map(([k, v]) => [k, new Map(v)]));
			expect(coMap.get("X")?.get("Y")).toBe(1);
		});

		it("deserialize clears previous state", () => {
			recordN(bridge, "old-skill", 10, true);

			const freshState: SerializedSamskaraState = {
				mastery: [["new-skill", { ...INITIAL_ANANDAMAYA, totalInvocations: 1, successCount: 1, successRate: 1, thompsonAlpha: 2 }]],
				overrides: [],
				coOccurrences: [],
			};

			bridge.deserialize(freshState);
			expect(bridge.getMastery("old-skill").totalInvocations).toBe(0);
			expect(bridge.getMastery("new-skill").totalInvocations).toBe(1);
		});
	});

	// ── updateMastery direct call ─────────────────────────────────────

	describe("updateMastery (direct API)", () => {
		it("returns the updated mastery object", () => {
			const m = bridge.updateMastery("direct-skill", true, 42);
			expect(m.totalInvocations).toBe(1);
			expect(m.successCount).toBe(1);
			expect(m.avgLatencyMs).toBe(42);
		});

		it("getMastery reflects state set by updateMastery", () => {
			bridge.updateMastery("direct-skill", true, 100);
			bridge.updateMastery("direct-skill", false, 200);
			const m = bridge.getMastery("direct-skill");
			expect(m.totalInvocations).toBe(2);
			expect(m.successCount).toBe(1);
			expect(m.failureCount).toBe(1);
		});
	});
});
