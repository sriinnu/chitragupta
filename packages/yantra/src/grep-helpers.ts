/**
 * Grep tool helpers — constants, configuration, and file traversal.
 *
 * Extracted from grep.ts for maintainability.
 *
 * @module grep-helpers
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configurable limits for the grep tool. */
export interface GrepConfig {
	maxResults?: number;
	maxFileSize?: number;
	streamThreshold?: number;
}

export const DEFAULT_GREP_CONFIG: Required<GrepConfig> = {
	maxResults: 50,
	maxFileSize: 5_000_000,
	streamThreshold: 1_000_000,
};

let _grepConfig = { ...DEFAULT_GREP_CONFIG };

/** Update grep tool configuration at runtime. */
export function configureGrep(config: GrepConfig): void {
	_grepConfig = { ...DEFAULT_GREP_CONFIG, ...config };
}

/** Get the current effective grep configuration. */
export function getGrepConfig(): Required<GrepConfig> {
	return _grepConfig;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Directories to always skip during traversal. */
export const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"__pycache__",
	".cache",
	".vscode",
	".idea",
]);

/**
 * Sensitive paths that should never be searched by the agent.
 * Same list as read.ts for consistency.
 */
export const BLOCKED_SEARCH_PATHS = [
	"/etc/shadow", "/etc/passwd", "/etc/sudoers",
	".ssh/", ".gnupg/", ".env",
	"id_rsa", "id_ed25519", "id_ecdsa",
	"credentials.json", ".chitragupta/config",
];

/** Binary file extensions to skip. */
export const BINARY_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
	".woff", ".woff2", ".ttf", ".eot",
	".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
	".pdf", ".doc", ".docx", ".xls", ".xlsx",
	".exe", ".dll", ".so", ".dylib",
	".mp3", ".mp4", ".avi", ".mov", ".wav",
	".pyc", ".class", ".o", ".obj",
]);

/** Map of file-type shorthand to extensions. */
export const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
	ts: [".ts", ".tsx", ".mts", ".cts"],
	js: [".js", ".jsx", ".mjs", ".cjs"],
	py: [".py", ".pyi"],
	rs: [".rs"],
	go: [".go"],
	java: [".java"],
	rb: [".rb"],
	php: [".php"],
	c: [".c", ".h"],
	cpp: [".cpp", ".hpp", ".cc", ".hh", ".cxx"],
	cs: [".cs"],
	swift: [".swift"],
	kt: [".kt", ".kts"],
	scala: [".scala"],
	lua: [".lua"],
	r: [".r", ".R"],
	dart: [".dart"],
	zig: [".zig"],
	vue: [".vue"],
	svelte: [".svelte"],
	html: [".html", ".htm"],
	css: [".css", ".scss", ".sass", ".less"],
	json: [".json"],
	yaml: [".yaml", ".yml"],
	toml: [".toml"],
	md: [".md", ".mdx"],
	sql: [".sql"],
	sh: [".sh", ".bash", ".zsh"],
	dockerfile: ["Dockerfile"],
	xml: [".xml"],
};

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Check if a file path is sensitive and should be blocked from search.
 */
export function isBlockedSearchPath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return BLOCKED_SEARCH_PATHS.some((bp) => lower.includes(bp));
}

/**
 * Check if a filename matches an include glob pattern.
 * Supports simple patterns: *.ts, *.{ts,tsx}, specific filenames.
 */
export function matchesInclude(filename: string, include: string): boolean {
	// Handle brace expansion: *.{ts,tsx} -> [*.ts, *.tsx]
	if (include.includes("{") && include.includes("}")) {
		const braceMatch = include.match(/^(.*)\{([^}]+)\}(.*)$/);
		if (braceMatch) {
			const [, prefix, options, suffix] = braceMatch;
			return options.split(",").some((opt) =>
				matchesInclude(filename, prefix + opt.trim() + suffix),
			);
		}
	}

	// Convert simple glob to regex
	const regexStr = include
		.replace(/\./g, "\\.")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${regexStr}$`).test(filename);
}

/**
 * Check if a file matches a file-type filter.
 */
export function matchesFileType(filename: string, fileType: string): boolean {
	const extensions = FILE_TYPE_EXTENSIONS[fileType.toLowerCase()];
	if (!extensions) return false;

	const ext = path.extname(filename).toLowerCase();
	// Also check the full filename for extensionless matches like "Dockerfile"
	return extensions.includes(ext) || extensions.includes(filename);
}

/**
 * Recursively walk a directory, yielding file paths.
 */
export async function* walkFiles(
	dir: string,
	include: string | undefined,
	fileType: string | undefined,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	if (signal?.aborted) return;

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		// Silently skip: directory not readable (permissions, symlink, etc.)
		return;
	}

	for (const entry of entries) {
		if (signal?.aborted) return;

		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			// Skip sensitive directories
			if (entry.name === ".ssh" || entry.name === ".gnupg") continue;
			yield* walkFiles(path.join(dir, entry.name), include, fileType, signal);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (BINARY_EXTENSIONS.has(ext)) continue;
			if (include && !matchesInclude(entry.name, include)) continue;
			if (fileType && !matchesFileType(entry.name, fileType)) continue;
			// Block sensitive files
			const fullPath = path.join(dir, entry.name);
			if (isBlockedSearchPath(fullPath)) continue;
			yield fullPath;
		}
	}
}
