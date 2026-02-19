/**
 * @chitragupta/anina/lokapala — Rakshaka security detection patterns.
 *
 * Credential leak patterns, dangerous command patterns, SQL injection
 * patterns, path traversal detection, and sensitive file paths. Also
 * includes standalone scanning helpers for text and file paths.
 */

import type { Finding, GuardianConfig } from "./types.js";
import { fnv1a, FindingRing } from "./types.js";

// ─── Pattern Types ──────────────────────────────────────────────────────────

/** A labelled regex pattern for detection. */
export interface SecurityPattern { pattern: RegExp; label: string; }

// ─── Credential Patterns ────────────────────────────────────────────────────

/** Patterns that indicate leaked credentials in output or arguments. */
export const CREDENTIAL_PATTERNS: readonly SecurityPattern[] = [
	{ pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{20,}/i, label: "API key" },
	{ pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/i, label: "Secret/token/password" },
	{ pattern: /sk-[a-zA-Z0-9_\-]{20,}/, label: "OpenAI API key" },
	{ pattern: /ghp_[a-zA-Z0-9]{36}/, label: "GitHub personal access token" },
	{ pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: "Private key" },
	{ pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*=\s*\S+/i, label: "AWS credential" },
	{ pattern: /xox[bpsa]-[a-zA-Z0-9-]{10,}/, label: "Slack token" },
	{ pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, label: "JWT token" },
];

// ─── Dangerous Command Patterns ─────────────────────────────────────────────

/** Command patterns that are inherently dangerous. */
export const DANGEROUS_COMMAND_PATTERNS: readonly SecurityPattern[] = [
	{ pattern: /rm\s+(?:-[a-zA-Z]*\s+)*[/~]/, label: "Recursive delete from root or home" },
	{ pattern: /chmod\s+777\s/, label: "World-writable permission" },
	{ pattern: /curl\s.*\|\s*(ba)?sh/, label: "Pipe remote script to shell" },
	{ pattern: /wget\s.*\|\s*(ba)?sh/, label: "Pipe remote script to shell" },
	{ pattern: /mkfs\./, label: "Filesystem format command" },
	{ pattern: /dd\s+.*of=\/dev\//, label: "Direct device write" },
	{ pattern: /:\(\)\s*\{.*\|.*&\s*\}\s*;/, label: "Fork bomb" },
	{ pattern: />\s*\/dev\/[sh]da/, label: "Write to block device" },
];

// ─── SQL Injection Patterns ─────────────────────────────────────────────────

/** Patterns that indicate SQL injection attempts. */
export const SQL_INJECTION_PATTERNS: readonly SecurityPattern[] = [
	{ pattern: /(?:DROP|DELETE|TRUNCATE)\s+(?:TABLE|DATABASE)\s/i, label: "Destructive SQL statement" },
	{ pattern: /UNION\s+(?:ALL\s+)?SELECT\s/i, label: "UNION SELECT injection" },
	{ pattern: /;\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER)\s/i, label: "Chained SQL statement" },
	{ pattern: /'\s*OR\s+'?1'?\s*=\s*'?1/i, label: "Boolean-based SQL injection" },
	{ pattern: /'\s*--/, label: "SQL comment injection" },
];

// ─── Path Traversal ─────────────────────────────────────────────────────────

/** Path traversal detection pattern. */
export const PATH_TRAVERSAL_PATTERN = /(?:^|\s|["'=])(?:\.\.\/){2,}/;

/** Sensitive file paths that should never appear in tool args. */
export const SENSITIVE_PATHS: readonly string[] = [
	"/etc/passwd", "/etc/shadow", "/etc/sudoers",
	".ssh/id_rsa", ".ssh/id_ed25519", ".gnupg/",
	".env", "credentials.json",
];

// ─── Scan Helpers ───────────────────────────────────────────────────────────

/** Finding accumulator function type. */
export type AddFindingFn = (
	accumulator: Finding[],
	partial: Omit<Finding, "id" | "timestamp">,
) => void;

/** Create the standard addFinding function for a Rakshaka instance. */
export function createAddFinding(
	config: GuardianConfig,
	findings: FindingRing,
	findingsBySeverity: Record<string, number>,
): AddFindingFn {
	return (accumulator, partial) => {
		if (partial.confidence < config.confidenceThreshold) return;
		const timestamp = Date.now();
		const id = fnv1a(`${partial.guardianId}:${partial.title}:${partial.location ?? ""}:${timestamp}`);
		const finding: Finding = { ...partial, id, timestamp };
		findings.push(finding);
		findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] ?? 0) + 1;
		accumulator.push(finding);
	};
}

/** Scan arbitrary text for credential patterns. */
export function scanText(text: string, source: string, addFinding: AddFindingFn): Finding[] {
	const results: Finding[] = [];
	for (const { pattern, label } of CREDENTIAL_PATTERNS) {
		if (pattern.test(text)) {
			addFinding(results, {
				guardianId: "rakshaka", domain: "security", severity: "critical",
				title: `Credential leak in ${source}: ${label}`,
				description: `Output from "${source}" contains what appears to be a ${label}.`,
				location: source, confidence: 0.85, autoFixable: false,
			});
		}
	}
	return results;
}

/** Check a file path against sensitive paths and traversal patterns. */
export function scanFilePath(filePath: string, addFinding: AddFindingFn): Finding[] {
	const results: Finding[] = [];
	for (const sp of SENSITIVE_PATHS) {
		if (filePath.includes(sp)) {
			addFinding(results, {
				guardianId: "rakshaka", domain: "security", severity: "info",
				title: `Sensitive file modified: ${sp}`,
				description: `File "${filePath}" matches sensitive path pattern "${sp}".`,
				location: filePath,
				suggestion: "Ensure this modification is intentional and doesn't expose sensitive data.",
				confidence: 0.7, autoFixable: false,
			});
		}
	}
	if (PATH_TRAVERSAL_PATTERN.test(filePath)) {
		addFinding(results, {
			guardianId: "rakshaka", domain: "security", severity: "warning",
			title: "Path traversal in file change",
			description: `File path "${filePath}" contains traversal sequences.`,
			location: filePath, confidence: 0.8, autoFixable: false,
		});
	}
	return results;
}
