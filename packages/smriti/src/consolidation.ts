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
 */

import type { Session, SessionTurn, SessionToolCall } from "./types.js";
import { getChitraguptaHome } from "@chitragupta/core";
import fs from "fs";
import path from "path";

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
interface ConsolidationHistoryEntry {
	timestamp: string;
	sessionsAnalyzed: number;
	newRulesCount: number;
	reinforcedCount: number;
	weakenedCount: number;
	patternsDetected: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default configuration values. */
const DEFAULT_CONFIG: ConsolidationConfig = {
	minObservations: 2,
	decayRatePerDay: 0.01,
	maxRules: 500,
	pruneThreshold: 0.1,
};

/** Maximum consolidation history entries to retain. */
const MAX_HISTORY_ENTRIES = 100;

/** Minimum text similarity score to consider two rules as matching. */
const SIMILARITY_THRESHOLD = 0.8;

/** All rule categories for iteration. */
const ALL_CATEGORIES: RuleCategory[] = [
	"preference", "workflow", "decision", "correction",
	"convention", "tool-pattern", "domain-knowledge", "relationship",
];

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash of the input string, returned as a
 * zero-padded hex string.
 *
 * @param input - The string to hash.
 * @returns An 8-character hex string.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	// Convert to unsigned 32-bit then to hex
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generate a deterministic rule ID from category and normalized rule text.
 * The same rule always produces the same ID.
 *
 * @param category - The rule category.
 * @param ruleText - The rule text (will be normalized).
 * @returns A deterministic rule ID string.
 */
function generateRuleId(category: RuleCategory, ruleText: string): string {
	const normalized = ruleText.toLowerCase().trim().replace(/\s+/g, " ");
	return `rule-${category}-${fnv1a(category + ":" + normalized)}`;
}

// ─── Text Similarity ────────────────────────────────────────────────────────

/**
 * Compute bigram-based Dice coefficient similarity between two strings.
 * Returns a value in [0, 1] where 1 means identical bigram sets.
 *
 * This is a lightweight alternative to cosine similarity that works well
 * for short natural-language rule descriptions without needing embeddings.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Similarity score in [0, 1].
 */
function textSimilarity(a: string, b: string): number {
	const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
	const na = normalize(a);
	const nb = normalize(b);

	if (na === nb) return 1.0;
	if (na.length < 2 || nb.length < 2) return 0.0;

	const bigrams = (s: string): Map<string, number> => {
		const map = new Map<string, number>();
		for (let i = 0; i < s.length - 1; i++) {
			const bg = s.substring(i, i + 2);
			map.set(bg, (map.get(bg) ?? 0) + 1);
		}
		return map;
	};

	const bga = bigrams(na);
	const bgb = bigrams(nb);

	let intersection = 0;
	for (const [bg, count] of bga) {
		intersection += Math.min(count, bgb.get(bg) ?? 0);
	}

	const totalA = na.length - 1;
	const totalB = nb.length - 1;

	return (2 * intersection) / (totalA + totalB);
}

// ─── Pattern Detection Helpers ──────────────────────────────────────────────

/** Extract tool call names from a session's turns, in order. */
function extractToolSequence(session: Session): string[] {
	const tools: string[] = [];
	for (const turn of session.turns) {
		if (turn.toolCalls) {
			for (const tc of turn.toolCalls) {
				tools.push(tc.name);
			}
		}
	}
	return tools;
}

/** Extract n-grams of the given size from a sequence. */
function ngrams(sequence: string[], n: number): string[] {
	const result: string[] = [];
	for (let i = 0; i <= sequence.length - n; i++) {
		result.push(sequence.slice(i, i + n).join(" -> "));
	}
	return result;
}

/** Extract all user-role content from a session. */
function extractUserContent(session: Session): string[] {
	return session.turns
		.filter((t) => t.role === "user")
		.map((t) => t.content);
}

/** Extract all assistant-role content from a session. */
function extractAssistantContent(session: Session): string[] {
	return session.turns
		.filter((t) => t.role === "assistant")
		.map((t) => t.content);
}

// ─── Regex Patterns for Detection ───────────────────────────────────────────

/** Patterns that indicate user preferences. */
const PREFERENCE_PATTERNS = [
	/\bi prefer\b/i,
	/\balways use\b/i,
	/\bnever use\b/i,
	/\buse (\w+) instead of (\w+)/i,
	/\bdon'?t use\b/i,
	/\bi like\b/i,
	/\bi want\b/i,
	/\bplease always\b/i,
	/\bplease never\b/i,
	/\blet'?s stick with\b/i,
	/\bmy preference is\b/i,
];

/** Patterns that indicate architectural/design decisions. */
const DECISION_PATTERNS = [
	/\blet'?s use\b/i,
	/\bdecided to\b/i,
	/\bgoing with\b/i,
	/\bswitched to\b/i,
	/\bwe'?ll go with\b/i,
	/\bthe decision is\b/i,
	/\bwe chose\b/i,
	/\bthe approach is\b/i,
	/\bwe'?re using\b/i,
	/\blet'?s go with\b/i,
];

/** Patterns that indicate the user is correcting the agent. */
const CORRECTION_PATTERNS = [
	/\bno,?\s+(?:not|use|it should|that'?s wrong)/i,
	/\bthat'?s (?:wrong|incorrect|not right)\b/i,
	/\bactually,?\s/i,
	/\binstead,?\s/i,
	/\bshould be\b/i,
	/\bnot (\w+),?\s+(?:but|use)\b/i,
	/\bwrong\b.*\bshould\b/i,
	/\bfix (?:that|this|it)\b/i,
	/\bchange (?:that|this|it) to\b/i,
];

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
		const toolPatterns = this.detectToolSequences(sessions);
		const preferencePatterns = this.detectPreferences(sessions);
		const decisionPatterns = this.detectDecisions(sessions);
		const correctionPatterns = this.detectCorrections(sessions);
		const conventionPatterns = this.detectConventions(sessions);

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
			.map((p) => this.patternToRule(p, sessions, timestamp));

		// Phase 3: Merge with existing rules
		const { newRules, reinforcedRules, weakenedRules } =
			this.mergeWithExisting(candidateRules, allPatterns);

		// Phase 4: Enforce maxRules limit (keep highest confidence)
		this.enforceMaxRules();

		// Prune dead rules (confidence decayed below threshold)
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
			} catch {
				// Corrupted file — start fresh
				this.rules.clear();
			}
		}

		if (fs.existsSync(historyPath)) {
			try {
				this.history = JSON.parse(
					fs.readFileSync(historyPath, "utf-8"),
				) as ConsolidationHistoryEntry[];
			} catch {
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

	// ── Pattern Detection (Private) ───────────────────────────────────────

	/**
	 * Detect recurring tool call sequences across sessions using n-gram analysis.
	 *
	 * Extracts tool call names from each session in order, then finds 2-gram,
	 * 3-gram, and 4-gram sequences that appear in multiple sessions.
	 *
	 * @param sessions - Sessions to analyze.
	 * @returns Detected tool-sequence patterns.
	 */
	private detectToolSequences(sessions: Session[]): DetectedPattern[] {
		const patterns: DetectedPattern[] = [];

		// For each n-gram size, count how many sessions contain each n-gram
		for (const n of [2, 3, 4]) {
			const ngramSessionCount = new Map<string, Set<string>>();
			const ngramEvidence = new Map<string, string[]>();

			for (const session of sessions) {
				const toolSeq = extractToolSequence(session);
				if (toolSeq.length < n) continue;

				const sessionNgrams = new Set(ngrams(toolSeq, n));
				for (const ng of sessionNgrams) {
					if (!ngramSessionCount.has(ng)) {
						ngramSessionCount.set(ng, new Set());
						ngramEvidence.set(ng, []);
					}
					ngramSessionCount.get(ng)!.add(session.meta.id);
					ngramEvidence.get(ng)!.push(
						`Session "${session.meta.title}": ${ng}`,
					);
				}
			}

			for (const [ng, sessionIds] of ngramSessionCount) {
				if (sessionIds.size >= this.config.minObservations) {
					patterns.push({
						type: "tool-sequence",
						description: `Recurring tool sequence: ${ng}`,
						evidence: ngramEvidence.get(ng) ?? [],
						frequency: sessionIds.size,
						confidence: Math.min(1.0, sessionIds.size / (sessions.length * 0.5)),
					});
				}
			}
		}

		return patterns;
	}

	/**
	 * Detect user preference signals from session content.
	 *
	 * Scans user messages for explicit preference keywords ("I prefer",
	 * "always use", "never use", corrections like "no, use X").
	 *
	 * @param sessions - Sessions to analyze.
	 * @returns Detected preference patterns.
	 */
	private detectPreferences(sessions: Session[]): DetectedPattern[] {
		const patterns: DetectedPattern[] = [];
		const preferenceHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

		for (const session of sessions) {
			const userContent = extractUserContent(session);
			for (const content of userContent) {
				for (const pattern of PREFERENCE_PATTERNS) {
					const match = content.match(pattern);
					if (match) {
						// Use the matched sentence as a normalized key
						const sentence = extractSentenceContaining(content, match.index ?? 0);
						const key = sentence.toLowerCase().trim();

						if (!preferenceHits.has(key)) {
							preferenceHits.set(key, { sessions: new Set(), evidence: [] });
						}
						const hit = preferenceHits.get(key)!;
						hit.sessions.add(session.meta.id);
						hit.evidence.push(
							`Session "${session.meta.title}": "${sentence}"`,
						);
					}
				}
			}
		}

		for (const [key, hit] of preferenceHits) {
			patterns.push({
				type: "preference",
				description: `User preference: ${key}`,
				evidence: hit.evidence,
				frequency: hit.sessions.size,
				confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
			});
		}

		return patterns;
	}

	/**
	 * Detect architectural and design decisions from session content.
	 *
	 * Looks for phrases like "let's use X", "decided to", "going with",
	 * "switched to" in user messages.
	 *
	 * @param sessions - Sessions to analyze.
	 * @returns Detected decision patterns.
	 */
	private detectDecisions(sessions: Session[]): DetectedPattern[] {
		const patterns: DetectedPattern[] = [];
		const decisionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

		for (const session of sessions) {
			const userContent = extractUserContent(session);
			for (const content of userContent) {
				for (const pattern of DECISION_PATTERNS) {
					const match = content.match(pattern);
					if (match) {
						const sentence = extractSentenceContaining(content, match.index ?? 0);
						const key = sentence.toLowerCase().trim();

						if (!decisionHits.has(key)) {
							decisionHits.set(key, { sessions: new Set(), evidence: [] });
						}
						const hit = decisionHits.get(key)!;
						hit.sessions.add(session.meta.id);
						hit.evidence.push(
							`Session "${session.meta.title}": "${sentence}"`,
						);
					}
				}
			}
		}

		for (const [key, hit] of decisionHits) {
			patterns.push({
				type: "decision",
				description: `Decision: ${key}`,
				evidence: hit.evidence,
				frequency: hit.sessions.size,
				confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
			});
		}

		return patterns;
	}

	/**
	 * Detect correction patterns where the user corrected the agent.
	 *
	 * These are high-value learning signals: "no, not X, use Y",
	 * "that's wrong", "actually...", "should be...", etc.
	 *
	 * @param sessions - Sessions to analyze.
	 * @returns Detected correction patterns.
	 */
	private detectCorrections(sessions: Session[]): DetectedPattern[] {
		const patterns: DetectedPattern[] = [];
		const correctionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

		for (const session of sessions) {
			const userContent = extractUserContent(session);
			for (const content of userContent) {
				for (const pattern of CORRECTION_PATTERNS) {
					const match = content.match(pattern);
					if (match) {
						const sentence = extractSentenceContaining(content, match.index ?? 0);
						const key = sentence.toLowerCase().trim();

						if (!correctionHits.has(key)) {
							correctionHits.set(key, { sessions: new Set(), evidence: [] });
						}
						const hit = correctionHits.get(key)!;
						hit.sessions.add(session.meta.id);
						hit.evidence.push(
							`Session "${session.meta.title}": "${sentence}"`,
						);
					}
				}
			}
		}

		for (const [key, hit] of correctionHits) {
			patterns.push({
				type: "correction",
				description: `Correction: ${key}`,
				evidence: hit.evidence,
				frequency: hit.sessions.size,
				confidence: Math.min(
					1.0,
					// Corrections get a confidence boost — they are high-value signals
					hit.sessions.size / Math.max(sessions.length * 0.2, 1),
				),
			});
		}

		return patterns;
	}

	/**
	 * Detect code conventions from sessions.
	 *
	 * Analyzes tool call results and user content for naming patterns
	 * (camelCase, snake_case), file organization patterns, and consistent
	 * error handling approaches.
	 *
	 * @param sessions - Sessions to analyze.
	 * @returns Detected convention patterns.
	 */
	private detectConventions(sessions: Session[]): DetectedPattern[] {
		const patterns: DetectedPattern[] = [];
		const conventionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

		// Detect naming conventions from file paths in tool calls
		const fileExtCounts = new Map<string, { sessions: Set<string>; evidence: string[] }>();

		for (const session of sessions) {
			for (const turn of session.turns) {
				if (!turn.toolCalls) continue;
				for (const tc of turn.toolCalls) {
					// Check for file extension patterns in tool inputs
					const extMatch = tc.input.match(/\.([a-z]{1,5})\b/gi);
					if (extMatch) {
						for (const ext of extMatch) {
							const extLower = ext.toLowerCase();
							if (!fileExtCounts.has(extLower)) {
								fileExtCounts.set(extLower, { sessions: new Set(), evidence: [] });
							}
							const hit = fileExtCounts.get(extLower)!;
							hit.sessions.add(session.meta.id);
							hit.evidence.push(
								`Session "${session.meta.title}": tool ${tc.name} used ${extLower}`,
							);
						}
					}

					// Check for import style conventions
					if (tc.name === "edit" || tc.name === "write") {
						if (tc.input.includes('from "') || tc.input.includes("from '")) {
							const importKey = tc.input.includes(".js")
								? "esm-imports-with-js-extension"
								: "imports-without-extension";
							if (!conventionHits.has(importKey)) {
								conventionHits.set(importKey, { sessions: new Set(), evidence: [] });
							}
							const hit = conventionHits.get(importKey)!;
							hit.sessions.add(session.meta.id);
							hit.evidence.push(
								`Session "${session.meta.title}": ${importKey} in ${tc.name} call`,
							);
						}
					}
				}
			}
		}

		// Convert hits to patterns
		for (const [key, hit] of conventionHits) {
			if (hit.sessions.size >= this.config.minObservations) {
				patterns.push({
					type: "convention",
					description: `Convention: ${key}`,
					evidence: hit.evidence,
					frequency: hit.sessions.size,
					confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
				});
			}
		}

		return patterns;
	}

	// ── Merge Logic (Private) ─────────────────────────────────────────────

	/**
	 * Merge candidate rules with existing rules.
	 *
	 * For each candidate:
	 * - If it matches an existing rule (text similarity >= 0.8), reinforce it.
	 * - If no match is found, add it as a new rule.
	 *
	 * Also checks for contradiction: if new patterns contradict existing rules,
	 * the existing rules are weakened.
	 *
	 * @param candidates - New candidate rules from pattern detection.
	 * @param allPatterns - All detected patterns (for contradiction checking).
	 * @returns Object with new, reinforced, and weakened rule arrays.
	 */
	private mergeWithExisting(
		candidates: KnowledgeRule[],
		allPatterns: DetectedPattern[],
	): {
		newRules: KnowledgeRule[];
		reinforcedRules: KnowledgeRule[];
		weakenedRules: KnowledgeRule[];
	} {
		const newRules: KnowledgeRule[] = [];
		const reinforcedRules: KnowledgeRule[] = [];
		const weakenedRules: KnowledgeRule[] = [];

		for (const candidate of candidates) {
			let bestMatch: KnowledgeRule | null = null;
			let bestSimilarity = 0;

			for (const existing of this.rules.values()) {
				const sim = textSimilarity(candidate.rule, existing.rule);
				if (sim > bestSimilarity) {
					bestSimilarity = sim;
					bestMatch = existing;
				}
			}

			if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
				// Reinforce existing rule
				bestMatch.observationCount += candidate.observationCount;
				bestMatch.confidence = Math.min(
					1.0,
					bestMatch.confidence + 0.1 * candidate.observationCount,
				);
				bestMatch.lastReinforcedAt = candidate.lastReinforcedAt;
				// Merge source sessions
				const sessionSet = new Set([
					...bestMatch.sourceSessionIds,
					...candidate.sourceSessionIds,
				]);
				bestMatch.sourceSessionIds = [...sessionSet];
				// Merge tags
				const tagSet = new Set([...bestMatch.tags, ...candidate.tags]);
				bestMatch.tags = [...tagSet];
				reinforcedRules.push({ ...bestMatch });
			} else {
				// New rule — add it
				this.rules.set(candidate.id, candidate);
				newRules.push({ ...candidate });
			}
		}

		// Check for contradictions: correction patterns may weaken existing rules
		for (const pattern of allPatterns) {
			if (pattern.type === "correction") {
				for (const existing of this.rules.values()) {
					// If a correction mentions content similar to an existing rule's text,
					// and the correction seems to contradict it, weaken the rule
					const correctionText = pattern.description.toLowerCase();
					const ruleText = existing.rule.toLowerCase();

					// Simple heuristic: if the correction contains "not" + words from the rule
					if (correctionText.includes("not") || correctionText.includes("wrong")) {
						const ruleWords = ruleText.split(/\s+/).filter((w) => w.length > 3);
						const matchingWords = ruleWords.filter((w) => correctionText.includes(w));
						if (matchingWords.length >= 2 && !reinforcedRules.some((r) => r.id === existing.id)) {
							existing.confidence = Math.max(0, existing.confidence - 0.15);
							weakenedRules.push({ ...existing });
						}
					}
				}
			}
		}

		return { newRules, reinforcedRules, weakenedRules };
	}

	/**
	 * Convert a detected pattern into a candidate KnowledgeRule.
	 *
	 * @param pattern - The detected pattern.
	 * @param sessions - Sessions that were analyzed (for extracting IDs).
	 * @param timestamp - Current timestamp.
	 * @returns A KnowledgeRule candidate.
	 */
	private patternToRule(
		pattern: DetectedPattern,
		sessions: Session[],
		timestamp: string,
	): KnowledgeRule {
		const categoryMap: Record<DetectedPattern["type"], RuleCategory> = {
			"tool-sequence": "workflow",
			"preference": "preference",
			"decision": "decision",
			"correction": "correction",
			"convention": "convention",
		};

		const category = categoryMap[pattern.type];
		const id = generateRuleId(category, pattern.description);

		// Extract session IDs from evidence
		const sessionIds = sessions
			.filter((s) =>
				pattern.evidence.some((e) => e.includes(s.meta.title)),
			)
			.map((s) => s.meta.id);

		return {
			id,
			rule: pattern.description,
			derivation: `Detected from ${pattern.frequency} session(s): ${pattern.evidence.slice(0, 3).join("; ")}`,
			category,
			observationCount: pattern.frequency,
			confidence: pattern.confidence,
			sourceSessionIds: sessionIds,
			createdAt: timestamp,
			lastReinforcedAt: timestamp,
			tags: [pattern.type, category],
		};
	}

	/**
	 * Enforce the maximum rules limit by removing lowest-confidence rules.
	 */
	private enforceMaxRules(): void {
		if (this.rules.size <= this.config.maxRules) return;

		const sorted = [...this.rules.entries()]
			.sort(([, a], [, b]) => b.confidence - a.confidence);

		const toKeep = new Set(
			sorted.slice(0, this.config.maxRules).map(([id]) => id),
		);

		for (const id of this.rules.keys()) {
			if (!toKeep.has(id)) {
				this.rules.delete(id);
			}
		}
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

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Extract the sentence containing the character at the given index.
 * Splits on true sentence-ending punctuation or newlines, returning
 * the segment that contains the match position.
 *
 * Avoids splitting on dots that are part of file extensions (e.g., ".js",
 * ".ts"), path separators ("./"), or decimal numbers ("3.14").
 *
 * @param text - The full text to extract from.
 * @param index - The character index of the match.
 * @returns The sentence containing the match.
 */
function extractSentenceContaining(text: string, index: number): string {
	// Find true sentence boundaries — dots followed by a space and uppercase,
	// or followed by end-of-string. Exclamation/question marks and newlines
	// are always sentence boundaries.
	const breaks: number[] = [];

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n" || ch === "!" || ch === "?") {
			breaks.push(i);
		} else if (ch === ".") {
			// Only treat a dot as a sentence boundary if it looks like true
			// end-of-sentence punctuation, not a file extension or path dot.
			const prev = i > 0 ? text[i - 1] : "";
			const next = i < text.length - 1 ? text[i + 1] : "";

			// Dot is a sentence boundary if followed by space+uppercase or end-of-string
			const followedBySpaceUpper = next === " " && i + 2 < text.length && /[A-Z]/.test(text[i + 2]);
			const atEnd = i === text.length - 1;
			// Dot is NOT a sentence boundary if preceded/followed by a word char (file ext)
			// or preceded by / or . (path component)
			const isFilePath = prev === "/" || prev === "." || /[a-zA-Z0-9]/.test(next);

			if ((followedBySpaceUpper || atEnd) && !isFilePath) {
				breaks.push(i);
			}
		}
	}

	let start = 0;
	let end = text.length;

	for (const b of breaks) {
		if (b < index) {
			start = b + 1;
		} else {
			end = b;
			break;
		}
	}

	return text.substring(start, end).trim();
}
