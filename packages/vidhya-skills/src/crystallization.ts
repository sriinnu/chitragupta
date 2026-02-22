/**
 * Skill Crystallization (Sphateekarana)
 *
 * The bridge between Vidhi (procedural memory) and Vidhya-Skills (skill ecosystem).
 * When a Vidhi procedure reaches sufficient confidence, success rate, and
 * execution count, it is "crystallized" into a proper, self-contained
 * Vidhya skill — synthesized, scanned, tested, and registered.
 *
 * @packageDocumentation
 */

import { fnv1a } from "./fingerprint.js";

// Re-export types so consumers can import from crystallization.ts
export type {
	VidhiLike,
	CrystallizationConfig,
	CrystallizationCandidate,
	CrystallizationStatus,
	CrystallizedSkill,
} from "./crystallization-types.js";
export {
	DEFAULT_CRYSTALLIZATION_CONFIG,
	CRYSTALLIZATION_HARD_CEILINGS,
	SECURITY_PATTERNS,
	fnv1aHex,
} from "./crystallization-types.js";

import type {
	VidhiLike,
	CrystallizationConfig,
	CrystallizationCandidate,
	CrystallizationStatus,
	CrystallizedSkill,
} from "./crystallization-types.js";
import {
	DEFAULT_CRYSTALLIZATION_CONFIG,
	CRYSTALLIZATION_HARD_CEILINGS,
	SECURITY_PATTERNS,
	fnv1aHex,
} from "./crystallization-types.js";
import {
	identifyCandidates,
	testSkill,
	clampConfig,
	generateSkillName,
	generateDescription,
	generateManifest,
	countByStatus,
} from "./crystallization-pipeline.js";


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
		this.config = clampConfig({
			...DEFAULT_CRYSTALLIZATION_CONFIG,
			...config,
		});
	}

	// ─── Public API ───────────────────────────────────────────────────

	/**
	 * Identify vidhis that are ready for crystallization.
	 * Delegates to standalone identifyCandidates function.
	 */
	identifyCandidates(vidhis: VidhiLike[]): CrystallizationCandidate[] {
		return identifyCandidates(vidhis, this.config);
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
		const registeredCount = countByStatus("registered", this.skills);
		if (registeredCount >= this.config.maxSkillsPerProject) {
			const skill: CrystallizedSkill = {
				id,
				vidhiId: candidate.vidhiId,
				skillName: generateSkillName(candidate.vidhiName),
				description: generateDescription(candidate),
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
		const manifest = generateManifest(candidate);
		const implementation = JSON.stringify(manifest, null, "\t");

		const skill: CrystallizedSkill = {
			id,
			vidhiId: candidate.vidhiId,
			skillName: generateSkillName(candidate.vidhiName),
			description: generateDescription(candidate),
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
	 * Structural validation of a crystallized skill.
	 * Delegates to standalone testSkill function.
	 */
	test(skill: CrystallizedSkill): CrystallizedSkill {
		return testSkill(skill, this.skills);
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
			const registeredCount = countByStatus("registered", this.skills);
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
}

/** Re-export promoteMatureVidhis from pipeline. */
export { promoteMatureVidhis } from "./crystallization-pipeline.js";
