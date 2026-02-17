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
 * Then: intents → candidate utilities → strategy → complexity.
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

// ─── Verb Groups ───────────────────────────────────────────────────────────

/** Maps synonym groups to canonical verbs. */
const VERB_GROUPS: ReadonlyMap<string, string[]> = new Map([
	["check", ["check", "verify", "inspect", "examine", "test", "validate"]],
	["scan", ["scan", "probe", "sweep", "detect", "discover"]],
	["list", ["list", "show", "display", "enumerate", "print", "get", "view"]],
	["find", ["find", "search", "locate", "look", "lookup", "seek", "where"]],
	["count", ["count", "tally", "number", "how many", "total"]],
	["measure", ["measure", "size", "space", "usage", "capacity", "how much", "how big"]],
	["monitor", ["monitor", "watch", "track", "observe", "follow"]],
	["kill", ["kill", "stop", "terminate", "end", "cancel", "abort"]],
	["analyze", ["analyze", "analyse", "diagnose", "debug", "profile", "benchmark"]],
	["read", ["read", "cat", "view", "open", "contents"]],
	["create", ["create", "make", "generate", "new", "init", "initialize"]],
	["delete", ["delete", "remove", "rm", "clean", "purge", "wipe"]],
	["convert", ["convert", "transform", "encode", "decode", "format", "parse"]],
	["compare", ["compare", "diff", "difference", "changes"]],
	["compress", ["compress", "zip", "archive", "tar", "gzip"]],
	["download", ["download", "fetch", "pull", "grab", "wget", "curl"]],
	["sort", ["sort", "order", "arrange", "rank"]],
	["filter", ["filter", "grep", "select", "extract", "pick"]],
]);

/** Flat lookup: word → canonical verb. */
const VERB_LOOKUP: ReadonlyMap<string, string> = (() => {
	const m = new Map<string, string>();
	for (const [canonical, synonyms] of VERB_GROUPS) {
		for (const syn of synonyms) {
			m.set(syn, canonical);
		}
	}
	return m;
})();

// ─── Domain Keywords ───────────────────────────────────────────────────────

/** Keywords that map to task domains. */
const DOMAIN_KEYWORDS: ReadonlyMap<string, TaskDomain> = new Map([
	// Network
	["network", "network"], ["device", "network"], ["ip", "network"],
	["port", "network"], ["dns", "network"], ["host", "network"],
	["connection", "network"], ["socket", "network"], ["ping", "network"],
	["arp", "network"], ["route", "network"], ["interface", "network"],
	["wifi", "network"], ["ethernet", "network"], ["bandwidth", "network"],
	["latency", "network"], ["subnet", "network"], ["gateway", "network"],
	["firewall", "network"], ["tcp", "network"], ["udp", "network"],
	["http", "network"], ["url", "network"], ["domain", "network"],
	// Files
	["file", "files"], ["directory", "files"], ["folder", "files"],
	["disk", "files"], ["storage", "files"], ["path", "files"],
	["size", "files"], ["extension", "files"], ["permission", "files"],
	["line", "files"], ["word", "files"], ["byte", "files"],
	["duplicate", "files"], ["empty", "files"], ["large", "files"],
	["recent", "files"], ["modified", "files"],
	// System
	["process", "system"], ["cpu", "system"], ["memory", "system"],
	["ram", "system"], ["uptime", "system"], ["user", "system"],
	["kernel", "system"], ["os", "system"], ["load", "system"],
	["service", "system"], ["daemon", "system"], ["pid", "system"],
	["swap", "system"], ["temperature", "system"], ["battery", "system"],
	// Dev
	["git", "dev"], ["npm", "dev"], ["node", "dev"], ["docker", "dev"],
	["package", "dev"], ["dependency", "dev"], ["build", "dev"],
	["test", "dev"], ["commit", "dev"], ["branch", "dev"],
	["merge", "dev"], ["compile", "dev"], ["lint", "dev"],
	["typescript", "dev"], ["python", "dev"], ["rust", "dev"],
	["container", "dev"], ["image", "dev"],
	// Text
	["json", "text"], ["csv", "text"], ["yaml", "text"], ["xml", "text"],
	["base64", "text"], ["hash", "text"], ["checksum", "text"],
	["regex", "text"], ["pattern", "text"], ["column", "text"],
	["field", "text"], ["delimiter", "text"], ["encode", "text"],
	["decode", "text"], ["md5", "text"], ["sha", "text"],
	// Cloud
	["aws", "cloud"], ["amazon", "cloud"], ["azure", "cloud"],
	["gcp", "cloud"], ["gcloud", "cloud"], ["cloud", "cloud"],
	["s3", "cloud"], ["ec2", "cloud"], ["lambda", "cloud"],
	["blob", "cloud"], ["bucket", "cloud"], ["kubernetes", "cloud"],
	["k8s", "cloud"], ["terraform", "cloud"], ["serverless", "cloud"],
	["provision", "cloud"], ["infrastructure", "cloud"],
	["deploy", "cloud"], ["cloudfront", "cloud"], ["route53", "cloud"],
	["rds", "cloud"], ["dynamodb", "cloud"], ["eks", "cloud"],
	["aks", "cloud"], ["gke", "cloud"], ["cloudflare", "cloud"],
	["wrangler", "cloud"], ["digitalocean", "cloud"], ["droplet", "cloud"],
	["cloudformation", "cloud"], ["cloudwatch", "cloud"],
]);

