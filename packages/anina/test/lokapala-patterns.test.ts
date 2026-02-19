/**
 * @chitragupta/anina — Lokapala Rakshaka Patterns Tests.
 *
 * Direct unit tests for the extracted standalone functions and pattern
 * arrays in rakshaka-patterns.ts. Tests each security pattern in
 * isolation and validates the scanText / scanFilePath / createAddFinding
 * helper functions.
 */

import { describe, it, expect } from "vitest";
import {
	CREDENTIAL_PATTERNS, DANGEROUS_COMMAND_PATTERNS, SQL_INJECTION_PATTERNS,
	PATH_TRAVERSAL_PATTERN, SENSITIVE_PATHS,
	createAddFinding, scanText, scanFilePath,
	type SecurityPattern, type AddFindingFn,
} from "../src/lokapala/rakshaka-patterns.js";
import { resolveConfig, FindingRing } from "../src/lokapala/types.js";
import type { Finding } from "../src/lokapala/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Concatenate parts to form test fixture strings without triggering secrets scanners. */
const fake = (...parts: string[]): string => parts.join("");

/** Build a standard addFinding function for tests. */
function makeAddFinding(threshold = 0.1): { addFinding: AddFindingFn; ring: FindingRing; severity: Record<string, number> } {
	const config = resolveConfig({ confidenceThreshold: threshold });
	const ring = new FindingRing(100);
	const severity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
	return { addFinding: createAddFinding(config, ring, severity), ring, severity };
}

// ═══════════════════════════════════════════════════════════════════════════════
// createAddFinding — Factory Function
// ═══════════════════════════════════════════════════════════════════════════════

