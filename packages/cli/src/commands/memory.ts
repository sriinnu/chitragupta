/**
 * @chitragupta/cli — Memory management commands.
 *
 * Handles displaying, editing, and searching project memory files
 * stored in ~/.chitragupta/memory/.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	bold,
	green,
	gray,
	yellow,
	red,
	dim,
	cyan,
} from "@chitragupta/ui/ansi";

/**
 * Hash a project path to a short deterministic directory key.
 */
function getProjectHash(project: string): string {
	return crypto.createHash("sha256").update(project).digest("hex").slice(0, 12);
}

/**
 * Canonical Smriti project memory path.
 * ~/.chitragupta/memory/projects/<hash>/project.md
 */
function getCanonicalMemoryPath(project: string): string {
	return path.join(getChitraguptaHome(), "memory", "projects", getProjectHash(project), "project.md");
}

/**
 * Legacy CLI project memory path.
 * ~/.chitragupta/memory/<hash>/MEMORY.md
 */
function getLegacyMemoryPath(project: string): string {
	return path.join(getChitraguptaHome(), "memory", getProjectHash(project), "MEMORY.md");
}

/**
 * Get the canonical memory file path for a project.
 */
function getMemoryPath(project: string): string {
	return getCanonicalMemoryPath(project);
}

/**
 * Read the project memory file. Returns undefined if not found.
 */
function readMemory(project: string): string | undefined {
	const candidates = [
		getCanonicalMemoryPath(project),
		getLegacyMemoryPath(project),
		path.join(project, "MEMORY.md"),
	];

	for (const memPath of candidates) {
		try {
			if (fs.existsSync(memPath)) {
				return fs.readFileSync(memPath, "utf-8");
			}
		} catch {
			// Not readable; continue fallback chain.
		}
	}
	return undefined;
}

/**
 * Display the current project memory.
 */
export async function show(project?: string): Promise<void> {
	const projectPath = project ?? process.cwd();
	const content = readMemory(projectPath);

	process.stdout.write("\n" + bold("Project Memory") + "\n");
	process.stdout.write(gray(`  Project: ${projectPath}`) + "\n\n");

	if (!content || content.trim().length === 0) {
		process.stdout.write(
			yellow("  No memory saved for this project yet.\n") +
			gray("  Memory is automatically saved during conversations,\n") +
			gray("  or you can create it with `chitragupta memory edit`.\n\n"),
		);
		return;
	}

	// Display with line numbers and indentation
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const lineNum = String(i + 1).padStart(3, " ");
		process.stdout.write(dim(`${lineNum} `) + `${lines[i]}\n`);
	}

	process.stdout.write("\n");
}

/**
 * Open the project memory in the user's $EDITOR.
 *
 * Creates the memory file if it does not exist, using a template.
 */
export async function edit(project?: string): Promise<void> {
	const projectPath = project ?? process.cwd();
	const memPath = getMemoryPath(projectPath);
	const legacyPath = getLegacyMemoryPath(projectPath);
	const memDir = path.dirname(memPath);

	// Ensure directory exists
	fs.mkdirSync(memDir, { recursive: true });

	// Auto-migrate legacy memory file into canonical path on first edit.
	if (!fs.existsSync(memPath) && fs.existsSync(legacyPath)) {
		try {
			fs.copyFileSync(legacyPath, memPath);
		} catch {
			// Best-effort migration.
		}
	}

	// Create with template if not existing
	if (!fs.existsSync(memPath)) {
		const template = [
			"# Project Memory",
			"",
			`> Project: ${projectPath}`,
			`> Created: ${new Date().toISOString().split("T")[0]}`,
			"",
			"## Key Decisions",
			"",
			"<!-- Record important architectural and design decisions here -->",
			"",
			"## Conventions",
			"",
			"<!-- Project-specific coding conventions and patterns -->",
			"",
			"## Notes",
			"",
			"<!-- General notes about the project -->",
			"",
		].join("\n");

		fs.writeFileSync(memPath, template, "utf-8");
	}

	// Determine editor
	const editor = process.env.EDITOR || process.env.VISUAL || "vi";

	process.stdout.write(dim(`\n  Opening ${memPath} in ${editor}...\n\n`));

	try {
		execSync(`${editor} "${memPath}"`, {
			stdio: "inherit",
		});
		process.stdout.write(green("\n  Memory file saved.\n\n"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`\n  Failed to open editor: ${message}\n\n`));
		process.stderr.write(
			gray(`  You can manually edit: ${memPath}\n\n`),
		);
	}
}