// ─── Utility Map ───────────────────────────────────────────────────────────

/** System utility entries keyed by domain. */
interface UtilityEntry {
	command: string;
	pattern: RegExp;
	template: string;
	confidence: number;
	requiresPrivilege: boolean;
	requiresNetwork: boolean;
	domain: TaskDomain;
}

const UTILITY_MAP: ReadonlyArray<UtilityEntry> = [
	// ─── Network ─────────────────────────────────────────────────
	{ command: "arp", pattern: /\b(devices?|neighbors?|arp)\b.*\b(network|lan|local|subnet)\b/i, template: "arp -a", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "network" },
	{ command: "arp", pattern: /\b(network|lan)\b.*\b(devices?|hosts?)\b/i, template: "arp -a", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "network" },
	{ command: "ping", pattern: /\bping\b/i, template: "ping -c 4 {host}", confidence: 0.95, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "traceroute", pattern: /\b(traceroute|trace\s*route|hops?)\b/i, template: "traceroute {host}", confidence: 0.9, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "netstat", pattern: /\b(ports?|connections?|listening|netstat)\b/i, template: "netstat -tlnp", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "network" },
	{ command: "ss", pattern: /\b(sockets?|ss)\b/i, template: "ss -tlnp", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "network" },
	{ command: "ifconfig", pattern: /\b(interfaces?|ifconfig|ip\s+addr)\b/i, template: "ifconfig", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "network" },
	{ command: "curl", pattern: /\b(curl|http\s+get|fetch\s+url|download\s+url)\b/i, template: "curl -s {url}", confidence: 0.9, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "dig", pattern: /\b(dig|dns\s+lookup|resolve|nslookup)\b/i, template: "dig {domain}", confidence: 0.9, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "nslookup", pattern: /\bnslookup\b/i, template: "nslookup {domain}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "wget", pattern: /\b(wget|download\s+file)\b/i, template: "wget {url}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: true, domain: "network" },
	{ command: "nmap", pattern: /\b(nmap|port\s*scan|network\s*scan)\b/i, template: "nmap -sn {target}", confidence: 0.9, requiresPrivilege: true, requiresNetwork: true, domain: "network" },

	// ─── Files ───────────────────────────────────────────────────
	{ command: "find", pattern: /\b(find|locate)\b.*\bfiles?\b/i, template: "find . -name '{pattern}'", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "find", pattern: /\bfiles?\b.*\b(named?|called|matching)\b/i, template: "find . -name '{pattern}'", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "grep", pattern: /\b(grep|search\s+(for|in)|contain(s|ing)?)\b/i, template: "grep -rn '{pattern}' .", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "wc", pattern: /\b(count|lines?|words?|characters?)\b.*\b(file|in)\b/i, template: "wc -l {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "du", pattern: /\b(directory\s+size|folder\s+size|space\s+used)\b/i, template: "du -sh {path}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "df", pattern: /\b(disk\s+space|free\s+space|storage|disk\s+usage|space\s+left|available\s+space)\b/i, template: "df -h", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "stat", pattern: /\b(file\s+info|metadata|permissions?|file\s+details?)\b/i, template: "stat {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "file", pattern: /\b(file\s+type|mime\s+type|what\s+type)\b/i, template: "file {path}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "head", pattern: /\b(first|top|head|beginning)\b.*\blines?\b/i, template: "head -n 10 {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "tail", pattern: /\b(last|bottom|tail|end)\b.*\blines?\b/i, template: "tail -n 10 {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "sort", pattern: /\bsort\b.*\b(file|lines?|data)\b/i, template: "sort {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "tree", pattern: /\b(tree|directory\s+structure|folder\s+tree)\b/i, template: "tree -L 3", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "files" },
	{ command: "ls", pattern: /\b(list|show)\b.*\b(files?|directory|folder|contents?)\b/i, template: "ls -la", confidence: 0.75, requiresPrivilege: false, requiresNetwork: false, domain: "files" },

	// ─── System ──────────────────────────────────────────────────
	{ command: "ps", pattern: /\b(process(es)?|running|ps)\b/i, template: "ps aux", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "top", pattern: /\b(top|cpu\s+usage|resource\s+usage)\b/i, template: "top -l 1 -n 10", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "lsof", pattern: /\b(open\s+files?|lsof|file\s+handles?)\b/i, template: "lsof -i", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "uname", pattern: /\b(os|kernel|system\s+info|uname|operating\s+system)\b/i, template: "uname -a", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "uptime", pattern: /\b(uptime|how\s+long|running\s+since)\b/i, template: "uptime", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "who", pattern: /\b(who|logged\s+in|users?\s+online)\b/i, template: "who", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "free", pattern: /\b(free\s+memory|available\s+memory|ram\s+usage|memory\s+usage)\b/i, template: "free -h", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "system" },
	{ command: "kill", pattern: /\bkill\b.*\b(process|pid)\b/i, template: "kill {pid}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "system" },

	// ─── Dev ─────────────────────────────────────────────────────
	{ command: "git", pattern: /\bgit\s+(status|log|diff|branch|stash)\b/i, template: "git {subcommand}", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "dev" },
	{ command: "npm", pattern: /\bnpm\s+(list|ls|outdated|audit)\b/i, template: "npm {subcommand}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "dev" },
	{ command: "node", pattern: /\bnode\s+(--version|version|-v)\b/i, template: "node --version", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "dev" },
	{ command: "docker", pattern: /\bdocker\s+(ps|images|logs|stats)\b/i, template: "docker {subcommand}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "dev" },
	{ command: "tsc", pattern: /\b(typescript|tsc|type\s+check)\b/i, template: "npx tsc --noEmit", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "dev" },

	// ─── Text ────────────────────────────────────────────────────
	{ command: "jq", pattern: /\b(jq|json\s+query|parse\s+json|json\s+filter)\b/i, template: "jq '{filter}' {file}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "base64", pattern: /\bbase64\b/i, template: "echo '{input}' | base64", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "md5sum", pattern: /\b(md5|md5sum|md5\s+hash)\b/i, template: "md5sum {file}", confidence: 0.9, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "sha256sum", pattern: /\b(sha256|sha\s+256|sha256sum|checksum)\b/i, template: "sha256sum {file}", confidence: 0.85, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "awk", pattern: /\b(awk|column|field|delimiter)\b/i, template: "awk '{print $1}' {file}", confidence: 0.75, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "sed", pattern: /\b(sed|replace|substitute)\b.*\b(text|string|pattern)\b/i, template: "sed 's/{from}/{to}/g' {file}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "text" },
	{ command: "cut", pattern: /\b(cut|extract\s+field|split)\b/i, template: "cut -d'{delim}' -f{field} {file}", confidence: 0.75, requiresPrivilege: false, requiresNetwork: false, domain: "text" },

	// ─── Cloud ───────────────────────────────────────────────────
	{ command: "aws", pattern: /\b(aws|amazon|s3|ec2|lambda|rds|cloudfront|route53|dynamodb|eks|cloudwatch|cloudformation)\b/i, template: "aws {subcommand}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: true, domain: "cloud" },
	{ command: "az", pattern: /\b(azure|az|blob|arm\s+template|aks)\b/i, template: "az {subcommand}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: true, domain: "cloud" },
	{ command: "gcloud", pattern: /\b(gcp|google\s+cloud|gcloud|gke|bigquery|cloud\s+sql)\b/i, template: "gcloud {subcommand}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: true, domain: "cloud" },
	{ command: "kubectl", pattern: /\b(kubernetes|k8s|kubectl|pod|deployment|service|namespace)\b/i, template: "kubectl {subcommand}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: true, domain: "cloud" },
	{ command: "terraform", pattern: /\b(terraform|tf\s+apply|tf\s+plan|iac|infra\s+as\s+code)\b/i, template: "terraform {subcommand}", confidence: 0.8, requiresPrivilege: false, requiresNetwork: false, domain: "cloud" },
];

// ─── Preposition Patterns ──────────────────────────────────────────────────

const MODIFIER_PATTERNS: ReadonlyArray<RegExp> = [
	/\b(on|in|from|to|at|for|with|of|into|across|within|under|over)\s+(?:my\s+|the\s+|this\s+)?(.+)$/i,
	/\b(on my|in my|in this|from my|on the|in the)\s+(.+)$/i,
];

// ─── Stopwords ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
	"a", "an", "the", "my", "this", "that", "these", "those",
	"is", "are", "was", "were", "be", "been", "being",
	"do", "does", "did", "doing", "done",
	"have", "has", "had", "having",
	"can", "could", "would", "should", "will", "shall", "may", "might",
	"i", "me", "we", "us", "you", "he", "she", "it", "they", "them",
	"what", "which", "who", "whom", "whose",
	"please", "just", "also", "now", "currently", "right",
	"want", "need", "like", "tell", "give", "let",
]);

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
	// If we have candidate utilities, it's a shell command
	if (candidates.length > 0) {
		// Multiple commands chained → pipeline
		if (candidates.length > 1 && intents.length > 1) {
			return "shell-pipeline";
		}
		return "shell-command";
	}

	// If domain is dev, might be a builtin tool
	if (domain === "dev") {
		return "builtin-tool";
	}

	// No match — needs code generation or LLM
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
	// Single intent with high-confidence utility → trivial
	if (intents.length === 1 && candidates.length >= 1 && candidates[0].confidence >= 0.8) {
		return "trivial";
	}

	// Single intent with candidates → simple
	if (intents.length === 1 && candidates.length > 0) {
		return "simple";
	}

	// Multiple intents → moderate
	if (intents.length > 1 && candidates.length > 0) {
		return "moderate";
	}

	// No candidates but intents exist → complex
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

	// Intent confidence: having clear intents is good
	confidence += Math.min(0.3, intents.length * 0.15);

	// Candidate confidence: highest candidate score
	if (candidates.length > 0) {
		confidence += candidates[0].confidence * 0.5;
	}

	// Domain confidence: known domain is better
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

// ─── Exports for testing ───────────────────────────────────────────────────

export { UTILITY_MAP, VERB_GROUPS, VERB_LOOKUP, DOMAIN_KEYWORDS };
export type { UtilityEntry };
