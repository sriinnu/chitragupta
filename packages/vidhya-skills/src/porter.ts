/**
 * @module porter
 * @description Setu (सेतु) — The Skill Porter: bidirectional bridge between
 * Chitragupta's vidhya skill format and external skill ecosystems.
 *
 * "Setu" means bridge in Sanskrit, from the same root that gives us the
 * mythical bridge to Lanka. This module builds bridges between skill worlds:
 *
 * - **Claude Code**: SKILL.md format (YAML frontmatter + markdown instructions)
 * - **Gemini CLI**: gemini-extension.json manifest (JSON with MCP server defs)
 * - **Vidhya**: skill.md format (YAML frontmatter + structured capabilities)
 *
 * ## Design Principles
 *
 * 1. **Lossless where possible**: Round-trip conversion preserves all fields
 *    that have equivalents in both formats. Unmappable fields are stored in
 *    metadata so they survive re-export.
 *
 * 2. **Intelligent defaults**: Missing fields are inferred rather than left
 *    empty. A Claude skill with no explicit tags gets tags derived from its
 *    description. A Gemini extension with no version gets "1.0.0".
 *
 * 3. **Format detection**: The {@link SkillPorter.detectFormat} method uses
 *    structural heuristics — not file extensions — to identify input format.
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
import { computeTraitVector } from "./fingerprint.js";
import { parseSkillMarkdown } from "./parser.js";
import { writeSkillMarkdown } from "./writer.js";

// ─── Claude SKILL.md Types ──────────────────────────────────────────────────

/**
 * Parsed representation of a Claude Code SKILL.md file.
 * Fields mirror the Agent Skills open standard frontmatter.
 */
export interface ClaudeSkillData {
	/** Skill name (becomes the /slash-command). */
	name: string;
	/** What the skill does and when to use it. */
	description: string;
	/** Prevent Claude from auto-invoking this skill. */
	disableModelInvocation?: boolean;
	/** Hide from the / menu. */
	userInvocable?: boolean;
	/** Tools Claude can use without approval. */
	allowedTools?: string[];
	/** Model to use when skill is active. */
	model?: string;
	/** Run in a forked subagent context. */
	context?: "fork";
	/** Subagent type when context is fork. */
	agent?: string;
	/** Hint for autocomplete arguments. */
	argumentHint?: string;
	/** The markdown body (instructions). */
	body: string;
}

// ─── Gemini Extension Types ─────────────────────────────────────────────────

/**
 * A Gemini CLI extension manifest (gemini-extension.json).
 */
export interface GeminiExtensionData {
	/** Unique extension identifier. */
	name: string;
	/** Semantic version. */
	version: string;
	/** Human-readable description. */
	description?: string;
	/** MCP server definitions keyed by server name. */
	mcpServers?: Record<string, GeminiMcpServer>;
	/** Context file name (defaults to GEMINI.md). */
	contextFileName?: string;
	/** Tools to exclude from the model. */
	excludeTools?: string[];
	/** Inline tool definitions (extended format for porter). */
	tools?: GeminiTool[];
}

/**
 * An MCP server definition within a Gemini extension.
 */
export interface GeminiMcpServer {
	/** Command to spawn the server. */
	command: string;
	/** Arguments for the command. */
	args?: string[];
	/** Working directory. */
	cwd?: string;
}

/**
 * An inline tool definition for Gemini extensions.
 * Used when converting vidhya capabilities to Gemini format.
 */
export interface GeminiTool {
	/** Tool name. */
	name: string;
	/** Tool description. */
	description: string;
	/** JSON Schema for tool parameters. */
	parameters?: Record<string, unknown>;
}

// ─── Setu: Format Detection ─────────────────────────────────────────────────

/** Recognized skill format identifiers. */
export type SkillFormat = "vidhya" | "claude" | "gemini" | "unknown";

