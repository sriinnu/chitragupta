/**
 * @chitragupta/prana — Pre-built Chitragupta workflow DAG templates.
 */

import type { Workflow } from "./types.js";
export {
	CONSOLIDATION_WORKFLOW,
	SELF_REPORT_WORKFLOW,
	LEARNING_WORKFLOW,
	GUARDIAN_SWEEP_WORKFLOW,
	FULL_CYCLE_WORKFLOW,
} from "./chitragupta-workflows-lifecycle.js";
export {
	AUTORESEARCH_WORKFLOW,
	AUTORESEARCH_OVERNIGHT_WORKFLOW,
	ACP_RESEARCH_SWARM_WORKFLOW,
} from "./chitragupta-workflows-research.js";
import {
	ACP_RESEARCH_SWARM_WORKFLOW,
	AUTORESEARCH_WORKFLOW,
	AUTORESEARCH_OVERNIGHT_WORKFLOW,
} from "./chitragupta-workflows-research.js";
import {
	CONSOLIDATION_WORKFLOW,
	FULL_CYCLE_WORKFLOW,
	GUARDIAN_SWEEP_WORKFLOW,
	LEARNING_WORKFLOW,
	SELF_REPORT_WORKFLOW,
} from "./chitragupta-workflows-lifecycle.js";

export const CHITRAGUPTA_WORKFLOWS: Record<string, Workflow> = {
	consolidation: CONSOLIDATION_WORKFLOW,
	"self-report": SELF_REPORT_WORKFLOW,
	learning: LEARNING_WORKFLOW,
	"guardian-sweep": GUARDIAN_SWEEP_WORKFLOW,
	"full-cycle": FULL_CYCLE_WORKFLOW,
	autoresearch: AUTORESEARCH_WORKFLOW,
	"autoresearch-overnight": AUTORESEARCH_OVERNIGHT_WORKFLOW,
	"acp-research-swarm": ACP_RESEARCH_SWARM_WORKFLOW,
};

export function getChitraguptaWorkflow(name: string): Workflow | undefined {
	return CHITRAGUPTA_WORKFLOWS[name];
}

export function listChitraguptaWorkflows(): Array<{
	id: string;
	name: string;
	description: string;
	stepCount: number;
}> {
	return Object.values(CHITRAGUPTA_WORKFLOWS).map((workflow) => ({
		id: workflow.id,
		name: workflow.name,
		description: workflow.description,
		stepCount: workflow.steps.length,
	}));
}
