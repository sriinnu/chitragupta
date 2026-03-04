/**
 * @chitragupta/netra — AST-Aware Diff Indexing.
 *
 * Regex-based source file indexer that extracts structured AST information
 * (imports, classes, functions, exports, variables) and can compute
 * symbol-level diffs between two versions of a file.
 *
 * Enables surgical code queries — agents call `ast_query(file_path)` instead
 * of reading entire files. No tree-sitter or native dependencies required.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import type {
	FileAst,
	SymbolInfo,
	SymbolLocation,
	ImportInfo,
	ClassInfo,
	FunctionInfo,
	AstDiff,
	IndexOptions,
} from "./ast-index-types.js";

import {
	parseFileContent,
	fnToSymbol,
	clsToSymbol,
	symbolSignature,
	rebuildStub,
} from "./ast-parse.js";

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE_DIRS = ["node_modules", "dist", "build", ".git", "coverage", ".next", ".turbo"];
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_FILE_SIZE = 100_000;

// ─── File Discovery ────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and collect file paths matching extensions.
 * @param dir - Directory to walk.
 * @param extensions - Set of allowed file extensions.
 * @param excludeDirs - Set of directory names to skip.
 * @param maxDepth - Maximum recursion depth.
 * @param depth - Current recursion depth.
 * @returns Array of absolute file paths.
 */
function walkDir(
	dir: string,
	extensions: Set<string>,
	excludeDirs: Set<string>,
	maxDepth: number,
	depth: number,
): string[] {
	if (depth > maxDepth) return [];
	const results: string[] = [];
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
	catch { return results; }

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!excludeDirs.has(entry.name)) {
				results.push(...walkDir(full, extensions, excludeDirs, maxDepth, depth + 1));
			}
		} else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
			results.push(full);
		}
	}
	return results;
}

// ─── Diff Logic ────────────────────────────────────────────────────────────

/**
 * Collect all symbols (exported + non-exported) from a FileAst for diffing.
 * @param ast - The parsed file AST.
 * @returns Array of all symbols in the file.
 */
function collectAllSymbols(ast: FileAst): SymbolInfo[] {
	const symbols = [...ast.exports];

	// Add non-exported variables
	for (const v of ast.variables) {
		if (!v.exported) symbols.push(v);
	}
	// Add non-exported functions
	for (const fn of ast.functions) {
		if (!fn.exported) symbols.push(fnToSymbol(fn));
	}
	// Add non-exported classes
	for (const cls of ast.classes) {
		if (!cls.exported) symbols.push(clsToSymbol(cls));
	}
	return symbols;
}

/**
 * Compute the AST diff between old and new content for a file.
 * Detects added, removed, and modified symbols by comparing names and signatures.
 *
 * @param filePath - The file path (for labeling).
 * @param oldContent - Previous version of the file content.
 * @param newContent - New version of the file content.
 * @returns An AstDiff describing added, removed, and modified symbols.
 */
function computeDiff(filePath: string, oldContent: string, newContent: string): AstDiff {
	const oldAst = parseFileContent(filePath, oldContent);
	const newAst = parseFileContent(filePath, newContent);

	const oldSymbols = collectAllSymbols(oldAst);
	const newSymbols = collectAllSymbols(newAst);

	const oldMap = new Map<string, SymbolInfo>();
	const newMap = new Map<string, SymbolInfo>();
	for (const s of oldSymbols) oldMap.set(s.name, s);
	for (const s of newSymbols) newMap.set(s.name, s);

	const added: SymbolInfo[] = [];
	const removed: SymbolInfo[] = [];
	const modified: SymbolInfo[] = [];

	for (const [name, sym] of newMap) {
		const old = oldMap.get(name);
		if (!old) { added.push(sym); }
		else if (symbolSignature(old) !== symbolSignature(sym)) { modified.push(sym); }
	}
	for (const [name, sym] of oldMap) {
		if (!newMap.has(name)) removed.push(sym);
	}

	return { filePath, added, removed, modified };
}

// ─── AstIndex Class ────────────────────────────────────────────────────────

/**
 * AST index for source files. Parses and caches structured AST info
 * using regex-based extraction. Supports querying, symbol search,
 * and computing diffs between file versions.
 */
export class AstIndex {
	/** In-memory cache: absolute file path -> FileAst. */
	private readonly index = new Map<string, FileAst>();

	/**
	 * Index a single source file.
	 * @param filePath - Absolute path to the file.
	 * @returns The parsed FileAst.
	 */
	async indexFile(filePath: string): Promise<FileAst> {
		const content = fs.readFileSync(filePath, "utf-8");
		const ast = parseFileContent(filePath, content);
		this.index.set(filePath, ast);
		return ast;
	}

