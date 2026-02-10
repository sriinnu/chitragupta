/**
 * @module types-v2
 * @description Vidya-Tantra (विद्या-तन्त्र) — Extended type system for skill lifecycle,
 * trust lineage, composition, and evolutionary biology.
 *
 * Built on five philosophical pillars:
 * - **Pancha Kosha** (पञ्च कोश): Five sheaths from physical to mastery
 * - **Ashrama** (आश्रम): Four lifecycle stages with hysteresis
 * - **Parampara** (परम्परा): Trust through verified lineage
 * - **Yoga** (योग): Skill composition patterns
 * - **Vamsha** (वंश): Evolutionary biology — mutation, speciation, extinction
 *
 * @packageDocumentation
 */

import type { SkillManifest, SkillMatch } from "./types.js";

// ─── Kula (कुल) — Skill Provenance Tier ────────────────────────────────────

/** Provenance tier determines priority weight in matching. */
export type KulaType =
	| "antara"   // Core skills maintained by trusted sources — weight 1.0
	| "bahya"    // Community/3rd party, trust-verified — weight 0.7
	| "shiksha"; // Auto-generated via Shiksha learning — weight 0.4

/** Priority weight per kula tier. */
export const KULA_WEIGHTS: Readonly<Record<KulaType, number>> = {
	antara: 1.0,
	bahya: 0.7,
	shiksha: 0.4,
};

// ─── Ashrama (आश्रम) — Lifecycle Stage ─────────────────────────────────────

/**
 * Four lifecycle stages inspired by the Vedic ashrama system.
 * Skills progress through stages based on health scores and trust.
 */
export type AshramamStage =
	| "brahmacharya"  // Student: new/unverified, excluded from matching
	| "grihastha"     // Householder: fully active, full matching + execution
	| "vanaprastha"   // Retired: deprecated, 0.5x matching penalty + warning
	| "sannyasa";     // Archived: excluded from matching, not executable

/** Numeric order for comparison. Lower = earlier in lifecycle. */
export const ASHRAMA_ORDER: Readonly<Record<AshramamStage, number>> = {
	brahmacharya: 0,
	grihastha: 1,
	vanaprastha: 2,
	sannyasa: 3,
};

/** Matching weight multiplier per ashrama stage. */
export const ASHRAMA_MATCH_WEIGHT: Readonly<Record<AshramamStage, number>> = {
	brahmacharya: 0,
	grihastha: 1.0,
	vanaprastha: 0.5,
	sannyasa: 0,
};

/**
 * Hysteresis thresholds prevent lifecycle flapping.
 * Promotion threshold > demotion threshold creates a dead band.
 */
export interface AshramamHysteresis {
	/** Health score above which skill is promoted (brahmacharya→grihastha). */
	readonly promotionThreshold: number;
	/** Health score below which skill is demoted (grihastha→vanaprastha). */
	readonly demotionThreshold: number;
	/** Days inactive in vanaprastha before auto-archival to sannyasa. */
	readonly archivalDays: number;
	/** Minimum observations before any transition is considered. */
	readonly minObservations: number;
}

export const DEFAULT_HYSTERESIS: Readonly<AshramamHysteresis> = {
	promotionThreshold: 0.6,
	demotionThreshold: 0.3,
	archivalDays: 90,
	minObservations: 5,
};

export const HYSTERESIS_CEILINGS: Readonly<AshramamHysteresis> = {
	promotionThreshold: 0.95,
	demotionThreshold: 0.5,
	archivalDays: 365,
	minObservations: 100,
};

/** A lifecycle transition record. */
export interface AshramamTransition {
	readonly from: AshramamStage;
	readonly to: AshramamStage;
	readonly reason: string;
	readonly healthAtTransition: number;
	readonly timestamp: string; // ISO 8601
}

/** Full ashrama state for a skill. */
export interface AshramamState {
	readonly stage: AshramamStage;
	readonly enteredAt: string;           // ISO 8601 — when current stage was entered
	readonly history: AshramamTransition[];
	readonly lastEvaluatedAt: string;     // ISO 8601 — last health evaluation
	readonly consecutiveDaysInactive: number;
}

// ─── Pancha Kosha (पञ्च कोश) — Five Sheaths ───────────────────────────────

