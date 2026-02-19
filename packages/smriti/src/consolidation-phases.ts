/**
 * @chitragupta/smriti — Consolidation Pattern Detection Phases
 *
 * Pure pattern detectors extracted from ConsolidationEngine. Each function
 * scans sessions for a specific signal type and returns DetectedPattern[].
 */

import type { Session } from "./types.js";
import type { DetectedPattern } from "./consolidation.js";

// ─── Regex Patterns for Detection ───────────────────────────────────────────

/** Patterns that indicate user preferences. */
export const PREFERENCE_PATTERNS: RegExp[] = [
	/\bi prefer\b/i,
	/\balways use\b/i,
	/\bnever use\b/i,
	/\buse (\w+) instead of (\w+)/i,
	/\bdon'?t use\b/i,
	/\bi like\b/i,
	/\bi want\b/i,
	/\bplease always\b/i,
	/\bplease never\b/i,
	/\blet'?s stick with\b/i,
	/\bmy preference is\b/i,
];

/** Patterns that indicate architectural/design decisions. */
export const DECISION_PATTERNS: RegExp[] = [
	/\blet'?s use\b/i,
	/\bdecided to\b/i,
	/\bgoing with\b/i,
	/\bswitched to\b/i,
	/\bwe'?ll go with\b/i,
	/\bthe decision is\b/i,
	/\bwe chose\b/i,
	/\bthe approach is\b/i,
	/\bwe'?re using\b/i,
	/\blet'?s go with\b/i,
];

/** Patterns that indicate the user is correcting the agent. */
export const CORRECTION_PATTERNS: RegExp[] = [
	/\bno,?\s+(?:not|use|it should|that'?s wrong)/i,
	/\bthat'?s (?:wrong|incorrect|not right)\b/i,
	/\bactually,?\s/i,
	/\binstead,?\s/i,
	/\bshould be\b/i,
	/\bnot (\w+),?\s+(?:but|use)\b/i,
	/\bwrong\b.*\bshould\b/i,
	/\bfix (?:that|this|it)\b/i,
	/\bchange (?:that|this|it) to\b/i,
];

// ─── Extraction Helpers ─────────────────────────────────────────────────────

/**
 * Extract tool call names from a session's turns, in order.
 *
 * @param session - The session to extract tool names from.
 * @returns Ordered array of tool call names.
 */
export function extractToolSequence(session: Session): string[] {
	const tools: string[] = [];
	for (const turn of session.turns) {
		if (turn.toolCalls) {
			for (const tc of turn.toolCalls) {
				tools.push(tc.name);
			}
		}
	}
	return tools;
}

/**
 * Extract n-grams of the given size from a string sequence.
 *
 * @param sequence - The input sequence of strings.
 * @param n - The n-gram size.
 * @returns Array of n-gram strings joined by " -> ".
 */
export function ngrams(sequence: string[], n: number): string[] {
	const result: string[] = [];
	for (let i = 0; i <= sequence.length - n; i++) {
		result.push(sequence.slice(i, i + n).join(" -> "));
	}
	return result;
}

/**
 * Extract all user-role content from a session.
 *
 * @param session - The session to extract from.
 * @returns Array of user message content strings.
 */
export function extractUserContent(session: Session): string[] {
	return session.turns
		.filter((t) => t.role === "user")
		.map((t) => t.content);
}

/**
 * Extract all assistant-role content from a session.
 *
 * @param session - The session to extract from.
 * @returns Array of assistant message content strings.
 */
export function extractAssistantContent(session: Session): string[] {
	return session.turns
		.filter((t) => t.role === "assistant")
		.map((t) => t.content);
}

/**
 * Extract the sentence containing the character at the given index.
 * Splits on true sentence-ending punctuation or newlines, returning
 * the segment that contains the match position.
 *
 * Avoids splitting on dots that are part of file extensions (e.g., ".js",
 * ".ts"), path separators ("./"), or decimal numbers ("3.14").
 *
 * @param text - The full text to extract from.
 * @param index - The character index of the match.
 * @returns The sentence containing the match.
 */
export function extractSentenceContaining(text: string, index: number): string {
	// Find true sentence boundaries — dots followed by a space and uppercase,
	// or followed by end-of-string. Exclamation/question marks and newlines
	// are always sentence boundaries.
	const breaks: number[] = [];

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n" || ch === "!" || ch === "?") {
			breaks.push(i);
		} else if (ch === ".") {
			// Only treat a dot as a sentence boundary if it looks like true
			// end-of-sentence punctuation, not a file extension or path dot.
			const prev = i > 0 ? text[i - 1] : "";
			const next = i < text.length - 1 ? text[i + 1] : "";

			// Dot is a sentence boundary if followed by space+uppercase or end-of-string
			const followedBySpaceUpper = next === " " && i + 2 < text.length && /[A-Z]/.test(text[i + 2]);
			const atEnd = i === text.length - 1;
			// Dot is NOT a sentence boundary if preceded/followed by a word char (file ext)
			// or preceded by / or . (path component)
			const isFilePath = prev === "/" || prev === "." || /[a-zA-Z0-9]/.test(next);

			if ((followedBySpaceUpper || atEnd) && !isFilePath) {
				breaks.push(i);
			}
		}
	}

	let start = 0;
	let end = text.length;

	for (const b of breaks) {
		if (b < index) {
			start = b + 1;
		} else {
			end = b;
			break;
		}
	}

	return text.substring(start, end).trim();
}

