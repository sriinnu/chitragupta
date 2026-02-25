/**
 * @chitragupta/smriti — Memory Consolidation Engine (Samskaara)
 *
 * In Vedic philosophy, samskaara refers to the impressions left on the mind
 * by experience — raw experiences get refined into lasting knowledge.
 *
 * This engine transforms raw session transcripts into distilled knowledge rules
 * by detecting recurring patterns, extracting reusable rules, compressing
 * episodic memories into semantic knowledge, and tracking what the system
 * has learned over time.
 *
 * Pattern detection logic lives in ./consolidation-phases.ts.
 * Scoring, hashing, and merge logic lives in ./consolidation-scoring.ts.
 * Types and constants live in ./consolidation-types.ts.
 */

import type { Session } from "./types.js";
import { getChitraguptaHome } from "@chitragupta/core";
import fs from "fs";
import path from "path";

import {
	detectToolSequences,
	detectPreferences,
	detectDecisions,
	detectCorrections,
	detectConventions,
} from "./consolidation-phases.js";

import {
	generateRuleId,
	mergeWithExisting,
	patternToRule,
	enforceMaxRules,
} from "./consolidation-scoring.js";

import {
	DEFAULT_CONFIG,
	MAX_HISTORY_ENTRIES,
	ALL_CATEGORIES,
} from "./consolidation-types.js";

import type {
	RuleCategory,
	KnowledgeRule,
	DetectedPattern,
	ConsolidationResult,
	ConsolidationConfig,
	ConsolidationHistoryEntry,
} from "./consolidation-types.js";

// Re-export types and constants for backward compatibility
export type { RuleCategory, KnowledgeRule, DetectedPattern, ConsolidationResult, ConsolidationConfig } from "./consolidation-types.js";

// ─── ConsolidationEngine ────────────────────────────────────────────────────

/**
 * Memory Consolidation Engine (Samskaara).
 *
 * Analyzes completed sessions to detect recurring patterns, extract reusable
 * knowledge rules, and compress episodic memories into semantic knowledge.
 * Rules gain confidence through repeated observation and decay when not
 * reinforced, ensuring the knowledge base stays relevant over time.
 *
 * @example
 * ```ts
 * const engine = new ConsolidationEngine({ minObservations: 2 });
 * engine.load();
 * const result = engine.consolidate(recentSessions);
 * engine.save();
 * ```
 */
export class ConsolidationEngine {
	private config: ConsolidationConfig;
	private rules: Map<string, KnowledgeRule> = new Map();
	private history: ConsolidationHistoryEntry[] = [];

