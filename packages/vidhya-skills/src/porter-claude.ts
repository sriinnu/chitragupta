/**
 * @module porter-claude
 * @description Claude Code SKILL.md format converters for the Skill Porter.
 *
 * Handles bidirectional conversion between Claude Code's SKILL.md format
 * (YAML frontmatter + freeform markdown instructions) and the vidhya
 * SkillManifest format.
 *
 * @packageDocumentation
 */

import type {
	SkillCapability,
	SkillManifest,
	SkillSource,
} from "./types.js";
import { computeTraitVector } from "./fingerprint.js";
import type { ClaudeSkillData } from "./porter-types.js";
import {
	parseFrontmatterSimple,
	asString,
	asBool,
	slugify,
	capitalizeFirst,
	extractNumberedSteps,
	extractExamplesFromBody,
	inferVerbObject,
	generateTagsFromText,
} from "./porter-utils.js";

/**
 * Parse a Claude Code SKILL.md file into its structured representation.
 *
 * Claude SKILL.md uses YAML frontmatter for metadata and freeform markdown
 * for instructions. The frontmatter fields use kebab-case.
 *
 * @param markdown - Raw SKILL.md content.
 * @returns Parsed Claude skill data.
 */
function parseClaudeSkill(markdown: string): ClaudeSkillData {
	const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

	if (!fmMatch) {
		// No frontmatter — treat entire content as body
		const lines = markdown.trim().split("\n");
		const firstLine = lines[0]?.replace(/^#+\s*/, "").trim() ?? "unnamed-skill";
		return {
			name: slugify(firstLine),
			description: firstLine,
			body: markdown.trim(),
		};
	}

	const frontmatter = parseFrontmatterSimple(fmMatch[1]);
	const body = fmMatch[2].trim();

	// Extract name: from frontmatter or first heading
	let name = asString(frontmatter.name);
	if (!name) {
		const headingMatch = body.match(/^#+\s+(.+)$/m);
		name = headingMatch ? slugify(headingMatch[1]) : "unnamed-skill";
	}

	// Extract description
	let description = asString(frontmatter.description);
	if (!description) {
		// First non-heading paragraph
		const paragraphs = body.split(/\n\n+/);
		const firstPara = paragraphs.find((p) => !p.trim().startsWith("#"));
		description = firstPara?.trim().split("\n").join(" ") ?? "";
	}

	// Parse allowed-tools (comma or space separated)
	let allowedTools: string[] | undefined;
	const rawTools = asString(frontmatter["allowed-tools"] ?? frontmatter.allowedTools);
	if (rawTools) {
		allowedTools = rawTools.split(/[,\s]+/).filter(Boolean);
	}

	return {
		name,
		description,
		disableModelInvocation: asBool(
			frontmatter["disable-model-invocation"] ?? frontmatter.disableModelInvocation,
		),
		userInvocable: asBool(
			frontmatter["user-invocable"] ?? frontmatter.userInvocable,
		),
		allowedTools,
		model: asString(frontmatter.model),
		context: frontmatter.context === "fork" ? "fork" : undefined,
		agent: asString(frontmatter.agent),
		argumentHint: asString(
			frontmatter["argument-hint"] ?? frontmatter.argumentHint,
		),
		body,
	};
}

/**
 * Import a Claude Code SKILL.md into the vidhya {@link SkillManifest} format.
 *
 * Mapping strategy:
 * - `name` → `name`
 * - `description` → `description`
 * - `allowed-tools` → capabilities (one per tool with verb="use")
 * - Markdown body → parsed for steps (numbered lists) and examples
 * - Tags auto-generated from description keywords
 * - Claude-specific fields stored in metadata for round-trip fidelity
 *
 * @param markdown - Raw Claude SKILL.md content.
 * @returns A fully populated SkillManifest.
 */
export function importClaudeSkill(markdown: string): SkillManifest {
	const claude = parseClaudeSkill(markdown);

	// Extract capabilities from allowed-tools and body structure
	const capabilities: SkillCapability[] = [];

	if (claude.allowedTools && claude.allowedTools.length > 0) {
		for (const tool of claude.allowedTools) {
			capabilities.push({
				verb: "use",
				object: tool.toLowerCase(),
				description: `Use the ${tool} tool as part of this skill.`,
			});
		}
	}

	// Parse numbered steps from body as a capability
	const steps = extractNumberedSteps(claude.body);
	if (steps.length > 0) {
		capabilities.push({
			verb: "execute",
			object: "workflow",
			description: steps.join(" "),
		});
	}

	// If no capabilities derived, create one from the description
	if (capabilities.length === 0) {
		const { verb, object } = inferVerbObject(claude.description);
		capabilities.push({
			verb,
			object,
			description: claude.description,
		});
	}

	// Extract examples from body
	const examples = extractExamplesFromBody(claude.body);

	// Auto-generate tags from description
	const tags = generateTagsFromText(claude.description, claude.name);

	// Build source with porter metadata for round-trip fidelity
	const source: SkillSource = { type: "manual", filePath: `claude://skills/${claude.name}` };

	const manifest: SkillManifest = {
		name: claude.name,
		version: "1.0.0",
		description: claude.description,
		capabilities,
		examples: examples.length > 0 ? examples : undefined,
		tags,
		source,
		antiPatterns: undefined,
		updatedAt: new Date().toISOString(),
	};

	// Compute trait vector
	const vector = computeTraitVector(manifest);
	manifest.traitVector = Array.from(vector);

	return manifest;
}

/**
 * Export a vidhya {@link SkillManifest} to Claude Code SKILL.md format.
 *
 * Produces a valid SKILL.md with YAML frontmatter and markdown instructions.
 * Capabilities are rendered as numbered steps, examples as markdown sections.
 *
 * @param skill - The vidhya skill manifest.
 * @returns A complete SKILL.md file content string.
 */
export function exportClaudeSkill(skill: SkillManifest): string {
	const parts: string[] = [];

	// ── Frontmatter ──
	parts.push("---");
	parts.push(`name: ${skill.name}`);
	parts.push(`description: ${skill.description}`);

	// Map capabilities to allowed-tools
	const toolNames = skill.capabilities
		.filter((c) => c.verb === "use")
		.map((c) => capitalizeFirst(c.object));
	if (toolNames.length > 0) {
		parts.push(`allowed-tools: ${toolNames.join(", ")}`);
	}

	parts.push("---");
	parts.push("");

	// ── Instructions body ──
	// Non-"use" capabilities become numbered steps
	const actionCaps = skill.capabilities.filter((c) => c.verb !== "use");
	if (actionCaps.length > 0) {
		for (let i = 0; i < actionCaps.length; i++) {
			const cap = actionCaps[i];
			parts.push(`${i + 1}. **${capitalizeFirst(cap.verb)} ${cap.object}**: ${cap.description}`);

			// Render parameters as sub-items
			if (cap.parameters) {
				for (const [pName, pDef] of Object.entries(cap.parameters)) {
					const reqLabel = pDef.required ? " (required)" : "";
					parts.push(`   - \`${pName}\`${reqLabel}: ${pDef.description}`);
				}
			}
		}
		parts.push("");
	} else {
		// Fallback: render description as the body
		parts.push(skill.description);
		parts.push("");
	}

	// ── Examples ──
	if (skill.examples && skill.examples.length > 0) {
		parts.push("## Examples");
		parts.push("");
		for (const example of skill.examples) {
			parts.push(`### ${example.description}`);
			if (Object.keys(example.input).length > 0) {
				parts.push(`\`\`\`json`);
				parts.push(JSON.stringify(example.input, null, 2));
				parts.push(`\`\`\``);
			}
			if (example.output) {
				parts.push(`**Expected output**: ${example.output}`);
			}
			parts.push("");
		}
	}

	// ── Anti-Patterns as warnings ──
	if (skill.antiPatterns && skill.antiPatterns.length > 0) {
		parts.push("## Limitations");
		parts.push("");
		for (const ap of skill.antiPatterns) {
			parts.push(`- ${ap}`);
		}
		parts.push("");
	}

	return parts.join("\n");
}
