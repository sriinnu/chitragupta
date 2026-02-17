/**
 * Suraksha (सुरक्षा — Protection) — Deep Static Security Scanner for Skills.
 *
 * Performs multi-layered static analysis on skill content to detect
 * 8 categories of security threats before any code reaches the ecosystem.
 *
 * ## Threat Categories
 *
 * | ID | Category          | Severity | Purpose                              |
 * |----|-------------------|----------|--------------------------------------|
 * | T1 | Prompt Injection  | critical | Detect LLM manipulation attempts     |
 * | T2 | Code Injection    | block    | eval(), Function(), require(), etc.  |
 * | T3 | Proto Pollution   | block    | __proto__, constructor.prototype     |
 * | T4 | Network Exfil     | block    | fetch(), http.request(), WebSocket   |
 * | T5 | FS Escape         | block    | Path traversal, symlinks, /etc/      |
 * | T6 | Env Probing       | critical | process.env, os.userInfo(), etc.     |
 * | T7 | Supply Chain      | warning  | postinstall, curl|bash               |
 * | T8 | Dynamic Exec      | block    | setTimeout('str'), WebAssembly       |
 *
 * ## Heuristics
 *
 * - **Shannon entropy**: String literals >50 chars with entropy >4.5 bits/char
 *   flag as possible obfuscated payloads.
 * - **Identifier ratio**: >60% single-char variable names suggest minification
 *   or intentional obfuscation.
 *
 * ## Design Principles
 *
 * - Zero external dependencies — pure string analysis
 * - Two-tier config: user-configurable defaults clamped by system hard ceilings
 * - Reuses FNV-1a from fingerprint.ts for content hashing
 * - Every pattern match produces a line number and snippet for human review
 *
 * @packageDocumentation
 */

import { fnv1a } from "./fingerprint.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The 8 threat categories scanned by Suraksha. */
export type ThreatCategory =
	| "prompt-injection"
	| "code-injection"
	| "prototype-pollution"
	| "network-exfiltration"
	| "filesystem-escape"
	| "environment-probing"
	| "supply-chain"
	| "dynamic-execution";

/** Severity levels for scan findings. */
export type FindingSeverity = "info" | "warning" | "critical" | "block";

/** A single finding from the security scan. */
export interface SurakshaFinding {
	/** Which threat category this finding belongs to. */
	threat: ThreatCategory;
	/** How severe this finding is. */
	severity: FindingSeverity;
	/** The pattern that matched (human-readable). */
	pattern: string;
	/** 1-based line number where the finding was detected. */
	line: number;
	/** Truncated snippet of the matching content (max 100 chars). */
	snippet: string;
	/** Human-readable explanation of the threat. */
	message: string;
}

/** Overall verdict from a scan. */
export type SurakshaVerdict = "clean" | "suspicious" | "dangerous" | "malicious";

/** Complete result of a Suraksha scan. */
export interface SurakshaScanResult {
	/** Name of the skill that was scanned. */
	skillName: string;
	/** Overall verdict based on findings. */
	verdict: SurakshaVerdict;
	/** Individual findings from all threat categories. */
	findings: SurakshaFinding[];
	/** Risk score in [0, 1] where 0 = safe, 1 = malicious. */
	riskScore: number;
	/** Time taken for the scan in milliseconds. */
	scanDurationMs: number;
	/** FNV-1a hash of the scanned content (for caching). */
	contentHash: number;
}

/** Configuration for the Suraksha scanner. */
export interface SurakshaConfig {
	/** Max file size in bytes to scan. Default: 100_000, ceiling: 500_000. */
	maxFileSizeBytes?: number;
	/** Max number of files per skill to scan. Default: 20, ceiling: 100. */
	maxFilesPerSkill?: number;
	/** Allowed source file extensions. Default: ['.ts', '.js', '.mjs', '.json']. */
	allowedSourceExtensions?: string[];
	/** Which threat categories produce blocking verdicts. Default: all except supply-chain. */
	blockingThreats?: ThreatCategory[];
	/** Additional custom patterns to scan for. */
	customPatterns?: CustomPattern[];
	/** Whether to enable heuristic analysis. Default: true. */
	enableHeuristics?: boolean;
}

/** A user-defined custom scan pattern. */
export interface CustomPattern {
	/** Regular expression to match. */
	pattern: RegExp;
	/** Threat category to assign matches to. */
	threat: ThreatCategory;
	/** Severity of matches. */
	severity: FindingSeverity;
	/** Human-readable description of what this pattern detects. */
	message: string;
}

