/**
 * @chitragupta/dharma — Rta types, constants, and pattern definitions.
 *
 * Type definitions and security patterns for the Rta invariant layer.
 * Extracted from rta.ts to keep files under 450 LOC.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Context supplied to every Rta invariant check. */
export interface RtaContext {
	toolName: string;
	args: Record<string, unknown>;
	workingDirectory: string;
	/** Recent messages for context-aware checks. */
	recentMessages?: Array<{ role: string; content: string }>;
	/** Session metadata. */
	sessionId?: string;
	project?: string;
	/** Current agent depth (0 = root). */
	agentDepth?: number;
	/** Purpose string of the current agent spawn (for loop detection). */
	agentPurpose?: string;
	/** Recently spawned agent purposes (for loop detection). */
	recentSpawnPurposes?: string[];
	/** Estimated cost of the next operation in dollars. */
	estimatedCost?: number;
	/** Total cost already spent in this session in dollars. */
	totalCostSoFar?: number;
	/** Session cost budget in dollars. 0 = unlimited. */
	costBudget?: number;
	/** Allowed external domains for network access. */
	allowedDomains?: string[];
}

/** The result of evaluating a single Rta invariant rule. */
export interface RtaVerdict {
	allowed: boolean;
	ruleId: string;
	reason?: string;
	/** Suggested safe alternative if blocked. */
	alternative?: string;
}

/** A single Rta invariant rule. All Rta rules are critical. */
export interface RtaRule {
	id: string;
	name: string;
	description: string;
	severity: "critical";
	check: (context: RtaContext) => RtaVerdict;
}

/** An entry in the Rta audit log. */
export interface RtaAuditEntry {
	timestamp: number;
	ruleId: string;
	allowed: boolean;
	toolName: string;
	reason?: string;
	sessionId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * System hard ceiling for agent tree depth. Mirrors the value from
 * @chitragupta/anina (SYSTEM_MAX_AGENT_DEPTH). Defined here to avoid
 * a circular dependency between dharma and anina.
 */
export const RTA_SYSTEM_MAX_AGENT_DEPTH = 10;

/** Maximum audit log entries retained in memory. */
export const MAX_AUDIT_LOG_SIZE = 1000;

/** Default per-session cost budget in dollars. */
export const DEFAULT_COST_BUDGET = 10;

/** Maximum identical consecutive spawn purposes before triggering loop detection. */
export const MAX_REPEATED_SPAWN_PURPOSES = 3;

// ─── Credential Patterns ─────────────────────────────────────────────────────

/**
 * Patterns that match credential-bearing output paths or argument values.
 * Covers API keys, tokens, secrets, passwords, and credential file references.
 */
export const CREDENTIAL_ARG_PATTERN =
	/(?:api[_-]?key|token|secret|password|credential|passwd|private[_-]?key)/i;

/** Patterns for bash commands that would dump credential files. */
export const CREDENTIAL_DUMP_PATTERNS: RegExp[] = [
	// echo/cat/head/tail/less/more of credential files
	/(?:echo|cat|head|tail|less|more|bat)\s+.*(?:\.env|credentials\.json|\.netrc|\.npmrc|\.pypirc|id_rsa|id_ed25519|\.pem)/i,
	// printenv / env for credential variables
	/(?:printenv|env)\s+.*(?:api[_-]?key|token|secret|password|credential)/i,
	// Echoing env vars that look like credentials
	/echo\s+.*\$\{?(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AWS_SECRET)/i,
];

// ─── Protected System Paths ──────────────────────────────────────────────────

/** Paths that must never be written to (Unix + Windows system dirs). */
export const PROTECTED_PATH_PREFIXES: string[] = [
	// Unix / macOS
	"/etc/",
	"/usr/",
	"/System/",
	"/bin/",
	"/sbin/",
	"/var/",
	"/boot/",
	"/lib/",
	"/lib64/",
	// Windows (case-insensitive check in rule implementation)
	"C:\\Windows\\",
	"C:\\Program Files\\",
	"C:\\Program Files (x86)\\",
];

/** Specific files that must never be written to (exact basename or suffix match). */
export const PROTECTED_FILES: string[] = [
	".git/config",
	".git/HEAD",
	".git/hooks/",
];

/** Files that should not be overwritten unless explicitly safe. */
export const PROTECTED_OVERWRITE_FILES: string[] = [
	"package-lock.json",
	".env",
];

// ─── Exfiltration Patterns ───────────────────────────────────────────────────

/** Matches curl/wget/fetch commands sending data to non-localhost URLs. */
export const EXFILTRATION_CMD_PATTERNS: RegExp[] = [
	// curl with data flags
	/curl\s+(?:.*\s)?(?:-d\s|-F\s|--data\s|--data-binary\s|--data-raw\s|--data-urlencode\s|--upload-file\s)/,
	// Piping into curl/wget
	/\|\s*(?:curl|wget)\s/,
	// wget with post
	/wget\s+(?:.*\s)?--post-(?:data|file)[\s=]/,
	// nc/netcat as sink
	/\|\s*(?:nc|netcat)\s/,
	// Node/Python fetch/requests with local files
	/(?:node|python|python3)\s+-e\s+.*(?:fetch|requests\.post|urllib)/,
];

/** Matches localhost/loopback URLs (exempted from exfiltration checks). */
export const LOCALHOST_PATTERN =
	/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)/i;


/** Database interface for persisting Rta audit logs. */
export interface RtaDatabaseLike {
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
	};
	transaction<T>(fn: (args: T) => void): (args: T) => void;
}
