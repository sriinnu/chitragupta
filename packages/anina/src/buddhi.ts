/**
 * @chitragupta/anina — Buddhi — बुद्धि — Intellect / Decision Framework.
 *
 * In Vedic philosophy, Buddhi is the faculty of discernment and judgment —
 * the aspect of mind that discriminates, decides, and determines. While Manas
 * (mind) gathers sense impressions, Buddhi evaluates and resolves. This module
 * provides structured decision logging using the classical Indian Nyaya
 * syllogism framework (Panchavayava — five-limbed reasoning).
 *
 * Every significant decision the agent makes — from tool selection to
 * architecture choices to error recovery strategies — is recorded as a
 * formal Nyaya syllogism with:
 *
 *   1. Pratijña (प्रतिज्ञा) — Thesis: the claim to be proven
 *   2. Hetu (हेतु) — Reason: the evidence supporting the claim
 *   3. Udaharana (उदाहरण) — Example: the universal rule with an instance
 *   4. Upanaya (उपनय) — Application: applying the rule to this case
 *   5. Nigamana (निगमन) — Conclusion: the re-established thesis
 *
 * Decisions are persisted to SQLite (agent.db) via better-sqlite3 prepared
 * statements with lazy caching. Outcomes can be recorded after the fact to
 * build a feedback loop. Pattern analysis surfaces recurring decisions and
 * category success rates for agent self-improvement.
 *
 * @packageDocumentation
 */

import type { DatabaseManager } from "@chitragupta/smriti";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash.
 *
 * Produces a deterministic hex string ID from arbitrary text.
 * Used to create stable decision IDs from description + timestamp.
 */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Five-step Nyaya syllogism (Panchavayava).
 *
 * The classical Indian logic framework for formal reasoning, predating
 * Aristotelian syllogism by centuries. Each step builds on the previous,
 * creating a complete chain of deductive reasoning.
 */
export interface NyayaReasoning {
	/** Pratijña (प्रतिज्ञा) — The thesis/claim to be proven. */
	thesis: string;
	/** Hetu (हेतु) — The reason/evidence. */
	reason: string;
	/** Udaharana (उदाहरण) — The universal rule + example. */
	example: string;
	/** Upanaya (उपनय) — Application to the specific case. */
	application: string;
	/** Nigamana (निगमन) — The conclusion. */
	conclusion: string;
}

/** Categories of decisions the agent can make. */
export type DecisionCategory =
	| "architecture"
	| "tool-selection"
	| "model-routing"
	| "error-recovery"
	| "refactoring"
	| "security";

/** A rejected alternative considered during decision-making. */
export interface Alternative {
	description: string;
	reason_rejected: string;
}

/** The outcome of a decision, recorded after the fact. */
export interface DecisionOutcome {
	success: boolean;
	feedback?: string;
	timestamp: number;
}

/** A recorded decision with full Nyaya reasoning. */
export interface Decision {
	/** Unique decision ID (FNV-1a hash). */
	id: string;
	/** Unix epoch ms when the decision was made. */
	timestamp: number;
	/** Session in which the decision was made. */
	sessionId: string;
	/** Project context for the decision. */
	project: string;
	/** What kind of decision this is. */
	category: DecisionCategory;
	/** Human-readable summary of the decision. */
	description: string;
	/** Full Nyaya syllogism reasoning chain. */
	reasoning: NyayaReasoning;
	/** Confidence in the decision [0, 1]. */
	confidence: number;
	/** Other options that were considered and rejected. */
	alternatives: Alternative[];
	/** Outcome of the decision, filled in later. */
	outcome?: DecisionOutcome;
	/** Arbitrary metadata for extensibility. */
	metadata: Record<string, unknown>;
}

/** Input parameters for recording a decision (id and timestamp are generated). */
export interface RecordDecisionParams {
	sessionId: string;
	project: string;
	category: DecisionCategory;
	description: string;
	reasoning: NyayaReasoning;
	confidence: number;
	alternatives?: Alternative[];
	metadata?: Record<string, unknown>;
}

