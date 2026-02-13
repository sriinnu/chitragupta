/**
 * @module registry
 * @description In-memory skill registry with secondary indices.
 *
 * The registry maintains seven parallel index structures for O(1) lookup
 * by different access patterns:
 *
 * - **Primary index**: `Map<name, SkillManifest>` — direct lookup by name
 * - **Tag index**: `Map<tag, Set<name>>` — find skills by tag
 * - **Verb index**: `Map<verb, Set<name>>` — find skills by capability verb
 * - **Vector index**: `Map<name, Float32Array>` — pre-computed trait vectors
 * - **Kula index**: `Map<KulaType, Set<name>>` — find skills by kula tier
 * - **Ashrama index**: `Map<AshramamStage, Set<name>>` — find skills by lifecycle stage
 * - **State index**: `Map<name, SkillState>` — full lifecycle state per skill
 *
 * All mutations (register/unregister) maintain consistency across all indices.
 *
 * @packageDocumentation
 */

import { computeTraitVector } from "./fingerprint.js";
import { matchSkills } from "./matcher.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "./types.js";
import type { AshramamStage, EnhancedSkillManifest, KulaType, SkillState } from "./types-v2.js";
import { ASHRAMA_MATCH_WEIGHT } from "./types-v2.js";

/**
 * In-memory skill registry with secondary indices for fast lookup.
 *
 * Supports registration, unregistration, querying by trait vectors,
 * and direct lookup by name, tag, or capability verb.
 *
 * @example
 * ```ts
 * const registry = new SkillRegistry();
 * registry.register(fileReaderSkill);
 * registry.register(codeAnalyzerSkill);
 *
 * const matches = registry.query({ text: "read a file" });
 * console.log(matches[0].skill.name); // "file-reader"
 * ```
 */
export class SkillRegistry {
	/** Primary index: skill name -> manifest. */
	private skills = new Map<string, SkillManifest>();

	/** Secondary index: tag -> set of skill names. */
	private byTag = new Map<string, Set<string>>();

	/** Secondary index: capability verb -> set of skill names. */
	private byVerb = new Map<string, Set<string>>();

	/** Vector index: skill name -> pre-computed trait vector. */
	private vectors = new Map<string, Float32Array>();

	/** Secondary index: kula tier -> set of skill names. */
	private byKula = new Map<KulaType, Set<string>>();

	/** Secondary index: ashrama stage -> set of skill names. */
	private byAshrama = new Map<AshramamStage, Set<string>>();

	/** Skill state index: full lifecycle state per skill. */
	private states = new Map<string, SkillState>();

	/**
	 * Candidate set: skill name -> sorted array of candidates (highest priority first).
	 * When multiple tiers provide a skill with the same name, all candidates are kept.
	 * The active winner (highest priority) is promoted to the primary index.
	 * On removal, the next-best candidate is auto-promoted.
	 */
	private candidates = new Map<string, Array<{ manifest: SkillManifest; priority: number; sourcePath?: string }>>();

	/**
	 * Register a skill with tier priority. Maintains a candidate set per skill name.
	 * The highest-priority candidate becomes the active entry in the primary index.
	 * When a higher-priority skill is removed, the next-best candidate auto-promotes.
	 *
	 * @param manifest - The skill manifest to register.
	 * @param priority - Numeric priority (higher = wins). Tier mapping: skills-core=4, ecosystem/skills=3, skill-lab=2, skill-community=1.
	 * @param sourcePath - Optional file path for watcher-driven removal.
	 */
	registerWithPriority(manifest: SkillManifest, priority: number, sourcePath?: string): void {
		const name = manifest.name;
		if (!this.candidates.has(name)) {
			this.candidates.set(name, []);
		}
		const cands = this.candidates.get(name)!;

		// Remove any existing candidate at this priority (or same sourcePath)
		const existingIdx = sourcePath
			? cands.findIndex(c => c.sourcePath === sourcePath)
			: cands.findIndex(c => c.priority === priority);
		if (existingIdx >= 0) cands.splice(existingIdx, 1);

		// Add new candidate, sort by priority descending
		cands.push({ manifest, priority, sourcePath });
		cands.sort((a, b) => b.priority - a.priority);

		// The winner is always cands[0] — register it in the primary index
		this.register(cands[0].manifest);
	}

