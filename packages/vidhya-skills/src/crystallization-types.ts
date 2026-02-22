/**
 * Crystallization Types and Configuration.
 *
 * Contains interfaces, configuration constants, and security patterns
 * for the Skill Crystallization (Sphateekarana) pipeline.
 *
 * @packageDocumentation
 */

import { fnv1a } from "./fingerprint.js";

// ─── VidhiLike Interface (duck-typed) ───────────────────────────────────────

/**
 * Duck-typed interface for Vidhi procedures from @chitragupta/smriti.
 * Avoids a hard dependency on the smriti package while maintaining
 * type safety at the crystallization boundary.
 */
export interface VidhiLike {
	/** FNV-1a hash ID. */
	id: string;
	/** Procedure name slug. */
	name: string;
	/** Confidence in this procedure [0, 1]. */
	confidence: number;
	/** Success rate [0, 1]. */
	successRate: number;
	/** Total successful executions. */
	successCount: number;
	/** Total failed executions. */
	failureCount: number;
	/** Ordered procedure steps. */
	steps: Array<{ index: number; toolName: string; description: string }>;
	/** NLU trigger phrases. */
	triggers: string[];
	/** Extracted parameter schema. */
	parameterSchema: Record<string, unknown>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configurable defaults for the crystallization pipeline. */
export interface CrystallizationConfig {
	/** Minimum Vidhi confidence to consider crystallization. Default: 0.8. */
	minVidhiConfidence: number;
	/** Minimum success rate [0, 1]. Default: 0.7. */
	minSuccessRate: number;
	/** Minimum successful executions. Default: 5. */
	minExecutions: number;
	/** Whether to auto-register approved skills (skip manual approval). Default: false. */
	autoRegister: boolean;
	/** Sandbox timeout for test phase in ms. Default: 30000. */
	sandboxTimeout: number;
	/** Maximum crystallized skills per project. Default: 50. */
	maxSkillsPerProject: number;
	/** Thompson Sampling deprecation threshold. Default: 0.3. */
	deprecationThreshold: number;
}

/** System hard ceilings that cannot be exceeded regardless of config. */
export const CRYSTALLIZATION_HARD_CEILINGS: Readonly<CrystallizationConfig> = {
	minVidhiConfidence: 0.3,        // Floor: can't go below 0.3 confidence
	minSuccessRate: 0.3,            // Floor: can't go below 0.3 success rate
	minExecutions: 1,               // Floor: at least 1 execution
	autoRegister: false,            // Ceiling: doesn't apply (boolean)
	sandboxTimeout: 120_000,        // Ceiling: max 2 minutes
	maxSkillsPerProject: 200,       // Ceiling: hard max 200
	deprecationThreshold: 0.1,      // Floor: can't deprecate above 0.1
};

/** Default configuration values. */
export const DEFAULT_CRYSTALLIZATION_CONFIG: Readonly<CrystallizationConfig> = {
	minVidhiConfidence: 0.8,
	minSuccessRate: 0.7,
	minExecutions: 5,
	autoRegister: false,
	sandboxTimeout: 30_000,
	maxSkillsPerProject: 50,
	deprecationThreshold: 0.3,
};

// ─── Status & Result Types ──────────────────────────────────────────────────

/** Lifecycle status of a crystallized skill. */
export type CrystallizationStatus =
	| "candidate"
	| "synthesizing"
	| "scanning"
	| "testing"
	| "approved"
	| "registered"
	| "failed"
	| "rejected"
	| "deprecated";

/** A Vidhi that has been evaluated for crystallization eligibility. */
export interface CrystallizationCandidate {
	/** Vidhi ID. */
	vidhiId: string;
	/** Vidhi name slug. */
	vidhiName: string;
	/** Current confidence [0, 1]. */
	confidence: number;
	/** Success rate [0, 1]. */
	successRate: number;
	/** Total successful executions (successCount). */
	executionCount: number;
	/** Ordered steps of the procedure. */
	steps: Array<{ toolName: string; description: string }>;
	/** Trigger phrases. */
	triggers: string[];
	/** Whether all thresholds are met. */
	readyToCrystallize: boolean;
	/** Why not ready, if applicable. */
	reason?: string;
}

/** A Vidhi that has been (or is being) crystallized into a skill. */
export interface CrystallizedSkill {
	/** Deterministic FNV-1a ID from vidhiId + "crystal". */
	id: string;
	/** Source Vidhi ID. */
	vidhiId: string;
	/** Generated skill name (kebab-case). */
	skillName: string;
	/** Human-readable description. */
	description: string;
	/** Current pipeline status. */
	status: CrystallizationStatus;
	/** Generated implementation (tool-chain JSON manifest). */
	implementation: string;
	/** Security scan result. */
	scanResult?: { clean: boolean; issues: string[] };
	/** Structural test result. */
	testResult?: { passed: boolean; errors: string[] };
	/** Thompson Sampling alpha (successes + 1). */
	thompsonAlpha: number;
	/** Thompson Sampling beta (failures + 1). */
	thompsonBeta: number;
	/** Rejection reason, if rejected. */
	rejectionReason?: string;
	/** Unix timestamp of registration (if registered). */
	registeredAt?: number;
	/** Unix timestamp of creation. */
	createdAt: number;
}

// ─── Security Patterns ──────────────────────────────────────────────────────

/**
 * Security patterns for the scan phase.
 * These are Suraksha-lite: a focused subset for crystallized tool-chains.
 */
export interface SecurityPattern {
	pattern: RegExp;
	category: string;
	message: string;
}

export const SECURITY_PATTERNS: SecurityPattern[] = [
	// Network access
	{ pattern: /\bfetch\s*\(/, category: "network", message: "fetch() call detected — potential network access" },
	{ pattern: /\bhttp[s]?:\/\//, category: "network", message: "HTTP/HTTPS URL detected — potential network access" },
	{ pattern: /\brequire\s*\(\s*['"]https?['"]/, category: "network", message: "require('http/https') — network module import" },
	{ pattern: /\bXMLHttpRequest\b/, category: "network", message: "XMLHttpRequest detected — network access" },
	{ pattern: /\bWebSocket\b/, category: "network", message: "WebSocket detected — network access" },
	{ pattern: /\baxios\b/, category: "network", message: "axios reference — network library" },
	{ pattern: /\bnode-fetch\b/, category: "network", message: "node-fetch reference — network library" },
	{ pattern: /\bcurl\b/, category: "network", message: "curl command — network access" },
	{ pattern: /\bwget\b/, category: "network", message: "wget command — network access" },

	// File system writes outside project
	{ pattern: /\/etc\//, category: "fs-escape", message: "Reference to /etc/ — system directory access" },
	{ pattern: /\/usr\//, category: "fs-escape", message: "Reference to /usr/ — system directory access" },
	{ pattern: /\/var\//, category: "fs-escape", message: "Reference to /var/ — system directory access" },
	{ pattern: /\/tmp\//, category: "fs-escape", message: "Reference to /tmp/ — temp directory access" },
	{ pattern: /\/root\//, category: "fs-escape", message: "Reference to /root/ — root home directory" },
	{ pattern: /~\/\.ssh/, category: "fs-escape", message: "Reference to ~/.ssh — SSH key directory" },
	{ pattern: /~\/\.gnupg/, category: "fs-escape", message: "Reference to ~/.gnupg — GPG key directory" },
	{ pattern: /\.\.\// , category: "fs-escape", message: "Path traversal with ../ detected" },

	// Process spawning
	{ pattern: /\bexec\s*\(/, category: "process", message: "exec() call — process spawning" },
	{ pattern: /\bspawn\s*\(/, category: "process", message: "spawn() call — process spawning" },
	{ pattern: /\bfork\s*\(/, category: "process", message: "fork() call — process forking" },
	{ pattern: /\bchild_process\b/, category: "process", message: "child_process module reference" },
	{ pattern: /\bexecFile\s*\(/, category: "process", message: "execFile() call — process spawning" },
	{ pattern: /\bexecSync\s*\(/, category: "process", message: "execSync() call — synchronous process spawning" },

	// Credential patterns
	{ pattern: /\bAPI_KEY\b/, category: "credential", message: "API_KEY reference — potential credential exposure" },
	{ pattern: /\bSECRET\b/, category: "credential", message: "SECRET reference — potential credential exposure" },
	{ pattern: /\bPASSWORD\b/, category: "credential", message: "PASSWORD reference — potential credential exposure" },
	{ pattern: /\bTOKEN\b/i, category: "credential", message: "TOKEN reference — potential credential exposure" },
	{ pattern: /\bprivate[_-]?key\b/i, category: "credential", message: "Private key reference — credential exposure" },
	{ pattern: /\bcredentials?\b/i, category: "credential", message: "Credentials reference — potential exposure" },
	{ pattern: /\.env\b/, category: "credential", message: ".env file reference — environment variable exposure" },

	// Infinite loops
	{ pattern: /\bwhile\s*\(\s*true\s*\)/, category: "loop", message: "while(true) — potential infinite loop" },
	{ pattern: /\bfor\s*\(\s*;\s*;\s*\)/, category: "loop", message: "for(;;) — potential infinite loop" },
	{ pattern: /\bsetInterval\s*\(/, category: "loop", message: "setInterval() — potential infinite loop" },

	// Dynamic execution
	{ pattern: /\beval\s*\(/, category: "dynamic-exec", message: "eval() call — dynamic code execution" },
	{ pattern: /\bnew\s+Function\s*\(/, category: "dynamic-exec", message: "new Function() — dynamic code execution" },
	{ pattern: /\bimport\s*\(/, category: "dynamic-exec", message: "Dynamic import() — runtime module loading" },
];

// ─── FNV-1a Hex Utility ─────────────────────────────────────────────────────

/**
 * Generate a deterministic hex ID from a string via FNV-1a.
 */
export function fnv1aHex(input: string): string {
	return fnv1a(input).toString(16).padStart(8, "0");
}
