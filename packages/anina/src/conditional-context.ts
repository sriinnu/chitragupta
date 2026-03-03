/**
 * @chitragupta/anina -- Conditional Context Loading (Integration Module).
 *
 * Top-level entry point that combines task classification with context
 * selection. Given a user prompt and raw context file contents, returns
 * only the context sections relevant to the detected task type.
 *
 * ArXiv 2602.11988 shows that full context loading:
 * - Reduces LLM success rates by ~8%
 * - Adds ~20% inference cost
 * - Causes attention dilution on long instruction files
 *
 * This module solves all three by loading only what matters.
 *
 * @packageDocumentation
 */

import { classifyTask } from "./task-classifier.js";
import type { TaskType, TaskClassification } from "./task-classifier.js";
import { parseContextSections, selectContext, getSelectionSummary } from "./context-selector.js";
import type { ContextSection, ContextSelectionConfig } from "./context-selector.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Configuration for the conditional context builder. */
export interface ConditionalContextConfig {
	/** Token budget for the combined output. Default: 4000. */
	tokenBudget?: number;
	/** Always include priority-0 (critical) sections. Default: true. */
	alwaysIncludeCritical?: boolean;
	/** Override the task classification (skip auto-detection). */
	overrideTaskType?: TaskType;
}

/** Result of conditional context building with metadata. */
export interface ConditionalContextResult {
	/** The filtered context string to inject into the system prompt. */
	context: string;
	/** The detected (or overridden) task type. */
	taskType: TaskType;
	/** Full task classification metadata (null if overridden). */
	classification: TaskClassification | null;
	/** Section IDs that were included. */
	includedSections: string[];
	/** Section IDs that were excluded. */
	excludedSections: string[];
	/** Total estimated tokens in the output. */
	tokenEstimate: number;
	/** Token budget that was applied. */
	tokenBudget: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build conditional context by classifying the user prompt and selecting
 * only the relevant context sections from the raw context files.
 *
 * This is the primary entry point for the conditional context system.
 *
 * @param prompt - The user's input prompt to classify.
 * @param rawContextFiles - Array of raw markdown context file contents.
 * @param config - Optional configuration overrides.
 * @returns Filtered context string with metadata.
 *
 * @example
 * ```ts
 * const result = buildConditionalContext(
 *   "commit and push the changes",
 *   [claudeMdContent, projectMdContent],
 * );
 * // result.taskType === "git"
 * // result.context contains only git-relevant sections
 * ```
 */
export function buildConditionalContext(
	prompt: string,
	rawContextFiles: string[],
	config?: ConditionalContextConfig,
): ConditionalContextResult {
	const tokenBudget = config?.tokenBudget ?? 4000;

	// Step 1: Classify the task
	let classification: TaskClassification | null = null;
	let taskType: TaskType;

	if (config?.overrideTaskType) {
		taskType = config.overrideTaskType;
	} else {
		classification = classifyTask(prompt);
		taskType = classification.type;
	}

	// Step 2: Parse all context files into sections
	const allSections: ContextSection[] = [];
	for (const raw of rawContextFiles) {
		if (raw && raw.trim().length > 0) {
			const sections = parseContextSections(raw);
			allSections.push(...sections);
		}
	}

	// Step 3: Select relevant sections within budget
	const selectionConfig: ContextSelectionConfig = {
		tokenBudget,
		alwaysIncludeCritical: config?.alwaysIncludeCritical ?? true,
	};

	const context = selectContext(allSections, taskType, selectionConfig);
	const summary = getSelectionSummary(allSections, taskType, selectionConfig);

	return {
		context,
		taskType,
		classification,
		includedSections: summary.included,
		excludedSections: summary.excluded,
		tokenEstimate: summary.totalTokens,
		tokenBudget,
	};
}

/**
 * Simplified API that returns just the filtered context string.
 * Use when you don't need the metadata.
 *
 * @param prompt - The user's input prompt to classify.
 * @param rawContextFiles - Array of raw markdown context file contents.
 * @param tokenBudget - Maximum token budget. Default: 4000.
 * @returns The filtered context string.
 */
export function filterContext(
	prompt: string,
	rawContextFiles: string[],
	tokenBudget?: number,
): string {
	const result = buildConditionalContext(prompt, rawContextFiles, { tokenBudget });
	return result.context;
}