/**
 * Runtime requirements — the "vital breath" a skill needs to function.
 * Binary checks: does the binary exist? Is the env var set? Is the OS right?
 */
export interface PranamayaRequirements {
	/** Required binaries on PATH (e.g., ["docker", "ffmpeg"]). */
	readonly bins: string[];
	/** Required environment variables (e.g., ["OPENAI_API_KEY"]). */
	readonly env: string[];
	/** Supported operating systems. Empty = all. */
	readonly os: NodeJS.Platform[];
	/** Whether this skill needs network access. */
	readonly network: boolean;
	/** Whether this skill needs elevated privilege (sudo). */
	readonly privilege: boolean;
}

export const EMPTY_PRANAMAYA: Readonly<PranamayaRequirements> = {
	bins: [],
	env: [],
	os: [],
	network: false,
	privilege: false,
};

/**
 * Selection wisdom — WHEN and WHY to use (or not use) a skill.
 * This is the contextual intelligence layer that goes beyond description matching.
 */
export interface VijnanamayaWisdom {
	/** Conditions under which this skill should be selected. */
	readonly whenToUse: string[];
	/** Conditions under which this skill should NOT be selected. */
	readonly whenNotToUse: string[];
	/** Skills that pair well with this one (potential Yoga compositions). */
	readonly complements: string[];
	/** Skills this one replaces (triggers vanaprastha for superseded). */
	readonly supersedes: string[];
}

export const EMPTY_VIJNANAMAYA: Readonly<VijnanamayaWisdom> = {
	whenToUse: [],
	whenNotToUse: [],
	complements: [],
	supersedes: [],
};

// ─── Dreyfus Mastery Model ────────────────────────────────────────────────

/**
 * Five-stage skill acquisition model (Dreyfus & Dreyfus, 1980).
 * Progression based on invocations × success rate.
 */
export type DreyfusLevel =
	| "novice"              // < 5 uses OR success < 0.3
	| "advanced-beginner"   // 5-19 uses AND success >= 0.3
	| "competent"           // 20-49 uses AND success >= 0.5
	| "proficient"          // 50-99 uses AND success >= 0.7
	| "expert";             // >= 100 uses AND success >= 0.85

/** Thresholds for Dreyfus level determination. */
export const DREYFUS_THRESHOLDS: ReadonlyArray<{
	readonly level: DreyfusLevel;
	readonly minUses: number;
	readonly minSuccessRate: number;
}> = [
	{ level: "expert", minUses: 100, minSuccessRate: 0.85 },
	{ level: "proficient", minUses: 50, minSuccessRate: 0.7 },
	{ level: "competent", minUses: 20, minSuccessRate: 0.5 },
	{ level: "advanced-beginner", minUses: 5, minSuccessRate: 0.3 },
	{ level: "novice", minUses: 0, minSuccessRate: 0 },
];

/**
 * Anandamaya — the mastery/bliss sheath.
 * Tracks usage metrics and Dreyfus mastery level.
 */
export interface AnandamayaMastery {
	readonly totalInvocations: number;
	readonly successCount: number;
	readonly failureCount: number;
	readonly successRate: number;            // [0, 1]
	readonly avgLatencyMs: number;
	readonly dreyfusLevel: DreyfusLevel;
	readonly lastInvokedAt: string | null;   // ISO 8601
	readonly firstInvokedAt: string | null;  // ISO 8601
	/** Thompson Sampling: Beta(alpha, beta) for explore/exploit. */
	readonly thompsonAlpha: number;          // successes + 1
	readonly thompsonBeta: number;           // failures + 1
}

export const INITIAL_ANANDAMAYA: Readonly<AnandamayaMastery> = {
	totalInvocations: 0,
	successCount: 0,
	failureCount: 0,
	successRate: 0,
	avgLatencyMs: 0,
	dreyfusLevel: "novice",
	lastInvokedAt: null,
	firstInvokedAt: null,
	thompsonAlpha: 1,
	thompsonBeta: 1,
};

// ─── Pancha Kosha Scores ──────────────────────────────────────────────────

/**
 * Completeness scores for each of the five sheaths.
 * Each score is in [0, 1]. Overall completeness = weighted average.
 */
