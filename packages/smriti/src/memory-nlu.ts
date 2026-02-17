/**
 * @chitragupta/smriti — Memory NLU (Natural Language Understanding)
 *
 * Zero-cost pattern matching to detect memory commands in user input.
 * No LLM call — pure regex + heuristics, <0.1ms per check.
 *
 * Detects:
 *   "remember that I like pizza"     → { action: 'remember', content: 'I like pizza', category: 'preference' }
 *   "forget about my pizza pref"     → { action: 'forget', query: 'pizza' }
 *   "what do you remember about me"  → { action: 'recall', query: 'me' }
 *   "list my preferences"            → { action: 'list', category: 'preference' }
 */

import type { SmaranCategory } from "./smaran.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryIntent {
	action: "remember" | "forget" | "recall" | "list";
	/** Extracted content for 'remember' action */
	content?: string;
	/** Detected category */
	category?: SmaranCategory;
	/** Query string for 'forget' / 'recall' actions */
	query?: string;
}

// ─── Pattern Groups ─────────────────────────────────────────────────────────

const REMEMBER_PATTERNS: Array<{ pattern: RegExp; contentGroup: number }> = [
	{ pattern: /\bremember\s+that\s+(.+)/i, contentGroup: 1 },
	{ pattern: /\bremember\s*:\s*(.+)/i, contentGroup: 1 },
	{ pattern: /\bremember\s+(?:i|my|me)\s+(.+)/i, contentGroup: 1 },
	{ pattern: /\bsave\s+(?:this|that)\s*:\s*(.+)/i, contentGroup: 1 },
	{ pattern: /\bsave\s+(?:as\s+)?(?:a\s+)?memory\s*:\s*(.+)/i, contentGroup: 1 },
	{ pattern: /\bnote\s+that\s+(.+)/i, contentGroup: 1 },
	{ pattern: /\bnote\s*:\s*(.+)/i, contentGroup: 1 },
	{ pattern: /\bkeep\s+in\s+mind\s+(?:that\s+)?(.+)/i, contentGroup: 1 },
	{ pattern: /\bdon'?t\s+forget\s+(?:that\s+)?(.+)/i, contentGroup: 1 },
	{ pattern: /\bstore\s+(?:this|that)\s*:\s*(.+)/i, contentGroup: 1 },
	{ pattern: /\bplease\s+remember\s+(.+)/i, contentGroup: 1 },
	{ pattern: /\bi\s+(?:like|prefer|love|enjoy|hate|dislike|want|need|always|never)\s+(.+)/i, contentGroup: 0 },
];

const FORGET_PATTERNS: RegExp[] = [
	/\bforget\s+(?:that\s+)?(?:i\s+)?(.+)/i,
	/\bforget\s+about\s+(.+)/i,
	/\bdelete\s+(?:the\s+)?memory\s+(?:about\s+)?(.+)/i,
	/\bremove\s+(?:the\s+)?memory\s+(?:about\s+)?(.+)/i,
	/\bnever\s+mind\s+(?:about\s+)?(.+)/i,
	/\bstop\s+remembering\s+(.+)/i,
];

const RECALL_PATTERNS: RegExp[] = [
	/\bwhat\s+do\s+you\s+(?:remember|know)\s+(?:about\s+)?(.+)/i,
	/\bdo\s+you\s+(?:remember|know)\s+(?:about\s+)?(.+)/i,
	/\bwhat\s+(?:are|is)\s+my\s+(.+)/i,
	/\brecall\s+(.+)/i,
	/\bshow\s+me\s+(?:my\s+)?memories?\s+(?:about\s+)?(.+)/i,
	/\bwhat\s+have\s+you\s+learned\s+(?:about\s+)?(.+)/i,
];

const LIST_PATTERNS: Array<{ pattern: RegExp; category?: SmaranCategory }> = [
	{ pattern: /\blist\s+(?:my\s+)?preferences?\b/i, category: "preference" },
	{ pattern: /\bshow\s+(?:my\s+)?preferences?\b/i, category: "preference" },
	{ pattern: /\bmy\s+preferences?\b/i, category: "preference" },
	{ pattern: /\blist\s+(?:my\s+)?(?:facts?|knowledge)\b/i, category: "fact" },
	{ pattern: /\blist\s+(?:my\s+)?decisions?\b/i, category: "decision" },
	{ pattern: /\blist\s+(?:my\s+)?instructions?\b/i, category: "instruction" },
	{ pattern: /\blist\s+(?:all\s+)?memories?\b/i },
	{ pattern: /\bshow\s+(?:all\s+)?memories?\b/i },
	{ pattern: /\bwhat\s+(?:do\s+)?you\s+remember\b/i },
	{ pattern: /\bwhat\s+have\s+you\s+(?:learned|stored|saved)\b/i },
];

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: SmaranCategory }> = [
	{ pattern: /\b(?:i\s+)?(?:like|prefer|love|enjoy|favorite|favourite)\b/i, category: "preference" },
	{ pattern: /\b(?:i\s+)?(?:hate|dislike|don'?t\s+like|avoid|never)\b/i, category: "preference" },
	{ pattern: /\b(?:i\s+)?(?:always|usually|typically|tend\s+to)\b/i, category: "preference" },
	{ pattern: /\b(?:my\s+name|i\s+am|i\s+live|i\s+work|i\s+have|my\s+)\b/i, category: "fact" },
	{ pattern: /\b(?:decided|choosing|going\s+with|let'?s\s+use)\b/i, category: "decision" },
	{ pattern: /\b(?:always\s+do|from\s+now\s+on|whenever|every\s+time)\b/i, category: "instruction" },
];

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect a memory-related intent from user text.
 *
 * Returns null if no memory intent is detected.
 * Zero-cost: pure regex, no LLM call, <0.1ms.
 */
export function detectMemoryIntent(text: string): MemoryIntent | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// 1. Check FORGET patterns first (higher priority — destructive action)
	for (const pattern of FORGET_PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			return {
				action: "forget",
				query: (match[1] ?? "").trim(),
			};
		}
	}

	// 2. Check LIST patterns
	for (const { pattern, category } of LIST_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				action: "list",
				category,
			};
		}
	}

	// 3. Check RECALL patterns
	for (const pattern of RECALL_PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			// Find the first non-empty capture group
			const query = match.slice(1).find(g => g && g.trim()) ?? "";
			return {
				action: "recall",
				query: query.trim(),
			};
		}
	}

	// 4. Check REMEMBER patterns
	for (const { pattern, contentGroup } of REMEMBER_PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			const content = contentGroup === 0
				? trimmed  // Use the full text as content (for "I like pizza" style)
				: (match[contentGroup] ?? "").trim();

			if (!content) continue;

			return {
				action: "remember",
				content: cleanContent(content),
				category: detectCategory(content),
			};
		}
	}

	return null;
}

/**
 * Detect the category of a memory content string.
 */
export function detectCategory(content: string): SmaranCategory {
	for (const { pattern, category } of CATEGORY_PATTERNS) {
		if (pattern.test(content)) return category;
	}
	return "fact";
}

/**
 * Clean extracted content — strip trailing punctuation, normalize whitespace.
 */
function cleanContent(content: string): string {
	return content
		.replace(/[.!?]+$/, "")  // Strip trailing punctuation
		.replace(/\s+/g, " ")    // Normalize whitespace
		.trim();
}
