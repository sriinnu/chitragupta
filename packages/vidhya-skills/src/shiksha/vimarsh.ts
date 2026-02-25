/**
 * Vimarsh (विमर्श — Inquiry) — Zero-Cost Task Analyzer.
 *
 * Pure pattern-matching NLU that decomposes a user query into intents,
 * identifies candidate system utilities, and determines an execution
 * strategy — all in <1ms with zero LLM calls.
 *
 * ## Algorithm (3-pass)
 *
 * 1. **Verb extraction**: Match action verbs against known groups
 * 2. **Object extraction**: Noun-phrase patterns + domain keyword matching
 * 3. **Modifier extraction**: Prepositional phrases ("on my network")
 *
 * Then: intents -> candidate utilities -> strategy -> complexity.
 *
 * @packageDocumentation
 */

import type {
	TaskAnalysis,
	TaskDomain,
	IntentDecomposition,
	CandidateUtility,
	ExecutionStrategy,
} from "./types.js";
import { detectProviderFromQuery, detectServiceFromQuery } from "./megha.js";
import {
	VERB_GROUPS,
	VERB_LOOKUP,
	DOMAIN_KEYWORDS,
	UTILITY_MAP,
	MODIFIER_PATTERNS,
	STOPWORDS,
} from "./vimarsh-data.js";

// Re-export data constants and types for backward compatibility
export { UTILITY_MAP, VERB_GROUPS, VERB_LOOKUP, DOMAIN_KEYWORDS } from "./vimarsh-data.js";
export type { UtilityEntry } from "./vimarsh-data.js";

// ─── Analyzer ──────────────────────────────────────────────────────────────

/**
 * Analyze a user query into structured task information.
 *
 * Pure pattern matching — zero LLM calls, <1ms typical.
 *
 * @param query - Natural language user query.
 * @returns Structured task analysis.
 */
export function analyzeTask(query: string): TaskAnalysis {
	const normalized = query.trim().toLowerCase();
	const words = tokenize(normalized);

	// Pass 1: Extract intents (verb + object + modifier)
	const intents = extractIntents(normalized, words);

	// Pass 2: Detect domain from keywords
	const domain = detectDomain(words);

	// Pass 3: Find candidate utilities
	const candidateUtilities = findCandidateUtilities(query, domain);

	// Determine strategy
	const strategy = determineStrategy(intents, candidateUtilities, domain);

	// Estimate complexity
	const complexity = estimateComplexity(intents, candidateUtilities);

	// Compute overall confidence
	const confidence = computeConfidence(intents, candidateUtilities, domain);

	const result: TaskAnalysis = {
		query,
		intents,
		strategy,
		complexity,
		candidateUtilities,
		domain,
		confidence,
	};

	// Populate cloud context when domain is cloud
	if (domain === "cloud") {
		result.cloudContext = {
			requestedProvider: detectProviderFromQuery(words) ?? undefined,
			requestedService: detectServiceFromQuery(query, words) ?? undefined,
			detections: [], // populated by praptya during sourcing
		};
	}

	return result;
}

// ─── Pass 1: Intent Extraction ─────────────────────────────────────────────

