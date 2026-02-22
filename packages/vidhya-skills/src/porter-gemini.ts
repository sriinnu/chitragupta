/**
 * @module porter-gemini
 * @description Gemini CLI extension format converters for the Skill Porter.
 *
 * Handles bidirectional conversion between Gemini CLI's
 * gemini-extension.json manifest format and the vidhya SkillManifest format.
 *
 * @packageDocumentation
 */

import type {
	SkillManifest,
	SkillCapability,
	SkillSource,
} from "./types.js";
import { computeTraitVector } from "./fingerprint.js";
import type { GeminiExtensionData, GeminiMcpServer, GeminiTool } from "./porter-types.js";
import {
	inferVerbObject,
	generateTagsFromText,
	convertJsonSchemaToParams,
	convertParamsToJsonSchema,
	extractCommandFromDescription,
} from "./porter-utils.js";

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
