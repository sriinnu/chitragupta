/**
 * @chitragupta/anina — Manas (मनस्) — Zero-Cost Input Pre-Processor.
 *
 * In Vedic philosophy, Manas is the mind that processes sensory input
 * before passing it to Buddhi (intellect). Here, Manas analyzes raw
 * user input BEFORE any LLM call, deciding intent, complexity, and
 * the optimal processing route — all via pattern matching, zero tokens.
 *
 * ## Design Goals
 *
 * 1. **< 5 ms** — Every classification must complete in under 5ms.
 *    No network, no LLM, no async. Pure synchronous regex + heuristics.
 *
 * 2. **10 Intent Categories** — Covering the full spectrum of developer
 *    interactions: file ops, code gen, review, debug, refactor, search,
 *    explanation, documentation, system commands, and conversation.
 *
 * 3. **4-Tier Routing** — Routes input to the cheapest sufficient model:
 *    - tool-only: No LLM needed (pure tool execution)
 *    - haiku: Fast model for simple queries
 *    - sonnet: Standard model for typical development tasks
 *    - opus: Full model for high-complexity architectural work
 *
 * 4. **Feature Extraction** — Pulls structural features (code presence,
 *    file paths, error stacks, question count, imperative mood, etc.)
 *    that downstream systems (Turiya, Chetana) can consume for free.
 *
 * 5. **Ambiguity Scoring** — Quantifies input clarity via intent overlap
 *    and keyword density, enabling confident routing decisions.
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** The 10 intent categories Manas can detect. */
export type ManasIntent =
	| "file_operation"
	| "code_generation"
	| "code_review"
	| "debugging"
	| "refactoring"
	| "search"
	| "explanation"
	| "documentation"
	| "system"
	| "conversation";

/** The 4 routing tiers ordered by cost. */
export type ManasRoute =
	| "tool-only"
	| "haiku"
	| "sonnet"
	| "opus";

/** Structural features extracted from user input. */
export interface ManasFeatures {
	/** Input contains code blocks (backtick-fenced or indented). */
	hasCode: boolean;
	/** Input references file paths (e.g., ./src/foo.ts, /etc/hosts). */
	hasFilePaths: boolean;
	/** Input contains an error/exception stack trace. */
	hasErrorStack: boolean;
	/** Number of question marks in input. */
	questionCount: number;
	/** Total word count. */
	wordCount: number;
	/** Approximate sentence count. */
	sentenceCount: number;
	/** Input starts with an imperative verb (command form). */
	imperative: boolean;
	/** Input describes multiple sequential steps. */
	multiStep: boolean;
	/** Input uses technical/programming jargon. */
	technical: boolean;
}

/** Full classification result from Manas. */
export interface ManasClassification {
	/** Primary detected intent. */
	intent: ManasIntent;
	/** Extracted keywords from the input. */
	keywords: string[];
	/** Ambiguity score: 0 = crystal clear, 1 = completely ambiguous. */
	ambiguityScore: number;
	/** Recommended processing route. */
	route: ManasRoute;
	/** Overall classification confidence: 0 = no confidence, 1 = certain. */
	confidence: number;
	/** Structural features extracted for downstream consumers (Turiya, etc.). */
	features: ManasFeatures;
	/** Wall-clock time taken for classification (ms). Should be <5ms. */
	durationMs: number;
}

// ─── Intent Patterns ────────────────────────────────────────────────────────

/**
 * Each intent has a primary regex pattern. Patterns are ordered by
 * specificity — more specific intents (file_operation, code_generation)
 * are checked before broader ones (explanation, conversation).
 *
 * Priority order matters: first match wins when confidence is tied.
 */