/**
 * Heuristic format detection using structural signatures.
 *
 * Detection strategy (ordered by specificity):
 *
 * 1. **Gemini**: Valid JSON with a `name` field and either `mcpServers`,
 *    `excludeTools`, or `contextFileName` present.
 *
 * 2. **Vidhya**: YAML frontmatter with `---` delimiters containing
 *    `capabilities` or `tags` or `traitVector` fields, plus a
 *    `## Capabilities` section in the body.
 *
 * 3. **Claude**: YAML frontmatter with `---` delimiters containing a
 *    `description` field but no `## Capabilities` structured section.
 *    May have `disable-model-invocation` or `allowed-tools` fields.
 *
 * 4. **Unknown**: None of the above patterns match.
 *
 * @param content - The raw file content to analyze.
 * @returns The detected format identifier.
 */
export function detectFormat(content: string): SkillFormat {
	const trimmed = content.trim();

	// ── Gemini: JSON with extension-specific fields ──
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				typeof parsed.name === "string" &&
				(parsed.mcpServers !== undefined ||
					parsed.excludeTools !== undefined ||
					parsed.contextFileName !== undefined ||
					parsed.tools !== undefined)
			) {
				return "gemini";
			}
		} catch {
			// Not valid JSON — fall through
		}
	}

	// ── Markdown with frontmatter ──
	const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
	if (fmMatch) {
		const frontmatter = fmMatch[1];
		const body = trimmed.slice(fmMatch[0].length);

		// Vidhya: has structured capability/tag/traitVector fields + ## Capabilities
		const hasVidhyaFields =
			/^(capabilities|traitVector|antiPatterns)\s*:/m.test(frontmatter);
		const hasCapabilitiesSection = /^##\s+Capabilities/m.test(body);

		if (hasVidhyaFields || hasCapabilitiesSection) {
			return "vidhya";
		}

		// Claude: has description or claude-specific frontmatter fields
		const hasClaudeFields =
			/^(disable-model-invocation|disableModelInvocation|allowed-tools|allowedTools|user-invocable|userInvocable|argument-hint|argumentHint)\s*:/m.test(frontmatter);
		const hasDescription = /^description\s*:/m.test(frontmatter);

		if (hasClaudeFields || hasDescription) {
			return "claude";
		}

		// Generic frontmatter markdown — default to claude (simpler format)
		if (/^name\s*:/m.test(frontmatter)) {
			return "claude";
		}
	}

	return "unknown";
}

// ─── Setu: Claude SKILL.md ← → Vidhya ──────────────────────────────────────

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

// ─── Setu: Gemini Extension ← → Vidhya ─────────────────────────────────────

/**
 * Parse a Gemini CLI extension manifest JSON string.
 *
 * @param json - Raw gemini-extension.json content.
 * @returns Parsed Gemini extension data.
 * @throws If the JSON is invalid or missing required fields.
 */
function parseGeminiExtension(json: string): GeminiExtensionData {
	const parsed = JSON.parse(json);

	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid Gemini extension: expected a JSON object");
	}

	if (typeof parsed.name !== "string" || parsed.name === "") {
		throw new Error("Invalid Gemini extension: missing 'name' field");
	}

	return {
		name: parsed.name,
		version: typeof parsed.version === "string" ? parsed.version : "1.0.0",
		description: typeof parsed.description === "string" ? parsed.description : undefined,
		mcpServers: parsed.mcpServers as Record<string, GeminiMcpServer> | undefined,
		contextFileName: typeof parsed.contextFileName === "string"
			? parsed.contextFileName
			: undefined,
		excludeTools: Array.isArray(parsed.excludeTools) ? parsed.excludeTools : undefined,
		tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
	};
}

/**
 * Import a Gemini CLI extension manifest into vidhya {@link SkillManifest} format.
 *
 * Mapping strategy:
 * - `name` → `name`
 * - `version` → `version`
 * - `description` → `description` (or generated from name)
 * - `mcpServers` → capabilities with verb="serve", source type="mcp-server"
 * - `tools` → capabilities with extracted verb/object
 * - `excludeTools` → antiPatterns
 * - Tags generated from name, description, and tool names
 *
 * @param json - Raw gemini-extension.json content.
 * @returns A fully populated SkillManifest.
 */