// ─── Pattern Detectors ──────────────────────────────────────────────────────

/**
 * Detect recurring tool call sequences across sessions using n-gram analysis.
 *
 * Extracts tool call names from each session in order, then finds 2-gram,
 * 3-gram, and 4-gram sequences that appear in multiple sessions.
 *
 * @param sessions - Sessions to analyze.
 * @param minObservations - Minimum number of sessions a pattern must appear in.
 * @returns Detected tool-sequence patterns.
 */
export function detectToolSequences(
	sessions: Session[],
	minObservations: number,
): DetectedPattern[] {
	const patterns: DetectedPattern[] = [];

	// For each n-gram size, count how many sessions contain each n-gram
	for (const n of [2, 3, 4]) {
		const ngramSessionCount = new Map<string, Set<string>>();
		const ngramEvidence = new Map<string, string[]>();

		for (const session of sessions) {
			const toolSeq = extractToolSequence(session);
			if (toolSeq.length < n) continue;

			const sessionNgrams = new Set(ngrams(toolSeq, n));
			for (const ng of sessionNgrams) {
				if (!ngramSessionCount.has(ng)) {
					ngramSessionCount.set(ng, new Set());
					ngramEvidence.set(ng, []);
				}
				ngramSessionCount.get(ng)!.add(session.meta.id);
				ngramEvidence.get(ng)!.push(
					`Session "${session.meta.title}": ${ng}`,
				);
			}
		}

		for (const [ng, sessionIds] of ngramSessionCount) {
			if (sessionIds.size >= minObservations) {
				patterns.push({
					type: "tool-sequence",
					description: `Recurring tool sequence: ${ng}`,
					evidence: ngramEvidence.get(ng) ?? [],
					frequency: sessionIds.size,
					confidence: Math.min(1.0, sessionIds.size / (sessions.length * 0.5)),
				});
			}
		}
	}

	return patterns;
}

/**
 * Detect user preference signals from session content.
 *
 * Scans user messages for explicit preference keywords ("I prefer",
 * "always use", "never use", corrections like "no, use X").
 *
 * @param sessions - Sessions to analyze.
 * @returns Detected preference patterns.
 */
export function detectPreferences(sessions: Session[]): DetectedPattern[] {
	const patterns: DetectedPattern[] = [];
	const preferenceHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

	for (const session of sessions) {
		const userContent = extractUserContent(session);
		for (const content of userContent) {
			for (const pattern of PREFERENCE_PATTERNS) {
				const match = content.match(pattern);
				if (match) {
					// Use the matched sentence as a normalized key
					const sentence = extractSentenceContaining(content, match.index ?? 0);
					const key = sentence.toLowerCase().trim();

					if (!preferenceHits.has(key)) {
						preferenceHits.set(key, { sessions: new Set(), evidence: [] });
					}
					const hit = preferenceHits.get(key)!;
					hit.sessions.add(session.meta.id);
					hit.evidence.push(
						`Session "${session.meta.title}": "${sentence}"`,
					);
				}
			}
		}
	}

	for (const [key, hit] of preferenceHits) {
		patterns.push({
			type: "preference",
			description: `User preference: ${key}`,
			evidence: hit.evidence,
			frequency: hit.sessions.size,
			confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
		});
	}

	return patterns;
}

/**
 * Detect architectural and design decisions from session content.
 *
 * Looks for phrases like "let's use X", "decided to", "going with",
 * "switched to" in user messages.
 *
 * @param sessions - Sessions to analyze.
 * @returns Detected decision patterns.
 */
