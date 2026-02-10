/**
 * @chitragupta/swara — CLI availability detection.
 *
 * Probes the local system for installed AI CLI tools and returns
 * availability info. Used to auto-select the best available CLI
 * provider without manual configuration.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderDefinition } from "../types.js";
import {
	claudeCodeProvider,
	geminiCLIProvider,
	codexProvider,
	aiderProvider,
} from "./cli-providers.js";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

/** Availability status for a single CLI tool. */
export interface CLIAvailability {
	/** The CLI command name (e.g. "claude", "gemini"). */
	command: string;
	/** Whether the command was found on the system PATH. */
	available: boolean;
	/** Version string if available (from --version). */
	version?: string;
	/** Resolved path to the binary (from `which`). */
	path?: string;
}

// ─── Detection Priority ────────────────────────────────────────────────────

/** CLI tools in priority order (highest first). */
const CLI_ENTRIES: Array<{ command: string; provider: ProviderDefinition }> = [
	{ command: "claude", provider: claudeCodeProvider },
	{ command: "gemini", provider: geminiCLIProvider },
	{ command: "codex", provider: codexProvider },
	{ command: "aider", provider: aiderProvider },
];

// ─── Probe Helpers ──────────────────────────────────────────────────────────

/**
 * Probe a single CLI command for availability, path, and version.
 */
async function probeCLI(command: string): Promise<CLIAvailability> {
	try {
		const { stdout: whichOut } = await execFileAsync("which", [command], {
			timeout: 5_000,
		});
		const resolvedPath = whichOut.trim();

		if (!resolvedPath) {
			return { command, available: false };
		}

		// Try to get version — most CLIs support --version
		let version: string | undefined;
		try {
			const { stdout: versionOut } = await execFileAsync(command, ["--version"], {
				timeout: 5_000,
			});
			version = versionOut.trim().split("\n")[0];
		} catch {
			// Version detection is best-effort; some CLIs may not support --version
		}

		return { command, available: true, version, path: resolvedPath };
	} catch {
		return { command, available: false };
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect which AI CLI tools are available on the local system.
 *
 * Probes for: claude, gemini, codex, aider (in priority order).
 * All probes run concurrently for fast detection.
 */
export async function detectAvailableCLIs(): Promise<CLIAvailability[]> {
	const commands = CLI_ENTRIES.map((entry) => entry.command);
	return Promise.all(commands.map(probeCLI));
}

/**
 * Return the highest-priority CLI provider that is available locally.
 *
 * Priority: claude > gemini > codex > aider.
 * Returns `null` if no supported CLI tool is installed.
 */
export async function getBestCLIProvider(): Promise<ProviderDefinition | null> {
	const results = await detectAvailableCLIs();

	for (let i = 0; i < CLI_ENTRIES.length; i++) {
		if (results[i].available) {
			return CLI_ENTRIES[i].provider;
		}
	}

	return null;
}
