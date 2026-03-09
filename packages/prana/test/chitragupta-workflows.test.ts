import { describe, expect, it } from "vitest";
import { validateDAG } from "../src/dag.js";
import type { Workflow } from "../src/types.js";
import {
	AUTORESEARCH_WORKFLOW,
	ACP_RESEARCH_SWARM_WORKFLOW,
	CHITRAGUPTA_WORKFLOWS,
	getChitraguptaWorkflow,
	listChitraguptaWorkflows,
} from "../src/chitragupta-workflows.js";

function assertValidWorkflow(workflow: Workflow): void {
	expect(workflow.id).toBeTruthy();
	expect(workflow.name).toBeTruthy();
	expect(workflow.description).toBeTruthy();
	expect(workflow.version).toBe("1.0.0");
	expect(workflow.steps.length).toBeGreaterThan(0);
	const validation = validateDAG(workflow.steps);
	expect(validation.valid).toBe(true);
	expect(validation.errors).toEqual([]);
}

describe("chitragupta research workflows", () => {
	it("registers the new workflow templates", () => {
		expect(Object.keys(CHITRAGUPTA_WORKFLOWS)).toEqual([
			"consolidation",
			"self-report",
			"learning",
			"guardian-sweep",
			"full-cycle",
			"autoresearch",
			"acp-research-swarm",
		]);
	});

	it("lists seven engine workflows including research templates", () => {
		const workflows = listChitraguptaWorkflows();
		expect(workflows).toHaveLength(7);
		expect(workflows.map((workflow) => workflow.id)).toContain("autoresearch");
		expect(workflows.map((workflow) => workflow.id)).toContain("acp-research-swarm");
	});

	it("returns the autoresearch workflow by id", () => {
		expect(getChitraguptaWorkflow("autoresearch")).toBe(AUTORESEARCH_WORKFLOW);
		expect(getChitraguptaWorkflow("acp-research-swarm")).toBe(
			ACP_RESEARCH_SWARM_WORKFLOW,
		);
	});

	it("builds a valid autoresearch workflow", () => {
		assertValidWorkflow(AUTORESEARCH_WORKFLOW);
		expect(AUTORESEARCH_WORKFLOW.steps.map((step) => step.id)).toEqual([
			"autoresearch-scope",
			"acp-research-council",
			"autoresearch-baseline",
			"autoresearch-run",
			"autoresearch-evaluate",
			"pakt-pack-research-context",
			"autoresearch-record",
		]);
		expect(AUTORESEARCH_WORKFLOW.context).toEqual(
			expect.objectContaining({
				researchCommand: "uv",
				researchArgs: ["run", "train.py"],
				researchTargetFiles: ["train.py"],
				researchImmutableFiles: ["prepare.py"],
				researchMetricName: "val_bpb",
				researchObjective: "minimize",
				researchBudgetMs: 300_000,
			}),
		);
	});

	it("builds a valid acp research swarm workflow", () => {
		assertValidWorkflow(ACP_RESEARCH_SWARM_WORKFLOW);
		expect(ACP_RESEARCH_SWARM_WORKFLOW.steps.map((step) => step.id)).toEqual([
			"autoresearch-scope",
			"acp-research-council",
			"pakt-pack-research-context",
			"autoresearch-record",
		]);
	});
});
