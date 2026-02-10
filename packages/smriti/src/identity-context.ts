/**
 * @chitragupta/smriti — Identity Context Loader
 *
 * Loads identity markdown files (SOUL.md, IDENTITY.md, personality.md, USER.md)
 * and formats them as a system prompt section.
 *
 * These files define how the AI agent presents itself, its values,
 * communication style, and knowledge about the user.
 *
 * The loader searches for identity files in:
 *   1. Explicitly configured paths
 *   2. Project root directory
 *   3. Parent directories (up to 3 levels)
 *   4. Home directory (~/)
 *
 * Files are optional — missing files are silently skipped.
 */

import fs from "fs";
import path from "path";
import os from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IdentityFileType = "soul" | "identity" | "personality" | "user" | "agents";

export interface IdentityConfig {
	/** Explicit paths to identity files. Overrides auto-detection. */
	paths?: Record<IdentityFileType, string>;
	/** Project root path for auto-detection. */
	projectPath?: string;
	/** Which identity file types to include. Default: all. */
	include?: IdentityFileType[];
	/** Max characters per file to include. Default: 3000 */
	maxCharsPerFile?: number;
}

interface LoadedIdentityFile {
	type: IdentityFileType;
	path: string;
	content: string;
}

const DEFAULT_INCLUDE: IdentityFileType[] = ["soul", "identity", "personality", "user"];

const FILE_NAMES: Record<IdentityFileType, string[]> = {
	soul: ["SOUL.md", "soul.md"],
	identity: ["IDENTITY.md", "identity.md"],
	personality: ["PERSONALITY.md", "personality.md"],
	user: ["USER.md", "user.md"],
	agents: ["AGENTS.md", "agents.md"],
};

const MAX_CHARS_PER_FILE = 3000;

// ─── IdentityContext ────────────────────────────────────────────────────────

export class IdentityContext {
	private readonly config: IdentityConfig;
	private cachedFiles: LoadedIdentityFile[] | null = null;

	constructor(config?: IdentityConfig) {
		this.config = config ?? {};
	}

	/**
	 * Load identity files and return a formatted system prompt section.
	 *
	 * @returns Markdown-formatted identity context, or empty string if no files found.
	 */
	load(): string {
		const files = this.loadFiles();
		if (files.length === 0) return "";

		const sections: string[] = [];
		sections.push("## Identity & Values");
		sections.push("");

		for (const file of files) {
			const label = this.typeLabel(file.type);
			sections.push(`### ${label}`);
			sections.push("");

			// Extract the meaningful content — skip YAML frontmatter if present
			const content = stripFrontmatter(file.content);

			// Strip the top-level heading (redundant with our ### label)
			const stripped = content.replace(/^#\s+.+\n+/, "");

			// Truncate to max chars
			const maxChars = this.config.maxCharsPerFile ?? MAX_CHARS_PER_FILE;
			const truncated = stripped.length > maxChars
				? stripped.slice(0, maxChars) + "\n\n[...truncated]"
				: stripped;

			sections.push(truncated.trim());
			sections.push("");
		}

		return sections.join("\n");
	}

	/**
	 * Load just user preferences from identity files.
	 * Extracts preference-like sections from USER.md and PERSONALITY.md.
	 */
	loadUserPreferences(): string {
		const files = this.loadFiles();
		const userFile = files.find(f => f.type === "user");
		if (!userFile) return "";

		// Extract sections that contain preference information
		const content = stripFrontmatter(userFile.content);
		const prefSections: string[] = [];

		// Look for sections with preference keywords
		const sectionPattern = /^##\s+(.+)$/gm;
		const sections = content.split(/^(?=##\s)/m);

		for (const section of sections) {
			const lower = section.toLowerCase();
			if (
				lower.includes("prefer") ||
				lower.includes("dislike") ||
				lower.includes("contract") ||
				lower.includes("style") ||
				lower.includes("care about") ||
				lower.includes("values")
			) {
				prefSections.push(section.trim());
			}
		}

		return prefSections.join("\n\n");
	}

	/**
	 * Check if any identity files are available.
	 */
	hasIdentityFiles(): boolean {
		return this.loadFiles().length > 0;
	}

	/**
	 * Get paths of found identity files (for debugging/display).
	 */
	getFoundPaths(): Record<IdentityFileType, string | null> {
		const files = this.loadFiles();
		const result: Record<string, string | null> = {};
		for (const type of DEFAULT_INCLUDE) {
			const found = files.find(f => f.type === type);
			result[type] = found?.path ?? null;
		}
		return result as Record<IdentityFileType, string | null>;
	}

	/**
	 * Clear cached files — call when identity files might have changed.
	 */
	clearCache(): void {
		this.cachedFiles = null;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private loadFiles(): LoadedIdentityFile[] {
		if (this.cachedFiles) return this.cachedFiles;

		const include = this.config.include ?? DEFAULT_INCLUDE;
		const files: LoadedIdentityFile[] = [];

		for (const type of include) {
			const content = this.loadFile(type);
			if (content) {
				files.push(content);
			}
		}

		this.cachedFiles = files;
		return files;
	}

	private loadFile(type: IdentityFileType): LoadedIdentityFile | null {
		// 1. Check explicit path
		const explicitPath = this.config.paths?.[type];
		if (explicitPath) {
			const content = readFileSafe(explicitPath);
			if (content) return { type, path: explicitPath, content };
		}

		// 2. Search directories
		const searchDirs = this.getSearchDirs();
		const fileNames = FILE_NAMES[type];

		for (const dir of searchDirs) {
			for (const name of fileNames) {
				const filePath = path.join(dir, name);
				const content = readFileSafe(filePath);
				if (content) return { type, path: filePath, content };
			}
		}

		return null;
	}

	private getSearchDirs(): string[] {
		const dirs: string[] = [];

		// Project root
		if (this.config.projectPath) {
			dirs.push(this.config.projectPath);

			// Parent directories (up to 3 levels — catches monorepo roots)
			let current = this.config.projectPath;
			for (let i = 0; i < 3; i++) {
				const parent = path.dirname(current);
				if (parent === current) break; // reached filesystem root
				dirs.push(parent);
				current = parent;
			}
		}

		// Home directory
		dirs.push(os.homedir());

		return dirs;
	}

	private typeLabel(type: IdentityFileType): string {
		switch (type) {
			case "soul": return "Soul (Operating Contract)";
			case "identity": return "Identity";
			case "personality": return "Personality & Voice";
			case "user": return "User Profile";
			case "agents": return "Agent Behavior";
		}
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
	try {
		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, "utf-8");
			if (content.trim().length > 0) return content;
		}
	} catch {
		// Silently skip unreadable files
	}
	return null;
}

function stripFrontmatter(content: string): string {
	const fmMatch = content.match(/^---\n[\s\S]*?\n---\n*/);
	return fmMatch ? content.slice(fmMatch[0].length) : content;
}