	/**
	 * Remove a specific candidate by skill name and priority.
	 * If the removed candidate was the active winner, the next-best auto-promotes.
	 * If no candidates remain, the skill is fully unregistered.
	 *
	 * @param name - The skill name.
	 * @param priority - The priority tier to remove.
	 * @returns `true` if a candidate was found and removed.
	 */
	unregisterCandidate(name: string, priority: number): boolean {
		const cands = this.candidates.get(name);
		if (!cands) return false;

		const idx = cands.findIndex(c => c.priority === priority);
		if (idx < 0) return false;

		cands.splice(idx, 1);

		if (cands.length === 0) {
			this.candidates.delete(name);
			return this.unregister(name);
		}

		// Promote next-best — register() replaces the current entry
		this.register(cands[0].manifest);
		return true;
	}

	/**
	 * Remove a candidate by its source file path (for watcher-driven removal).
	 * Scans all candidate sets to find the matching source path.
	 *
	 * @param sourcePath - The absolute path of the removed SKILL.md file.
	 * @returns `true` if a candidate was found and removed.
	 */
	unregisterBySourcePath(sourcePath: string): boolean {
		for (const [name, cands] of this.candidates) {
			const idx = cands.findIndex(c => c.sourcePath === sourcePath);
			if (idx >= 0) {
				const priority = cands[idx].priority;
				return this.unregisterCandidate(name, priority);
			}
		}
		return false;
	}

	/**
	 * Get all candidates for a skill name (for debugging/auditing).
	 * Returns empty array if no candidates exist.
	 */
	getCandidates(name: string): ReadonlyArray<{ manifest: SkillManifest; priority: number; sourcePath?: string }> {
		return this.candidates.get(name) ?? [];
	}

	/**
	 * Register a skill manifest in the registry.
	 *
	 * If the manifest does not have a pre-computed trait vector, one will be
	 * computed and attached. All secondary indices are updated.
	 *
	 * If a skill with the same name already exists, it is replaced (updated).
	 *
	 * @param manifest - The skill manifest to register.
	 */
	register(manifest: SkillManifest): void {
		const name = manifest.name;

		// Remove old entry if re-registering (keeps indices clean)
		if (this.skills.has(name)) {
			try {
				this.unregister(name);
			} catch {
				// Force-clean the primary index on unregister failure
				this.skills.delete(name);
				this.vectors.delete(name);
			}
		}

		// Compute trait vector if not present
		const vector = manifest.traitVector
			? new Float32Array(manifest.traitVector)
			: computeTraitVector(manifest);

		// Store the vector back on the manifest as number[] for serialization
		manifest.traitVector = Array.from(vector);

		// Primary index
		this.skills.set(name, manifest);

		// Vector index
		this.vectors.set(name, vector);

		// Tag index
		for (const tag of manifest.tags) {
			const normalized = tag.toLowerCase();
			if (!this.byTag.has(normalized)) {
				this.byTag.set(normalized, new Set());
			}
			this.byTag.get(normalized)!.add(name);
		}

		// Verb index
		for (const cap of manifest.capabilities) {
			const verb = cap.verb.toLowerCase();
			if (!this.byVerb.has(verb)) {
				this.byVerb.set(verb, new Set());
			}
			this.byVerb.get(verb)!.add(name);
		}

		// Kula index (if enhanced manifest)
		const enhanced = manifest as EnhancedSkillManifest;
		if (enhanced.kula) {
			if (!this.byKula.has(enhanced.kula)) {
				this.byKula.set(enhanced.kula, new Set());
			}
			this.byKula.get(enhanced.kula)!.add(name);
		}
	}

