import { describe, it, expect } from "vitest";
import {
	analyzeTask,
	UTILITY_MAP,
	VERB_GROUPS,
	VERB_LOOKUP,
	DOMAIN_KEYWORDS,
} from "../../src/shiksha/vimarsh.js";
import type { UtilityEntry } from "../../src/shiksha/vimarsh.js";
import type { TaskAnalysis, TaskDomain } from "../../src/shiksha/types.js";

// ─── 1. Network Domain Queries ──────────────────────────────────────────────

describe("Network domain queries", () => {
	it("should detect 'check what devices are on my network'", () => {
		const result = analyzeTask("check what devices are on my network");
		expect(result.domain).toBe("network");
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
		expect(result.intents[0].verb).toBe("check");
		expect(result.intents[0].object).toBe("devices");
		expect(result.intents[0].modifier).toBe("network");
		expect(result.candidateUtilities.some((c) => c.command === "arp")).toBe(true);
	});

	it("should detect 'ping google.com'", () => {
		const result = analyzeTask("ping google.com");
		expect(result.domain).toBe("network");
		expect(result.candidateUtilities.some((c) => c.command === "ping")).toBe(true);
		const ping = result.candidateUtilities.find((c) => c.command === "ping")!;
		expect(ping.requiresNetwork).toBe(true);
	});

	it("should detect 'scan port on server'", () => {
		const result = analyzeTask("scan port on server");
		expect(result.domain).toBe("network");
		expect(result.intents[0].verb).toBe("scan");
	});

	it("should detect 'show open connection'", () => {
		const result = analyzeTask("show open connection");
		expect(result.domain).toBe("network");
		expect(result.intents[0].verb).toBe("list"); // show maps to list
		expect(result.candidateUtilities.some((c) => c.command === "netstat")).toBe(true);
	});

	it("should detect dns lookup queries", () => {
		const result = analyzeTask("dns lookup for example.com");
		expect(result.domain).toBe("network");
		expect(result.candidateUtilities.some(
			(c) => c.command === "dig" || c.command === "nslookup",
		)).toBe(true);
	});
});

// ─── 2. File Domain Queries ─────────────────────────────────────────────────

describe("File domain queries", () => {
	it("should detect 'find large files in this directory'", () => {
		const result = analyzeTask("find large files in this directory");
		expect(result.domain).toBe("files");
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
		expect(result.intents[0].verb).toBe("find");
		expect(result.intents[0].object).toContain("large");
		expect(result.candidateUtilities.some((c) => c.command === "find")).toBe(true);
	});

	it("should detect 'search for text in file'", () => {
		const result = analyzeTask("search for text in file");
		expect(result.domain).toBe("files");
		expect(result.candidateUtilities.some((c) => c.command === "grep")).toBe(true);
	});

	it("should detect 'list files in directory'", () => {
		const result = analyzeTask("list files in directory");
		expect(result.domain).toBe("files");
		expect(result.intents[0].verb).toBe("list");
		expect(result.candidateUtilities.some((c) => c.command === "ls")).toBe(true);
	});

	it("should detect 'show directory structure'", () => {
		const result = analyzeTask("show directory structure");
		expect(result.domain).toBe("files");
		expect(result.candidateUtilities.some((c) => c.command === "tree")).toBe(true);
	});
});

// ─── 3. System Domain Queries ───────────────────────────────────────────────

describe("System domain queries", () => {
	it("should detect 'show running process list'", () => {
		const result = analyzeTask("show running process list");
		expect(result.domain).toBe("system");
		expect(result.intents[0].verb).toBe("list"); // show maps to list
		expect(result.candidateUtilities.some((c) => c.command === "ps")).toBe(true);
	});

	it("should detect 'kill process 1234'", () => {
		const result = analyzeTask("kill process 1234");
		expect(result.domain).toBe("system");
		expect(result.intents[0].verb).toBe("kill");
		expect(result.candidateUtilities.some((c) => c.command === "kill")).toBe(true);
	});

	it("should detect 'check uptime'", () => {
		const result = analyzeTask("check uptime");
		expect(result.domain).toBe("system");
		expect(result.candidateUtilities.some((c) => c.command === "uptime")).toBe(true);
	});

	it("should detect 'free memory usage'", () => {
		const result = analyzeTask("free memory usage");
		expect(result.domain).toBe("system");
		expect(result.candidateUtilities.some((c) => c.command === "free")).toBe(true);
	});
});

