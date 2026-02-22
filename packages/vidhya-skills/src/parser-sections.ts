/**
 * @module parser-sections
 * @description Markdown section parsers for skill.md files.
 *
 * Parses Capabilities, Examples, and Anti-Patterns sections from
 * the markdown body of skill.md files.
 *
 * @packageDocumentation
 */

import type {
	SkillCapability,
	SkillExample,
	SkillParameter,
} from "./types.js";

import { parseYamlValue } from "./parser-yaml.js";

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
export function parseParameterLine(
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
export function extractSection(
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
export function splitByHeading(
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
