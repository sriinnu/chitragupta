/**
 * @module porter-utils
 * @description Internal utilities shared by the Skill Porter (Setu) modules.
 *
 * Contains format conversion helpers, YAML parsing, tag generation,
 * JSON Schema mapping, and other shared functions used by the Claude
 * and Gemini format converters.
 *
 * @packageDocumentation
 */

import type {
	SkillExample,
	SkillParameter,
} from "./types.js";

export function parseFrontmatterSimple(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const line of raw.split("\n")) {
		if (line.trim() === "" || line.trim().startsWith("#")) continue;
		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		result[key] = parseSimpleValue(value);
	}
	return result;
}

/**
 * Parse a simple YAML scalar value.
 */
export function parseSimpleValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null" || trimmed === "~") return null;
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Convert a string to a URL-friendly slug.
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

/**
 * Extract numbered steps from markdown body.
 * Finds lines matching "1. ...", "2. ...", etc.
 */
export function extractNumberedSteps(body: string): string[] {
	const steps: string[] = [];
	const lines = body.split("\n");
	for (const line of lines) {
		const match = line.match(/^\d+\.\s+(.+)/);
		if (match) {
			steps.push(match[1].replace(/\*\*/g, "").trim());
		}
	}
	return steps;
}

/**
 * Extract examples from markdown body.
 * Looks for "## Examples" section with ### subsections,
 * or code blocks preceded by descriptive text.
 */
export function extractExamplesFromBody(body: string): SkillExample[] {
	const examples: SkillExample[] = [];

	// Look for ## Examples section
	const exMatch = body.match(/^##\s+Examples?\s*$/im);
	if (!exMatch || exMatch.index === undefined) return examples;

	const exSection = body.slice(exMatch.index + exMatch[0].length);
	// Find next ## heading to delimit
	const nextHeading = exSection.match(/^##\s+/m);
	const exContent = nextHeading?.index !== undefined
		? exSection.slice(0, nextHeading.index)
		: exSection;

	// Split by ### headings, skipping preamble before first ###
	const subParts = exContent.split(/^###\s+/m);
	// First element is text before the first ### — skip it
	const exampleParts = subParts.slice(1).filter(Boolean);
	for (const part of exampleParts) {
		const lines = part.trim().split("\n");
		const description = lines[0]?.trim() ?? "Example";

		// Look for code blocks
		const codeMatch = part.match(/```(?:json)?\n([\s\S]*?)```/);
		let input: Record<string, unknown> = {};
		if (codeMatch) {
			try {
				input = JSON.parse(codeMatch[1].trim());
			} catch {
				input = { raw: codeMatch[1].trim() };
			}
		}

		// Look for expected output
		const outputMatch = part.match(/\*\*(?:Expected output|output)\*\*\s*:\s*(.+)/i);
		const output = outputMatch?.[1]?.trim();

		examples.push({ description, input, output });
	}

	return examples;
}

/**
 * Infer a verb/object pair from a natural language description.
 */
export function inferVerbObject(text: string): { verb: string; object: string } {
	const words = text.toLowerCase().split(/\s+/);
	const knownVerbs = new Set([
		"read", "write", "search", "find", "create", "delete", "update",
		"analyze", "build", "test", "deploy", "run", "execute", "list",
		"generate", "convert", "parse", "format", "validate", "check",
		"review", "explain", "debug", "refactor", "serve", "install",
		"configure", "manage", "monitor", "transform", "migrate",
	]);

	for (const word of words) {
		if (knownVerbs.has(word)) {
			const idx = words.indexOf(word);
			const rest = words.slice(idx + 1).join(" ") || "content";
			return { verb: word, object: rest.slice(0, 40) };
		}
	}

	return { verb: "use", object: words.slice(0, 3).join(" ") };
}

/**
 * Generate tags from descriptive text and skill name.
 */
export function generateTagsFromText(description: string, name: string): string[] {
	const tags = new Set<string>();
	const words = `${description} ${name}`
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2);

	const domainKeywords = new Set([
		"file", "filesystem", "directory", "code", "text", "memory",
		"session", "git", "search", "database", "api", "http", "web",
		"network", "shell", "terminal", "image", "json", "yaml",
		"markdown", "config", "deploy", "test", "build", "debug",
		"review", "analyze", "refactor", "docs", "documentation",
		"format", "lint", "mcp", "server", "extension", "plugin",
	]);

	for (const word of words) {
		if (domainKeywords.has(word)) {
			tags.add(word);
		}
	}

	// Add name parts
	const nameParts = name.replace(/[^a-z0-9]/gi, " ").toLowerCase().split(/\s+/);
	for (const part of nameParts) {
		if (part.length > 2) tags.add(part);
	}

	return [...tags];
}

/**
 * Convert JSON Schema properties to SkillParameter map.
 */
export function convertJsonSchemaToParams(
	schema: Record<string, unknown>,
): Record<string, SkillParameter> | undefined {
	const properties = (schema.properties ?? schema) as Record<string, Record<string, unknown>>;
	if (typeof properties !== "object") return undefined;

	const required = new Set(
		Array.isArray(schema.required) ? (schema.required as string[]) : [],
	);

	const params: Record<string, SkillParameter> = {};
	for (const [name, prop] of Object.entries(properties)) {
		if (typeof prop !== "object" || prop === null) continue;
		params[name] = {
			type: mapType(prop.type as string | undefined),
			description: String(prop.description ?? ""),
			required: required.has(name) || undefined,
			default: prop.default,
		};
	}

	return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Convert SkillParameter map to JSON Schema properties object.
 */
export function convertParamsToJsonSchema(
	params: Record<string, SkillParameter>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [name, param] of Object.entries(params)) {
		properties[name] = {
			type: param.type,
			description: param.description,
			...(param.default !== undefined ? { default: param.default } : {}),
		};
		if (param.required) required.push(name);
	}

	return {
		type: "object",
		properties,
		...(required.length > 0 ? { required } : {}),
	};
}

/**
 * Map a JSON Schema type string to a SkillParameter type.
 */
export function mapType(type: string | undefined): SkillParameter["type"] {
	switch (type) {
		case "string": return "string";
		case "number":
		case "integer": return "number";
		case "boolean": return "boolean";
		case "array": return "array";
		case "object": return "object";
		default: return "string";
	}
}

/**
 * Extract a command from a description string.
 * Looks for patterns like "command: xyz" or quoted commands.
 */
export function extractCommandFromDescription(description: string): string {
	const match = description.match(/(?:command|cmd|run|spawn)[\s:]+(\S+)/i)
		?? description.match(/`([^`]+)`/)
		?? description.match(/MCP server:\s*(\S+)/);
	return match?.[1] ?? "node";
}

/**
 * Safely coerce a value to string or return undefined.
 */
export function asString(value: unknown): string | undefined {
	if (typeof value === "string" && value !== "") return value;
	return undefined;
}

/**
 * Safely coerce a value to boolean or return undefined.
 */
export function asBool(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalizeFirst(str: string): string {
	if (str.length === 0) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}