export function detectDecisions(sessions: Session[]): DetectedPattern[] {
	const patterns: DetectedPattern[] = [];
	const decisionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

	for (const session of sessions) {
		const userContent = extractUserContent(session);
		for (const content of userContent) {
			for (const pattern of DECISION_PATTERNS) {
				const match = content.match(pattern);
				if (match) {
					const sentence = extractSentenceContaining(content, match.index ?? 0);
					const key = sentence.toLowerCase().trim();

					if (!decisionHits.has(key)) {
						decisionHits.set(key, { sessions: new Set(), evidence: [] });
					}
					const hit = decisionHits.get(key)!;
					hit.sessions.add(session.meta.id);
					hit.evidence.push(
						`Session "${session.meta.title}": "${sentence}"`,
					);
				}
			}
		}
	}

	for (const [key, hit] of decisionHits) {
		patterns.push({
			type: "decision",
			description: `Decision: ${key}`,
			evidence: hit.evidence,
			frequency: hit.sessions.size,
			confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
		});
	}

	return patterns;
}

/**
 * Detect correction patterns where the user corrected the agent.
 *
 * These are high-value learning signals: "no, not X, use Y",
 * "that's wrong", "actually...", "should be...", etc.
 *
 * @param sessions - Sessions to analyze.
 * @returns Detected correction patterns.
 */
export function detectCorrections(sessions: Session[]): DetectedPattern[] {
	const patterns: DetectedPattern[] = [];
	const correctionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

	for (const session of sessions) {
		const userContent = extractUserContent(session);
		for (const content of userContent) {
			for (const pattern of CORRECTION_PATTERNS) {
				const match = content.match(pattern);
				if (match) {
					const sentence = extractSentenceContaining(content, match.index ?? 0);
					const key = sentence.toLowerCase().trim();

					if (!correctionHits.has(key)) {
						correctionHits.set(key, { sessions: new Set(), evidence: [] });
					}
					const hit = correctionHits.get(key)!;
					hit.sessions.add(session.meta.id);
					hit.evidence.push(
						`Session "${session.meta.title}": "${sentence}"`,
					);
				}
			}
		}
	}

	for (const [key, hit] of correctionHits) {
		patterns.push({
			type: "correction",
			description: `Correction: ${key}`,
			evidence: hit.evidence,
			frequency: hit.sessions.size,
			confidence: Math.min(
				1.0,
				// Corrections get a confidence boost — they are high-value signals
				hit.sessions.size / Math.max(sessions.length * 0.2, 1),
			),
		});
	}

	return patterns;
}

/**
 * Detect code conventions from sessions.
 *
 * Analyzes tool call results and user content for naming patterns
 * (camelCase, snake_case), file organization patterns, and consistent
 * error handling approaches.
 *
 * @param sessions - Sessions to analyze.
 * @param minObservations - Minimum number of sessions a convention must appear in.
 * @returns Detected convention patterns.
 */
export function detectConventions(
	sessions: Session[],
	minObservations: number,
): DetectedPattern[] {
	const patterns: DetectedPattern[] = [];
	const conventionHits = new Map<string, { sessions: Set<string>; evidence: string[] }>();

	// Detect naming conventions from file paths in tool calls
	const fileExtCounts = new Map<string, { sessions: Set<string>; evidence: string[] }>();

	for (const session of sessions) {
		for (const turn of session.turns) {
			if (!turn.toolCalls) continue;
			for (const tc of turn.toolCalls) {
				// Check for file extension patterns in tool inputs
				const extMatch = tc.input.match(/\.([a-z]{1,5})\b/gi);
				if (extMatch) {
					for (const ext of extMatch) {
						const extLower = ext.toLowerCase();
						if (!fileExtCounts.has(extLower)) {
							fileExtCounts.set(extLower, { sessions: new Set(), evidence: [] });
						}
						const hit = fileExtCounts.get(extLower)!;
						hit.sessions.add(session.meta.id);
						hit.evidence.push(
							`Session "${session.meta.title}": tool ${tc.name} used ${extLower}`,
						);
					}
				}

				// Check for import style conventions
				if (tc.name === "edit" || tc.name === "write") {
					if (tc.input.includes('from "') || tc.input.includes("from '")) {
						const importKey = tc.input.includes(".js")
							? "esm-imports-with-js-extension"
							: "imports-without-extension";
						if (!conventionHits.has(importKey)) {
							conventionHits.set(importKey, { sessions: new Set(), evidence: [] });
						}
						const hit = conventionHits.get(importKey)!;
						hit.sessions.add(session.meta.id);
						hit.evidence.push(
							`Session "${session.meta.title}": ${importKey} in ${tc.name} call`,
						);
					}
				}
			}
		}
	}

	// Convert hits to patterns
	for (const [key, hit] of conventionHits) {
		if (hit.sessions.size >= minObservations) {
			patterns.push({
				type: "convention",
				description: `Convention: ${key}`,
				evidence: hit.evidence,
				frequency: hit.sessions.size,
				confidence: Math.min(1.0, hit.sessions.size / Math.max(sessions.length * 0.3, 1)),
			});
		}
	}

	return patterns;
}