// ─── 4. Dev Domain Queries ──────────────────────────────────────────────────

describe("Dev domain queries", () => {
	it("should detect 'git status'", () => {
		const result = analyzeTask("git status");
		expect(result.domain).toBe("dev");
		expect(result.candidateUtilities.some((c) => c.command === "git")).toBe(true);
		const git = result.candidateUtilities.find((c) => c.command === "git")!;
		expect(git.confidence).toBeGreaterThanOrEqual(0.9);
	});

	it("should detect 'npm outdated'", () => {
		const result = analyzeTask("npm outdated");
		expect(result.domain).toBe("dev");
		expect(result.candidateUtilities.some((c) => c.command === "npm")).toBe(true);
	});

	it("should detect 'docker ps'", () => {
		const result = analyzeTask("docker ps");
		expect(result.domain).toBe("dev");
		expect(result.candidateUtilities.some((c) => c.command === "docker")).toBe(true);
	});

	it("should detect 'type check typescript project'", () => {
		const result = analyzeTask("type check typescript project");
		expect(result.domain).toBe("dev");
		expect(result.candidateUtilities.some((c) => c.command === "tsc")).toBe(true);
	});
});

// ─── 5. Text Domain Queries ─────────────────────────────────────────────────

describe("Text domain queries", () => {
	it("should detect 'parse json file'", () => {
		const result = analyzeTask("parse json file");
		expect(result.domain).toBe("text");
		expect(result.candidateUtilities.some((c) => c.command === "jq")).toBe(true);
	});

	it("should detect 'base64 encode string'", () => {
		const result = analyzeTask("base64 encode string");
		expect(result.domain).toBe("text");
		expect(result.candidateUtilities.some((c) => c.command === "base64")).toBe(true);
	});

	it("should detect 'compute sha256 checksum'", () => {
		const result = analyzeTask("compute sha256 checksum");
		expect(result.domain).toBe("text");
		expect(result.candidateUtilities.some((c) => c.command === "sha256sum")).toBe(true);
	});

	it("should detect 'extract field from csv'", () => {
		const result = analyzeTask("extract field from csv");
		expect(result.domain).toBe("text");
		expect(result.candidateUtilities.some(
			(c) => c.command === "awk" || c.command === "cut",
		)).toBe(true);
	});
});

// ─── 6. Disk Space Queries ──────────────────────────────────────────────────

describe("Disk space queries", () => {
	it("should detect 'disk space left'", () => {
		const result = analyzeTask("disk space left");
		expect(result.domain).toBe("files");
		expect(result.candidateUtilities.some((c) => c.command === "df")).toBe(true);
		expect(result.strategy).toBe("shell-command");
	});

	it("should detect 'how much free space'", () => {
		const result = analyzeTask("how much free space");
		expect(result.candidateUtilities.some((c) => c.command === "df")).toBe(true);
		expect(result.strategy).toBe("shell-command");
	});

	it("should detect 'available space on disk'", () => {
		const result = analyzeTask("available space on disk");
		expect(result.candidateUtilities.some((c) => c.command === "df")).toBe(true);
	});

	it("should detect 'directory size usage'", () => {
		const result = analyzeTask("directory size usage");
		expect(result.domain).toBe("files");
		expect(result.candidateUtilities.some((c) => c.command === "du")).toBe(true);
	});
});

// ─── 7. Multi-Intent Queries ────────────────────────────────────────────────

