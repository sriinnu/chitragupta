/**
 * Init command templates — banner art, gradient colors, and instruction text.
 *
 * Extracted from init.ts for maintainability.
 *
 * @module init-templates
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	rgb,
	dim,
	reset,
} from "@chitragupta/ui/ansi";

// ─── Supported Clients ──────────────────────────────────────────────────────

export type ClientId = "claude" | "codex" | "gemini" | "copilot" | "generic";

export interface ClientDef {
	name: string;
	mcpConfigPath: (root: string) => string;
	instructionsPath: (root: string) => string | null;
	detectMarkers: (root: string) => boolean;
}

export const CLIENTS: Record<ClientId, ClientDef> = {
	claude: {
		name: "Claude Code",
		mcpConfigPath: (root) => path.join(root, ".mcp.json"),
		instructionsPath: (root) => path.join(root, "CLAUDE.md"),
		detectMarkers: (root) =>
			!!process.env.CLAUDE_CODE ||
			fs.existsSync(path.join(root, "CLAUDE.md")) ||
			fs.existsSync(path.join(root, ".claude")),
	},
	codex: {
		name: "Codex CLI",
		mcpConfigPath: (root) => path.join(root, ".codex", "config.json"),
		instructionsPath: (root) => path.join(root, ".codex", "instructions.md"),
		detectMarkers: (root) =>
			!!process.env.CODEX_CLI ||
			fs.existsSync(path.join(root, ".codex")),
	},
	gemini: {
		name: "Gemini CLI",
		mcpConfigPath: (root) => path.join(root, ".gemini", "settings.json"),
		instructionsPath: (root) => path.join(root, "GEMINI.md"),
		detectMarkers: (root) =>
			!!process.env.GEMINI_CLI ||
			fs.existsSync(path.join(root, ".gemini")) ||
			fs.existsSync(path.join(root, "GEMINI.md")),
	},
	copilot: {
		name: "GitHub Copilot",
		mcpConfigPath: (root) => path.join(root, ".github", "copilot-mcp.json"),
		instructionsPath: (root) => path.join(root, ".github", "copilot-instructions.md"),
		detectMarkers: (root) =>
			fs.existsSync(path.join(root, ".github", "copilot-mcp.json")) ||
			fs.existsSync(path.join(root, ".github", "copilot-instructions.md")),
	},
	generic: {
		name: "MCP Client",
		mcpConfigPath: (root) => path.join(root, ".mcp.json"),
		instructionsPath: () => null,
		detectMarkers: () => false,
	},
};

// ─── Banner ─────────────────────────────────────────────────────────────────

/**
 * Saffron -> Gold gradient applied per-line to the ASCII banner.
 * Uses true-color ANSI (24-bit RGB).
 */
const BANNER_LINES = [
	"     ██████╗██╗  ██╗██╗████████╗██████╗  █████╗  ██████╗ ██╗   ██╗██████╗ ████████╗ █████╗ ",
	"    ██╔════╝██║  ██║██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝ ██║   ██║██╔══██╗╚══██╔══╝██╔══██╗",
	"    ██║     ███████║██║   ██║   ██████╔╝███████║██║  ███╗██║   ██║██████╔╝   ██║   ███████║",
	"    ██║     ██╔══██║██║   ██║   ██╔══██╗██╔══██║██║   ██║██║   ██║██╔═══╝    ██║   ██╔══██║",
	"    ╚██████╗██║  ██║██║   ██║   ██║  ██║██║  ██║╚██████╔╝╚██████╔╝██║        ██║   ██║  ██║",
	"     ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝        ╚═╝   ╚═╝  ╚═╝",
];

/** Amber (#F59E0B) → Cyan (#06B6D4) gradient, 6 steps. */
const GRADIENT: Array<[number, number, number]> = [
	[245, 158, 11],
	[200, 170, 50],
	[150, 182, 100],
	[100, 190, 150],
	[50, 192, 190],
	[6, 182, 212],
];

/** Print the colorized ASCII banner to stdout. */
export function printBanner(): void {
	process.stdout.write("\n");
	for (let i = 0; i < BANNER_LINES.length; i++) {
		const [r, g, b] = GRADIENT[i % GRADIENT.length];
		process.stdout.write(`${rgb(r, g, b)}${BANNER_LINES[i]}${reset}\n`);
	}
	process.stdout.write(dim("          ⛩  The Eternal Record Keeper — v0.5.0\n"));
	process.stdout.write("\n");
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CHITRAGUPTA_MARKER = "# Chitragupta MCP";

/**
 * The instructions snippet that teaches the host agent when and how
 * to use Chitragupta's MCP tools. Works for any AI client.
 */
export const MEMORY_INSTRUCTIONS = `${CHITRAGUPTA_MARKER}

## Session Start
- At the START of every session, call \`chitragupta_memory_search\` with the current task
  to load relevant context from past sessions.
- Call \`chitragupta_session_list\` to see recent sessions for this project.

## During Work
- When making architectural decisions, search past sessions first —
  call \`chitragupta_memory_search\` to check what was decided before.
- After completing significant work, call \`akasha_deposit\` with type "solution"
  to record the approach for future sessions.
- When you discover a recurring pattern, call \`akasha_deposit\` with type "pattern".

## Coding Agent
- For substantial coding tasks, use the \`coding_agent\` tool — it runs a full
  autonomous pipeline: Plan → Branch → Execute → Validate → Review → Commit.
- Call it with \`{ "task": "your task", "mode": "full" }\` for end-to-end execution.
- Use \`"mode": "plan-only"\` to plan without executing.
- The coding agent creates git branches, runs tests, and self-reviews its work.

## Context Limits
- When approaching context limits, call \`chitragupta_handover\` to preserve
  work state (files modified, decisions made, errors encountered).
- On session resume, call \`chitragupta_session_show\` with the last session ID
  to restore context.

## Key Tools
- \`coding_agent\` — delegate coding tasks (Plan → Branch → Code → Test → Review → Commit)
- \`chitragupta_memory_search\` — search project memory (GraphRAG-backed)
- \`chitragupta_session_list\` — list recent sessions
- \`chitragupta_session_show\` — show session by ID
- \`chitragupta_handover\` — work-state handover for context continuity
- \`chitragupta_prompt\` — delegate a task to Chitragupta's agent
- \`akasha_traces\` — query collective knowledge traces
- \`akasha_deposit\` — record solutions, patterns, warnings
- \`sabha_deliberate\` — multi-agent deliberation on proposals
- \`vasana_tendencies\` — learned behavioral patterns
- \`health_status\` — system health (Triguna)
- \`atman_report\` — full self-report
`;
