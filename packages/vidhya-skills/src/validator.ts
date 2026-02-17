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

// ─── Patterns ───────────────────────────────────────────────────────────────

/** Pattern for a valid semantic version string (major.minor or major.minor.patch). */
const SEMVER_PATTERN = /^\d+\.\d+(\.\d+)?$/;

/** Valid skill name: lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens, max 64 chars. */
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const NAME_MAX_LENGTH = 64;

/** Max description length per spec. */
const DESCRIPTION_MAX_LENGTH = 1024;

/** Valid Kula tier values. */
const VALID_KULA = ["antara", "bahya", "shiksha"] as const;

/** Max tag length. */
const TAG_MAX_LENGTH = 32;

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
	} else if (manifest.name.length > NAME_MAX_LENGTH) {
		errors.push({ field: "name", message: `name must be at most ${NAME_MAX_LENGTH} characters (got ${manifest.name.length})` });
	} else if (!NAME_PATTERN.test(manifest.name)) {
		errors.push({ field: "name", message: "name must be lowercase alphanumeric with hyphens, no leading/trailing hyphens" });
	} else if (manifest.name.includes("--")) {
		errors.push({ field: "name", message: "name must not contain consecutive hyphens (--)" });
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
	} else if (manifest.description.length > DESCRIPTION_MAX_LENGTH) {
		errors.push({
			field: "description",
			message: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters (got ${manifest.description.length})`,
		});
	} else if (manifest.description.trim().length < 30) {
		warnings.push({
			field: "description",
			message: "description is very short (< 30 characters)",
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
		const validTypes = ["tool", "mcp-server", "plugin", "manual", "generated"];
		if (!validTypes.includes(manifest.source.type)) {
			errors.push({
				field: "source.type",
				message: `source.type must be one of: ${validTypes.join(", ")} (got "${manifest.source.type}")`,
			});
		}
	}

	// ── Optional: kula tier ──
	const enhanced = manifest as unknown as Record<string, unknown>;
	if (enhanced.kula !== undefined) {
		if (!VALID_KULA.includes(enhanced.kula as typeof VALID_KULA[number])) {
			errors.push({
				field: "kula",
				message: `kula must be one of: ${VALID_KULA.join(", ")} (got "${enhanced.kula}")`,
			});
		}
	}

	// ── Optional: requirements shape ──
	if (enhanced.requirements !== undefined && typeof enhanced.requirements === "object" && enhanced.requirements !== null) {
		const req = enhanced.requirements as Record<string, unknown>;
		if (req.bins !== undefined && !Array.isArray(req.bins)) {
			errors.push({ field: "requirements.bins", message: "requirements.bins must be an array of strings" });
		}
		if (req.env !== undefined && !Array.isArray(req.env)) {
			errors.push({ field: "requirements.env", message: "requirements.env must be an array of strings" });
		}
		if (req.os !== undefined && !Array.isArray(req.os)) {
			errors.push({ field: "requirements.os", message: "requirements.os must be an array of strings" });
		}
		if (req.network !== undefined && typeof req.network !== "boolean") {
			errors.push({ field: "requirements.network", message: "requirements.network must be a boolean" });
		}
		if (req.privilege !== undefined && typeof req.privilege !== "boolean") {
			errors.push({ field: "requirements.privilege", message: "requirements.privilege must be a boolean" });
		}
	}

	// ── Tag format validation ──
	if (Array.isArray(manifest.tags)) {
		for (const tag of manifest.tags) {
			if (typeof tag === "string" && tag.length > TAG_MAX_LENGTH) {
				warnings.push({
					field: "tags",
					message: `tag "${tag}" exceeds ${TAG_MAX_LENGTH} characters`,
					suggestion: "Shorten tag names for consistency",
				});
			}
		}
	}

	// ── Optional: granular permissions ──
	if (enhanced.permissions !== undefined && typeof enhanced.permissions === "object" && enhanced.permissions !== null) {
		const perms = enhanced.permissions as Record<string, unknown>;
		// Network policy
		if (perms.networkPolicy !== undefined && typeof perms.networkPolicy === "object" && perms.networkPolicy !== null) {
			const np = perms.networkPolicy as Record<string, unknown>;
			if (!Array.isArray(np.allowlist)) {
				errors.push({ field: "permissions.networkPolicy.allowlist", message: "networkPolicy.allowlist must be an array of strings" });
			}
			if (np.denylist !== undefined && !Array.isArray(np.denylist)) {
				errors.push({ field: "permissions.networkPolicy.denylist", message: "networkPolicy.denylist must be an array of strings" });
			}
			if (np.timeoutMs !== undefined && typeof np.timeoutMs !== "number") {
				errors.push({ field: "permissions.networkPolicy.timeoutMs", message: "networkPolicy.timeoutMs must be a number" });
			}
		}
		// Secrets
		if (perms.secrets !== undefined && !Array.isArray(perms.secrets)) {
			errors.push({ field: "permissions.secrets", message: "permissions.secrets must be an array of strings" });
		}
		// PII policy
		const validPii = ["no_persist", "minimize", "explicit_only"];
		if (perms.piiPolicy !== undefined && !validPii.includes(perms.piiPolicy as string)) {
			errors.push({ field: "permissions.piiPolicy", message: `permissions.piiPolicy must be one of: ${validPii.join(", ")}` });
		}
		// Filesystem scope
		if (perms.filesystem !== undefined && typeof perms.filesystem === "object" && perms.filesystem !== null) {
			const fs = perms.filesystem as Record<string, unknown>;
			const validScopes = ["none", "skill_dir", "staging_dir"];
			if (!validScopes.includes(fs.scope as string)) {
				errors.push({ field: "permissions.filesystem.scope", message: `filesystem.scope must be one of: ${validScopes.join(", ")}` });
			}
		}
	}

	// ── Optional: approach ladder ──
	if (enhanced.approachLadder !== undefined) {
		if (!Array.isArray(enhanced.approachLadder)) {
			errors.push({ field: "approachLadder", message: "approachLadder must be an array" });
		} else {
			const ladder = enhanced.approachLadder as Array<Record<string, unknown>>;
			const validStatuses = ["preferred", "fallback", "blocked"];
			for (let i = 0; i < ladder.length; i++) {
				const entry = ladder[i];
				if (!entry.name || typeof entry.name !== "string") {
					errors.push({ field: `approachLadder[${i}].name`, message: "each approach must have a name" });
				}
				if (!validStatuses.includes(entry.status as string)) {
					errors.push({ field: `approachLadder[${i}].status`, message: `status must be one of: ${validStatuses.join(", ")}` });
				}
				if (!entry.why || typeof entry.why !== "string") {
					errors.push({ field: `approachLadder[${i}].why`, message: "each approach must have a why explanation" });
				}
			}
		}
	}

	// ── Optional: eval cases ──
	if (enhanced.evalCases !== undefined) {
		if (!Array.isArray(enhanced.evalCases)) {
			errors.push({ field: "evalCases", message: "evalCases must be an array" });
		} else {
			const cases = enhanced.evalCases as Array<Record<string, unknown>>;
			const validTypes = ["golden", "adversarial"];
			for (let i = 0; i < cases.length; i++) {
				const ec = cases[i];
				if (!ec.id || typeof ec.id !== "string") {
					errors.push({ field: `evalCases[${i}].id`, message: "each eval case must have an id" });
				}
				if (!ec.input || typeof ec.input !== "object") {
					errors.push({ field: `evalCases[${i}].input`, message: "each eval case must have an input object" });
				}
				if (ec.type !== undefined && !validTypes.includes(ec.type as string)) {
					errors.push({ field: `evalCases[${i}].type`, message: `eval case type must be "golden" or "adversarial"` });
				}
			}
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

	// Tags minimum count
	if (Array.isArray(manifest.tags) && manifest.tags.length > 0 && manifest.tags.length < 3) {
		warnings.push({
			field: "tags",
			message: `only ${manifest.tags.length} tag(s) — recommend at least 3`,
			suggestion: "Add more tags for better discovery",
		});
	}

	// whenToUse recommendation
	if (!enhanced.whenToUse || (Array.isArray(enhanced.whenToUse) && (enhanced.whenToUse as unknown[]).length === 0)) {
		warnings.push({
			field: "whenToUse",
			message: "no whenToUse triggers defined",
			suggestion: "Add whenToUse conditions in frontmatter or as a ## When To Use section",
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
