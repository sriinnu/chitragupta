/**
 * @chitragupta/vayu — Pre-built Chitragupta workflow DAG templates.
 *
 * Sanskrit: Vayu (वायु) = wind/breath — the life-force that flows
 * through all actions, orchestrating them into coherent sequences.
 *
 * These templates encode Chitragupta's core operational pipelines
 * as directed acyclic graphs, enabling deterministic execution
 * with parallelism, dependency tracking, and status visualization.
 */

import type { Workflow } from "./types.js";
import { WorkflowBuilder } from "./builder.js";

// ─── CONSOLIDATION_WORKFLOW ─────────────────────────────────────────────────
//
// Memory consolidation pipeline — the Nidra sleep cycle:
//
//   [Nidra Wake] → [Vasana Scan] → [Svapna Consolidation] → [Akasha Deposit] → [Nidra Sleep]
//                                ↗
//   [Kala Chakra Context] ──────┘
//

export const CONSOLIDATION_WORKFLOW: Workflow = new WorkflowBuilder(
	"consolidation",
	"Memory Consolidation",
)
	.describe(
		"Nidra sleep cycle: wake daemon, scan vasanas, consolidate memory patterns, " +
		"deposit into long-term storage (Akasha), and return to sleep.",
	)
	.setVersion("1.0.0")

	.step("nidra-wake", "Wake Nidra Daemon")
		.tool("chitragupta:nidra-wake", {})
		.tag("lifecycle", "nidra")
		.timeout(5000)
		.done()

	.step("vasana-scan", "Scan Vasana Tendencies")
		.tool("chitragupta:vasana-scan", {})
		.dependsOn("nidra-wake")
		.tag("memory", "vasana")
		.timeout(15000)
		.done()

	.step("kala-chakra-context", "Gather Temporal Context")
		.tool("chitragupta:kala-chakra-context", {})
		.tag("context", "temporal")
		.timeout(5000)
		.done()

	.step("svapna-consolidate", "Svapna Memory Consolidation")
		.tool("chitragupta:svapna-consolidate", {})
		.dependsOn("vasana-scan", "kala-chakra-context")
		.tag("memory", "consolidation")
		.timeout(60000)
		.onFailure("continue")
		.done()

	.step("akasha-deposit", "Deposit to Akasha")
		.tool("chitragupta:akasha-deposit", {})
		.dependsOn("svapna-consolidate")
		.tag("memory", "akasha")
		.timeout(30000)
		.done()

	.step("nidra-sleep", "Return to Sleep")
		.tool("chitragupta:nidra-sleep", {})
		.dependsOn("akasha-deposit")
		.tag("lifecycle", "nidra")
		.timeout(5000)
		.done()

	.build();

// ─── SELF_REPORT_WORKFLOW ───────────────────────────────────────────────────
//
// Atman self-report gathering — parallel collection + merge:
//
//   [Chetana State] ──┐
//   [Triguna Health] ──┤
//   [Vasana Top-N] ───┤→ [Merge Report] → [Format Output]
//   [Skill Stats] ────┤
//   [Memory Stats] ───┘
//

export const SELF_REPORT_WORKFLOW: Workflow = new WorkflowBuilder(
	"self-report",
	"Atman Self-Report",
)
	.describe(
		"Parallel gathering of consciousness state, health metrics, behavioral tendencies, " +
		"skill statistics, and memory metrics, merged into a unified self-report.",
	)
	.setVersion("1.0.0")
	.setConcurrency(5)

	.step("chetana-state", "Gather Chetana State")
		.tool("chitragupta:chetana-state", {})
		.tag("report", "chetana")
		.timeout(10000)
		.onFailure("continue")
		.done()

	.step("triguna-health", "Gather Triguna Health")
		.tool("chitragupta:triguna-health", {})
		.tag("report", "health")
		.timeout(10000)
		.onFailure("continue")
		.done()

	.step("vasana-top-n", "Gather Top Vasanas")
		.tool("chitragupta:vasana-top-n", {})
		.tag("report", "vasana")
		.timeout(10000)
		.onFailure("continue")
		.done()

	.step("skill-stats", "Gather Skill Statistics")
		.tool("chitragupta:skill-stats", {})
		.tag("report", "skills")
		.timeout(10000)
		.onFailure("continue")
		.done()

	.step("memory-stats", "Gather Memory Statistics")
		.tool("chitragupta:memory-stats", {})
		.tag("report", "memory")
		.timeout(10000)
		.onFailure("continue")
		.done()

	.step("merge-report", "Merge Report Sections")
		.tool("chitragupta:merge-report", {})
		.dependsOn("chetana-state", "triguna-health", "vasana-top-n", "skill-stats", "memory-stats")
		.tag("report", "merge")
		.timeout(5000)
		.done()

	.step("format-output", "Format Report Output")
		.tool("chitragupta:format-output", {})
		.dependsOn("merge-report")
		.tag("report", "output")
		.timeout(5000)
		.done()

	.build();

