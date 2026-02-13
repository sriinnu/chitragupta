/**
 * @module prompt-xml
 * @description Generate `<available_skills>` XML blocks for system prompt injection.
 *
 * Follows the Agent Skills integration pattern: skills are injected into the agent's
 * system prompt as structured XML so the agent knows what's available without code changes.
 *
 * Supports three disclosure tiers:
 * - **metadata** (~100 tokens): name + description only — for context-limited scenarios
 * - **instructions** (<5k tokens): full SKILL.md body — standard activation
 * - **full** (unlimited): body + script/reference listings — maximum context
 *
 * @packageDocumentation
 */

import type { SkillManifest } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Disclosure tier for progressive skill loading. */
export type DisclosureTier = "metadata" | "instructions" | "full";

/** Options for XML generation. */
export interface SkillXmlOptions {
	/** How much detail to include. Default: "instructions". */
	tier?: DisclosureTier;
	/** Include tags in output. Default: true. */
	includeTags?: boolean;
	/** Include capabilities breakdown. Default: false (only for "full" tier). */
	includeCapabilities?: boolean;
	/** Additional resources to list (script paths, reference paths). */
	resources?: string[];
}

// ─── Escaping ───────────────────────────────────────────────────────────────

/** Escape special XML characters. */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// ─── Single Skill ───────────────────────────────────────────────────────────

/**
 * Generate XML for a single skill.
 *
 * @param manifest - The skill manifest.
 * @param options - Disclosure tier and formatting options.
 * @returns XML string for this skill.
 */
export function skillToXml(
	manifest: SkillManifest,
	options: SkillXmlOptions = {},
): string {
	const tier = options.tier ?? "instructions";
	const includeTags = options.includeTags ?? true;
	const includeCapabilities = options.includeCapabilities ?? (tier === "full");
	const resources = options.resources ?? [];

	const lines: string[] = [];
	lines.push(`  <skill name="${escapeXml(manifest.name)}">`);
	lines.push(`    <description>${escapeXml(manifest.description)}</description>`);

	if (includeTags && manifest.tags.length > 0) {
		lines.push(`    <tags>${manifest.tags.map(escapeXml).join(", ")}</tags>`);
	}

	if (manifest.author) {
		lines.push(`    <author>${escapeXml(manifest.author)}</author>`);
	}

	// Metadata tier stops here
	if (tier === "metadata") {
		lines.push("  </skill>");
		return lines.join("\n");
	}

	// Instructions tier: include body
	if (manifest.body) {
		lines.push("    <instructions>");
		lines.push(escapeXml(manifest.body));
		lines.push("    </instructions>");
	}

	// Include capabilities breakdown
	if (includeCapabilities && manifest.capabilities.length > 0) {
		lines.push("    <capabilities>");
		for (const cap of manifest.capabilities) {
			const params = cap.parameters
				? ` params="${Object.keys(cap.parameters).join(", ")}"`
				: "";
			lines.push(`      <capability verb="${escapeXml(cap.verb)}" object="${escapeXml(cap.object)}"${params}>${escapeXml(cap.description)}</capability>`);
		}
		lines.push("    </capabilities>");
	}

	// Full tier: list resources
	if (tier === "full" && resources.length > 0) {
		lines.push("    <resources>");
		for (const res of resources) {
			lines.push(`      <resource>${escapeXml(res)}</resource>`);
		}
		lines.push("    </resources>");
	}

	// Anti-patterns
	if (manifest.antiPatterns && manifest.antiPatterns.length > 0) {
		lines.push("    <anti-patterns>");
		for (const ap of manifest.antiPatterns) {
			lines.push(`      <anti-pattern>${escapeXml(ap)}</anti-pattern>`);
		}
		lines.push("    </anti-patterns>");
	}

	lines.push("  </skill>");
	return lines.join("\n");
}

// ─── Multiple Skills ────────────────────────────────────────────────────────

/**
 * Generate `<available_skills>` XML block for system prompt injection.
 *
 * @param manifests - Array of skill manifests to include.
 * @param options - Disclosure tier and formatting options (applied to all skills).
 * @returns Complete XML block ready for system prompt injection.
 *
 * @example
 * ```ts
 * const xml = generateSkillsXml(skills, { tier: "metadata" });
 * systemPrompt += "\n" + xml;
 * ```
 */
export function generateSkillsXml(
	manifests: SkillManifest[],
	options: SkillXmlOptions = {},
): string {
	if (manifests.length === 0) return "";

	const lines: string[] = [];
	lines.push(`<available_skills count="${manifests.length}">`);

	for (const manifest of manifests) {
		lines.push(skillToXml(manifest, options));
	}

	lines.push("</available_skills>");
	return lines.join("\n");
}

/**
 * Generate XML for a single activated skill (full context for the agent).
 *
 * Used when a skill is selected/activated — gives the agent everything it needs.
 *
 * @param manifest - The activated skill.
 * @param resources - Script/reference file paths available.
 * @returns XML block for the activated skill.
 */
export function generateActivatedSkillXml(
	manifest: SkillManifest,
	resources: string[] = [],
): string {
	const lines: string[] = [];
	lines.push(`<activated_skill name="${escapeXml(manifest.name)}">`);
	lines.push(`  <description>${escapeXml(manifest.description)}</description>`);

	if (manifest.body) {
		lines.push("  <instructions>");
		lines.push(escapeXml(manifest.body));
		lines.push("  </instructions>");
	}

	if (manifest.capabilities.length > 0) {
		lines.push("  <capabilities>");
		for (const cap of manifest.capabilities) {
			lines.push(`    <capability verb="${escapeXml(cap.verb)}" object="${escapeXml(cap.object)}">${escapeXml(cap.description)}</capability>`);
		}
		lines.push("  </capabilities>");
	}

	if (resources.length > 0) {
		lines.push("  <resources>");
		for (const res of resources) {
			lines.push(`    <resource>${escapeXml(res)}</resource>`);
		}
		lines.push("  </resources>");
	}

	if (manifest.antiPatterns && manifest.antiPatterns.length > 0) {
		lines.push("  <anti-patterns>");
		for (const ap of manifest.antiPatterns) {
			lines.push(`    <anti-pattern>${escapeXml(ap)}</anti-pattern>`);
		}
		lines.push("  </anti-patterns>");
	}

	lines.push("</activated_skill>");
	return lines.join("\n");
}
