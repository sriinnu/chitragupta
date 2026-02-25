/**
 * Pancha Kosha scoring functions — individual sheath assessments.
 *
 * Extracted from pancha-kosha.ts for maintainability.
 * Each function scores one of the five sheaths on a [0, 1] scale.
 *
 * @module pancha-kosha-scoring
 */

import type {
	PranamayaRequirements,
	AnandamayaMastery,
	EnhancedSkillManifest,
} from "./types-v2.js";
import type { SkillManifest } from "./types.js";
import type { SurakshaScanResult } from "./suraksha.js";
import { checkPranamaya } from "./pancha-kosha.js";

/**
 * Score Annamaya (Physical) sheath [0, 1]
 *
 * Evaluates structural completeness and security:
 * - Basic metadata (name, version, description): 0.3
 * - Capabilities defined: 0.2
 * - Trait vector present: 0.1
 * - Tags present: 0.1
 * - Security scan result: 0.3 (clean), 0.15 (suspicious), 0.05 (dangerous), 0 (malicious)
 * - No scan: 0.15 (unknown)
 *
 * @param manifest - Skill manifest
 * @param scanResult - Optional security scan result
 * @returns Score [0, 1]
 */
export function scoreAnnamaya(
	manifest: SkillManifest,
	scanResult?: SurakshaScanResult
): number {
	let score = 0;

	// Basic metadata
	if (manifest.name && manifest.version && manifest.description) {
		score += 0.3;
	}

	// Capabilities
	if (manifest.capabilities && manifest.capabilities.length > 0) {
		score += 0.2;
	}

	// Trait vector
	if (manifest.traitVector && manifest.traitVector.length > 0) {
		score += 0.1;
	}

	// Tags
	if (manifest.tags && manifest.tags.length > 0) {
		score += 0.1;
	}

	// Security scan result
	if (scanResult) {
		switch (scanResult.verdict) {
			case "clean":
				score += 0.3;
				break;
			case "suspicious":
				score += 0.15;
				break;
			case "dangerous":
				score += 0.05;
				break;
			case "malicious":
				score += 0;
				break;
		}
	} else {
		// No scan result = unknown
		score += 0.15;
	}

	return Math.min(score, 1);
}

/**
 * Score Pranamaya (Vital) sheath [0, 1]
 *
 * Evaluates runtime requirements satisfaction:
 * - No requirements defined: 0.5 (unknown, partial credit)
 * - Requirements defined: fraction of requirements satisfied
 *
 * @param requirements - Runtime requirements
 * @returns Score [0, 1]
 */
export function scorePranamaya(
	requirements: PranamayaRequirements | undefined
): number {
	if (!requirements) {
		return 0.5; // Unknown, give partial credit
	}

	const check = checkPranamaya(requirements);
	if (check.satisfied) {
		return 1.0;
	}

	// Calculate fraction satisfied
	const totalChecks =
		(requirements.bins?.length || 0) +
		(requirements.env?.length || 0) +
		(requirements.os && requirements.os.length > 0 ? 1 : 0) +
		(requirements.privilege ? 1 : 0);

	if (totalChecks === 0) {
		return 1.0; // No requirements = all satisfied
	}

	const failedChecks =
		check.missing.bins.length +
		check.missing.env.length +
		(check.missing.os ? 1 : 0) +
		(check.missing.privilege ? 1 : 0);

	const satisfiedChecks = totalChecks - failedChecks;
	return Math.max(0, satisfiedChecks / totalChecks);
}

/**
 * Score Manomaya (Mental) sheath [0, 1]
 *
 * Evaluates documentation and metadata quality:
 * - Description > 50 chars: 0.2
 * - Description > 200 chars: +0.1 (extra)
 * - Has examples: 0.2
 * - Has anti-patterns: 0.1
 * - Has >= 3 tags: 0.1
 * - Has >= 2 capabilities with descriptions: 0.2
 * - Has author: 0.1
 *
 * @param manifest - Skill manifest
 * @returns Score [0, 1]
 */
