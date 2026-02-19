/**
 * Intent classification patterns, feature detection regexes, and stop words for Manas.
 * Extracted from manas.ts for maintainability.
 * @module manas-patterns
 */

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

/** Pattern entry for intent classification — first match wins when confidence is tied. */
export interface IntentPattern {
	intent: ManasIntent;
	pattern: RegExp;
	/** Base confidence when this pattern matches. */
	baseConfidence: number;
}

/**
 * Ordered intent patterns — more specific intents (file_operation, code_generation)
 * are checked before broader ones (explanation, conversation).
 */
export const INTENT_PATTERNS: IntentPattern[] = [
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

/** Fenced code blocks: \`\`\`...\`\`\` or ~~~...~~~ */
export const CODE_BLOCK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/;
/** Inline code: \`...\` */
export const INLINE_CODE_RE = /`[^`]+`/;
/** File paths: ./foo, ../bar, /abs/path, or windows C:\path */
export const FILE_PATH_RE = /(?:\.\.?\/[\w./-]+|\/[\w./-]{2,}|[A-Z]:\\[\w\\.-]+|\b[\w-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|c|cpp|h|rb|md|json|yaml|yml|toml|css|html|sh|txt|sql|xml|cfg|ini))\b/;
/** Error stack traces: "at Function.X (file:line:col)" or "Error: ..." */
export const ERROR_STACK_RE = /(?:\bat\s+[\w.]+\s*\(.*:\d+:\d+\)|(?:Error|Exception|TypeError|ReferenceError|SyntaxError|RangeError):\s)/i;
/** Multi-step indicators: "first...then...finally" or numbered steps */
export const MULTI_STEP_RE = /\b(?:first|then|next|after\s+that|finally|step\s+\d|1\.\s.*\n.*2\.)/i;
/** Technical jargon: programming terms */
export const TECHNICAL_RE = /\b(?:async|await|promise|callback|closure|mutex|semaphore|thread|process|socket|tcp|http|rest|graphql|grpc|orm|crud|sql|nosql|schema|migration|middleware|hook|decorator|generic|polymorphism|inheritance|interface|abstract|singleton|factory|observer|iterator|monad|functor|regex|algorithm|recursion|memoize|cache|hash|tree|graph|queue|stack|heap|runtime|compile|transpile|bundle|webpack|vite|rollup|esbuild|docker|container|pod|cluster|lambda|serverless|microservice|monolith|api|sdk|cli|tui|gui|ssr|ssr|csr|spa|pwa)\b/i;
/** Imperative verbs that typically start commands */
export const IMPERATIVE_VERBS = /^(?:read|write|edit|create|delete|remove|find|search|fix|debug|add|implement|build|make|generate|refactor|rename|move|extract|explain|describe|review|check|audit|deploy|install|run|compile|test|lint|format|update|upgrade|downgrade|rollback|revert|document|open|close|start|stop|restart|show|list|get|set|put|post|patch|configure|setup|initialize|bootstrap|scaffold|commit|push|pull|merge|rebase|tag|release)\b/i;

// ─── Stop Words ─────────────────────────────────────────────────────────────

export const STOP_WORDS = new Set([
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
