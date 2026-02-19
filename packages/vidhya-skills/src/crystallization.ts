/**
 * Skill Crystallization (स्फटीकरण — Sphateekarana)
 *
 * The bridge between Vidhi (procedural memory) and Vidhya-Skills (skill ecosystem).
 * When a Vidhi procedure reaches sufficient confidence, success rate, and
 * execution count, it is "crystallized" into a proper, self-contained
 * Vidhya skill — synthesized, scanned, tested, and registered.
 *
 * The name Sphateekarana comes from "sphatika" (स्फटिक — crystal), the Sanskrit
 * word for quartz: just as raw experience becomes crystalline knowledge through
 * repeated refinement, raw procedures become polished skills through this pipeline.
 *
 * ## Pipeline
 *
 *   1. **Identify** — Scan Vidhis for crystallization candidates (threshold gating)
 *   2. **Synthesize** — Generate a tool-chain implementation from Vidhi steps
 *   3. **Scan** — Security analysis (Suraksha-lite: network, FS, creds, exec, loops)
 *   4. **Test** — Structural validation (parse, tool existence, param types)
 *   5. **Approve / Reject** — Manual or auto-approval gating
 *   6. **Register** — Insert into the skill registry
 *
 * ## Thompson Sampling
 *
 * Each registered crystallized skill carries a Beta(alpha, beta) distribution
 * for exploration-exploitation tracking. Successes increment alpha, failures
 * increment beta. Skills whose posterior mean drops below 0.3 are
 * auto-deprecated.
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
interface SecurityPattern {
	pattern: RegExp;
	category: string;
	message: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
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
function fnv1aHex(input: string): string {
	return fnv1a(input).toString(16).padStart(8, "0");
}

// ─── Skill Crystallizer ─────────────────────────────────────────────────────

/**
 * SkillCrystallizer — transforms mature Vidhi procedures into Vidhya skills.
 *
 * The crystallization pipeline:
 *   identify candidates -> synthesize -> scan -> test -> approve/reject -> register
 *
 * @example
 * ```ts
 * const crystallizer = new SkillCrystallizer({ minVidhiConfidence: 0.85 });
 * const results = crystallizer.crystallize(vidhis);
 * for (const skill of results) {
 *   if (skill.status === "approved") {
 *     crystallizer.approve(skill.id);
 *   }
 * }
 * ```
 */
export class SkillCrystallizer {
	private readonly config: CrystallizationConfig;
	private readonly skills: Map<string, CrystallizedSkill> = new Map();

	constructor(config?: Partial<CrystallizationConfig>) {
		this.config = this.clampConfig({
			...DEFAULT_CRYSTALLIZATION_CONFIG,
			...config,
		});
	}

	// ─── Public API ───────────────────────────────────────────────────

	/**
	 * Scan all Vidhis and identify crystallization candidates.
	 *
	 * Each Vidhi is evaluated against the configured thresholds:
	 * - confidence >= minVidhiConfidence
	 * - successRate >= minSuccessRate
	 * - successCount >= minExecutions
	 *
	 * @param vidhis - Array of VidhiLike objects to evaluate.
	 * @returns Array of candidates, each annotated with readyToCrystallize.
	 */
	identifyCandidates(vidhis: VidhiLike[]): CrystallizationCandidate[] {
		return vidhis.map((v) => {
			const reasons: string[] = [];

			if (v.confidence < this.config.minVidhiConfidence) {
				reasons.push(
					`confidence ${v.confidence.toFixed(2)} < ${this.config.minVidhiConfidence}`,
				);
			}
			if (v.successRate < this.config.minSuccessRate) {
				reasons.push(
					`successRate ${v.successRate.toFixed(2)} < ${this.config.minSuccessRate}`,
				);
			}
			if (v.successCount < this.config.minExecutions) {
				reasons.push(
					`executions ${v.successCount} < ${this.config.minExecutions}`,
				);
			}

			const readyToCrystallize = reasons.length === 0;

			return {
				vidhiId: v.id,
				vidhiName: v.name,
				confidence: v.confidence,
				successRate: v.successRate,
				executionCount: v.successCount,
				steps: v.steps.map((s) => ({
					toolName: s.toolName,
					description: s.description,
				})),
				triggers: [...v.triggers],
				readyToCrystallize,
				reason: readyToCrystallize ? undefined : reasons.join("; "),
			};
		});
	}

