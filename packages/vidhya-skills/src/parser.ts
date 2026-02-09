/**
 * @module parser
 * @description Parse `skill.md` files into {@link SkillManifest} objects.
 *
 * The skill.md format uses YAML frontmatter (between `---` delimiters) for
 * structured metadata and Markdown body sections for capabilities, examples,
 * and anti-patterns.
 *
 * The YAML parser is hand-rolled — no external dependency. It handles scalar
 * values, nested objects (via indentation), and inline arrays (`[a, b, c]`).
 *
 * @packageDocumentation
 */

import type {
	SkillCapability,
	SkillExample,
	SkillManifest,
	SkillParameter,
	SkillSource,
} from "./types.js";
import type {
	KulaType,
	PranamayaRequirements,
	EnhancedSkillManifest,
} from "./types-v2.js";
import { EMPTY_PRANAMAYA } from "./types-v2.js";

// ─── Frontmatter Parsing ────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from raw text between `---` delimiters.
 *
 * Handles:
 * - Scalar values (strings, numbers, booleans)
 * - Inline arrays: `[a, b, c]`
 * - Nested objects via indentation (2-space)
 * - Quoted strings (single and double)
 *
 * Does NOT handle:
 * - Multi-line strings (|, >)
 * - Anchors/aliases (&, *)
 * - Complex YAML features
 *
 * @param raw - The raw YAML text (without `---` delimiters).
 * @returns A parsed key-value record.
 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = raw.split("\n");
	const stack: { obj: Record<string, unknown>; indent: number }[] = [
		{ obj: result, indent: -1 },
	];

	for (const line of lines) {
		// Skip empty lines and comments
		if (line.trim() === "" || line.trim().startsWith("#")) continue;

		// Determine indentation level
		const indent = line.search(/\S/);
		if (indent < 0) continue;

		// Find the colon separator
		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;

		const key = line.slice(indent, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		// Pop stack to find the correct parent for this indentation level
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack[stack.length - 1].obj;

		if (rawValue === "" || rawValue === undefined) {
			// Nested object — the value will be filled by subsequent indented lines
			const nested: Record<string, unknown> = {};
			parent[key] = nested;
			stack.push({ obj: nested, indent });
		} else {
			// Scalar or inline array
			parent[key] = parseYamlValue(rawValue);
		}
	}

	return result;
}

/**
 * Parse a single YAML scalar value.
 *
 * @param raw - The raw value string after the colon.
 * @returns The parsed value (string, number, boolean, null, or array).
 */
function parseYamlValue(raw: string): unknown {
	const trimmed = raw.trim();

	// Inline array: [a, b, c]
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		const inner = trimmed.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => parseYamlValue(item.trim()));
	}

	// Quoted string
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	// Boolean
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;

	// Null
	if (trimmed === "null" || trimmed === "~") return null;

	// Number
	const num = Number(trimmed);
	if (!isNaN(num) && trimmed !== "") return num;

	// Plain string
	return trimmed;
}

// ─── Section Parsing ────────────────────────────────────────────────────────

/**
 * Parse the Capabilities section from markdown into {@link SkillCapability} objects.
 *
 * Expected format:
 * ```markdown
 * ## Capabilities
 * ### verb / object
 * Description text.
 *
 * **Parameters:**
 * - `name` (type, required): Description
 * - `name` (type): Description
 * ```
 *
 * @param markdown - The full markdown body (after frontmatter).
 * @returns An array of parsed capabilities.
 */
export function parseCapabilitiesSection(markdown: string): SkillCapability[] {
	const capabilities: SkillCapability[] = [];

	// Find the ## Capabilities section
	const capSection = extractSection(markdown, "Capabilities", 2);
	if (!capSection) return capabilities;

	// Split into ### subsections (each is a capability)
	const subSections = splitByHeading(capSection, 3);

	for (const sub of subSections) {
		const heading = sub.heading.trim();
		// Parse "verb / object" from heading
		const slashIdx = heading.indexOf("/");
		if (slashIdx < 0) continue;

		const verb = heading.slice(0, slashIdx).trim().toLowerCase();
		const object = heading.slice(slashIdx + 1).trim().toLowerCase();

		// Description is the text before **Parameters:**
		const paramIdx = sub.body.indexOf("**Parameters:**");
		const description =
			paramIdx >= 0
				? sub.body.slice(0, paramIdx).trim()
				: sub.body.trim();

		// Parse parameters if present
		const parameters: Record<string, SkillParameter> = {};
		if (paramIdx >= 0) {
			const paramText = sub.body.slice(paramIdx + "**Parameters:**".length);
			const paramLines = paramText
				.split("\n")
				.filter((l) => l.trim().startsWith("- "));

			for (const line of paramLines) {
				const parsed = parseParameterLine(line);
				if (parsed) {
					parameters[parsed.name] = parsed.param;
				}
			}
		}

		capabilities.push({
			verb,
			object,
			description,
			parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
		});
	}

	return capabilities;
}