// ─── LEARNING_WORKFLOW ──────────────────────────────────────────────────────
//
// Shiksha skill learning pipeline — sequential discovery → build → scan:
//
//   [Vimarsh Analyze] → [Praptya Source] → [Nirmana Build] → [Suraksha Scan] → [Register Skill]
//

export const LEARNING_WORKFLOW: Workflow = new WorkflowBuilder(
	"learning",
	"Shiksha Skill Learning",
)
	.describe(
		"Autonomous skill learning pipeline: NLU analysis (Vimarsh), cascading source " +
		"discovery (Praptya), skill construction (Nirmana), security scanning (Suraksha), " +
		"and registry enrollment.",
	)
	.setVersion("1.0.0")

	.step("vimarsh-analyze", "Vimarsh NLU Analysis")
		.tool("chitragupta:vimarsh-analyze", {})
		.tag("learning", "nlu")
		.timeout(5000)
		.done()

	.step("praptya-source", "Praptya Source Discovery")
		.tool("chitragupta:praptya-source", {})
		.dependsOn("vimarsh-analyze")
		.tag("learning", "source")
		.timeout(30000)
		.done()

	.step("nirmana-build", "Nirmana Skill Construction")
		.tool("chitragupta:nirmana-build", {})
		.dependsOn("praptya-source")
		.tag("learning", "build")
		.timeout(30000)
		.done()

	.step("suraksha-scan", "Suraksha Security Scan")
		.tool("chitragupta:suraksha-scan", {})
		.dependsOn("nirmana-build")
		.tag("learning", "security")
		.timeout(15000)
		.done()

	.step("register-skill", "Register Approved Skill")
		.tool("chitragupta:register-skill", {})
		.dependsOn("suraksha-scan")
		.tag("learning", "register")
		.timeout(5000)
		.done()

	.build();

// ─── GUARDIAN_SWEEP_WORKFLOW ────────────────────────────────────────────────
//
// Lokapala full guardian sweep — parallel analysis → deliberation → action:
//
//   [Rakshaka Security] ──┐
//   [Gati Performance] ───┤→ [Merge Findings] → [Sabha Deliberation] → [Apply Fixes]
//   [Satya Correctness] ──┘
//

