/**
 * @chitragupta/smriti -- Dvikala (two times) -- Bi-Temporal Edge Engine.
 *
 * Every edge in the knowledge graph carries TWO timestamps:
 * - validTime:  when the relationship was TRUE in the real world
 * - recordTime: when the relationship was RECORDED in the graph
 *
 * This separation enables:
 * - Time-travel queries ("What did we know about X at time T?")
 * - Correction without data loss ("We learned Y, not Z" -> expire Z, add Y)
 * - Audit trail (recordedAt never changes, supersededAt marks old versions)
 *
 * Named after the Sanskrit concept of Dvikala (two-time),
 * reflecting the dual temporal axes that govern every relationship.
 */

import type { GraphEdge } from "./types.js";

// ---- Helpers ----------------------------------------------------------------

/**
 * Returns the current ISO 8601 timestamp.
 * Extracted for testability -- all functions route through this.
 */
function nowISO(): string {
	return new Date().toISOString();
}

/** Sentinel: the beginning of time (for legacy edges without temporal fields). */
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

// ---- Core Functions ---------------------------------------------------------

/**
 * Create a new bi-temporal edge.
 *
 * Sets `validFrom` to the provided value (or now), `recordedAt` to now,
 * and leaves `validUntil` and `supersededAt` undefined (current edge).
 *
 * @param source       - Source node ID.
 * @param target       - Target node ID.
 * @param relationship - Edge relationship label (e.g. "mentions_concept").
 * @param weight       - Edge weight (0-1).
 * @param validFrom    - When the relationship became true. Defaults to now.
 * @returns A fully-timestamped GraphEdge.
 */
export function createEdge(
	source: string,
	target: string,
	relationship: string,
	weight: number,
	validFrom?: string,
): GraphEdge {
	const now = nowISO();
	return {
		source,
		target,
		relationship,
		weight,
		validFrom: validFrom ?? now,
		recordedAt: now,
	};
}

/**
 * Supersede an existing edge with a corrected version.
 *
 * Returns a tuple `[supersededOld, newCurrent]`:
 * - The old edge is marked with `supersededAt = now` (it becomes a historical record).
 * - The new edge copies source/target from the old one, applies optional overrides,
 *   and gets fresh `validFrom` and `recordedAt` timestamps.
 *
 * Use this for corrections: "Actually, X relates to Y with weight 0.9, not 0.5."
 *
 * @param existingEdge   - The edge to supersede.
 * @param newWeight      - Override weight (defaults to existing).
 * @param newRelationship - Override relationship label (defaults to existing).
 * @returns [supersededOldEdge, newCurrentEdge]
 */
export function supersedEdge(
	existingEdge: GraphEdge,
	newWeight?: number,
	newRelationship?: string,
): [GraphEdge, GraphEdge] {
	const now = nowISO();

	const superseded: GraphEdge = {
		...existingEdge,
		supersededAt: now,
	};

	const replacement: GraphEdge = {
		source: existingEdge.source,
		target: existingEdge.target,
		relationship: newRelationship ?? existingEdge.relationship,
		weight: newWeight ?? existingEdge.weight,
		validFrom: now,
		recordedAt: now,
	};

	return [superseded, replacement];
}

/**
 * Expire an edge -- mark its real-world validity as ended.
 *
 * Sets `validUntil` to the given time (default now). The edge remains in the
 * graph for historical queries but will not appear in "current" time-travel
 * results after its validUntil timestamp.
 *
 * @param edge       - The edge to expire.
 * @param validUntil - When the relationship ended. Defaults to now.
 * @returns A new edge object with validUntil set.
 */
export function expireEdge(edge: GraphEdge, validUntil?: string): GraphEdge {
	return {
		...edge,
		validUntil: validUntil ?? nowISO(),
	};
}

/**
 * Time-travel query: return edges valid at a specific point in time.
 *
 * Filters on both temporal axes:
 * - **Valid time**: `validFrom <= asOfValid` AND (`validUntil` is undefined OR `validUntil > asOfValid`)
 * - **Record time** (optional): `recordedAt <= asOfRecord` AND (`supersededAt` is undefined OR `supersededAt > asOfRecord`)
 *
 * If `asOfRecord` is omitted, only the latest record version is returned
 * (edges where `supersededAt` is undefined).
 *
 * @param edges      - The full edge set to query.
 * @param asOfValid  - The valid-time point to query at (ISO 8601).
 * @param asOfRecord - Optional record-time point. If omitted, returns only current (non-superseded) edges.
 * @returns Edges matching both temporal filters.
 */