/**
 * Parse a parameter line like:
 *   `- \`name\` (type, required): Description`
 *   `- \`name\` (type): Description`
 */
function parseParameterLine(
	line: string,
): { name: string; param: SkillParameter } | null {
	// Pattern: - `name` (type[, required]): description
	const match = line.match(
		/- `([^`]+)`\s*\(([^)]+)\)\s*(?::\s*(.*))?/,
	);
	if (!match) return null;

	const name = match[1];
	const typeInfo = match[2];
	const description = match[3]?.trim() ?? "";

	const parts = typeInfo.split(",").map((p) => p.trim());
	const type = parts[0] as SkillParameter["type"];
	const required = parts.includes("required");

	// Extract default value if present
	const defaultPart = parts.find((p) => p.startsWith("default"));
	const defaultValue = defaultPart
		? parseYamlValue(defaultPart.replace(/^default\s*/, ""))
		: undefined;

	return {
		name,
		param: {
			type: type || "string",
			description,
			required: required || undefined,
			default: defaultValue,
		},
	};
}

/**
 * Parse the Examples section from markdown into {@link SkillExample} objects.
 *
 * Expected format:
 * ```markdown
 * ## Examples
 * ### Example title
 * - **input**: `{ "key": "value" }`
 * - **output**: Description of expected output
 * ```
 *
 * @param markdown - The full markdown body (after frontmatter).
 * @returns An array of parsed examples.
 */
export function parseExamplesSection(markdown: string): SkillExample[] {
	const examples: SkillExample[] = [];

	const exSection = extractSection(markdown, "Examples", 2);
	if (!exSection) return examples;

	const subSections = splitByHeading(exSection, 3);

	for (const sub of subSections) {
		const description = sub.heading.trim();
		let input: Record<string, unknown> = {};
		let output: string | undefined;

		const lines = sub.body.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();

			// Parse input line
			const inputMatch = trimmed.match(/\*\*input\*\*\s*:\s*`(.+)`/);
			if (inputMatch) {
				try {
					input = JSON.parse(inputMatch[1]);
				} catch {
					// If JSON parsing fails, store as a raw key
					input = { raw: inputMatch[1] };
				}
			}

			// Parse output line
			const outputMatch = trimmed.match(/\*\*output\*\*\s*:\s*(.*)/);
			if (outputMatch) {
				output = outputMatch[1].trim();
			}
		}

		examples.push({ description, input, output });
	}

	return examples;
}

// ─── Markdown Utilities ─────────────────────────────────────────────────────

/**
 * Extract a section by heading level and text.
 * Returns the content between this heading and the next heading at the
 * same or higher level.
 */
function extractSection(
	markdown: string,
	headingText: string,
	level: number,
): string | null {
	const prefix = "#".repeat(level);
	const pattern = new RegExp(
		`^${prefix}\\s+${headingText}\\s*$`,
		"im",
	);
	const match = markdown.match(pattern);
	if (!match || match.index === undefined) return null;

	const startIdx = match.index + match[0].length;
	// Find the next heading at same or higher level
	const nextHeading = new RegExp(`^#{1,${level}}\\s+`, "m");
	const rest = markdown.slice(startIdx);
	const nextMatch = rest.match(nextHeading);

	return nextMatch && nextMatch.index !== undefined
		? rest.slice(0, nextMatch.index)
		: rest;
}

/**
 * Split markdown content by headings of a given level.
 * Returns an array of { heading, body } objects.
 */
function splitByHeading(
	content: string,
	level: number,
): { heading: string; body: string }[] {
	const results: { heading: string; body: string }[] = [];
	const prefix = "#".repeat(level);
	const regex = new RegExp(`^${prefix}\\s+(.+)$`, "gm");
	let lastMatch: RegExpExecArray | null = null;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		if (lastMatch) {
			results.push({
				heading: lastMatch[1],
				body: content.slice(lastMatch.index + lastMatch[0].length, match.index),
			});
		}
		lastMatch = match;
	}

	if (lastMatch) {
		results.push({
			heading: lastMatch[1],
			body: content.slice(lastMatch.index + lastMatch[0].length),
		});
	}

	return results;
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Parse a skill.md file into a {@link SkillManifest}.
 *
 * The file format is YAML frontmatter (metadata) + Markdown body (capabilities,
 * examples, anti-patterns).
 *
 * @param content - The full text content of a skill.md file.
 * @returns A fully populated SkillManifest.
 * @throws If the frontmatter is missing required fields.
 */
