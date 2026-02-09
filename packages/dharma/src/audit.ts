/**
 * @chitragupta/dharma — Audit logging.
 * Persistent, queryable audit trail of all policy evaluations.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { AuditEntry, PolicyAction, PolicyVerdict } from "./types.js";

// ─── Audit Query Filters ────────────────────────────────────────────────────

export interface AuditQueryFilters {
	/** Start of time range (inclusive). */
	startTime?: number;
	/** End of time range (inclusive). */
	endTime?: number;
	/** Filter by agent ID. */
	agentId?: string;
	/** Filter by session ID. */
	sessionId?: string;
	/** Filter by action type. */
	actionType?: PolicyAction["type"];
	/** Filter by final decision. */
	decision?: AuditEntry["finalDecision"];
}

// ─── Audit Logger ───────────────────────────────────────────────────────────

/**
 * AuditLogger writes policy evaluation results to an append-only JSONL file.
 * Supports querying with multiple filters, session summarization, and
 * report export in JSON or Markdown format.
 *
 * @example
 * ```ts
 * const logger = new AuditLogger();
 * logger.write(entry);
 * const denied = logger.query({ decision: "deny" });
 * const report = logger.exportReport("markdown");
 * ```
 */
export class AuditLogger {
	private readonly auditDir: string;
	private readonly auditPath: string;

	/**
	 * Create a new AuditLogger.
	 *
	 * @param auditDir - Directory to store audit logs. Defaults to `~/.chitragupta/audit`.
	 */
	constructor(auditDir?: string) {
		this.auditDir = auditDir ?? path.join(getChitraguptaHome(), "audit");
		this.auditPath = path.join(this.auditDir, "audit.jsonl");
	}

	// ─── Writing ────────────────────────────────────────────────────────────

	/**
	 * Append a single audit entry to the JSONL log file.
	 * Creates the audit directory if it does not exist.
	 *
	 * @param entry - The audit entry to write.
	 */
	write(entry: AuditEntry): void {
		fs.mkdirSync(this.auditDir, { recursive: true });
		const line = JSON.stringify(entry) + "\n";
		fs.appendFileSync(this.auditPath, line, "utf-8");
	}

	/**
	 * Write multiple audit entries at once. No-ops on empty arrays.
	 *
	 * @param entries - Array of audit entries to append.
	 */
	writeBatch(entries: AuditEntry[]): void {
		if (entries.length === 0) return;
		fs.mkdirSync(this.auditDir, { recursive: true });
		const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
		fs.appendFileSync(this.auditPath, lines, "utf-8");
	}

	// ─── Reading ────────────────────────────────────────────────────────────

