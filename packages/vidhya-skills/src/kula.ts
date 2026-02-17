/**
 * Kula (कुल — Core vs Community Registry)
 *
 * Priority-based skill registry with three tiers:
 * - antara (अन्तर — inner/core): Built-in skills, highest priority
 * - bahya (बाह्य — external/community): Community skills, medium priority
 * - shiksha (शिक्षा — auto-generated): Learned skills, lowest priority
 *
 * When the same skill name exists in multiple tiers, higher priority shadows lower.
 */

import type { KulaType, EnhancedSkillManifest } from "./types-v2.js";
import { KULA_WEIGHTS } from "./types-v2.js";
import type { SkillManifest } from "./types.js";

/**
 * Result of merging multiple skill sources into the registry.
 */
export interface MergeResult {
	readonly loaded: number;
	readonly shadowed: number;
	readonly errors: ReadonlyArray<{ readonly name: string; readonly error: string }>;
}

/**
 * KulaRegistry manages skill manifests across three provenance tiers
 * with priority-based merging and shadowing.
 */
export class KulaRegistry {
	private readonly antara: Map<string, EnhancedSkillManifest> = new Map();
	private readonly bahya: Map<string, EnhancedSkillManifest> = new Map();
	private readonly shiksha: Map<string, EnhancedSkillManifest> = new Map();

	constructor() {}

	/**
	 * Register a skill manifest in the specified tier.
	 * Sets the kula field on the manifest if not already set.
	 */
	register(manifest: EnhancedSkillManifest, kula: KulaType): void {
		const tierMap = this.getTierMap(kula);

		// If manifest doesn't have kula set, create a copy with kula assigned
		const stored = manifest.kula
			? manifest
			: { ...manifest, kula } as EnhancedSkillManifest;

		tierMap.set(stored.name, stored);
	}

	/**
	 * Unregister a skill from the specified tier.
	 * Returns true if the skill was found and removed.
	 */
	unregister(name: string, kula: KulaType): boolean {
		const tierMap = this.getTierMap(kula);
		return tierMap.delete(name);
	}

	/**
	 * Remove a skill name from all tiers.
	 */
	unregisterAll(name: string): void {
		this.antara.delete(name);
		this.bahya.delete(name);
		this.shiksha.delete(name);
	}

	/**
	 * Get the highest-priority version of a skill by name.
	 * Checks tiers in priority order: antara → bahya → shiksha.
	 * Returns null if not found.
	 */
	get(name: string): { manifest: EnhancedSkillManifest; kula: KulaType } | null {
		if (this.antara.has(name)) {
			return { manifest: this.antara.get(name)!, kula: "antara" };
		}

		if (this.bahya.has(name)) {
			return { manifest: this.bahya.get(name)!, kula: "bahya" };
		}

		if (this.shiksha.has(name)) {
			return { manifest: this.shiksha.get(name)!, kula: "shiksha" };
		}

		return null;
	}

	/**
	 * Get a skill from a specific tier only (no priority resolution).
	 * Returns null if not found in that tier.
	 */
	getFromTier(name: string, kula: KulaType): EnhancedSkillManifest | null {
		const tierMap = this.getTierMap(kula);
		return tierMap.get(name) ?? null;
	}

	/**
	 * Get all skills from all tiers with shadowing applied.
	 * If a skill name exists in multiple tiers, only the highest-priority
	 * version is included.
	 */
	getAll(): Array<{ manifest: EnhancedSkillManifest; kula: KulaType }> {
		const seen = new Set<string>();
		const results: Array<{ manifest: EnhancedSkillManifest; kula: KulaType }> = [];

		for (const [name, manifest] of this.antara) {
			seen.add(name);
			results.push({ manifest, kula: "antara" });
		}

		for (const [name, manifest] of this.bahya) {
			if (!seen.has(name)) {
				seen.add(name);
				results.push({ manifest, kula: "bahya" });
			}
		}

		for (const [name, manifest] of this.shiksha) {
			if (!seen.has(name)) {
				seen.add(name);
				results.push({ manifest, kula: "shiksha" });
			}
		}

		return results;
	}

	/**
	 * Get all skills from a specific tier (no shadowing applied).
	 */
	getAllFromTier(kula: KulaType): EnhancedSkillManifest[] {
		const tierMap = this.getTierMap(kula);
		return Array.from(tierMap.values());
	}

