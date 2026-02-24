/**
 * Suraksha Types & Threat Pattern Database.
 *
 * Extracted from suraksha.ts to stay within 450 LOC limit.
 * Contains all type definitions, constants, and the built-in
 * threat pattern database used by the SurakshaScanner.
 *
 * @packageDocumentation
 */

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

/** Internal threat pattern structure. */
export interface ThreatPattern {
	pattern: RegExp;
	threat: ThreatCategory;
	severity: FindingSeverity;
	message: string;
}

// ─── System Ceilings ────────────────────────────────────────────────────────

/** Hard ceilings that cannot be exceeded regardless of config. */
export const CEILING_MAX_FILE_SIZE = 500_000;
export const CEILING_MAX_FILES_PER_SKILL = 100;

// ─── Default Config ─────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: Required<Omit<SurakshaConfig, "customPatterns">> & { customPatterns: CustomPattern[] } = {
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

// ─── Heuristic Constants ────────────────────────────────────────────────────

/** Entropy threshold for flagging obfuscated string literals (bits/char). */
export const ENTROPY_THRESHOLD = 4.5;

/** Minimum string literal length for entropy analysis. */
export const ENTROPY_MIN_LENGTH = 50;

/** Threshold: if >60% of identifiers are single-char, flag as obfuscated. */
export const OBFUSCATION_RATIO_THRESHOLD = 0.6;

// ─── Threat Pattern Database ────────────────────────────────────────────────

/** All built-in threat patterns organized by category. */
export const THREAT_PATTERNS: ThreatPattern[] = [
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
