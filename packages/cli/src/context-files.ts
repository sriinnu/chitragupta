/**
 * @chitragupta/cli — Context file loader.
 *
 * Loads project instruction files that customize Chitragupta's behavior:
 *   - CHITRAGUPTA.md — project-level instructions appended to system prompt
 *   - .chitragupta/SYSTEM.md — full system prompt replacement
 *   - .chitragupta/APPEND.md — appended to system prompt after personality
 *
 * These files allow projects to customize Chitragupta without changing
 * global configuration.
 */

import fs from "fs";
import path from "path";

export interface ContextFiles {
	/** Full system prompt replacement from .chitragupta/SYSTEM.md */
	systemOverride?: string;
	/** Content to append from CHITRAGUPTA.md */
	projectInstructions?: string;
	/** Content to append from .chitragupta/APPEND.md */
	appendInstructions?: string;
}

/**
 * Attempt to read a file, returning undefined if it does not exist
 * or is not readable.
 */
function tryReadFile(filePath: string): string | undefined {
	try {
		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, "utf-8").trim();
			return content.length > 0 ? content : undefined;
		}
	} catch {
		// File is not readable — skip
	}
	return undefined;
}

/**
 * Load context files from the given project directory.
 *
 * Searches for:
 *   - `<projectDir>/CHITRAGUPTA.md`
 *   - `<projectDir>/.chitragupta/SYSTEM.md`
 *   - `<projectDir>/.chitragupta/APPEND.md`
 *
 * @param projectDir - Absolute path to the project directory.
 * @returns A ContextFiles object with any found instructions.
 */
export function loadContextFiles(projectDir: string): ContextFiles {
	const result: ContextFiles = {};

	// CHITRAGUPTA.md in project root
	result.projectInstructions = tryReadFile(path.join(projectDir, "CHITRAGUPTA.md"));

	// .chitragupta/SYSTEM.md — full system prompt override
	result.systemOverride = tryReadFile(path.join(projectDir, ".chitragupta", "SYSTEM.md"));

	// .chitragupta/APPEND.md — appended to system prompt
	result.appendInstructions = tryReadFile(path.join(projectDir, ".chitragupta", "APPEND.md"));

	return result;
}

/**
 * Build the final context string from loaded context files.
 *
 * If a system override exists, it replaces the base content (but APPEND.md
 * is still appended). Otherwise, project instructions and append instructions
 * are concatenated with double-newline separators.
 *
 * @param files - The loaded context files.
 * @returns A concatenated context string, or empty string if no files were loaded.
 */
export function buildContextString(files: ContextFiles): string {
	// If a system override is present, it takes precedence
	if (files.systemOverride) {
		// Even with a system override, we still append APPEND.md
		const parts = [files.systemOverride];
		if (files.appendInstructions) {
			parts.push(files.appendInstructions);
		}
		return parts.join("\n\n");
	}

	// Otherwise, concatenate available files
	const parts: string[] = [];

	if (files.projectInstructions) {
		parts.push(files.projectInstructions);
	}

	if (files.appendInstructions) {
		parts.push(files.appendInstructions);
	}

	return parts.join("\n\n");
}
