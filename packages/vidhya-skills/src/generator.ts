/**
 * @module generator
 * @description Auto-generate skill manifests from tool definitions.
 *
 * When an MCP server connects or tools are loaded, this module converts
 * raw tool definitions (name, description, inputSchema) into full
 * {@link SkillManifest} objects, complete with capabilities, tags, and
 * pre-computed trait vectors.
 *
 * ## Verb Extraction Algorithm
 *
 * Tool names encode intent in their naming pattern. We extract verb/object
 * pairs by parsing common naming conventions:
 *
 * - `snake_case`: `read_file` -> verb="read", object="file"
 * - `kebab-case`: `search-code` -> verb="search", object="code"
 * - `camelCase`: `analyzeCode` -> verb="analyze", object="code"
 * - `flat`: `grep` -> verb="grep", object="content" (from known verbs)
 *
 * @packageDocumentation
 */

import { computeTraitVector } from "./fingerprint.js";
import type { SkillCapability, SkillManifest, SkillParameter } from "./types.js";

// ─── Known Verbs ────────────────────────────────────────────────────────────

/**
 * Known single-word verbs that can appear as tool names without an object.
 * Maps to default objects.
 */
const KNOWN_SINGLE_VERBS: Record<string, string> = {
	grep: "content",
	find: "files",
	ls: "directory",
	list: "items",
	search: "content",
	read: "content",
	write: "content",
	delete: "items",
	execute: "command",
	run: "command",
	edit: "content",
	view: "content",
	create: "resource",
	update: "resource",
	remove: "resource",
	fetch: "data",
	get: "data",
	set: "data",
	push: "data",
	pull: "data",
	index: "content",
	analyze: "content",
	parse: "content",
	format: "content",
	validate: "content",
	test: "code",
	build: "project",
	install: "package",
	publish: "package",
};

// ─── Verb/Object Extraction ─────────────────────────────────────────────────

/**
 * Extract a verb/object pair from a tool name.
 *
 * Handles multiple naming conventions:
 *
 * 1. **snake_case**: `read_file` -> { verb: "read", object: "file" }
 * 2. **kebab-case**: `search-code` -> { verb: "search", object: "code" }
 * 3. **camelCase**: `analyzeCode` -> { verb: "analyze", object: "code" }
 * 4. **PascalCase**: `ReadFile` -> { verb: "read", object: "file" }
 * 5. **Single word**: `grep` -> { verb: "grep", object: "content" }
 * 6. **Multi-part**: `read_file_contents` -> { verb: "read", object: "file contents" }
 *
 * @param toolName - The raw tool name string.
 * @returns The extracted verb and object.
 *
 * @example
 * ```ts
 * extractVerbObject("read_file");       // { verb: "read", object: "file" }
 * extractVerbObject("searchCode");      // { verb: "search", object: "code" }
 * extractVerbObject("list-directories"); // { verb: "list", object: "directories" }
 * extractVerbObject("grep");            // { verb: "grep", object: "content" }
 * ```
 */
export function extractVerbObject(
	toolName: string,
): { verb: string; object: string } {
	// Split the name into parts using all common separators
	const parts = splitToolName(toolName);

	if (parts.length === 0) {
		return { verb: "use", object: toolName.toLowerCase() };
	}

	if (parts.length === 1) {
		const word = parts[0].toLowerCase();
		// Check if it's a known single verb
		if (word in KNOWN_SINGLE_VERBS) {
			return { verb: word, object: KNOWN_SINGLE_VERBS[word] };
		}
		return { verb: "use", object: word };
	}

	// First part is the verb, rest is the object
	const verb = parts[0].toLowerCase();
	const object = parts.slice(1).join(" ").toLowerCase();

	return { verb, object };
}

/**
 * Split a tool name into constituent parts, handling multiple naming conventions.
 *
 * - `snake_case` splits on `_`
 * - `kebab-case` splits on `-`
 * - `camelCase` and `PascalCase` split on case boundaries
 * - Combinations thereof
 *
 * @param name - The tool name to split.
 * @returns Array of lowercase word parts.
 */
function splitToolName(name: string): string[] {
	// First, split on underscores and hyphens
	const segments = name.split(/[_-]+/).filter(Boolean);

	// Then split each segment on camelCase boundaries
	const parts: string[] = [];
	for (const segment of segments) {
		// Insert boundary before each uppercase letter preceded by a lowercase
		const camelParts = segment
			.replace(/([a-z])([A-Z])/g, "$1\0$2")
			// Also split on consecutive uppercase followed by lowercase: XMLParser -> XML, Parser
			.replace(/([A-Z]+)([A-Z][a-z])/g, "$1\0$2")
			.split("\0")
			.filter(Boolean);

		parts.push(...camelParts);
	}

	return parts.map((p) => p.toLowerCase());
}

// ─── Tag Generation ─────────────────────────────────────────────────────────

