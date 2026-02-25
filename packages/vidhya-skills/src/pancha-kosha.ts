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
	AnandamayaMastery,
	EnhancedSkillManifest,
} from "./types-v2.js";
import { KOSHA_WEIGHTS } from "./types-v2.js";
import type { SurakshaScanResult } from "./suraksha.js";

// Import scoring functions from extracted module
import {
	scoreAnnamaya,
	scorePranamaya,
	scoreManomaya,
	scoreVijnanamaya,
	scoreAnandamaya,
} from "./pancha-kosha-scoring.js";

// Re-export scoring functions for backward compatibility
export {
	scoreAnnamaya,
	scorePranamaya,
	scoreManomaya,
	scoreVijnanamaya,
	scoreAnandamaya,
} from "./pancha-kosha-scoring.js";

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
 * Check runtime requirements (Pranamaya sheath)
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