/** Filtering options for listing decisions. */
export interface ListDecisionsOptions {
	project?: string;
	category?: DecisionCategory;
	fromDate?: number;
	toDate?: number;
	limit?: number;
}

/** A recurring decision pattern discovered by analysis. */
export interface DecisionPattern {
	category: DecisionCategory;
	count: number;
	avgConfidence: number;
	successRate: number;
	/** Representative description from the most frequent decision. */
	representative: string;
}

// ─── SQL Schema ─────────────────────────────────────────────────────────────

const DECISIONS_DDL = `
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
// better-sqlite3's generic types make cached statements difficult to type
// without importing the module directly. This minimal interface covers the
// three methods we actually call, with variadic unknown params.

/** @internal */
interface PreparedStmt {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): unknown;
}

// ─── Row Types (SQLite result shapes) ───────────────────────────────────────

interface DecisionRow {
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

interface CategoryStatsRow {
	category: string;
	count: number;
	avg_confidence: number;
	representative: string;
}

// ─── Valid Categories ───────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<DecisionCategory>([
	"architecture",
	"tool-selection",
	"model-routing",
	"error-recovery",
	"refactoring",
	"security",
]);

// ─── Buddhi ─────────────────────────────────────────────────────────────────

/**
 * Buddhi — the intellect, the discerning faculty.
 *
 * Records, retrieves, and analyzes agent decisions using the Nyaya syllogism
 * framework. All operations are synchronous (better-sqlite3). Decisions are
 * persisted to the `decisions` table in agent.db.
 */
export class Buddhi {
	/** Whether the decisions table has been initialized. */
	private initialized = false;

	/** Lazily-prepared statements keyed by SQL string. */
	private stmtCache = new Map<string, PreparedStmt>();

	/**
	 * Ensure the decisions table exists. Idempotent — only runs once per
	 * Buddhi instance lifetime.
	 */
	private ensureSchema(db: DatabaseManager): void {
		if (this.initialized) return;
		const agentDb = db.get("agent");
		agentDb.exec(DECISIONS_DDL);
		this.initialized = true;
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/**
	 * Record a decision with full Nyaya reasoning.
	 *
	 * Generates a deterministic FNV-1a ID from the description + timestamp,
	 * validates the reasoning and category, persists to SQLite, and returns
	 * the complete Decision object.
	 *
	 * @param params - Decision parameters (see RecordDecisionParams).
	 * @param db     - DatabaseManager for SQLite access.
	 * @returns The persisted Decision with generated id and timestamp.
	 */
	recordDecision(params: RecordDecisionParams, db: DatabaseManager): Decision {
		this.ensureSchema(db);

		// Validate category
		if (!VALID_CATEGORIES.has(params.category)) {
			throw new Error(`Invalid decision category: ${params.category}`);
		}

		// Validate confidence range
		if (params.confidence < 0 || params.confidence > 1) {
			throw new Error(`Confidence must be in [0, 1], got: ${params.confidence}`);
		}

		// Validate Nyaya reasoning completeness
		this.validateNyayaReasoning(params.reasoning);

		const timestamp = Date.now();
		const id = `bud-${fnv1a(params.description + timestamp)}`;

		const decision: Decision = {
			id,
			timestamp,
			sessionId: params.sessionId,
			project: params.project,
			category: params.category,
			description: params.description,
			reasoning: params.reasoning,
			confidence: params.confidence,
			alternatives: params.alternatives ?? [],
			metadata: params.metadata ?? {},
		};

		// Persist to SQLite
		const agentDb = db.get("agent");
		this.prep(agentDb, `
			INSERT INTO decisions
				(id, session_id, project, category, description,
				 reasoning_json, confidence, alternatives_json,
				 outcome_json, metadata_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			decision.id,
			decision.sessionId,
			decision.project,
			decision.category,
			decision.description,
			JSON.stringify(decision.reasoning),
			decision.confidence,
			JSON.stringify(decision.alternatives),
			null, // no outcome yet
			JSON.stringify(decision.metadata),
			decision.timestamp,
		);

		return decision;
	}

	/**
	 * Record the outcome of a previously-made decision.
	 *
	 * @param decisionId - The decision's ID (from recordDecision).
	 * @param outcome    - The outcome to record.
	 * @param db         - DatabaseManager for SQLite access.
	 * @throws Error if the decision ID does not exist.
	 */
	recordOutcome(
		decisionId: string,
		outcome: DecisionOutcome,
		db: DatabaseManager,
	): void {
		this.ensureSchema(db);
		const agentDb = db.get("agent");

		// Verify the decision exists
		const existing = this.prep(agentDb, `
			SELECT id FROM decisions WHERE id = ?
		`).get(decisionId) as { id: string } | undefined;

		if (!existing) {
			throw new Error(`Decision not found: ${decisionId}`);
		}

		this.prep(agentDb, `
			UPDATE decisions SET outcome_json = ? WHERE id = ?
		`).run(JSON.stringify(outcome), decisionId);
	}

	/**
	 * Load a decision by its ID.
	 *
	 * @param id - The decision ID.
	 * @param db - DatabaseManager for SQLite access.
	 * @returns The Decision, or null if not found.
	 */
	getDecision(id: string, db: DatabaseManager): Decision | null {
		this.ensureSchema(db);
		const agentDb = db.get("agent");

		const row = this.prep(agentDb, `
			SELECT * FROM decisions WHERE id = ?
		`).get(id) as DecisionRow | undefined;

		if (!row) return null;
		return this.rowToDecision(row);
	}

	/**
	 * List decisions with optional filtering.
	 *
	 * Supports filtering by project, category, and date range. Results are
	 * ordered by creation time (newest first), limited to 100 by default.
	 *
	 * @param opts - Filter options.
	 * @param db   - DatabaseManager for SQLite access.
	 * @returns Array of matching decisions.
	 */
	listDecisions(opts: ListDecisionsOptions, db: DatabaseManager): Decision[] {
		this.ensureSchema(db);
		const agentDb = db.get("agent");

		const conditions: string[] = [];
		const params: unknown[] = [];

		if (opts.project) {
			conditions.push("project = ?");
			params.push(opts.project);
		}
		if (opts.category) {
			conditions.push("category = ?");
			params.push(opts.category);
		}
		if (opts.fromDate != null) {
			conditions.push("created_at >= ?");
			params.push(opts.fromDate);
		}
		if (opts.toDate != null) {
			conditions.push("created_at <= ?");
			params.push(opts.toDate);
		}

		const where = conditions.length > 0
			? `WHERE ${conditions.join(" AND ")}`
			: "";

		const limit = opts.limit ?? 100;
		params.push(limit);

		const sql = `
			SELECT * FROM decisions
			${where}
			ORDER BY created_at DESC
			LIMIT ?
		`;

		const rows = this.prep(agentDb, sql).all(...params) as DecisionRow[];
		return rows.map(r => this.rowToDecision(r));
	}

	/**
	 * Generate a human-readable explanation of a decision using the
	 * Nyaya syllogism format.
	 *
	 * Output format:
	 * ```
	 * Decision: <description>
	 * Category: <category> | Confidence: <confidence>%
	 *
	 * --- Nyaya Reasoning (Panchavayava) ---
	 * 1. Pratijña (Thesis):     <thesis>
	 * 2. Hetu (Reason):         <reason>
	 * 3. Udaharana (Example):   <example>
	 * 4. Upanaya (Application): <application>
	 * 5. Nigamana (Conclusion): <conclusion>
	 *
	 * Alternatives considered: <n>
	 * - <alt1>: <reason rejected>
	 * ...
	 *
	 * Outcome: <success/failure/pending>
	 * ```
	 *
	 * @param id - The decision ID.
	 * @param db - DatabaseManager for SQLite access.
	 * @returns Human-readable explanation string, or null if not found.
	 */
	explainDecision(id: string, db: DatabaseManager): string | null {
		const decision = this.getDecision(id, db);
		if (!decision) return null;

		const r = decision.reasoning;
		const parts: string[] = [];

		parts.push(`Decision: ${decision.description}`);
		parts.push(`Category: ${decision.category} | Confidence: ${Math.round(decision.confidence * 100)}%`);
		parts.push("");
		parts.push("--- Nyaya Reasoning (Panchavayava) ---");
		parts.push(`1. Pratijña (Thesis):     ${r.thesis}`);
		parts.push(`2. Hetu (Reason):         ${r.reason}`);
		parts.push(`3. Udaharana (Example):   ${r.example}`);
		parts.push(`4. Upanaya (Application): ${r.application}`);
		parts.push(`5. Nigamana (Conclusion): ${r.conclusion}`);

		if (decision.alternatives.length > 0) {
			parts.push("");
			parts.push(`Alternatives considered: ${decision.alternatives.length}`);
			for (const alt of decision.alternatives) {
				parts.push(`  - ${alt.description}: ${alt.reason_rejected}`);
			}
		}

		parts.push("");
		if (decision.outcome) {
			const status = decision.outcome.success ? "Success" : "Failure";
			parts.push(`Outcome: ${status}`);
			if (decision.outcome.feedback) {
				parts.push(`Feedback: ${decision.outcome.feedback}`);
			}
		} else {
			parts.push("Outcome: Pending");
		}

		return parts.join("\n");
	}

	/**
	 * Analyze recurring decision patterns for a project.
	 *
	 * Groups decisions by category, computes average confidence and success
	 * rate, and returns patterns sorted by frequency (most common first).
	 *
	 * @param project - Project path to analyze.
	 * @param db      - DatabaseManager for SQLite access.
	 * @returns Array of DecisionPattern sorted by count descending.
	 */
	getDecisionPatterns(project: string, db: DatabaseManager): DecisionPattern[] {
		this.ensureSchema(db);
		const agentDb = db.get("agent");

		// Get category stats
		const statsRows = this.prep(agentDb, `
			SELECT
				category,
				COUNT(*) as count,
				AVG(confidence) as avg_confidence,
				description as representative
			FROM decisions
			WHERE project = ?
			GROUP BY category
			ORDER BY count DESC
		`).all(project) as CategoryStatsRow[];

		// For each category, compute success rate from outcomes
		const patterns: DecisionPattern[] = [];

		for (const row of statsRows) {
			const outcomeRows = this.prep(agentDb, `
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
	 * Get the success rate for a specific decision category across all
	 * projects.
	 *
	 * Only considers decisions that have recorded outcomes.
	 *
	 * @param category - The decision category.
	 * @param db       - DatabaseManager for SQLite access.
	 * @returns Success rate [0, 1], or 0 if no outcomes recorded.
	 */
	getSuccessRate(category: DecisionCategory, db: DatabaseManager): number {
		this.ensureSchema(db);
		const agentDb = db.get("agent");

		const rows = this.prep(agentDb, `
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

	/**
	 * Clear the prepared statement cache. Call when the database connection
	 * changes or during testing.
	 */
	clearCache(): void {
		this.stmtCache.clear();
		this.initialized = false;
	}

	// ─── Internal: Validation ───────────────────────────────────────────

	/**
	 * Validate that all five steps of the Nyaya reasoning are present
	 * and non-empty.
	 */
	private validateNyayaReasoning(r: NyayaReasoning): void {
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

	// ─── Internal: Row Conversion ───────────────────────────────────────

	/**
	 * Convert a SQLite row to a Decision object.
	 */
	private rowToDecision(row: DecisionRow): Decision {
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

	// ─── Internal: Statement Cache ──────────────────────────────────────

	/**
	 * Get or create a prepared statement. Keyed by the SQL string itself.
	 * better-sqlite3 also caches internally, but this avoids crossing the
	 * JS<->native boundary on every call.
	 */
	private prep(
		db: ReturnType<DatabaseManager["get"]>,
		sql: string,
	): PreparedStmt {
		let stmt = this.stmtCache.get(sql);
		if (!stmt) {
			stmt = db.prepare(sql) as unknown as PreparedStmt;
			this.stmtCache.set(sql, stmt);
		}
		return stmt;
	}
}