export function importGeminiExtension(json: string): SkillManifest {
	const gemini = parseGeminiExtension(json);

	const capabilities: SkillCapability[] = [];

	// Map MCP servers to capabilities
	if (gemini.mcpServers) {
		for (const [serverName, server] of Object.entries(gemini.mcpServers)) {
			capabilities.push({
				verb: "serve",
				object: serverName,
				description: `MCP server: ${server.command}${server.args ? " " + server.args.join(" ") : ""}`,
				parameters: {
					command: {
						type: "string",
						description: "Server spawn command",
						required: true,
					},
					...(server.cwd
						? {
							cwd: {
								type: "string",
								description: "Working directory for the server",
							},
						}
						: {}),
				},
			});
		}
	}

	// Map inline tools to capabilities
	if (gemini.tools) {
		for (const tool of gemini.tools) {
			const { verb, object } = inferVerbObject(tool.description || tool.name);
			capabilities.push({
				verb,
				object,
				description: tool.description,
				parameters: tool.parameters
					? convertJsonSchemaToParams(tool.parameters)
					: undefined,
			});
		}
	}

	// If no capabilities, create a generic one
	if (capabilities.length === 0) {
		capabilities.push({
			verb: "extend",
			object: gemini.name,
			description: gemini.description ?? `Gemini CLI extension: ${gemini.name}`,
		});
	}

	// Map excludeTools to antiPatterns
	const antiPatterns = gemini.excludeTools
		? gemini.excludeTools.map((t) => `Do not use the ${t} tool`)
		: undefined;

	// Determine source
	const source: SkillSource = gemini.mcpServers
		? {
			type: "mcp-server",
			serverId: gemini.name,
			serverName: Object.keys(gemini.mcpServers)[0] ?? gemini.name,
		}
		: { type: "manual", filePath: `gemini://extensions/${gemini.name}` };

	// Generate tags
	const tags = generateTagsFromText(
		gemini.description ?? gemini.name,
		gemini.name,
	);
	if (gemini.mcpServers) tags.push("mcp");
	if (gemini.tools) tags.push("tools");

	const description = gemini.description ?? `Gemini CLI extension: ${gemini.name}`;

	const manifest: SkillManifest = {
		name: gemini.name,
		version: gemini.version,
		description,
		capabilities,
		tags: [...new Set(tags)],
		source,
		antiPatterns,
		updatedAt: new Date().toISOString(),
	};

	// Compute trait vector
	const vector = computeTraitVector(manifest);
	manifest.traitVector = Array.from(vector);

	return manifest;
}

/**
 * Export a vidhya {@link SkillManifest} to Gemini CLI extension manifest JSON.
 *
 * Produces a valid gemini-extension.json. Capabilities with verb="serve"
 * are mapped to mcpServers entries. Other capabilities become inline tools.
 *
 * @param skill - The vidhya skill manifest.
 * @returns A JSON string (gemini-extension.json content).
 */