/**
 * Auto-generate tags from a tool name, description, and verb/object.
 *
 * @param toolName - The raw tool name.
 * @param description - The tool's description.
 * @param verb - The extracted verb.
 * @param object - The extracted object.
 * @returns An array of generated tags.
 */
function generateTags(
	toolName: string,
	description: string,
	verb: string,
	object: string,
): string[] {
	const tags = new Set<string>();

	// Add verb and object as tags
	tags.add(verb);
	if (object.includes(" ")) {
		// Multi-word objects: add each word and the full phrase
		for (const word of object.split(/\s+/)) {
			if (word.length > 2) tags.add(word);
		}
	} else {
		tags.add(object);
	}

	// Add name parts as tags
	const nameParts = splitToolName(toolName);
	for (const part of nameParts) {
		if (part.length > 2) tags.add(part);
	}

	// Extract domain tags from description
	const domainKeywords = [
		"file", "filesystem", "directory", "code", "text",
		"memory", "session", "git", "search", "database",
		"api", "http", "web", "network", "shell", "terminal",
		"image", "json", "yaml", "markdown", "config",
	];
	const descLower = description.toLowerCase();
	for (const keyword of domainKeywords) {
		if (descLower.includes(keyword)) {
			tags.add(keyword);
		}
	}

	return [...tags];
}

// ─── Schema to Parameters ───────────────────────────────────────────────────

/**
 * Extract SkillParameters from a JSON Schema inputSchema.
 *
 * @param schema - A JSON Schema object (typically with type="object" and properties).
 * @returns A map of parameter names to SkillParameter definitions.
 */
function extractParameters(
	schema: Record<string, unknown>,
): Record<string, SkillParameter> | undefined {
	const properties = schema.properties as
		| Record<string, Record<string, unknown>>
		| undefined;
	if (!properties) return undefined;

	const required = new Set(
		Array.isArray(schema.required) ? (schema.required as string[]) : [],
	);

	const params: Record<string, SkillParameter> = {};

	for (const [name, prop] of Object.entries(properties)) {
		const type = mapJsonSchemaType(prop.type as string | undefined);
		params[name] = {
			type,
			description: String(prop.description ?? ""),
			required: required.has(name) || undefined,
			default: prop.default,
		};
	}

	return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Map a JSON Schema type string to a SkillParameter type.
 */
function mapJsonSchemaType(
	type: string | undefined,
): SkillParameter["type"] {
	switch (type) {
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return "boolean";
		case "array":
			return "array";
		case "object":
			return "object";
		default:
			return "string";
	}
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Tool definition as provided by MCP servers or built-in tool registrations.
 */
export interface ToolDefinition {
	/** The tool's unique name. */
	name: string;
	/** Human-readable description. */
	description: string;
	/** JSON Schema for the tool's input. */
	inputSchema: Record<string, unknown>;
}

/**
 * Generate a {@link SkillManifest} from a tool definition.
 *
 * Automatically extracts:
 * - Verb/object from the tool name
 * - Parameters from the input schema
 * - Tags from the name, description, and domain keywords
 * - A pre-computed trait vector
 *
 * @param toolDef - The raw tool definition.
 * @returns A fully populated SkillManifest with trait vector.
 *
 * @example
 * ```ts
 * const skill = generateSkillFromTool({
 *   name: "read_file",
 *   description: "Read the contents of a file at a given path",
 *   inputSchema: {
 *     type: "object",
 *     properties: {
 *       path: { type: "string", description: "File path" }
 *     },
 *     required: ["path"]
 *   }
 * });
 * console.log(skill.capabilities[0].verb); // "read"
 * console.log(skill.capabilities[0].object); // "file"
 * ```
 */
export function generateSkillFromTool(toolDef: ToolDefinition): SkillManifest {
	const { verb, object } = extractVerbObject(toolDef.name);
	const parameters = extractParameters(toolDef.inputSchema);
	const tags = generateTags(toolDef.name, toolDef.description, verb, object);

	const capability: SkillCapability = {
		verb,
		object,
		description: toolDef.description,
		parameters,
	};

	const manifest: SkillManifest = {
		name: toolDef.name,
		version: "1.0.0",
		description: toolDef.description,
		capabilities: [capability],
		inputSchema: toolDef.inputSchema,
		tags,
		source: { type: "tool", toolName: toolDef.name },
		updatedAt: new Date().toISOString(),
	};

	// Pre-compute the trait vector
	const vector = computeTraitVector(manifest);
	manifest.traitVector = Array.from(vector);

	return manifest;
}

/**
 * Generate skill manifests from an array of tool definitions.
 *
 * Convenience wrapper that calls {@link generateSkillFromTool} for each tool.
 *
 * @param tools - Array of tool definitions.
 * @returns Array of generated skill manifests.
 */
export function generateSkillsFromTools(
	tools: ToolDefinition[],
): SkillManifest[] {
	return tools.map(generateSkillFromTool);
}