function extractIntents(normalized: string, words: string[]): IntentDecomposition[] {
	const intents: IntentDecomposition[] = [];

	// Find all verbs in the query
	const verbPositions: Array<{ verb: string; index: number }> = [];
	for (let i = 0; i < words.length; i++) {
		const canonical = VERB_LOOKUP.get(words[i]);
		if (canonical) {
			verbPositions.push({ verb: canonical, index: i });
		}
	}

	// Also check for multi-word verb phrases
	for (const [canonical, synonyms] of VERB_GROUPS) {
		for (const syn of synonyms) {
			if (syn.includes(" ") && normalized.includes(syn)) {
				const idx = normalized.indexOf(syn);
				const wordIndex = normalized.slice(0, idx).split(/\s+/).length - 1;
				if (!verbPositions.some((v) => v.verb === canonical)) {
					verbPositions.push({ verb: canonical, index: wordIndex });
				}
			}
		}
	}

	if (verbPositions.length === 0) {
		// No verb found — treat entire query as an implicit "show/check"
		const object = extractObject(words, 0);
		const modifier = extractModifier(normalized);
		if (object) {
			intents.push({ verb: "check", object, modifier });
		}
		return intents;
	}

	// For each verb, extract its object and modifier
	for (const { verb, index } of verbPositions) {
		const object = extractObject(words, index);
		const modifier = extractModifier(normalized);
		if (object) {
			intents.push({ verb, object, modifier });
		}
	}

	// Deduplicate by verb+object
	const seen = new Set<string>();
	return intents.filter((intent) => {
		const key = `${intent.verb}:${intent.object}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function extractObject(words: string[], verbIndex: number): string | undefined {
	// Collect non-stopword tokens after the verb
	const objectWords: string[] = [];
	for (let i = verbIndex + 1; i < words.length; i++) {
		if (STOPWORDS.has(words[i])) continue;
		// Stop at prepositions that start modifiers
		if (/^(on|in|from|to|at|for|with|into|across|within)$/.test(words[i])) break;
		objectWords.push(words[i]);
		// Usually 1-3 word objects are enough
		if (objectWords.length >= 3) break;
	}

	return objectWords.length > 0 ? objectWords.join(" ") : undefined;
}

function extractModifier(query: string): string | undefined {
	for (const pattern of MODIFIER_PATTERNS) {
		const match = pattern.exec(query);
		if (match?.[2]) {
			return match[2].trim();
		}
	}
	return undefined;
}

// ─── Pass 2: Domain Detection ──────────────────────────────────────────────

function detectDomain(words: string[]): TaskDomain {
	const domainScores = new Map<TaskDomain, number>();

	for (const word of words) {
		const domain = DOMAIN_KEYWORDS.get(word);
		if (domain) {
			domainScores.set(domain, (domainScores.get(domain) ?? 0) + 1);
		}
	}

	if (domainScores.size === 0) return "unknown";

	// Return domain with highest score
	let best: TaskDomain = "unknown";
	let bestScore = 0;
	for (const [domain, score] of domainScores) {
		if (score > bestScore) {
			best = domain;
			bestScore = score;
		}
	}
	return best;
}

// ─── Pass 3: Candidate Utilities ───────────────────────────────────────────

function findCandidateUtilities(query: string, domain: TaskDomain): CandidateUtility[] {
	const candidates: CandidateUtility[] = [];

	for (const entry of UTILITY_MAP) {
		if (entry.pattern.test(query)) {
			// Domain match boost
			const domainBoost = entry.domain === domain ? 0.05 : 0;

			candidates.push({
				command: entry.command,
				template: entry.template,
				confidence: Math.min(1, entry.confidence + domainBoost),
				requiresPrivilege: entry.requiresPrivilege,
				requiresNetwork: entry.requiresNetwork,
				domain: entry.domain,
			});
		}
	}

	// Sort by confidence descending, deduplicate by command (keep highest)
	candidates.sort((a, b) => b.confidence - a.confidence);
	const seen = new Set<string>();
	return candidates.filter((c) => {
		if (seen.has(c.command)) return false;
		seen.add(c.command);
		return true;
	});
}

// ─── Strategy Determination ────────────────────────────────────────────────

function determineStrategy(
	intents: IntentDecomposition[],
	candidates: CandidateUtility[],
	domain: TaskDomain,
): ExecutionStrategy {
	if (candidates.length > 0) {
		if (candidates.length > 1 && intents.length > 1) {
			return "shell-pipeline";
		}
		return "shell-command";
	}

	if (domain === "dev") {
		return "builtin-tool";
	}

	if (intents.length === 0 || domain === "unknown") {
		return "llm-required";
	}

	return "code-generation";
}

// ─── Complexity Estimation ─────────────────────────────────────────────────

function estimateComplexity(
	intents: IntentDecomposition[],
	candidates: CandidateUtility[],
): TaskAnalysis["complexity"] {
	if (intents.length === 1 && candidates.length >= 1 && candidates[0].confidence >= 0.8) {
		return "trivial";
	}
	if (intents.length === 1 && candidates.length > 0) {
		return "simple";
	}
	if (intents.length > 1 && candidates.length > 0) {
		return "moderate";
	}
	return "complex";
}

// ─── Confidence Computation ────────────────────────────────────────────────

function computeConfidence(
	intents: IntentDecomposition[],
	candidates: CandidateUtility[],
	domain: TaskDomain,
): number {
	if (intents.length === 0) return 0.1;

	let confidence = 0;
	confidence += Math.min(0.3, intents.length * 0.15);

	if (candidates.length > 0) {
		confidence += candidates[0].confidence * 0.5;
	}

	if (domain !== "unknown") {
		confidence += 0.2;
	}

	return Math.min(1, confidence);
}

// ─── Tokenizer ─────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
	return text
		.replace(/[^\w\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 0);
}
