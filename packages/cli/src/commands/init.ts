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
} from "@chitragupta/ui/ansi";
import {
	type ClientId,
	type ClientDef,
	CLIENTS,
	printBanner,
	CHITRAGUPTA_MARKER,
	MEMORY_INSTRUCTIONS,
} from "./init-templates.js";

// Re-export for backward compatibility
export type { ClientId, ClientDef } from "./init-templates.js";
export { CLIENTS, printBanner, CHITRAGUPTA_MARKER, MEMORY_INSTRUCTIONS } from "./init-templates.js";

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
function resolveEntryPoint(projectRoot: string): string {
	const monorepoEntry = path.resolve(
		import.meta.dirname ?? __dirname,
		"../../dist/mcp-entry.js",
	);
	if (fs.existsSync(monorepoEntry) && monorepoEntry.startsWith(projectRoot)) {
		return monorepoEntry;
	}

	const globalEntry = path.join(
		getChitraguptaHome(),
		"node_modules",
		"@yugenlab/chitragupta",
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
			args: ["-y", "-p", "@yugenlab/chitragupta", "chitragupta-mcp", "--agent"],
			env: { CHITRAGUPTA_MCP_PROJECT: projectRoot, CHITRAGUPTA_MCP_AGENT: "true" },
		};
	}
	return {
		command: "node",
		args: [entryPoint, "--agent"],
		env: { CHITRAGUPTA_MCP_PROJECT: projectRoot, CHITRAGUPTA_MCP_AGENT: "true" },
	};
}

function writeMcpConfig(projectRoot: string, clientDef: ClientDef, entryPoint: string): McpResult {
	const mcpPath = clientDef.mcpConfigPath(projectRoot);
	const dir = path.dirname(mcpPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	let config: Record<string, unknown> = {};
	if (fs.existsSync(mcpPath)) {
		try { config = JSON.parse(fs.readFileSync(mcpPath, "utf-8")); } catch { /* overwrite */ }
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
		const marker = isDetected ? green(" \u2190 detected") : "";
		process.stdout.write(
			cyan(num) + ` ${bold(c.name)}` + dim(` (${c.hint})`) + marker + "\n",
		);
	}

	process.stdout.write("\n");

	const defaultIdx = detected !== "unknown"
		? choices.findIndex((c) => c.id === detected)
		: 0;
	const defaultNum = defaultIdx + 1;

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	return new Promise<ClientId>((resolve) => {
		rl.question(gray(`  Enter number [${defaultNum}]: `), (answer) => {
			rl.close();
			const trimmed = answer.trim();
			if (!trimmed) { resolve(choices[defaultIdx].id); return; }
			const num = parseInt(trimmed, 10);
			if (num >= 1 && num <= choices.length) { resolve(choices[num - 1].id); }
			else {
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
	let clientOverride: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--client" && i + 1 < args.length) { clientOverride = args[++i]; }
	}

	if (clientOverride && !(clientOverride in CLIENTS)) {
		process.stderr.write(
			red(`\n  Error: Unknown client "${clientOverride}".\n`) +
			gray(`  Supported: ${Object.keys(CLIENTS).join(", ")}\n\n`),
		);
		process.exit(1);
	}

	const projectRoot = findProjectRoot(process.cwd());
	const detected = detectClient(projectRoot);

	printBanner();
	process.stdout.write(gray("  Project : ") + projectRoot + "\n\n");

	let targetId: ClientId;
	if (clientOverride) { targetId = clientOverride as ClientId; }
	else { targetId = await askClient(detected); }

	const clientDef = CLIENTS[targetId];
	process.stdout.write("\n" + gray("  Client  : ") + bold(clientDef.name) + "\n\n");

	const entryPoint = resolveEntryPoint(projectRoot);
	const mcpResult = writeMcpConfig(projectRoot, clientDef, entryPoint);
	const mcpRelative = path.relative(projectRoot, mcpResult.file);

	if (mcpResult.created) {
		process.stdout.write(green("  \u2713 ") + green("Created ") + cyan(mcpRelative) + green(" \u2014 MCP server configured\n"));
	} else {
		process.stdout.write(green("  \u2713 ") + green("Updated ") + cyan(mcpRelative) + green(" \u2014 chitragupta server added\n"));
	}

	const instrResult = writeInstructions(projectRoot, clientDef);

	if (instrResult) {
		const instrRelative = path.relative(projectRoot, instrResult.file);
		switch (instrResult.action) {
			case "created":
				process.stdout.write(green("  \u2713 ") + green("Created ") + cyan(instrRelative) + green(" \u2014 agent instructions added\n"));
				break;
			case "updated":
				process.stdout.write(green("  \u2713 ") + green("Updated ") + cyan(instrRelative) + green(" \u2014 Chitragupta section appended\n"));
				break;
			case "skipped":
				process.stdout.write(dim("  \u00B7 ") + dim(instrRelative) + dim(" \u2014 Chitragupta section already present\n"));
				break;
		}
	}

	process.stdout.write("\n");
	process.stdout.write(bold("  Ready!\n\n"));
	process.stdout.write(gray("  Next steps:\n"));
	process.stdout.write(`    1. ${dim("Restart")} ${bold(clientDef.name)} in this project\n`);
	process.stdout.write(`    2. The agent will automatically use Chitragupta's memory\n`);
	process.stdout.write(`    3. Past sessions, decisions, and patterns carry forward\n`);
	process.stdout.write("\n");

	process.stdout.write(gray("  Coding agent:\n"));
	process.stdout.write(`    ${cyan("chitragupta code")} ${dim('"fix the bug in login.ts"')}        ${dim("\u2014 CLI")}\n`);
	process.stdout.write(`    ${cyan("chitragupta-code")} ${dim('"add input validation" --plan')}    ${dim("\u2014 standalone")}\n`);
	process.stdout.write(`    ${dim("Or use the")} ${cyan("coding_agent")} ${dim("tool from")} ${bold(clientDef.name)}\n`);
	process.stdout.write("\n");

	process.stdout.write(gray("  Configuration:\n"));
	process.stdout.write(`    ${cyan("chitragupta provider list")}                         ${dim("\u2014 see providers")}\n`);
	process.stdout.write(`    ${cyan("chitragupta provider add anthropic")}                ${dim("\u2014 configure API key")}\n`);
	process.stdout.write(`    ${cyan("chitragupta config set coding.mode plan-only")}      ${dim("\u2014 set defaults")}\n`);
	process.stdout.write("\n");

	if (entryPoint.startsWith("npx:")) {
		process.stdout.write(yellow("  Note: ") + "Using npx fallback. For faster startup:\n");
		process.stdout.write(cyan("    npm install -g @yugenlab/chitragupta\n"));
		process.stdout.write("\n");
	}

	const otherClients = Object.entries(CLIENTS)
		.filter(([id]) => id !== targetId && id !== "generic")
		.map(([id, def]) => `${id} (${def.name})`)
		.join(", ");
	process.stdout.write(dim(`  Also supports: ${otherClients}\n`));
	process.stdout.write(dim("  Run: chitragupta init --client <name>\n\n"));
}
