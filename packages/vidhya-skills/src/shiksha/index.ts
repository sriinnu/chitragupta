/**
 * Shiksha (शिक्षा — Learning) — Autonomous Skill Learning.
 *
 * When the skill registry has no match for a user's request, Shiksha
 * autonomously analyzes, sources, builds, scans, and executes a new skill.
 *
 * @packageDocumentation
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
	ExecutionStrategy,
	TaskDomain,
	IntentDecomposition,
	CandidateUtility,
	TaskAnalysis,
	SourceTier,
	SourceResult,
	SourceImplementation,
	GeneratedSkill,
	ShikshaConfig,
	ShikshaResult,
	ShikshaEvent,
	ShikshaEventType,
	BashExecutor,
	ShikshaControllerConfig,
} from "./types.js";
export { DEFAULT_SHIKSHA_CONFIG, SHIKSHA_HARD_CEILINGS } from "./types.js";

// ── Vimarsh (विमर्श — Inquiry) — Zero-Cost Task Analyzer ────────────────────
export { analyzeTask } from "./vimarsh.js";

// ── Praptya (प्राप्त्य — Attainable) — 5-Tier Solution Sourcer ──────────────
export { sourceSkill } from "./praptya.js";

// ── Nirmana (निर्माण — Construction) — Skill Builder ────────────────────────
export { buildSkill } from "./nirmana.js";

// ── Controller ───────────────────────────────────────────────────────────────
export { ShikshaController } from "./controller.js";

// ── Megha (मेघ — Cloud) — Cloud-Aware Extension ─────────────────────────────
export {
	detectProviders,
	detectServiceFromQuery,
	detectProviderFromQuery,
	findRecipe,
	findEquivalents,
	buildCloudResult,
	formatCloudDisplay,
	clearDetectionCache,
} from "./megha.js";
export type {
	CloudProvider,
	CloudServiceCategory,
	AuthStatus,
	CLIDetection,
	CloudService,
	CloudRecipe,
	CloudRecipeStep,
	AuthGuidance,
	AlternativeSuggestion,
	CloudContext,
	CloudSourceResult,
} from "./megha-types.js";
