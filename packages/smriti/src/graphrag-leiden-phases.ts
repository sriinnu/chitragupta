/**
 * @chitragupta/smriti — Leiden Algorithm Phases (Re-export Shim)
 *
 * This file re-exports all symbols from leiden-algorithm.ts for backward
 * compatibility. New code should import directly from leiden-algorithm.ts.
 *
 * @deprecated Import from "./leiden-algorithm.js" instead.
 * @module graphrag-leiden-phases
 */

export {
	Xorshift32,
	AdjacencyGraph,
	computeModularity,
	localNodeMoving,
	refineCommunities,
	aggregateGraph,
	compactCommunities,
} from "./leiden-algorithm.js";

export type { AggregateResult } from "./leiden-algorithm.js";