export interface PanchaKoshaScores {
	/** Annamaya (physical): files exist, content hash valid, scan clean. */
	readonly annamaya: number;
	/** Pranamaya (vital): runtime requirements satisfied. */
	readonly pranamaya: number;
	/** Manomaya (mental): description, intent, semantics present. */
	readonly manomaya: number;
	/** Vijnanamaya (wisdom): when/why guidance present. */
	readonly vijnanamaya: number;
	/** Anandamaya (bliss): mastery — has been used successfully. */
	readonly anandamaya: number;
	/** Weighted average of all five. */
	readonly overall: number;
}

/** Weights for each kosha in the overall completeness score. */
export const KOSHA_WEIGHTS: Readonly<Record<keyof Omit<PanchaKoshaScores, "overall">, number>> = {
	annamaya: 0.15,   // Physical existence is baseline
	pranamaya: 0.25,  // Runtime readiness matters most
	manomaya: 0.20,   // Semantic richness for matching
	vijnanamaya: 0.15, // Contextual wisdom helps selection
	anandamaya: 0.25, // Proven mastery gives confidence
};

// ─── Parampara (परम्परा) — Trust Lineage ──────────────────────────────────

/**
 * A single link in the trust chain.
 * Each event (creation, scan, review, update) adds a link.
 * The chain is Merkle-linked: each entry's hash includes the previous hash,
 * making the entire chain tamper-evident.
 */
export interface ParamparaLink {
	/** What happened. */
	readonly action: "created" | "scanned" | "reviewed" | "updated" | "promoted" | "demoted";
	/** Who performed the action (author ID, scanner ID, reviewer handle). */
	readonly actor: string;
	/** ISO 8601 timestamp. */
	readonly timestamp: string;
	/** SHA-256 hash of the skill content at this point. */
	readonly contentHash: string;
	/** Hash of this link = SHA-256(action + actor + timestamp + contentHash + prevHash). */
	readonly linkHash: string;
	/** Hash of the previous link. Empty string for genesis link. */
	readonly prevHash: string;
	/** Optional human-readable note. */
	readonly note?: string;
}

/**
 * Trust score components. Final score is a weighted sum.
 *
 * Formula:
 *   trustScore = 0.3*origin + 0.3*scan + 0.2*review + 0.1*age + 0.1*freshness
 *
 * Core skills (antara kula) always have trustScore = 1.0.
 */
export interface ParamparaTrust {
	/** Trust from origin (who created it). [0, 1] */
	readonly originTrust: number;
	/** Trust from security scan results. [0, 1] */
	readonly scanTrust: number;
	/** Trust from human/peer reviews. [0, 1] */
	readonly reviewTrust: number;
	/** Trust from age (older = more established). [0, 1] */
	readonly ageTrust: number;
	/** Trust from update freshness (recently maintained). [0, 1] */
	readonly freshnessTrust: number;
	/** Computed weighted trust score. [0, 1] */
	readonly score: number;
}

export const TRUST_WEIGHTS = {
	origin: 0.3,
	scan: 0.3,
	review: 0.2,
	age: 0.1,
	freshness: 0.1,
} as const;

/** Full trust chain for a skill. */
export interface ParamparaChain {
	readonly skillName: string;
	readonly links: ParamparaLink[];
	readonly trust: ParamparaTrust;
	/** Whether the Merkle chain is intact (no tampered links). */
	readonly chainIntact: boolean;
}

// ─── Yoga (योग) — Skill Composition ───────────────────────────────────────

/**
 * Three composition patterns inspired by Yoga traditions.
 */
export type YogaType =
	| "karma"   // Sequential pipeline: A → B → C (action flows)
	| "shakti"  // Parallel execution: A + B (power amplification)
	| "tantra"; // Conditional branching: if X then A else B (weaving)

/**
 * A skill composition definition.
 * Can be auto-discovered from co-occurrence patterns or manually defined.
 */
