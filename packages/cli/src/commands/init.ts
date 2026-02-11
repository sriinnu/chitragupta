/**
 * @chitragupta/cli — Init command.
 *
 * One-time project setup: configures MCP server + injects agent instructions
 * so the host AI client knows when and how to call Chitragupta's tools.
 *
 * Supports: Claude Code, Codex CLI, Gemini CLI, GitHub Copilot, and generic MCP clients.
 *
 * Usage:
 *   chitragupta init                          # auto-detect client
 *   chitragupta init --client claude          # target Claude Code
 *   chitragupta init --client codex           # target Codex CLI
 *   chitragupta init --client gemini          # target Gemini CLI
 *   chitragupta init --client copilot         # target GitHub Copilot
 *   chitragupta init --client generic         # generic .mcp.json only
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	bold,
	green,
	gray,
	yellow,
	cyan,
	dim,
	red,
	reset,
	rgb,
} from "@chitragupta/ui/ansi";

// ─── Supported Clients ──────────────────────────────────────────────────────

type ClientId = "claude" | "codex" | "gemini" | "copilot" | "generic";

interface ClientDef {
	name: string;
	mcpConfigPath: (root: string) => string;
	instructionsPath: (root: string) => string | null;
	detectMarkers: (root: string) => boolean;
}

const CLIENTS: Record<ClientId, ClientDef> = {
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
 * Saffron → Gold gradient applied per-line to the ASCII banner.
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

/** Saffron (#FF9933) → Gold (#FFD700) gradient, 6 steps. */
const GRADIENT: Array<[number, number, number]> = [
	[255, 153, 51],   // #FF9933  saffron
	[255, 167, 38],   // blend
	[255, 183, 28],   // blend
	[255, 199, 18],   // blend
	[255, 211, 8],    // blend
	[255, 215, 0],    // #FFD700  gold
];

