/**
 * NER Fact Extractor — Named Entity Recognition layer.
 *
 * Pure regex/heuristic detection — no external NLP libraries.
 * Detects: PERSON, PROJECT, TECHNOLOGY, ORGANIZATION, METRIC, DATE.
 *
 * Each entity carries a confidence score (0.8 base) and source="ner".
 * Designed to augment, not replace, the existing pattern/vector strategies.
 *
 * @module fact-extractor-ner
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Named entity types detectable by this module. */
export type NEREntityType =
	| "PERSON"
	| "PROJECT"
	| "TECHNOLOGY"
	| "ORGANIZATION"
	| "METRIC"
	| "DATE";

/** A detected named entity in text. */
export interface NEREntity {
	/** The matched text value. */
	value: string;
	/** Entity type classification. */
	type: NEREntityType;
	/** Confidence score 0-1. */
	confidence: number;
	/** Always "ner" for entities from this module. */
	source: "ner";
	/** Character start index in original text. */
	startIndex: number;
	/** Character end index in original text. */
	endIndex: number;
}

// ─── Technology Keywords ──────────────────────────────────────────────────────

/** Known technology keywords — case-insensitive substring match. */
const TECH_KEYWORDS: readonly string[] = [
	"TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin",
	"Swift", "Ruby", "PHP", "C#", "C++", "Scala", "Elixir", "Haskell",
	"React", "Vue", "Angular", "Svelte", "Next.js", "Nuxt", "Remix",
	"Node.js", "Deno", "Bun",
	"PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Cassandra", "DynamoDB",
	"Docker", "Kubernetes", "Terraform", "Ansible", "Helm",
	"GraphQL", "REST", "gRPC", "WebSocket", "tRPC", "OpenAPI",
	"GitHub", "GitLab", "Bitbucket",
	"AWS", "GCP", "Azure", "Vercel", "Netlify", "Railway", "Fly.io",
	"Webpack", "Vite", "esbuild", "Rollup", "Turbopack",
	"Jest", "Vitest", "Mocha", "Playwright", "Cypress",
	"ESLint", "Prettier", "Biome",
	"pnpm", "npm", "yarn", "pip", "cargo", "gradle", "maven",
	"Linux", "macOS", "Windows", "WSL",
];

// Regex for versioned tech: "React 18", "Node.js 22", "Python 3.11"
const TECH_VERSION_RE = /\b([A-Za-z][A-Za-z0-9._-]+)\s+v?(\d+)(\.\d+)*\b/g;

// ─── Detection Patterns ───────────────────────────────────────────────────────

/** Title + name: "Dr. Sarah Chen", "Prof. Alan Turing" */
const PERSON_TITLE_RE = /\b(Dr|Mr|Mrs|Ms|Prof|Sir|Mx)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;

/** Two or more capitalized words not at the very start of text */
const PERSON_NAME_RE = /(?<=[^.!?]\s|,\s|;\s)([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,2})\b/g;

/** camelCase compound: "myProject", "chitraguptaDaemon" */
const PROJECT_CAMEL_RE = /\b([a-z][a-zA-Z0-9]{2,}[A-Z][a-zA-Z0-9]+)\b/g;

/** kebab-case: "my-project", "chitragupta-daemon" */
const PROJECT_KEBAB_RE = /\b([a-z][a-z0-9]{1,}-[a-z][a-z0-9-]{1,})\b/g;

/** GitHub-style "owner/repo": "sriinnu/AUriva" */
const PROJECT_GITHUB_RE = /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)\b/g;

/** Company suffixes */
const ORG_SUFFIX_RE = /\b([A-Z][a-zA-Z\s]{1,30}(?:Inc|Corp|LLC|Ltd|GmbH|Co|Group|Labs|Technologies|Systems)\.?)\b/g;

/** ALL-CAPS 2-5 char acronyms (not at sentence start to reduce false positives) */
const ORG_ACRONYM_RE = /(?<=[^.!?]\s)([A-Z]{2,5})\b/g;

/** Number + unit: "45ms", "256MB", "95%", "3000 lines" */
const METRIC_RE = /\b(\d+(?:\.\d+)?\s*(?:ms|s|min|h|MB|GB|KB|TB|%|px|rem|em|rpm|rps|tps|LOC|lines?|tokens?|tests?|files?))/gi;

/** Relative dates */
const DATE_RELATIVE_RE = /\b(yesterday|today|tomorrow|last\s+(?:week|month|year|quarter)|next\s+(?:week|month|year|quarter)|this\s+(?:week|month|year))\b/gi;

/** Absolute dates: "March 5", "Mar 5, 2026" */
const DATE_ABSOLUTE_RE = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/gi;