describe("createAddFinding — factory", () => {
	it("should create findings with id and timestamp", () => {
		const { addFinding, ring } = makeAddFinding();
		const acc: Finding[] = [];
		addFinding(acc, {
			guardianId: "test", domain: "security", severity: "warning",
			title: "Test finding", description: "desc", confidence: 0.8, autoFixable: false,
		});
		expect(acc).toHaveLength(1);
		expect(acc[0].id).toBeTruthy();
		expect(acc[0].timestamp).toBeGreaterThan(0);
		expect(ring.size).toBe(1);
	});

	it("should filter findings below confidence threshold", () => {
		const { addFinding } = makeAddFinding(0.9);
		const acc: Finding[] = [];
		addFinding(acc, {
			guardianId: "test", domain: "security", severity: "info",
			title: "Low confidence", description: "desc", confidence: 0.5, autoFixable: false,
		});
		expect(acc).toHaveLength(0);
	});

	it("should increment severity counter", () => {
		const { addFinding, severity } = makeAddFinding();
		const acc: Finding[] = [];
		addFinding(acc, {
			guardianId: "test", domain: "security", severity: "critical",
			title: "Critical", description: "desc", confidence: 0.9, autoFixable: false,
		});
		addFinding(acc, {
			guardianId: "test", domain: "security", severity: "warning",
			title: "Warning", description: "desc", confidence: 0.8, autoFixable: false,
		});
		expect(severity.critical).toBe(1);
		expect(severity.warning).toBe(1);
	});

	it("should push to both accumulator and ring buffer", () => {
		const { addFinding, ring } = makeAddFinding();
		const acc: Finding[] = [];
		addFinding(acc, {
			guardianId: "test", domain: "security", severity: "info",
			title: "Test", description: "desc", confidence: 0.8, autoFixable: false,
		});
		expect(acc).toHaveLength(1);
		expect(ring.size).toBe(1);
		expect(ring.toArray()[0].title).toBe("Test");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// scanText — Credential Scanning in Arbitrary Text
// ═══════════════════════════════════════════════════════════════════════════════

describe("scanText — credential scanning", () => {
	it("should detect API key in text", () => {
		const { addFinding } = makeAddFinding();
		const results = scanText(fake('config: api_key = "', "sk-", 'abc12345678901234567890"'), "test-source", addFinding);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].title).toContain("Credential leak");
		expect(results[0].severity).toBe("critical");
	});

	it("should detect OpenAI key in text", () => {
		const { addFinding } = makeAddFinding();
		const results = scanText(fake("OPENAI_KEY=", "sk-", "proj-abcdefghij1234567890abcd"), "env", addFinding);
		expect(results.some((f) => f.title.includes("OpenAI"))).toBe(true);
	});

	it("should detect private key in text", () => {
		const { addFinding } = makeAddFinding();
		const results = scanText(fake("-----BEGIN RSA", " PRIVATE KEY-----", "\nMIIE..."), "output", addFinding);
		expect(results.some((f) => f.title.includes("Private key"))).toBe(true);
	});

	it("should return empty for clean text", () => {
		const { addFinding } = makeAddFinding();
		const results = scanText("This is a perfectly normal log output with no secrets.", "log", addFinding);
		expect(results).toHaveLength(0);
	});

	it("should set location to the source parameter", () => {
		const { addFinding } = makeAddFinding();
		const results = scanText(fake("token = ", "sk-", "abcdefghij1234567890abcd"), "my-source", addFinding);
		expect(results[0].location).toBe("my-source");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// scanFilePath — Sensitive Path Detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("scanFilePath — sensitive path detection", () => {
	it("should detect /etc/passwd", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("/etc/passwd", addFinding);
		expect(results.some((f) => f.title.includes("Sensitive file"))).toBe(true);
	});

	it("should detect .ssh/id_rsa", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("/home/user/.ssh/id_rsa", addFinding);
		expect(results.some((f) => f.title.includes("Sensitive file"))).toBe(true);
	});

	it("should detect .env file", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("/app/.env", addFinding);
		expect(results.some((f) => f.title.includes("Sensitive file"))).toBe(true);
	});

	it("should detect path traversal sequences", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("../../etc/shadow", addFinding);
		expect(results.some((f) => f.title.includes("Path traversal"))).toBe(true);
	});

	it("should return empty for normal paths", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("/app/src/index.ts", addFinding);
		expect(results).toHaveLength(0);
	});

	it("should detect multiple issues in one path", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("../../.ssh/id_rsa", addFinding);
		// Both traversal and sensitive file
		expect(results.length).toBeGreaterThanOrEqual(2);
	});

	it("should set severity to info for sensitive file modification", () => {
		const { addFinding } = makeAddFinding();
		const results = scanFilePath("credentials.json", addFinding);
		const sensitiveFindings = results.filter((f) => f.title.includes("Sensitive file"));
		expect(sensitiveFindings[0]?.severity).toBe("info");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Individual Pattern Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CREDENTIAL_PATTERNS — individual pattern tests", () => {
	const findPattern = (label: string): SecurityPattern =>
		CREDENTIAL_PATTERNS.find((p) => p.label === label)!;

	it("should have 8 credential patterns", () => {
		expect(CREDENTIAL_PATTERNS.length).toBe(8);
	});

	it("API key — should match api_key=<value>", () => {
		const { pattern } = findPattern("API key");
		expect(pattern.test('api_key = "abcdefghij1234567890abcd"')).toBe(true);
		expect(pattern.test("apiKey:abcdefghij1234567890abcd")).toBe(true);
		expect(pattern.test("api_key = short")).toBe(false);
	});

	it("Secret/token/password — should match secret=<value>", () => {
		const { pattern } = findPattern("Secret/token/password");
		expect(pattern.test('password = "superSecret123"')).toBe(true);
		expect(pattern.test("token:mysecrettoken123")).toBe(true);
		expect(pattern.test("password = x")).toBe(false); // too short
	});

	it("OpenAI API key — should match sk- prefix", () => {
		const { pattern } = findPattern("OpenAI API key");
		expect(pattern.test(fake("sk-", "abcdefghij1234567890abcd"))).toBe(true);
		expect(pattern.test("sk-short")).toBe(false);
	});

	it("GitHub PAT — should match ghp_ prefix", () => {
		const { pattern } = findPattern("GitHub personal access token");
		expect(pattern.test(fake("ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"))).toBe(true);
		expect(pattern.test("ghp_short")).toBe(false);
	});

	it("Private key — should match PEM header", () => {
		const { pattern } = findPattern("Private key");
		expect(pattern.test(fake("-----BEGIN RSA", " PRIVATE KEY-----"))).toBe(true);
		expect(pattern.test(fake("-----BEGIN EC", " PRIVATE KEY-----"))).toBe(true);
		expect(pattern.test(fake("-----BEGIN", " PRIVATE KEY-----"))).toBe(true);
		expect(pattern.test("-----BEGIN PUBLIC KEY-----")).toBe(false);
	});

	it("AWS credential — should match aws_access_key_id", () => {
		const { pattern } = findPattern("AWS credential");
		expect(pattern.test(fake("aws_access_key_id = ", "AKIA", "IOSFODNN7EXAMPLE"))).toBe(true);
		expect(pattern.test("aws_secret_access_key = wJalrXUtnFEMI")).toBe(true);
	});

	it("Slack token — should match xox prefix", () => {
		const { pattern } = findPattern("Slack token");
		expect(pattern.test(fake("xoxb", "-123456789-abcdef"))).toBe(true);
		expect(pattern.test(fake("xoxp", "-some-token-here"))).toBe(true);
	});

	it("JWT token — should match eyJ... pattern", () => {
		const { pattern } = findPattern("JWT token");
		const jwt = fake("eyJhbGciOiJIUzI1NiIsInR5cCI6", "IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
		expect(pattern.test(jwt)).toBe(true);
		expect(pattern.test("eyJ_short.not.valid")).toBe(false);
	});
});

describe("DANGEROUS_COMMAND_PATTERNS — individual pattern tests", () => {
	it("should have 8 dangerous command patterns", () => {
		expect(DANGEROUS_COMMAND_PATTERNS.length).toBe(8);
	});

	it("should match rm from root", () => {
		const pattern = DANGEROUS_COMMAND_PATTERNS.find((p) => p.label.includes("Recursive delete"))!;
		expect(pattern.pattern.test("rm -rf /")).toBe(true);
		expect(pattern.pattern.test("rm -rf ~/")).toBe(true);
	});

	it("should match chmod 777", () => {
		const pattern = DANGEROUS_COMMAND_PATTERNS.find((p) => p.label.includes("World-writable"))!;
		expect(pattern.pattern.test("chmod 777 /etc/file")).toBe(true);
	});

	it("should match curl piped to shell", () => {
		const pattern = DANGEROUS_COMMAND_PATTERNS.find((p) => p.label === "Pipe remote script to shell" && p.pattern.source.includes("curl"))!;
		expect(pattern.pattern.test("curl https://example.test | sh")).toBe(true);
		expect(pattern.pattern.test("curl https://example.test | bash")).toBe(true);
	});

	it("should match fork bomb", () => {
		const pattern = DANGEROUS_COMMAND_PATTERNS.find((p) => p.label.includes("Fork bomb"))!;
		expect(pattern.pattern.test(":(){ :|:& };")).toBe(true);
	});
});

describe("SQL_INJECTION_PATTERNS — individual pattern tests", () => {
	it("should have 5 SQL injection patterns", () => {
		expect(SQL_INJECTION_PATTERNS.length).toBe(5);
	});

	it("should match destructive SQL", () => {
		const pattern = SQL_INJECTION_PATTERNS.find((p) => p.label.includes("Destructive"))!;
		expect(pattern.pattern.test("DROP TABLE users")).toBe(true);
		expect(pattern.pattern.test("DELETE TABLE data")).toBe(true);
		expect(pattern.pattern.test("TRUNCATE TABLE logs")).toBe(true);
	});

	it("should match UNION SELECT", () => {
		const pattern = SQL_INJECTION_PATTERNS.find((p) => p.label.includes("UNION"))!;
		expect(pattern.pattern.test("UNION SELECT * FROM users")).toBe(true);
		expect(pattern.pattern.test("UNION ALL SELECT id")).toBe(true);
	});

	it("should match boolean injection", () => {
		const pattern = SQL_INJECTION_PATTERNS.find((p) => p.label.includes("Boolean"))!;
		expect(pattern.pattern.test("' OR '1'='1")).toBe(true);
		expect(pattern.pattern.test("' OR 1=1")).toBe(true);
	});
});

describe("PATH_TRAVERSAL_PATTERN", () => {
	it("should match double traversal ../../", () => {
		expect(PATH_TRAVERSAL_PATTERN.test("../../etc/passwd")).toBe(true);
	});

	it("should match triple traversal", () => {
		expect(PATH_TRAVERSAL_PATTERN.test("../../../root")).toBe(true);
	});

	it("should not match single ../", () => {
		expect(PATH_TRAVERSAL_PATTERN.test("../package.json")).toBe(false);
	});

	it("should match traversal in quoted strings", () => {
		expect(PATH_TRAVERSAL_PATTERN.test('"../../secret"')).toBe(true);
	});
});

describe("SENSITIVE_PATHS", () => {
	it("should contain expected paths", () => {
		expect(SENSITIVE_PATHS).toContain("/etc/passwd");
		expect(SENSITIVE_PATHS).toContain("/etc/shadow");
		expect(SENSITIVE_PATHS).toContain("/etc/sudoers");
		expect(SENSITIVE_PATHS).toContain(".ssh/id_rsa");
		expect(SENSITIVE_PATHS).toContain(".ssh/id_ed25519");
		expect(SENSITIVE_PATHS).toContain(".gnupg/");
		expect(SENSITIVE_PATHS).toContain(".env");
		expect(SENSITIVE_PATHS).toContain("credentials.json");
	});

	it("should have 8 sensitive paths", () => {
		expect(SENSITIVE_PATHS.length).toBe(8);
	});
});
