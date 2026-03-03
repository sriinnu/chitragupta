/**
 * AdaptOrch-style Topology Router for Mesh Actors.
 *
 * Based on the AdaptOrch paper (2602.16873): classifies task characteristics
 * and selects the optimal dispatch topology — single, parallel, or
 * hierarchical — based on which system actors are needed and whether
 * sub-tasks are independent.
 *
 * Design principles:
 * - Default to "single" when unclear (paper shows over-parallelization hurts)
 * - Use keyword analysis to detect domain involvement
 * - Detect coordination dependencies for hierarchical routing
 * - Stateless — topology is decided per-task, no session state
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Dispatch topology for a task. */
export type Topology = "single" | "parallel" | "hierarchical";

/** Result of topology classification. */
export interface TopologyDecision {
	/** Selected dispatch topology. */
	topology: Topology;
	/** Human-readable reason for the decision. */
	reason: string;
	/** Actor IDs to involve in this task. */
	actorIds: string[];
	/** Whether sub-tasks can run concurrently. */
	parallelizable: boolean;
	/** Detected domain keywords that drove the decision. */
	detectedDomains: string[];
}

// ─── Domain Keyword Maps ────────────────────────────────────────────────────

/** Keywords that indicate memory domain involvement. */
const MEMORY_KEYWORDS = new Set([
	"memory", "recall", "remember", "search", "lookup", "store",
	"knowledge", "fact", "history", "past", "previous", "context",
	"conversation", "decision", "learned", "stored",
]);

/** Keywords that indicate skills domain involvement. */
const SKILL_KEYWORDS = new Set([
	"skill", "skills", "tool", "tools", "capability", "capabilities",
	"discover", "recommend", "match", "install", "extension",
	"extensions", "plugin", "plugins", "ability", "feature",
]);

/** Keywords that indicate session domain involvement. */
const SESSION_KEYWORDS = new Set([
	"session", "sessions", "handover", "handoff", "resume",
	"turn", "turns", "thread",
]);

/**
 * Keywords that indicate coordination dependencies (output of one
 * domain feeds into another). Triggers hierarchical topology.
 */
const COORDINATION_KEYWORDS = new Set([
	"then", "after", "based on", "using the result", "with the",
	"from the", "and then", "followed by", "next", "depending on",
	"if found", "combine", "merge", "correlate", "cross-reference",
]);

/**
 * Connectors that indicate parallel independent requests
 * (multiple domains needed but no coordination).
 */
const PARALLEL_CONNECTORS = new Set([
	"and", "also", "as well as", "plus", "both", "together with",
	"simultaneously", "at the same time", "in parallel",
]);

// ─── System Actor IDs ───────────────────────────────────────────────────────

/** Known system actor identifiers. */
const SYSTEM_ACTORS = {
	memory: "sys:memory",
	skills: "sys:skills",
	session: "sys:session",
} as const;

// ─── Domain Detection ───────────────────────────────────────────────────────

/**
 * Detect which domains a task involves by scanning for keywords.
 * Returns an array of domain names (memory, skills, session).
 */
export function detectDomains(task: string): string[] {
	const lower = task.toLowerCase();
	const words = lower.split(/\s+/);
	const domains: string[] = [];

	// Check single-word matches
	const hasMemory = words.some((w) => MEMORY_KEYWORDS.has(w));
	const hasSkills = words.some((w) => SKILL_KEYWORDS.has(w));
	const hasSession = words.some((w) => SESSION_KEYWORDS.has(w));

	// Check multi-word phrase matches
	const hasMemoryPhrase = lower.includes("search memory") || lower.includes("find in memory");
	const hasSkillPhrase = lower.includes("find skill") || lower.includes("install skill");
	const hasSessionPhrase = lower.includes("last session") || lower.includes("previous session");

	if (hasMemory || hasMemoryPhrase) domains.push("memory");
	if (hasSkills || hasSkillPhrase) domains.push("skills");
	if (hasSession || hasSessionPhrase) domains.push("session");

	return domains;
}

