/**
 * @module registry
 * @description In-memory skill registry with secondary indices.
 *
 * The registry maintains seven parallel index structures for O(1) lookup
 * by different access patterns. Candidate management and enhanced query
 * logic are in `registry-helpers.ts`.
 *
 * @packageDocumentation
 */

import { computeTraitVector } from "./fingerprint.js";
import { matchSkills } from "./matcher.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "./types.js";
import type { AshramamStage, EnhancedSkillManifest, KulaType, SkillState } from "./types-v2.js";
import {
	addCandidate,
	getMatchableSkills,
	queryEnhanced,
	removeCandidate,
	removeCandidateByPath,
} from "./registry-helpers.js";
import type { CandidateEntry } from "./registry-helpers.js";

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
	/** Candidate set: name -> sorted candidates (highest priority first). */
	private candidates = new Map<string, CandidateEntry[]>();

	/**
	 * Register a skill with tier priority. The highest-priority candidate
	 * becomes the active entry in the primary index.
	 *
	 * @param manifest - The skill manifest to register.
	 * @param priority - Numeric priority (higher = wins).
	 * @param sourcePath - Optional file path for watcher-driven removal.
	 */
	registerWithPriority(manifest: SkillManifest, priority: number, sourcePath?: string): void {
		const winner = addCandidate(this.candidates, manifest, priority, sourcePath);
		this.register(winner);
	}

	/**
	 * Remove a specific candidate by skill name and priority.
	 * If the removed candidate was the active winner, the next-best auto-promotes.
	 *
	 * @param name - The skill name.
	 * @param priority - The priority tier to remove.
	 * @returns `true` if a candidate was found and removed.
	 */
	unregisterCandidate(name: string, priority: number): boolean {
		const { found, nextWinner } = removeCandidate(this.candidates, name, priority);
		if (!found) return false;
		if (!nextWinner) return this.unregister(name);
		this.register(nextWinner);
		return true;
	}

	/**
	 * Remove a candidate by its source file path (for watcher-driven removal).
	 *
	 * @param sourcePath - The absolute path of the removed SKILL.md file.
	 * @returns `true` if a candidate was found and removed.
	 */
	unregisterBySourcePath(sourcePath: string): boolean {
		const result = removeCandidateByPath(this.candidates, sourcePath);
		if (!result) return false;
		return this.unregisterCandidate(result.name, result.priority);
	}

	/** Get all candidates for a skill name (for debugging/auditing). */
	getCandidates(name: string): ReadonlyArray<CandidateEntry> {
		return this.candidates.get(name) ?? [];
	}

	/**
	 * Register a skill manifest in the registry.
	 * Computes trait vector if needed, updates all secondary indices.
	 *
	 * @param manifest - The skill manifest to register.
	 */
	register(manifest: SkillManifest): void {
		const name = manifest.name;

		if (this.skills.has(name)) {
			try { this.unregister(name); } catch {
				this.skills.delete(name);
				this.vectors.delete(name);
			}
		}

		const vector = manifest.traitVector
			? new Float32Array(manifest.traitVector)
			: computeTraitVector(manifest);
		manifest.traitVector = Array.from(vector);

		this.skills.set(name, manifest);
		this.vectors.set(name, vector);

		for (const tag of manifest.tags) {
			const normalized = tag.toLowerCase();
			if (!this.byTag.has(normalized)) this.byTag.set(normalized, new Set());
			this.byTag.get(normalized)!.add(name);
		}

		for (const cap of manifest.capabilities) {
			const verb = cap.verb.toLowerCase();
			if (!this.byVerb.has(verb)) this.byVerb.set(verb, new Set());
			this.byVerb.get(verb)!.add(name);
		}

		const enhanced = manifest as EnhancedSkillManifest;
		if (enhanced.kula) {
			if (!this.byKula.has(enhanced.kula)) this.byKula.set(enhanced.kula, new Set());
			this.byKula.get(enhanced.kula)!.add(name);
		}
	}

	/**
	 * Unregister a skill by name. Removes from all indices.
	 *
	 * @param name - The skill name to unregister.
	 * @returns `true` if found and removed, `false` otherwise.
	 */
	unregister(name: string): boolean {
		const manifest = this.skills.get(name);
		if (!manifest) return false;

		this.skills.delete(name);
		this.vectors.delete(name);

		for (const tag of manifest.tags) {
			const normalized = tag.toLowerCase();
			const set = this.byTag.get(normalized);
			if (set) { set.delete(name); if (set.size === 0) this.byTag.delete(normalized); }
		}

		for (const cap of manifest.capabilities) {
			const verb = cap.verb.toLowerCase();
			const set = this.byVerb.get(verb);
			if (set) { set.delete(name); if (set.size === 0) this.byVerb.delete(verb); }
		}

		const enhanced = manifest as EnhancedSkillManifest;
		if (enhanced.kula) {
			const set = this.byKula.get(enhanced.kula);
			if (set) { set.delete(name); if (set.size === 0) this.byKula.delete(enhanced.kula); }
		}

		const state = this.states.get(name);
		if (state) {
			const stage = state.ashrama.stage;
			const set = this.byAshrama.get(stage);
			if (set) { set.delete(name); if (set.size === 0) this.byAshrama.delete(stage); }
		}

		this.states.delete(name);
		return true;
	}

	/** Get a skill manifest by name. */
	get(name: string): SkillManifest | undefined { return this.skills.get(name); }

	/** Query using Trait Vector Matching. */
	query(query: SkillQuery): SkillMatch[] { return matchSkills(query, this.getAll()); }

	/** Get all skills that have a specific tag. */
	getByTag(tag: string): SkillManifest[] {
		const names = this.byTag.get(tag.toLowerCase());
		if (!names) return [];
		return [...names].map((n) => this.skills.get(n)).filter((s): s is SkillManifest => s !== undefined);
	}

	/** Get all skills that provide a specific capability verb. */
	getByVerb(verb: string): SkillManifest[] {
		const names = this.byVerb.get(verb.toLowerCase());
		if (!names) return [];
		return [...names].map((n) => this.skills.get(n)).filter((s): s is SkillManifest => s !== undefined);
	}

	/** Get all registered skill manifests. */
	getAll(): SkillManifest[] { return [...this.skills.values()]; }

	/** Get the number of registered skills. */
	get size(): number { return this.skills.size; }

	/** Remove all skills from the registry, clearing all indices. */
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

	/** Get all skills in a specific kula tier. */
	getByKula(kula: KulaType): SkillManifest[] {
		const names = this.byKula.get(kula);
		if (!names) return [];
		return [...names].map((n) => this.skills.get(n)).filter((s): s is SkillManifest => s !== undefined);
	}

	/** Get all skills in a specific ashrama stage. */
	getByAshrama(stage: AshramamStage): SkillManifest[] {
		const names = this.byAshrama.get(stage);
		if (!names) return [];
		return [...names].map((n) => this.skills.get(n)).filter((s): s is SkillManifest => s !== undefined);
	}

	/** Set the full skill state for lifecycle management. Updates ashrama index. */
	setState(name: string, state: SkillState): void {
		const oldState = this.states.get(name);
		if (oldState) {
			const set = this.byAshrama.get(oldState.ashrama.stage);
			if (set) { set.delete(name); if (set.size === 0) this.byAshrama.delete(oldState.ashrama.stage); }
		}
		this.states.set(name, state);
		const newStage = state.ashrama.stage;
		if (!this.byAshrama.has(newStage)) this.byAshrama.set(newStage, new Set());
		this.byAshrama.get(newStage)!.add(name);
	}

	/** Get the full skill state. */
	getState(name: string): SkillState | undefined { return this.states.get(name); }

	/** Get matchable skills only (grihastha + vanaprastha). */
	getMatchable(): SkillManifest[] {
		return getMatchableSkills(this.getAll(), this.states);
	}

	/**
	 * Query with lifecycle and priority filtering applied.
	 *
	 * @param query - The skill query.
	 * @param options - Optional filters for stages, kula, and requirements.
	 * @returns Ranked matches with ashrama weighting applied.
	 */
	queryEnhanced(
		query: SkillQuery,
		options?: {
			excludeStages?: AshramamStage[];
			kulaFilter?: KulaType[];
			requirementsMet?: boolean;
		},
	): SkillMatch[] {
		return queryEnhanced(query, this.getAll(), this.states, options);
	}
}
