/**
 * @module writer
 * @description Serialize {@link SkillManifest} objects back to skill.md format.
 *
 * The inverse of the parser: takes a structured manifest and produces a
 * human-readable, version-controllable Markdown document with YAML frontmatter.
 *
 * @packageDocumentation
 */

import type { SkillManifest, SkillSource } from "./types.js";
import type { EnhancedSkillManifest } from "./types-v2.js";

// ─── Frontmatter Writer ─────────────────────────────────────────────────────

/**
 * Serialize a record into YAML frontmatter text.
 *
 * Handles:
 * - Scalar values (strings, numbers, booleans, null)
 * - Inline arrays: `[a, b, c]`
 * - Nested objects via 2-space indentation
 *
 * @param data - The key-value record to serialize.
 * @param indent - Current indentation level (for recursion). Defaults to 0.
 * @returns YAML-formatted text (without `---` delimiters).
 */
export function writeFrontmatter(
	data: Record<string, unknown>,
	indent: number = 0,
): string {
	const lines: string[] = [];
	const prefix = "  ".repeat(indent);

	for (const [key, value] of Object.entries(data)) {
		if (value === undefined) continue;

		if (value === null) {
			lines.push(`${prefix}${key}: null`);
		} else if (Array.isArray(value)) {
			// Inline array for simple values
			if (value.length === 0) {
				lines.push(`${prefix}${key}: []`);
			} else if (value.every((v) => typeof v !== "object" || v === null)) {
				const items = value.map((v) => formatYamlScalar(v)).join(", ");
				lines.push(`${prefix}${key}: [${items}]`);
			} else {
				// Complex array — one item per line (not common in our format)
				lines.push(`${prefix}${key}:`);
				for (const item of value) {
					if (typeof item === "object" && item !== null) {
						lines.push(`${prefix}  -`);
						const nested = writeFrontmatter(
							item as Record<string, unknown>,
							indent + 2,
						);
						lines.push(nested);
					} else {
						lines.push(`${prefix}  - ${formatYamlScalar(item)}`);
					}
				}
			}
		} else if (typeof value === "object") {
			lines.push(`${prefix}${key}:`);
			const nested = writeFrontmatter(
				value as Record<string, unknown>,
				indent + 1,
			);
			lines.push(nested);
		} else {
			lines.push(`${prefix}${key}: ${formatYamlScalar(value)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format a scalar value for YAML output.
 * Strings that contain special characters are quoted.
 */
function formatYamlScalar(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "null";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);
	if (typeof value === "string") {
		// Quote strings that contain special YAML characters
		if (
			value === "" ||
			value.includes(":") ||
			value.includes("#") ||
			value.includes("[") ||
			value.includes("]") ||
			value.includes("{") ||
			value.includes("}") ||
			value.includes(",") ||
			value.includes("'") ||
			value.includes('"') ||
			value.includes("\n") ||
			value === "true" ||
			value === "false" ||
			value === "null" ||
			!isNaN(Number(value))
		) {
			// Use double quotes, escaping inner double quotes
			return `"${value.replace(/"/g, '\\"')}"`;
		}
		return value;
	}
	return String(value);
}

// ─── Source Writer ───────────────────────────────────────────────────────────

/**
 * Convert a SkillSource to a plain object for YAML serialization.
 */
