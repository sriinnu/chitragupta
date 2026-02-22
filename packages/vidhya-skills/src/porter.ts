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

import type { SkillManifest } from "./types.js";
import { parseSkillMarkdown } from "./parser.js";
import { writeSkillMarkdown } from "./writer.js";

// Re-export types so consumers can import from porter.ts
export type {
	ClaudeSkillData,
	GeminiExtensionData,
	GeminiMcpServer,
	GeminiTool,
	SkillFormat,
} from "./porter-types.js";
import type { SkillFormat } from "./porter-types.js";

// Re-export format converters from sub-modules
export { importClaudeSkill, exportClaudeSkill } from "./porter-claude.js";
export { importGeminiExtension, exportGeminiExtension } from "./porter-gemini.js";

// Local imports for use in convert() and SkillPorter class
import { importClaudeSkill } from "./porter-claude.js";
import { importGeminiExtension } from "./porter-gemini.js";
import { exportClaudeSkill } from "./porter-claude.js";
import { exportGeminiExtension } from "./porter-gemini.js";

// ─── Setu: Format Detection ─────────────────────────────────────────────────

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


/**
 * Import a Claude Code SKILL.md into the vidhya SkillManifest format.
 *
 * @param markdown - Raw Claude SKILL.md content.
 * @returns A fully populated SkillManifest.
 */

/**
 * Export a vidhya SkillManifest to Claude Code SKILL.md format.
 *
 * @param skill - The vidhya skill manifest.
 * @returns A complete SKILL.md file content string.
 */

/**
 * Import a Gemini CLI extension manifest into vidhya SkillManifest format.
 *
 * @param json - Raw gemini-extension.json content.
 * @returns A fully populated SkillManifest.
 */

/**
 * Export a vidhya SkillManifest to Gemini CLI extension manifest JSON.
 *
 * @param skill - The vidhya skill manifest.
 * @returns A JSON string (gemini-extension.json content).
 */

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

