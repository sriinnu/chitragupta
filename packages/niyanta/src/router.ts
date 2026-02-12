/**
 * Intelligent task routing — evaluates RoutingRules against tasks to find
 * the best agent slot for each task.
 */

import type {
	AgentSlot,
	OrchestratorTask,
	RoutingMatcher,
	RoutingRule,
} from "./types.js";

/**
 * Compute Jaccard similarity coefficient between two string arrays.
 *
 * Comparison is case-insensitive. Returns 0 if both arrays are empty
 * (no capabilities = no match for routing purposes).
 *
 * @param a - First string array.
 * @param b - Second string array.
 * @returns A value between 0 (no overlap) and 1 (identical sets).
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	const setA = new Set(a.map((s) => s.toLowerCase()));
	const setB = new Set(b.map((s) => s.toLowerCase()));
	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) intersection++;
	}
	const union = new Set([...setA, ...setB]).size;
	return union === 0 ? 0 : intersection / union;
}

/**
 * Simple fuzzy keyword match — checks if any keyword appears as a substring
 * within the text (case-insensitive).
 */
function fuzzyKeywordMatch(text: string, keywords: string[]): boolean {
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Evaluate a single routing matcher against a task.
 */
function evaluateMatcher(
	matcher: RoutingMatcher,
	task: OrchestratorTask,
	slots: Map<string, AgentSlot>,
): boolean {
	switch (matcher.type) {
		case "keyword":
			return fuzzyKeywordMatch(task.description, matcher.keywords);

		case "pattern": {
			const regex = new RegExp(matcher.regex, "i");
			return regex.test(task.description);
		}

		case "capability": {
			// Find the target slot and check if it has all required capabilities
			// This is evaluated per-slot, so we check against all slots
			for (const slot of slots.values()) {
				const similarity = jaccardSimilarity(matcher.required, slot.capabilities);
				if (similarity > 0.3) return true;
			}
			return false;
		}

		case "file_type": {
			// Check if the task context mentions files with matching extensions
			const desc = task.description.toLowerCase();
			const ctx = task.context ? JSON.stringify(task.context).toLowerCase() : "";
			const combined = desc + " " + ctx;
			return matcher.extensions.some((ext) => combined.includes(ext.toLowerCase()));
		}

		case "always":
			return true;

		case "expression": {
			// Simple expression evaluation: check if the expression evaluates truthy
			// Supports: task.type == "review", task.priority == "critical"
			try {
				const expr = matcher.expr;
				// Support simple equality checks: field == "value"
				const eqMatch = expr.match(/^task\.(\w+)\s*==\s*"([^"]*)"$/);
				if (eqMatch) {
					const field = eqMatch[1] as keyof OrchestratorTask;
					const value = eqMatch[2];
					return String(task[field]) === value;
				}
				// Support "contains" check: task.description contains "keyword"
				const containsMatch = expr.match(/^task\.(\w+)\s+contains\s+"([^"]*)"$/);
				if (containsMatch) {
					const field = containsMatch[1] as keyof OrchestratorTask;
					const value = containsMatch[2];
					return String(task[field]).toLowerCase().includes(value.toLowerCase());
				}
				return false;
			} catch {
				return false;
			}
		}
	}
}

/**
 * TaskRouter -- routes tasks to agent slots based on configured rules.
 *
 * Rules are evaluated in priority order (highest first). The first matching
 * rule determines the target slot. If no rule matches, falls back to
 * round-robin assignment. Includes a route cache keyed by task type and
 * description to avoid redundant evaluation.
 *
 * @example
 * ```ts
 * const router = new TaskRouter(rules, slots);
 * const slotId = router.route(task);
 * ```
 */
export class TaskRouter {
	private readonly rules: RoutingRule[];
	private readonly slots: Map<string, AgentSlot>;
	private readonly cache = new Map<string, string>();
	private roundRobinIndex = 0;
	private readonly slotIds: string[];

	constructor(rules: RoutingRule[], slots: AgentSlot[]) {
		// Sort rules by priority descending (highest first)
		this.rules = [...rules].sort((a, b) => b.priority - a.priority);
		this.slots = new Map(slots.map((s) => [s.id, s]));
		this.slotIds = slots.map((s) => s.id);
	}

	/**
	 * Route a task to the best matching agent slot.
	 *
	 * @param task - The task to route.
	 * @returns The target slot ID.
	 */
	route(task: OrchestratorTask): string {
		// Check cache first — keyed by task type + description hash
		const cacheKey = this.buildCacheKey(task);
		const cached = this.cache.get(cacheKey);
		if (cached !== undefined && this.slots.has(cached)) {
			return cached;
		}

		// Evaluate rules in priority order
		for (const rule of this.rules) {
			if (evaluateMatcher(rule.match, task, this.slots)) {
				if (this.slots.has(rule.target)) {
					this.cache.set(cacheKey, rule.target);
					return rule.target;
				}
			}
		}

		// Fallback: round-robin across all slots
		const slotId = this.fallbackRoundRobin();
		this.cache.set(cacheKey, slotId);
		return slotId;
	}

	/**
	 * Route with optional task transformation (applies the rule's transform
	 * function if present).
	 *
	 * @param task - The task to route and optionally transform.
	 * @returns An object with `slotId` and the (possibly transformed) `task`.
	 */
	routeAndTransform(task: OrchestratorTask): { slotId: string; task: OrchestratorTask } {
		for (const rule of this.rules) {
			if (evaluateMatcher(rule.match, task, this.slots)) {
				if (this.slots.has(rule.target)) {
					const transformed = rule.transform ? rule.transform(task) : task;
					return { slotId: rule.target, task: transformed };
				}
			}
		}

		return { slotId: this.fallbackRoundRobin(), task };
	}

	/**
	 * Clear the route cache.
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics.
	 */
	getCacheSize(): number {
		return this.cache.size;
	}

	private buildCacheKey(task: OrchestratorTask): string {
		// Use type + first 100 chars of description as cache key
		return `${task.type}:${task.description.slice(0, 100)}`;
	}

	private fallbackRoundRobin(): string {
		if (this.slotIds.length === 0) {
			throw new Error("No agent slots available for routing");
		}
		const slotId = this.slotIds[this.roundRobinIndex % this.slotIds.length];
		this.roundRobinIndex++;
		return slotId;
	}
}