	/**
	 * Synthesize a skill from a crystallization candidate.
	 *
	 * Generates a tool-chain implementation as a JSON manifest containing:
	 * - Ordered steps mapping to Yantra tool references
	 * - Parameter schemas from the Vidhi's anti-unified params
	 * - Trigger phrases for matching
	 *
	 * @param candidate - A candidate that is ready to crystallize.
	 * @returns A CrystallizedSkill in "synthesizing" -> "scanning" status.
	 */
	synthesize(candidate: CrystallizationCandidate): CrystallizedSkill {
		const id = fnv1aHex(candidate.vidhiId + ":crystal");
		const now = Date.now();

		// Check if we've hit the project limit
		const registeredCount = this.countByStatus("registered");
		if (registeredCount >= this.config.maxSkillsPerProject) {
			const skill: CrystallizedSkill = {
				id,
				vidhiId: candidate.vidhiId,
				skillName: this.generateSkillName(candidate.vidhiName),
				description: this.generateDescription(candidate),
				status: "failed",
				implementation: "",
				thompsonAlpha: 1,
				thompsonBeta: 1,
				rejectionReason: `Max skills per project (${this.config.maxSkillsPerProject}) reached`,
				createdAt: now,
			};
			this.skills.set(id, skill);
			return { ...skill };
		}

		// Generate the tool-chain implementation manifest
		const manifest = this.generateManifest(candidate);
		const implementation = JSON.stringify(manifest, null, "\t");

		const skill: CrystallizedSkill = {
			id,
			vidhiId: candidate.vidhiId,
			skillName: this.generateSkillName(candidate.vidhiName),
			description: this.generateDescription(candidate),
			status: "synthesizing",
			implementation,
			thompsonAlpha: 1,
			thompsonBeta: 1,
			createdAt: now,
		};

		this.skills.set(id, skill);
		return { ...skill };
	}

	/**
	 * Run security scan on a crystallized skill.
	 *
	 * Checks the implementation for:
	 * - Network access patterns (fetch, http, curl, wget)
	 * - File system writes outside project (path traversal, system dirs)
	 * - Process spawning (exec, spawn, fork, child_process)
	 * - Credential patterns (API_KEY, SECRET, PASSWORD, TOKEN)
	 * - Infinite loop patterns (while(true), for(;;))
	 * - Dynamic execution (eval, new Function, dynamic import)
	 *
	 * @param skill - A synthesized crystallized skill.
	 * @returns The skill with scanResult populated and status updated.
	 */
	scan(skill: CrystallizedSkill): CrystallizedSkill {
		const stored = this.skills.get(skill.id);
		if (!stored) {
			return { ...skill, status: "failed", scanResult: { clean: false, issues: ["Skill not found"] } };
		}

		stored.status = "scanning";
		const issues: string[] = [];

		for (const { pattern, message } of SECURITY_PATTERNS) {
			if (pattern.test(stored.implementation)) {
				issues.push(message);
			}
		}

		stored.scanResult = {
			clean: issues.length === 0,
			issues,
		};

		if (issues.length > 0) {
			stored.status = "failed";
			stored.rejectionReason = `Security scan failed: ${issues.length} issue(s) found`;
		} else {
			stored.status = "testing";
		}

		this.skills.set(stored.id, stored);
		return { ...stored };
	}

	/**
	 * Run structural validation (test) on a crystallized skill.
	 *
	 * Validates:
	 * - Implementation is valid JSON
	 * - Has required manifest fields (name, version, steps)
	 * - All steps have toolName and description
	 * - Parameter types are valid JSON Schema types
	 *
	 * @param skill - A scanned crystallized skill (must have passed scan).
	 * @returns The skill with testResult populated and status updated.
	 */
	test(skill: CrystallizedSkill): CrystallizedSkill {
		const stored = this.skills.get(skill.id);
		if (!stored) {
			return { ...skill, status: "failed", testResult: { passed: false, errors: ["Skill not found"] } };
		}

		// Don't test skills that failed scanning
		if (stored.status === "failed") {
			stored.testResult = { passed: false, errors: ["Cannot test a skill that failed scanning"] };
			return { ...stored };
		}

		stored.status = "testing";
		const errors: string[] = [];

		// 1. Parse the implementation as JSON
		let manifest: Record<string, unknown>;
		try {
			manifest = JSON.parse(stored.implementation) as Record<string, unknown>;
		} catch (e) {
			errors.push(`Invalid JSON: ${(e as Error).message}`);
			stored.testResult = { passed: false, errors };
			stored.status = "failed";
			stored.rejectionReason = "Test failed: invalid implementation JSON";
			this.skills.set(stored.id, stored);
			return { ...stored };
		}

		// 2. Check required manifest fields
		if (typeof manifest.name !== "string" || manifest.name.length === 0) {
			errors.push("Missing or empty 'name' field");
		}
		if (typeof manifest.version !== "string") {
			errors.push("Missing 'version' field");
		}
		if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
			errors.push("Missing or empty 'steps' array");
		}