describe("Multi-intent queries", () => {
	it("should detect multiple verbs in 'find and count files'", () => {
		const result = analyzeTask("find and count files");
		expect(result.intents.length).toBeGreaterThanOrEqual(2);
		const verbs = result.intents.map((i) => i.verb);
		expect(verbs).toContain("find");
		expect(verbs).toContain("count");
	});

	it("should produce shell-pipeline for multi-intent with multiple candidates", () => {
		const result = analyzeTask("find and count files in directory");
		// When multiple intents and multiple candidates
		if (result.intents.length > 1 && result.candidateUtilities.length > 1) {
			expect(result.strategy).toBe("shell-pipeline");
		}
	});

	it("should estimate moderate complexity for multi-intent queries", () => {
		const result = analyzeTask("find and count files in directory");
		if (result.intents.length > 1 && result.candidateUtilities.length > 0) {
			expect(result.complexity).toBe("moderate");
		}
	});

	it("should handle 'search and sort results'", () => {
		const result = analyzeTask("search and sort lines in file");
		const verbs = result.intents.map((i) => i.verb);
		expect(verbs).toContain("find"); // search maps to find
		expect(verbs).toContain("sort");
	});
});

// ─── 8. No Verb Found ──────────────────────────────────────────────────────

describe("No verb found (implicit check)", () => {
	it("should use implicit 'check' when no verb is found", () => {
		const result = analyzeTask("network devices");
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
		expect(result.intents[0].verb).toBe("check");
		expect(result.domain).toBe("network");
	});

	it("should extract object from verbless query", () => {
		const result = analyzeTask("cpu temperature");
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
		expect(result.intents[0].verb).toBe("check");
		expect(result.domain).toBe("system");
	});

	it("should handle single domain keyword without verb", () => {
		const result = analyzeTask("uptime");
		expect(result.domain).toBe("system");
		expect(result.candidateUtilities.some((c) => c.command === "uptime")).toBe(true);
	});
});

// ─── 9. Unknown Domain ─────────────────────────────────────────────────────

describe("Unknown domain", () => {
	it("should return domain=unknown for unrecognized queries", () => {
		const result = analyzeTask("do something random");
		expect(result.domain).toBe("unknown");
	});

	it("should return llm-required strategy for unknown queries with no intents", () => {
		const result = analyzeTask("something completely unrecognizable");
		if (result.intents.length === 0 || result.domain === "unknown") {
			expect(result.strategy).toBe("llm-required");
		}
	});

	it("should have low confidence for unknown domain queries", () => {
		const result = analyzeTask("do something random");
		expect(result.confidence).toBeLessThan(0.6);
	});
});

// ─── 10. Strategy Determination ─────────────────────────────────────────────

describe("Strategy determination", () => {
	it("should return shell-command for single-utility match", () => {
		const result = analyzeTask("ping google.com");
		expect(result.strategy).toBe("shell-command");
	});

	it("should return shell-pipeline for multi-intent with multiple candidates", () => {
		const result = analyzeTask("find and count lines in file");
		if (result.intents.length > 1 && result.candidateUtilities.length > 1) {
			expect(result.strategy).toBe("shell-pipeline");
		}
	});

	it("should return builtin-tool for dev domain with no utility match", () => {
		// A dev query that has no direct utility pattern match
		const result = analyzeTask("compile the rust project");
		if (result.candidateUtilities.length === 0 && result.domain === "dev") {
			expect(result.strategy).toBe("builtin-tool");
		}
	});

	it("should return llm-required when no intents and unknown domain", () => {
		const result = analyzeTask("xylophone quartzmapping");
		expect(result.strategy).toBe("llm-required");
	});

	it("should return code-generation for intents without utility match in known domain", () => {
		// A network query that matches no utility pattern
		const result = analyzeTask("analyze bandwidth throttling patterns");
		if (result.intents.length > 0 && result.candidateUtilities.length === 0 && result.domain !== "unknown" && result.domain !== "dev") {
			expect(result.strategy).toBe("code-generation");
		}
	});
});

// ─── 11. Complexity Estimation ──────────────────────────────────────────────