export function exportGeminiExtension(skill: SkillManifest): string {
	const extension: GeminiExtensionData = {
		name: skill.name,
		version: skill.version,
		description: skill.description,
	};

	// Map "serve" capabilities to MCP servers
	const serveCaps = skill.capabilities.filter((c) => c.verb === "serve");
	if (serveCaps.length > 0) {
		extension.mcpServers = {};
		for (const cap of serveCaps) {
			const command = cap.parameters?.command?.default as string
				?? extractCommandFromDescription(cap.description);
			extension.mcpServers[cap.object] = {
				command: command || "node",
				args: [],
				cwd: cap.parameters?.cwd?.default as string ?? undefined,
			};
		}
	}

	// Map non-"serve" capabilities to inline tools
	const toolCaps = skill.capabilities.filter((c) => c.verb !== "serve");
	if (toolCaps.length > 0) {
		extension.tools = toolCaps.map((cap) => ({
			name: `${cap.verb}_${cap.object}`.replace(/\s+/g, "_"),
			description: cap.description,
			parameters: cap.parameters
				? convertParamsToJsonSchema(cap.parameters)
				: undefined,
		}));
	}

	// Map antiPatterns to excludeTools where applicable
	if (skill.antiPatterns) {
		const toolPattern = /^Do not use the (\w+) tool$/;
		const excludeTools = skill.antiPatterns
			.map((ap) => ap.match(toolPattern)?.[1])
			.filter((t): t is string => t !== undefined);
		if (excludeTools.length > 0) {
			extension.excludeTools = excludeTools;
		}
	}

	return JSON.stringify(extension, null, "\t");
}

// ─── Setu: Universal Convert ────────────────────────────────────────────────

/**
 * Auto-detect the source format and convert to the target format.
 *
 * This is the one-call bridge: give it any skill content and a target,
 * and it handles detection, parsing, and serialization.
 *
 * @param content - Raw skill content (markdown or JSON).
 * @param targetFormat - The desired output format.
 * @returns The converted skill content as a string.
 * @throws If the source format cannot be detected or conversion fails.
 */
export function convert(
	content: string,
	targetFormat: SkillFormat,
): string {
	const sourceFormat = detectFormat(content);

	if (sourceFormat === "unknown") {
		throw new Error(
			"Setu: cannot detect source format. " +
			"Expected vidhya skill.md, Claude SKILL.md, or Gemini gemini-extension.json.",
		);
	}

	if (sourceFormat === targetFormat) {
		return content; // No-op: already in target format
	}

	// Parse source into vidhya manifest (the lingua franca)
	let manifest: SkillManifest;
	switch (sourceFormat) {
		case "vidhya":
			manifest = parseSkillMarkdown(content);
			break;
		case "claude":
			manifest = importClaudeSkill(content);
			break;
		case "gemini":
			manifest = importGeminiExtension(content);
			break;
		default:
			throw new Error(`Setu: unsupported source format '${sourceFormat}'`);
	}

	// Serialize to target format
	switch (targetFormat) {
		case "vidhya":
			return writeSkillMarkdown(manifest);
		case "claude":
			return exportClaudeSkill(manifest);
		case "gemini":
			return exportGeminiExtension(manifest);
		default:
			throw new Error(`Setu: unsupported target format '${targetFormat}'`);
	}
}

// ─── Setu: SkillPorter Class ────────────────────────────────────────────────

/**
 * The Skill Porter — bidirectional converter between vidhya, Claude, and
 * Gemini skill formats.
 *
 * Provides both low-level import/export methods and a high-level
 * {@link convert} method that auto-detects the source format.
 *
 * Named "Setu" (सेतु) — Sanskrit for bridge — this class builds
 * passages between skill ecosystems.
 *
 * @example
 * ```ts
 * const porter = new SkillPorter();
 *
 * // Import a Claude skill
 * const vidhya = porter.importClaudeSkill(claudeMarkdown);
 *
 * // Export to Gemini format
 * const geminiJson = porter.exportGeminiExtension(vidhya);
 *
 * // Auto-detect and convert
 * const result = porter.convert(unknownContent, "vidhya");
 * ```
 */
export class SkillPorter {
	/** Optional scanner for safe import methods. */
	private scanner?: import("./suraksha.js").SurakshaScanner;

	/**
	 * Set a Suraksha scanner for safe import methods.
	 * When set, `importClaudeSkillSafe()` and `importGeminiExtensionSafe()`
	 * will scan content before importing.
	 */
	setScanner(scanner: import("./suraksha.js").SurakshaScanner): void {
		this.scanner = scanner;
	}

	/** Detect the format of raw skill content. */
	detectFormat(content: string): SkillFormat {
		return detectFormat(content);
	}