// ─── System Ceilings ────────────────────────────────────────────────────────

/** Hard ceilings that cannot be exceeded regardless of config. */
const CEILING_MAX_FILE_SIZE = 500_000;
const CEILING_MAX_FILES_PER_SKILL = 100;

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<Omit<SurakshaConfig, "customPatterns">> & { customPatterns: CustomPattern[] } = {
	maxFileSizeBytes: 100_000,
	maxFilesPerSkill: 20,
	allowedSourceExtensions: [".ts", ".js", ".mjs", ".json", ".md"],
	blockingThreats: [
		"prompt-injection",
		"code-injection",
		"prototype-pollution",
		"network-exfiltration",
		"filesystem-escape",
		"environment-probing",
		"dynamic-execution",
	],
	customPatterns: [],
	enableHeuristics: true,
};

// ─── Threat Pattern Database ────────────────────────────────────────────────

interface ThreatPattern {
	pattern: RegExp;
	threat: ThreatCategory;
	severity: FindingSeverity;
	message: string;
}

/** All built-in threat patterns organized by category. */
const THREAT_PATTERNS: ThreatPattern[] = [
	// ── T1: Prompt Injection (~10 patterns) ────────────────────────────
	{ pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: attempts to override system instructions" },
	{ pattern: /you\s+are\s+now\s+(?:a|an)\s/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: attempts to redefine agent identity" },
	{ pattern: /\[INST\]/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: Llama/Mistral instruction token" },
	{ pattern: /<<SYS>>/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: Llama system prompt token" },
	{ pattern: /system:\s*you\s+(?:are|must|should|will)/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: fake system message prefix" },
	{ pattern: /\bBEGIN\s+SYSTEM\s+MESSAGE\b/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: fake system message boundary" },
	{ pattern: /\bforget\s+(?:all|your|everything|previous)\b/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: memory erasure attempt" },
	{ pattern: /\bdo\s+not\s+follow\s+(?:any|the|your)\s+(?:previous|above|other)\b/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: instruction override" },
	{ pattern: /\boverride\s+(?:all|your|the)\s+(?:rules|instructions|guidelines)\b/i, threat: "prompt-injection", severity: "critical", message: "Prompt injection: rule override attempt" },
	{ pattern: /\bact\s+as\s+(?:if|though)\s+you\s+(?:have|are|were)\b/i, threat: "prompt-injection", severity: "warning", message: "Prompt injection: behavioral manipulation attempt" },

	// ── T2: Code Injection (~20 patterns) ──────────────────────────────
	{ pattern: /\beval\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: eval() call" },
	{ pattern: /\bnew\s+Function\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: new Function() constructor" },
	{ pattern: /\brequire\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: require() call (CommonJS import)" },
	{ pattern: /\bimport\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: dynamic import()" },
	{ pattern: /\bchild_process\b/, threat: "code-injection", severity: "block", message: "Code injection: child_process module reference" },
	{ pattern: /\bexecSync\b/, threat: "code-injection", severity: "block", message: "Code injection: execSync call" },
	{ pattern: /\bexecFile(?:Sync)?\b/, threat: "code-injection", severity: "block", message: "Code injection: execFile/execFileSync call" },
	{ pattern: /\bspawn(?:Sync)?\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: spawn/spawnSync call" },
	{ pattern: /\bexec\s*\(/, threat: "code-injection", severity: "block", message: "Code injection: exec() call" },
	{ pattern: /\bvm\.runIn(?:ThisContext|NewContext|Context)\b/, threat: "code-injection", severity: "block", message: "Code injection: Node.js VM execution" },
	{ pattern: /\bvm\.createContext\b/, threat: "code-injection", severity: "block", message: "Code injection: VM context creation" },
	{ pattern: /\bvm\.Script\b/, threat: "code-injection", severity: "block", message: "Code injection: VM Script creation" },
	{ pattern: /\bmodule\.constructor\b/, threat: "code-injection", severity: "block", message: "Code injection: module constructor access" },
	{ pattern: /\bglobalThis\s*\[/, threat: "code-injection", severity: "block", message: "Code injection: dynamic globalThis access" },
	{ pattern: /\bprocess\.binding\b/, threat: "code-injection", severity: "block", message: "Code injection: process.binding() (native module access)" },
	{ pattern: /\bprocess\.dlopen\b/, threat: "code-injection", severity: "block", message: "Code injection: process.dlopen() (native addon loading)" },
	{ pattern: /\bprocess\.kill\b/, threat: "code-injection", severity: "block", message: "Code injection: process.kill() call" },
	{ pattern: /\bprocess\.exit\b/, threat: "code-injection", severity: "block", message: "Code injection: process.exit() call" },
	{ pattern: /\brequire\.resolve\b/, threat: "code-injection", severity: "warning", message: "Code injection: require.resolve() (module resolution probing)" },
	{ pattern: /\bimport\.meta\b/, threat: "code-injection", severity: "warning", message: "Code injection: import.meta access (environment probing)" },

	// ── T3: Prototype Pollution (~7 patterns) ──────────────────────────
	{ pattern: /__proto__/, threat: "prototype-pollution", severity: "block", message: "Prototype pollution: __proto__ access" },
	{ pattern: /constructor\s*\.\s*prototype/, threat: "prototype-pollution", severity: "block", message: "Prototype pollution: constructor.prototype access" },
	{ pattern: /Object\s*\.\s*setPrototypeOf\b/, threat: "prototype-pollution", severity: "block", message: "Prototype pollution: Object.setPrototypeOf()" },
	{ pattern: /Object\s*\.\s*defineProperty\b/, threat: "prototype-pollution", severity: "warning", message: "Prototype pollution: Object.defineProperty() (may redefine inherited properties)" },
	{ pattern: /Object\s*\.\s*defineProperties\b/, threat: "prototype-pollution", severity: "warning", message: "Prototype pollution: Object.defineProperties()" },
	{ pattern: /Reflect\s*\.\s*setPrototypeOf\b/, threat: "prototype-pollution", severity: "block", message: "Prototype pollution: Reflect.setPrototypeOf()" },
	{ pattern: /\bconstructor\s*\[/, threat: "prototype-pollution", severity: "block", message: "Prototype pollution: dynamic constructor property access" },

	// ── T4: Network Exfiltration (~12 patterns) ────────────────────────
	{ pattern: /\bfetch\s*\(/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: fetch() call" },
	{ pattern: /\bhttp\s*\.\s*request\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: http.request()" },
	{ pattern: /\bhttps\s*\.\s*request\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: https.request()" },
	{ pattern: /\bhttp\s*\.\s*get\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: http.get()" },
	{ pattern: /\bhttps\s*\.\s*get\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: https.get()" },
	{ pattern: /\bnew\s+WebSocket\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: WebSocket connection" },
	{ pattern: /\bnet\s*\.\s*connect\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: net.connect()" },
	{ pattern: /\bnet\s*\.\s*createConnection\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: net.createConnection()" },
	{ pattern: /\bdgram\s*\.\s*createSocket\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: UDP socket creation" },
	{ pattern: /\baxios\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: axios HTTP library" },
	{ pattern: /\bundici\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: undici HTTP library" },
	{ pattern: /\bXMLHttpRequest\b/, threat: "network-exfiltration", severity: "block", message: "Network exfiltration: XMLHttpRequest" },

	// ── T5: Filesystem Escape (~8 patterns) ────────────────────────────
	{ pattern: /\.\.\// , threat: "filesystem-escape", severity: "block", message: "Filesystem escape: parent directory traversal (../)" },
	{ pattern: /\/etc\/(?:passwd|shadow|hosts|resolv\.conf)/, threat: "filesystem-escape", severity: "block", message: "Filesystem escape: system file access" },
	{ pattern: /\bfs\s*\.\s*(?:symlink|link)(?:Sync)?\b/, threat: "filesystem-escape", severity: "block", message: "Filesystem escape: symlink creation" },
	{ pattern: /\bfs\s*\.\s*(?:chmod|chown)(?:Sync)?\b/, threat: "filesystem-escape", severity: "block", message: "Filesystem escape: permission modification" },
	{ pattern: /\bpath\s*\.\s*resolve\s*\(\s*['"]\.\.\b/, threat: "filesystem-escape", severity: "block", message: "Filesystem escape: path.resolve with parent traversal" },
	{ pattern: /\/dev\/(?:null|zero|random|urandom)/, threat: "filesystem-escape", severity: "warning", message: "Filesystem escape: device file access" },
	{ pattern: /~\/\.\w+/, threat: "filesystem-escape", severity: "warning", message: "Filesystem escape: hidden config file access in home directory" },
	{ pattern: /\bfs\s*\.\s*(?:rm|rmdir)(?:Sync)?\b/, threat: "filesystem-escape", severity: "block", message: "Filesystem escape: file/directory deletion" },

	// ── T6: Environment Probing (~9 patterns) ──────────────────────────
	{ pattern: /\bprocess\s*\.\s*env\b/, threat: "environment-probing", severity: "critical", message: "Environment probing: process.env access" },
	{ pattern: /\bos\s*\.\s*userInfo\s*\(/, threat: "environment-probing", severity: "critical", message: "Environment probing: os.userInfo() — user identity leak" },
	{ pattern: /\bos\s*\.\s*hostname\s*\(/, threat: "environment-probing", severity: "critical", message: "Environment probing: os.hostname() — host identity leak" },
	{ pattern: /\bos\s*\.\s*networkInterfaces\s*\(/, threat: "environment-probing", severity: "critical", message: "Environment probing: os.networkInterfaces() — network topology leak" },
	{ pattern: /\bos\s*\.\s*homedir\s*\(/, threat: "environment-probing", severity: "critical", message: "Environment probing: os.homedir() — home directory leak" },
	{ pattern: /\bprocess\s*\.\s*argv\b/, threat: "environment-probing", severity: "critical", message: "Environment probing: process.argv — command-line argument leak" },
	{ pattern: /\bprocess\s*\.\s*cwd\s*\(/, threat: "environment-probing", severity: "warning", message: "Environment probing: process.cwd() — working directory leak" },
	{ pattern: /\bprocess\s*\.\s*version\b/, threat: "environment-probing", severity: "warning", message: "Environment probing: process.version — runtime version leak" },
	{ pattern: /\bprocess\s*\.\s*platform\b/, threat: "environment-probing", severity: "warning", message: "Environment probing: process.platform — OS platform leak" },

	// ── T7: Supply Chain (~5 patterns) ─────────────────────────────────
	{ pattern: /\bpostinstall\b/, threat: "supply-chain", severity: "warning", message: "Supply chain: postinstall script hook" },
	{ pattern: /\bpreinstall\b/, threat: "supply-chain", severity: "warning", message: "Supply chain: preinstall script hook" },
	{ pattern: /curl\s.*\|\s*(?:ba)?sh/i, threat: "supply-chain", severity: "critical", message: "Supply chain: curl|bash remote execution" },
	{ pattern: /wget\s.*\|\s*(?:ba)?sh/i, threat: "supply-chain", severity: "critical", message: "Supply chain: wget|bash remote execution" },
	{ pattern: /npm\s+exec\b/, threat: "supply-chain", severity: "warning", message: "Supply chain: npm exec (npx) — arbitrary package execution" },

	// ── T8: Dynamic Execution (~6 patterns) ────────────────────────────
	{ pattern: /\bsetTimeout\s*\(\s*['"`]/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: setTimeout with string argument" },
	{ pattern: /\bsetInterval\s*\(\s*['"`]/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: setInterval with string argument" },
	{ pattern: /\bnew\s+AsyncFunction\b/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: AsyncFunction constructor" },
	{ pattern: /\bWebAssembly\s*\.\s*(?:instantiate|compile|Module)\b/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: WebAssembly loading" },
	{ pattern: /\batob\s*\(.*\beval\b/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: base64 decode + eval chain" },
	{ pattern: /\bGeneratorFunction\b/, threat: "dynamic-execution", severity: "block", message: "Dynamic execution: GeneratorFunction constructor" },
];

// ─── Heuristic Constants ────────────────────────────────────────────────────

/** Entropy threshold for flagging obfuscated string literals (bits/char). */
const ENTROPY_THRESHOLD = 4.5;

/** Minimum string literal length for entropy analysis. */
const ENTROPY_MIN_LENGTH = 50;

/** Threshold: if >60% of identifiers are single-char, flag as obfuscated. */
const OBFUSCATION_RATIO_THRESHOLD = 0.6;

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

		return {
			skillName,
			verdict,
			findings,
			riskScore,
			scanDurationMs,
			contentHash,
		};
	}

	/**
	 * Scan multiple content entries (e.g., a skill with multiple source files).
	 *
	 * @param skillName - Name of the skill.
	 * @param files - Map of file paths to content strings.
	 * @returns Merged scan result across all files.
	 */
	scanMultiple(
		skillName: string,
		files: Map<string, string>,
	): SurakshaScanResult {
		const start = performance.now();
		const allFindings: SurakshaFinding[] = [];
		let mergedHash = 0;

		// Enforce file count ceiling
		let fileCount = 0;
		for (const [filePath, content] of files) {
			if (fileCount >= this.config.maxFilesPerSkill) {
				allFindings.push({
					threat: "supply-chain",
					severity: "warning",
					pattern: "file-count-exceeded",
					line: 0,
					snippet: `${files.size} files (limit: ${this.config.maxFilesPerSkill})`,
					message: `Skill contains more than ${this.config.maxFilesPerSkill} files — only first ${this.config.maxFilesPerSkill} scanned`,
				});
				break;
			}

			// Check extension allowlist
			const ext = filePath.slice(filePath.lastIndexOf("."));
			if (!this.config.allowedSourceExtensions.includes(ext)) {
				allFindings.push({
					threat: "supply-chain",
					severity: "info",
					pattern: "disallowed-extension",
					line: 0,
					snippet: filePath,
					message: `File extension "${ext}" not in allowed list — skipped`,
				});
				continue;
			}

			const result = this.scan(skillName, content);
			// Prefix findings with file path context
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

		return {
			skillName,
			verdict,
			findings: allFindings,
			riskScore,
			scanDurationMs,
			contentHash: mergedHash,
		};
	}

	/**
	 * Get the resolved configuration (with ceilings applied).
	 */
	getConfig(): Readonly<typeof this.config> {
		return this.config;
	}

	// ─── Heuristic: Shannon Entropy ───────────────────────────────────

	/**
	 * Detect obfuscated payloads via Shannon entropy of string literals.
	 *
	 * High-entropy strings (>4.5 bits/char) in long literals (>50 chars)
	 * suggest Base64-encoded, encrypted, or deliberately obfuscated content.
	 */
	private analyzeEntropy(
		_content: string,
		lines: string[],
	): SurakshaFinding[] {
		const findings: SurakshaFinding[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Extract string literals (single/double/backtick quoted)
			const stringLiterals = extractStringLiterals(line);

			for (const literal of stringLiterals) {
				if (literal.length < ENTROPY_MIN_LENGTH) continue;

				const entropy = shannonEntropy(literal);
				if (entropy > ENTROPY_THRESHOLD) {
					findings.push({
						threat: "code-injection",
						severity: "warning",
						pattern: "high-entropy-string",
						line: i + 1,
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
	 *
	 * When >60% of identifiers are single characters, the code is likely
	 * minified or intentionally obfuscated to evade pattern matching.
	 */
	private analyzeObfuscation(content: string): SurakshaFinding[] {
		const findings: SurakshaFinding[] = [];

		// Extract identifiers (simple heuristic: word boundaries, letter-start)
		const identifiers = content.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g);
		if (!identifiers || identifiers.length < 20) return findings;

		// Filter out common keywords
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
				threat: "code-injection",
				severity: "warning",
				pattern: "obfuscated-identifiers",
				line: 0,
				snippet: `${(ratio * 100).toFixed(0)}% single-char identifiers (${singleCharCount}/${nonKeywordIds.length})`,
				message: `Code appears obfuscated: ${(ratio * 100).toFixed(0)}% single-character identifiers`,
			});
		}

		return findings;
	}

	// ─── Verdict Computation ──────────────────────────────────────────

	/**
	 * Compute a risk score in [0, 1] from the findings.
	 *
	 * Weights: block=0.25, critical=0.20, warning=0.05, info=0.01
	 * Capped at 1.0.
	 */
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

	/**
	 * Compute the overall verdict from findings and risk score.
	 *
	 * - malicious: any blocking threat found
	 * - dangerous: risk > 0.5 or critical findings in blocking categories
	 * - suspicious: risk > 0.15 or any warnings
	 * - clean: no significant findings
	 */
	private computeVerdict(
		findings: SurakshaFinding[],
		riskScore: number,
	): SurakshaVerdict {
		const blockingThreats = new Set(this.config.blockingThreats);

		// Check for blocking findings
		const hasBlocking = findings.some(
			(f) => f.severity === "block" && blockingThreats.has(f.threat),
		);
		if (hasBlocking) return "malicious";

		// Check for critical findings in blocking categories
		const hasCriticalBlocking = findings.some(
			(f) => f.severity === "critical" && blockingThreats.has(f.threat),
		);
		if (hasCriticalBlocking || riskScore > 0.5) return "dangerous";

		// Check for any warnings
		const hasWarnings = findings.some(
			(f) => f.severity === "warning" || f.severity === "critical",
		);
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
		if (p > 0) {
			entropy -= p * Math.log2(p);
		}
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
		// Strip the surrounding quotes
		const literal = match[0].slice(1, -1);
		results.push(literal);
	}

	return results;
}
