/**
 * @chitragupta/anina — Buddhi analysis utilities.
 *
 * Standalone helpers extracted from the Buddhi class: FNV-1a hashing,
 * DDL schema, Nyaya validation, row conversion, decision explanation
 * formatting, and pattern/success-rate queries.
 */

import type { DatabaseManager } from "@chitragupta/smriti";
import type {
	NyayaReasoning, Decision, DecisionCategory, DecisionOutcome,
	Alternative, DecisionPattern,
} from "./buddhi.js";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash producing a deterministic hex ID from text. */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── SQL Schema ─────────────────────────────────────────────────────────────

/** DDL for the decisions table. Idempotent (IF NOT EXISTS). */
export const DECISIONS_DDL = `
	CREATE TABLE IF NOT EXISTS decisions (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		project TEXT NOT NULL,
		category TEXT NOT NULL,
		description TEXT NOT NULL,
		reasoning_json TEXT NOT NULL,
		confidence REAL NOT NULL,
		alternatives_json TEXT,
		outcome_json TEXT,
		metadata_json TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project);
	CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
`;

// ─── Minimal Statement Interface ────────────────────────────────────────────

/** @internal Minimal prepared-statement interface for better-sqlite3. */
export interface PreparedStmt {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): unknown;
}

// ─── Row Types ──────────────────────────────────────────────────────────────

/** @internal SQLite row shape for a decision record. */
export interface DecisionRow {
	id: string;
	session_id: string;
	project: string;
	category: string;
	description: string;
	reasoning_json: string;
	confidence: number;
	alternatives_json: string | null;
	outcome_json: string | null;
	metadata_json: string | null;
	created_at: number;
}

/** @internal SQLite row shape for category aggregation. */
export interface CategoryStatsRow {
	category: string;
	count: number;
	avg_confidence: number;
	representative: string;
}

// ─── Valid Categories ───────────────────────────────────────────────────────

/** The set of valid decision categories. */
export const VALID_CATEGORIES = new Set<DecisionCategory>([
	"architecture", "tool-selection", "model-routing",
	"error-recovery", "refactoring", "security",
]);

// ─── Validation ─────────────────────────────────────────────────────────────

/** Validate all five steps of the Nyaya reasoning are present and non-empty. */
export function validateNyayaReasoning(r: NyayaReasoning): void {
	const steps: Array<[keyof NyayaReasoning, string]> = [
		["thesis", "Pratijña (thesis)"],
		["reason", "Hetu (reason)"],
		["example", "Udaharana (example)"],
		["application", "Upanaya (application)"],
		["conclusion", "Nigamana (conclusion)"],
	];
	for (const [key, label] of steps) {
		if (!r[key] || r[key].trim().length === 0) {
			throw new Error(`Nyaya reasoning incomplete: missing ${label}`);
		}
	}
}

// ─── Row Conversion ─────────────────────────────────────────────────────────

/** Convert a SQLite DecisionRow to a Decision domain object. */
export function rowToDecision(row: DecisionRow): Decision {
	const decision: Decision = {
		id: row.id,
		timestamp: row.created_at,
		sessionId: row.session_id,
		project: row.project,
		category: row.category as DecisionCategory,
		description: row.description,
		reasoning: JSON.parse(row.reasoning_json) as NyayaReasoning,
		confidence: row.confidence,
		alternatives: row.alternatives_json
			? JSON.parse(row.alternatives_json) as Alternative[]
			: [],
		metadata: row.metadata_json
			? JSON.parse(row.metadata_json) as Record<string, unknown>
			: {},
	};
	if (row.outcome_json) {
		decision.outcome = JSON.parse(row.outcome_json) as DecisionOutcome;
	}
	return decision;
}

// ─── Explanation Formatting ─────────────────────────────────────────────────

/** Format a Decision as a human-readable Nyaya syllogism explanation. */
export function formatDecisionExplanation(decision: Decision): string {
	const r = decision.reasoning;
	const parts: string[] = [
		`Decision: ${decision.description}`,
		`Category: ${decision.category} | Confidence: ${Math.round(decision.confidence * 100)}%`,
		"",
		"--- Nyaya Reasoning (Panchavayava) ---",
		`1. Pratijña (Thesis):     ${r.thesis}`,
		`2. Hetu (Reason):         ${r.reason}`,
		`3. Udaharana (Example):   ${r.example}`,
		`4. Upanaya (Application): ${r.application}`,
		`5. Nigamana (Conclusion): ${r.conclusion}`,
	];

	if (decision.alternatives.length > 0) {
		parts.push("", `Alternatives considered: ${decision.alternatives.length}`);
		for (const alt of decision.alternatives) {
			parts.push(`  - ${alt.description}: ${alt.reason_rejected}`);
		}
	}

	parts.push("");
	if (decision.outcome) {
		parts.push(`Outcome: ${decision.outcome.success ? "Success" : "Failure"}`);
		if (decision.outcome.feedback) parts.push(`Feedback: ${decision.outcome.feedback}`);
	} else {
		parts.push("Outcome: Pending");
	}

	return parts.join("\n");
}

// ─── Pattern Queries ────────────────────────────────────────────────────────

/** Prep function signature matching Buddhi's internal cache. */
type PrepFn = (db: ReturnType<DatabaseManager["get"]>, sql: string) => PreparedStmt;

/**
 * Query recurring decision patterns for a project.
 * Groups by category, computes avg confidence and success rate.
 */
export function queryDecisionPatterns(
	project: string,
	agentDb: ReturnType<DatabaseManager["get"]>,
	prep: PrepFn,
): DecisionPattern[] {
	const statsRows = prep(agentDb, `
		SELECT category, COUNT(*) as count, AVG(confidence) as avg_confidence,
			description as representative
		FROM decisions WHERE project = ?
		GROUP BY category ORDER BY count DESC
	`).all(project) as CategoryStatsRow[];

	const patterns: DecisionPattern[] = [];
	for (const row of statsRows) {
		const outcomeRows = prep(agentDb, `
			SELECT outcome_json FROM decisions
			WHERE project = ? AND category = ? AND outcome_json IS NOT NULL
		`).all(project, row.category) as Array<{ outcome_json: string }>;

		let successCount = 0;
		let totalWithOutcome = 0;
		for (const or of outcomeRows) {
			const outcome = JSON.parse(or.outcome_json) as DecisionOutcome;
			totalWithOutcome++;
			if (outcome.success) successCount++;
		}

		patterns.push({
			category: row.category as DecisionCategory,
			count: row.count,
			avgConfidence: Math.round(row.avg_confidence * 1000) / 1000,
			successRate: totalWithOutcome > 0
				? Math.round((successCount / totalWithOutcome) * 1000) / 1000
				: 0,
			representative: row.representative,
		});
	}
	return patterns;
}

/**
 * Query the success rate for a specific decision category across all projects.
 * Only considers decisions with recorded outcomes.
 */
export function queryCategorySuccessRate(
	category: DecisionCategory,
	agentDb: ReturnType<DatabaseManager["get"]>,
	prep: PrepFn,
): number {
	const rows = prep(agentDb, `
		SELECT outcome_json FROM decisions
		WHERE category = ? AND outcome_json IS NOT NULL
	`).all(category) as Array<{ outcome_json: string }>;

	if (rows.length === 0) return 0;

	let successCount = 0;
	for (const row of rows) {
		const outcome = JSON.parse(row.outcome_json) as DecisionOutcome;
		if (outcome.success) successCount++;
	}
	return Math.round((successCount / rows.length) * 1000) / 1000;
}