// ─── Noise filters ────────────────────────────────────────────────────────────

/** Short tokens that commonly false-positive as tech/project names. */
const TECH_NOISE: ReadonlySet<string> = new Set([
	"I", "A", "The", "This", "That", "It", "If", "In", "Is", "On", "At",
	"API", "URL", "URI", "ID", "OK", "PR", "CI", "CD",
]);

// ─── Core extraction function ─────────────────────────────────────────────────

/**
 * Extract named entities from a text string.
 *
 * @param text - Input text to analyze.
 * @returns Array of detected NER entities, sorted by start index.
 */
export function extractNEREntities(text: string): NEREntity[] {
	const entities: NEREntity[] = [];
	const seen = new Set<string>(); // dedup by "value|type"

	function add(value: string, type: NEREntityType, confidence: number, start: number, end: number): void {
		const key = `${value.toLowerCase()}|${type}`;
		if (seen.has(key) || value.length < 2) return;
		seen.add(key);
		entities.push({ value, type, confidence, source: "ner", startIndex: start, endIndex: end });
	}

	// PERSON — titled names
	for (const m of text.matchAll(PERSON_TITLE_RE)) {
		add(m[0].trim(), "PERSON", 0.9, m.index!, m.index! + m[0].length);
	}

	// PERSON — bare capitalized name sequences (only if not already found)
	if (text.length > 20) {
		for (const m of text.matchAll(PERSON_NAME_RE)) {
			if (!TECH_NOISE.has(m[1]) && !/^[A-Z]{2,5}$/.test(m[1])) {
				add(m[1], "PERSON", 0.7, m.index!, m.index! + m[0].length);
			}
		}
	}

	// TECHNOLOGY — known keyword list
	const lowerText = text.toLowerCase();
	for (const kw of TECH_KEYWORDS) {
		const idx = lowerText.indexOf(kw.toLowerCase());
		if (idx !== -1) {
			add(kw, "TECHNOLOGY", 0.85, idx, idx + kw.length);
		}
	}

	// TECHNOLOGY — versioned: "React 18"
	for (const m of text.matchAll(TECH_VERSION_RE)) {
		if (!TECH_NOISE.has(m[1])) {
			add(m[0].trim(), "TECHNOLOGY", 0.85, m.index!, m.index! + m[0].length);
		}
	}

	// PROJECT — camelCase
	for (const m of text.matchAll(PROJECT_CAMEL_RE)) {
		if (!TECH_NOISE.has(m[1])) {
			add(m[1], "PROJECT", 0.75, m.index!, m.index! + m[0].length);
		}
	}

	// PROJECT — kebab-case
	for (const m of text.matchAll(PROJECT_KEBAB_RE)) {
		add(m[1], "PROJECT", 0.75, m.index!, m.index! + m[0].length);
	}

	// PROJECT — GitHub owner/repo
	for (const m of text.matchAll(PROJECT_GITHUB_RE)) {
		add(m[1], "PROJECT", 0.85, m.index!, m.index! + m[0].length);
	}

	// ORGANIZATION — suffix-based
	for (const m of text.matchAll(ORG_SUFFIX_RE)) {
		add(m[1].trim(), "ORGANIZATION", 0.85, m.index!, m.index! + m[0].length);
	}

	// ORGANIZATION — ALL-CAPS acronyms
	for (const m of text.matchAll(ORG_ACRONYM_RE)) {
		if (!TECH_NOISE.has(m[1])) {
			add(m[1], "ORGANIZATION", 0.7, m.index!, m.index! + m[0].length);
		}
	}

	// METRIC — number + unit
	for (const m of text.matchAll(METRIC_RE)) {
		add(m[1].trim(), "METRIC", 0.9, m.index!, m.index! + m[0].length);
	}

	// DATE — relative
	for (const m of text.matchAll(DATE_RELATIVE_RE)) {
		add(m[1].toLowerCase(), "DATE", 0.85, m.index!, m.index! + m[0].length);
	}

	// DATE — absolute
	for (const m of text.matchAll(DATE_ABSOLUTE_RE)) {
		add(m[0].trim(), "DATE", 0.85, m.index!, m.index! + m[0].length);
	}

	return entities.sort((a, b) => a.startIndex - b.startIndex);
}

// ─── Jaccard similarity helper ────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two token sets.
 * Used for deduplication when merging NER results with existing facts.
 */
export function jaccardNER(a: string, b: string): number {
	const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
	if (setA.size === 0 && setB.size === 0) return 1;
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const t of setA) if (setB.has(t)) intersection++;
	return intersection / (setA.size + setB.size - intersection);
}