	/**
	 * Get the weight for a skill based on its tier.
	 * Uses the highest-priority tier if skill exists in multiple tiers.
	 * Returns 0 if skill not found.
	 */
	getWeight(name: string): number {
		const tier = this.getTier(name);
		return tier ? KULA_WEIGHTS[tier] : 0;
	}

	/**
	 * Get which tier a skill resolves from (highest priority).
	 * Returns null if skill not found.
	 */
	getTier(name: string): KulaType | null {
		if (this.antara.has(name)) return "antara";
		if (this.bahya.has(name)) return "bahya";
		if (this.shiksha.has(name)) return "shiksha";
		return null;
	}

	/**
	 * Check if a skill exists in any tier.
	 */
	has(name: string): boolean {
		return this.antara.has(name) || this.bahya.has(name) || this.shiksha.has(name);
	}

	/**
	 * Get total unique skill count with shadowing applied.
	 * Skills that exist in multiple tiers count only once.
	 */
	get size(): number {
		const seen = new Set<string>();

		for (const name of this.antara.keys()) {
			seen.add(name);
		}

		for (const name of this.bahya.keys()) {
			seen.add(name);
		}

		for (const name of this.shiksha.keys()) {
			seen.add(name);
		}

		return seen.size;
	}

	/**
	 * Get count per tier (raw counts, no shadowing).
	 */
	get sizeByTier(): Record<KulaType, number> {
		return {
			antara: this.antara.size,
			bahya: this.bahya.size,
			shiksha: this.shiksha.size
		};
	}

	/**
	 * Clear all tiers.
	 */
	clear(): void {
		this.antara.clear();
		this.bahya.clear();
		this.shiksha.clear();
	}

	/**
	 * Clear a specific tier only.
	 */
	clearTier(kula: KulaType): void {
		const tierMap = this.getTierMap(kula);
		tierMap.clear();
	}

	/**
	 * Bulk load skills from multiple sources with priority-based merging.
	 * Processes sources in reverse priority order so higher priority overwrites.
	 *
	 * Returns statistics about loaded, shadowed, and error counts.
	 */
	merge(sources: Array<{ path: string; kula: KulaType; manifests: EnhancedSkillManifest[] }>): MergeResult {
		let loaded = 0;
		let shadowed = 0;
		const errors: Array<{ name: string; error: string }> = [];

		const priorityOrder: KulaType[] = ["shiksha", "bahya", "antara"];

		const sortedSources = sources.slice().sort((a, b) => {
			return priorityOrder.indexOf(a.kula) - priorityOrder.indexOf(b.kula);
		});

		const seenNames = new Set<string>();

		for (const source of sortedSources) {
			for (const manifest of source.manifests) {
				if (!manifest.name) {
					errors.push({
						name: source.path,
						error: "Manifest missing name field"
					});
					continue;
				}

				try {
					const wasSeen = seenNames.has(manifest.name);

					this.register(manifest, source.kula);
					seenNames.add(manifest.name);

					if (wasSeen) {
						shadowed++;
					}

					loaded++;
				} catch (err) {
					errors.push({
						name: manifest.name,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}
		}

		return { loaded, shadowed, errors };
	}

	/**
	 * Get skills that exist in multiple tiers (useful for auditing).
	 * Returns array of conflicts with skill name and which tiers it appears in.
	 */
	getConflicts(): Array<{ name: string; tiers: KulaType[] }> {
		const allNames = new Set<string>();

		for (const name of this.antara.keys()) {
			allNames.add(name);
		}

		for (const name of this.bahya.keys()) {
			allNames.add(name);
		}

		for (const name of this.shiksha.keys()) {
			allNames.add(name);
		}

		const conflicts: Array<{ name: string; tiers: KulaType[] }> = [];

		for (const name of allNames) {
			const tiers: KulaType[] = [];

			if (this.antara.has(name)) {
				tiers.push("antara");
			}

			if (this.bahya.has(name)) {
				tiers.push("bahya");
			}

			if (this.shiksha.has(name)) {
				tiers.push("shiksha");
			}

			if (tiers.length > 1) {
				conflicts.push({ name, tiers });
			}
		}

		return conflicts;
	}

	/**
	 * Get the internal map for a given tier.
	 */
	private getTierMap(kula: KulaType): Map<string, EnhancedSkillManifest> {
		switch (kula) {
			case "antara":
				return this.antara;
			case "bahya":
				return this.bahya;
			case "shiksha":
				return this.shiksha;
			default:
				throw new Error(`Unknown kula type: ${kula}`);
		}
	}
}

export type { KulaType, EnhancedSkillManifest };
