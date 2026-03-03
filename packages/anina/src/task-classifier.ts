/**
 * @chitragupta/anina -- Task Classifier for Conditional Context Loading.
 *
 * Classifies user prompts into task types using fast keyword/pattern matching.
 * No LLM call required -- pure heuristics, guaranteed < 1ms.
 *
 * Based on ArXiv 2602.11988 finding that dumping full context into every
 * prompt REDUCES success rates by ~8% and adds ~20% inference cost.
 * The fix: classify the task, load only the relevant context sections.
 *
 * @packageDocumentation
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The 10 canonical task types for context routing.
 * Each maps to a distinct subset of context sections that are relevant.
 */
export type TaskType =
	| "code-write"     // writing new code, implementing features
	| "code-fix"       // debugging, fixing bugs, resolving errors
	| "code-refactor"  // refactoring, restructuring existing code
	| "code-review"    // reviewing code, auditing, analyzing quality
	| "test"           // writing or running tests, test infrastructure
	| "config"         // configuration, setup, tooling, infra tasks
	| "research"       // exploring, understanding, explaining code
	| "git"            // git operations: commit, push, PR, merge, branch
	| "memory"         // memory/context operations, recall, persistence
	| "general";       // default catch-all for unclassified input

/** Result of task classification with confidence metadata. */
export interface TaskClassification {
	/** The classified task type. */
	type: TaskType;
	/** Confidence score [0, 1]. Higher = more certain. */
	confidence: number;
	/** Keywords that triggered the classification. */
	matchedKeywords: string[];
	/** Wall-clock classification time in ms. Should be < 1ms. */
	durationMs: number;
}

// ── Pattern Definitions ──────────────────────────────────────────────────────

/**
 * A single classification pattern: regex + associated task type + base weight.
 * Patterns are tested in order; the task type with the highest cumulative
 * score wins.
 */
interface ClassifierPattern {
	/** Regex to test against the lowercased input. */
	pattern: RegExp;
	/** Task type this pattern votes for. */
	taskType: TaskType;
	/** Base weight for this pattern match [0, 1]. */
	weight: number;
}

/**
 * All classification patterns, ordered by specificity (most specific first).
 * Each pattern is tested independently; scores accumulate per task type.
 */
