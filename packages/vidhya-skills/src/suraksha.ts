/**
 * Suraksha (सुरक्षा — Protection) — Deep Static Security Scanner for Skills.
 *
 * Performs multi-layered static analysis on skill content to detect
 * 8 categories of security threats before any code reaches the ecosystem.
 *
 * Types, constants, and the threat pattern database are in `suraksha-types.ts`.
 *
 * @packageDocumentation
 */

import { fnv1a } from "./fingerprint.js";
import {
	CEILING_MAX_FILE_SIZE,
	CEILING_MAX_FILES_PER_SKILL,
	DEFAULT_CONFIG,
	ENTROPY_MIN_LENGTH,
	ENTROPY_THRESHOLD,
	OBFUSCATION_RATIO_THRESHOLD,
	THREAT_PATTERNS,
} from "./suraksha-types.js";
import type {
	CustomPattern,
	SurakshaConfig,
	SurakshaFinding,
	SurakshaScanResult,
	SurakshaVerdict,
} from "./suraksha-types.js";

// Re-export for backward compatibility
export type {
	ThreatCategory,
	FindingSeverity,
	SurakshaFinding,
	SurakshaVerdict,
	SurakshaScanResult,
	SurakshaConfig,
	CustomPattern,
	ThreatPattern,
} from "./suraksha-types.js";

// ─── Suraksha Scanner ───────────────────────────────────────────────────────

/**
 * Suraksha (सुरक्षा) — Deep static security scanner for skill content.
 *
 * Scans skill source files for 8 categories of threats using pattern matching
 * and heuristic analysis. Produces a verdict, risk score, and detailed findings
 * with line numbers and snippets for human review.
 *
 * @example
 * ```ts
 * const scanner = new SurakshaScanner();
 * const result = scanner.scan("my-skill", "const x = eval('dangerous');");
 * console.log(result.verdict);   // "malicious"
 * console.log(result.findings);  // [{ threat: "code-injection", ... }]
 * ```
 */
export class SurakshaScanner {
	private config: Required<Omit<SurakshaConfig, "customPatterns">> & { customPatterns: CustomPattern[] };

	constructor(config?: SurakshaConfig) {
		this.config = {
			maxFileSizeBytes: clamp(
				config?.maxFileSizeBytes ?? DEFAULT_CONFIG.maxFileSizeBytes,
				1,
				CEILING_MAX_FILE_SIZE,
			),
			maxFilesPerSkill: clamp(
				config?.maxFilesPerSkill ?? DEFAULT_CONFIG.maxFilesPerSkill,
				1,
				CEILING_MAX_FILES_PER_SKILL,
			),
			allowedSourceExtensions:
				config?.allowedSourceExtensions ?? DEFAULT_CONFIG.allowedSourceExtensions,
			blockingThreats:
				config?.blockingThreats ?? DEFAULT_CONFIG.blockingThreats,
			customPatterns:
				config?.customPatterns ?? DEFAULT_CONFIG.customPatterns,
			enableHeuristics:
				config?.enableHeuristics ?? DEFAULT_CONFIG.enableHeuristics,
		};
	}

	/**
	 * Scan a single content string for security threats.
	 *
	 * @param skillName - Name of the skill being scanned (for reporting).
	 * @param content - The full text content to analyze.
	 * @returns Complete scan result with verdict, findings, and risk score.
	 */
	scan(skillName: string, content: string): SurakshaScanResult {
		const start = performance.now();
		const findings: SurakshaFinding[] = [];
		const contentHash = fnv1a(content);

		// Check file size ceiling
		const byteLength = new TextEncoder().encode(content).length;
		if (byteLength > this.config.maxFileSizeBytes) {
			findings.push({
				threat: "code-injection",
				severity: "warning",
				pattern: "file-size-exceeded",
				line: 0,
				snippet: `${byteLength} bytes (limit: ${this.config.maxFileSizeBytes})`,
				message: `Content exceeds maximum file size of ${this.config.maxFileSizeBytes} bytes`,
			});
		}

		const lines = content.split("\n");

		// ─── Pattern matching ─────────────────────────────────────────
		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx];

			for (const tp of THREAT_PATTERNS) {
				if (tp.pattern.test(line)) {
					findings.push({
						threat: tp.threat,
						severity: tp.severity,
						pattern: tp.pattern.source,
						line: lineIdx + 1,
						snippet: truncate(line.trim(), 100),
						message: tp.message,
					});
				}
			}

