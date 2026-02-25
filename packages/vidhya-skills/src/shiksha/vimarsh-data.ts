/**
 * Vimarsh data constants — verb groups, domain keywords, utility map, and patterns.
 *
 * Extracted from vimarsh.ts for maintainability. These are the large
 * readonly lookup tables used by the zero-cost task analyzer.
 *
 * @module vimarsh-data
 */

import type { TaskDomain } from "./types.js";

// ─── Verb Groups ───────────────────────────────────────────────────────────

/** Maps synonym groups to canonical verbs. */
export const VERB_GROUPS: ReadonlyMap<string, string[]> = new Map([
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

/** Flat lookup: word -> canonical verb. */
export const VERB_LOOKUP: ReadonlyMap<string, string> = (() => {
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
export const DOMAIN_KEYWORDS: ReadonlyMap<string, TaskDomain> = new Map([
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

/** System utility entry keyed by domain. */
export interface UtilityEntry {
	command: string;
	pattern: RegExp;
	template: string;
	confidence: number;
	requiresPrivilege: boolean;
	requiresNetwork: boolean;
	domain: TaskDomain;
}

export const UTILITY_MAP: ReadonlyArray<UtilityEntry> = [
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

export const MODIFIER_PATTERNS: ReadonlyArray<RegExp> = [
	/\b(on|in|from|to|at|for|with|of|into|across|within|under|over)\s+(?:my\s+|the\s+|this\s+)?(.+)$/i,
	/\b(on my|in my|in this|from my|on the|in the)\s+(.+)$/i,
];

// ─── Stopwords ─────────────────────────────────────────────────────────────

export const STOPWORDS = new Set([
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
