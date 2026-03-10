import type { Workflow } from "./types.js";
import { WorkflowBuilder } from "./builder.js";

export const AUTORESEARCH_WORKFLOW: Workflow = new WorkflowBuilder(
	"autoresearch",
	"Bounded Autoresearch Loop",
)
	.describe(
		"Daemon-first bounded experiment workflow: define a hard research scope, " +
		"convene an ACP/Sabha council, run a time-boxed experiment, evaluate the " +
		"metric delta, compress context with PAKT, and persist the result into Smriti/Akasha.",
	)
	.setVersion("1.0.0")
	.setContext({
		researchTopic: "Bounded train.py improvement loop",
		researchHypothesis: "A bounded modification to train.py can improve validation quality.",
		researchCommand: "uv",
		researchArgs: ["run", "train.py"],
		researchTargetFiles: ["train.py"],
		researchImmutableFiles: ["prepare.py"],
		researchMetricName: "val_bpb",
		researchMetricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
		researchObjective: "minimize",
		researchBudgetMs: 300_000,
	})
	.step("autoresearch-scope", "Define Bounded Research Scope")
		.tool("chitragupta:autoresearch-scope", {})
		.tag("research", "scope")
		.timeout(5000)
		.done()
	.step("acp-research-council", "Convene ACP Research Council")
		.tool("chitragupta:acp-research-council", {})
		.dependsOn("autoresearch-scope")
		.tag("research", "sabha", "acp")
		.timeout(10000)
		.done()
	.step("autoresearch-baseline", "Capture Baseline Metric")
		.tool("chitragupta:autoresearch-baseline", {})
		.dependsOn("autoresearch-scope")
		.tag("research", "baseline")
		.timeout(5000)
		.done()
	.step("autoresearch-run", "Run Bounded Experiment")
		.tool("chitragupta:autoresearch-run", {})
		.dependsOn("acp-research-council", "autoresearch-baseline")
		.tag("research", "experiment")
		.timeout(305000)
		.onFailure("continue")
		.done()
	.step("autoresearch-evaluate", "Evaluate Metric Delta")
		.tool("chitragupta:autoresearch-evaluate", {})
		.dependsOn("autoresearch-baseline", "autoresearch-run")
		.tag("research", "evaluation")
		.timeout(5000)
		.done()
	.step("autoresearch-finalize", "Finalize Experiment State")
		.tool("chitragupta:autoresearch-finalize", {})
		.dependsOn("autoresearch-scope", "autoresearch-run", "autoresearch-evaluate")
		.tag("research", "finalize", "workspace")
		.timeout(5000)
		.done()
	.step("pakt-pack-research-context", "Pack Research Context")
		.tool("chitragupta:pakt-pack-research-context", {})
		.dependsOn("acp-research-council", "autoresearch-run", "autoresearch-evaluate", "autoresearch-finalize")
		.tag("research", "pakt", "compression")
		.timeout(15000)
		.onFailure("continue")
		.done()
	.step("autoresearch-record", "Record Experiment Outcome")
		.tool("chitragupta:autoresearch-record", {})
		.dependsOn("acp-research-council", "autoresearch-run", "autoresearch-evaluate", "autoresearch-finalize", "pakt-pack-research-context")
		.tag("research", "memory", "akasha")
		.timeout(20000)
		.done()
	.build();

export const ACP_RESEARCH_SWARM_WORKFLOW: Workflow = new WorkflowBuilder(
	"acp-research-swarm",
	"ACP Research Swarm",
)
	.describe(
		"Daemon-first peer-council planning workflow using Sutra/Sabha roles to scope a research problem, " +
		"derive a bounded consensus, compress its context, and persist the council output.",
	)
	.setVersion("1.0.0")
	.setContext({
		researchTopic: "ACP peer-council research planning",
		researchHypothesis: "A council of planner/executor/evaluator/skeptic/recorder roles should agree on a bounded research plan before execution.",
		researchTargetFiles: ["train.py"],
		researchImmutableFiles: ["prepare.py"],
		researchMetricName: "val_bpb",
		researchObjective: "minimize",
		researchBudgetMs: 300_000,
	})
	.step("autoresearch-scope", "Define Council Scope")
		.tool("chitragupta:autoresearch-scope", {})
		.tag("research", "scope")
		.timeout(5000)
		.done()
	.step("acp-research-council", "Convene ACP/Sabha Council")
		.tool("chitragupta:acp-research-council", {})
		.dependsOn("autoresearch-scope")
		.tag("research", "sabha", "acp")
		.timeout(10000)
		.done()
	.step("pakt-pack-research-context", "Pack Council Context")
		.tool("chitragupta:pakt-pack-research-context", {})
		.dependsOn("acp-research-council")
		.tag("research", "pakt", "compression")
		.timeout(15000)
		.onFailure("continue")
		.done()
	.step("autoresearch-record", "Persist Council Outcome")
		.tool("chitragupta:autoresearch-record", {})
		.dependsOn("acp-research-council", "pakt-pack-research-context")
		.tag("research", "memory", "akasha")
		.timeout(20000)
		.done()
	.build();
