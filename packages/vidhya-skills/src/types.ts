/**
 * @module types
 * @description Type system for skill discovery in Chitragupta.
 *
 * Every skill is described by a {@link SkillManifest} — a compact, complete,
 * self-describing record, much like a Vedic sutra that encodes the essence
 * of a capability in minimal form.
 *
 * @packageDocumentation
 */

// ─── Skill Manifest ─────────────────────────────────────────────────────────

/**
 * A skill manifest — the complete description of a capability.
 * Like a Vedic sutra: compact, complete, and self-describing.
 *
 * The manifest captures everything needed to understand what a skill does,
 * how to invoke it, and how to match it against queries.
 */
export interface SkillManifest {
	/** Unique skill identifier (e.g., "file-reader", "code-analyzer"). */
	name: string;
	/** Semantic version (e.g., "1.0.0"). */
	version: string;
	/** Human-readable description of what this skill does. */
	description: string;
	/** Author or source attribution. */
	author?: string;
	/** Full markdown body (after frontmatter). Used for TVM fingerprinting. */
	body?: string;
	/** The capabilities this skill provides — each a verb/object pair. */
	capabilities: SkillCapability[];
	/** JSON Schema describing acceptable input. */
	inputSchema?: Record<string, unknown>;
	/** JSON Schema describing the output shape. */
	outputSchema?: Record<string, unknown>;
	/** Usage examples demonstrating typical invocations. */
	examples?: SkillExample[];
	/** Categorization tags for filtering and discovery. */
	tags: string[];
	/**
	 * Pre-computed 128-dimensional trait vector.
	 * Serialized as number[] from Float32Array for JSON compatibility.
	 * @see {@link computeTraitVector} in fingerprint.ts
	 */
	traitVector?: number[];
	/** Source of this skill — where it was discovered or defined. */
	source: SkillSource;
	/** Anti-patterns — things this skill should NOT be used for. */
	antiPatterns?: string[];
	/** ISO 8601 timestamp of the last update. */
	updatedAt: string;
}

// ─── Capability ─────────────────────────────────────────────────────────────

/**
 * A single capability provided by a skill.
 *
 * Expressed as a verb/object pair (e.g., "read"/"files") with optional
 * parameters. This decomposition enables precise matching against queries
 * that express intent in natural language.
 */
export interface SkillCapability {
	/** Verb describing the action (e.g., "read", "write", "analyze", "search"). */
	verb: string;
	/** Object of the action (e.g., "files", "code", "memory"). */
	object: string;
	/** Detailed description of this specific capability. */
	description: string;
	/** Parameters specific to this capability. */
	parameters?: Record<string, SkillParameter>;
}

/**
 * A typed parameter definition for a skill capability.
 */
export interface SkillParameter {
	/** The JSON type of this parameter. */
	type: "string" | "number" | "boolean" | "array" | "object";
	/** Human-readable description. */
	description: string;
	/** Whether this parameter is required. */
	required?: boolean;
	/** Default value when not provided. */
	default?: unknown;
}

// ─── Examples ───────────────────────────────────────────────────────────────

/**
 * A usage example for a skill, providing concrete input/output pairs.
 */
export interface SkillExample {
	/** Natural language description of the use case. */
	description: string;
	/** Example input as a key-value map. */
	input: Record<string, unknown>;
	/** Expected output pattern or description. */
	output?: string;
}

// ─── Source ─────────────────────────────────────────────────────────────────

/**
 * Discriminated union describing the origin of a skill manifest.
 *
 * - `tool`: Built-in or registered tool
 * - `mcp-server`: Tool from an MCP server connection
 * - `plugin`: From a Chitragupta plugin
 * - `manual`: Hand-authored skill.md file
 */
export type SkillSource =
	| { type: "tool"; toolName: string }
	| { type: "mcp-server"; serverId: string; serverName: string }
	| { type: "plugin"; pluginName: string }
	| { type: "manual"; filePath: string }
	| { type: "generated"; generator: string };

// ─── Query & Matching ───────────────────────────────────────────────────────

/**
 * A query to find matching skills in the registry.
 *
 * The `text` field is vectorized into a trait vector and compared
 * against all registered skills using cosine similarity.
 */
export interface SkillQuery {
	/** Natural language description of what capability is needed. */
	text: string;
	/** Optional tag filters — only return skills that have ALL these tags. */
	tags?: string[];
	/** Optional source type filter. */
	sourceType?: SkillSource["type"];
	/** Maximum number of results to return. Defaults to 5. */
	topK?: number;
	/** Minimum similarity threshold in [0, 1]. Defaults to 0.1. */
	threshold?: number;
}

/**
 * A matched skill with a relevance score and detailed breakdown.
 */
export interface SkillMatch {
	/** The matched skill manifest. */
	skill: SkillManifest;
	/** Overall match score in [0, 1]. */
	score: number;
	/** Breakdown of the score into component contributions. */
	breakdown: {
		/** Cosine similarity between trait vectors. */
		traitSimilarity: number;
		/** Boost from matching tags. */
		tagBoost: number;
		/** Boost from matching capability verbs. */
		capabilityMatch: number;
		/** Penalty from matching anti-patterns. */
		antiPatternPenalty: number;
	};
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Result of validating a skill manifest for completeness and correctness.
 */
export interface ValidationResult {
	/** Whether the manifest passed all required checks. */
	valid: boolean;
	/** Hard errors that must be fixed. */
	errors: ValidationError[];
	/** Soft warnings — suggestions for improvement. */
	warnings: ValidationWarning[];
}

/**
 * A validation error — a required field or invariant that is missing or broken.
 */
export interface ValidationError {
	/** Dot-path to the offending field (e.g., "capabilities.0.verb"). */
	field: string;
	/** Human-readable error message. */
	message: string;
}

/**
 * A validation warning — an optional improvement suggestion.
 */
export interface ValidationWarning {
	/** Dot-path to the relevant field. */
	field: string;
	/** Human-readable warning message. */
	message: string;
	/** Suggested fix or improvement. */
	suggestion?: string;
}
