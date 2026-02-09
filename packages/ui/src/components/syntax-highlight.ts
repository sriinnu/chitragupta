/**
 * @chitragupta/ui — Per-language syntax highlighting for code blocks.
 *
 * Extracted from markdown.ts to keep file sizes manageable.
 * Provides tokenizers for TypeScript/JavaScript, Python, Rust, Go,
 * Bash, JSON, CSS, HTML/XML, plus a generic fallback highlighter
 * and language auto-detection heuristics.
 */

// ─── Syntax Highlight Colors ─────────────────────────────────────────────────

export const SYN = {
	keyword: "\x1b[38;5;198m",
	string: "\x1b[38;5;143m",
	comment: "\x1b[38;5;240m",
	number: "\x1b[38;5;141m",
	operator: "\x1b[38;5;249m",
	type: "\x1b[38;5;81m",
	function: "\x1b[38;5;186m",
	decorator: "\x1b[38;5;208m",
	macro: "\x1b[38;5;208m",
	variable: "\x1b[38;5;215m",
	tag: "\x1b[38;5;198m",
	attribute: "\x1b[38;5;186m",
	selector: "\x1b[38;5;186m",
	property: "\x1b[38;5;81m",
	value: "\x1b[38;5;143m",
	key: "\x1b[38;5;81m",
	boolean: "\x1b[38;5;141m",
	null: "\x1b[38;5;141m",
	base: "\x1b[38;5;253m",
} as const;

export interface Token { text: string; style: string; }

interface TokenRule {
	pattern: RegExp;
	style?: string;
	classify?: (match: string) => string | null;
}

function tokenizeWithRules(line: string, rules: TokenRule[]): Token[] {
	interface Match {
		start: number;
		end: number;
		text: string;
		style: string;
	}

	const matches: Match[] = [];

	for (const rule of rules) {
		const re = new RegExp(rule.pattern.source, rule.pattern.flags);
		let m: RegExpExecArray | null;
		m = re.exec(line);
		while (m !== null) {
			let style: string | null = null;
			if (rule.classify) {
				style = rule.classify(m[0]);
			} else if (rule.style) {
				style = rule.style;
			}
			if (style !== null) {
				matches.push({
					start: m.index,
					end: m.index + m[0].length,
					text: m[0],
					style,
				});
			}
			m = re.exec(line);
		}
	}

	// Sort by start position, then by length descending (prefer longer matches)
	matches.sort((a, b) => a.start - b.start || b.end - a.end);

	// Build tokens, skipping overlapping matches
	const tokens: Token[] = [];
	let pos = 0;

	for (const match of matches) {
		if (match.start < pos) continue; // Skip overlapping

		if (match.start > pos) {
			tokens.push({ text: line.slice(pos, match.start), style: SYN.base });
		}

		tokens.push({ text: match.text, style: match.style });
		pos = match.end;
	}

	if (pos < line.length) {
		tokens.push({ text: line.slice(pos), style: SYN.base });
	}

	return tokens;
}

function renderTokens(tokens: Token[]): string {
	if (tokens.length === 0) return "";
	let result = "";
	for (const token of tokens) {
		result += `${token.style}${token.text}`;
	}
	result += SYN.base;
	return result;
}

// ─── TypeScript / JavaScript Highlighter ─────────────────────────────────────

const TS_KEYWORDS = new Set([
	"const", "let", "var", "function", "class", "return", "if", "else",
	"for", "while", "import", "export", "from", "async", "await",
	"type", "interface", "enum", "new", "this", "throw", "try", "catch",
	"finally", "switch", "case", "break", "continue", "default", "do",
	"in", "of", "typeof", "instanceof", "extends", "implements",
	"static", "get", "set", "yield", "super", "as", "is", "declare",
	"readonly", "abstract", "override", "satisfies", "keyof", "infer",
	"delete", "void", "debugger", "with",
]);

const TS_TYPES = new Set([
	"string", "number", "boolean", "void", "null", "undefined", "any",
	"never", "unknown", "object", "symbol", "bigint", "Array", "Promise",
	"Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Map",
	"Set", "true", "false",
]);