export function scoreManomaya(manifest: SkillManifest): number {
	let score = 0;

	// Description quality
	const descLen = manifest.description?.length || 0;
	if (descLen > 50) {
		score += 0.2;
		if (descLen > 200) {
			score += 0.1;
		}
	}

	// Examples
	if (manifest.examples && manifest.examples.length > 0) {
		score += 0.2;
	}

	// Anti-patterns
	if (manifest.antiPatterns && manifest.antiPatterns.length > 0) {
		score += 0.1;
	}

	// Tags
	if (manifest.tags && manifest.tags.length >= 3) {
		score += 0.1;
	}

	// Capabilities with descriptions
	if (manifest.capabilities) {
		const withDesc = manifest.capabilities.filter(
			(cap) => cap.description && cap.description.length > 0
		);
		if (withDesc.length >= 2) {
			score += 0.2;
		}
	}

	// Author
	if (manifest.author) {
		score += 0.1;
	}

	return Math.min(score, 1);
}

/**
 * Score Vijnanamaya (Wisdom) sheath [0, 1]
 *
 * Evaluates strategic guidance and relationships:
 * - Has whenToUse: 0.3
 * - Has whenNotToUse: 0.2
 * - Has complements: 0.2
 * - Has supersedes (or explicitly empty): 0.1
 * - Has kula defined: 0.2
 *
 * @param manifest - Enhanced skill manifest
 * @returns Score [0, 1]
 */
export function scoreVijnanamaya(manifest: EnhancedSkillManifest): number {
	let score = 0;

	// Fields are directly on EnhancedSkillManifest, not nested under vijnanamaya
	const hasAnyWisdom = manifest.whenToUse || manifest.whenNotToUse ||
		manifest.complements || manifest.supersedes || manifest.kula;
	if (!hasAnyWisdom) {
		return 0;
	}

	// When to use
	if (manifest.whenToUse && manifest.whenToUse.length > 0) {
		score += 0.3;
	}

	// When NOT to use
	if (manifest.whenNotToUse && manifest.whenNotToUse.length > 0) {
		score += 0.2;
	}

	// Complements
	if (manifest.complements && manifest.complements.length > 0) {
		score += 0.2;
	}

	// Supersedes (explicitly declared, even if empty)
	if (manifest.supersedes !== undefined) {
		score += 0.1;
	}

	// Kula (family/category)
	if (manifest.kula) {
		score += 0.2;
	}

	return Math.min(score, 1);
}

/**
 * Score Anandamaya (Mastery/Bliss) sheath [0, 1]
 *
 * Evaluates mastery through experience:
 * - Has been invoked: 0.2
 * - Total invocations >= 10: 0.2
 * - Success rate >= 0.7: 0.3
 * - Dreyfus level "competent" or higher: 0.2
 * - Used in last 30 days: 0.1
 *
 * @param mastery - Mastery metrics
 * @returns Score [0, 1]
 */
export function scoreAnandamaya(mastery: AnandamayaMastery): number {
	let score = 0;

	// Has been invoked
	if (mastery.totalInvocations > 0) {
		score += 0.2;
	}

	// Sufficient invocations
	if (mastery.totalInvocations >= 10) {
		score += 0.2;
	}

	// Success rate
	if (mastery.successRate >= 0.7) {
		score += 0.3;
	}

	// Dreyfus level
	const highLevels = ["competent", "proficient", "expert"];
	if (highLevels.includes(mastery.dreyfusLevel)) {
		score += 0.2;
	}

	// Recent usage (last 30 days)
	if (mastery.lastInvokedAt) {
		const daysSince =
			(Date.now() - new Date(mastery.lastInvokedAt).getTime()) / (1000 * 60 * 60 * 24);
		if (daysSince <= 30) {
			score += 0.1;
		}
	}

	return Math.min(score, 1);
}