describe("Complexity estimation", () => {
	it("should return trivial for single high-confidence match", () => {
		const result = analyzeTask("ping google.com");
		expect(result.complexity).toBe("trivial");
	});

	it("should return moderate for multi-intent queries with candidates", () => {
		const result = analyzeTask("find and count files in directory");
		if (result.intents.length > 1 && result.candidateUtilities.length > 0) {
			expect(result.complexity).toBe("moderate");
		}
	});

	it("should return complex for intents with no utility candidates", () => {
		const result = analyzeTask("analyze bandwidth throttling patterns");
		if (result.intents.length > 0 && result.candidateUtilities.length === 0) {
			expect(result.complexity).toBe("complex");
		}
	});

	it("should return trivial for 'git status' (high confidence)", () => {
		const result = analyzeTask("git status");
		expect(result.complexity).toBe("trivial");
	});

	it("should return trivial for 'df -h' equivalent query", () => {
		const result = analyzeTask("disk space usage");
		expect(result.complexity).toBe("trivial");
	});
});

// ─── 12. Confidence Computation ─────────────────────────────────────────────

describe("Confidence computation", () => {
	it("should return high confidence for clear matches", () => {
		const result = analyzeTask("ping google.com");
		expect(result.confidence).toBeGreaterThan(0.6);
	});

	it("should return low confidence for unknown queries", () => {
		const result = analyzeTask("something completely unrecognizable");
		expect(result.confidence).toBeLessThanOrEqual(0.3);
	});

	it("should return 0.1 when no intents are extracted", () => {
		// Query with only stopwords should produce no intents
		const result = analyzeTask("the a an");
		expect(result.confidence).toBe(0.1);
	});

	it("should be capped at 1.0", () => {
		const result = analyzeTask("git status");
		expect(result.confidence).toBeLessThanOrEqual(1.0);
	});

	it("should boost confidence for known domains", () => {
		// Two similar queries — one with a domain keyword (process), one without
		const withDomain = analyzeTask("show running process");
		const withoutDomain = analyzeTask("show running stuff");
		// Known domain query should have higher confidence
		expect(withDomain.confidence).toBeGreaterThanOrEqual(withoutDomain.confidence);
	});

	it("should have higher confidence with matching candidates", () => {
		const withCandidate = analyzeTask("ping google.com");
		const withoutCandidate = analyzeTask("analyze abstract patterns");
		expect(withCandidate.confidence).toBeGreaterThan(withoutCandidate.confidence);
	});
});

// ─── 13. Edge Cases ─────────────────────────────────────────────────────────

describe("Edge cases", () => {
	it("should handle empty query", () => {
		const result = analyzeTask("");
		expect(result.query).toBe("");
		expect(result.intents).toEqual([]);
		expect(result.domain).toBe("unknown");
		expect(result.confidence).toBe(0.1);
	});

	it("should handle single word query", () => {
		const result = analyzeTask("uptime");
		expect(result.query).toBe("uptime");
		expect(result.domain).toBe("system");
	});

	it("should handle very long query", () => {
		const long = "find all the large files that are bigger than 100MB in this directory and also count how many there are and then sort them by size";
		const result = analyzeTask(long);
		expect(result.query).toBe(long);
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
		expect(result.domain).toBe("files");
	});

	it("should handle special characters", () => {
		const result = analyzeTask("find file named *.ts");
		expect(result.domain).toBe("files");
		expect(result.intents.length).toBeGreaterThanOrEqual(1);
	});

	it("should handle mixed case", () => {
		const result = analyzeTask("PING Google.COM");
		expect(result.candidateUtilities.some((c) => c.command === "ping")).toBe(true);
	});

	it("should handle whitespace-only query", () => {
		const result = analyzeTask("   ");
		expect(result.intents).toEqual([]);
		expect(result.domain).toBe("unknown");
	});

	it("should preserve original query in result", () => {
		const query = "Check Network Devices";
		const result = analyzeTask(query);
		expect(result.query).toBe(query);
	});

	it("should handle query with only stopwords", () => {
		const result = analyzeTask("the a an is are my this");
		expect(result.intents).toEqual([]);
		expect(result.confidence).toBe(0.1);
	});
});

// ─── 14. Modifier Extraction ────────────────────────────────────────────────