function tokenizeTypeScript(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /\/\/.*$/gm, style: SYN.comment },
		{ pattern: /\/\*[\s\S]*?\*\//gm, style: SYN.comment },
		{ pattern: /`(?:[^`\\]|\\.)*`/g, style: SYN.string },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?n?\b/g, style: SYN.number },
		{ pattern: /\b0x[0-9a-fA-F]+\b/g, style: SYN.number },
		{
			pattern: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g,
			classify: (m: string) => {
				if (TS_KEYWORDS.has(m)) return SYN.keyword;
				if (TS_TYPES.has(m)) return SYN.type;
				return null;
			},
		},
		{ pattern: /[=!<>]=?|&&|\|\||[+\-*/%&|^~?:]+|=>|\.{3}/g, style: SYN.operator },
	]);
}

// ─── Python Highlighter ──────────────────────────────────────────────────────

const PY_KEYWORDS = new Set([
	"def", "class", "import", "from", "return", "if", "elif", "else",
	"for", "while", "try", "except", "finally", "with", "as", "yield",
	"lambda", "async", "await", "pass", "break", "continue", "raise",
	"del", "global", "nonlocal", "assert", "in", "not", "and", "or",
	"is", "True", "False", "None",
]);

function tokenizePython(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /#.*$/gm, style: SYN.comment },
		{ pattern: /"""[\s\S]*?"""/gm, style: SYN.string },
		{ pattern: /'''[\s\S]*?'''/gm, style: SYN.string },
		{ pattern: /f"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /f'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /@[a-zA-Z_][a-zA-Z0-9_.]*(?:\([^)]*\))?/g, style: SYN.decorator },
		{ pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?j?\b/g, style: SYN.number },
		{
			pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,
			classify: (m: string) => {
				if (PY_KEYWORDS.has(m)) return SYN.keyword;
				return null;
			},
		},
		{ pattern: /[=!<>]=?|[+\-*/%&|^~@]+|->|:=|\.{3}/g, style: SYN.operator },
	]);
}

// ─── Rust Highlighter ────────────────────────────────────────────────────────

const RUST_KEYWORDS = new Set([
	"fn", "let", "mut", "struct", "impl", "enum", "match", "pub",
	"use", "mod", "self", "super", "crate", "unsafe", "async",
	"await", "where", "trait", "for", "while", "loop", "if", "else",
	"return", "break", "continue", "move", "ref", "type", "const",
	"static", "extern", "as", "in", "dyn", "box", "macro_rules",
	"true", "false",
]);

function tokenizeRust(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /\/\/.*$/gm, style: SYN.comment },
		{ pattern: /\/\*[\s\S]*?\*\//gm, style: SYN.comment },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /r#*"[\s\S]*?"#*/g, style: SYN.string },
		{ pattern: /'[^'\\]'/g, style: SYN.string },
		{ pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?(?:_\d+)*(?:f32|f64|i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize)?\b/g, style: SYN.number },
		{ pattern: /\b0x[0-9a-fA-F_]+\b/g, style: SYN.number },
		{ pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*!/g, style: SYN.macro },
		{
			pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,
			classify: (m: string) => {
				if (RUST_KEYWORDS.has(m)) return SYN.keyword;
				return null;
			},
		},
		{ pattern: /[=!<>]=?|&&|\|\||[+\-*/%&|^~?]+|=>|::|\.{2,3}/g, style: SYN.operator },
	]);
}

// ─── Go Highlighter ──────────────────────────────────────────────────────────

const GO_KEYWORDS = new Set([
	"func", "var", "const", "type", "struct", "interface", "map",
	"chan", "go", "defer", "select", "package", "import", "return",
	"if", "else", "for", "switch", "case", "default", "break",
	"continue", "range", "fallthrough", "goto", "nil", "true", "false",
]);

function tokenizeGo(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /\/\/.*$/gm, style: SYN.comment },
		{ pattern: /\/\*[\s\S]*?\*\//gm, style: SYN.comment },
		{ pattern: /`[^`]*`/g, style: SYN.string },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, style: SYN.number },
		{ pattern: /\b0x[0-9a-fA-F]+\b/g, style: SYN.number },
		{
			pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,
			classify: (m: string) => {
				if (GO_KEYWORDS.has(m)) return SYN.keyword;
				return null;
			},
		},
		{ pattern: /[=!<>]=?|&&|\|\||[+\-*/%&|^~]+|:=|<-/g, style: SYN.operator },
	]);
}

// ─── Bash / Shell Highlighter ────────────────────────────────────────────────

const BASH_KEYWORDS = new Set([
	"if", "then", "else", "elif", "fi", "for", "do", "done", "while",
	"until", "case", "esac", "function", "in", "select", "return",
	"exit", "local", "export", "source", "alias", "unset", "readonly",
	"declare", "typeset", "shift", "trap",
]);

