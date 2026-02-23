/**
 * @module types-v2
 * @description Vidya-Tantra (विद्या-तन्त्र) — Extended type system for skill lifecycle,
 * trust lineage, composition, and evolutionary biology.
 *
 * Domain subsystem types (Kula, Ashrama, Pancha Kosha, Parampara, Yoga, Vamsha,
 * Samskara) live in `types-v2-domains.ts` and are re-exported here for
 * backward compatibility. This file contains manifest, config, security,
 * eval, and serializable state types.
 *
 * @packageDocumentation
 */

import type { SkillManifest, SkillMatch } from "./types.js";

// Re-export all domain subsystem types for backward compatibility.
// Consumers importing from "./types-v2.js" continue to work unchanged.
export {
	type KulaType,
	KULA_WEIGHTS,
	type AshramamStage,
	ASHRAMA_ORDER,
	ASHRAMA_MATCH_WEIGHT,
	type AshramamHysteresis,
	DEFAULT_HYSTERESIS,
	HYSTERESIS_CEILINGS,
	type AshramamTransition,
	type AshramamState,
	type PranamayaRequirements,
	EMPTY_PRANAMAYA,
	type VijnanamayaWisdom,
	EMPTY_VIJNANAMAYA,
	type DreyfusLevel,
	DREYFUS_THRESHOLDS,
	type AnandamayaMastery,
	INITIAL_ANANDAMAYA,
	type PanchaKoshaScores,
	KOSHA_WEIGHTS,
	type ParamparaLink,
	type ParamparaTrust,
	TRUST_WEIGHTS,
	type ParamparaChain,
	type YogaType,
	type YogaComposition,
	type VamshaEventType,
	type VamshaEvent,
	type VamshaLineage,
	type SamskaraImpression,
} from "./types-v2-domains.js";

// Internal imports for types used below
import type {
	KulaType,
	AshramamHysteresis,
	AshramamState,
	PanchaKoshaScores,
	ParamparaChain,
	AnandamayaMastery,
	VamshaLineage,
	YogaComposition,
	PranamayaRequirements,
} from "./types-v2-domains.js";
import { DEFAULT_HYSTERESIS, HYSTERESIS_CEILINGS } from "./types-v2-domains.js";

// ─── Enhanced Skill Manifest ──────────────────────────────────────────────

// NOTE: VidyaTantraExtension is defined below (after Mudra, Granular Permissions,
// Approach Ladder, and Eval Cases sections) to include all extension fields.

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

// ─── Mudra (मुद्रा) — Integrity & Signing ──────────────────────────────────

/**
 * Per-file integrity manifest for a skill directory.
 * SHA-256 hash per file + Merkle-style root hash.
 * Written as INTEGRITY.json in the skill directory.
 */
export interface SkillIntegrity {
	/** Map of relative file path → SHA-256 hex hash. */
	readonly files: Record<string, string>;
	/** Root hash: SHA-256 of sorted (path + hash) pairs concatenated. */
	readonly rootHash: string;
	/** Hash algorithm used. Always "sha256". */
	readonly algorithm: "sha256";
	/** ISO 8601 timestamp of when integrity was computed. */
	readonly timestamp: string;
}

/**
 * Cryptographic signature for a skill's root hash.
 * Uses Ed25519 for compact, fast verification.
 * Written as SIGNATURE.json in the skill directory.
 */
export interface SkillSignature {
	/** The root hash that was signed (from SkillIntegrity). */
	readonly rootHash: string;
	/** Base64-encoded Ed25519 signature. */
	readonly signature: string;
	/** Base64-encoded public key (for verification without external PKI). */
	readonly publicKey: string;
	/** Signing algorithm. Always "ed25519". */
	readonly algorithm: "ed25519";
	/** ISO 8601 timestamp of signing. */
	readonly timestamp: string;
}

/** Result of verifying a skill's integrity. */
export interface IntegrityVerification {
	/** Whether all file hashes match. */
	readonly valid: boolean;
	/** Files that have been modified since integrity was computed. */
	readonly modified: string[];
	/** Files present in integrity manifest but missing from disk. */
	readonly missing: string[];
	/** Files on disk not present in integrity manifest (new files). */
	readonly added: string[];
}

// ─── Granular Permissions (from Skill Factory Pro) ─────────────────────────

/**
 * Fine-grained network permissions.
 * Extends the boolean `network` flag in PranamayaRequirements
 * with allowlisting, rate limiting, and timeout enforcement.
 */