export interface YogaComposition {
	/** Unique identifier for this composition. */
	readonly id: string;
	/** Human-readable name (e.g., "morning-briefing"). */
	readonly name: string;
	/** Composition pattern type. */
	readonly type: YogaType;
	/** Ordered list of skill names involved. */
	readonly skills: string[];
	/** For tantra: the condition expression that determines branching. */
	readonly condition?: string;
	/** Co-occurrence rate that triggered auto-discovery. [0, 1] */
	readonly coOccurrenceRate: number;
	/** Mutual information between the skills. Higher = stronger relationship. */
	readonly mutualInformation: number;
	/** How this composition was discovered. */
	readonly origin: "auto-discovered" | "manual" | "samskaara-pattern";
	/** ISO 8601 timestamp of discovery/creation. */
	readonly discoveredAt: string;
	/** Number of times this composition has been executed. */
	readonly executionCount: number;
	/** Success rate of composed execution. [0, 1] */
	readonly successRate: number;
}

// ─── Vamsha (वंश) — Evolutionary Biology ──────────────────────────────────

/**
 * Evolutionary events that skills undergo over their lifecycle.
 */
export type VamshaEventType =
	| "mutation"     // Version update — trait vector delta tracked
	| "speciation"   // Fork for different OS/environment
	| "symbiosis"    // Two skills merged (detected from sustained co-occurrence)
	| "extinction"   // Health dropped to 0, archived permanently
	| "adaptation";  // Trait vector evolved via online SGD from query feedback

/** Record of an evolutionary event. */
export interface VamshaEvent {
	readonly type: VamshaEventType;
	readonly skillName: string;
	/** For speciation: the forked variant name. */
	readonly variantName?: string;
	/** For symbiosis: the merged partner. */
	readonly partnerName?: string;
	/** For mutation: semver of new version. */
	readonly newVersion?: string;
	/** For adaptation: magnitude of trait vector change. */
	readonly vectorDelta?: number;
	readonly timestamp: string;
	readonly reason: string;
}

/**
 * Evolutionary lineage of a skill — its full history of
 * mutations, speciations, and adaptations.
 */
export interface VamshaLineage {
	readonly skillName: string;
	/** Original ancestor skill name (for speciated variants). */
	readonly ancestor: string | null;
	/** Known variant names (for skills that speciated). */
	readonly variants: string[];
	/** Symbiotic partners (skills frequently composed with). */
	readonly symbionts: string[];
	readonly events: VamshaEvent[];
}

// ─── Samskara (संस्कार) — Usage Impressions ──────────────────────────────

/**
 * A single usage impression left by a skill invocation.
 * Bridges SkillEvolution, Samskaara Consolidation, and Chetana Self-Model.
 */
export interface SamskaraImpression {
	readonly skillName: string;
	readonly sessionId: string;
	readonly timestamp: string;
	readonly success: boolean;
	readonly latencyMs: number;
	/** The query that triggered this skill selection. */
	readonly triggerQuery: string;
	/** Match score at the time of selection. */
	readonly matchScore: number;
	/** Chetana affect state at time of use. */
	readonly affectValence?: number;
	readonly affectFrustration?: number;
	/** Whether the user corrected or overrode this selection. */
	readonly wasOverridden: boolean;
	/** If overridden, which skill the user preferred. */
	readonly preferredSkill?: string;
}

// ─── Enhanced Skill Manifest ──────────────────────────────────────────────

/**
 * Extended manifest fields layered onto the existing SkillManifest.
 * All fields are optional to maintain backward compatibility.
 * A skill.md with none of these fields is still a valid SkillManifest.
 */
export interface VidyaTantraExtension {
	/** Provenance tier: core, community, or auto-generated. */
	readonly kula?: KulaType;
	/** Runtime requirements (Pranamaya sheath). */
	readonly requirements?: PranamayaRequirements;
	/** Selection wisdom (Vijnanamaya sheath). */
	readonly whenToUse?: string[];
	readonly whenNotToUse?: string[];
	readonly complements?: string[];
	readonly supersedes?: string[];
}

/**
 * A SkillManifest with Vidya-Tantra extensions.
 * Backward-compatible: existing manifests work without modification.
 */
export type EnhancedSkillManifest = SkillManifest & VidyaTantraExtension;

// ─── Skill State (Full Runtime State) ─────────────────────────────────────

/**
 * Complete runtime state for a skill, aggregating all subsystems.
 * This is the full picture: manifest + lifecycle + trust + mastery + lineage.
 */