interface IntentPattern {
	intent: ManasIntent;
	pattern: RegExp;
	/** Base confidence when this pattern matches. */
	baseConfidence: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
	// --- High specificity (checked first) ---
	{
		intent: "file_operation",
		pattern: /\b(read|write|edit|create|delete|remove|cat|open|save|rename|copy|move|touch|mkdir)\b.*(?:\b(?:file|dir(?:ectory)?|folder)\b|\.(?:ts|js|tsx|jsx|md|json|py|rs|go|yaml|yml|toml|css|html|sh|txt|cfg|ini|xml|sql|rb|java|c|cpp|h)\b)/i,
		baseConfidence: 0.85,
	},
	{
		intent: "file_operation",
		pattern: /(?:\b(?:file|files|dir(?:ectory)?|folder)\b|\.(?:ts|js|tsx|jsx|md|json|py|rs|go|yaml|yml|toml|css|html|sh|txt|cfg|ini|xml|sql|rb|java|c|cpp|h)\b).*\b(read|write|edit|create|delete|remove|cat|open|save|rename|copy|move)\b/i,
		baseConfidence: 0.80,
	},
	{
		intent: "code_generation",
		pattern: /\b(write|implement|add|create|build|make|generate|scaffold|code)\b.*\b(function|class|component|endpoint|feature|module|interface|type|method|handler|route|api|service|hook|util|helper|test|spec)\b/i,
		baseConfidence: 0.85,
	},
	{
		intent: "code_generation",
		pattern: /\b(function|class|component|endpoint|feature|module|interface|type|method|handler|route|api|service)\b.*\b(that|which|for|to)\b/i,
		baseConfidence: 0.70,
	},
	{
		intent: "code_review",
		pattern: /\b(review|check|audit|inspect|analyze|assess|evaluate|critique|look\s+at|examine)\b.*\b(code|implementation|function|class|pr|pull\s+request|commit|changes|diff)\b/i,
		baseConfidence: 0.85,
	},
	{
		intent: "code_review",
		pattern: /\b(code|implementation|pr|pull\s+request)\b.*\b(review|check|audit|inspect|analyze)\b/i,
		baseConfidence: 0.80,
	},
	{
		intent: "debugging",
		pattern: /\b(fix|debug|error|bug|crash|fail(?:ure|ing|ed)?|trace|stack\s*trace|exception|broken|wrong|issue|problem|not\s+work(?:ing)?|undefined|null\s+(?:pointer|reference)|segfault|panic)\b/i,
		baseConfidence: 0.80,
	},
	{
		intent: "refactoring",
		pattern: /\b(refactor|rename|move|extract|inline|reorganize|restructure|simplify|clean\s*up|dedup(?:licate)?|split|merge|consolidate|modularize|decompose)\b/i,
		baseConfidence: 0.85,
	},
	{
		intent: "search",
		pattern: /\b(find|search|grep|locate|where|look\s+for|which\s+file|rg|ag|ripgrep)\b/i,
		baseConfidence: 0.85,
	},
	{
		intent: "documentation",
		pattern: /\b(document|readme|changelog|jsdoc|tsdoc|docstring|comment|annotate|describe\s+the\s+api|api\s+docs|write\s+docs)\b/i,
		baseConfidence: 0.80,
	},
	{
		intent: "system",
		pattern: /\b(git|npm|pnpm|yarn|build|test|deploy|install|run|compile|lint|format|ci|cd|docker|k8s|kubernetes|terraform|push|pull|commit|branch|merge|rebase|tag|release|publish|version)\b/i,
		baseConfidence: 0.75,
	},
	// --- Low specificity (checked last) ---
	{
		intent: "explanation",
		pattern: /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|why\s+(?:does|do|is|are|did)|tell\s+me|describe|walk\s+(?:me\s+)?through|help\s+me\s+understand|what's\s+the\s+difference|compare)\b/i,
		baseConfidence: 0.80,
	},
	{
		intent: "conversation",
		pattern: /\b(hi|hello|hey|thanks|thank\s+you|good\s+(?:morning|afternoon|evening)|bye|goodbye|nice|great|awesome|cool|ok(?:ay)?|sure|yes|no|please|sorry|help|lol|haha)\b/i,
		baseConfidence: 0.60,
	},
];

// ─── Feature Detection Patterns ─────────────────────────────────────────────