	/** Import a Claude SKILL.md into vidhya format. */
	importClaudeSkill(markdown: string): SkillManifest {
		return importClaudeSkill(markdown);
	}

	/**
	 * Import a Claude SKILL.md with security scanning.
	 * Throws if the scan verdict is "malicious".
	 * Requires a scanner to be set via `setScanner()`.
	 */
	importClaudeSkillSafe(markdown: string): { manifest: SkillManifest; scanResult: import("./suraksha.js").SurakshaScanResult } {
		if (!this.scanner) {
			throw new Error("Scanner not set. Call setScanner() first.");
		}
		const manifest = importClaudeSkill(markdown);
		const scanResult = this.scanner.scan(manifest.name, markdown);
		if (scanResult.verdict === "malicious") {
			throw new Error(`Skill "${manifest.name}" blocked: ${scanResult.verdict} (risk: ${scanResult.riskScore.toFixed(2)})`);
		}
		return { manifest, scanResult };
	}

	/** Export a vidhya skill to Claude SKILL.md format. */
	exportClaudeSkill(skill: SkillManifest): string {
		return exportClaudeSkill(skill);
	}

	/** Import a Gemini extension manifest into vidhya format. */
	importGeminiExtension(json: string): SkillManifest {
		return importGeminiExtension(json);
	}

	/**
	 * Import a Gemini extension with security scanning.
	 * Throws if the scan verdict is "malicious".
	 * Requires a scanner to be set via `setScanner()`.
	 */
	importGeminiExtensionSafe(json: string): { manifest: SkillManifest; scanResult: import("./suraksha.js").SurakshaScanResult } {
		if (!this.scanner) {
			throw new Error("Scanner not set. Call setScanner() first.");
		}
		const manifest = importGeminiExtension(json);
		const scanResult = this.scanner.scan(manifest.name, json);
		if (scanResult.verdict === "malicious") {
			throw new Error(`Extension "${manifest.name}" blocked: ${scanResult.verdict} (risk: ${scanResult.riskScore.toFixed(2)})`);
		}
		return { manifest, scanResult };
	}

	/** Export a vidhya skill to Gemini extension manifest JSON. */
	exportGeminiExtension(skill: SkillManifest): string {
		return exportGeminiExtension(skill);
	}

	/** Auto-detect source format and convert to target. */
	convert(content: string, targetFormat: SkillFormat): string {
		return convert(content, targetFormat);
	}
}

// ─── Internal Utilities ─────────────────────────────────────────────────────

/**
 * Simple YAML frontmatter parser (flat key-value only).
 * Claude SKILL.md uses simple frontmatter — no nested objects needed.
 */
function parseFrontmatterSimple(raw: string): Record<string, unknown> {
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
function parseSimpleValue(raw: string): unknown {
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
function slugify(text: string): string {
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
function extractNumberedSteps(body: string): string[] {
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
function extractExamplesFromBody(body: string): SkillExample[] {
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
function inferVerbObject(text: string): { verb: string; object: string } {
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
function generateTagsFromText(description: string, name: string): string[] {
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
function convertJsonSchemaToParams(
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
function convertParamsToJsonSchema(
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
function mapType(type: string | undefined): SkillParameter["type"] {
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
function extractCommandFromDescription(description: string): string {
	const match = description.match(/(?:command|cmd|run|spawn)[\s:]+(\S+)/i)
		?? description.match(/`([^`]+)`/)
		?? description.match(/MCP server:\s*(\S+)/);
	return match?.[1] ?? "node";
}

/**
 * Safely coerce a value to string or return undefined.
 */
function asString(value: unknown): string | undefined {
	if (typeof value === "string" && value !== "") return value;
	return undefined;
}

/**
 * Safely coerce a value to boolean or return undefined.
 */
function asBool(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

/**
 * Capitalize the first letter of a string.
 */
function capitalizeFirst(str: string): string {
	if (str.length === 0) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}