export interface GranularNetworkPermissions {
	/** Allowed domains/URLs. Empty = no network access. */
	readonly allowlist: string[];
	/** Explicitly denied domains (overrides allowlist wildcards). */
	readonly denylist?: string[];
	/** Per-request timeout in milliseconds. Default: 10000. */
	readonly timeoutMs?: number;
	/** Rate limiting. */
	readonly rateLimit?: {
		/** Maximum requests per minute. */
		readonly maxPerMinute: number;
	};
}

/**
 * User data access scopes.
 * Each scope declares the minimum access level needed.
 */
export interface GranularUserDataPermissions {
	/** Location access: none, coarse (city-level), or precise (lat/lon). */
	readonly location?: "none" | "coarse" | "precise";
	/** Memory access: none, read-only, or read-write. */
	readonly memory?: "none" | "read" | "write";
	/** Calendar access. */
	readonly calendar?: boolean;
	/** Email access. */
	readonly email?: boolean;
}

/**
 * Filesystem access scoping.
 * Limits where a skill can read/write.
 */
export interface GranularFilesystemPermissions {
	/** Access scope. "none" = no filesystem access. */
	readonly scope: "none" | "skill_dir" | "staging_dir";
	/** Maximum write size in megabytes. */
	readonly maxWriteMb?: number;
}

/**
 * Full granular permissions — superset of PranamayaRequirements.
 * Adds network allowlisting, user data scopes, filesystem limits,
 * and named secret injection.
 */
export interface GranularPermissions extends PranamayaRequirements {
	/** Fine-grained network permissions (extends the boolean `network` flag). */
	readonly networkPolicy?: GranularNetworkPermissions;
	/** Secrets injected by name only (never hardcoded). */
	readonly secrets?: string[];
	/** User data access scopes. */
	readonly userData?: GranularUserDataPermissions;
	/** Filesystem access scoping. */
	readonly filesystem?: GranularFilesystemPermissions;
	/** PII handling policy. */
	readonly piiPolicy?: "no_persist" | "minimize" | "explicit_only";
	/** Data retention in days. 0 = no persistence. */
	readonly retentionDays?: number;
}

// ─── Approach Ladder (Compliance Reasoning) ────────────────────────────────

/** A single approach in the compliance ladder. */
export interface ApproachLadderEntry {
	/** Short name for this approach (e.g., "Official API", "Local fallback"). */
	readonly name: string;
	/** Status: preferred (use this), fallback (if preferred unavailable), blocked (never use). */
	readonly status: "preferred" | "fallback" | "blocked";
	/** Why this approach has this status. */
	readonly why: string;
	/** What's needed for this approach (API keys, bins, etc.). */
	readonly requirements?: string[];
	/** Known risks of this approach. */
	readonly risks?: string[];
}

// ─── Eval Cases (Structured Testing) ───────────────────────────────────────

/**
 * A structured evaluation test case for a skill.
 * Lives in `eval/cases/*.json` within the skill directory.
 */
export interface EvalCase {
	/** Unique identifier for this test case. */
	readonly id: string;
	/** Input to feed the skill. */
	readonly input: Record<string, unknown>;
	/** Expected output or behavior description. */
	readonly expected: Record<string, unknown> | string;
	/** Test type: golden (happy path) or adversarial (attack/edge case). */
	readonly type?: "golden" | "adversarial";
	/** Human-readable description of what this case tests. */
	readonly description?: string;
}

/** Result of running eval cases against a skill. */
export interface EvalResult {
	readonly skillName: string;
	readonly totalCases: number;
	readonly passed: number;
	readonly failed: number;
	readonly results: Array<{
		readonly caseId: string;
		readonly passed: boolean;
		readonly actual?: unknown;
		readonly error?: string;
	}>;
}

// ─── Extended VidyaTantra Extension ────────────────────────────────────────

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
	/** Granular permissions (extends requirements with fine-grained policies). */
	readonly permissions?: GranularPermissions;
	/** Compliance approach ladder — structured reasoning for capability implementation. */
	readonly approachLadder?: ApproachLadderEntry[];
	/** Structured evaluation test cases. */
	readonly evalCases?: EvalCase[];
	/** Integrity manifest (computed hash per file + root hash). */
	readonly integrity?: SkillIntegrity;
	/** Cryptographic signature of the integrity root hash. */
	readonly signature?: SkillSignature;
}

// ─── Serializable State ───────────────────────────────────────────────────

/** Serializable form of the entire Vidya-Tantra state for persistence. */
export interface VidyaTantraState {
	readonly skills: Array<[string, SkillState]>;
	readonly compositions: YogaComposition[];
	readonly config: VidyaTantraConfig;
	readonly lastPersistedAt: string;
}