/** Fenced code blocks: ```...``` or ~~~...~~~ */
const CODE_BLOCK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/;
/** Inline code: `...` */
const INLINE_CODE_RE = /`[^`]+`/;
/** File paths: ./foo, ../bar, /abs/path, or windows C:\path */
const FILE_PATH_RE = /(?:\.\.?\/[\w./-]+|\/[\w./-]{2,}|[A-Z]:\\[\w\\.-]+|\b[\w-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|c|cpp|h|rb|md|json|yaml|yml|toml|css|html|sh|txt|sql|xml|cfg|ini))\b/;
/** Error stack traces: "at Function.X (file:line:col)" or "Error: ..." */
const ERROR_STACK_RE = /(?:\bat\s+[\w.]+\s*\(.*:\d+:\d+\)|(?:Error|Exception|TypeError|ReferenceError|SyntaxError|RangeError):\s)/i;
/** Multi-step indicators: "first...then...finally" or numbered steps */
const MULTI_STEP_RE = /\b(?:first|then|next|after\s+that|finally|step\s+\d|1\.\s.*\n.*2\.)/i;
/** Technical jargon: programming terms */
const TECHNICAL_RE = /\b(?:async|await|promise|callback|closure|mutex|semaphore|thread|process|socket|tcp|http|rest|graphql|grpc|orm|crud|sql|nosql|schema|migration|middleware|hook|decorator|generic|polymorphism|inheritance|interface|abstract|singleton|factory|observer|iterator|monad|functor|regex|algorithm|recursion|memoize|cache|hash|tree|graph|queue|stack|heap|runtime|compile|transpile|bundle|webpack|vite|rollup|esbuild|docker|container|pod|cluster|lambda|serverless|microservice|monolith|api|sdk|cli|tui|gui|ssr|ssr|csr|spa|pwa)\b/i;
/** Imperative verbs that typically start commands */
const IMPERATIVE_VERBS = /^(?:read|write|edit|create|delete|remove|find|search|fix|debug|add|implement|build|make|generate|refactor|rename|move|extract|explain|describe|review|check|audit|deploy|install|run|compile|test|lint|format|update|upgrade|downgrade|rollback|revert|document|open|close|start|stop|restart|show|list|get|set|put|post|patch|configure|setup|initialize|bootstrap|scaffold|commit|push|pull|merge|rebase|tag|release)\b/i;

// ─── Stop Words ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "could",
	"should", "may", "might", "shall", "can", "need", "dare", "ought",
	"used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
	"as", "into", "through", "during", "before", "after", "above",
	"below", "between", "out", "off", "over", "under", "again", "further",
	"then", "once", "here", "there", "when", "where", "why", "how", "all",
	"each", "every", "both", "few", "more", "most", "other", "some",
	"such", "no", "nor", "not", "only", "own", "same", "so", "than",
	"too", "very", "just", "about", "also", "and", "but", "or", "if",
	"while", "because", "until", "that", "which", "who", "whom", "this",
	"these", "those", "am", "its", "it", "i", "me", "my", "we", "our",
	"you", "your", "he", "she", "they", "them", "his", "her", "what",
	"up", "down",
]);

// ─── Manas Class ────────────────────────────────────────────────────────────

/**
 * Manas — Zero-cost input pre-processor.
 *
 * Synchronous, stateless, pattern-based classification. Every call to
 * `classify()` returns in <5ms with intent, route, features, keywords,
 * and confidence — no LLM tokens consumed.
 *
 * ## Usage
 *
 * ```ts
 * const manas = new Manas();
 * const result = manas.classify("find all .ts files in src/");
 * // result.intent === "search"
 * // result.route === "tool-only"
 * // result.features.hasFilePaths === true
 * ```
 */
export class Manas {
	// ─── Public API ───────────────────────────────────────────────────

	/**
	 * Classify user input into intent, route, features, and keywords.
	 * Guaranteed synchronous, no network, <5ms.
	 */
	classify(input: string): ManasClassification {
		const start = performance.now();

		const features = this.extractFeatures(input);
		const intentScores = this.scoreIntents(input, features);
		const { intent, confidence } = this.pickIntent(intentScores);
		const keywords = this.extractKeywords(input);
		const ambiguityScore = this.computeAmbiguity(intentScores);
		const route = this.decideRoute(intent, features, ambiguityScore, confidence);

		const durationMs = performance.now() - start;

		return {
			intent,
			keywords,
			ambiguityScore,
			route,
			confidence,
			features,
			durationMs,
		};
	}

	// ─── Feature Extraction ───────────────────────────────────────────

	/**
	 * Extract structural features from user input.
	 * All regex-based, zero allocation beyond the result object.
	 */
	extractFeatures(input: string): ManasFeatures {
		const hasCode = CODE_BLOCK_RE.test(input) || INLINE_CODE_RE.test(input);
		const hasFilePaths = FILE_PATH_RE.test(input);
		const hasErrorStack = ERROR_STACK_RE.test(input);

		// Question marks
		let questionCount = 0;
		for (let i = 0; i < input.length; i++) {
			if (input.charCodeAt(i) === 63 /* '?' */) questionCount++;
		}

		// Word count — split on whitespace
		const words = input.trim().split(/\s+/);
		const wordCount = input.trim().length === 0 ? 0 : words.length;

		// Sentence count — split on sentence terminators
		const sentences = input.split(/[.!?]+/).filter(s => s.trim().length > 0);
		const sentenceCount = Math.max(1, sentences.length);

		// Imperative: first word is a verb
		const firstWord = words[0] ?? "";
		const imperative = IMPERATIVE_VERBS.test(firstWord);

		// Multi-step
		const multiStep = MULTI_STEP_RE.test(input);

		// Technical jargon
		const technical = TECHNICAL_RE.test(input);

		return {
			hasCode,
			hasFilePaths,
			hasErrorStack,
			questionCount,
			wordCount,
			sentenceCount,
			imperative,
			multiStep,
			technical,
		};
	}

	// ─── Intent Scoring ───────────────────────────────────────────────

	/**
	 * Score every intent against the input. Returns a map of intent → score.
	 * A higher score means stronger match. Range: [0, 1].
	 */
	scoreIntents(input: string, features: ManasFeatures): Map<ManasIntent, number> {
		const scores = new Map<ManasIntent, number>();

		// Initialize all intents to 0
		const allIntents: ManasIntent[] = [
			"file_operation", "code_generation", "code_review", "debugging",
			"refactoring", "search", "explanation", "documentation",
			"system", "conversation",
		];
		for (const intent of allIntents) {
			scores.set(intent, 0);
		}

		// Score from pattern matches
		for (const { intent, pattern, baseConfidence } of INTENT_PATTERNS) {
			if (pattern.test(input)) {
				const current = scores.get(intent) ?? 0;
				// Take max if multiple patterns match the same intent
				scores.set(intent, Math.max(current, baseConfidence));
			}
		}

		// Feature-based boosting
		if (features.hasErrorStack) {
			const current = scores.get("debugging") ?? 0;
			scores.set("debugging", Math.min(1, current + 0.15));
		}
		if (features.hasFilePaths) {
			const fileOp = scores.get("file_operation") ?? 0;
			if (fileOp > 0) scores.set("file_operation", Math.min(1, fileOp + 0.10));
			const search = scores.get("search") ?? 0;
			if (search > 0) scores.set("search", Math.min(1, search + 0.05));
		}
		if (features.hasCode) {
			const codeGen = scores.get("code_generation") ?? 0;
			if (codeGen > 0) scores.set("code_generation", Math.min(1, codeGen + 0.05));
			const debug = scores.get("debugging") ?? 0;
			if (debug > 0) scores.set("debugging", Math.min(1, debug + 0.05));
		}
		if (features.questionCount > 0) {
			const explanation = scores.get("explanation") ?? 0;
			if (explanation > 0) scores.set("explanation", Math.min(1, explanation + 0.10));
		}

		return scores;
	}

	/**
	 * Pick the winning intent from scored results.
	 * Returns highest-scoring intent; ties broken by pattern order (specificity).
	 */
	pickIntent(scores: Map<ManasIntent, number>): { intent: ManasIntent; confidence: number } {
		let bestIntent: ManasIntent = "conversation";
		let bestScore = 0;

		// Priority order for tie-breaking (matches INTENT_PATTERNS order)
		const priority: ManasIntent[] = [
			"file_operation", "code_generation", "code_review", "debugging",
			"refactoring", "search", "documentation", "system",
			"explanation", "conversation",
		];

		for (const intent of priority) {
			const score = scores.get(intent) ?? 0;
			if (score > bestScore) {
				bestScore = score;
				bestIntent = intent;
			}
		}

		return { intent: bestIntent, confidence: bestScore };
	}

	// ─── Keyword Extraction ───────────────────────────────────────────

	/**
	 * Extract meaningful keywords from input.
	 * Filters stop words, deduplicates, preserves order of first occurrence.
	 * Returns at most 15 keywords.
	 */
	extractKeywords(input: string): string[] {
		// Tokenize: split on non-word chars but preserve file extensions
		const tokens = input.toLowerCase().split(/[\s,;:!?()\[\]{}"']+/);
		const seen = new Set<string>();
		const keywords: string[] = [];

		for (const token of tokens) {
			// Clean leading/trailing non-alphanumeric (except dots for file paths)
			const cleaned = token.replace(/^[^a-z0-9./]+|[^a-z0-9.]+$/g, "");
			if (cleaned.length < 2) continue;
			if (STOP_WORDS.has(cleaned)) continue;
			if (seen.has(cleaned)) continue;

			seen.add(cleaned);
			keywords.push(cleaned);

			if (keywords.length >= 15) break;
		}

		return keywords;
	}

	// ─── Ambiguity Scoring ────────────────────────────────────────────

	/**
	 * Compute ambiguity score from intent score distribution.
	 *
	 * High ambiguity when:
	 * - Multiple intents have similar scores (low separation)
	 * - No intent has a strong match (low max score)
	 *
	 * Uses normalized entropy of the score distribution.
	 * Returns [0, 1] where 0 = crystal clear, 1 = completely ambiguous.
	 */
	computeAmbiguity(scores: Map<ManasIntent, number>): number {
		const values = Array.from(scores.values());
		const maxScore = Math.max(...values);

		// No intent matched at all → fully ambiguous
		if (maxScore === 0) return 1.0;

		// Count how many intents scored above a meaningful threshold
		const threshold = maxScore * 0.6;
		let competingIntents = 0;
		for (const score of values) {
			if (score >= threshold && score > 0) competingIntents++;
		}

		// Single dominant intent → low ambiguity
		// Multiple competing intents → high ambiguity
		// Also factor in absolute confidence (low max = more ambiguous)
		const competitionFactor = Math.min(1, (competingIntents - 1) / 3);
		const weaknessFactor = 1 - maxScore;

		// Weighted blend: competition matters more than weakness
		const ambiguity = competitionFactor * 0.7 + weaknessFactor * 0.3;

		return Math.round(ambiguity * 100) / 100; // 2 decimal places
	}

	// ─── Route Decision ─────────────────────────────────────────────

	/**
	 * Decide the processing route based on intent, features, ambiguity,
	 * and confidence. This is the core routing matrix.
	 *
	 * Route escalation:
	 *   tool-only < haiku < sonnet < opus
	 */
	decideRoute(
		intent: ManasIntent,
		features: ManasFeatures,
		ambiguityScore: number,
		confidence: number,
	): ManasRoute {
		// ─── Opus: high complexity or high ambiguity ──────────────
		if (ambiguityScore > 0.7) return "opus";
		if (features.multiStep && features.technical && features.wordCount > 100) return "opus";

		// ─── Tool-only: simple, specific tool operations ─────────
		if (intent === "search" && confidence >= 0.8) return "tool-only";
		if (intent === "file_operation" && features.hasFilePaths && confidence >= 0.8) return "tool-only";

		// ─── Haiku: simple queries ───────────────────────────────
		if (intent === "conversation") return "haiku";
		if (intent === "explanation" && features.wordCount <= 10 && !features.multiStep) return "haiku";
		if (intent === "file_operation" && !features.multiStep) return "haiku";
		if (intent === "search" && !features.multiStep) return "haiku";

		// ─── Sonnet: standard development tasks ──────────────────
		if (intent === "code_generation") return "sonnet";
		if (intent === "code_review") return "sonnet";
		if (intent === "refactoring") return "sonnet";
		if (intent === "documentation") return "sonnet";
		if (intent === "debugging") return "sonnet";
		if (intent === "system") return "sonnet";
		if (intent === "explanation" && features.wordCount > 20) return "sonnet";

		// Fallback: sonnet is the safe default for development work
		return "sonnet";
	}
}
