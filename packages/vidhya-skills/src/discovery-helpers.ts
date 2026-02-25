/**
 * Discovery internal helpers — filesystem utilities for skill.md scanning.
 *
 * Extracted from discovery.ts for maintainability.
 *
 * @module discovery-helpers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseSkillMarkdown } from "./parser.js";
import type { SkillManifest } from "./types.js";

/**
 * Check if a filename is a skill manifest (case-insensitive match for `skill.md`).
 * Accepts both `skill.md` and `SKILL.md` (and any mixed-case variant).
 */
export function isSkillManifest(filename: string): boolean {
	return filename.toLowerCase() === "skill.md";
}

/**
 * Find a skill.md file (case-insensitive) in the given directory's immediate children.
 * Returns the absolute path if found, null otherwise.
 */
export async function findSkillMdInDir(dirPath: string): Promise<string | null> {
	try {
		const entries = await fs.promises.readdir(dirPath);
		for (const name of entries) {
			if (isSkillManifest(name)) {
				return path.join(dirPath, name);
			}
		}
	} catch {
		// Directory may not exist or be readable
	}
	return null;
}

/**
 * Recursively find all files named `skill.md` (case-insensitive) in a directory tree.
 */
export async function findSkillFiles(dirPath: string): Promise<string[]> {
	const results: string[] = [];

	if (!existsSync(dirPath)) return results;

	async function walk(currentDir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				// Skip node_modules and hidden directories
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				await walk(fullPath);
			} else if (entry.isFile() && isSkillManifest(entry.name)) {
				results.push(fullPath);
			}
		}
	}

	await walk(dirPath);
	return results;
}

/**
 * Try to parse a skill.md from an npm package directory.
 * Returns null if the package doesn't have the "chitragupta-skill" keyword
 * or doesn't contain a skill.md.
 */
export async function tryParsePackageSkill(
	pkgPath: string,
): Promise<SkillManifest | null> {
	try {
		const pkgJsonPath = path.join(pkgPath, "package.json");
		if (!existsSync(pkgJsonPath)) return null;

		const pkgJson = JSON.parse(
			await fs.promises.readFile(pkgJsonPath, "utf-8"),
		);

		// Check for "chitragupta-skill" keyword
		const keywords: string[] = pkgJson.keywords ?? [];
		if (!keywords.includes("chitragupta-skill")) return null;

		// Look for skill.md (case-insensitive) in package root
		const skillMdPath = await findSkillMdInDir(pkgPath);
		if (!skillMdPath) return null;

		const content = await fs.promises.readFile(skillMdPath, "utf-8");
		return parseSkillMarkdown(content);
	} catch {
		return null;
	}
}

/**
 * Synchronous existence check (used for quick guards before async reads).
 */
export function existsSync(filePath: string): boolean {
	try {
		fs.accessSync(filePath);
		return true;
	} catch {
		return false;
	}
}
