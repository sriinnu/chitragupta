/**
 * @chitragupta/anina — Chetana Internal Helpers Tests.
 *
 * Direct unit tests for the extracted pure functions in
 * atma-darshana-internals.ts and sankalpa-internals.ts.
 */

import { describe, it, expect } from "vitest";

// ── AtmaDarshana internals ──────────────────────────────────────────────────
import {
	WILSON_Z, TREND_LOOKBACK, TREND_THRESHOLD, FAILURE_STREAK_LIMIT,
	clamp, wilsonInterval, updateTrend, recordCalibration,
	updateFailureStreak, updateRecoveryTracking, recomputeLearningVelocity,
	recomputeStyleFingerprint, addLimitation, getTopTool,
} from "../src/chetana/atma-darshana-internals.js";
import type { ToolMastery } from "../src/chetana/types.js";
import { DEFAULT_CHETANA_CONFIG } from "../src/chetana/types.js";

// ── Sankalpa internals ──────────────────────────────────────────────────────
import {
	FNV_OFFSET, FNV_PRIME, DEDUP_THRESHOLD,
	ESCALATION_HIGH, ESCALATION_CRITICAL,
	KEYWORD_MATCH_THRESHOLD, PROGRESS_INCREMENT,
	fnv1a, extractKeywords, wordOverlap, extractUntilBoundary,
	matchPatterns, findSimilar, escalatePriority, enforceCapacity, maxEvidence,
} from "../src/chetana/sankalpa-internals.js";
import type { Intention } from "../src/chetana/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal ToolMastery entry. */
function makeMastery(overrides?: Partial<ToolMastery>): ToolMastery {
	return {
		successRate: 0.5, avgLatency: 50, confidenceInterval: [0, 1],
		lastImproved: 0, trend: "stable", totalInvocations: 1, successes: 0,
		...overrides,
	};
}

