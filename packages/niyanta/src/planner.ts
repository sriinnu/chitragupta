/**
 * Auto-planning from natural language — decomposes high-level task descriptions
 * into structured sub-tasks and recommends orchestration strategies.
 */

import type {
	AgentSlot,
	CoordinationConfig,
	OrchestrationPlan,
	OrchestratorTask,
	RoutingRule,
	TaskStatus,
} from "./types.js";

// ─── Task Decomposition ──────────────────────────────────────────────────────

/**
 * Decompose a high-level task description into structured sub-tasks.
 *
 * Uses heuristic rules:
 * - "then" splits into sequential steps (with dependencies)
 * - "and" splits into parallel tasks within a step
 * - Task types are inferred from keywords (test, review, refactor, etc.)
 * - Priorities are inferred from urgency keywords (critical, urgent, etc.)
 *
 * @param description - Natural language task description.
 * @returns Array of structured sub-tasks with inferred types, priorities, and dependencies.
 */
export function decompose(description: string): OrchestratorTask[] {
	const tasks: OrchestratorTask[] = [];

	// Split on "then" for sequential steps
	const sequentialParts = description
		.split(/\s+then\s+/i)
		.map((s) => s.trim())
		.filter(Boolean);

	let previousIds: string[] = [];

	for (let seqIdx = 0; seqIdx < sequentialParts.length; seqIdx++) {
		const part = sequentialParts[seqIdx];

		// Split on "and" for parallel tasks within a step
		const parallelParts = part
			.split(/\s+and\s+/i)
			.map((s) => s.trim())
			.filter(Boolean);

		const currentIds: string[] = [];

		for (let parIdx = 0; parIdx < parallelParts.length; parIdx++) {
			const subDesc = parallelParts[parIdx];
			const taskId = `task-${seqIdx}-${parIdx}`;
			currentIds.push(taskId);

			const task: OrchestratorTask = {
				id: taskId,
				type: inferTaskType(subDesc),
				description: subDesc,
				priority: inferPriority(subDesc),
				dependencies: previousIds.length > 0 ? [...previousIds] : undefined,
				status: "pending" as TaskStatus,
			};

			tasks.push(task);
		}

		previousIds = currentIds;
	}

	// If no decomposition happened, wrap the whole thing as one task
	if (tasks.length === 0) {
		tasks.push({
			id: "task-0-0",
			type: inferTaskType(description),
			description,
			priority: inferPriority(description),
			status: "pending",
		});
	}

	return tasks;
}

// ─── Plan Suggestion ─────────────────────────────────────────────────────────

/**
 * Suggest an orchestration plan based on task description and available slots.
 *
 * Strategy selection logic:
 * - Single task with no decomposition -- direct assignment (round-robin)
 * - Independent subtasks -- round-robin or swarm
 * - Sequential subtasks -- chain coordination
 * - Review keywords present -- hierarchical with reviewer
 * - Complex multi-step (>3 subtasks) -- swarm coordination
 *
 * @param taskDescription - Natural language description of the high-level task.
 * @param availableSlots - Array of agent slots available for assignment.
 * @returns A complete orchestration plan with strategy, routing rules, and coordination config.
 */
