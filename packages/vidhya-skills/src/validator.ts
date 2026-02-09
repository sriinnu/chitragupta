/**
 * @module validator
 * @description Validate skill manifests for completeness and correctness.
 *
 * Checks required fields, structural invariants, and provides warnings
 * for optional improvements. Like a Vedic priest checking the correctness
 * of a mantra before recitation — errors prevent execution, warnings
 * suggest refinement.
 *
 * @packageDocumentation
 */

import { parseSkillMarkdown } from "./parser.js";
import type {
	SkillManifest,
	ValidationError,
	ValidationResult,
	ValidationWarning,
} from "./types.js";

// ─── Semantic Version Pattern ───────────────────────────────────────────────

/** Pattern for a valid semantic version string (major.minor.patch). */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Validate a skill manifest for completeness and correctness.
 *
 * ## Required Fields (produce errors)
 * - `name`: non-empty string
 * - `version`: valid semver
 * - `description`: non-empty string
 * - `capabilities`: non-empty array, each with verb + object
 * - `tags`: non-empty array
 * - `source`: valid discriminated union
 *
 * ## Optional Checks (produce warnings)
 * - Missing examples
 * - Empty anti-patterns
 * - Missing inputSchema
 * - Very short description (< 10 chars)
 * - Missing author
 * - Duplicate tags
 * - Capability without description
 *
 * @param manifest - The skill manifest to validate.
 * @returns A {@link ValidationResult} with errors and warnings.
 *
 * @example
 * ```ts
 * const result = validateSkill(myManifest);
 * if (!result.valid) {
 *   for (const err of result.errors) {
 *     console.error(`${err.field}: ${err.message}`);
 *   }
 * }
 * ```
 */
export function validateSkill(manifest: SkillManifest): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// ── Required: name ──
	if (!manifest.name || typeof manifest.name !== "string") {
		errors.push({ field: "name", message: "name is required and must be a non-empty string" });
	} else if (manifest.name.trim().length === 0) {
		errors.push({ field: "name", message: "name must not be empty or whitespace-only" });
	}

	// ── Required: version ──
	if (!manifest.version || typeof manifest.version !== "string") {
		errors.push({ field: "version", message: "version is required and must be a string" });
	} else if (!SEMVER_PATTERN.test(manifest.version)) {
		errors.push({
			field: "version",
			message: `version must be a valid semver (got "${manifest.version}")`,
		});
	}

	// ── Required: description ──
	if (!manifest.description || typeof manifest.description !== "string") {
		errors.push({
			field: "description",
			message: "description is required and must be a non-empty string",
		});
	} else if (manifest.description.trim().length === 0) {
		errors.push({
			field: "description",
			message: "description must not be empty or whitespace-only",
		});
	} else if (manifest.description.trim().length < 10) {
		warnings.push({
			field: "description",
			message: "description is very short (< 10 characters)",
			suggestion: "Provide a more detailed description for better matching",
		});
	}

	// ── Required: capabilities ──
	if (!Array.isArray(manifest.capabilities)) {
		errors.push({
			field: "capabilities",
			message: "capabilities must be an array",
		});
	} else if (manifest.capabilities.length === 0) {
		errors.push({
			field: "capabilities",
			message: "capabilities must contain at least one capability",
		});
	} else {
		for (let i = 0; i < manifest.capabilities.length; i++) {
			const cap = manifest.capabilities[i];
			const prefix = `capabilities.${i}`;

			if (!cap.verb || typeof cap.verb !== "string" || cap.verb.trim().length === 0) {
				errors.push({
					field: `${prefix}.verb`,
					message: "each capability must have a non-empty verb",
				});
			}

			if (!cap.object || typeof cap.object !== "string" || cap.object.trim().length === 0) {
				errors.push({
					field: `${prefix}.object`,
					message: "each capability must have a non-empty object",
				});
			}

			if (!cap.description || cap.description.trim().length === 0) {
				warnings.push({
					field: `${prefix}.description`,
					message: "capability has no description",
					suggestion: "Add a description explaining what this capability does",
				});
			}
		}
	}

	// ── Required: tags ──
	if (!Array.isArray(manifest.tags)) {
		errors.push({ field: "tags", message: "tags must be an array" });
	} else if (manifest.tags.length === 0) {
		errors.push({
			field: "tags",
			message: "tags must contain at least one tag",
		});
	} else {
		// Check for duplicate tags
		const seen = new Set<string>();
		for (const tag of manifest.tags) {
			const normalized = tag.toLowerCase();
			if (seen.has(normalized)) {
				warnings.push({
					field: "tags",
					message: `duplicate tag "${tag}"`,
					suggestion: "Remove duplicate tags",
				});
			}
			seen.add(normalized);
		}
	}

	// ── Required: source ──
	if (!manifest.source || typeof manifest.source !== "object") {
		errors.push({ field: "source", message: "source is required" });
	} else {
		const validTypes = ["tool", "mcp-server", "plugin", "manual"];
		if (!validTypes.includes(manifest.source.type)) {
			errors.push({
				field: "source.type",
				message: `source.type must be one of: ${validTypes.join(", ")} (got "${manifest.source.type}")`,
			});
		}
	}

	// ── Warnings: optional improvements ──
	if (!manifest.examples || manifest.examples.length === 0) {
		warnings.push({
			field: "examples",
			message: "no usage examples provided",
			suggestion: "Add examples to improve discovery accuracy",
		});
	}

	if (!manifest.inputSchema) {
		warnings.push({
			field: "inputSchema",
			message: "no input schema defined",
			suggestion: "Define an inputSchema (JSON Schema) for better parameter matching",
		});
	}

	if (!manifest.author) {
		warnings.push({
			field: "author",
			message: "no author specified",
			suggestion: "Add an author field for attribution",
		});
	}

	if (manifest.antiPatterns && manifest.antiPatterns.length === 0) {
		warnings.push({
			field: "antiPatterns",
			message: "antiPatterns is present but empty",
			suggestion: "Either add anti-patterns or remove the field",
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Parse a skill.md string and then validate the resulting manifest.
 *
 * Convenience function that combines parsing and validation in one step.
 * Parse errors are returned as validation errors.
 *
 * @param content - The raw skill.md file content.
 * @returns A {@link ValidationResult} covering both parse and validation errors.
 */
export function validateSkillMarkdown(content: string): ValidationResult {
	try {
		const manifest = parseSkillMarkdown(content);
		return validateSkill(manifest);
	} catch (err) {
		return {
			valid: false,
			errors: [
				{
					field: "parse",
					message:
						err instanceof Error
							? err.message
							: "Failed to parse skill.md",
				},
			],
			warnings: [],
		};
	}
}