		// 3. Validate each step
		if (Array.isArray(manifest.steps)) {
			for (let i = 0; i < manifest.steps.length; i++) {
				const step = manifest.steps[i] as Record<string, unknown>;
				if (typeof step.toolName !== "string" || step.toolName.length === 0) {
					errors.push(`Step ${i}: missing or empty 'toolName'`);
				}
				if (typeof step.description !== "string" || step.description.length === 0) {
					errors.push(`Step ${i}: missing or empty 'description'`);
				}
			}
		}

		// 4. Validate parameter types if present
		if (manifest.parameters && typeof manifest.parameters === "object") {
			const validTypes = new Set(["string", "number", "boolean", "object", "array"]);
			const params = manifest.parameters as Record<string, Record<string, unknown>>;
			for (const [name, param] of Object.entries(params)) {
				if (typeof param.type === "string" && !validTypes.has(param.type)) {
					errors.push(`Parameter '${name}': invalid type '${param.type}'`);
				}
			}
		}

		stored.testResult = {
			passed: errors.length === 0,
			errors,
		};

		if (errors.length > 0) {
			stored.status = "failed";
			stored.rejectionReason = `Test failed: ${errors.length} error(s)`;
		} else {
			stored.status = "approved";
		}

		this.skills.set(stored.id, stored);
		return { ...stored };
	}

	/**
	 * Full crystallization pipeline: identify -> synthesize -> scan -> test.
	 *
	 * For each Vidhi that meets the threshold criteria:
	 *   1. Identify as a candidate
	 *   2. Synthesize the implementation
	 *   3. Run security scan
	 *   4. Run structural test
	 *   5. If autoRegister is enabled and all checks pass, auto-register
	 *
	 * @param vidhis - Array of VidhiLike objects.
	 * @returns Array of CrystallizedSkill results (one per eligible Vidhi).
	 */
	crystallize(vidhis: VidhiLike[]): CrystallizedSkill[] {
		const candidates = this.identifyCandidates(vidhis);
		const results: CrystallizedSkill[] = [];

		for (const candidate of candidates) {
			if (!candidate.readyToCrystallize) continue;

			// Check project limit
			const registeredCount = this.countByStatus("registered");
			if (registeredCount >= this.config.maxSkillsPerProject) break;

			let skill = this.synthesize(candidate);
			skill = this.scan(skill);

			if (skill.status !== "failed") {
				skill = this.test(skill);
			}

			// Auto-register if configured and all checks passed
			if (this.config.autoRegister && skill.status === "approved") {
				const registered = this.approve(skill.id);
				if (registered) {
					skill = registered;
				}
			}

			results.push(skill);
		}

		return results;
	}

	/**
	 * Approve a crystallized skill for registration.
	 *
	 * The skill must be in "approved" status (passed scan + test).
	 * Moves it to "registered" status with a registration timestamp.
	 *
	 * @param skillId - The ID of the skill to approve.
	 * @returns The registered skill, or null if not found / not approvable.
	 */
	approve(skillId: string): CrystallizedSkill | null {
		const skill = this.skills.get(skillId);
		if (!skill || skill.status !== "approved") return null;

		skill.status = "registered";
		skill.registeredAt = Date.now();
		this.skills.set(skillId, skill);

		return { ...skill };
	}

	/**
	 * Reject a crystallized skill with a reason.
	 *
	 * @param skillId - The ID of the skill to reject.
	 * @param reason - Human-readable rejection reason.
	 */
	reject(skillId: string, reason: string): void {
		const skill = this.skills.get(skillId);
		if (!skill) return;

		skill.status = "rejected";
		skill.rejectionReason = reason;
		this.skills.set(skillId, skill);
	}

	/**
	 * Record the outcome of executing a registered crystallized skill.
	 *
	 * Updates Thompson Sampling parameters:
	 * - success: alpha += 1
	 * - failure: beta += 1
	 *
	 * @param skillId - The registered skill's ID.
	 * @param success - Whether the execution succeeded.
	 */
	recordOutcome(skillId: string, success: boolean): void {
		const skill = this.skills.get(skillId);
		if (!skill || skill.status !== "registered") return;

		if (success) {
			skill.thompsonAlpha += 1;
		} else {
			skill.thompsonBeta += 1;
		}

		this.skills.set(skillId, skill);
	}

	/**
	 * Auto-deprecate registered skills whose Thompson Sampling posterior mean
	 * has fallen below the threshold.
	 *
	 * Posterior mean = alpha / (alpha + beta).
	 *
	 * @param threshold - Override the configured deprecation threshold.
	 * @returns Array of deprecated skill IDs.
	 */
	deprecateUnderperformers(threshold?: number): string[] {
		const t = threshold ?? this.config.deprecationThreshold;
		const deprecated: string[] = [];

		for (const [id, skill] of this.skills) {
			if (skill.status !== "registered") continue;

			const mean = skill.thompsonAlpha / (skill.thompsonAlpha + skill.thompsonBeta);
			if (mean < t) {
				skill.status = "deprecated";
				skill.rejectionReason = `Auto-deprecated: posterior mean ${mean.toFixed(3)} < ${t}`;
				deprecated.push(id);
			}
		}

		return deprecated;
	}

	/**
	 * Get a crystallized skill by ID.
	 *
	 * @param skillId - The skill ID.
	 * @returns The skill, or null if not found.
	 */
	getSkill(skillId: string): CrystallizedSkill | null {
		const skill = this.skills.get(skillId);
		return skill ? { ...skill } : null;
	}

	/**
	 * List all crystallized skills, optionally filtered by status.
	 *
	 * @param status - Optional status filter.
	 * @returns Array of matching crystallized skills.
	 */
	listSkills(status?: CrystallizationStatus): CrystallizedSkill[] {
		const all = [...this.skills.values()];
		const filtered = status ? all.filter((s) => s.status === status) : all;
		return filtered.map((s) => ({ ...s }));
	}

	/**
	 * Get crystallization pipeline statistics.
	 *
	 * @returns Object with counts by status and average success rate.
	 */
	stats(): {
		candidates: number;
		registered: number;
		failed: number;
		rejected: number;
		deprecated: number;
		approved: number;
		avgSuccessRate: number;
	} {
		let candidates = 0;
		let registered = 0;
		let failed = 0;
		let rejected = 0;
		let deprecated = 0;
		let approved = 0;
		let totalMean = 0;
		let registeredCount = 0;

		for (const skill of this.skills.values()) {
			switch (skill.status) {
				case "candidate":
				case "synthesizing":
				case "scanning":
				case "testing":
					candidates++;
					break;
				case "registered":
					registered++;
					totalMean += skill.thompsonAlpha / (skill.thompsonAlpha + skill.thompsonBeta);
					registeredCount++;
					break;
				case "failed":
					failed++;
					break;
				case "rejected":
					rejected++;
					break;
				case "deprecated":
					deprecated++;
					break;
				case "approved":
					approved++;
					break;
			}
		}

		return {
			candidates,
			registered,
			failed,
			rejected,
			deprecated,
			approved,
			avgSuccessRate: registeredCount > 0 ? totalMean / registeredCount : 0,
		};
	}

	/**
	 * Serialize the crystallizer state for persistence.
	 *
	 * @returns JSON-serializable state object.
	 */
	serialize(): { skills: Array<[string, CrystallizedSkill]> } {
		return {
			skills: [...this.skills.entries()],
		};
	}

	/**
	 * Restore crystallizer state from serialized data.
	 *
	 * @param state - Previously serialized state.
	 */
	restore(state: { skills: Array<[string, CrystallizedSkill]> }): void {
		this.skills.clear();
		for (const [id, skill] of state.skills) {
			this.skills.set(id, skill);
		}
	}

	// ─── Private: Config Clamping ─────────────────────────────────────

	/**
	 * Clamp configuration values to hard ceilings.
	 * Two-tier system: user sets defaults, system enforces ceilings.
	 */
	private clampConfig(config: CrystallizationConfig): CrystallizationConfig {
		return {
			minVidhiConfidence: Math.max(
				config.minVidhiConfidence,
				CRYSTALLIZATION_HARD_CEILINGS.minVidhiConfidence,
			),
			minSuccessRate: Math.max(
				config.minSuccessRate,
				CRYSTALLIZATION_HARD_CEILINGS.minSuccessRate,
			),
			minExecutions: Math.max(
				config.minExecutions,
				CRYSTALLIZATION_HARD_CEILINGS.minExecutions,
			),
			autoRegister: config.autoRegister,
			sandboxTimeout: Math.min(
				config.sandboxTimeout,
				CRYSTALLIZATION_HARD_CEILINGS.sandboxTimeout,
			),
			maxSkillsPerProject: Math.min(
				config.maxSkillsPerProject,
				CRYSTALLIZATION_HARD_CEILINGS.maxSkillsPerProject,
			),
			deprecationThreshold: Math.max(
				config.deprecationThreshold,
				CRYSTALLIZATION_HARD_CEILINGS.deprecationThreshold,
			),
		};
	}

	// ─── Private: Synthesis Helpers ───────────────────────────────────

	/**
	 * Generate a kebab-case skill name from a Vidhi name.
	 * Prefixes with "crystal-" to distinguish from manually authored skills.
	 */
	private generateSkillName(vidhiName: string): string {
		const clean = vidhiName
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		return `crystal-${clean}`;
	}

	/**
	 * Generate a human-readable description from candidate metadata.
	 */
	private generateDescription(candidate: CrystallizationCandidate): string {
		const stepNames = candidate.steps.map((s) => s.toolName).join(" -> ");
		return `Auto-crystallized procedure: ${stepNames}. ` +
			`Learned from ${candidate.executionCount} successful executions ` +
			`with ${(candidate.successRate * 100).toFixed(0)}% success rate.`;
	}

	/**
	 * Generate the tool-chain manifest from candidate steps.
	 *
	 * The manifest is a self-contained JSON document describing:
	 * - name, version, description
	 * - ordered steps with tool references
	 * - parameters (from Vidhi anti-unification)
	 * - triggers for NLU matching
	 */
	private generateManifest(candidate: CrystallizationCandidate): Record<string, unknown> {
		return {
			name: this.generateSkillName(candidate.vidhiName),
			version: "1.0.0",
			description: this.generateDescription(candidate),
			source: "vidhi-crystallization",
			vidhiId: candidate.vidhiId,
			steps: candidate.steps.map((step, i) => ({
				index: i,
				toolName: step.toolName,
				description: step.description,
			})),
			triggers: candidate.triggers,
			parameters: {},
			createdAt: Date.now(),
		};
	}

	/**
	 * Count skills by status.
	 */
	private countByStatus(status: CrystallizationStatus): number {
		let count = 0;
		for (const skill of this.skills.values()) {
			if (skill.status === status) count++;
		}
		return count;
	}
}

// ─── Daemon Integration Helper ──────────────────────────────────────────────

/**
 * Promote mature Vidhis to skills via the crystallization pipeline.
 *
 * Designed to be called from the daemon's consolidation cycle:
 *   1. Load mature Vidhis (confidence >= 0.8, successRate >= 0.7, successCount >= 5)
 *   2. Call SkillCrystallizer.crystallize(vidhis)
 *   3. Auto-approve low-risk skills
 *   4. Register approved skills
 *
 * @param vidhis - Mature Vidhi procedures to promote.
 * @returns Summary of the promotion run.
 */
export function promoteMatureVidhis(vidhis: VidhiLike[]): {
	candidates: number;
	crystallized: number;
	autoApproved: number;
} {
	const crystallizer = new SkillCrystallizer({
		minVidhiConfidence: 0.8,
		minSuccessRate: 0.7,
		minExecutions: 5,
		autoApproveClean: true,
	});

	const results = crystallizer.crystallize(vidhis);
	const approved = results.filter((s) => s.status === "registered" || s.status === "approved");

	return {
		candidates: vidhis.length,
		crystallized: results.length,
		autoApproved: approved.length,
	};
}
