/**
 * @chitragupta/dharma — Rta (ऋत) Invariant Layer.
 *
 * Rta defines invariant rules that CANNOT be violated under any circumstances.
 * They are checked BEFORE Dharma PolicyEngine rules. If Rta blocks an action,
 * the PolicyEngine is never consulted.
 */

// Re-export types and rules for public API
export type { RtaContext, RtaVerdict, RtaRule, RtaAuditEntry, RtaDatabaseLike } from "./rta-types.js";
export {
	noCredentialLeak,
	noDestructiveOverwrite,
	noUnboundedRecursion,
	noCostExplosion,
	noDataExfiltration,
	RTA_RULES,
} from "./rta-rules.js";

import type { RtaContext, RtaVerdict, RtaRule, RtaAuditEntry, RtaDatabaseLike } from "./rta-types.js";
import { RTA_RULES } from "./rta-rules.js";
import { MAX_AUDIT_LOG_SIZE } from "./rta-types.js";

// ─── RtaEngine ───────────────────────────────────────────────────────────────

/**
 * The RtaEngine evaluates invariant rules that cannot be violated.
 * It runs BEFORE the PolicyEngine — if Rta blocks, Dharma is never consulted.
 *
 * @example
 * ```ts
 * const rta = new RtaEngine();
 * const verdict = rta.check(context);
 * if (!verdict.allowed) {
 *   // Hard block — do not proceed to PolicyEngine
 *   console.error(`Rta violation: ${verdict.reason}`);
 * }
 * ```
 */
export class RtaEngine {
	private readonly rules: Map<string, RtaRule> = new Map();
	private readonly auditLog: RtaAuditEntry[] = [];

	constructor() {
		// Register all core invariant rules
		for (const rule of RTA_RULES) {
			this.rules.set(rule.id, rule);
		}
	}

	// ─── Rule Management ──────────────────────────────────────────────────

	/**
	 * Add a custom invariant rule. If a rule with the same ID already exists,
	 * it is replaced.
	 */
	addRule(rule: RtaRule): void {
		this.rules.set(rule.id, rule);
	}

	/** Remove a rule by its ID. */
	removeRule(id: string): void {
		this.rules.delete(id);
	}

	/** List all registered rules. */
	getRules(): RtaRule[] {
		return [...this.rules.values()];
	}

	// ─── Checking ─────────────────────────────────────────────────────────

	/**
	 * Check all rules. Returns the first violation found, or an allow verdict
	 * if all rules pass. Short-circuits on first violation.
	 */
	check(context: RtaContext): RtaVerdict {
		for (const rule of this.rules.values()) {
			const verdict = rule.check(context);
			this.recordAudit(verdict, context);
			if (!verdict.allowed) {
				return verdict;
			}
		}

		return { allowed: true, ruleId: "rta:all-passed" };
	}

	/**
	 * Check all rules without short-circuiting. Returns every verdict,
	 * including allows and denials. Useful for comprehensive reporting.
	 */
	checkAll(context: RtaContext): RtaVerdict[] {
		const verdicts: RtaVerdict[] = [];

		for (const rule of this.rules.values()) {
			const verdict = rule.check(context);
			this.recordAudit(verdict, context);
			verdicts.push(verdict);
		}

		return verdicts;
	}

	// ─── Audit Log ────────────────────────────────────────────────────────

	/**
	 * Get recent audit log entries.
	 *
	 * @param limit - Maximum entries to return. Defaults to all entries.
	 */
	getAuditLog(limit?: number): RtaAuditEntry[] {
		if (limit !== undefined && limit > 0) {
			return this.auditLog.slice(-limit);
		}
		return [...this.auditLog];
	}

	/** Clear the in-memory audit log. */
	clearAuditLog(): void {
		this.auditLog.length = 0;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	// ─── Persistence ─────────────────────────────────────────────────────

	/**
	 * Persist the in-memory audit log to SQLite (rta_audit table).
	 * Uses duck-typed database interface to avoid importing smriti.
	 */
	persistAuditLog(db: RtaDatabaseLike): void {
		if (this.auditLog.length === 0) return;

		const stmt = db.prepare(`
			INSERT INTO rta_audit (timestamp, rule_id, allowed, tool_name, reason, session_id)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const insertMany = db.transaction((entries: RtaAuditEntry[]) => {
			for (const entry of entries) {
				stmt.run(
					entry.timestamp,
					entry.ruleId,
					entry.allowed ? 1 : 0,
					entry.toolName,
					entry.reason ?? null,
					entry.sessionId ?? null,
				);
			}
		});

		insertMany(this.auditLog);
		this.auditLog.length = 0;
	}

	/**
	 * Load denied entries from rta_audit for cross-session violation tracking.
	 */
	loadViolationHistory(db: RtaDatabaseLike, limit = 50): RtaAuditEntry[] {
		const rows = db.prepare(`
			SELECT timestamp, rule_id, allowed, tool_name, reason, session_id
			FROM rta_audit
			WHERE allowed = 0
			ORDER BY timestamp DESC
			LIMIT ?
		`).all(limit) as Array<{
			timestamp: number;
			rule_id: string;
			allowed: number;
			tool_name: string;
			reason: string | null;
			session_id: string | null;
		}>;

		return rows.map((r) => ({
			timestamp: r.timestamp,
			ruleId: r.rule_id,
			allowed: false,
			toolName: r.tool_name,
			reason: r.reason ?? undefined,
			sessionId: r.session_id ?? undefined,
		}));
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private recordAudit(verdict: RtaVerdict, context: RtaContext): void {
		// Evict oldest entries if we exceed the cap
		if (this.auditLog.length >= MAX_AUDIT_LOG_SIZE) {
			this.auditLog.splice(0, this.auditLog.length - MAX_AUDIT_LOG_SIZE + 1);
		}

		this.auditLog.push({
			timestamp: Date.now(),
			ruleId: verdict.ruleId,
			allowed: verdict.allowed,
			toolName: context.toolName,
			reason: verdict.reason,
			sessionId: context.sessionId,
		});
	}
}

/**
 * Duck-typed database interface for Rta persistence.
 * Matches the subset of better-sqlite3's Database used by Rta,
 * avoiding a hard dependency on @chitragupta/smriti.
 */