/** Create a minimal Intention for testing. */
function makeIntention(overrides?: Partial<Intention>): Intention {
	return {
		id: "test-id", goal: "implement auth", priority: "normal", status: "active",
		progress: 0, createdAt: Date.now(), lastAdvancedAt: Date.now(),
		evidence: [], subgoals: [], staleTurns: 0, mentionCount: 1,
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// AtmaDarshana Internals
// ═══════════════════════════════════════════════════════════════════════════════

describe("atma-darshana-internals — clamp", () => {
	it("should return value when within range", () => {
		expect(clamp(0.5, 0, 1)).toBe(0.5);
	});

	it("should clamp to min when below", () => {
		expect(clamp(-5, 0, 1)).toBe(0);
	});

	it("should clamp to max when above", () => {
		expect(clamp(10, 0, 1)).toBe(1);
	});
});

describe("atma-darshana-internals — wilsonInterval", () => {
	it("should return [0, 1] for n=0", () => {
		const [lo, hi] = wilsonInterval(0, 0);
		expect(lo).toBe(0);
		expect(hi).toBe(1);
	});

	it("should produce tight CI for many successes", () => {
		const [lo, hi] = wilsonInterval(100, 1.0);
		expect(lo).toBeGreaterThan(0.9);
		expect(hi).toBeCloseTo(1, 1);
	});

	it("should bracket the observed rate for mixed results", () => {
		const p = 0.7;
		const [lo, hi] = wilsonInterval(50, p);
		expect(lo).toBeLessThan(p);
		expect(hi).toBeGreaterThan(p);
		expect(lo).toBeGreaterThan(0);
		expect(hi).toBeLessThanOrEqual(1);
	});
});

describe("atma-darshana-internals — updateTrend", () => {
	it("should detect improving trend after sustained improvement", () => {
		const mastery = makeMastery({ successRate: 0.9 });
		const history = new Map<string, number[]>();
		// Seed history with low rates then high rate
		const pastRates = Array.from({ length: TREND_LOOKBACK + 1 }, (_, i) =>
			i < TREND_LOOKBACK ? 0.3 : 0.9,
		);
		history.set("grep", pastRates.slice(0, -1));
		mastery.successRate = 0.9;
		updateTrend("grep", mastery, history);
		expect(mastery.trend).toBe("improving");
	});

	it("should detect declining trend after sustained decline", () => {
		const mastery = makeMastery({ successRate: 0.2 });
		const history = new Map<string, number[]>();
		const pastRates = Array.from({ length: TREND_LOOKBACK + 1 }, (_, i) =>
			i < TREND_LOOKBACK ? 0.9 : 0.2,
		);
		history.set("bash", pastRates.slice(0, -1));
		mastery.successRate = 0.2;
		updateTrend("bash", mastery, history);
		expect(mastery.trend).toBe("declining");
	});

	it("should remain stable with insufficient history", () => {
		const mastery = makeMastery({ successRate: 0.5 });
		const history = new Map<string, number[]>();
		updateTrend("grep", mastery, history);
		expect(mastery.trend).toBe("stable");
	});
});

describe("atma-darshana-internals — recordCalibration", () => {
	it("should return ~1.0 for well-calibrated predictions", () => {
		const history: Array<{ predicted: number; actual: boolean }> = [];
		let calibration = 1;
		// Predict 1.0 when all outcomes are true → avgPredicted/avgActual = 1.0
		for (let i = 0; i < 10; i++) {
			calibration = recordCalibration(1.0, true, history, DEFAULT_CHETANA_CONFIG);
		}
		expect(calibration).toBeCloseTo(1.0, 1);
	});

	it("should return >1 for overconfident predictions", () => {
		const history: Array<{ predicted: number; actual: boolean }> = [];
		let calibration = 1;
		for (let i = 0; i < 20; i++) {
			calibration = recordCalibration(0.9, i % 2 === 0, history, DEFAULT_CHETANA_CONFIG);
		}
		expect(calibration).toBeGreaterThan(1.2);
	});

	it("should evict oldest entries beyond calibration window", () => {
		const smallConfig = { ...DEFAULT_CHETANA_CONFIG, calibrationWindow: 5 };
		const history: Array<{ predicted: number; actual: boolean }> = [];
		for (let i = 0; i < 10; i++) {
			recordCalibration(0.5, true, history, smallConfig);
		}
		expect(history.length).toBeLessThanOrEqual(5);
	});
});

describe("atma-darshana-internals — updateFailureStreak", () => {
	it("should reset streak on success", () => {
		const failures = new Map<string, number>();
		failures.set("bash", 2);
		const result = updateFailureStreak("bash", true, failures);
		expect(result).toBeNull();
		expect(failures.get("bash")).toBe(0);
	});

	it("should trigger limitation at FAILURE_STREAK_LIMIT", () => {
		const failures = new Map<string, number>();
		let result: string | null = null;
		for (let i = 0; i < FAILURE_STREAK_LIMIT; i++) {
			result = updateFailureStreak("bash", false, failures);
		}
		expect(result).not.toBeNull();
		expect(result).toContain("bash");
		expect(result).toContain("consecutive failures");
	});

	it("should accumulate without triggering below limit", () => {
		const failures = new Map<string, number>();
		const result = updateFailureStreak("grep", false, failures);
		expect(result).toBeNull();
		expect(failures.get("grep")).toBe(1);
	});
});

describe("atma-darshana-internals — updateRecoveryTracking", () => {
	it("should record recovery distance after error→success", () => {
		const tracking = new Map<string, { errorTurn: number; recoveryTurns: number[] }>();
		updateRecoveryTracking("bash", false, 5, tracking);
		updateRecoveryTracking("bash", true, 8, tracking);
		expect(tracking.get("bash")!.recoveryTurns).toEqual([3]);
	});

	it("should not record recovery when no prior error", () => {
		const tracking = new Map<string, { errorTurn: number; recoveryTurns: number[] }>();
		updateRecoveryTracking("grep", true, 1, tracking);
		expect(tracking.get("grep")!.recoveryTurns).toHaveLength(0);
	});
});

describe("atma-darshana-internals — recomputeLearningVelocity", () => {
	it("should return positive velocity when improving", () => {
		const mastery = new Map<string, ToolMastery>();
		mastery.set("grep", makeMastery({ successRate: 0.9 }));
		const history = new Map<string, number[]>();
		// Past rate was 0.3, now 0.9
		const rates = [...Array.from({ length: TREND_LOOKBACK + 1 }, (_, i) => i < TREND_LOOKBACK ? 0.3 : 0.9)];
		history.set("grep", rates);
		const velocity = recomputeLearningVelocity(mastery, history);
		expect(velocity).toBeGreaterThan(0);
	});

	it("should return 0 with no history data", () => {
		const mastery = new Map<string, ToolMastery>();
		mastery.set("grep", makeMastery());
		const history = new Map<string, number[]>();
		expect(recomputeLearningVelocity(mastery, history)).toBe(0);
	});
});

describe("atma-darshana-internals — recomputeStyleFingerprint", () => {
	it("should populate exploration, density, and recovery dimensions", () => {
		const fp = new Map<string, number>();
		const recovery = new Map<string, { errorTurn: number; recoveryTurns: number[] }>();
		recovery.set("grep", { errorTurn: -1, recoveryTurns: [2, 3] });
		recomputeStyleFingerprint(fp, 10, new Set(["grep", "read", "bash"]), 5, recovery);
		expect(fp.has("exploration_vs_exploitation")).toBe(true);
		expect(fp.has("tool_density")).toBe(true);
		expect(fp.has("error_recovery_speed")).toBe(true);
		expect(fp.get("exploration_vs_exploitation")).toBeCloseTo(0.3, 5);
	});
});

describe("atma-darshana-internals — addLimitation", () => {
	it("should add a new limitation", () => {
		const limitations: string[] = [];
		addLimitation("Tool bash disabled", limitations, DEFAULT_CHETANA_CONFIG);
		expect(limitations).toHaveLength(1);
		expect(limitations[0]).toBe("Tool bash disabled");
	});

	it("should deduplicate identical limitations", () => {
		const limitations: string[] = ["Tool bash disabled"];
		addLimitation("Tool bash disabled", limitations, DEFAULT_CHETANA_CONFIG);
		expect(limitations).toHaveLength(1);
	});

	it("should cap at maxLimitations", () => {
		const config = { ...DEFAULT_CHETANA_CONFIG, maxLimitations: 3 };
		const limitations: string[] = [];
		for (let i = 0; i < 5; i++) addLimitation(`limit-${i}`, limitations, config);
		expect(limitations.length).toBeLessThanOrEqual(3);
	});
});

describe("atma-darshana-internals — getTopTool", () => {
	it("should return null for empty mastery map", () => {
		expect(getTopTool(new Map())).toBeNull();
	});

	it("should return the tool with highest success rate", () => {
		const mastery = new Map<string, ToolMastery>();
		mastery.set("grep", makeMastery({ successRate: 0.7 }));
		mastery.set("bash", makeMastery({ successRate: 0.9 }));
		mastery.set("read", makeMastery({ successRate: 0.5 }));
		expect(getTopTool(mastery)).toBe("bash");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sankalpa Internals
// ═══════════════════════════════════════════════════════════════════════════════

describe("sankalpa-internals — fnv1a", () => {
	it("should be deterministic", () => {
		expect(fnv1a("hello")).toBe(fnv1a("hello"));
	});

	it("should produce different hashes for different inputs", () => {
		expect(fnv1a("hello")).not.toBe(fnv1a("world"));
	});

	it("should return a hex string", () => {
		expect(fnv1a("test")).toMatch(/^[0-9a-f]+$/);
	});
});

describe("sankalpa-internals — extractKeywords", () => {
	it("should extract meaningful words from a goal", () => {
		const keywords = extractKeywords("implement authentication system");
		expect(keywords.has("implement")).toBe(true);
		expect(keywords.has("authentication")).toBe(true);
		expect(keywords.has("system")).toBe(true);
	});

	it("should filter stop words", () => {
		const keywords = extractKeywords("the is and from with");
		expect(keywords.size).toBe(0);
	});

	it("should filter words shorter than 3 characters", () => {
		const keywords = extractKeywords("go do it me");
		expect(keywords.size).toBe(0);
	});
});

describe("sankalpa-internals — wordOverlap", () => {
	it("should return 1.0 for identical strings", () => {
		expect(wordOverlap("implement auth", "implement auth")).toBe(1);
	});

	it("should return 0 for completely disjoint strings", () => {
		expect(wordOverlap("implement authentication", "fix database layer")).toBe(0);
	});

	it("should return partial overlap", () => {
		const overlap = wordOverlap("implement authentication system", "implement auth module");
		expect(overlap).toBeGreaterThan(0);
		expect(overlap).toBeLessThan(1);
	});

	it("should return 0 when either string has no keywords", () => {
		expect(wordOverlap("the is", "hello world")).toBe(0);
	});
});

describe("sankalpa-internals — extractUntilBoundary", () => {
	it("should stop at period", () => {
		expect(extractUntilBoundary("hello world. next sentence", 0)).toBe("hello world");
	});

	it("should return to end when no boundary", () => {
		expect(extractUntilBoundary("hello world", 0)).toBe("hello world");
	});

	it("should start from the given offset", () => {
		expect(extractUntilBoundary("skip this. capture this", 11)).toBe("capture this");
	});
});

describe("sankalpa-internals — matchPatterns", () => {
	it("should extract goal from 'implement' pattern", () => {
		const goals = matchPatterns("implement OAuth2 support");
		expect(goals.length).toBeGreaterThanOrEqual(1);
		expect(goals[0]).toContain("OAuth2");
	});

	it("should return empty for non-intent messages", () => {
		expect(matchPatterns("hello how are you")).toHaveLength(0);
	});

	it("should find multiple patterns in one message", () => {
		const goals = matchPatterns("implement auth. fix the login bug");
		expect(goals.length).toBeGreaterThanOrEqual(2);
	});
});

describe("sankalpa-internals — findSimilar", () => {
	it("should find a similar active intention", () => {
		const intentions = new Map<string, Intention>();
		intentions.set("a", makeIntention({ id: "a", goal: "implement authentication system" }));
		const found = findSimilar("implement authentication module", intentions);
		expect(found).not.toBeNull();
		expect(found!.id).toBe("a");
	});

	it("should return null when no similar intention exists", () => {
		const intentions = new Map<string, Intention>();
		intentions.set("a", makeIntention({ id: "a", goal: "implement authentication system" }));
		expect(findSimilar("fix database layer", intentions)).toBeNull();
	});

	it("should skip abandoned intentions", () => {
		const intentions = new Map<string, Intention>();
		intentions.set("a", makeIntention({ id: "a", goal: "implement auth", status: "abandoned" }));
		expect(findSimilar("implement auth", intentions)).toBeNull();
	});
});

describe("sankalpa-internals — escalatePriority", () => {
	it("should escalate normal→high at ESCALATION_HIGH mentions", () => {
		const intention = makeIntention({ mentionCount: ESCALATION_HIGH, priority: "normal" });
		const prev = escalatePriority(intention);
		expect(intention.priority).toBe("high");
		expect(prev).toBe("normal");
	});

	it("should escalate high→critical at ESCALATION_CRITICAL mentions", () => {
		const intention = makeIntention({ mentionCount: ESCALATION_CRITICAL, priority: "high" });
		const prev = escalatePriority(intention);
		expect(intention.priority).toBe("critical");
		expect(prev).toBe("high");
	});

	it("should reactivate paused intention on escalation", () => {
		const intention = makeIntention({
			mentionCount: ESCALATION_HIGH, priority: "normal", status: "paused", staleTurns: 5,
		});
		escalatePriority(intention);
		expect(intention.status).toBe("active");
		expect(intention.staleTurns).toBe(0);
	});

	it("should return null when priority unchanged", () => {
		const intention = makeIntention({ mentionCount: 1, priority: "normal" });
		expect(escalatePriority(intention)).toBeNull();
	});
});

describe("sankalpa-internals — enforceCapacity", () => {
	it("should not evict when under limit", () => {
		const intentions = new Map<string, Intention>();
		intentions.set("a", makeIntention({ id: "a" }));
		enforceCapacity(intentions, DEFAULT_CHETANA_CONFIG);
		expect(intentions.size).toBe(1);
	});

	it("should evict lowest-value intention when at capacity", () => {
		const config = { ...DEFAULT_CHETANA_CONFIG, maxIntentions: 2 };
		const intentions = new Map<string, Intention>();
		intentions.set("a", makeIntention({ id: "a", status: "abandoned", priority: "low" }));
		intentions.set("b", makeIntention({ id: "b", status: "active", priority: "high" }));
		enforceCapacity(intentions, config);
		expect(intentions.size).toBe(1);
		expect(intentions.has("b")).toBe(true);
	});
});

describe("sankalpa-internals — maxEvidence", () => {
	it("should return config value when below system ceiling", () => {
		expect(maxEvidence(DEFAULT_CHETANA_CONFIG)).toBe(DEFAULT_CHETANA_CONFIG.maxEvidencePerIntention);
	});

	it("should clamp to system ceiling", () => {
		const config = { ...DEFAULT_CHETANA_CONFIG, maxEvidencePerIntention: 9999 };
		expect(maxEvidence(config)).toBeLessThanOrEqual(100);
	});
});

describe("sankalpa-internals — constants", () => {
	it("should export expected constant values", () => {
		expect(FNV_OFFSET).toBe(0x811c9dc5);
		expect(FNV_PRIME).toBe(0x01000193);
		expect(DEDUP_THRESHOLD).toBe(0.5);
		expect(ESCALATION_HIGH).toBe(3);
		expect(ESCALATION_CRITICAL).toBe(5);
		expect(KEYWORD_MATCH_THRESHOLD).toBe(2);
		expect(PROGRESS_INCREMENT).toBe(0.1);
	});
});
