/**
 * @chitragupta/netra — Repo Map Provider (v2: PageRank).
 *
 * Generates a compact file-tree summary of a project directory,
 * highlighting key source files and their exports. Files are ranked
 * by structural importance using PageRank on the import graph.
 *
 * v2 upgrade: import graph + PageRank replaces naive path-depth sorting.
 * Paper-backed: ContextBench (ArXiv 2602.05892) proves better retrieval
 * beats complex agent logic. Aider's #1 differentiator.
 *
 * @module
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { buildImportGraph } from "./import-graph.js";
import { computePageRank, normalizeScores } from "./page-rank.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single entry in the repo map. */
export interface RepoMapEntry {
	/** Relative path from project root. */
	filePath: string;
	/** Exported symbols (function/class/type names). */
	exports: string[];
	/** File size in bytes. */
	sizeBytes: number;
	/** PageRank importance score (0.0 to 1.0). Higher = more central. */
	rankScore: number;
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
	/** Query string to boost matching files. Files whose name or exports match rank higher. */
	query?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"];

const DEFAULT_EXCLUDE_DIRS = [
	"node_modules", "dist", "build", ".git", ".next", "coverage",
	"__pycache__", ".turbo", ".cache", ".worktrees",
];

const MAX_FILES_CAP = 200;

/** Weight for query relevance boost when combining with PageRank. */
const QUERY_BOOST_WEIGHT = 0.4;

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

// ─── Query Boosting ─────────────────────────────────────────────────────────

/**
 * Compute a query relevance score for a file (0.0 to 1.0).
 * Matches against file path components and export names.
 */
function computeQueryScore(filePath: string, exports: string[], query: string): number {
	const queryLower = query.toLowerCase();
	const terms = queryLower.split(/[\s_-]+/).filter((t) => t.length > 1);
	if (terms.length === 0) return 0;

	let score = 0;
	const fileNameLower = path.basename(filePath, path.extname(filePath)).toLowerCase();
	const pathLower = filePath.toLowerCase();

	for (const term of terms) {
		// Exact filename match is strongest signal
		if (fileNameLower === term) score += 1.0;
		// Filename contains term
		else if (fileNameLower.includes(term)) score += 0.6;
		// Path contains term
		else if (pathLower.includes(term)) score += 0.3;

		// Export name matches
		for (const exp of exports) {
			const expLower = exp.toLowerCase();
			if (expLower === term) { score += 0.8; break; }
			if (expLower.includes(term)) { score += 0.4; break; }
		}
	}

	// Normalize by number of terms, cap at 1.0
	return Math.min(score / terms.length, 1.0);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a repo map for the given project directory.
 *
 * Scans source files, builds an import graph, runs PageRank to determine
 * file importance, and produces a compact text summary suitable for
 * LLM context injection. Files imported by many others rank highest.
 *
 * @param projectDir - Absolute path to the project root.
 * @param options - Optional configuration for file discovery and ranking.
 * @returns A RepoMapResult with text summary and structured entries.
 */
export function generateRepoMap(projectDir: string, options?: RepoMapOptions): RepoMapResult {
	const maxFiles = Math.min(options?.maxFiles ?? 50, MAX_FILES_CAP);
	const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
	const excludeDirs = options?.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
	const query = options?.query;

	// Discover files
	const useGit = isGitRepo(projectDir);
	const allFiles = useGit
		? listFilesGit(projectDir, extensions)
		: listFilesFs(projectDir, extensions, excludeDirs);

	const totalFiles = allFiles.length;

	// Build import graph and run PageRank
	const importGraph = buildImportGraph(allFiles, { projectDir });
	const prResult = computePageRank(importGraph);
	const normalizedRanks = normalizeScores(prResult.scores);

	// Build entries with export extraction and ranking
	const entries: RepoMapEntry[] = [];
	for (const relPath of allFiles) {
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

		let rankScore = normalizedRanks.get(relPath) ?? 0;

		// Apply query boost if a query is provided
		if (query) {
			const queryScore = computeQueryScore(relPath, exports, query);
			rankScore = (1 - QUERY_BOOST_WEIGHT) * rankScore + QUERY_BOOST_WEIGHT * queryScore;
		}

		entries.push({ filePath: relPath, exports, sizeBytes, rankScore });
	}

	// Sort by rankScore descending (most important first)
	entries.sort((a, b) => b.rankScore - a.rankScore);
	const selected = entries.slice(0, maxFiles);

	// Format as compact text
	const lines: string[] = [`Repository Map (${totalFiles} source files, showing ${selected.length}):`];
	for (const entry of selected) {
		const exportStr = entry.exports.length > 0 ? ` [${entry.exports.join(", ")}]` : "";
		const scoreStr = entry.rankScore > 0 ? ` (rank: ${entry.rankScore.toFixed(3)})` : "";
		lines.push(`  ${entry.filePath}${exportStr}${scoreStr}`);
	}
	if (totalFiles > selected.length) {
		lines.push(`  ... and ${totalFiles - selected.length} more files`);
	}

	return { text: lines.join("\n"), entries: selected, totalFiles };
}