function tokenizeBash(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /#.*$/gm, style: SYN.comment },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'[^']*'/g, style: SYN.string },
		{ pattern: /\$\{[^}]*\}/g, style: SYN.variable },
		{ pattern: /\$[a-zA-Z_][a-zA-Z0-9_]*/g, style: SYN.variable },
		{ pattern: /\$[0-9@#?!$*-]/g, style: SYN.variable },
		{ pattern: /\b\d+\b/g, style: SYN.number },
		{
			pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,
			classify: (m: string) => {
				if (BASH_KEYWORDS.has(m)) return SYN.keyword;
				return null;
			},
		},
		{ pattern: /[|&;><]+|&&|\|\|/g, style: SYN.operator },
	]);
}

// ─── JSON Highlighter ────────────────────────────────────────────────────────

function tokenizeJSON(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /"(?:[^"\\]|\\.)*"\s*(?=:)/g, style: SYN.key },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, style: SYN.number },
		{ pattern: /\btrue\b|\bfalse\b/g, style: SYN.boolean },
		{ pattern: /\bnull\b/g, style: SYN.null },
	]);
}

// ─── CSS Highlighter ─────────────────────────────────────────────────────────

function tokenizeCSS(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /\/\*[\s\S]*?\*\//gm, style: SYN.comment },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /#[0-9a-fA-F]{3,8}\b/g, style: SYN.number },
		{ pattern: /\b\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|deg|rad|grad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx|fr)?\b/g, style: SYN.number },
		{ pattern: /[.#][a-zA-Z_-][a-zA-Z0-9_-]*/g, style: SYN.selector },
		{ pattern: /[a-zA-Z-]+(?=\s*:)/g, style: SYN.property },
		{ pattern: /[:;{}(),]/g, style: SYN.operator },
	]);
}

// ─── HTML / XML Highlighter ──────────────────────────────────────────────────

function tokenizeHTML(line: string): Token[] {
	return tokenizeWithRules(line, [
		{ pattern: /<!--[\s\S]*?-->/gm, style: SYN.comment },
		{ pattern: /"[^"]*"/g, style: SYN.string },
		{ pattern: /'[^']*'/g, style: SYN.string },
		{ pattern: /<\/?[a-zA-Z][a-zA-Z0-9-]*/g, style: SYN.tag },
		{ pattern: /\/?>/g, style: SYN.tag },
		{ pattern: /\b[a-zA-Z_-][a-zA-Z0-9_-]*(?=\s*=)/g, style: SYN.attribute },
	]);
}

// ─── Language Detection Heuristic ────────────────────────────────────────────

