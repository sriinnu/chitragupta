/**
 * @chitragupta/netra — Import Graph Builder.
 *
 * Parses TypeScript/JavaScript source files to extract import relationships
 * and builds a directed graph: file A imports file B → edge from A to B.
 *
 * Used by the repo map to feed PageRank for file importance ranking.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A directed import graph: source file → list of resolved target files. */
export type ImportGraph = Map<string, string[]>;

/** Options for building the import graph. */
export interface ImportGraphOptions {
	/** Project root directory (for resolving relative paths). */
	projectDir: string;
	/** File extensions to try when resolving bare imports. Default: ['.ts', '.tsx', '.js', '.jsx']. */
	resolveExtensions?: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Regex patterns for extracting import specifiers from source code.
 * Captures the module specifier string from various import/require forms.
 */
const IMPORT_PATTERNS: RegExp[] = [
	// import { x } from "./foo"  |  import foo from "./foo"  |  import * as foo from "./foo"
	/import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g,
	// import("./foo") — dynamic import
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
	// require("./foo")
	/require\s*\(\s*["']([^"']+)["']\s*\)/g,
	// export { x } from "./foo"  |  export * from "./foo"
	/export\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g,
];

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Check if a specifier is a relative path (starts with `.` or `/`).
 * Non-relative specifiers (npm packages, builtins) are skipped.
 */
function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/**
 * Resolve a relative import specifier to an actual file path.
 *
 * Tries: exact path, path + each extension, path/index + each extension.
 * Returns the relative path from projectDir, or null if unresolvable.
 *
 * @param specifier - The import specifier (e.g., "./foo", "../bar.js").
 * @param sourceFile - The file containing the import (relative to projectDir).
 * @param projectDir - Absolute path to the project root.
 * @param extensions - Extensions to try for resolution.
 * @returns Resolved relative file path or null.
 */
function resolveImport(
	specifier: string,
	sourceFile: string,
	projectDir: string,
	extensions: string[],
): string | null {
	const sourceDir = path.dirname(path.join(projectDir, sourceFile));
	const base = path.resolve(sourceDir, specifier);

	// Strip .js extension for TypeScript resolution (.ts files import as .js in ESM)
	const stripped = base.replace(/\.js$/, "");

	// Try exact path first
	const candidates = [
		base,
		stripped,
		...extensions.map((ext) => stripped + ext),
		...extensions.map((ext) => path.join(stripped, "index" + ext)),
		...extensions.map((ext) => path.join(base, "index" + ext)),
	];

	for (const candidate of candidates) {
		try {
			const stat = fs.statSync(candidate);
			if (stat.isFile()) {
				return path.relative(projectDir, candidate);
			}
		} catch {
			// File doesn't exist, try next candidate
		}
	}
	return null;
}

// ─── Graph Building ─────────────────────────────────────────────────────────

/**
 * Extract import specifiers from source code.
 *
 * @param content - Source file content.
 * @returns Array of raw import specifiers found in the file.
 */
export function extractImports(content: string): string[] {
	const specifiers: string[] = [];
	for (const pattern of IMPORT_PATTERNS) {
		// Reset regex state for each file
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const specifier = match[1];
			if (specifier && isRelativeSpecifier(specifier)) {
				specifiers.push(specifier);
			}
		}
	}
	return [...new Set(specifiers)];
}

/**
 * Build a directed import graph from a list of source files.
 *
 * For each file, parses its imports and resolves relative paths to actual
 * files within the project. The resulting graph maps each file to the
 * list of files it imports.
 *
 * @param files - List of relative file paths (from projectDir).
 * @param options - Import graph options including projectDir.
 * @returns A directed graph: file → files it imports.
 */
export function buildImportGraph(
	files: string[],
	options: ImportGraphOptions,
): ImportGraph {
	const { projectDir, resolveExtensions = DEFAULT_RESOLVE_EXTENSIONS } = options;
	const fileSet = new Set(files);
	const graph: ImportGraph = new Map();

	// Initialize all files in the graph (even those with no imports)
	for (const file of files) {
		graph.set(file, []);
	}

	for (const file of files) {
		const absPath = path.join(projectDir, file);
		let content: string;
		try {
			const stat = fs.statSync(absPath);
			// Skip large files — they're unlikely to be standard source modules
			if (stat.size > 100_000) continue;
			content = fs.readFileSync(absPath, "utf-8");
		} catch {
			continue;
		}

		const specifiers = extractImports(content);
		const resolved: string[] = [];

		for (const spec of specifiers) {
			const target = resolveImport(spec, file, projectDir, resolveExtensions);
			// Only include edges to files within the project
			if (target && fileSet.has(target)) {
				resolved.push(target);
			}
		}

		graph.set(file, [...new Set(resolved)]);
	}

	return graph;
}

/**
 * Compute the reverse graph (inbound edges).
 *
 * In the reverse graph, each file maps to the list of files that import it.
 * Useful for finding hub files (files imported by many others).
 *
 * @param graph - The forward import graph.
 * @returns Reverse graph: file → files that import this file.
 */
export function reverseGraph(graph: ImportGraph): ImportGraph {
	const reverse: ImportGraph = new Map();

	// Initialize all nodes
	for (const file of graph.keys()) {
		reverse.set(file, []);
	}

	for (const [source, targets] of graph) {
		for (const target of targets) {
			const importers = reverse.get(target);
			if (importers) {
				importers.push(source);
			}
		}
	}

	return reverse;
}