/**
 * Detect whether the task contains coordination signals that require
 * output-chaining between domains (hierarchical topology).
 */
export function hasCoordinationSignal(task: string): boolean {
	const lower = task.toLowerCase();
	for (const keyword of COORDINATION_KEYWORDS) {
		if (lower.includes(keyword)) return true;
	}
	return false;
}

/**
 * Detect whether the task contains parallel connectors that suggest
 * independent sub-tasks across domains.
 */
export function hasParallelSignal(task: string): boolean {
	const lower = task.toLowerCase();
	for (const connector of PARALLEL_CONNECTORS) {
		if (lower.includes(connector)) return true;
	}
	return false;
}

// ─── Topology Selection ─────────────────────────────────────────────────────

/**
 * Map detected domains to system actor IDs.
 */
function domainsToActors(domains: string[]): string[] {
	const actors: string[] = [];
	for (const domain of domains) {
		const actorId = SYSTEM_ACTORS[domain as keyof typeof SYSTEM_ACTORS];
		if (actorId) actors.push(actorId);
	}
	return actors;
}

/**
 * Filter actors to only those that are actually available.
 */
function filterAvailable(actors: string[], available: string[]): string[] {
	const availableSet = new Set(available);
	return actors.filter((a) => availableSet.has(a));
}

/**
 * Classify a task and decide the optimal dispatch topology.
 *
 * Decision rules (in priority order):
 * 1. No domains detected or single domain -> "single"
 * 2. Multiple domains + coordination keywords -> "hierarchical"
 * 3. Multiple domains + parallel connectors -> "parallel"
 * 4. Multiple domains, no signals -> "single" (conservative default)
 *
 * @param task - Natural language task description
 * @param availableActors - Actor IDs currently registered in the mesh
 * @returns Topology decision with reasoning
 */
export function selectTopology(task: string, availableActors: string[]): TopologyDecision {
	const detectedDomains = detectDomains(task);
	const requestedActors = domainsToActors(detectedDomains);
	const actorIds = filterAvailable(requestedActors, availableActors);

	// No domains detected — default to memory actor for general queries
	if (detectedDomains.length === 0) {
		const defaultActor = availableActors.includes(SYSTEM_ACTORS.memory)
			? [SYSTEM_ACTORS.memory]
			: availableActors.slice(0, 1);
		return {
			topology: "single",
			reason: "No specific domain detected; routing to default actor",
			actorIds: defaultActor,
			parallelizable: false,
			detectedDomains: [],
		};
	}

	// Single domain or only one available actor — single dispatch
	if (actorIds.length <= 1) {
		return {
			topology: "single",
			reason: `Single domain detected: ${detectedDomains.join(", ")}`,
			actorIds,
			parallelizable: false,
			detectedDomains,
		};
	}

	// Multiple domains — check for coordination dependencies
	const needsCoordination = hasCoordinationSignal(task);
	if (needsCoordination) {
		return {
			topology: "hierarchical",
			reason: `Multiple domains (${detectedDomains.join(", ")}) with coordination dependencies`,
			actorIds,
			parallelizable: false,
			detectedDomains,
		};
	}

	// Multiple domains — check for explicit parallel signals
	const canParallelize = hasParallelSignal(task);
	if (canParallelize) {
		return {
			topology: "parallel",
			reason: `Multiple independent domains: ${detectedDomains.join(", ")}`,
			actorIds,
			parallelizable: true,
			detectedDomains,
		};
	}

	// Multiple domains, no clear signal — default to single (conservative)
	// Paper shows over-parallelization hurts; prefer sequential safety
	return {
		topology: "single",
		reason: `Multiple domains detected but no clear parallelization signal; defaulting to sequential`,
		actorIds,
		parallelizable: false,
		detectedDomains,
	};
}
