/**
 * MCP Tools — Introspection & Self-Report.
 *
 * Tool factories for Vasana (behavioral tendencies), Triguna (health),
 * Atman (self-report), and the exported {@link formatOrchestratorResult}
 * utility used by the coding agent tool and tests.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { getVasana, getTriguna, getChetana, getSoulManager } from "./mcp-subsystems.js";

// ─── Vasana Tendencies ──────────────────────────────────────────────────────

/** Create the `vasana_tendencies` tool — crystallized behavioral tendencies. */
export function createVasanaTendenciesTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "vasana_tendencies",
			description:
				"Get crystallized behavioral tendencies (vasanas). Vasanas are stable " +
				"behavioral patterns detected via Bayesian Online Change-Point Detection, " +
				"validated by holdout prediction, and ranked by strength.",
			inputSchema: {
				type: "object",
				properties: {
					limit: { type: "number", description: "Maximum tendencies to return. Default: 20." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

			try {
				const vasana = await getVasana();
				const tendencies = vasana.getVasanas(projectPath, limit);

				if (tendencies.length === 0) {
					return { content: [{ type: "text", text: "No crystallized vasanas found. Tendencies emerge after repeated behavioral patterns are detected." }] };
				}

				const formatted = tendencies.map((v, i) =>
					`[${i + 1}] ${v.tendency} (${v.valence})\n` +
					`  Strength: ${v.strength.toFixed(3)} | Stability: ${v.stability.toFixed(3)} | Accuracy: ${v.predictiveAccuracy.toFixed(3)}\n` +
					`  Reinforcements: ${v.reinforcementCount}\n` +
					`  ${v.description}`,
				).join("\n\n");

				return { content: [{ type: "text", text: `Vasanas (${tendencies.length}):\n\n${formatted}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `vasana_tendencies failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Health Status ──────────────────────────────────────────────────────────

/** Map trend direction to an arrow indicator. */
export function trendArrow(direction: string): string {
	if (direction === "rising") return "[rising]";
	if (direction === "falling") return "[falling]";
	return "[stable]";
}

/** Create the `health_status` tool — Triguna system health. */
export function createHealthStatusTool(): McpToolHandler {
	return {
		definition: {
			name: "health_status",
			description:
				"Get the Triguna system health status. Tracks three fundamental qualities " +
				"on the 2-simplex: Sattva (harmony/clarity), Rajas (activity/restlessness), " +
				"Tamas (inertia/degradation). Uses a Simplex-Constrained Kalman Filter with " +
				"Isometric Log-Ratio (ILR) coordinates.",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const triguna = await getTriguna();
				const state = triguna.getState();
				const dominant = triguna.getDominant();
				const trend = triguna.getTrend();
				const history = triguna.getHistory(5);

				const alerts: string[] = [];
				if (state.sattva > 0.7) alerts.push("System healthy — clarity and balance prevail");
				if (state.rajas > 0.5) alerts.push("System hyperactive — consider reducing parallelism");
				if (state.tamas > 0.4) alerts.push("System degraded — suggest recovery actions");

				const historyLines = history.map((h) =>
					`  ${new Date(h.timestamp).toISOString()}: S=${h.state.sattva.toFixed(3)} R=${h.state.rajas.toFixed(3)} T=${h.state.tamas.toFixed(3)} (${h.dominant})`,
				).join("\n");

				const text = [
					`Triguna Health Status`,
					``,
					`Current State:`,
					`  Sattva (harmony):    ${state.sattva.toFixed(4)} ${trendArrow(trend.sattva)}`,
					`  Rajas (activity):    ${state.rajas.toFixed(4)} ${trendArrow(trend.rajas)}`,
					`  Tamas (inertia):     ${state.tamas.toFixed(4)} ${trendArrow(trend.tamas)}`,
					``,
					`Dominant Guna: ${dominant}`,
					``,
					alerts.length > 0 ? `Alerts:\n${alerts.map((a) => `  - ${a}`).join("\n")}` : "Alerts: none",
					``,
					`Recent History:`,
					historyLines || "  (no history yet)",
				].join("\n");

				return { content: [{ type: "text", text }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `health_status failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Atman Report ───────────────────────────────────────────────────────────

/**
 * Create the `atman_report` tool — comprehensive self-report.
 *
 * Assembles data from ChetanaController (consciousness), SoulManager
 * (identity), and Triguna (health) into a single report.
 */
export function createAtmanReportTool(): McpToolHandler {
	return {
		definition: {
			name: "atman_report",
			description:
				"Get a comprehensive self-report (Atman report) covering the agent's " +
				"consciousness state, identity, tool mastery, behavioral tendencies, " +
				"active intentions, and health status. Combines data from Chetana " +
				"(consciousness), Soul (identity), and Triguna (health).",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const sections: string[] = [];

				// ── Consciousness (Chetana) ─────────────────────────
				try {
					const chetana = await getChetana();
					const report = chetana.getCognitiveReport();
					sections.push("## Consciousness (Chetana)", "");
					sections.push("### Affect (Bhava)");
					sections.push(`  Valence:     ${report.affect.valence.toFixed(3)}`);
					sections.push(`  Arousal:     ${report.affect.arousal.toFixed(3)}`);
					sections.push(`  Confidence:  ${report.affect.confidence.toFixed(3)}`);
					sections.push(`  Frustration: ${report.affect.frustration.toFixed(3)}`);

					if (report.topConcepts.length > 0) {
						sections.push("", "### Attention (Dhyana) — Top Concepts");
						for (const c of report.topConcepts.slice(0, 5)) sections.push(`  - ${c.concept}: ${c.weight.toFixed(3)}`);
					}
					if (report.topTools.length > 0) {
						sections.push("", "### Tool Attention");
						for (const t of report.topTools.slice(0, 5)) sections.push(`  - ${t.tool}: ${t.weight.toFixed(3)}`);
					}

					sections.push("", "### Self-Model (Atma-Darshana)");
					sections.push(`  Calibration:       ${report.selfSummary.calibration.toFixed(3)}`);
					sections.push(`  Learning Velocity: ${report.selfSummary.learningVelocity.toFixed(3)}`);
					if (report.selfSummary.topTools.length > 0) {
						sections.push("  Top Tool Mastery:");
						for (const t of report.selfSummary.topTools.slice(0, 5)) {
							sections.push(`    - ${t.tool}: ${t.mastery.successRate.toFixed(3)} success rate`);
						}
					}
					if (report.selfSummary.limitations.length > 0) {
						sections.push(`  Known Limitations: ${report.selfSummary.limitations.join(", ")}`);
					}
					if (report.intentions.length > 0) {
						sections.push("", `### Active Intentions (Sankalpa): ${report.intentions.length}`);
					}
				} catch {
					sections.push("## Consciousness (Chetana): not available");
				}

				// ── Health (Triguna) ────────────────────────────────
				try {
					const triguna = await getTriguna();
					const state = triguna.getState();
					const dominant = triguna.getDominant();
					sections.push("", "## Health (Triguna)");
					sections.push(`  Sattva: ${state.sattva.toFixed(4)} | Rajas: ${state.rajas.toFixed(4)} | Tamas: ${state.tamas.toFixed(4)}`);
					sections.push(`  Dominant: ${dominant}`);
				} catch {
					sections.push("", "## Health (Triguna): not available");
				}

				// ── Identity (Atman/Soul) ──────────────────────────
				try {
					const soulMgr = await getSoulManager();
					const souls = soulMgr.getAll();
					if (souls.length > 0) {
						sections.push("", "## Identity (Atman)");
						for (const soul of souls.slice(0, 3)) {
							sections.push(`  Agent: ${soul.name} (${soul.archetype.name})`);
							sections.push(`  Purpose: ${soul.purpose}`);
							sections.push(`  Traits: ${[...soul.archetype.traits, ...soul.learnedTraits].join(", ")}`);
							sections.push(`  Strengths: ${soul.archetype.strengths.join(", ")}`);
							if (soul.values.length > 0) sections.push(`  Values: ${soul.values.join(", ")}`);
							const confident = [...soul.confidenceModel.entries()]
								.filter(([, v]) => v > 0.7)
								.map(([k]) => k);
							if (confident.length > 0) sections.push(`  High confidence in: ${confident.join(", ")}`);
							sections.push("");
						}
					} else {
						sections.push("", "## Identity (Atman): no souls registered");
					}
				} catch {
					sections.push("", "## Identity (Atman): not available");
				}

				return { content: [{ type: "text", text: `# Atman Report\n\n${sections.join("\n")}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `atman_report failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Orchestrator Result Formatter ──────────────────────────────────────────

/**
 * Format an OrchestratorResult into a readable text summary.
 * Exported for testing and reuse by the coding agent tool.
 */
export function formatOrchestratorResult(result: {
	success: boolean;
	plan: { task: string; steps: { index: number; description: string; completed: boolean }[]; complexity: string } | null;
	codingResults: { filesModified: string[]; filesCreated: string[] }[];
	git: { featureBranch: string | null; commits: string[] };
	reviewIssues: { severity: string; file: string; line?: number; message: string }[];
	validationPassed: boolean;
	filesModified: string[];
	filesCreated: string[];
	summary: string;
	elapsedMs: number;
	diffPreview?: string;
	phaseTimings?: Array<{ phase: string; startMs: number; endMs: number; durationMs: number }>;
	diffStats?: { filesChanged: number; insertions: number; deletions: number };
	errors?: Array<{ phase: string; message: string; recoverable: boolean }>;
	stats?: {
		totalCost: number; currency: string;
		inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number;
		toolCalls: Record<string, number>; totalToolCalls: number; turns: number;
	};
}): string {
	const lines: string[] = [];
	const complexity = result.plan?.complexity ?? "unknown";

	lines.push("═══ Coding Agent ═══════════════════════");
	lines.push(`Task: ${result.plan?.task ?? "(unknown)"}`);
	lines.push(`Mode: ${result.plan ? "planned" : "direct"} | Complexity: ${complexity}`);
	lines.push(`Status: ${result.success ? "✓" : "✗"} ${result.success ? "Success" : "Failed"}`);

	if (result.plan && result.plan.steps.length > 0) {
		lines.push("", "── Plan ──");
		for (const step of result.plan.steps) {
			lines.push(`${step.index}. [${step.completed ? "✓" : "○"}] ${step.description}`);
		}
	}

	if (result.filesModified.length > 0 || result.filesCreated.length > 0) {
		lines.push("", "── Files ──");
		if (result.filesModified.length > 0) lines.push(`Modified: ${result.filesModified.join(", ")}`);
		if (result.filesCreated.length > 0) lines.push(`Created: ${result.filesCreated.join(", ")}`);
	}

	if (result.git.featureBranch || result.git.commits.length > 0) {
		lines.push("", "── Git ──");
		if (result.git.featureBranch) lines.push(`Branch: ${result.git.featureBranch}`);
		if (result.git.commits.length > 0) lines.push(`Commits: ${result.git.commits.join(", ")}`);
	}

	lines.push("", "── Validation ──");
	lines.push(`Result: ${result.validationPassed ? "✓ passed" : "✗ failed"}`);

	lines.push("", "── Review ──");
	if (result.reviewIssues.length > 0) {
		lines.push(`${result.reviewIssues.length} issue(s) found`);
		for (const issue of result.reviewIssues.slice(0, 10)) {
			lines.push(`  ${issue.severity} ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
		}
	} else {
		lines.push("0 issues found");
	}

	if (result.diffPreview) {
		lines.push("", "── Diff Preview ──");
		const diffLines = result.diffPreview.split("\n");
		if (diffLines.length > 60) {
			lines.push(...diffLines.slice(0, 60));
			lines.push(`... (${diffLines.length - 60} more lines)`);
		} else {
			lines.push(...diffLines);
		}
	}

	if (result.stats && (result.stats.totalToolCalls > 0 || result.stats.totalCost > 0)) {
		lines.push("", "── Usage ──");
		if (result.stats.totalToolCalls > 0) {
			const sorted = Object.entries(result.stats.toolCalls).sort((a, b) => b[1] - a[1]);
			for (const [name, count] of sorted) {
				lines.push(`  ${name}: ${count} calls (${((count / result.stats.totalToolCalls) * 100).toFixed(1)}%)`);
			}
			lines.push(`  Total: ${result.stats.totalToolCalls} calls | ${result.stats.turns} turns`);
		}
		if (result.stats.totalCost > 0) lines.push(`  Cost: $${result.stats.totalCost.toFixed(4)} ${result.stats.currency}`);
	}

	if (result.phaseTimings && result.phaseTimings.length > 0) {
		lines.push("", "── Timing ──");
		for (const pt of result.phaseTimings) {
			const dur = pt.durationMs < 1000 ? `${pt.durationMs}ms` : `${(pt.durationMs / 1000).toFixed(1)}s`;
			lines.push(`  ${pt.phase}: ${dur}`);
		}
	}
	if (result.diffStats) {
		lines.push(`  Diff: +${result.diffStats.insertions}/-${result.diffStats.deletions} in ${result.diffStats.filesChanged} file(s)`);
	}

	if (result.errors && result.errors.length > 0) {
		lines.push("", "── Errors ──");
		for (const err of result.errors) {
			lines.push(`  [${err.phase}] ${err.message}${err.recoverable ? " (recovered)" : ""}`);
		}
	}

	lines.push("", `⏱ ${(result.elapsedMs / 1000).toFixed(1)}s`);
	return lines.join("\n");
}
