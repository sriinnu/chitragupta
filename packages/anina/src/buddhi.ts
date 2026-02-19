/**
 * @chitragupta/anina — Buddhi — बुद्धि — Intellect / Decision Framework.
 *
 * Structured decision logging using the classical Indian Nyaya syllogism
 * framework (Panchavayava — five-limbed reasoning). Decisions are persisted
 * to SQLite via better-sqlite3 with lazy caching. Analysis methods surface
 * recurring patterns and category success rates.
 *
 * @packageDocumentation
 */

import type { DatabaseManager } from "@chitragupta/smriti";
import {
	fnv1a, DECISIONS_DDL, VALID_CATEGORIES,
	validateNyayaReasoning, rowToDecision, formatDecisionExplanation,
	queryDecisionPatterns, queryCategorySuccessRate,
	type PreparedStmt, type DecisionRow,
} from "./buddhi-analysis.js";

// Re-export analysis utilities for consumers
export {
	fnv1a, validateNyayaReasoning, rowToDecision,
	formatDecisionExplanation, queryDecisionPatterns, queryCategorySuccessRate,
} from "./buddhi-analysis.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Five-step Nyaya syllogism (Panchavayava).
 *
 * The classical Indian logic framework for formal reasoning:
 *   1. Pratijña — Thesis   2. Hetu — Reason   3. Udaharana — Example
 *   4. Upanaya — Application   5. Nigamana — Conclusion
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
	| "architecture" | "tool-selection" | "model-routing"
	| "error-recovery" | "refactoring" | "security";

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
	id: string;
	timestamp: number;
	sessionId: string;
	project: string;
	category: DecisionCategory;
	description: string;
	reasoning: NyayaReasoning;
	confidence: number;
	alternatives: Alternative[];
	outcome?: DecisionOutcome;
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
	representative: string;
}

// ─── Buddhi ─────────────────────────────────────────────────────────────────

/**
 * Buddhi — the intellect, the discerning faculty.
 *
 * Records, retrieves, and analyzes agent decisions using the Nyaya syllogism
 * framework. All operations are synchronous (better-sqlite3). Decisions are
 * persisted to the `decisions` table in agent.db.
 */
export class Buddhi {
	private initialized = false;
	private stmtCache = new Map<string, PreparedStmt>();

	/** Ensure the decisions table exists. Idempotent. */
	private ensureSchema(db: DatabaseManager): void {
		if (this.initialized) return;
		db.get("agent").exec(DECISIONS_DDL);
		this.initialized = true;
	}

	/**
	 * Record a decision with full Nyaya reasoning.
	 * Generates a deterministic FNV-1a ID, validates, persists, and returns the Decision.
	 */
	recordDecision(params: RecordDecisionParams, db: DatabaseManager): Decision {
		this.ensureSchema(db);
		if (!VALID_CATEGORIES.has(params.category)) {
			throw new Error(`Invalid decision category: ${params.category}`);
		}
		if (params.confidence < 0 || params.confidence > 1) {
			throw new Error(`Confidence must be in [0, 1], got: ${params.confidence}`);
		}
		validateNyayaReasoning(params.reasoning);

		const timestamp = Date.now();
		const id = `bud-${fnv1a(params.description + timestamp)}`;
		const decision: Decision = {
			id, timestamp,
			sessionId: params.sessionId,
			project: params.project,
			category: params.category,
			description: params.description,
			reasoning: params.reasoning,
			confidence: params.confidence,
			alternatives: params.alternatives ?? [],
			metadata: params.metadata ?? {},
		};

		const agentDb = db.get("agent");
		this.prep(agentDb, `
			INSERT INTO decisions
				(id, session_id, project, category, description,
				 reasoning_json, confidence, alternatives_json,
				 outcome_json, metadata_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			decision.id, decision.sessionId, decision.project,
			decision.category, decision.description,
			JSON.stringify(decision.reasoning), decision.confidence,
			JSON.stringify(decision.alternatives), null,
			JSON.stringify(decision.metadata), decision.timestamp,
		);
		return decision;
	}

	/** Record the outcome of a previously-made decision. Throws if ID not found. */
	recordOutcome(decisionId: string, outcome: DecisionOutcome, db: DatabaseManager): void {
		this.ensureSchema(db);
		const agentDb = db.get("agent");
		const existing = this.prep(agentDb, `SELECT id FROM decisions WHERE id = ?`)
			.get(decisionId) as { id: string } | undefined;
		if (!existing) throw new Error(`Decision not found: ${decisionId}`);
		this.prep(agentDb, `UPDATE decisions SET outcome_json = ? WHERE id = ?`)
			.run(JSON.stringify(outcome), decisionId);
	}

	/** Load a decision by its ID. Returns null if not found. */
	getDecision(id: string, db: DatabaseManager): Decision | null {
		this.ensureSchema(db);
		const row = this.prep(db.get("agent"), `SELECT * FROM decisions WHERE id = ?`)
			.get(id) as DecisionRow | undefined;
		return row ? rowToDecision(row) : null;
	}

	/** List decisions with optional filtering by project, category, date range. */
	listDecisions(opts: ListDecisionsOptions, db: DatabaseManager): Decision[] {
		this.ensureSchema(db);
		const conditions: string[] = [];
		const params: unknown[] = [];
		if (opts.project) { conditions.push("project = ?"); params.push(opts.project); }
		if (opts.category) { conditions.push("category = ?"); params.push(opts.category); }
		if (opts.fromDate != null) { conditions.push("created_at >= ?"); params.push(opts.fromDate); }
		if (opts.toDate != null) { conditions.push("created_at <= ?"); params.push(opts.toDate); }
		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		params.push(opts.limit ?? 100);
		const sql = `SELECT * FROM decisions ${where} ORDER BY created_at DESC LIMIT ?`;
		const rows = this.prep(db.get("agent"), sql).all(...params) as DecisionRow[];
		return rows.map(r => rowToDecision(r));
	}

	/** Generate a human-readable Nyaya syllogism explanation. Returns null if not found. */
	explainDecision(id: string, db: DatabaseManager): string | null {
		const decision = this.getDecision(id, db);
		return decision ? formatDecisionExplanation(decision) : null;
	}

	/** Analyze recurring decision patterns for a project. */
	getDecisionPatterns(project: string, db: DatabaseManager): DecisionPattern[] {
		this.ensureSchema(db);
		return queryDecisionPatterns(project, db.get("agent"), this.prep.bind(this));
	}

	/** Get success rate for a decision category across all projects. */
	getSuccessRate(category: DecisionCategory, db: DatabaseManager): number {
		this.ensureSchema(db);
		return queryCategorySuccessRate(category, db.get("agent"), this.prep.bind(this));
	}

	/** Clear the prepared statement cache. */
	clearCache(): void {
		this.stmtCache.clear();
		this.initialized = false;
	}

	/** Get or create a prepared statement (keyed by SQL string). */
	private prep(db: ReturnType<DatabaseManager["get"]>, sql: string): PreparedStmt {
		let stmt = this.stmtCache.get(sql);
		if (!stmt) {
			stmt = db.prepare(sql) as unknown as PreparedStmt;
			this.stmtCache.set(sql, stmt);
		}
		return stmt;
	}
}
