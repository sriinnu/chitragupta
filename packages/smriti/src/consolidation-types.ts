/**
 * @chitragupta/smriti -- Consolidation types and constants.
 *
 * Extracted from consolidation.ts for maintainability.
 * Contains type definitions and configuration constants used by
 * ConsolidationEngine and its supporting modules.
 *
 * @module consolidation-types
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Category of a knowledge rule learned from experience. */
export type RuleCategory =
	| "preference"
	| "workflow"
	| "decision"
	| "correction"
	| "convention"
	| "tool-pattern"
	| "domain-knowledge"
	| "relationship";

/** A consolidated knowledge rule learned from experience. */
export interface KnowledgeRule {
	/** Deterministic ID derived from category + normalized rule text. */
	id: string;
	/** The rule expressed in natural language. */
	rule: string;
	/** How the rule was derived (e.g., "observed in 3 sessions"). */
	derivation: string;
	/** Category of knowledge. */
	category: RuleCategory;
	/** How many times this pattern was observed. */
	observationCount: number;
	/** Confidence in this rule [0, 1]. Higher with more observations. */
	confidence: number;
	/** IDs of sessions that contributed to this rule. */
	sourceSessionIds: string[];
	/** ISO timestamp of when this rule was first created. */
	createdAt: string;
	/** ISO timestamp of when this rule was last reinforced. */
	lastReinforcedAt: string;
	/** Tags for searchability. */
	tags: string[];
	/** When true, this rule is exempt from temporal decay and pruning. */
	evergreen?: boolean;
}

/** A detected pattern in session data. */
export interface DetectedPattern {
	/** The kind of pattern detected. */
	type: "tool-sequence" | "preference" | "decision" | "correction" | "convention";
	/** Human-readable description of the pattern. */
	description: string;
	/** Evidence snippets from sessions. */
	evidence: string[];
	/** Number of times this pattern was observed. */
	frequency: number;
	/** Confidence in this pattern [0, 1]. */
	confidence: number;
}

/** Result of a consolidation run. */
export interface ConsolidationResult {
	/** New rules discovered. */
	newRules: KnowledgeRule[];
	/** Existing rules that were reinforced (observation count increased). */
	reinforcedRules: KnowledgeRule[];
	/** Rules that were weakened or contradicted. */
	weakenedRules: KnowledgeRule[];
	/** Patterns detected during analysis. */
	patternsDetected: DetectedPattern[];
	/** Number of sessions analyzed. */
	sessionsAnalyzed: number;
	/** ISO timestamp of this consolidation run. */
	timestamp: string;
}

/** Configuration for the consolidation engine. */
export interface ConsolidationConfig {
	/** Minimum observation count before a pattern becomes a rule. Default: 2. */
	minObservations: number;
	/** Confidence decay rate per day for unreinforced rules. Default: 0.01. */
	decayRatePerDay: number;
	/** Maximum number of rules to retain. Default: 500. */
	maxRules: number;
	/** Minimum confidence to keep a rule (below this, it's pruned). Default: 0.1. */
	pruneThreshold: number;
	/** Path to store consolidation state. Defaults to getChitraguptaHome()/consolidation/. */
	storagePath?: string;
}

/** A single consolidation history entry. */
export interface ConsolidationHistoryEntry {
	timestamp: string;
	sessionsAnalyzed: number;
	newRulesCount: number;
	reinforcedCount: number;
	weakenedCount: number;
	patternsDetected: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default configuration values. */
export const DEFAULT_CONFIG: ConsolidationConfig = {
	minObservations: 2,
	decayRatePerDay: 0.01,
	maxRules: 500,
	pruneThreshold: 0.1,
};

/** Maximum consolidation history entries to retain. */
export const MAX_HISTORY_ENTRIES = 100;

/** All rule categories for iteration. */
export const ALL_CATEGORIES: RuleCategory[] = [
	"preference", "workflow", "decision", "correction",
	"convention", "tool-pattern", "domain-knowledge", "relationship",
];