function printBanner(): void {
	process.stdout.write("\n");
	for (let i = 0; i < BANNER_LINES.length; i++) {
		const [r, g, b] = GRADIENT[i % GRADIENT.length];
		process.stdout.write(`${rgb(r, g, b)}${BANNER_LINES[i]}${reset}\n`);
	}
	process.stdout.write(dim("          चि  The Eternal Record Keeper — v0.5.0\n"));
	process.stdout.write("\n");
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHITRAGUPTA_MARKER = "# Chitragupta MCP";

/**
 * The instructions snippet that teaches the host agent when and how
 * to use Chitragupta's MCP tools. Works for any AI client.
 */
const MEMORY_INSTRUCTIONS = `${CHITRAGUPTA_MARKER}

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

## Context Limits
- When approaching context limits, call \`chitragupta_handover\` to preserve
  work state (files modified, decisions made, errors encountered).
- On session resume, call \`chitragupta_session_show\` with the last session ID
  to restore context.

## Available Tools (25)
- \`chitragupta_memory_search\` — search project memory (GraphRAG-backed)
- \`chitragupta_session_list\` — list recent sessions
- \`chitragupta_session_show\` — show session by ID
- \`chitragupta_handover\` — work-state handover for context continuity
- \`akasha_traces\` — query collective knowledge traces
- \`akasha_deposit\` — record solutions, patterns, warnings
- \`vasana_tendencies\` — learned behavioral patterns
- \`health_status\` — system health (Triguna)
- \`atman_report\` — full self-report
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Find the project root by walking up from cwd looking for markers. */
function findProjectRoot(from: string): string {
	let dir = path.resolve(from);
	while (true) {
		if (
			fs.existsSync(path.join(dir, ".git")) ||
			fs.existsSync(path.join(dir, "package.json")) ||
			fs.existsSync(path.join(dir, "pyproject.toml")) ||
			fs.existsSync(path.join(dir, "Cargo.toml")) ||
			fs.existsSync(path.join(dir, "go.mod"))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return from;
		dir = parent;
	}
}

/** Auto-detect which AI client is being used. */
function detectClient(projectRoot: string): ClientId | "unknown" {
	for (const [id, def] of Object.entries(CLIENTS) as Array<[ClientId, ClientDef]>) {
		if (id === "generic") continue;
		if (def.detectMarkers(projectRoot)) return id;
	}
	return "unknown";
}

/** Resolve the chitragupta MCP entry point path. */
function resolveEntryPoint(): string {
	const monorepoEntry = path.resolve(
		import.meta.dirname ?? __dirname,
		"../../dist/mcp-entry.js",
	);
	if (fs.existsSync(monorepoEntry)) {
		return monorepoEntry;
	}

	const globalEntry = path.join(
		getChitraguptaHome(),
		"node_modules",
		"@chitragupta/cli",
		"dist",
		"mcp-entry.js",
	);
	if (fs.existsSync(globalEntry)) {
		return globalEntry;
	}

	return "npx:chitragupta-mcp";
}

// ─── MCP Config Writer ──────────────────────────────────────────────────────

interface McpResult {
	file: string;
	created: boolean;
}

function buildMcpServerEntry(entryPoint: string, projectRoot: string): Record<string, unknown> {
	const isNpx = entryPoint.startsWith("npx:");
	if (isNpx) {
		return {
			command: "npx",
			args: ["-y", "chitragupta-mcp", "--stdio"],
			env: { CHITRAGUPTA_MCP_PROJECT: projectRoot },
		};
	}
	return {
		command: "node",
		args: [entryPoint, "--stdio"],
		env: { CHITRAGUPTA_MCP_PROJECT: projectRoot },
	};
}

function writeMcpConfig(projectRoot: string, clientDef: ClientDef, entryPoint: string): McpResult {
	const mcpPath = clientDef.mcpConfigPath(projectRoot);

	// Ensure parent directory
	const dir = path.dirname(mcpPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	let config: Record<string, unknown> = {};
	if (fs.existsSync(mcpPath)) {
		try {
			config = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
		} catch {
			// Corrupted — overwrite
		}
	}

	const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
	servers.chitragupta = buildMcpServerEntry(entryPoint, projectRoot);
	config.mcpServers = servers;

	const created = !fs.existsSync(mcpPath);
	fs.writeFileSync(mcpPath, JSON.stringify(config, null, "\t") + "\n");
	return { file: mcpPath, created };
}

// ─── Instructions Writer ────────────────────────────────────────────────────

interface InstructionsResult {
	file: string;
	action: "created" | "updated" | "skipped";
}

function writeInstructions(projectRoot: string, clientDef: ClientDef): InstructionsResult | null {
	const filePath = clientDef.instructionsPath(projectRoot);
	if (!filePath) return null;

	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	if (fs.existsSync(filePath)) {
		const existing = fs.readFileSync(filePath, "utf-8");
		if (existing.includes(CHITRAGUPTA_MARKER)) {
			return { file: filePath, action: "skipped" };
		}
		const separator = existing.endsWith("\n") ? "\n" : "\n\n";
		fs.writeFileSync(filePath, existing + separator + MEMORY_INSTRUCTIONS);
		return { file: filePath, action: "updated" };
	}

	fs.writeFileSync(filePath, MEMORY_INSTRUCTIONS);
	return { file: filePath, action: "created" };
}

// ─── Interactive Prompt ──────────────────────────────────────────────────────

/** Prompt user to pick an AI coding agent from a numbered list. */
async function askClient(detected: ClientId | "unknown"): Promise<ClientId> {
	const choices: Array<{ id: ClientId; name: string; hint?: string }> = [
		{ id: "claude", name: "Claude Code", hint: "Anthropic" },
		{ id: "codex", name: "Codex CLI", hint: "OpenAI" },
		{ id: "gemini", name: "Gemini CLI", hint: "Google" },
		{ id: "copilot", name: "GitHub Copilot", hint: "GitHub" },
		{ id: "generic", name: "Other / Generic MCP", hint: ".mcp.json only" },
	];

	process.stdout.write(bold("  Which AI coding agent do you use?\n\n"));

	for (let i = 0; i < choices.length; i++) {
		const c = choices[i];
		const num = `  ${i + 1}.`;
		const isDetected = c.id === detected;
		const marker = isDetected ? green(" ← detected") : "";
		process.stdout.write(
			cyan(num) + ` ${bold(c.name)}` + dim(` (${c.hint})`) + marker + "\n",
		);
	}

	process.stdout.write("\n");

	// Default to detected or claude
	const defaultIdx = detected !== "unknown"
		? choices.findIndex((c) => c.id === detected)
		: 0;
	const defaultNum = defaultIdx + 1;

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise<ClientId>((resolve) => {
		rl.question(gray(`  Enter number [${defaultNum}]: `), (answer) => {
			rl.close();
			const trimmed = answer.trim();
			if (!trimmed) {
				resolve(choices[defaultIdx].id);
				return;
			}
			const num = parseInt(trimmed, 10);
			if (num >= 1 && num <= choices.length) {
				resolve(choices[num - 1].id);
			} else {
				// Try matching by name
				const match = choices.find(
					(c) => c.id === trimmed.toLowerCase() || c.name.toLowerCase() === trimmed.toLowerCase(),
				);
				resolve(match?.id ?? choices[defaultIdx].id);
			}
		});
	});
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function run(args: string[] = []): Promise<void> {
	// Parse --client flag
	let clientOverride: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--client" && i + 1 < args.length) {
			clientOverride = args[++i];
		}
	}

	// Validate client ID
	if (clientOverride && !(clientOverride in CLIENTS)) {
		process.stderr.write(
			red(`\n  Error: Unknown client "${clientOverride}".\n`) +
			gray(`  Supported: ${Object.keys(CLIENTS).join(", ")}\n\n`),
		);
		process.exit(1);
	}

	const projectRoot = findProjectRoot(process.cwd());
	const detected = detectClient(projectRoot);

	// ─── Banner ──────────────────────────────────────────────────────────

	printBanner();

	process.stdout.write(gray("  Project : ") + projectRoot + "\n\n");

	// ─── Client Selection ────────────────────────────────────────────────

	let targetId: ClientId;
	if (clientOverride) {
		targetId = clientOverride as ClientId;
	} else {
		targetId = await askClient(detected);
	}

	const clientDef = CLIENTS[targetId];
	process.stdout.write("\n" + gray("  Client  : ") + bold(clientDef.name) + "\n\n");

	// ─── Step 1: MCP Config ──────────────────────────────────────────────

	const entryPoint = resolveEntryPoint();
	const mcpResult = writeMcpConfig(projectRoot, clientDef, entryPoint);
	const mcpRelative = path.relative(projectRoot, mcpResult.file);

	if (mcpResult.created) {
		process.stdout.write(green("  ✓ ") + green("Created ") + cyan(mcpRelative) + green(" — MCP server configured\n"));
	} else {
		process.stdout.write(green("  ✓ ") + green("Updated ") + cyan(mcpRelative) + green(" — chitragupta server added\n"));
	}

	// ─── Step 2: Instructions ────────────────────────────────────────────

	const instrResult = writeInstructions(projectRoot, clientDef);

	if (instrResult) {
		const instrRelative = path.relative(projectRoot, instrResult.file);
		switch (instrResult.action) {
			case "created":
				process.stdout.write(green("  ✓ ") + green("Created ") + cyan(instrRelative) + green(" — agent instructions added\n"));
				break;
			case "updated":
				process.stdout.write(green("  ✓ ") + green("Updated ") + cyan(instrRelative) + green(" — Chitragupta section appended\n"));
				break;
			case "skipped":
				process.stdout.write(dim("  · ") + dim(instrRelative) + dim(" — Chitragupta section already present\n"));
				break;
		}
	}

	// ─── Done ────────────────────────────────────────────────────────────

	process.stdout.write("\n");
	process.stdout.write(bold("  Ready!\n\n"));
	process.stdout.write(gray("  Next steps:\n"));
	process.stdout.write(`    1. ${dim("Restart")} ${bold(clientDef.name)} in this project\n`);
	process.stdout.write(`    2. The agent will automatically use Chitragupta's memory\n`);
	process.stdout.write(`    3. Past sessions, decisions, and patterns carry forward\n`);
	process.stdout.write("\n");

	if (entryPoint.startsWith("npx:")) {
		process.stdout.write(yellow("  Note: ") + "Using npx fallback. For faster startup:\n");
		process.stdout.write(cyan("    npm install -g @chitragupta/cli\n"));
		process.stdout.write("\n");
	}

	// Show other clients hint
	const otherClients = Object.entries(CLIENTS)
		.filter(([id]) => id !== targetId && id !== "generic")
		.map(([id, def]) => `${id} (${def.name})`)
		.join(", ");
	process.stdout.write(dim(`  Also supports: ${otherClients}\n`));
	process.stdout.write(dim("  Run: chitragupta init --client <name>\n\n"));
}
