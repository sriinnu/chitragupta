/**
 * @chitragupta/anina/lokapala — लोकपाल — World Guardians.
 *
 * Specialized autonomous agents that continuously monitor quality
 * dimensions: security (Rakshaka), performance (Gati), and
 * correctness (Satya). Orchestrated by the LokapalaController.
 *
 * @packageDocumentation
 */

// ─── Guardians ──────────────────────────────────────────────────────────────
export { Rakshaka } from "./rakshaka.js";
export { Gati } from "./gati.js";
export { Satya } from "./satya.js";

// ─── Controller ─────────────────────────────────────────────────────────────
export { LokapalaController } from "./lokapala-controller.js";

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
	Finding,
	FindingSeverity,
	GuardianConfig,
	GuardianDomain,
	GuardianStats,
	ScanContext,
	PerformanceMetrics,
	TurnObservation,
	LokapalaConfig,
} from "./types.js";

// ─── Utilities ──────────────────────────────────────────────────────────────
export {
	DEFAULT_GUARDIAN_CONFIG,
	HARD_CEILINGS,
	FindingRing,
	resolveConfig,
	fnv1a,
} from "./types.js";