/**
 * Search all memory files across projects.
 */
export async function search(query: string): Promise<void> {
	const memoryRoot = path.join(getChitraguptaHome(), "memory");
	const lowerQuery = query.toLowerCase();

	process.stdout.write(
		"\n" + bold("Memory Search") + gray(` for "${query}"`) + "\n\n",
	);

	if (!fs.existsSync(memoryRoot)) {
		process.stdout.write(yellow("  No memory files found.\n\n"));
		return;
	}

	let matchCount = 0;

	try {
		const memoryFiles: Array<{ id: string; filePath: string }> = [];
		const seen = new Set<string>();

		// Canonical Smriti project memory files.
		const projectsDir = path.join(memoryRoot, "projects");
		if (fs.existsSync(projectsDir)) {
			const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
			for (const entry of projectDirs) {
				if (!entry.isDirectory()) continue;
				const memFile = path.join(projectsDir, entry.name, "project.md");
				if (!fs.existsSync(memFile)) continue;
				const key = `${entry.name}:${memFile}`;
				if (seen.has(key)) continue;
				seen.add(key);
				memoryFiles.push({ id: entry.name, filePath: memFile });
			}
		}

		// Legacy CLI memory files for backward compatibility.
		const rootDirs = fs.readdirSync(memoryRoot, { withFileTypes: true });
		for (const entry of rootDirs) {
			if (!entry.isDirectory()) continue;
			if (entry.name === "projects" || entry.name === "agents") continue;
			const memFile = path.join(memoryRoot, entry.name, "MEMORY.md");
			if (!fs.existsSync(memFile)) continue;
			const key = `${entry.name}:${memFile}`;
			if (seen.has(key)) continue;
			seen.add(key);
			memoryFiles.push({ id: entry.name, filePath: memFile });
		}

		for (const memoryFile of memoryFiles) {
			const memFile = memoryFile.filePath;

			try {
				const content = fs.readFileSync(memFile, "utf-8");
				const lines = content.split("\n");
				const matchingLines: { num: number; text: string }[] = [];

				for (let i = 0; i < lines.length; i++) {
					if (lines[i].toLowerCase().includes(lowerQuery)) {
						matchingLines.push({ num: i + 1, text: lines[i] });
					}
				}

				if (matchingLines.length > 0) {
					matchCount++;
					process.stdout.write(
						`  ${cyan(memoryFile.id)} ${gray(`(${memFile})`)}\n`,
					);

					for (const match of matchingLines.slice(0, 5)) {
						const lineNum = String(match.num).padStart(3, " ");
						// Highlight the matching portion
						const idx = match.text.toLowerCase().indexOf(lowerQuery);
						if (idx >= 0) {
							const before = match.text.slice(0, idx);
							const matched = match.text.slice(idx, idx + query.length);
							const after = match.text.slice(idx + query.length);
							process.stdout.write(
								dim(`    ${lineNum}: `) + `${before}${bold(green(matched))}${after}\n`,
							);
						} else {
							process.stdout.write(dim(`    ${lineNum}: `) + `${match.text}\n`);
						}
					}

					if (matchingLines.length > 5) {
						process.stdout.write(
							gray(`    ... and ${matchingLines.length - 5} more matches\n`),
						);
					}

					process.stdout.write("\n");
				}
			} catch {
				// Skip files that fail to read
			}
		}
	} catch {
		// Memory root not readable
	}

	if (matchCount === 0) {
		process.stdout.write(yellow("  No matches found.\n\n"));
	} else {
		process.stdout.write(gray(`  Found matches in ${matchCount} project(s).\n\n`));
	}
}