			// Custom patterns
			for (const cp of this.config.customPatterns) {
				if (cp.pattern.test(line)) {
					findings.push({
						threat: cp.threat,
						severity: cp.severity,
						pattern: cp.pattern.source,
						line: lineIdx + 1,
						snippet: truncate(line.trim(), 100),
						message: cp.message,
					});
				}
			}
		}

		// ─── Heuristic analysis ───────────────────────────────────────
		if (this.config.enableHeuristics) {
			const entropyFindings = this.analyzeEntropy(content, lines);
			findings.push(...entropyFindings);

			const obfuscationFindings = this.analyzeObfuscation(content);
			findings.push(...obfuscationFindings);
		}

		// ─── Compute verdict and risk score ───────────────────────────
		const riskScore = this.computeRiskScore(findings);
		const verdict = this.computeVerdict(findings, riskScore);
		const scanDurationMs = performance.now() - start;

		return { skillName, verdict, findings, riskScore, scanDurationMs, contentHash };
	}

	/**
	 * Scan multiple content entries (e.g., a skill with multiple source files).
	 *
	 * @param skillName - Name of the skill.
	 * @param files - Map of file paths to content strings.
	 * @returns Merged scan result across all files.
	 */
	scanMultiple(skillName: string, files: Map<string, string>): SurakshaScanResult {
		const start = performance.now();
		const allFindings: SurakshaFinding[] = [];
		let mergedHash = 0;

		let fileCount = 0;
		for (const [filePath, content] of files) {
			if (fileCount >= this.config.maxFilesPerSkill) {
				allFindings.push({
					threat: "supply-chain", severity: "warning",
					pattern: "file-count-exceeded", line: 0,
					snippet: `${files.size} files (limit: ${this.config.maxFilesPerSkill})`,
					message: `Skill contains more than ${this.config.maxFilesPerSkill} files — only first ${this.config.maxFilesPerSkill} scanned`,
				});
				break;
			}

			const ext = filePath.slice(filePath.lastIndexOf("."));
			if (!this.config.allowedSourceExtensions.includes(ext)) {
				allFindings.push({
					threat: "supply-chain", severity: "info",
					pattern: "disallowed-extension", line: 0,
					snippet: filePath,
					message: `File extension "${ext}" not in allowed list — skipped`,
				});
				continue;
			}

			const result = this.scan(skillName, content);
			for (const f of result.findings) {
				f.snippet = `[${filePath}] ${f.snippet}`;
				allFindings.push(f);
			}
			mergedHash = fnv1a(`${mergedHash}:${result.contentHash}`);
			fileCount++;
		}

		const riskScore = this.computeRiskScore(allFindings);
		const verdict = this.computeVerdict(allFindings, riskScore);
		const scanDurationMs = performance.now() - start;

		return { skillName, verdict, findings: allFindings, riskScore, scanDurationMs, contentHash: mergedHash };
	}

	/** Get the resolved configuration (with ceilings applied). */
	getConfig(): Readonly<typeof this.config> {
		return this.config;
	}

	// ─── Heuristic: Shannon Entropy ───────────────────────────────────

	/**
	 * Detect obfuscated payloads via Shannon entropy of string literals.
	 * High-entropy strings (>4.5 bits/char) in long literals (>50 chars)
	 * suggest Base64-encoded, encrypted, or deliberately obfuscated content.
	 */
	private analyzeEntropy(_content: string, lines: string[]): SurakshaFinding[] {
		const findings: SurakshaFinding[] = [];
		for (let i = 0; i < lines.length; i++) {
			const stringLiterals = extractStringLiterals(lines[i]);
			for (const literal of stringLiterals) {
				if (literal.length < ENTROPY_MIN_LENGTH) continue;
				const entropy = shannonEntropy(literal);
				if (entropy > ENTROPY_THRESHOLD) {
					findings.push({
						threat: "code-injection", severity: "warning",
						pattern: "high-entropy-string", line: i + 1,
						snippet: truncate(literal, 100),
						message: `High entropy string detected (${entropy.toFixed(2)} bits/char) — possible obfuscated payload`,
					});
				}
			}
		}
		return findings;
	}

	// ─── Heuristic: Obfuscation Detection ────────────────────────────

	/**
	 * Detect minified/obfuscated code via single-character identifier ratio.
	 * When >60% of identifiers are single characters, the code is likely
	 * minified or intentionally obfuscated to evade pattern matching.
	 */
	private analyzeObfuscation(content: string): SurakshaFinding[] {
		const findings: SurakshaFinding[] = [];
		const identifiers = content.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g);
		if (!identifiers || identifiers.length < 20) return findings;

		const keywords = new Set([
			"if", "else", "for", "while", "do", "switch", "case", "break",
			"continue", "return", "function", "const", "let", "var", "class",
			"new", "this", "true", "false", "null", "undefined", "typeof",
			"instanceof", "void", "delete", "throw", "try", "catch", "finally",
			"import", "export", "default", "from", "as", "async", "await",
			"yield", "in", "of", "type", "interface", "enum", "extends",
			"implements", "abstract", "public", "private", "protected", "static",
			"readonly", "string", "number", "boolean", "any", "unknown", "never",
		]);

		const nonKeywordIds = identifiers.filter((id) => !keywords.has(id));
		if (nonKeywordIds.length < 10) return findings;

		const singleCharCount = nonKeywordIds.filter((id) => id.length === 1).length;
		const ratio = singleCharCount / nonKeywordIds.length;

		if (ratio > OBFUSCATION_RATIO_THRESHOLD) {
			findings.push({
				threat: "code-injection", severity: "warning",
				pattern: "obfuscated-identifiers", line: 0,
				snippet: `${(ratio * 100).toFixed(0)}% single-char identifiers (${singleCharCount}/${nonKeywordIds.length})`,
				message: `Code appears obfuscated: ${(ratio * 100).toFixed(0)}% single-character identifiers`,
			});
		}
		return findings;
	}

	// ─── Verdict Computation ──────────────────────────────────────────

	/** Compute a risk score in [0, 1]. Weights: block=0.25, critical=0.20, warning=0.05, info=0.01 */
	private computeRiskScore(findings: SurakshaFinding[]): number {
		let score = 0;
		for (const f of findings) {
			switch (f.severity) {
				case "block": score += 0.25; break;
				case "critical": score += 0.20; break;
				case "warning": score += 0.05; break;
				case "info": score += 0.01; break;
			}
		}
		return Math.min(1, score);
	}

	/** Compute the overall verdict from findings and risk score. */
	private computeVerdict(findings: SurakshaFinding[], riskScore: number): SurakshaVerdict {
		const blockingThreats = new Set(this.config.blockingThreats);
		const hasBlocking = findings.some((f) => f.severity === "block" && blockingThreats.has(f.threat));
		if (hasBlocking) return "malicious";

		const hasCriticalBlocking = findings.some((f) => f.severity === "critical" && blockingThreats.has(f.threat));
		if (hasCriticalBlocking || riskScore > 0.5) return "dangerous";

		const hasWarnings = findings.some((f) => f.severity === "warning" || f.severity === "critical");
		if (hasWarnings || riskScore > 0.15) return "suspicious";

		return "clean";
	}
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/** Clamp a number between min and max. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Truncate a string to a maximum length, adding "..." if truncated. */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 3) + "...";
}

/**
 * Compute Shannon entropy of a string in bits per character.
 *
 *   H = -sum(p_i * log2(p_i)) for each unique character
 *
 * English text: ~4.0-4.5, Base64: ~5.2, random bytes: ~8.0
 */
export function shannonEntropy(str: string): number {
	if (str.length === 0) return 0;
	const freq = new Map<string, number>();
	for (const ch of str) {
		freq.set(ch, (freq.get(ch) ?? 0) + 1);
	}
	let entropy = 0;
	const len = str.length;
	for (const count of freq.values()) {
		const p = count / len;
		if (p > 0) entropy -= p * Math.log2(p);
	}
	return entropy;
}

/**
 * Extract string literals from a line of code.
 * Handles single quotes, double quotes, and backticks.
 * Respects escaped quotes within strings.
 */
function extractStringLiterals(line: string): string[] {
	const results: string[] = [];
	const regex = /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(line)) !== null) {
		const literal = match[0].slice(1, -1);
		results.push(literal);
	}
	return results;
}
