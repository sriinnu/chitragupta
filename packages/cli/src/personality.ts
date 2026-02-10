/**
 * @chitragupta/cli — System prompt builder.
 *
 * Assembles the full system prompt from multiple sources:
 *   1. Agent profile personality
 *   2. Project context (detected type, framework)
 *   3. Context files (CHITRAGUPTA.md, .chitragupta/SYSTEM.md, .chitragupta/APPEND.md)
 *   4. Memory context (project memory summary)
 *   5. Tool descriptions
 *
 * The resulting prompt tells the LLM who it is and what it can do.
 */

import type { AgentProfile } from "@chitragupta/core";
import type { ToolHandler } from "@chitragupta/anina";
import type { ProjectInfo } from "./project-detector.js";
import type { ContextFiles } from "./context-files.js";

export interface SystemPromptOptions {
	profile: AgentProfile;
	project?: ProjectInfo;
	contextFiles?: ContextFiles;
	memoryContext?: string;
	identityContext?: string;
	tools?: ToolHandler[];
}

/**
 * Build the complete system prompt for an agent session.
 *
 * If a system override is present in context files, it replaces the
 * personality section entirely. Otherwise, the personality from the
 * agent profile is used as the foundation.
 *
 * @param options - Configuration including profile, project info, context files,
 *        memory context, and available tools.
 * @returns The assembled system prompt string.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
	const { profile, project, contextFiles, memoryContext, identityContext, tools } = options;
	const parts: string[] = [];

	// ─── Identity context (SOUL.md, IDENTITY.md, personality.md, USER.md) ─
	if (identityContext && identityContext.trim().length > 0) {
		parts.push(identityContext);
	}

	// ─── Base personality ────────────────────────────────────────────────
	if (contextFiles?.systemOverride) {
		// Full system prompt replacement from .chitragupta/SYSTEM.md
		parts.push(contextFiles.systemOverride);
	} else {
		// Default: use the agent profile personality
		parts.push(profile.personality);

		if (profile.expertise.length > 0) {
			parts.push(`Your areas of expertise: ${profile.expertise.join(", ")}.`);
		}
	}

	// ─── Project context ────────────────────────────────────────────────
	if (project && project.type !== "unknown") {
		const projectLines: string[] = [];
		projectLines.push("## Project Context");
		projectLines.push("");
		projectLines.push(`You are working in a ${project.type} project.`);

		if (project.name) {
			projectLines.push(`Project name: ${project.name}`);
		}
		if (project.framework) {
			projectLines.push(`Framework: ${project.framework}`);
		}
		if (project.packageManager) {
			projectLines.push(`Package manager: ${project.packageManager}`);
		}
		projectLines.push(`Project root: ${project.path}`);

		parts.push(projectLines.join("\n"));
	}

	// ─── Project instruction files ──────────────────────────────────────
	if (contextFiles?.projectInstructions) {
		parts.push("## Project Instructions\n\n" + contextFiles.projectInstructions);
	}

	if (contextFiles?.appendInstructions) {
		parts.push(contextFiles.appendInstructions);
	}

	// ─── Memory context ─────────────────────────────────────────────────
	if (memoryContext && memoryContext.trim().length > 0) {
		parts.push("## Project Memory\n\n" + memoryContext);
	}

	// ─── Tool descriptions ──────────────────────────────────────────────
	if (tools && tools.length > 0) {
		const toolLines: string[] = [];
		toolLines.push("## Available Tools");
		toolLines.push("");
		toolLines.push("You have access to the following tools. Use them when appropriate:");
		toolLines.push("");

		for (const tool of tools) {
			const def = tool.definition;
			toolLines.push(`- **${def.name}**: ${def.description}`);
		}

		parts.push(toolLines.join("\n"));
	}

	// ─── Environment info ───────────────────────────────────────────────
	const envLines: string[] = [];
	envLines.push("## Environment");
	envLines.push("");
	envLines.push(`- Working directory: ${process.cwd()}`);
	envLines.push(`- Platform: ${process.platform}`);
	envLines.push(`- Date: ${new Date().toISOString().split("T")[0]}`);

	parts.push(envLines.join("\n"));

	return parts.join("\n\n");
}

/**
 * Build a premium welcome message shown when interactive mode starts.
 *
 * Displays an ASCII banner with a north-star motif, project context,
 * provider hint, memory status, and a usage prompt.
 *
 * @param profile - The agent profile (used for the agent name).
 * @param project - Optional detected project info for display.
 * @returns A multi-line welcome message string.
 */
export function buildWelcomeMessage(profile: AgentProfile, project?: ProjectInfo): string {
	const lines: string[] = [];

	// ─── Chitragupta Yantra Banner ─────────────────────────────────────
	lines.push("");
	lines.push("          \u0964              ");
	lines.push("        \u2571 \u25C6 \u2572            ");
	lines.push("       \u2571  \u2502  \u2572           ");
	lines.push("   \u2500\u2500\u2500\u2571\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2572\u2500\u2500\u2500       ");
	lines.push("       \u2572  \u2502  \u2571           ");
	lines.push("        \u2572 \u25C7 \u2571            ");
	lines.push("          \u0964              ");
	lines.push("");
	lines.push("  \u091A\u093F\u0924\u094D\u0930\u0917\u0941\u092A\u094D\u0924");
	lines.push(`  ${profile.name} ready | v0.5.0`);
	lines.push("");

	// ─── Project info ──────────────────────────────────────────────────
	if (project && project.type !== "unknown") {
		const projectDesc = project.framework
			? `${project.framework} (${project.type})`
			: project.type;
		const projectName = project.name ? ` ${project.name}` : "";
		lines.push(`  Project :${projectName} ${projectDesc}`);
		if (project.path) {
			lines.push(`  Root    : ${project.path}`);
		}
	} else {
		lines.push("  Project : none detected");
	}

	// ─── Provider hint ─────────────────────────────────────────────────
	const model = profile.preferredModel ?? "default";
	lines.push(`  Model   : ${model}`);

	// ─── Memory hint ───────────────────────────────────────────────────
	lines.push("  Memory  : active");

	lines.push("");
	lines.push("  Type your message, or /help for commands.");
	lines.push("");

	return lines.join("\n");
}

/**
 * Build a first-run welcome message explaining Chitragupta and
 * prompting the user to run setup.
 *
 * Shown once when no configuration is found on the system.
 *
 * @returns A multi-line first-run message string.
 */
export function buildFirstRunMessage(): string {
	const lines: string[] = [];

	lines.push("");
	lines.push("  Welcome to Chitragupta -- your AI-powered coding companion.");
	lines.push("");
	lines.push("  Chitragupta is a terminal-native AI assistant that understands your");
	lines.push("  codebase, remembers context across sessions, and gives you bold,");
	lines.push("  opinionated guidance backed by deep expertise.");
	lines.push("");
	lines.push("  To get started, run:");
	lines.push("");
	lines.push("    chitragupta setup");
	lines.push("");
	lines.push("  This will configure your provider keys, choose an agent profile,");
	lines.push("  and initialize your workspace settings.");
	lines.push("");
	lines.push("  Or just start typing -- Chitragupta will guide you through the rest.");
	lines.push("");

	return lines.join("\n");
}
