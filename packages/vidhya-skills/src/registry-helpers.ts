/**
 * Registry helper types and candidate management.
 *
 * Extracted from registry.ts to stay within 450 LOC limit.
 * Contains candidate management logic, secondary index operations
 * for kula/ashrama, and the enhanced query method.
 *
 * @packageDocumentation
 */

import { matchSkills } from "./matcher.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "./types.js";
import type { AshramamStage, EnhancedSkillManifest, KulaType, SkillState } from "./types-v2.js";
import { ASHRAMA_MATCH_WEIGHT } from "./types-v2.js";

// ─── Candidate Entry ────────────────────────────────────────────────────────

/** A single candidate for a skill name slot in the registry. */
export interface CandidateEntry {
	manifest: SkillManifest;
	priority: number;
	sourcePath?: string;
}

// ─── Candidate Management ───────────────────────────────────────────────────

/**
 * Register a candidate into the candidate set, maintaining sort by priority descending.
 * Returns the winning manifest (highest priority).
 *
 * @param candidates - Map of skill name to candidate entries.
 * @param manifest - The skill manifest to register.
 * @param priority - Numeric priority (higher = wins).
 * @param sourcePath - Optional file path for watcher-driven removal.
 * @returns The winning manifest after insertion.
 */
export function addCandidate(
	candidates: Map<string, CandidateEntry[]>,
	manifest: SkillManifest,
	priority: number,
	sourcePath?: string,
): SkillManifest {
	const name = manifest.name;
	if (!candidates.has(name)) {
		candidates.set(name, []);
	}
	const cands = candidates.get(name)!;

	// Remove any existing candidate at this priority (or same sourcePath)
	const existingIdx = sourcePath
		? cands.findIndex(c => c.sourcePath === sourcePath)
		: cands.findIndex(c => c.priority === priority);
	if (existingIdx >= 0) cands.splice(existingIdx, 1);

	// Add new candidate, sort by priority descending
	cands.push({ manifest, priority, sourcePath });
	cands.sort((a, b) => b.priority - a.priority);

	return cands[0].manifest;
}

/**
 * Remove a candidate by priority. Returns the next-best winner, or null if none remain.
 *
 * @param candidates - Map of skill name to candidate entries.
 * @param name - The skill name.
 * @param priority - The priority tier to remove.
 * @returns The next-best manifest, or null if no candidates remain.
 */
export function removeCandidate(
	candidates: Map<string, CandidateEntry[]>,
	name: string,
	priority: number,
): { found: boolean; nextWinner: SkillManifest | null } {
	const cands = candidates.get(name);
	if (!cands) return { found: false, nextWinner: null };

	const idx = cands.findIndex(c => c.priority === priority);
	if (idx < 0) return { found: false, nextWinner: null };

	cands.splice(idx, 1);

	if (cands.length === 0) {
		candidates.delete(name);
		return { found: true, nextWinner: null };
	}

	return { found: true, nextWinner: cands[0].manifest };
}

/**
 * Remove a candidate by source file path. Scans all candidate sets.
 *
 * @param candidates - Map of skill name to candidate entries.
 * @param sourcePath - The absolute path of the removed SKILL.md file.
 * @returns The skill name and priority if found, or null.
 */
export function removeCandidateByPath(
	candidates: Map<string, CandidateEntry[]>,
	sourcePath: string,
): { name: string; priority: number } | null {
	for (const [name, cands] of candidates) {
		const idx = cands.findIndex(c => c.sourcePath === sourcePath);
		if (idx >= 0) {
			return { name, priority: cands[idx].priority };
		}
	}
	return null;
}

// ─── Enhanced Query ─────────────────────────────────────────────────────────

/**
 * Query with lifecycle and priority filtering applied.
 *
 * Extends the standard query with ashrama stage filtering, kula filtering,
 * and ashrama-based score weighting.
 *
 * @param query - The skill query with text, optional tags, and filters.
 * @param allSkills - All registered skill manifests.
 * @param states - Map of skill name to skill state.
 * @param options - Optional filters for stages, kula, and requirements.
 * @returns Ranked matches sorted by descending score (with ashrama weighting applied).
 */
export function queryEnhanced(
	query: SkillQuery,
	allSkills: SkillManifest[],
	states: Map<string, SkillState>,
	options?: {
		excludeStages?: AshramamStage[];
		kulaFilter?: KulaType[];
		requirementsMet?: boolean;
	},
): SkillMatch[] {
	let skills = allSkills;

	// Filter by ashrama stage (exclude brahmacharya and sannyasa by default)
	const excludeStages = options?.excludeStages ?? ["brahmacharya", "sannyasa"];
	if (excludeStages.length > 0) {
		skills = skills.filter((s) => {
			const state = states.get(s.name);
			if (!state) return true;
			return !excludeStages.includes(state.ashrama.stage);
		});
	}

	// Filter by kula if specified
	if (options?.kulaFilter && options.kulaFilter.length > 0) {
		skills = skills.filter((s) => {
			const enhanced = s as EnhancedSkillManifest;
			if (!enhanced.kula) return false;
			return options.kulaFilter!.includes(enhanced.kula);
		});
	}

	// Apply the existing matchSkills function
	let matches = matchSkills(query, skills);

	// Apply ASHRAMA_MATCH_WEIGHT to results
	matches = matches.map((match) => {
		const state = states.get(match.skill.name);
		if (!state) return match;

		const weight = ASHRAMA_MATCH_WEIGHT[state.ashrama.stage] ?? 1.0;
		return { ...match, score: match.score * weight };
	});

	// Re-sort after weighting
	matches.sort((a, b) => b.score - a.score);

	return matches;
}

/**
 * Get matchable skills only (grihastha + vanaprastha).
 *
 * Filters out skills in brahmacharya (learning) and sannyasa (deprecated) stages.
 * If a skill has no state, it is included by default.
 *
 * @param allSkills - All registered skill manifests.
 * @param states - Map of skill name to skill state.
 * @returns Array of skill manifests in active stages.
 */
export function getMatchableSkills(
	allSkills: SkillManifest[],
	states: Map<string, SkillState>,
): SkillManifest[] {
	return allSkills.filter((s) => {
		const state = states.get(s.name);
		if (!state) return true;
		const stage = state.ashrama.stage;
		return stage === "grihastha" || stage === "vanaprastha";
	});
}
