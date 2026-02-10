/**
 * Pancha Kosha (पञ्च कोश) — Five-sheath builder and runtime checker
 *
 * Implements the five-layer assessment model for skills:
 * - Annamaya (अन्नमय — Physical): Structural completeness and security
 * - Pranamaya (प्राणमय — Vital): Runtime requirements satisfaction
 * - Manomaya (मनोमय — Mental): Documentation and metadata quality
 * - Vijnanamaya (विज्ञानमय — Wisdom): Strategic guidance and relationships
 * - Anandamaya (आनन्दमय — Bliss): Mastery through experience
 *
 * @module pancha-kosha
 */

import { execFileSync } from "node:child_process";
import type {
	PanchaKoshaScores,
	PranamayaRequirements,
	VijnanamayaWisdom,
	AnandamayaMastery,
	EnhancedSkillManifest,
} from "./types-v2.js";
import { KOSHA_WEIGHTS, EMPTY_PRANAMAYA } from "./types-v2.js";
import type { SkillManifest } from "./types.js";
import type { SurakshaScanResult } from "./suraksha.js";

/**
 * Result of runtime requirements check
 */
export interface PranamayaCheckResult {
	satisfied: boolean;
	missing: {
		bins: string[];
		env: string[];
		os: boolean;
		privilege: boolean;
	};
}

/**
 * Cache for binary existence checks (process lifetime)
 */
const binaryCache = new Map<string, boolean>();

/**
 * Clears the binary existence cache
 * Useful when PATH changes during execution
 */
export function clearPranamayaCache(): void {
	binaryCache.clear();
}

/**
 * Check if a binary exists in PATH
 */
function checkBinary(bin: string): boolean {
	if (binaryCache.has(bin)) {
		return binaryCache.get(bin)!;
	}

	try {
		execFileSync("which", [bin], { encoding: "utf8", stdio: "pipe" });
		binaryCache.set(bin, true);
		return true;
	} catch {
		binaryCache.set(bin, false);
		return false;
	}
}

/**
 * Check if environment variable exists (not the value)
 */
function checkEnv(varName: string): boolean {
	return process.env[varName] !== undefined;
}

/**
 * Check if current OS is in the supported list
 */
function checkOS(osList: string[]): boolean {
	if (osList.length === 0) {
		return true; // Empty array = all OS supported
	}
	return osList.includes(process.platform);
}

/**
 * Check if running with elevated privileges
 */
function checkPrivilege(): boolean {
	if (process.platform === "win32") {
		return false; // No simple check on Windows
	}
	// Unix-like systems
	return process.getuid?.() === 0;
}

/**
 * Check runtime requirements (Pranamaya शeath)
 *
 * Validates:
 * - Binary dependencies (via which)
 * - Environment variables (existence only)
 * - OS compatibility
 * - Privilege requirements
 * - Network access (recorded but not checked)
 *
 * @param requirements - Runtime requirements to check
 * @returns Check result with satisfied flag and missing items
 */
export function checkPranamaya(
	requirements: PranamayaRequirements
): PranamayaCheckResult {
	const missing: PranamayaCheckResult["missing"] = {
		bins: [],
		env: [],
		os: false,
		privilege: false,
	};

	// Check binaries
	for (const bin of requirements.bins || []) {
		if (!checkBinary(bin)) {
			missing.bins.push(bin);
		}
	}

	// Check environment variables
	for (const varName of requirements.env || []) {
		if (!checkEnv(varName)) {
			missing.env.push(varName);
		}
	}

	// Check OS compatibility
	if (requirements.os && requirements.os.length > 0) {
		if (!checkOS(requirements.os)) {
			missing.os = true;
		}
	}

	// Check privilege requirement
	if (requirements.privilege && !checkPrivilege()) {
		missing.privilege = true;
	}

	// Network requirement is always satisfied (actual check would be slow)
	// Just recorded for informational purposes

	const satisfied =
		missing.bins.length === 0 &&
		missing.env.length === 0 &&
		!missing.os &&
		!missing.privilege;

	return { satisfied, missing };
}

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

/**
 * Build complete Pancha Kosha scores
 *
 * Assembles all five sheath scores and computes weighted overall:
 * - Annamaya (Physical): 0.25
 * - Pranamaya (Vital): 0.15
 * - Manomaya (Mental): 0.20
 * - Vijnanamaya (Wisdom): 0.20
 * - Anandamaya (Bliss): 0.20
 *
 * @param manifest - Enhanced skill manifest
 * @param mastery - Mastery metrics
 * @param scanResult - Optional security scan result
 * @returns Complete Pancha Kosha scores
 */
export function buildPanchaKosha(
	manifest: EnhancedSkillManifest,
	mastery: AnandamayaMastery,
	scanResult?: SurakshaScanResult
): PanchaKoshaScores {
	const annamaya = scoreAnnamaya(manifest, scanResult);
	const pranamaya = scorePranamaya(manifest.requirements);
	const manomaya = scoreManomaya(manifest);
	const vijnanamaya = scoreVijnanamaya(manifest);
	const anandamaya = scoreAnandamaya(mastery);

	// Weighted overall using KOSHA_WEIGHTS
	const overall =
		KOSHA_WEIGHTS.annamaya * annamaya +
		KOSHA_WEIGHTS.pranamaya * pranamaya +
		KOSHA_WEIGHTS.manomaya * manomaya +
		KOSHA_WEIGHTS.vijnanamaya * vijnanamaya +
		KOSHA_WEIGHTS.anandamaya * anandamaya;

	return {
		annamaya,
		pranamaya,
		manomaya,
		vijnanamaya,
		anandamaya,
		overall: Math.min(overall, 1),
	};
}
