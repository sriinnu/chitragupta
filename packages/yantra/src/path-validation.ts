/**
 * @chitragupta/yantra — Shared path validation utilities.
 *
 * Defense-in-depth path validation used across all file I/O tools.
 * These checks run independently of the dharma policy engine.
 */

import * as path from "node:path";
import type { ToolResult } from "./types.js";

/** Paths that should never be accessed by the agent. */
const BLOCKED_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
	"credentials.json", ".chitragupta/config",
];

/**
 * Validate a path for traversal attacks and sensitive path access.
 * Returns an error ToolResult if blocked, or null if allowed.
 */
export function validatePath(inputPath: string, resolvedPath: string): ToolResult | null {
	const normalized = path.normalize(inputPath);
	if (normalized.includes("..")) {
		return { content: "Error: path traversal not allowed", isError: true };
	}

	const lowerResolved = resolvedPath.toLowerCase();
	for (const bp of BLOCKED_PATHS) {
		if (lowerResolved.includes(bp)) {
			return { content: `Error: access to sensitive path denied: ${inputPath}`, isError: true };
		}
	}

	return null;
}
