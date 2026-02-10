/**
 * @chitragupta/smriti — Stream Extractor.
 *
 * Classifies turn content into the 4 memory streams:
 *   - identity: WHO — preferences, corrections, personal facts
 *   - projects: WHAT — decisions, architecture, stack changes
 *   - tasks:    TODO — new tasks, completions, blockers
 *   - flow:     HOW — topic, mood, open questions, ephemeral context
 *
 * Uses lightweight heuristics (pattern matching + keyword extraction)
 * rather than LLM calls, keeping latency low enough for inline use
 * after every turn.
 */

import type { StreamSignals, StreamType, SessionTurn } from "./types.js";

// ─── Pattern Matchers ───────────────────────────────────────────────────────

/**
 * Patterns that signal identity-stream content.
 * These capture user preferences, corrections to agent behavior,
 * and personal facts about the user or their environment.
 */
const IDENTITY_PATTERNS: RegExp[] = [
	/\bi (?:prefer|like|want|hate|always|never|use)\b/i,
	/\b(?:my|our) (?:preference|style|convention|workflow|setup)\b/i,
	/\b(?:don't|do not|stop|please) (?:use|add|include|suggest)\b/i,
	/\b(?:i'm|i am) (?:a|an)\b/i,
	/\b(?:tabs|spaces|indent|formatting|style guide)\b/i,
	/\b(?:always|never) (?:do|use|include)\b/i,
	/\bcorrection:/i,
	/\bremember that\b/i,
	/\bfor future reference\b/i,
	/\bmy name is\b/i,
	/\bi work (?:at|on|with)\b/i,
];

/**
 * Patterns that signal project-stream content.
 * Architecture decisions, technology choices, file/module structures.
 */
const PROJECT_PATTERNS: RegExp[] = [
	/\b(?:decided|decision|chose|choosing|picked|selected) (?:to|on)\b/i,
	/\b(?:architecture|design|pattern|structure|schema|api)\b/i,
	/\b(?:database|db|postgres|mongo|redis|sqlite)\b/i,
	/\b(?:framework|library|package|dependency|stack)\b/i,
	/\b(?:migrate|migration|refactor|redesign)\b/i,
	/\b(?:deploy|deployment|ci\/cd|pipeline|docker|kubernetes)\b/i,
	/\b(?:config|configuration|environment|env var)\b/i,
	/\b(?:module|component|service|endpoint|route)\b/i,
	/\b(?:breaking change|deprecat|version)\b/i,
	/\b(?:created|added|removed|renamed) (?:a |the )?(?:file|module|package|directory)\b/i,
];

/**
 * Patterns that signal tasks-stream content.
 * TODOs, completions, blockers, bugs, issues.
 */
const TASK_PATTERNS: RegExp[] = [
	/\b(?:todo|to-do|to do)\b/i,
	/\b(?:fix|bug|issue|error|broken|failing)\b/i,
	/\b(?:implement|add|create|build|write|make)\b(?:.*?\b(?:feature|function|test|endpoint))?/i,
	/\b(?:blocked|blocker|blocking|stuck|waiting)\b/i,
	/\b(?:completed|done|finished|shipped|merged)\b/i,
	/\b(?:test|testing|coverage|spec)\b/i,
	/\b(?:pr|pull request|review|approve)\b/i,
	/\b(?:priority|urgent|critical|important)\b/i,
	/\b(?:next step|action item|follow[- ]up)\b/i,
	/\b(?:milestone|sprint|release|deadline)\b/i,
];

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Score content against a set of patterns.
 * Returns the number of pattern matches (0 = no signal).
 */
function scorePatterns(text: string, patterns: RegExp[]): number {
	let hits = 0;
	for (const pattern of patterns) {
		if (pattern.test(text)) hits++;
	}
	return hits;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract stream signals from a single turn's content.
 *
 * Each stream gets an array of relevant text fragments (sentences)
 * from the turn. A sentence can appear in multiple streams if it
 * matches patterns for more than one.
 *
 * Content that matches no specific stream goes to "flow" (ephemeral).
 */
export function extractSignals(turn: SessionTurn): StreamSignals {
	const signals: StreamSignals = {
		identity: [],
		projects: [],
		tasks: [],
		flow: [],
	};

	// Split content into sentences for granular classification
	const sentences = splitSentences(turn.content);

	for (const sentence of sentences) {
		if (sentence.trim().length < 5) continue;

		const identityScore = scorePatterns(sentence, IDENTITY_PATTERNS);
		const projectScore = scorePatterns(sentence, PROJECT_PATTERNS);
		const taskScore = scorePatterns(sentence, TASK_PATTERNS);

		let classified = false;

		if (identityScore > 0) {
			signals.identity.push(sentence.trim());
			classified = true;
		}
		if (projectScore > 0) {
			signals.projects.push(sentence.trim());
			classified = true;
		}
		if (taskScore > 0) {
			signals.tasks.push(sentence.trim());
			classified = true;
		}

		// Everything unclassified goes to flow
		if (!classified) {
			signals.flow.push(sentence.trim());
		}
	}

	// Also extract tool call signals
	if (turn.toolCalls) {
		for (const tc of turn.toolCalls) {
			// Tool calls are project-relevant (what was done)
			const toolSignal = `[tool:${tc.name}] ${tc.input.slice(0, 200)}`;
			signals.projects.push(toolSignal);

			// Errors are task-relevant (something to fix)
			if (tc.isError) {
				signals.tasks.push(`[error:${tc.name}] ${tc.result.slice(0, 200)}`);
			}
		}
	}

	return signals;
}

/**
 * Classify a full text into a single dominant stream type.
 * Useful for quick routing decisions.
 */
export function classifyContent(text: string): StreamType {
	const identityScore = scorePatterns(text, IDENTITY_PATTERNS);
	const projectScore = scorePatterns(text, PROJECT_PATTERNS);
	const taskScore = scorePatterns(text, TASK_PATTERNS);

	const maxScore = Math.max(identityScore, projectScore, taskScore);

	if (maxScore === 0) return "flow";
	if (identityScore === maxScore) return "identity";
	if (projectScore === maxScore) return "projects";
	if (taskScore === maxScore) return "tasks";

	return "flow";
}

/**
 * Extract signals from multiple turns and merge them.
 */
export function extractSignalsFromTurns(turns: SessionTurn[]): StreamSignals {
	const merged: StreamSignals = {
		identity: [],
		projects: [],
		tasks: [],
		flow: [],
	};

	for (const turn of turns) {
		const signals = extractSignals(turn);
		merged.identity.push(...signals.identity);
		merged.projects.push(...signals.projects);
		merged.tasks.push(...signals.tasks);
		merged.flow.push(...signals.flow);
	}

	return merged;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Split text into sentences, handling common edge cases
 * (abbreviations, decimal numbers, code blocks).
 */
function splitSentences(text: string): string[] {
	// Remove code blocks first — they're always flow-level
	const withoutCode = text.replace(/```[\s\S]*?```/g, "[code block]");

	// Split on sentence-ending punctuation followed by whitespace + uppercase,
	// or on newlines that look like paragraph breaks.
	const sentences = withoutCode
		.split(/(?<=[.!?])\s+(?=[A-Z])|(?:\n\s*\n)|\n(?=[-*•])/)
		.filter((s) => s.trim().length > 0);

	return sentences;
}
