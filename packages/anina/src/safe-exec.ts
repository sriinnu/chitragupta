/**
 * @chitragupta/anina — Safe command execution utilities.
 *
 * Provides validated wrappers around child_process to prevent command injection.
 * All command strings are checked against an allowlist of safe binaries and
 * rejected if they contain dangerous shell metacharacters.
 *
 * Security model: since we reject ALL shell metacharacters (; | & $ ` > <)
 * AND validate the binary against an allowlist, shell interpretation of the
 * validated string is safe — the shell has no special characters to act on.
 */

import { type StdioOptions, execSync } from "node:child_process";
import { basename } from "node:path";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Allowlist of safe command prefixes.
 * Only these binaries are permitted for execution.
 */
const SAFE_COMMAND_PREFIXES = new Set([
	// JS/TS ecosystem
	"npm", "node", "npx", "pnpm", "yarn", "bun", "deno", "tsx",
	"tsc", "eslint", "prettier", "biome",
	// Test runners
	"vitest", "jest", "mocha", "playwright", "cypress",
	// Build tools
	"make", "cmake", "ninja",
	// Languages
	"cargo", "rustc", "python", "python3", "pip", "pip3", "uv",
	"go", "ruby", "java", "javac", "swift", "swiftc", "dotnet",
	// Version control
	"git",
	// Common utilities (read-only / low-risk)
	"ls", "cat", "echo", "which", "env", "pwd", "basename", "dirname",
	"head", "tail", "wc", "sort", "uniq", "diff", "find", "grep", "rg",
	"mkdir", "cp", "mv", "touch", "chmod", "rm",
	"curl", "wget",
	// Docker
	"docker", "docker-compose",
]);

/**
 * Characters that indicate shell meta-operations (injection vectors).
 * Any command containing these is rejected outright.
 */
const DANGEROUS_CHARS = /[;|&$`><]/;

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a command string into [command, ...args], respecting quoted segments.
 * Handles both single and double quotes.
 *
 * @example
 * parseCommand('git commit -m "hello world"')
 * // => ["git", "commit", "-m", "hello world"]
 */
export function parseCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (inQuote) {
			if (ch === inQuote) {
				inQuote = null;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (ch === " " || ch === "\t") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a command string for safe execution.
 *
 * @throws {Error} if the command is empty, contains dangerous characters,
 *                 or uses a command not in the allowlist.
 */
export function validateCommand(command: string): void {
	const trimmed = command.trim();
	if (!trimmed) {
		throw new Error("Command rejected: empty command");
	}

	// Reject any shell meta-characters
	if (DANGEROUS_CHARS.test(trimmed)) {
		throw new Error(
			`Command rejected: contains dangerous shell characters: ${trimmed}`,
		);
	}

	// Extract the base command (first token) and check the allowlist
	const tokens = parseCommand(trimmed);
	if (tokens.length === 0) {
		throw new Error("Command rejected: empty command");
	}

	const baseCommand = basename(tokens[0]);
	if (!SAFE_COMMAND_PREFIXES.has(baseCommand)) {
		throw new Error(
			`Command rejected: "${baseCommand}" is not in the allowlist. ` +
			`Allowed: ${[...SAFE_COMMAND_PREFIXES].join(", ")}`,
		);
	}
}

// ─── Safe Execution ──────────────────────────────────────────────────────────

/**
 * Execute a command string safely after validating against the allowlist.
 *
 * The command is checked for dangerous shell metacharacters and validated
 * against the binary allowlist before execution. Since all metacharacters
 * are rejected, shell interpretation of the validated string is safe.
 *
 * @param command - The command string (e.g. "npm test", "git diff --staged")
 * @param options - Options passed to execSync (cwd, encoding, timeout, stdio)
 * @returns The command's stdout as a string.
 * @throws {Error} if the command fails validation or execution.
 */
export function safeExecSync(
	command: string,
	options: {
		cwd?: string;
		encoding?: BufferEncoding;
		timeout?: number;
		stdio?: StdioOptions;
	},
): string {
	validateCommand(command);

	return execSync(command, {
		...options,
		encoding: options.encoding ?? "utf-8",
	}) as string;
}