function sourceToRecord(source: SkillSource): Record<string, unknown> {
	switch (source.type) {
		case "tool":
			return { type: "tool", toolName: source.toolName };
		case "mcp-server":
			return {
				type: "mcp-server",
				serverId: source.serverId,
				serverName: source.serverName,
			};
		case "plugin":
			return { type: "plugin", pluginName: source.pluginName };
		case "manual":
			return { type: "manual", filePath: source.filePath };
		case "generated":
			return { type: "generated", generator: source.generator };
	}
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Serialize a {@link SkillManifest} to the skill.md format.
 *
 * Produces a complete Markdown document with:
 * - YAML frontmatter (metadata, tags, source)
 * - Capabilities section with parameters
 * - Examples section with input/output
 * - Anti-Patterns section
 *
 * @param manifest - The skill manifest to serialize.
 * @returns A complete skill.md file content string.
 *
 * @example
 * ```ts
 * const md = writeSkillMarkdown(mySkill);
 * await fs.writeFile("skills/my-skill/skill.md", md);
 * ```
 */
export function writeSkillMarkdown(manifest: SkillManifest | EnhancedSkillManifest): string {
	const parts: string[] = [];
	const enhanced = manifest as EnhancedSkillManifest;

	// ── Frontmatter ──
	const frontmatterData: Record<string, unknown> = {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
	};
	if (manifest.author) {
		frontmatterData.author = manifest.author;
	}
	frontmatterData.tags = manifest.tags;
	frontmatterData.source = sourceToRecord(manifest.source);
	frontmatterData.updatedAt = manifest.updatedAt;

	// ── Vidya-Tantra extended fields ──
	if (enhanced.kula !== undefined) {
		frontmatterData.kula = enhanced.kula;
	}
	if (enhanced.requirements !== undefined) {
		frontmatterData.requirements = enhanced.requirements;
	}
	if (enhanced.whenToUse !== undefined && enhanced.whenToUse.length > 0) {
		frontmatterData.whenToUse = enhanced.whenToUse;
	}
	if (enhanced.whenNotToUse !== undefined && enhanced.whenNotToUse.length > 0) {
		frontmatterData.whenNotToUse = enhanced.whenNotToUse;
	}
	if (enhanced.complements !== undefined && enhanced.complements.length > 0) {
		frontmatterData.complements = enhanced.complements;
	}
	if (enhanced.supersedes !== undefined && enhanced.supersedes.length > 0) {
		frontmatterData.supersedes = enhanced.supersedes;
	}
	if (enhanced.permissions !== undefined) {
		frontmatterData.permissions = enhanced.permissions;
	}
	if (enhanced.approachLadder !== undefined && enhanced.approachLadder.length > 0) {
		frontmatterData.approachLadder = enhanced.approachLadder;
	}
	if (enhanced.evalCases !== undefined && enhanced.evalCases.length > 0) {
		frontmatterData.evalCases = enhanced.evalCases;
	}

	parts.push("---");
	parts.push(writeFrontmatter(frontmatterData));
	parts.push("---");
	parts.push("");

	// ── Capabilities ──
	if (manifest.capabilities.length > 0) {
		parts.push("## Capabilities");
		parts.push("");

		for (const cap of manifest.capabilities) {
			parts.push(`### ${cap.verb} / ${cap.object}`);
			parts.push(cap.description);
			parts.push("");

			if (cap.parameters && Object.keys(cap.parameters).length > 0) {
				parts.push("**Parameters:**");
				for (const [name, param] of Object.entries(cap.parameters)) {
					const typeParts: string[] = [param.type];
					if (param.required) typeParts.push("required");
					if (param.default !== undefined) {
						typeParts.push(`default ${String(param.default)}`);
					}
					parts.push(`- \`${name}\` (${typeParts.join(", ")}): ${param.description}`);
				}
				parts.push("");
			}
		}
	}

	// ── Examples ──
	if (manifest.examples && manifest.examples.length > 0) {
		parts.push("## Examples");
		parts.push("");

		for (const example of manifest.examples) {
			parts.push(`### ${example.description}`);
			parts.push(`- **input**: \`${JSON.stringify(example.input)}\``);
			if (example.output) {
				parts.push(`- **output**: ${example.output}`);
			}
			parts.push("");
		}
	}

	// ── Anti-Patterns ──
	if (manifest.antiPatterns && manifest.antiPatterns.length > 0) {
		parts.push("## Anti-Patterns");
		for (const pattern of manifest.antiPatterns) {
			parts.push(`- ${pattern}`);
		}
		parts.push("");
	}

	return parts.join("\n");
}