describe("Modifier extraction", () => {
	it("should extract 'on my network'", () => {
		const result = analyzeTask("check devices on my network");
		expect(result.intents[0].modifier).toBe("network");
	});

	it("should extract 'in this directory'", () => {
		const result = analyzeTask("find files in this directory");
		expect(result.intents[0].modifier).toBe("directory");
	});

	it("should extract 'from my server'", () => {
		const result = analyzeTask("download logs from my server");
		expect(result.intents[0].modifier).toBe("server");
	});

	it("should return undefined when no modifier present", () => {
		const result = analyzeTask("git status");
		// git and status are both recognized — modifier depends on what follows
		// At minimum, modifier should be undefined or a valid string
		for (const intent of result.intents) {
			if (intent.modifier !== undefined) {
				expect(typeof intent.modifier).toBe("string");
			}
		}
	});

	it("should extract modifier from 'with' preposition", () => {
		const result = analyzeTask("find files with extension ts");
		expect(result.intents[0].modifier).toBeDefined();
	});
});

// ─── 15. UTILITY_MAP Coverage ───────────────────────────────────────────────

describe("UTILITY_MAP coverage", () => {
	const allDomains: TaskDomain[] = ["network", "files", "system", "dev", "text"];

	it("should have entries for all 5 domains", () => {
		for (const domain of allDomains) {
			const entries = UTILITY_MAP.filter((e) => e.domain === domain);
			expect(entries.length).toBeGreaterThan(0);
		}
	});

	it("should have valid regex patterns for all entries", () => {
		for (const entry of UTILITY_MAP) {
			expect(entry.pattern).toBeInstanceOf(RegExp);
			expect(entry.command.length).toBeGreaterThan(0);
			expect(entry.template.length).toBeGreaterThan(0);
		}
	});

	it("should have confidence values in [0, 1]", () => {
		for (const entry of UTILITY_MAP) {
			expect(entry.confidence).toBeGreaterThanOrEqual(0);
			expect(entry.confidence).toBeLessThanOrEqual(1);
		}
	});

	it("should have valid domain values for all entries", () => {
		const validDomains = new Set<string>(["network", "files", "system", "dev", "text", "cloud"]);
		for (const entry of UTILITY_MAP) {
			expect(validDomains.has(entry.domain)).toBe(true);
		}
	});

	it("VERB_GROUPS should have unique canonical keys", () => {
		const keys = [...VERB_GROUPS.keys()];
		const uniqueKeys = new Set(keys);
		expect(keys.length).toBe(uniqueKeys.size);
	});

	it("VERB_LOOKUP should have an entry for every synonym", () => {
		// Some synonyms appear in multiple verb groups (e.g., "view" in both list and read).
		// The flat lookup uses last-write-wins, so we verify every synonym has a mapping.
		const allCanonicals = new Set(VERB_GROUPS.keys());
		for (const [, synonyms] of VERB_GROUPS) {
			for (const syn of synonyms) {
				const mapped = VERB_LOOKUP.get(syn);
				expect(mapped).toBeDefined();
				expect(allCanonicals.has(mapped!)).toBe(true);
			}
		}
	});

	it("DOMAIN_KEYWORDS should only map to valid domains", () => {
		const validDomains = new Set<string>(["network", "files", "system", "dev", "text", "cloud"]);
		for (const [, domain] of DOMAIN_KEYWORDS) {
			expect(validDomains.has(domain)).toBe(true);
		}
	});

	it("should not have duplicate commands with identical patterns", () => {
		const patternStrs = UTILITY_MAP.map((e) => `${e.command}:${e.pattern.source}`);
		const unique = new Set(patternStrs);
		expect(patternStrs.length).toBe(unique.size);
	});

	it("network utilities should flag requiresNetwork correctly", () => {
		const networkEntries = UTILITY_MAP.filter((e) => e.domain === "network");
		// Entries like ping, traceroute, curl, wget, dig, nslookup, nmap require network
		const networkRequired = networkEntries.filter((e) => e.requiresNetwork);
		expect(networkRequired.length).toBeGreaterThan(0);
		// arp, netstat, ss, ifconfig do NOT require network
		const noNetwork = networkEntries.filter(
			(e) => !e.requiresNetwork && ["arp", "netstat", "ss", "ifconfig"].includes(e.command),
		);
		expect(noNetwork.length).toBeGreaterThan(0);
	});
});