	/**
	 * Unregister a skill by name.
	 *
	 * Removes the skill from all indices (primary, tag, verb, vector).
	 *
	 * @param name - The skill name to unregister.
	 * @returns `true` if the skill was found and removed, `false` otherwise.
	 */
	unregister(name: string): boolean {
		const manifest = this.skills.get(name);
		if (!manifest) return false;

		// Remove from primary index
		this.skills.delete(name);

		// Remove from vector index
		this.vectors.delete(name);

		// Remove from tag index
		for (const tag of manifest.tags) {
			const normalized = tag.toLowerCase();
			const set = this.byTag.get(normalized);
			if (set) {
				set.delete(name);
				if (set.size === 0) this.byTag.delete(normalized);
			}
		}

		// Remove from verb index
		for (const cap of manifest.capabilities) {
			const verb = cap.verb.toLowerCase();
			const set = this.byVerb.get(verb);
			if (set) {
				set.delete(name);
				if (set.size === 0) this.byVerb.delete(verb);
			}
		}

		// Remove from kula index
		const enhanced = manifest as EnhancedSkillManifest;
		if (enhanced.kula) {
			const set = this.byKula.get(enhanced.kula);
			if (set) {
				set.delete(name);
				if (set.size === 0) this.byKula.delete(enhanced.kula);
			}
		}

		// Remove from ashrama index (if state is set)
		const state = this.states.get(name);
		if (state) {
			const stage = state.ashrama.stage;
			const set = this.byAshrama.get(stage);
			if (set) {
				set.delete(name);
				if (set.size === 0) this.byAshrama.delete(stage);
			}
		}

		// Remove from state index
		this.states.delete(name);

		return true;
	}

	/**
	 * Get a skill manifest by name.
	 *
	 * @param name - The skill name to look up.
	 * @returns The manifest if found, `undefined` otherwise.
	 */
	get(name: string): SkillManifest | undefined {
		return this.skills.get(name);
	}

	/**
	 * Query the registry using Trait Vector Matching.
	 *
	 * Delegates to the matcher module, passing all registered skills.
	 *
	 * @param query - The skill query with text, optional tags, and filters.
	 * @returns Ranked matches sorted by descending score.
	 */
	query(query: SkillQuery): SkillMatch[] {
		return matchSkills(query, this.getAll());
	}

	/**
	 * Get all skills that have a specific tag.
	 *
	 * Uses the secondary tag index for O(1) lookup + O(k) manifest retrieval
	 * where k is the number of skills with that tag.
	 *
	 * @param tag - The tag to filter by (case-insensitive).
	 * @returns Array of matching skill manifests.
	 */
	getByTag(tag: string): SkillManifest[] {
		const normalized = tag.toLowerCase();
		const names = this.byTag.get(normalized);
		if (!names) return [];
		return [...names]
			.map((name) => this.skills.get(name))
			.filter((s): s is SkillManifest => s !== undefined);
	}

	/**
	 * Get all skills that provide a specific capability verb.
	 *
	 * Uses the secondary verb index for O(1) lookup + O(k) manifest retrieval.
	 *
	 * @param verb - The capability verb to filter by (case-insensitive).
	 * @returns Array of matching skill manifests.
	 */
	getByVerb(verb: string): SkillManifest[] {
		const normalized = verb.toLowerCase();
		const names = this.byVerb.get(normalized);
		if (!names) return [];
		return [...names]
			.map((name) => this.skills.get(name))
			.filter((s): s is SkillManifest => s !== undefined);
	}

	/**
	 * Get all registered skill manifests.
	 *
	 * @returns Array of all skill manifests in registration order.
	 */
	getAll(): SkillManifest[] {
		return [...this.skills.values()];
	}

	/**
	 * Get the number of registered skills.
	 */
	get size(): number {
		return this.skills.size;
	}

	/**
	 * Remove all skills from the registry, clearing all indices.
	 */
	clear(): void {
		this.skills.clear();
		this.byTag.clear();
		this.byVerb.clear();
		this.vectors.clear();
		this.byKula.clear();
		this.byAshrama.clear();
		this.states.clear();
		this.candidates.clear();
	}

	/**
	 * Get all skills in a specific kula tier.
	 *
	 * Uses the secondary kula index for O(1) lookup + O(k) manifest retrieval.
	 *
	 * @param kula - The kula tier to filter by.
	 * @returns Array of matching skill manifests.
	 */
	getByKula(kula: KulaType): SkillManifest[] {
		const names = this.byKula.get(kula);
		if (!names) return [];
		return [...names]
			.map((name) => this.skills.get(name))
			.filter((s): s is SkillManifest => s !== undefined);
	}