	/**
	 * Index all matching source files in a directory.
	 * @param dirPath - Absolute path to the directory.
	 * @param options - Indexing options.
	 * @returns Map of file path -> FileAst for all indexed files.
	 */
	async indexDirectory(dirPath: string, options?: IndexOptions): Promise<Map<string, FileAst>> {
		const extensions = new Set(options?.extensions ?? DEFAULT_EXTENSIONS);
		const excludeDirs = new Set(options?.excludeDirs ?? DEFAULT_EXCLUDE_DIRS);
		const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
		const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

		const files = walkDir(dirPath, extensions, excludeDirs, maxDepth, 0);
		const result = new Map<string, FileAst>();

		for (const filePath of files) {
			try {
				const stat = fs.statSync(filePath);
				if (stat.size > maxFileSize) continue;
				const ast = await this.indexFile(filePath);
				result.set(filePath, ast);
			} catch { /* skip unreadable files */ }
		}
		return result;
	}

	/** Get the indexed AST for a file, or undefined if not indexed. */
	query(filePath: string): FileAst | undefined {
		return this.index.get(filePath);
	}

	/**
	 * Find all indexed files that contain a symbol with the given name.
	 * Searches exports, variables, functions, and classes.
	 */
	querySymbol(symbolName: string): SymbolLocation[] {
		const results: SymbolLocation[] = [];
		for (const [filePath, ast] of this.index) {
			const allSymbols = [
				...ast.exports,
				...ast.variables,
				...ast.functions.map(fnToSymbol),
				...ast.classes.map(clsToSymbol),
			];
			// Deduplicate by name (exports may overlap with functions/classes)
			const seen = new Set<string>();
			for (const sym of allSymbols) {
				if (sym.name === symbolName && !seen.has(`${filePath}:${sym.name}:${sym.kind}`)) {
					seen.add(`${filePath}:${sym.name}:${sym.kind}`);
					results.push({ filePath, symbol: sym });
				}
			}
		}
		return results;
	}

	/** Get exported symbols for a file. */
	getExports(filePath: string): SymbolInfo[] {
		return this.index.get(filePath)?.exports ?? [];
	}

	/** Get import statements for a file. */
	getImports(filePath: string): ImportInfo[] {
		return this.index.get(filePath)?.imports ?? [];
	}

	/** Get class declarations for a file. */
	getClasses(filePath: string): ClassInfo[] {
		return this.index.get(filePath)?.classes ?? [];
	}

	/** Get function declarations for a file. */
	getFunctions(filePath: string): FunctionInfo[] {
		return this.index.get(filePath)?.functions ?? [];
	}

	/**
	 * Compute a symbol-level diff between old and new content for a file.
	 * @param filePath - The file path (for labeling).
	 * @param oldContent - Previous version of the file content.
	 * @param newContent - New version of the file content.
	 * @returns An AstDiff describing added, removed, and modified symbols.
	 */
	diffFile(filePath: string, oldContent: string, newContent: string): AstDiff {
		return computeDiff(filePath, oldContent, newContent);
	}

	/**
	 * Get files in a directory that changed since a given timestamp (by mtime).
	 * @param dirPath - Absolute path to the directory.
	 * @param sinceMs - Timestamp in milliseconds since epoch.
	 * @returns Array of absolute file paths that changed.
	 */
	getChangedSince(dirPath: string, sinceMs: number): string[] {
		const extensions = new Set(DEFAULT_EXTENSIONS);
		const excludeDirs = new Set(DEFAULT_EXCLUDE_DIRS);
		const files = walkDir(dirPath, extensions, excludeDirs, DEFAULT_MAX_DEPTH, 0);
		const changed: string[] = [];
		for (const filePath of files) {
			try {
				const stat = fs.statSync(filePath);
				if (stat.mtimeMs > sinceMs) changed.push(filePath);
			} catch { /* skip */ }
		}
		return changed;
	}

	/**
	 * Re-index only files that changed since a timestamp and return diffs.
	 * Compares old cached AST with newly parsed AST to produce diffs.
	 * @param dirPath - Directory to check.
	 * @param sinceMs - Timestamp in milliseconds since epoch.
	 * @returns Array of AstDiff for each changed file that had symbol changes.
	 */
	async reindexChanged(dirPath: string, sinceMs: number): Promise<AstDiff[]> {
		const changedFiles = this.getChangedSince(dirPath, sinceMs);
		const diffs: AstDiff[] = [];

		for (const filePath of changedFiles) {
			try {
				const newContent = fs.readFileSync(filePath, "utf-8");
				const oldAst = this.index.get(filePath);
				const oldContent = oldAst ? rebuildStub(oldAst) : "";
				const diff = computeDiff(filePath, oldContent, newContent);
				if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
					diffs.push(diff);
				}
				// Update the index with new content
				const ast = parseFileContent(filePath, newContent);
				this.index.set(filePath, ast);
			} catch { /* skip unreadable */ }
		}
		return diffs;
	}

	/** Get the number of indexed files. */
	get size(): number {
		return this.index.size;
	}

	/** Clear the entire index. */
	clear(): void {
		this.index.clear();
	}
}
