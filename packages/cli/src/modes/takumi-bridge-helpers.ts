/**
 * Takumi Bridge — Detection and parsing helpers.
 *
 * Extracted from takumi-bridge.ts to stay under the 450 LOC limit.
 * Contains PATH detection, version probing, RPC probing, and CLI
 * output parsing for file modifications / test results.
 *
 * @module
 */

import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Timeout for detection probes (version check, RPC probe). */
const DETECT_TIMEOUT_MS = 5_000;

// ─── PATH Detection ────────────────────────────────────────────────────────

/**
 * Check if a command exists on PATH.
 * Uses `which` on Unix or `where.exe` on Windows.
 */
export function commandOnPath(cmd: string): Promise<boolean> {
	const lookupCmd = platform() === "win32" ? "where.exe" : "which";
	return new Promise((resolve) => {
		execFile(lookupCmd, [cmd], (error) => resolve(!error));
	});
}

/**
 * Get the version string from `<command> --version`.
 * Returns null on failure.
 */
export function getVersion(cmd: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			cmd,
			["--version"],
			{ timeout: DETECT_TIMEOUT_MS },
			(error, stdout) => {
				if (error) {
					resolve(null);
				} else {
					resolve(stdout.trim().split("\n")[0] ?? null);
				}
			},
		);
	});
}

/**
 * Probe whether `<command> --rpc` mode is supported.
 *
 * Spawns the command with `--rpc` and waits briefly. If the process
 * stays alive (listening for input), RPC mode is supported.
 * If it exits immediately with error, RPC is not supported.
 */
export function probeRpc(cmd: string, cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(cmd, ["--rpc", "--cwd", cwd], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let resolved = false;

		const timer = setTimeout(() => {
			resolved = true;
			proc.kill("SIGTERM");
			resolve(true);
		}, DETECT_TIMEOUT_MS);

		proc.on("error", () => {
			if (!resolved) {
				clearTimeout(timer);
				resolved = true;
				resolve(false);
			}
		});

		proc.on("close", (code) => {
			if (!resolved) {
				clearTimeout(timer);
				resolved = true;
				resolve(code === 0);
			}
		});
	});
}

// ─── CLI Output Parsing ────────────────────────────────────────────────────

/** Parsed result from unstructured CLI text output. */
export interface ParsedCliOutput {
	filesModified: string[];
	testsRun?: { passed: number; failed: number; total: number };
	diffSummary?: string;
}

/**
 * Parse CLI text output to extract structured information.
 *
 * Looks for:
 * - `diff --git a/<path> b/<path>` lines -> modified files
 * - `Modified: <path>` / `Created: <path>` lines -> modified files
 * - `X passed, Y failed, Z total` patterns -> test results
 * - Entire diff blocks -> diff summary (capped at 2000 chars)
 */
export function parseCliOutput(output: string): ParsedCliOutput {
	const filesModified = new Set<string>();

	// Extract file paths from git diff headers
	const diffPattern = /diff --git a\/(.+?) b\/(.+)/g;
	let match: RegExpExecArray | null;
	while ((match = diffPattern.exec(output)) !== null) {
		filesModified.add(match[2]);
	}

	// Extract file paths from "Modified: <path>" or "Created: <path>"
	const modifiedPattern = /(?:Modified|Created|Changed|Updated):\s+(\S+)/gi;
	while ((match = modifiedPattern.exec(output)) !== null) {
		filesModified.add(match[1]);
	}

	// Extract test results
	let testsRun: { passed: number; failed: number; total: number } | undefined;
	const testPattern = /(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+total/i;
	const testMatch = testPattern.exec(output);
	if (testMatch) {
		testsRun = {
			passed: parseInt(testMatch[1], 10),
			failed: parseInt(testMatch[2], 10),
			total: parseInt(testMatch[3], 10),
		};
	}

	// Extract diff summary (first 2000 chars of diff blocks)
	let diffSummary: string | undefined;
	const diffBlocks = output.match(
		/diff --git[\s\S]*?(?=diff --git|$)/g,
	);
	if (diffBlocks) {
		const combined = diffBlocks.join("\n");
		diffSummary =
			combined.length > 2000 ? combined.slice(0, 2000) + "\u2026" : combined;
	}

	return {
		filesModified: [...filesModified],
		testsRun,
		diffSummary,
	};
}

/**
 * Safely parse a JSON string, returning null on failure.
 * Used for NDJSON line parsing where malformed lines are ignored.
 */
export function safeJsonParse(line: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}