export const GUARDIAN_SWEEP_WORKFLOW: Workflow = new WorkflowBuilder(
	"guardian-sweep",
	"Lokapala Guardian Sweep",
)
	.describe(
		"Full guardian sweep: parallel security (Rakshaka), performance (Gati), and " +
		"correctness (Satya) analysis, followed by Sabha deliberation and fix application.",
	)
	.setVersion("1.0.0")
	.setConcurrency(3)

	.step("rakshaka-security", "Rakshaka Security Analysis")
		.tool("chitragupta:rakshaka-security", {})
		.tag("guardian", "security")
		.timeout(30000)
		.onFailure("continue")
		.done()

	.step("gati-performance", "Gati Performance Analysis")
		.tool("chitragupta:gati-performance", {})
		.tag("guardian", "performance")
		.timeout(30000)
		.onFailure("continue")
		.done()

	.step("satya-correctness", "Satya Correctness Checks")
		.tool("chitragupta:satya-correctness", {})
		.tag("guardian", "correctness")
		.timeout(30000)
		.onFailure("continue")
		.done()

	.step("merge-findings", "Merge Guardian Findings")
		.tool("chitragupta:merge-findings", {})
		.dependsOn("rakshaka-security", "gati-performance", "satya-correctness")
		.tag("guardian", "merge")
		.timeout(5000)
		.done()

	.step("sabha-deliberation", "Sabha Deliberation")
		.tool("chitragupta:sabha-deliberation", {})
		.dependsOn("merge-findings")
		.tag("guardian", "deliberation")
		.timeout(15000)
		.done()

	.step("apply-fixes", "Apply Recommended Fixes")
		.tool("chitragupta:apply-fixes", {})
		.dependsOn("sabha-deliberation")
		.tag("guardian", "action")
		.timeout(60000)
		.onFailure("continue")
		.done()

	.build();

// ─── FULL_CYCLE_WORKFLOW ────────────────────────────────────────────────────
//
// Complete Chitragupta lifecycle — sequential meta-workflow:
//
//   [Self Report] → [Guardian Sweep] → [Consolidation] → [Learning Check] → [Health Report]
//

export const FULL_CYCLE_WORKFLOW: Workflow = new WorkflowBuilder(
	"full-cycle",
	"Complete Chitragupta Lifecycle",
)
	.describe(
		"Full lifecycle cycle: self-assessment, guardian sweep, memory consolidation, " +
		"learning opportunity check, and final health report.",
	)
	.setVersion("1.0.0")

	.step("self-report", "Self-Report Gathering")
		.subworkflow("self-report")
		.tag("cycle", "report")
		.timeout(120000)
		.onFailure("continue")
		.done()

	.step("guardian-sweep", "Guardian Sweep")
		.subworkflow("guardian-sweep")
		.dependsOn("self-report")
		.tag("cycle", "guardian")
		.timeout(180000)
		.onFailure("continue")
		.done()

	.step("consolidation", "Memory Consolidation")
		.subworkflow("consolidation")
		.dependsOn("guardian-sweep")
		.tag("cycle", "consolidation")
		.timeout(120000)
		.onFailure("continue")
		.done()

	.step("learning-check", "Learning Opportunity Check")
		.tool("chitragupta:learning-check", {})
		.dependsOn("consolidation")
		.tag("cycle", "learning")
		.timeout(30000)
		.onFailure("continue")
		.done()

	.step("health-report", "Final Health Report")
		.tool("chitragupta:health-report", {})
		.dependsOn("learning-check")
		.tag("cycle", "health")
		.timeout(10000)
		.done()

	.build();

// ─── Registry ────────────────────────────────────────────────────────────────

/** All Chitragupta workflow templates keyed by workflow ID. */
export const CHITRAGUPTA_WORKFLOWS: Record<string, Workflow> = {
	"consolidation": CONSOLIDATION_WORKFLOW,
	"self-report": SELF_REPORT_WORKFLOW,
	"learning": LEARNING_WORKFLOW,
	"guardian-sweep": GUARDIAN_SWEEP_WORKFLOW,
	"full-cycle": FULL_CYCLE_WORKFLOW,
};

/**
 * Get a Chitragupta workflow by name.
 *
 * @param name - Workflow ID (consolidation, self-report, learning, guardian-sweep, full-cycle).
 * @returns The workflow definition, or undefined if not found.
 */
export function getChitraguptaWorkflow(name: string): Workflow | undefined {
	return CHITRAGUPTA_WORKFLOWS[name];
}

/**
 * List all available Chitragupta workflow templates.
 *
 * @returns Array of { id, name, description, stepCount } summaries.
 */
export function listChitraguptaWorkflows(): Array<{
	id: string;
	name: string;
	description: string;
	stepCount: number;
}> {
	return Object.values(CHITRAGUPTA_WORKFLOWS).map((wf) => ({
		id: wf.id,
		name: wf.name,
		description: wf.description,
		stepCount: wf.steps.length,
	}));
}
