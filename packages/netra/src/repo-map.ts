/**
 * @chitragupta/netra — Repo Map Provider.
 *
 * Generates a compact file-tree summary of a project directory,
 * highlighting key source files and their exports. Designed to give
 * LLM planners a quick overview of the codebase structure.
 *
 * This is a lightweight implementation using filesystem scanning.
 * Future versions will use tree-sitter for symbol extraction.
 *
 * @module
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single entry in the repo map. */
export interface RepoMapEntry {
	/** Relative path from project root. */
	filePath: string;
	/** Exported symbols (function/class/type names). */
	exports: string[];
	/** File size in bytes. */
	sizeBytes: number;
}

/** Result of generating a repo map. */
export interface RepoMapResult {
	/** Compact text representation for LLM context. */
	text: string;
	/** Structured entries for programmatic use. */
	entries: RepoMapEntry[];
	/** Total number of source files found. */
	totalFiles: number;
}

/** Options for repo map generation. */
export interface RepoMapOptions {
	/** Maximum number of files to include. Default: 50. */
	maxFiles?: number;
	/** File extensions to include. Default: common source extensions. */
	extensions?: string[];
	/** Directories to exclude. Default: node_modules, dist, .git, etc. */
	excludeDirs?: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"];

const DEFAULT_EXCLUDE_DIRS = [
	"node_modules", "dist", "build", ".git", ".next", "coverage",
	"__pycache__", ".turbo", ".cache", ".worktrees",
];

const MAX_FILES_CAP = 200;

// ─── Export Extraction ──────────────────────────────────────────────────────

/** Extract exported symbol names from a TypeScript/JavaScript file. */
function extractExports(content: string): string[] {
	const exports: string[] = [];
	const patterns = [
		/export\s+(?:default\s+)?(?:function|class|const|let|var|enum|type|interface)\s+(\w+)/g,
		/export\s+\{\s*([^}]+)\s*\}/g,
	];
	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(content)) !== null) {
			const names = match[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()?.trim() ?? "");
			for (const name of names) {
				if (name && name.length > 0 && name.length < 60) exports.push(name);
			}
		}
	}
	return [...new Set(exports)].slice(0, 15);
}

// ─── File Discovery ─────────────────────────────────────────────────────────

/** Check if a directory is a git repo. */
function isGitRepo(dir: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd: dir, stdio: "pipe", timeout: 3000 });
		return true;
	} catch { return false; }
}

/** List source files using git ls-files (fast, respects .gitignore). */
function listFilesGit(dir: string, extensions: string[]): string[] {
	try {
		const extGlobs = extensions.map((e) => `*${e}`).join(" ");
		const cmd = `git ls-files -- ${extGlobs}`;
		const output = execSync(cmd, { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
		return output.trim().split("\n").filter(Boolean);
	} catch { return []; }
}

/** List source files using filesystem walk (fallback). */
function listFilesFs(dir: string, extensions: string[], excludeDirs: string[], maxDepth = 5): string[] {
	const files: string[] = [];
	const excludeSet = new Set(excludeDirs);

	function walk(current: string, depth: number): void {
		if (depth > maxDepth || files.length > MAX_FILES_CAP) return;
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(current, { withFileTypes: true }); }
		catch { return; }

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!excludeSet.has(entry.name)) walk(path.join(current, entry.name), depth + 1);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name);
				if (extensions.includes(ext)) files.push(path.relative(dir, path.join(current, entry.name)));
			}
		}
	}

	walk(dir, 0);
	return files;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a repo map for the given project directory.
 *
 * Scans source files, extracts exported symbols, and produces a compact
 * text summary suitable for LLM context injection.
 *
 * @param projectDir - Absolute path to the project root.
 * @param options - Optional configuration for file discovery.
 * @returns A RepoMapResult with text summary and structured entries.
 */
export function generateRepoMap(projectDir: string, options?: RepoMapOptions): RepoMapResult {
	const maxFiles = Math.min(options?.maxFiles ?? 50, MAX_FILES_CAP);
	const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
	const excludeDirs = options?.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;

	// Discover files
	const useGit = isGitRepo(projectDir);
	const allFiles = useGit
		? listFilesGit(projectDir, extensions)
		: listFilesFs(projectDir, extensions, excludeDirs);

	const totalFiles = allFiles.length;

	// Sort by path depth (shallower first = more important), then alphabetically
	const sorted = allFiles.sort((a, b) => {
		const depthA = a.split("/").length;
		const depthB = b.split("/").length;
		if (depthA !== depthB) return depthA - depthB;
		return a.localeCompare(b);
	});

	const selected = sorted.slice(0, maxFiles);

	// Build entries with export extraction
	const entries: RepoMapEntry[] = [];
	for (const relPath of selected) {
		const absPath = path.join(projectDir, relPath);
		let sizeBytes = 0;
		let exports: string[] = [];
		try {
			const stat = fs.statSync(absPath);
			sizeBytes = stat.size;
			if (stat.size < 100_000) {
				const content = fs.readFileSync(absPath, "utf-8");
				exports = extractExports(content);
			}
		} catch { /* skip unreadable files */ }
		entries.push({ filePath: relPath, exports, sizeBytes });
	}

	// Format as compact text
	const lines: string[] = [`Repository Map (${totalFiles} source files, showing ${entries.length}):`];
	for (const entry of entries) {
		const exportStr = entry.exports.length > 0 ? ` [${entry.exports.join(", ")}]` : "";
		lines.push(`  ${entry.filePath}${exportStr}`);
	}
	if (totalFiles > entries.length) {
		lines.push(`  ... and ${totalFiles - entries.length} more files`);
	}

	return { text: lines.join("\n"), entries, totalFiles };
}
