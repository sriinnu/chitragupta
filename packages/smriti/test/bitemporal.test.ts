import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphEdge } from "@chitragupta/smriti";
import {
	createEdge,
	supersedEdge,
	expireEdge,
	queryEdgesAtTime,
	getEdgeHistory,
	temporalDecay,
	compactEdges,
} from "@chitragupta/smriti";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ISO timestamp at a fixed offset from a base date (2024-01-01T00:00:00.000Z). */
function isoAt(offsetMs: number): string {
	return new Date(Date.UTC(2024, 0, 1) + offsetMs).toISOString();
}

const BASE = Date.UTC(2024, 0, 1); // 2024-01-01T00:00:00.000Z
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("Dvikala — Bi-Temporal Edge Engine", () => {
	// ── createEdge ─────────────────────────────────────────────────────────

	describe("createEdge", () => {
		it("should set validFrom and recordedAt to now when validFrom is omitted", () => {
			const before = new Date().toISOString();
			const edge = createEdge("A", "B", "links_to", 0.8);
			const after = new Date().toISOString();

			expect(edge.source).toBe("A");
			expect(edge.target).toBe("B");
			expect(edge.relationship).toBe("links_to");
			expect(edge.weight).toBe(0.8);
			expect(edge.validFrom! >= before).toBe(true);
			expect(edge.validFrom! <= after).toBe(true);
			expect(edge.recordedAt! >= before).toBe(true);
			expect(edge.recordedAt! <= after).toBe(true);
			expect(edge.validUntil).toBeUndefined();
			expect(edge.supersededAt).toBeUndefined();
		});

		it("should use provided validFrom while recordedAt is still now", () => {
			const past = isoAt(0);
			const before = new Date().toISOString();
			const edge = createEdge("X", "Y", "depends_on", 1.0, past);
			const after = new Date().toISOString();

			expect(edge.validFrom).toBe(past);
			expect(edge.recordedAt! >= before).toBe(true);
			expect(edge.recordedAt! <= after).toBe(true);
		});
	});

	// ── supersedEdge ───────────────────────────────────────────────────────

	describe("supersedEdge", () => {
		it("should return old edge with supersededAt and new edge with fresh timestamps", () => {
			const original = createEdge("A", "B", "uses", 0.5, isoAt(0));
			const [old, replacement] = supersedEdge(original, 0.9);

			// Old edge is marked superseded
			expect(old.source).toBe("A");
			expect(old.target).toBe("B");
			expect(old.relationship).toBe("uses");
			expect(old.weight).toBe(0.5);
			expect(old.validFrom).toBe(original.validFrom);
			expect(old.recordedAt).toBe(original.recordedAt);
			expect(old.supersededAt).toBeDefined();

			// New edge has updated weight and fresh times
			expect(replacement.source).toBe("A");
			expect(replacement.target).toBe("B");
			expect(replacement.relationship).toBe("uses");
			expect(replacement.weight).toBe(0.9);
			expect(replacement.supersededAt).toBeUndefined();
		});

		it("should allow overriding the relationship label", () => {
			const original = createEdge("A", "B", "uses", 0.5, isoAt(0));
			const [, replacement] = supersedEdge(original, undefined, "depends_on");

			expect(replacement.relationship).toBe("depends_on");
			expect(replacement.weight).toBe(0.5); // kept original weight
		});
	});

	// ── expireEdge ─────────────────────────────────────────────────────────

	describe("expireEdge", () => {
		it("should set validUntil to specified time", () => {
			const edge = createEdge("A", "B", "links_to", 0.7, isoAt(0));
			const expireTime = isoAt(DAY);
			const expired = expireEdge(edge, expireTime);

			expect(expired.validUntil).toBe(expireTime);
			// Original fields preserved
			expect(expired.source).toBe("A");
			expect(expired.validFrom).toBe(edge.validFrom);
			expect(expired.recordedAt).toBe(edge.recordedAt);
		});

		it("should default validUntil to now when not specified", () => {
			const edge = createEdge("A", "B", "links_to", 0.7, isoAt(0));
			const before = new Date().toISOString();
			const expired = expireEdge(edge);
			const after = new Date().toISOString();

			expect(expired.validUntil).toBeDefined();
			expect(expired.validUntil! >= before).toBe(true);
			expect(expired.validUntil! <= after).toBe(true);
		});
	});

	// ── queryEdgesAtTime ───────────────────────────────────────────────────

	describe("queryEdgesAtTime", () => {
		let edges: GraphEdge[];

		beforeEach(() => {
			// Edge 1: valid from hour 0, current version
			const e1 = createEdge("A", "B", "v1", 0.5, isoAt(0));
			// Manually set recordedAt so it's deterministic
			(e1 as { recordedAt: string }).recordedAt = isoAt(0);

			// Edge 2: valid from hour 2 to hour 5, current version
			const e2 = createEdge("A", "C", "v1", 0.6, isoAt(2 * HOUR));
			(e2 as { recordedAt: string }).recordedAt = isoAt(2 * HOUR);
			e2.validUntil = isoAt(5 * HOUR);

			// Edge 3: superseded version recorded at hour 1, superseded at hour 3
			const e3 = createEdge("A", "D", "old", 0.3, isoAt(0));
			(e3 as { recordedAt: string }).recordedAt = isoAt(HOUR);
			e3.supersededAt = isoAt(3 * HOUR);

			// Edge 4: replacement for e3, recorded at hour 3
			const e4 = createEdge("A", "D", "new", 0.7, isoAt(0));
			(e4 as { recordedAt: string }).recordedAt = isoAt(3 * HOUR);

			edges = [e1, e2, e3, e4];
		});

		it("should return edges valid at a given time (no record filter)", () => {
			// At hour 1: e1 valid (no end), e2 not started yet, e3 superseded (filtered), e4 valid
			const result = queryEdgesAtTime(edges, isoAt(HOUR));
			expect(result.length).toBe(2);
			expect(result.some((e) => e.source === "A" && e.target === "B")).toBe(true);
			expect(result.some((e) => e.source === "A" && e.target === "D" && e.relationship === "new")).toBe(true);
		});

		it("should filter by validUntil correctly", () => {
			// At hour 3: e2 is still valid (validUntil is hour 5, which is > hour 3)
			const result = queryEdgesAtTime(edges, isoAt(3 * HOUR));
			expect(result.some((e) => e.target === "C")).toBe(true);

			// At hour 6: e2 has expired (validUntil = hour 5 <= hour 6)
			const resultLater = queryEdgesAtTime(edges, isoAt(6 * HOUR));
			expect(resultLater.some((e) => e.target === "C")).toBe(false);
		});

		it("should filter by record time when asOfRecord is provided", () => {
			// At hour 2 record time: e3 is not yet superseded (supersededAt=hour3 > hour2), e4 not yet recorded
			const result = queryEdgesAtTime(edges, isoAt(HOUR), isoAt(2 * HOUR));
			const dEdges = result.filter((e) => e.target === "D");
			expect(dEdges.length).toBe(1);
			expect(dEdges[0].relationship).toBe("old"); // e3 still current at record-time hour 2
		});

		it("should return empty for a future valid time before any edges", () => {
			const result = queryEdgesAtTime(edges, isoAt(-HOUR));
			expect(result.length).toBe(0);
		});
	});

	// ── getEdgeHistory ─────────────────────────────────────────────────────

	describe("getEdgeHistory", () => {
		it("should return all versions sorted by recordedAt ascending", () => {
			const e1 = createEdge("A", "B", "v1", 0.3, isoAt(0));
			(e1 as { recordedAt: string }).recordedAt = isoAt(0);
			e1.supersededAt = isoAt(DAY);

			const e2 = createEdge("A", "B", "v2", 0.7, isoAt(DAY));
			(e2 as { recordedAt: string }).recordedAt = isoAt(DAY);

			const unrelated = createEdge("X", "Y", "other", 1.0, isoAt(0));
			(unrelated as { recordedAt: string }).recordedAt = isoAt(0);

			const history = getEdgeHistory([unrelated, e2, e1], "A", "B");
			expect(history.length).toBe(2);
			expect(history[0].relationship).toBe("v1"); // recorded first
			expect(history[1].relationship).toBe("v2"); // recorded second
		});

		it("should return empty for non-existent source/target", () => {
			const e = createEdge("A", "B", "v1", 0.5, isoAt(0));
			expect(getEdgeHistory([e], "X", "Y")).toEqual([]);
		});
	});

	// ── temporalDecay ──────────────────────────────────────────────────────

	describe("temporalDecay", () => {
		it("should return full weight when elapsed time is zero", () => {
			const edge = createEdge("A", "B", "links", 1.0, isoAt(0));
			const now = new Date(isoAt(0)).getTime();
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(1.0, 5);
		});

		it("should halve weight after exactly one half-life", () => {
			const edge = createEdge("A", "B", "links", 1.0, isoAt(0));
			const now = new Date(isoAt(DAY)).getTime();
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(0.5, 5);
		});

		it("should quarter weight after two half-lives", () => {
			const edge = createEdge("A", "B", "links", 1.0, isoAt(0));
			const now = new Date(isoAt(2 * DAY)).getTime();
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(0.25, 5);
		});

		it("should use validUntil as reference for expired edges", () => {
			const edge = createEdge("A", "B", "links", 1.0, isoAt(0));
			edge.validUntil = isoAt(DAY);

			// 2 days after validUntil => 1 half-life from validUntil at DAY half-life
			// Actually: elapsed = 2*DAY - DAY = DAY, so decay = 0.5
			const now = new Date(isoAt(2 * DAY)).getTime();
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(0.5, 5);
		});

		it("should scale by edge weight", () => {
			const edge = createEdge("A", "B", "links", 0.8, isoAt(0));
			const now = new Date(isoAt(DAY)).getTime();
			// 0.8 * 0.5 = 0.4
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(0.4, 5);
		});

		it("should return full weight when now is before validFrom", () => {
			const edge = createEdge("A", "B", "links", 0.6, isoAt(DAY));
			const now = new Date(isoAt(0)).getTime();
			// elapsed is negative, function returns edge.weight
			expect(temporalDecay(edge, now, DAY)).toBeCloseTo(0.6, 5);
		});
	});

	// ── compactEdges ───────────────────────────────────────────────────────

	describe("compactEdges", () => {
		let realDateNow: typeof Date.now;

		beforeEach(() => {
			realDateNow = Date.now;
		});

		afterEach(() => {
			Date.now = realDateNow;
		});

		it("should always keep current (non-superseded) edges", () => {
			const current = createEdge("A", "B", "v1", 1.0, isoAt(0));
			(current as { recordedAt: string }).recordedAt = isoAt(0);

			// Set "now" to far in the future
			Date.now = () => BASE + 365 * DAY;
			const result = compactEdges([current], DAY);
			expect(result.length).toBe(1);
		});

		it("should remove superseded edges older than retention window", () => {
			const old = createEdge("A", "B", "v1", 0.5, isoAt(0));
			(old as { recordedAt: string }).recordedAt = isoAt(0);
			old.supersededAt = isoAt(HOUR); // superseded very early

			const current = createEdge("A", "B", "v2", 0.9, isoAt(HOUR));
			(current as { recordedAt: string }).recordedAt = isoAt(HOUR);

			// Set "now" to 2 days later
			Date.now = () => BASE + 2 * DAY;
			const result = compactEdges([old, current], DAY);

			// old was superseded at hour 1, which is > DAY ago from "now" (2 days later)
			expect(result.length).toBe(1);
			expect(result[0].relationship).toBe("v2");
		});

		it("should keep superseded edges within the retention window", () => {
			const old = createEdge("A", "B", "v1", 0.5, isoAt(0));
			(old as { recordedAt: string }).recordedAt = isoAt(0);
			old.supersededAt = isoAt(DAY); // superseded 1 day in

			const current = createEdge("A", "B", "v2", 0.9, isoAt(DAY));
			(current as { recordedAt: string }).recordedAt = isoAt(DAY);

			// Set "now" to 1 day + 1 hour (just barely within 2-day retention)
			Date.now = () => BASE + DAY + HOUR;
			const result = compactEdges([old, current], 2 * DAY);

			// old was superseded at day 1, cutoff = (day1 + 1h) - 2days = -23h => all kept
			expect(result.length).toBe(2);
		});
	});
});