export function suggestPlan(
	taskDescription: string,
	availableSlots: AgentSlot[],
): OrchestrationPlan {
	const subtasks = decompose(taskDescription);
	const hasSequentialDeps = subtasks.some((t) => t.dependencies && t.dependencies.length > 0);
	const hasReviewKeywords = /\b(review|check|verify|validate|approve)\b/i.test(taskDescription);
	const isComplex = subtasks.length > 3;

	// Determine strategy
	let strategy: OrchestrationPlan["strategy"];
	let coordination: CoordinationConfig;

	if (subtasks.length === 1) {
		// Single task — direct assignment
		strategy = "round-robin";
		coordination = {
			aggregation: "first-wins",
			sharedContext: false,
			tolerateFailures: false,
		};
	} else if (hasReviewKeywords) {
		// Has review step — use hierarchical
		strategy = "hierarchical";
		coordination = {
			aggregation: "chain",
			sharedContext: true,
			tolerateFailures: false,
		};
	} else if (hasSequentialDeps) {
		// Sequential steps — chain
		strategy = "round-robin";
		coordination = {
			aggregation: "chain",
			sharedContext: true,
			tolerateFailures: false,
		};
	} else if (isComplex) {
		// Many independent subtasks — swarm
		strategy = "swarm";
		coordination = {
			aggregation: "merge",
			sharedContext: true,
			tolerateFailures: true,
			maxFailures: Math.ceil(subtasks.length / 2),
		};
	} else {
		// Multiple independent subtasks — round-robin
		strategy = "round-robin";
		coordination = {
			aggregation: "merge",
			sharedContext: false,
			tolerateFailures: true,
		};
	}

	// Build routing rules based on available slots
	const routing = buildRoutingRules(availableSlots);

	return {
		id: `plan-${Date.now()}`,
		name: `Auto-plan: ${taskDescription.slice(0, 50)}${taskDescription.length > 50 ? "..." : ""}`,
		strategy,
		agents: availableSlots,
		routing,
		coordination,
		fallback: {
			escalateToHuman: true,
		},
	};
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Infer task type from description keywords.
 */
function inferTaskType(description: string): OrchestratorTask["type"] {
	const lower = description.toLowerCase();

	if (/\b(test|spec|assert|coverage)\b/.test(lower)) return "test";
	if (/\b(review|check|inspect|audit|approve)\b/.test(lower)) return "review";
	if (/\b(refactor|restructure|clean\s*up|reorganize)\b/.test(lower)) return "refactor";
	if (/\b(analyze|investigate|examine|diagnose|profile)\b/.test(lower)) return "analyze";
	if (/\b(fix|implement|write|create|build|add|update|modify)\b/.test(lower)) return "prompt";

	return "custom";
}

/**
 * Infer priority from urgency keywords in the description.
 */
function inferPriority(description: string): OrchestratorTask["priority"] {
	const lower = description.toLowerCase();

	if (/\b(critical|urgent|emergency|asap|immediately|p0)\b/.test(lower)) return "critical";
	if (/\b(important|high\s*priority|p1|soon)\b/.test(lower)) return "high";
	if (/\b(low\s*priority|nice\s*to\s*have|p3|eventually)\b/.test(lower)) return "low";
	if (/\b(background|whenever|no\s*rush|p4)\b/.test(lower)) return "background";

	return "normal";
}

/**
 * Build routing rules from available agent slots based on their capabilities.
 */
function buildRoutingRules(slots: AgentSlot[]): RoutingRule[] {
	const rules: RoutingRule[] = [];
	let priority = slots.length * 10; // Start high, decrease

	for (const slot of slots) {
		// Create capability-based routing for each slot
		if (slot.capabilities.length > 0) {
			rules.push({
				id: `auto-route-cap-${slot.id}`,
				match: { type: "capability", required: slot.capabilities },
				target: slot.id,
				priority: priority,
			});
			priority -= 10;
		}

		// Create role-based keyword routing
		const roleKeywords = extractRoleKeywords(slot.role);
		if (roleKeywords.length > 0) {
			rules.push({
				id: `auto-route-role-${slot.id}`,
				match: { type: "keyword", keywords: roleKeywords },
				target: slot.id,
				priority: priority,
			});
			priority -= 10;
		}
	}

	// Add a catch-all rule targeting the first slot
	if (slots.length > 0) {
		rules.push({
			id: "auto-route-fallback",
			match: { type: "always" },
			target: slots[0].id,
			priority: 0,
		});
	}

	return rules;
}

/**
 * Extract searchable keywords from an agent role name.
 */
function extractRoleKeywords(role: string): string[] {
	const keywords: string[] = [];
	const lower = role.toLowerCase();

	// Split role by common separators
	const parts = lower.split(/[-_\s]+/);
	keywords.push(...parts);

	// Add synonyms for common roles
	const synonymMap: Record<string, string[]> = {
		"writer": ["write", "implement", "create", "code"],
		"reviewer": ["review", "check", "inspect", "audit"],
		"tester": ["test", "spec", "assert", "verify"],
		"analyzer": ["analyze", "investigate", "diagnose"],
		"planner": ["plan", "design", "architect"],
		"documenter": ["document", "docs", "readme"],
		"fixer": ["fix", "bug", "debug", "patch"],
	};

	for (const part of parts) {
		const synonyms = synonymMap[part];
		if (synonyms) {
			keywords.push(...synonyms);
		}
	}

	return [...new Set(keywords)];
}
