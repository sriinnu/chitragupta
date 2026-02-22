/**
 * Crystallization Pipeline Functions.
 *
 * Standalone pipeline step implementations extracted from SkillCrystallizer.
 * Contains candidate identification, structural testing, helper generators,
 * and the daemon integration function.
 *
 * @packageDocumentation
 */

import { fnv1a } from "./fingerprint.js";
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
	fnv1aHex,
} from "./crystallization-types.js";

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
export function identifyCandidates(vidhis: VidhiLike[], config: CrystallizationConfig): CrystallizationCandidate[] {
	return vidhis.map((v) => {
		const reasons: string[] = [];

		if (v.confidence < config.minVidhiConfidence) {
			reasons.push(
				`confidence ${v.confidence.toFixed(2)} < ${config.minVidhiConfidence}`,
			);
		}
		if (v.successRate < config.minSuccessRate) {
			reasons.push(
				`successRate ${v.successRate.toFixed(2)} < ${config.minSuccessRate}`,
			);
		}
		if (v.successCount < config.minExecutions) {
			reasons.push(
				`executions ${v.successCount} < ${config.minExecutions}`,
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
export function testSkill(skill: CrystallizedSkill, skills: Map<string, CrystallizedSkill>): CrystallizedSkill {
	const stored = skills.get(skill.id);
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
		skills.set(stored.id, stored);
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

	skills.set(stored.id, stored);
	return { ...stored };
}

// ─── Private: Config Clamping ─────────────────────────────────────

/**
 * Clamp configuration values to hard ceilings.
 * Two-tier system: user sets defaults, system enforces ceilings.
 */
export function clampConfig(config: CrystallizationConfig): CrystallizationConfig {
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
export function generateSkillName(vidhiName: string): string {
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
export function generateDescription(candidate: CrystallizationCandidate): string {
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
export function generateManifest(candidate: CrystallizationCandidate): Record<string, unknown> {
	return {
		name: generateSkillName(candidate.vidhiName),
		version: "1.0.0",
		description: generateDescription(candidate),
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
export function countByStatus(status: CrystallizationStatus, skills: Map<string, CrystallizedSkill>): number {
	let count = 0;
	for (const skill of skills.values()) {
		if (skill.status === status) count++;
	}
	return count;
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
		autoRegister: true,
	});

	const results = crystallizer.crystallize(vidhis);
	const approved = results.filter((s) => s.status === "registered" || s.status === "approved");

	return {
		candidates: vidhis.length,
		crystallized: results.length,
		autoApproved: approved.length,
	};
}
