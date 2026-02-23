/**
 * @module types-v2-domains
 * @description Vidya-Tantra domain subsystem types — self-contained interfaces,
 * type aliases, and constants for the seven philosophical pillars.
 *
 * - **Kula** (कुल): Skill provenance tiers
 * - **Ashrama** (आश्रम): Four lifecycle stages with hysteresis
 * - **Pancha Kosha** (पञ्च कोश): Five sheaths from physical to mastery
 * - **Parampara** (परम्परा): Trust through verified lineage
 * - **Yoga** (योग): Skill composition patterns
 * - **Vamsha** (वंश): Evolutionary biology
 * - **Samskara** (संस्कार): Usage impressions
 *
 * @packageDocumentation
 */

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
 * Progression based on invocations x success rate.
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

/** Three composition patterns inspired by Yoga traditions. */
export type YogaType =
	| "karma"   // Sequential pipeline: A -> B -> C (action flows)
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

/** Evolutionary events that skills undergo over their lifecycle. */
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