	/**
	 * Get all skills in a specific ashrama stage.
	 *
	 * Uses the secondary ashrama index for O(1) lookup + O(k) manifest retrieval.
	 *
	 * @param stage - The ashrama stage to filter by.
	 * @returns Array of matching skill manifests.
	 */
	getByAshrama(stage: AshramamStage): SkillManifest[] {
		const names = this.byAshrama.get(stage);
		if (!names) return [];
		return [...names]
			.map((name) => this.skills.get(name))
			.filter((s): s is SkillManifest => s !== undefined);
	}

	/**
	 * Set the full skill state for lifecycle management.
	 *
	 * Updates the ashrama index when state changes.
	 *
	 * @param name - The skill name.
	 * @param state - The skill state to set.
	 */
	setState(name: string, state: SkillState): void {
		// Remove from old ashrama index if state existed
		const oldState = this.states.get(name);
		if (oldState) {
			const oldStage = oldState.ashrama.stage;
			const set = this.byAshrama.get(oldStage);
			if (set) {
				set.delete(name);
				if (set.size === 0) this.byAshrama.delete(oldStage);
			}
		}

		// Set new state
		this.states.set(name, state);

		// Add to new ashrama index
		const newStage = state.ashrama.stage;
		if (!this.byAshrama.has(newStage)) {
			this.byAshrama.set(newStage, new Set());
		}
		this.byAshrama.get(newStage)!.add(name);
	}

	/**
	 * Get the full skill state.
	 *
	 * @param name - The skill name.
	 * @returns The skill state if found, `undefined` otherwise.
	 */
	getState(name: string): SkillState | undefined {
		return this.states.get(name);
	}

	/**
	 * Get matchable skills only (grihastha + vanaprastha).
	 *
	 * Filters out skills in brahmacharya (learning) and sannyasa (deprecated) stages.
	 * If a skill has no state, it is included by default.
	 *
	 * @returns Array of skill manifests in active stages.
	 */
	getMatchable(): SkillManifest[] {
		const all = this.getAll();
		return all.filter((s) => {
			const state = this.states.get(s.name);
			if (!state) return true; // Include skills without state
			const stage = state.ashrama.stage;
			return stage === "grihastha" || stage === "vanaprastha";
		});
	}

	/**
	 * Query with lifecycle and priority filtering applied.
	 *
	 * Extends the standard query with ashrama stage filtering, kula filtering,
	 * and ashrama-based score weighting.
	 *
	 * @param query - The skill query with text, optional tags, and filters.
	 * @param options - Optional filters for stages, kula, and requirements.
	 * @returns Ranked matches sorted by descending score (with ashrama weighting applied).
	 */
	queryEnhanced(
		query: SkillQuery,
		options?: {
			excludeStages?: AshramamStage[];
			kulaFilter?: KulaType[];
			requirementsMet?: boolean;
		}
	): SkillMatch[] {
		// Get all skills
		let skills = this.getAll();

		// Filter by ashrama stage (exclude brahmacharya and sannyasa by default)
		const excludeStages = options?.excludeStages ?? ["brahmacharya", "sannyasa"];
		if (excludeStages.length > 0) {
			skills = skills.filter((s) => {
				const state = this.states.get(s.name);
				if (!state) return true; // Include skills without state
				return !excludeStages.includes(state.ashrama.stage);
			});
		}

		// Filter by kula if specified
		if (options?.kulaFilter && options.kulaFilter.length > 0) {
			skills = skills.filter((s) => {
				const enhanced = s as EnhancedSkillManifest;
				if (!enhanced.kula) return false; // Exclude if no kula set
				return options.kulaFilter!.includes(enhanced.kula);
			});
		}

		// Apply the existing matchSkills function
		let matches = matchSkills(query, skills);

		// Apply ASHRAMA_MATCH_WEIGHT to results
		matches = matches.map((match) => {
			const state = this.states.get(match.skill.name);
			if (!state) return match; // No weighting for skills without state

			const weight = ASHRAMA_MATCH_WEIGHT[state.ashrama.stage] ?? 1.0;
			return {
				...match,
				score: match.score * weight,
			};
		});

		// Re-sort after weighting
		matches.sort((a, b) => b.score - a.score);

		return matches;
	}
}
