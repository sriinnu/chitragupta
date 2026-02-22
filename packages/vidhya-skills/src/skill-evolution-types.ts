/**
 * Skill Evolution Types and Constants.
 *
 * Type definitions, internal tracking data, and configuration constants
 * for the skill evolution system.
 *
 * @packageDocumentation
 */

import { TRAIT_DIMENSIONS } from "./fingerprint.js";
import type { DreyfusLevel, AnandamayaMastery } from "./types-v2.js";
import { DREYFUS_THRESHOLDS, INITIAL_ANANDAMAYA } from "./types-v2.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Health report for a single skill. */
export interface SkillHealthReport {
	/** Skill name. */
	name: string;
	/** Number of times matched by a query. */
	matchCount: number;
	/** Number of times actually used after matching. */
	useCount: number;
	/** Number of times rejected after matching. */
	rejectCount: number;
	/** Number of successful uses. */
	successCount: number;
	/** Average match score across all matches. */
	avgMatchScore: number;
	/** Use rate: uses / matches. */
	useRate: number;
	/** Success rate: successes / uses. */
	successRate: number;
	/** Freshness score in [0, 1] based on exponential decay. */
	freshnessScore: number;
	/** Diversity score: unique contexts / total uses. */
	diversityScore: number;
	/** Composite health score in [0, 1]. */
	health: number;
	/** Timestamp of last usage. */
	lastUsedAt: number | null;
	/** Whether this skill is flagged for deprecation review. */
	flaggedForReview: boolean;
}

/** Serializable state for persistence. */
/** Serialized form of SkillTrackingData where Set<string> becomes string[]. */
export type SerializedSkillTrackingData = Omit<SkillTrackingData, "contexts"> & { contexts: string[] };

export interface SkillEvolutionState {
	/** Per-skill tracking data (contexts serialized as string[]). */
	skills: Array<[string, SerializedSkillTrackingData]>;
	/** Co-occurrence matrix for fusion detection. */
	coOccurrences: Array<[string, Array<[string, number]>]>;
	/** Session co-use records. */
	sessionSkills: string[][];
}

/** Suggestion to merge two skills that are always used together. */
export interface FusionSuggestion {
	/** First skill name. */
	skillA: string;
	/** Second skill name. */
	skillB: string;
	/** Co-occurrence rate in [0, 1]. */
	coOccurrenceRate: number;
	/** Reason for the suggestion. */
	reason: string;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Internal per-skill tracking data. */
export interface SkillTrackingData {
	name: string;
	matchCount: number;
	useCount: number;
	rejectCount: number;
	successCount: number;
	totalMatchScore: number;
	contexts: Set<string>;
	lastUsedAt: number | null;
	/** Evolved trait vector (number[] for serialization). */
	evolvedVector: number[] | null;
	/** Thompson Sampling: Beta distribution alpha (successes + 1). */
	thompsonAlpha: number;
	/** Thompson Sampling: Beta distribution beta (failures + 1). */
	thompsonBeta: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Learning rate for trait vector evolution. */
export const DEFAULT_LEARNING_RATE = 0.05;

/** Minimum health before flagging for deprecation review. */
export const DEPRECATION_HEALTH_THRESHOLD = 0.1;

/** Minimum matches before a skill can be flagged for deprecation. */
export const DEPRECATION_MIN_MATCHES = 50;

/** Co-occurrence threshold for fusion suggestions. */
export const FUSION_CO_OCCURRENCE_THRESHOLD = 0.6;

/** Minimum co-occurrences before suggesting fusion. */
export const FUSION_MIN_CO_OCCURRENCES = 10;

/** Maximum number of session records to retain for co-occurrence analysis. */
export const MAX_SESSION_RECORDS = 200;

/** Milliseconds in one day (for freshness decay). */
export const MS_PER_DAY = 86_400_000;
