/**
 * Vichara — Request complexity classifier.
 *
 * Analyzes the last user message to determine task difficulty using
 * layered signal detection. Each signal tier contributes a weighted
 * score that maps to a discrete complexity level. Confidence is
 * derived from proximity to the tier center, yielding high certainty
 * for clear-cut requests and honest uncertainty at tier boundaries.
 */

import type { Context, StreamOptions } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Discrete complexity tiers, lightest to heaviest. */
export type TaskComplexity = "trivial" | "simple" | "medium" | "complex" | "expert";

/** Result of classifying a request's complexity. */
export interface ClassificationResult {
	/** The determined complexity tier. */
	complexity: TaskComplexity;
	/** Human-readable explanation of which signals fired. */
	reason: string;
	/** Confidence in the classification, clamped to [0.5, 1.0]. */
	confidence: number;
}

// ─── Signal Patterns ────────────────────────────────────────────────────────

interface Signal {
	weight: number;
	label: string;
	test: (text: string, wordCount: number, hasTools: boolean) => boolean;
}

const TRIVIAL_PATTERNS = /^(yes|no|ok|sure|thanks|thank you|hi|hello|hey|bye|nope|yep)\b/i;
const CODE_KEYWORDS = /\b(function|class|import|export|debug|fix|implement|create|write|refactor|const|let|var|async|await|interface|type|enum)\b/i;
const MULTI_STEP = /\b(first\s.*then|step\s*[1-9]|multiple\s+files|refactor\s+.*across|and\s+then|after\s+that|finally)\b/i;
const REASONING_DEPTH = /\b(analyze|compare|evaluate|design|trade-?offs?|pros?\s+and\s+cons?|architecture|investigate)\b/i;
const EXPERT_DOMAIN = /\b(distributed\s+system|scalability|security\s+audit|performance\s+optimi[zs]|benchmark|consensus\s+algorithm|zero-?knowledge|fault.?toleran|load\s+balanc|sharding)\b/i;

const SIGNALS: Signal[] = [
	// ── Trivial (+0 base, but if ONLY trivial fires, score stays low) ──
	{
		weight: 0,
		label: "greeting/acknowledgement",
		test: (text) => TRIVIAL_PATTERNS.test(text.trim()),
	},
	{
		weight: 0.5,
		label: "short question (<10 words)",
		test: (text, wc) => text.trim().endsWith("?") && wc < 10,
	},

	// ── Simple (+1) ──
	{
		weight: 1.0,
		label: "brief request (<50 words, no code)",
		test: (text, wc) => wc < 50 && !CODE_KEYWORDS.test(text),
	},

	// ── Medium (+2) ──
	{
		weight: 2.0,
		label: "code-related keywords",
		test: (text) => CODE_KEYWORDS.test(text),
	},
	{
		weight: 2.0,
		label: "tool-augmented request",
		test: (_text, _wc, hasTools) => hasTools,
	},

	// ── Complex (+3) ──
	{
		weight: 3.0,
		label: "multi-step task",
		test: (text) => MULTI_STEP.test(text),
	},
	{
		weight: 3.0,
		label: "long message (>200 words)",
		test: (_text, wc) => wc > 200,
	},
	{
		weight: 2.5,
		label: "reasoning depth indicators",
		test: (text) => REASONING_DEPTH.test(text),
	},

	// ── Expert (+4) ──
	{
		weight: 4.0,
		label: "expert domain signals",
		test: (text) => EXPERT_DOMAIN.test(text),
	},
];

// ─── Tier Mapping ───────────────────────────────────────────────────────────

interface TierRange {
	complexity: TaskComplexity;
	min: number;
	max: number;
}

/** Score-to-tier mapping. Ranges are inclusive on both ends. */
const TIERS: TierRange[] = [
	{ complexity: "trivial", min: 0, max: 1.0 },
	{ complexity: "simple", min: 1.0, max: 2.5 },
	{ complexity: "medium", min: 2.5, max: 4.0 },
	{ complexity: "complex", min: 4.0, max: 6.0 },
	{ complexity: "expert", min: 6.0, max: Infinity },
];

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify the complexity of a request by analyzing the last user message.
 *
 * @param context - The conversation context (messages, tools, etc.).
 * @param _options - Stream options (reserved for future signal weighting).
 * @returns A {@link ClassificationResult} with tier, reason, and confidence.
 */
export function classifyComplexity(context: Context, _options?: StreamOptions): ClassificationResult {
	const lastUserMsg = [...context.messages].reverse().find((m) => m.role === "user");
	const text = lastUserMsg
		? lastUserMsg.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join(" ")
		: "";

	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const hasTools = Array.isArray(context.tools) && context.tools.length > 0;

	// Accumulate score and matched labels
	let score = 0;
	const matched: string[] = [];

	for (const signal of SIGNALS) {
		if (signal.test(text, wordCount, hasTools)) {
			score += signal.weight;
			matched.push(signal.label);
		}
	}

	// Determine tier
	const tier = TIERS.find((t) => score >= t.min && score < t.max)
		?? TIERS[TIERS.length - 1];

	// Confidence: inverse distance from tier center, clamped [0.5, 1.0]
	const tierWidth = Math.min(tier.max, 10) - tier.min;
	const tierCenter = tier.min + tierWidth / 2;
	const distance = Math.abs(score - tierCenter);
	const confidence = Math.max(0.5, Math.min(1.0, 1.0 - distance / (tierWidth || 1)));

	const reason = matched.length > 0
		? `Matched: ${matched.join(", ")}`
		: "No strong signals detected";

	return { complexity: tier.complexity, reason, confidence };
}