export function parseSkillMarkdown(content: string): EnhancedSkillManifest {
	// Split frontmatter from body
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!fmMatch) {
		throw new Error("Invalid skill.md: missing YAML frontmatter delimiters (---)");
	}

	const frontmatter = parseFrontmatter(fmMatch[1]);
	const body = fmMatch[2];

	// Parse source (nested object)
	const rawSource = frontmatter.source as Record<string, unknown> | undefined;
	let source: SkillSource;
	if (rawSource?.type === "tool") {
		source = { type: "tool", toolName: String(rawSource.toolName ?? "") };
	} else if (rawSource?.type === "mcp-server") {
		source = {
			type: "mcp-server",
			serverId: String(rawSource.serverId ?? ""),
			serverName: String(rawSource.serverName ?? ""),
		};
	} else if (rawSource?.type === "plugin") {
		source = { type: "plugin", pluginName: String(rawSource.pluginName ?? "") };
	} else if (rawSource?.type === "generated") {
		source = { type: "generated", generator: String(rawSource.generator ?? "") };
	} else {
		source = { type: "manual", filePath: String(rawSource?.filePath ?? "") };
	}

	// Parse capabilities from markdown body
	const capabilities = parseCapabilitiesSection(body);

	// Parse examples from markdown body
	const examples = parseExamplesSection(body);

	// Parse anti-patterns section
	const antiPatterns = parseAntiPatternsSection(body);

	// Assemble tags (ensure array)
	const rawTags = frontmatter.tags;
	const tags = Array.isArray(rawTags) ? rawTags.map(String) : [];

	// ── Vidya-Tantra extensions (all optional, backward-compatible) ──

	// Kula tier
	const rawKula = frontmatter.kula as string | undefined;
	const kula: KulaType | undefined =
		rawKula === "antara" || rawKula === "bahya" || rawKula === "shiksha"
			? rawKula
			: undefined;

	// Pranamaya requirements (nested object)
	const rawReq = frontmatter.requirements as Record<string, unknown> | undefined;
	const requirements: PranamayaRequirements | undefined = rawReq
		? {
			bins: toStringArray(rawReq.bins),
			env: toStringArray(rawReq.env),
			os: toStringArray(rawReq.os) as NodeJS.Platform[],
			network: rawReq.network === true,
			privilege: rawReq.privilege === true,
		}
		: undefined;

	// Selection wisdom — from frontmatter first, body sections as fallback
	// Use || instead of ?? because toStringArray returns [] (truthy) for undefined input
	const fmWhenToUse = Array.isArray(frontmatter.whenToUse) ? toStringArray(frontmatter.whenToUse) : null;
	const fmWhenNotToUse = Array.isArray(frontmatter.whenNotToUse) ? toStringArray(frontmatter.whenNotToUse) : null;
	const whenToUse = fmWhenToUse ?? parseBulletSection(body, "When To Use");
	const whenNotToUse = fmWhenNotToUse ?? parseBulletSection(body, "When Not To Use");
	const complements = toStringArray(frontmatter.complements);
	const supersedes = toStringArray(frontmatter.supersedes);

	const manifest: EnhancedSkillManifest = {
		name: String(frontmatter.name ?? ""),
		version: String(frontmatter.version ?? "0.0.0"),
		description: String(frontmatter.description ?? ""),
		author: frontmatter.author ? String(frontmatter.author) : undefined,
		capabilities,
		inputSchema: frontmatter.inputSchema as Record<string, unknown> | undefined,
		outputSchema: frontmatter.outputSchema as Record<string, unknown> | undefined,
		examples: examples.length > 0 ? examples : undefined,
		tags,
		traitVector: frontmatter.traitVector as number[] | undefined,
		source,
		antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
		updatedAt: String(frontmatter.updatedAt ?? new Date().toISOString()),
		// Vidya-Tantra extensions (all optional, only set if present)
		...(kula !== undefined && { kula }),
		...(requirements !== undefined && { requirements }),
		...(whenToUse.length > 0 && { whenToUse }),
		...(whenNotToUse.length > 0 && { whenNotToUse }),
		...(complements.length > 0 && { complements }),
		...(supersedes.length > 0 && { supersedes }),
	};

	return manifest;
}

/**
 * Safely coerce an unknown value to string[].
 * Returns empty array if input is not an array.
 */
function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(String);
}

/**
 * Parse a bullet-list section from markdown body.
 * Falls back for whenToUse / whenNotToUse when not in frontmatter.
 */
function parseBulletSection(markdown: string, headingText: string): string[] {
	const section = extractSection(markdown, headingText, 2);
	if (!section) return [];
	return section
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}

/**
 * Parse the Anti-Patterns section from markdown body.
 * Each bullet point is an anti-pattern.
 */
function parseAntiPatternsSection(markdown: string): string[] {
	const section = extractSection(markdown, "Anti-Patterns", 2);
	if (!section) return [];

	return section
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}