export interface SkillState {
	/** The skill manifest (potentially enhanced). */
	readonly manifest: EnhancedSkillManifest;
	/** Lifecycle stage and transition history. */
	readonly ashrama: AshramamState;
	/** Five-sheath completeness scores. */
	readonly kosha: PanchaKoshaScores;
	/** Trust chain and computed trust score. */
	readonly parampara: ParamparaChain;
	/** Usage mastery metrics and Thompson Sampling params. */
	readonly mastery: AnandamayaMastery;
	/** Evolutionary lineage. */
	readonly vamsha: VamshaLineage;
}

// ─── Enhanced Match Result ────────────────────────────────────────────────

/**
 * Extended match result with Vidya-Tantra scoring components.
 * Superset of the existing SkillMatch breakdown.
 */
export interface VidyaTantraMatch extends SkillMatch {
	breakdown: SkillMatch["breakdown"] & {
		/** Kula priority weight applied. */
		kulaPriority: number;
		/** Trust score multiplier. */
		trustMultiplier: number;
		/** Ashrama matching weight (0 for excluded stages). */
		ashramamWeight: number;
		/** Thompson Sampling exploration bonus. */
		thompsonSample: number;
		/** Chetana re-ranking adjustment. */
		chetanaBoost: number;
		/** Pranamaya: whether all requirements are met. */
		requirementsMet: boolean;
	};
	/** Which matching phase determined the final score. */
	readonly resolvedInPhase: 1 | 2 | 3;
}

// ─── Configuration ────────────────────────────────────────────────────────

/** Vidya-Tantra configuration with two-tier limits. */
export interface VidyaTantraConfig {
	/** Lifecycle hysteresis thresholds. */
	readonly hysteresis: AshramamHysteresis;
	/** Minimum trust score to allow execution (below = warn). */
	readonly minTrustForExecution: number;
	/** Minimum trust score to skip human review. */
	readonly minTrustForAutoApproval: number;
	/** Whether to auto-transition lifecycle stages. */
	readonly autoLifecycle: boolean;
	/** Maximum compositions to track. */
	readonly maxCompositions: number;
	/** Co-occurrence threshold for auto-composition discovery. */
	readonly coOccurrenceThreshold: number;
	/** Mutual information threshold for skill relationship detection. */
	readonly mutualInfoThreshold: number;
	/** Maximum evolutionary events to retain per skill. */
	readonly maxVamshaEvents: number;
	/** Maximum impressions to retain per skill. */
	readonly maxImpressions: number;
	/** Whether Phase 3 (model disambiguation) prefers local LLM. */
	readonly preferLocalLLM: boolean;
	/** Maximum API cost (USD) for Phase 3 disambiguation per session. */
	readonly maxDisambiguationCostPerSession: number;
}

export const DEFAULT_VIDYA_TANTRA_CONFIG: Readonly<VidyaTantraConfig> = {
	hysteresis: DEFAULT_HYSTERESIS,
	minTrustForExecution: 0.3,
	minTrustForAutoApproval: 0.8,
	autoLifecycle: true,
	maxCompositions: 50,
	coOccurrenceThreshold: 0.6,
	mutualInfoThreshold: 0.3,
	maxVamshaEvents: 200,
	maxImpressions: 500,
	preferLocalLLM: true,
	maxDisambiguationCostPerSession: 0.10,
};

export const VIDYA_TANTRA_CEILINGS: Readonly<VidyaTantraConfig> = {
	hysteresis: HYSTERESIS_CEILINGS,
	minTrustForExecution: 0,
	minTrustForAutoApproval: 1.0,
	autoLifecycle: true,
	maxCompositions: 500,
	coOccurrenceThreshold: 1.0,
	mutualInfoThreshold: 1.0,
	maxVamshaEvents: 1000,
	maxImpressions: 5000,
	preferLocalLLM: true,
	maxDisambiguationCostPerSession: 5.0,
};

// ─── Serializable State ───────────────────────────────────────────────────

/** Serializable form of the entire Vidya-Tantra state for persistence. */
export interface VidyaTantraState {
	readonly skills: Array<[string, SkillState]>;
	readonly compositions: YogaComposition[];
	readonly config: VidyaTantraConfig;
	readonly lastPersistedAt: string;
}