export function queryEdgesAtTime(
	edges: readonly GraphEdge[],
	asOfValid: string,
	asOfRecord?: string,
): GraphEdge[] {
	return edges.filter((e) => {
		// Valid-time filter (legacy edges without validFrom are treated as always-valid)
		const vFrom = e.validFrom ?? EPOCH_ISO;
		if (vFrom > asOfValid) return false;
		if (e.validUntil !== undefined && e.validUntil <= asOfValid) return false;

		// Record-time filter (legacy edges without recordedAt are treated as recorded at epoch)
		if (asOfRecord !== undefined) {
			const rAt = e.recordedAt ?? EPOCH_ISO;
			if (rAt > asOfRecord) return false;
			if (e.supersededAt !== undefined && e.supersededAt <= asOfRecord) return false;
		} else {
			// No record time specified -> only return current (non-superseded) versions
			if (e.supersededAt !== undefined) return false;
		}

		return true;
	});
}

/**
 * Retrieve the full history of an edge between two nodes.
 *
 * Returns every version (including superseded ones) sorted by `recordedAt`
 * ascending (oldest first). This gives a complete audit trail of how the
 * relationship evolved over time.
 *
 * @param edges  - The full edge set to search.
 * @param source - Source node ID.
 * @param target - Target node ID.
 * @returns Chronologically ordered edge versions.
 */
export function getEdgeHistory(
	edges: readonly GraphEdge[],
	source: string,
	target: string,
): GraphEdge[] {
	return edges
		.filter((e) => e.source === source && e.target === target)
		.sort((a, b) => (a.recordedAt ?? EPOCH_ISO).localeCompare(b.recordedAt ?? EPOCH_ISO));
}

/**
 * Compute temporal decay for an edge using exponential half-life.
 *
 * Uses `validFrom` as the reference point for active edges, or `validUntil`
 * for expired edges (since the relationship already ended, decay should
 * be measured from when it stopped being true).
 *
 * Formula: `weight * exp(-ln(2) * elapsed / halfLifeMs)`
 *
 * @param edge       - The edge to decay.
 * @param now        - Current time in milliseconds (Date.now()).
 * @param halfLifeMs - Half-life in milliseconds.
 * @returns The decayed weight.
 */
export function temporalDecay(
	edge: GraphEdge,
	now: number,
	halfLifeMs: number,
): number {
	// For expired edges, measure decay from when the relationship ended.
	// For active edges, measure from when it became valid.
	// Legacy edges without validFrom are treated as epoch (maximum decay).
	const referenceTime = edge.validUntil !== undefined
		? new Date(edge.validUntil).getTime()
		: new Date(edge.validFrom ?? EPOCH_ISO).getTime();

	const elapsed = now - referenceTime;
	if (elapsed <= 0) return edge.weight;

	const decay = Math.exp(-Math.LN2 * elapsed / halfLifeMs);
	return edge.weight * decay;
}

/**
 * Compact (garbage-collect) superseded edges older than a retention window.
 *
 * - **Current edges** (no `supersededAt`) are always kept, regardless of age.
 * - **Superseded edges** are removed if `supersededAt` is older than `now - retentionMs`.
 *
 * This prevents unbounded graph growth while preserving recent audit history.
 *
 * @param edges       - The full edge set to compact.
 * @param retentionMs - How long to keep superseded edges (in milliseconds).
 * @returns Cleaned edge array with old superseded edges removed.
 */
export function compactEdges(
	edges: readonly GraphEdge[],
	retentionMs: number,
): GraphEdge[] {
	const cutoff = Date.now() - retentionMs;

	return edges.filter((e) => {
		// Always keep current (non-superseded) edges
		if (e.supersededAt === undefined) return true;

		// Keep superseded edges within the retention window
		return new Date(e.supersededAt).getTime() > cutoff;
	});
}
