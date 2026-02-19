/**
 * @chitragupta/cli — Interactive mode slash command handling.
 *
 * Thin dispatcher that delegates to extracted command handler modules.
 * All slash commands, types, constants, and helpers are re-exported
 * from here for backward compatibility.
 *
 * @module
 */

import { yellow, gray } from "@chitragupta/ui/ansi";

// ─── Re-exports (backward compatibility) ────────────────────────────────────

export {
	SLASH_COMMANDS, THINKING_LEVELS,
	completeSlashCommand,
	renderMiniBar, renderProgressBar, formatDuration, formatAge,
} from "./interactive-cmd-registry.js";
export type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";

// ─── Handler imports ────────────────────────────────────────────────────────

import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { handleCoreCommand } from "./interactive-cmd-core.js";
import { handleAgentCommand } from "./interactive-cmd-agents.js";
import { handleIntrospectionCommand } from "./interactive-cmd-introspection.js";
import { handleMetaCommand } from "./interactive-cmd-meta.js";
import { handleAtmanCommand } from "./interactive-cmd-atman.js";
import { handleCollectiveCommand } from "./interactive-cmd-collective.js";
import { handleSystemCommand } from "./interactive-cmd-systems.js";

// ─── Main dispatcher ────────────────────────────────────────────────────────

/**
 * Handle a slash command by delegating to the appropriate handler module.
 * Each handler returns `SlashCommandResult` if it handled the command,
 * or `null` to pass to the next handler.
 */
export async function handleSlashCommand(
	input: string,
	ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
	const parts = input.trim().split(/\s+/);
	const cmd = parts[0].toLowerCase();

	const result =
		await handleCoreCommand(cmd, parts, ctx) ??
		await handleAgentCommand(cmd, parts, ctx) ??
		await handleIntrospectionCommand(cmd, parts, ctx) ??
		await handleMetaCommand(cmd, parts, ctx) ??
		await handleAtmanCommand(cmd, parts, ctx) ??
		await handleCollectiveCommand(cmd, parts, ctx) ??
		await handleSystemCommand(cmd, parts, ctx);

	if (result) return result;

	// Unknown command
	ctx.stdout.write(
		yellow(`\n  Unknown command: ${cmd}\n`) +
		gray("  Type /help for available commands.\n\n"),
	);
	return { handled: true };
}