/** Detect programming language from code content heuristically */
export function detectLanguage(code: string): string {
	const lines = code.split("\n");
	const joined = code.toLowerCase();
	const firstLine = lines[0]?.trim() ?? "";

	// Shebang detection
	if (firstLine.startsWith("#!")) {
		if (firstLine.includes("python")) return "python";
		if (firstLine.includes("node") || firstLine.includes("ts-node") || firstLine.includes("deno")) return "typescript";
		if (firstLine.includes("bash") || firstLine.includes("sh") || firstLine.includes("zsh")) return "bash";
		return "bash";
	}

	// JSON detection
	if ((firstLine.startsWith("{") || firstLine.startsWith("[")) && (code.includes('"') && code.includes(":"))) {
		try { JSON.parse(code); return "json"; } catch { /* not valid JSON */ }
	}

	// HTML/XML detection
	if (firstLine.startsWith("<!DOCTYPE") || firstLine.startsWith("<html") || firstLine.startsWith("<?xml") || /<[a-zA-Z][^>]*>/.test(firstLine)) {
		return "html";
	}

	// Language-specific keyword scoring
	let tsScore = 0, pyScore = 0, rustScore = 0, goScore = 0, bashScore = 0, cssScore = 0;

	// TypeScript / JavaScript
	if (/\b(const|let|var)\s+\w+\s*[=:]/.test(code)) tsScore += 3;
	if (/\b(function|class)\s+\w+/.test(code)) tsScore += 2;
	if (/=>\s*[{(]/.test(code)) tsScore += 3;
	if (/\b(interface|type)\s+\w+/.test(code)) tsScore += 5;
	if (/\bimport\s+.*\s+from\s+['"]/.test(code)) tsScore += 3;
	if (/\bexport\s+(default|const|function|class|interface|type)\b/.test(code)) tsScore += 3;
	if (/\bconsole\.\w+/.test(code)) tsScore += 2;
	if (/:\s*(string|number|boolean|void|any|unknown|never)\b/.test(code)) tsScore += 5;

	// Python
	if (/\bdef\s+\w+\s*\(/.test(code)) pyScore += 5;
	if (/\bclass\s+\w+.*:$/.test(joined)) pyScore += 3;
	if (/\bimport\s+\w+/.test(code) && !/\bfrom\s+['"]/.test(code)) pyScore += 2;
	if (/\bfrom\s+\w+\s+import\b/.test(code)) pyScore += 5;
	if (/\b(elif|except|lambda)\b/.test(code)) pyScore += 5;
	if (/^\s*@\w+/.test(code)) pyScore += 3;
	if (/\bself\.\w+/.test(code)) pyScore += 3;
	if (/\bprint\s*\(/.test(code)) pyScore += 2;

	// Rust
	if (/\bfn\s+\w+/.test(code)) rustScore += 5;
	if (/\blet\s+mut\b/.test(code)) rustScore += 5;
	if (/\b(impl|struct|trait|enum)\s+\w+/.test(code)) rustScore += 4;
	if (/\b(pub\s+fn|pub\s+struct|pub\s+enum)\b/.test(code)) rustScore += 5;
	if (/\buse\s+\w+::/.test(code)) rustScore += 4;
	if (/\w+![\s(]/.test(code)) rustScore += 2;
	if (/->/.test(code) && /\bfn\b/.test(code)) rustScore += 3;

	// Go
	if (/\bfunc\s+(\(\w+\s+\*?\w+\)\s+)?\w+/.test(code)) goScore += 5;
	if (/\bpackage\s+\w+/.test(code)) goScore += 5;
	if (/\b(go|defer|chan|select)\b/.test(code)) goScore += 5;
	if (/:=/.test(code)) goScore += 3;
	if (/\bfmt\.\w+/.test(code)) goScore += 3;

	// Bash
	if (/\b(fi|esac|done|then)\b/.test(code)) bashScore += 5;
	if (/\$\{?\w+\}?/.test(code)) bashScore += 2;
	if (/\b(echo|grep|sed|awk|curl|wget|apt|yum|brew|npm|yarn)\b/.test(code)) bashScore += 2;
	if (/\|\s*\w+/.test(code)) bashScore += 1;

	// CSS
	if (/[.#]\w+\s*\{/.test(code)) cssScore += 4;
	if (/\b(margin|padding|display|color|font|background|border)\s*:/.test(joined)) cssScore += 4;
	if (/@(media|keyframes|import)\b/.test(code)) cssScore += 5;

	const scores: Array<[string, number]> = [
		["typescript", tsScore], ["python", pyScore], ["rust", rustScore],
		["go", goScore], ["bash", bashScore], ["css", cssScore],
	];

	scores.sort((a, b) => b[1] - a[1]);
	if (scores[0][1] >= 3) return scores[0][0];

	return "";
}

// ─── Language Highlighter Dispatch ───────────────────────────────────────────

function getHighlighter(lang: string): ((line: string) => Token[]) | null {
	const normalized = lang.toLowerCase().trim();
	switch (normalized) {
		case "typescript": case "ts": case "javascript": case "js": case "jsx": case "tsx":
			return tokenizeTypeScript;
		case "python": case "py":
			return tokenizePython;
		case "rust": case "rs":
			return tokenizeRust;
		case "go": case "golang":
			return tokenizeGo;
		case "bash": case "sh": case "shell": case "zsh":
			return tokenizeBash;
		case "json": case "jsonc":
			return tokenizeJSON;
		case "css": case "scss": case "less":
			return tokenizeCSS;
		case "html": case "htm": case "xml": case "svg": case "vue": case "svelte":
			return tokenizeHTML;
		default:
			return null;
	}
}

function highlightGeneric(line: string): string {
	const tokens = tokenizeWithRules(line, [
		{ pattern: /\/\/.*$/gm, style: SYN.comment },
		{ pattern: /#.*$/gm, style: SYN.comment },
		{ pattern: /"(?:[^"\\]|\\.)*"/g, style: SYN.string },
		{ pattern: /'(?:[^'\\]|\\.)*'/g, style: SYN.string },
		{ pattern: /`(?:[^`\\]|\\.)*`/g, style: SYN.string },
		{ pattern: /\b\d+\.?\d*\b/g, style: SYN.number },
	]);
	return renderTokens(tokens);
}

/** Highlight a single line of code for the given language */
export function highlightCodeLine(line: string, lang: string): string {
	const highlighter = getHighlighter(lang);
	if (!highlighter) {
		return highlightGeneric(line);
	}
	const tokens = highlighter(line);
	return renderTokens(tokens);
}