	/** Read all audit entries from the log file. */
	private readAll(): AuditEntry[] {
		if (!fs.existsSync(this.auditPath)) {
			return [];
		}

		const content = fs.readFileSync(this.auditPath, "utf-8");
		const entries: AuditEntry[] = [];

		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				entries.push(JSON.parse(trimmed) as AuditEntry);
			} catch {
				// Skip malformed lines
			}
		}

		return entries;
	}

	// ─── Querying ───────────────────────────────────────────────────────────

	/**
	 * Query audit entries with optional filters for time range, agent, session,
	 * action type, and decision.
	 *
	 * @param filters - Optional filter criteria. All filters are AND-combined.
	 * @returns Array of matching audit entries.
	 */
	query(filters: AuditQueryFilters = {}): AuditEntry[] {
		let entries = this.readAll();

		if (filters.startTime !== undefined) {
			entries = entries.filter((e) => e.timestamp >= filters.startTime!);
		}
		if (filters.endTime !== undefined) {
			entries = entries.filter((e) => e.timestamp <= filters.endTime!);
		}
		if (filters.agentId !== undefined) {
			entries = entries.filter((e) => e.agentId === filters.agentId);
		}
		if (filters.sessionId !== undefined) {
			entries = entries.filter((e) => e.sessionId === filters.sessionId);
		}
		if (filters.actionType !== undefined) {
			entries = entries.filter((e) => e.action.type === filters.actionType);
		}
		if (filters.decision !== undefined) {
			entries = entries.filter((e) => e.finalDecision === filters.decision);
		}

		return entries;
	}

	// ─── Summary ────────────────────────────────────────────────────────────

	/**
	 * Generate a human-readable summary of all policy evaluations in a session.
	 * Includes aggregate statistics, action type breakdown, and denied action details.
	 *
	 * @param sessionId - The session ID to summarize.
	 * @returns Multi-line summary string.
	 */
	summary(sessionId: string): string {
		const entries = this.query({ sessionId });

		if (entries.length === 0) {
			return `No audit entries found for session "${sessionId}".`;
		}

		// Aggregate stats
		let allowed = 0;
		let denied = 0;
		let warned = 0;
		const ruleHits: Map<string, number> = new Map();
		const actionTypes: Map<string, number> = new Map();

		for (const entry of entries) {
			if (entry.finalDecision === "allow") allowed++;
			else if (entry.finalDecision === "deny") denied++;
			else if (entry.finalDecision === "warn") warned++;

			actionTypes.set(entry.action.type, (actionTypes.get(entry.action.type) ?? 0) + 1);

			for (const verdict of entry.verdicts) {
				if (verdict.status === "deny" || verdict.status === "warn") {
					ruleHits.set(verdict.ruleId, (ruleHits.get(verdict.ruleId) ?? 0) + 1);
				}
			}
		}

		const lines: string[] = [
			`Audit Summary for Session: ${sessionId}`,
			"=".repeat(50),
			"",
			`Total evaluations: ${entries.length}`,
			`  Allowed: ${allowed}`,
			`  Denied:  ${denied}`,
			`  Warned:  ${warned}`,
			"",
			"Actions by type:",
		];

		for (const [type, count] of [...actionTypes.entries()].sort((a, b) => b[1] - a[1])) {
			lines.push(`  ${type}: ${count}`);
		}

		if (ruleHits.size > 0) {
			lines.push("");
			lines.push("Rules triggered (deny/warn):");
			for (const [ruleId, count] of [...ruleHits.entries()].sort((a, b) => b[1] - a[1])) {
				lines.push(`  ${ruleId}: ${count} times`);
			}
		}

		if (denied > 0) {
			lines.push("");
			lines.push("Denied actions:");
			for (const entry of entries.filter((e) => e.finalDecision === "deny")) {
				const denyVerdicts = entry.verdicts.filter((v) => v.status === "deny");
				const reasons = denyVerdicts.map((v) => v.reason).join("; ");
				lines.push(`  [${new Date(entry.timestamp).toISOString()}] ${entry.action.type}: ${reasons}`);
			}
		}

		const startTime = entries[0].timestamp;
		const endTime = entries[entries.length - 1].timestamp;
		lines.push("");
		lines.push(`Time range: ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`);

		return lines.join("\n");
	}

	// ─── Export ─────────────────────────────────────────────────────────────

	/**
	 * Export audit report in JSON or Markdown format.
	 *
	 * @param format - Output format: "json" for raw JSON array, "markdown" for structured report.
	 * @param filters - Optional query filters to limit the entries included.
	 * @returns Formatted report string.
	 */
	exportReport(format: "json" | "markdown", filters: AuditQueryFilters = {}): string {
		const entries = this.query(filters);

		if (format === "json") {
			return JSON.stringify(entries, null, "\t");
		}

		// Markdown format
		const lines: string[] = [
			"# Audit Report",
			"",
			`Generated: ${new Date().toISOString()}`,
			`Total entries: ${entries.length}`,
			"",
			"## Summary",
			"",
		];

		const allowed = entries.filter((e) => e.finalDecision === "allow").length;
		const denied = entries.filter((e) => e.finalDecision === "deny").length;
		const warned = entries.filter((e) => e.finalDecision === "warn").length;

		lines.push(`| Decision | Count |`);
		lines.push(`|----------|-------|`);
		lines.push(`| Allow    | ${allowed} |`);
		lines.push(`| Deny     | ${denied} |`);
		lines.push(`| Warn     | ${warned} |`);
		lines.push("");

		if (denied > 0) {
			lines.push("## Denied Actions");
			lines.push("");

			for (const entry of entries.filter((e) => e.finalDecision === "deny")) {
				lines.push(`### ${new Date(entry.timestamp).toISOString()}`);
				lines.push("");
				lines.push(`- **Agent:** ${entry.agentId}`);
				lines.push(`- **Action:** ${entry.action.type}`);
				if (entry.action.tool) lines.push(`- **Tool:** ${entry.action.tool}`);
				if (entry.action.filePath) lines.push(`- **File:** ${entry.action.filePath}`);
				if (entry.action.command) lines.push(`- **Command:** \`${entry.action.command}\``);
				lines.push("");

				const denyVerdicts = entry.verdicts.filter((v) => v.status === "deny");
				for (const v of denyVerdicts) {
					lines.push(`> **${v.ruleId}:** ${v.reason}`);
					if (v.suggestion) {
						lines.push(`> *Suggestion:* ${v.suggestion}`);
					}
				}
				lines.push("");
			}
		}

		if (warned > 0) {
			lines.push("## Warnings");
			lines.push("");

			for (const entry of entries.filter((e) => e.finalDecision === "warn")) {
				const warnVerdicts = entry.verdicts.filter((v) => v.status === "warn");
				for (const v of warnVerdicts) {
					lines.push(`- **${v.ruleId}** (${entry.action.type}): ${v.reason}`);
				}
			}
			lines.push("");
		}

		return lines.join("\n");
	}
}