	/**
	 * Create a new ConsolidationEngine.
	 *
	 * @param config - Partial configuration; unset fields use defaults.
	 */
	constructor(config?: Partial<ConsolidationConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Run consolidation on a set of sessions. This is the main entry point.
	 *
	 * Detects patterns across all provided sessions, merges them with existing
	 * rules (reinforcing matches, creating new rules, weakening contradictions),
	 * and returns a detailed result.
	 *
	 * @param sessions - The sessions to consolidate.
	 * @returns A ConsolidationResult describing what was learned.
	 */
	consolidate(sessions: Session[]): ConsolidationResult {
		const timestamp = new Date().toISOString();

		// Phase 1: Detect all patterns across sessions
		const toolPatterns = detectToolSequences(sessions, this.config.minObservations);
		const preferencePatterns = detectPreferences(sessions);
		const decisionPatterns = detectDecisions(sessions);
		const correctionPatterns = detectCorrections(sessions);
		const conventionPatterns = detectConventions(sessions, this.config.minObservations);

		const allPatterns: DetectedPattern[] = [
			...toolPatterns,
			...preferencePatterns,
			...decisionPatterns,
			...correctionPatterns,
			...conventionPatterns,
		];

		// Phase 2: Convert patterns to candidate rules (only those meeting minObservations)
		const candidateRules: KnowledgeRule[] = allPatterns
			.filter((p) => p.frequency >= this.config.minObservations)
			.map((p) => patternToRule(p, sessions, timestamp));

		// Phase 3: Merge with existing rules
		const { newRules, reinforcedRules, weakenedRules } =
			mergeWithExisting(candidateRules, allPatterns, this.rules);

		// Phase 4: Enforce maxRules limit (keep highest confidence)
		enforceMaxRules(this.rules, this.config.maxRules);

		// Decay unreinforced rules and prune dead ones
		this.decayRules();
		this.pruneRules();

		// Record in history
		const entry: ConsolidationHistoryEntry = {
			timestamp,
			sessionsAnalyzed: sessions.length,
			newRulesCount: newRules.length,
			reinforcedCount: reinforcedRules.length,
			weakenedCount: weakenedRules.length,
			patternsDetected: allPatterns.length,
		};
		this.history.push(entry);
		if (this.history.length > MAX_HISTORY_ENTRIES) {
			this.history = this.history.slice(-MAX_HISTORY_ENTRIES);
		}

		// Persist consolidated state so callers don't need to call save() manually
		this.save();

		return {
			newRules,
			reinforcedRules,
			weakenedRules,
			patternsDetected: allPatterns,
			sessionsAnalyzed: sessions.length,
			timestamp,
		};
	}

	/**
	 * Get all current knowledge rules.
	 *
	 * @returns Array of all stored rules, sorted by confidence descending.
	 */
	getRules(): KnowledgeRule[] {
		return [...this.rules.values()].sort((a, b) => b.confidence - a.confidence);
	}

	/**
	 * Get rules filtered by category.
	 *
	 * @param category - The rule category to filter by.
	 * @returns Array of rules in the given category, sorted by confidence descending.
	 */
	getRulesByCategory(category: RuleCategory): KnowledgeRule[] {
		return this.getRules().filter((r) => r.category === category);
	}

	/**
	 * Search rules by text query. Matches against rule text, derivation,
	 * and tags using case-insensitive substring matching.
	 *
	 * @param query - The search query string.
	 * @returns Matching rules, sorted by confidence descending.
	 */
	searchRules(query: string): KnowledgeRule[] {
		const q = query.toLowerCase();
		return this.getRules().filter((r) => {
			const searchable = [
				r.rule,
				r.derivation,
				...r.tags,
			].join(" ").toLowerCase();
			return searchable.includes(q);
		});
	}

	/**
	 * Manually add a rule (e.g., from direct user instruction or correction).
	 * If a rule with the same ID already exists, it will be reinforced instead.
	 *
	 * @param rule - The rule to add (id, createdAt, and lastReinforcedAt are generated).
	 * @returns The created or reinforced KnowledgeRule.
	 */
	addRule(rule: Omit<KnowledgeRule, "id" | "createdAt" | "lastReinforcedAt">): KnowledgeRule {
		const now = new Date().toISOString();
		const id = generateRuleId(rule.category, rule.rule);

		const existing = this.rules.get(id);
		if (existing) {
			existing.observationCount += rule.observationCount;
			existing.confidence = Math.min(1.0, existing.confidence + 0.1);
			existing.lastReinforcedAt = now;
			// Merge source session IDs (deduplicated)
			const sessionSet = new Set([...existing.sourceSessionIds, ...rule.sourceSessionIds]);
			existing.sourceSessionIds = [...sessionSet];
			// Merge tags (deduplicated)
			const tagSet = new Set([...existing.tags, ...rule.tags]);
			existing.tags = [...tagSet];
			return { ...existing };
		}

		const newRule: KnowledgeRule = {
			...rule,
			id,
			createdAt: now,
			lastReinforcedAt: now,
		};
		this.rules.set(id, newRule);
		return { ...newRule };
	}

	/**
	 * Decay unreinforced rules based on the time elapsed since their last
	 * reinforcement. Confidence decreases by `decayRatePerDay` for each
	 * day since the rule was last reinforced.
	 *
	 * Rules whose confidence drops to zero or below are set to 0.
	 */
	decayRules(): void {
		const now = Date.now();
		const msPerDay = 86_400_000;

		for (const rule of this.rules.values()) {
			const lastReinforced = new Date(rule.lastReinforcedAt).getTime();
			const daysSinceReinforced = (now - lastReinforced) / msPerDay;

			if (daysSinceReinforced > 0) {
				const decay = this.config.decayRatePerDay * daysSinceReinforced;
				rule.confidence = Math.max(0, rule.confidence - decay);
			}
		}
	}

	/**
	 * Remove rules with confidence below the given threshold.
	 * Defaults to the configured pruneThreshold if not specified.
	 * Persists changes to disk when rules are actually pruned.
	 *
	 * @param minConfidence - Minimum confidence to keep a rule. Defaults to config.pruneThreshold.
	 * @returns Number of pruned rules.
	 */
	pruneRules(minConfidence?: number): number {
		const threshold = minConfidence ?? this.config.pruneThreshold;
		const before = this.rules.size;
		for (const [id, rule] of this.rules) {
			if (rule.confidence < threshold) {
				this.rules.delete(id);
			}
		}
		const pruned = before - this.rules.size;
		if (pruned > 0) {
			this.save();
		}
		return pruned;
	}

	/**
	 * Persist the current rules and consolidation history to disk.
	 * Creates the storage directory if it does not exist.
	 */
	save(): void {
		const dir = this.getStoragePath();
		fs.mkdirSync(dir, { recursive: true });

		const rulesPath = path.join(dir, "rules.json");
		const historyPath = path.join(dir, "history.json");

		fs.writeFileSync(rulesPath, JSON.stringify(this.getRules(), null, "\t"), "utf-8");
		fs.writeFileSync(historyPath, JSON.stringify(this.history, null, "\t"), "utf-8");
	}

	/**
	 * Load previously persisted rules and history from disk.
	 * If no files exist, starts with empty state (no error thrown).
	 */
	load(): void {
		const dir = this.getStoragePath();
		const rulesPath = path.join(dir, "rules.json");
		const historyPath = path.join(dir, "history.json");

		if (fs.existsSync(rulesPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as KnowledgeRule[];
				this.rules.clear();
				for (const rule of data) {
					this.rules.set(rule.id, rule);
				}
			} catch (err) {
				process.stderr.write(`[consolidation] corrupted rules.json, starting fresh: ${err instanceof Error ? err.message : err}\n`);
				this.rules.clear();
			}
		}

		if (fs.existsSync(historyPath)) {
			try {
				this.history = JSON.parse(
					fs.readFileSync(historyPath, "utf-8"),
				) as ConsolidationHistoryEntry[];
			} catch (err) {
				process.stderr.write(`[consolidation] corrupted history.json, starting fresh: ${err instanceof Error ? err.message : err}\n`);
				this.history = [];
			}
		}
	}

	/**
	 * Get consolidation statistics: total rules, breakdown by category,
	 * and average confidence across all rules.
	 *
	 * @returns Statistics object.
	 */
	getStats(): { totalRules: number; byCategory: Record<RuleCategory, number>; avgConfidence: number } {
		const rules = this.getRules();
		const byCategory = {} as Record<RuleCategory, number>;

		for (const cat of ALL_CATEGORIES) {
			byCategory[cat] = 0;
		}
		for (const rule of rules) {
			byCategory[rule.category] = (byCategory[rule.category] ?? 0) + 1;
		}

		const avgConfidence = rules.length > 0
			? rules.reduce((sum, r) => sum + r.confidence, 0) / rules.length
			: 0;

		return {
			totalRules: rules.length,
			byCategory,
			avgConfidence,
		};
	}

	/**
	 * Get the storage directory path for consolidation state.
	 *
	 * @returns Absolute path to the consolidation storage directory.
	 */
	private getStoragePath(): string {
		return this.config.storagePath ?? path.join(getChitraguptaHome(), "consolidation");
	}
}