const CLASSIFIER_PATTERNS: readonly ClassifierPattern[] = [
	// ── Git operations ──────────────────────────────────────────────
	{ pattern: /\b(commit|push|pull|merge|rebase|cherry[- ]?pick)\b/i, taskType: "git", weight: 0.9 },
	{ pattern: /\b(git\s+(log|status|diff|branch|checkout|stash|reset|tag))\b/i, taskType: "git", weight: 0.95 },
	{ pattern: /\b(pull\s+request|PR|create\s+pr|open\s+pr)\b/i, taskType: "git", weight: 0.9 },
	{ pattern: /\bgit\b/i, taskType: "git", weight: 0.6 },
	{ pattern: /\b(branch|merge\s+conflict|revert)\b/i, taskType: "git", weight: 0.7 },

	// ── Test tasks ──────────────────────────────────────────────────
	{ pattern: /\b(write|add|create)\s+(a\s+)?(unit\s+)?tests?\b/i, taskType: "test", weight: 0.95 },
	{ pattern: /\b(test\s+(suite|coverage|file|case|runner|plan))\b/i, taskType: "test", weight: 0.9 },
	{ pattern: /\b(vitest|jest|mocha|pytest|run\s+tests?)\b/i, taskType: "test", weight: 0.85 },
	{ pattern: /\b(describe|it\s*\(|expect\s*\(|assert)\b/i, taskType: "test", weight: 0.7 },
	{ pattern: /\b(test\s+this|add\s+tests?|spec\s+file)\b/i, taskType: "test", weight: 0.8 },
	{ pattern: /\.test\.(ts|js|tsx|jsx)\b/i, taskType: "test", weight: 0.75 },

	// ── Code fix / debugging ────────────────────────────────────────
	{ pattern: /\b(fix|debug|bug|error|issue|broken|crash(?:ing|ed)?|fail(?:ing|ed)?|exception)\b/i, taskType: "code-fix", weight: 0.8 },
	{ pattern: /\b(not\s+working|doesn'?t\s+work|wrong\s+output|unexpected)\b/i, taskType: "code-fix", weight: 0.85 },
	{ pattern: /\b(stack\s*trace|traceback|segfault|panic|abort)\b/i, taskType: "code-fix", weight: 0.9 },
	{ pattern: /\b(type\s*error|syntax\s*error|reference\s*error|runtime\s*error)\b/i, taskType: "code-fix", weight: 0.9 },
	{ pattern: /\b(investigate|diagnose|troubleshoot|root\s+cause)\b/i, taskType: "code-fix", weight: 0.75 },

	// ── Code refactoring ────────────────────────────────────────────
	{ pattern: /\b(refactor|restructure|reorganize|clean\s*up|simplify)\b/i, taskType: "code-refactor", weight: 0.9 },
	{ pattern: /\b(extract\s+(function|method|class|module|component))\b/i, taskType: "code-refactor", weight: 0.95 },
	{ pattern: /\b(rename|move\s+to|split\s+into|consolidate)\b/i, taskType: "code-refactor", weight: 0.7 },
	{ pattern: /\b(reduce\s+(complexity|duplication|coupling))\b/i, taskType: "code-refactor", weight: 0.85 },
	{ pattern: /\b(dry\s+up|dead\s+code|tech\s*debt)\b/i, taskType: "code-refactor", weight: 0.8 },

	// ── Code review ─────────────────────────────────────────────────
	{ pattern: /\b(review|audit|inspect|check\s+quality)\b/i, taskType: "code-review", weight: 0.8 },
	{ pattern: /\b(code\s+review|security\s+audit|vulnerability)\b/i, taskType: "code-review", weight: 0.9 },
	{ pattern: /\b(best\s+practices?|anti[- ]?patterns?|code\s+smell|smell)\b/i, taskType: "code-review", weight: 0.7 },
	{ pattern: /\b(review\s+(this|my|the)\s+(code|pr|change|diff))\b/i, taskType: "code-review", weight: 0.95 },

	// ── Code writing ────────────────────────────────────────────────
	{ pattern: /\b(implement|create|build|write|add|make)\s+(a\s+)?(new\s+)?(function|class|module|component|api|endpoint|feature)\b/i, taskType: "code-write", weight: 0.9 },
	{ pattern: /\b(implement|create|build|generate|scaffold)\b/i, taskType: "code-write", weight: 0.6 },
	{ pattern: /\b(write\s+(code|a\s+script|a\s+function|a\s+class))\b/i, taskType: "code-write", weight: 0.9 },
	{ pattern: /\b(add\s+a\s+(new\s+)?(field|column|property|method))\b/i, taskType: "code-write", weight: 0.8 },
	{ pattern: /\b(wire\s+up|hook\s+into|integrate\s+with)\b/i, taskType: "code-write", weight: 0.7 },

	// ── Configuration / setup ───────────────────────────────────────
	{ pattern: /\b(config|configure|setup|set\s*up|install|deploy)\b/i, taskType: "config", weight: 0.8 },
	{ pattern: /\b(tsconfig|eslint|prettier|webpack|vite|docker|ci[/-]?cd)\b/i, taskType: "config", weight: 0.85 },
	{ pattern: /\b(package\.json|\.env|yaml|toml|ini)\b/i, taskType: "config", weight: 0.7 },
	{ pattern: /\b(npm|pnpm|yarn|pip|cargo)\s+(install|add|remove|update)\b/i, taskType: "config", weight: 0.8 },
	{ pattern: /\b(environment|infra|pipeline|workflow|github\s+actions?)\b/i, taskType: "config", weight: 0.65 },

	// ── Research / exploration ───────────────────────────────────────
	{ pattern: /\b(explain|how\s+does|what\s+is|what\s+are|why\s+does)\b/i, taskType: "research", weight: 0.8 },
	{ pattern: /\b(understand|explore|investigate|analyze|walk\s+through)\b/i, taskType: "research", weight: 0.7 },
	{ pattern: /\b(architecture|design|pattern|overview|flow|diagram)\b/i, taskType: "research", weight: 0.65 },
	{ pattern: /\b(show\s+me|find\s+where|where\s+is|look\s+at)\b/i, taskType: "research", weight: 0.6 },
	{ pattern: /\b(search\s+(for|the)|grep|find\s+all)\b/i, taskType: "research", weight: 0.6 },

	// ── Memory / context operations ─────────────────────────────────
	{ pattern: /\b(remember|recall|what\s+did\s+(we|i)|last\s+session)\b/i, taskType: "memory", weight: 0.9 },
	{ pattern: /\b(memory|context|session\s+history|past\s+decisions?)\b/i, taskType: "memory", weight: 0.8 },
	{ pattern: /\b(save|store|persist|record)\s+(this|that|the)\b/i, taskType: "memory", weight: 0.7 },
	{ pattern: /\b(handover|continuity|checkpoint)\b/i, taskType: "memory", weight: 0.75 },
] as const;

// ── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a user prompt into one of the 10 canonical task types.
 *
 * Uses cumulative keyword/pattern scoring -- no LLM call, guaranteed < 1ms.
 * Each pattern that matches contributes its weight to the corresponding
 * task type. The type with the highest cumulative score wins.
 *
 * @param input - Raw user prompt text.
 * @returns Classification result with type, confidence, matched keywords, and timing.
 *
 * @example
 * ```ts
 * const result = classifyTask("fix the TypeError in auth.ts");
 * // result.type === "code-fix"
 * // result.confidence >= 0.8
 * ```
 */
export function classifyTask(input: string): TaskClassification {
	const start = performance.now();

	if (!input || input.trim().length === 0) {
		return {
			type: "general",
			confidence: 0,
			matchedKeywords: [],
			durationMs: performance.now() - start,
		};
	}

	const scores = new Map<TaskType, number>();
	const keywordsByType = new Map<TaskType, string[]>();

	// Initialize all types
	const allTypes: TaskType[] = [
		"code-write", "code-fix", "code-refactor", "code-review",
		"test", "config", "research", "git", "memory", "general",
	];
	for (const t of allTypes) {
		scores.set(t, 0);
		keywordsByType.set(t, []);
	}

	// Score each pattern
	for (const { pattern, taskType, weight } of CLASSIFIER_PATTERNS) {
		const match = pattern.exec(input);
		if (match) {
			const current = scores.get(taskType) ?? 0;
			scores.set(taskType, current + weight);
			const keywords = keywordsByType.get(taskType) ?? [];
			keywords.push(match[0].toLowerCase());
			keywordsByType.set(taskType, keywords);
		}
	}

	// Find the winning type
	let bestType: TaskType = "general";
	let bestScore = 0;

	for (const [taskType, score] of scores) {
		if (score > bestScore) {
			bestScore = score;
			bestType = taskType;
		}
	}

	// Normalize confidence to [0, 1]
	// A single strong match (0.9) gives ~0.9 confidence.
	// Multiple matches can exceed 1.0 raw, so we cap at 1.0.
	const confidence = Math.min(1.0, bestScore / 1.0);

	// Deduplicate matched keywords
	const rawKeywords = keywordsByType.get(bestType) ?? [];
	const uniqueKeywords = [...new Set(rawKeywords)];

	const durationMs = performance.now() - start;

	return {
		type: bestType,
		confidence: Math.round(confidence * 100) / 100,
		matchedKeywords: uniqueKeywords,
		durationMs,
	};
}

/**
 * Check if a task type is code-related (write, fix, refactor, review, test).
 * Useful for deciding whether to include code standards in context.
 *
 * @param taskType - The task type to check.
 * @returns True if the task type involves code manipulation.
 */
export function isCodeTask(taskType: TaskType): boolean {
	return (
		taskType === "code-write" ||
		taskType === "code-fix" ||
		taskType === "code-refactor" ||
		taskType === "code-review" ||
		taskType === "test"
	);
}

/**
 * Get all defined task types as an array.
 * Useful for iteration and validation.
 */
export const ALL_TASK_TYPES: readonly TaskType[] = [
	"code-write", "code-fix", "code-refactor", "code-review",
	"test", "config", "research", "git", "memory", "general",
] as const;
