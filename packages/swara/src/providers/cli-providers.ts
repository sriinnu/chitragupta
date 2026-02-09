/**
 * @chitragupta/swara — Concrete CLI provider definitions.
 *
 * Wraps popular AI CLI tools as ProviderDefinitions using the CLI factory.
 * Each provider translates our unified Context into CLI arguments, spawns
 * the command, and yields a standard stream event sequence.
 *
 * Supported CLIs:
 *   - Claude Code (claude --print)
 *   - Codex (codex --quiet)
 *   - Gemini CLI (gemini --prompt)
 *   - Aider (aider --message)
 *
 * All pricing is zero — CLI tools use their own auth/billing.
 */

import type { Context, ModelDefinition, ProviderDefinition } from "../types.js";
import { createCLIProvider } from "./cli-base.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the last user message text from a Context.
 *
 * Walks the message list in reverse to find the most recent user turn,
 * concatenates all text content parts, and returns the result. Falls
 * back to an empty string if no user message is found.
 */
export function contextToPrompt(context: Context): string {
	// Walk backwards to find the latest user message
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg.role === "user") {
			const parts: string[] = [];
			for (const part of msg.content) {
				if (part.type === "text") {
					parts.push(part.text);
				}
			}
			if (parts.length > 0) {
				return parts.join("\n");
			}
		}
	}
	return "";
}

/**
 * Build a combined prompt that includes the system prompt (if any)
 * and the last user message, separated by a double newline.
 */
function buildFullPrompt(context: Context): string {
	const userText = contextToPrompt(context);
	if (context.systemPrompt) {
		return `${context.systemPrompt}\n\n${userText}`;
	}
	return userText;
}

// ─── Model Definitions ──────────────────────────────────────────────────────

const CLAUDE_CODE_MODELS: ModelDefinition[] = [
	{
		id: "claude-code",
		name: "Claude Code CLI",
		contextWindow: 200_000,
		maxOutputTokens: 16_384,
		pricing: { input: 0, output: 0 },
		capabilities: {
			vision: false,
			thinking: true,
			toolUse: true,
			streaming: false,
		},
	},
];

const CODEX_MODELS: ModelDefinition[] = [
	{
		id: "codex-cli",
		name: "Codex CLI",
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		pricing: { input: 0, output: 0 },
		capabilities: {
			vision: false,
			thinking: false,
			toolUse: true,
			streaming: false,
		},
	},
];

const GEMINI_CLI_MODELS: ModelDefinition[] = [
	{
		id: "gemini-cli",
		name: "Gemini CLI",
		contextWindow: 1_000_000,
		maxOutputTokens: 65_536,
		pricing: { input: 0, output: 0 },
		capabilities: {
			vision: true,
			thinking: true,
			toolUse: true,
			streaming: false,
		},
	},
];

const AIDER_MODELS: ModelDefinition[] = [
	{
		id: "aider-cli",
		name: "Aider CLI",
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		pricing: { input: 0, output: 0 },
		capabilities: {
			vision: false,
			thinking: false,
			toolUse: false,
			streaming: false,
		},
	},
];

// ─── Claude Code Provider ───────────────────────────────────────────────────

/**
 * Claude Code CLI provider.
 *
 * Uses `claude --print <prompt>` for non-interactive single-shot queries.
 * The `--print` flag outputs plain text without starting a REPL session.
 */
export const claudeCodeProvider: ProviderDefinition = createCLIProvider({
	id: "claude-code",
	name: "Claude Code CLI",
	command: "claude",
	models: CLAUDE_CODE_MODELS,
	buildArgs: (_model, context, _options) => {
		const prompt = buildFullPrompt(context);
		return ["--print", prompt];
	},
	parseOutput: (stdout) => stdout.trim(),
});

// ─── Codex Provider ─────────────────────────────────────────────────────────

/**
 * Codex CLI provider.
 *
 * Uses `codex --quiet <prompt>` for non-interactive execution.
 * The `--quiet` flag suppresses progress output, emitting only the result.
 */
export const codexProvider: ProviderDefinition = createCLIProvider({
	id: "codex-cli",
	name: "Codex CLI",
	command: "codex",
	models: CODEX_MODELS,
	buildArgs: (_model, context, _options) => {
		const prompt = buildFullPrompt(context);
		return ["--quiet", prompt];
	},
	parseOutput: (stdout) => stdout.trim(),
});

// ─── Gemini CLI Provider ────────────────────────────────────────────────────

/**
 * Gemini CLI provider.
 *
 * Uses `gemini --prompt <text>` for non-interactive single-shot queries.
 */
export const geminiCLIProvider: ProviderDefinition = createCLIProvider({
	id: "gemini-cli",
	name: "Gemini CLI",
	command: "gemini",
	models: GEMINI_CLI_MODELS,
	buildArgs: (_model, context, _options) => {
		const prompt = buildFullPrompt(context);
		return ["--prompt", prompt];
	},
	parseOutput: (stdout) => stdout.trim(),
});

// ─── Aider Provider ─────────────────────────────────────────────────────────

/**
 * Aider CLI provider.
 *
 * Uses `aider --message <prompt> --no-auto-commits --yes` for
 * non-interactive code editing. The flags disable auto-git-commits
 * and auto-confirm prompts.
 */
export const aiderProvider: ProviderDefinition = createCLIProvider({
	id: "aider-cli",
	name: "Aider CLI",
	command: "aider",
	models: AIDER_MODELS,
	buildArgs: (_model, context, _options) => {
		const prompt = buildFullPrompt(context);
		return ["--message", prompt, "--no-auto-commits", "--yes"];
	},
	parseOutput: (stdout) => stdout.trim(),
});
