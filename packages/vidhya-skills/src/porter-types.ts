/**
 * @module porter-types
 * @description Shared type definitions for the Skill Porter (Setu) modules.
 *
 * Contains interfaces for Claude SKILL.md, Gemini extension, and
 * format detection types used across porter sub-modules.
 *
 * @packageDocumentation
 */

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

// ─── Format Detection Types ─────────────────────────────────────────────────

/** Recognized skill format identifiers. */
export type SkillFormat = "vidhya" | "claude" | "gemini" | "unknown";
