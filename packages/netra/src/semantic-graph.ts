/**
 * @chitragupta/netra -- Semantic Graph Query.
 *
 * Wraps the import graph with symbol-level metadata and rich querying.
 * Enables queries like: "Give me all functions that depend on UserAuth, 2 levels deep."
 *
 * Uses regex-based parsing (no tree-sitter dependency) to extract symbols
 * from TypeScript/JavaScript source files. Combines file-level import edges
 * with symbol-level metadata and PageRank importance scores.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import { buildImportGraph, reverseGraph } from "./import-graph.js";
import type { ImportGraph } from "./import-graph.js";
import { computePageRank, normalizeScores } from "./page-rank.js";
import type {
	SymbolInfo,
	SymbolKind,
	SemanticGraphOptions,
	QueryDirection,
	SubGraph,
	SubGraphNode,
	SubGraphEdge,
	GraphQueryResult,
} from "./semantic-graph-types.js";

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE_DIRS = [
	"node_modules", "dist", "build", ".git", ".next",
	"coverage", "__pycache__", ".turbo", ".cache", ".worktrees",
];
const DEFAULT_MAX_FILES = 500;
const MAX_FILE_SIZE = 100_000;

// ─── Symbol Extraction (Regex-based) ───────────────────────────────────────

/**
 * Regex patterns for extracting symbol declarations from TS/JS source.
 * Each pattern captures: [1] = kind keyword (optional), [2] = symbol name.
 */
const SYMBOL_PATTERNS: Array<{ pattern: RegExp; kind: SymbolKind; exported: boolean }> = [
	// export function foo / export default function foo / export async function foo
	{ pattern: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: "function", exported: true },
	// export class Foo
	{ pattern: /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: "class", exported: true },
	// export interface Foo
	{ pattern: /^export\s+(?:default\s+)?interface\s+(\w+)/gm, kind: "interface", exported: true },
	// export type Foo
	{ pattern: /^export\s+(?:default\s+)?type\s+(\w+)/gm, kind: "type", exported: true },
	// export enum Foo
	{ pattern: /^export\s+(?:default\s+)?(?:const\s+)?enum\s+(\w+)/gm, kind: "enum", exported: true },
	// export const foo / export let foo / export var foo
	{ pattern: /^export\s+(?:default\s+)?(?:const|let|var)\s+(\w+)/gm, kind: "const", exported: true },
	// Non-exported: function foo (not preceded by export)
	{ pattern: /^(?!export\s)(?:async\s+)?function\s+(\w+)/gm, kind: "function", exported: false },
	// Non-exported: class Foo
	{ pattern: /^(?!export\s)(?:abstract\s+)?class\s+(\w+)/gm, kind: "class", exported: false },
	// Non-exported: interface Foo
	{ pattern: /^(?!export\s)interface\s+(\w+)/gm, kind: "interface", exported: false },
	// Non-exported: type Foo =
	{ pattern: /^(?!export\s)type\s+(\w+)\s*=/gm, kind: "type", exported: false },
	// Non-exported: const foo = / let foo = / var foo =
	{ pattern: /^(?!export\s)(?:const|let|var)\s+(\w+)/gm, kind: "variable", exported: false },
];

/**
 * Extract symbols from TypeScript/JavaScript source content.
 *
 * @param content - Source file content.
 * @param filePath - Relative file path (for SymbolInfo metadata).
 * @returns Array of extracted symbols.
 */
export function extractSymbols(content: string, filePath: string): SymbolInfo[] {
	const symbols: SymbolInfo[] = [];
	const seen = new Set<string>();
	const lines = content.split("\n");

	for (const { pattern, kind, exported } of SYMBOL_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const name = match[1];
			const key = `${name}:${kind}:${exported}`;
			if (!name || seen.has(key)) continue;
			seen.add(key);

			// Compute line number from character offset
			const upToMatch = content.slice(0, match.index);
			const line = upToMatch.split("\n").length;

			symbols.push({ name, kind, filePath, line, exported });
		}
	}

	return symbols;
}

// ─── File Discovery ────────────────────────────────────────────────────────

/** List source files using git ls-files or fs walk. */
function discoverFiles(projectDir: string, extensions: string[], excludeDirs: string[], maxFiles: number): string[] {
	// Try git first
	try {
		const extGlobs = extensions.map((e) => `*${e}`).join(" ");
		const cmd = `git ls-files -- ${extGlobs}`;
		const output = execSync(cmd, { cwd: projectDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
		return output.trim().split("\n").filter(Boolean).slice(0, maxFiles);
	} catch {
		// Fallback to filesystem walk
	}

	const files: string[] = [];
	const excludeSet = new Set(excludeDirs);
	function walk(current: string, depth: number): void {
		if (depth > 5 || files.length >= maxFiles) return;
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(current, { withFileTypes: true }); }
		catch { return; }
		for (const entry of entries) {
			if (entry.isDirectory() && !excludeSet.has(entry.name)) {
				walk(path.join(current, entry.name), depth + 1);
			} else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
				files.push(path.relative(projectDir, path.join(current, entry.name)));
			}
		}
	}
	walk(projectDir, 0);
	return files.slice(0, maxFiles);
}

// ─── SemanticGraph Class ───────────────────────────────────────────────────

/**
 * Semantic code graph with symbol-level metadata and rich querying.
 *
 * Wraps the import graph, PageRank scores, and per-file symbol info
 * to enable queries like: "all files that depend on X, 2 levels deep".
 */
export class SemanticGraph {
	/** Forward import graph: file -> files it imports. */
	readonly forwardGraph: ImportGraph;
	/** Reverse import graph: file -> files that import it. */
	readonly reverseImportGraph: ImportGraph;
	/** Symbols per file. */
	readonly symbolMap: Map<string, SymbolInfo[]>;
	/** Normalized PageRank scores per file. */
	readonly rankScores: Map<string, number>;
	/** Project root directory. */
	readonly projectDir: string;

	constructor(
		projectDir: string,
		forwardGraph: ImportGraph,
		symbolMap: Map<string, SymbolInfo[]>,
		rankScores: Map<string, number>,
	) {
		this.projectDir = projectDir;
		this.forwardGraph = forwardGraph;
		this.reverseImportGraph = reverseGraph(forwardGraph);
		this.symbolMap = symbolMap;
		this.rankScores = rankScores;
	}

	/** Total number of files in the graph. */
	get fileCount(): number {
		return this.forwardGraph.size;
	}

	/**
	 * Find all symbols matching a name (case-insensitive substring match).
	 *
	 * @param name - Symbol name to search for.
	 * @returns All matching SymbolInfo entries.
	 */
	findSymbol(name: string): SymbolInfo[] {
		const lower = name.toLowerCase();
		const results: SymbolInfo[] = [];
		for (const symbols of this.symbolMap.values()) {
			for (const sym of symbols) {
				if (sym.name.toLowerCase().includes(lower)) {
					results.push(sym);
				}
			}
		}
		return results;
	}

	/**
	 * Get files that depend on the given file (who imports it), up to N levels deep.
	 *
	 * @param filePath - Relative path of the target file.
	 * @param depth - How many levels to traverse. Default: 1.
	 * @returns SubGraph of dependent files.
	 */
	getDependents(filePath: string, depth = 1): SubGraph {
		return this.traverseGraph(filePath, depth, "upstream");
	}

	/**
	 * Get files that the given file depends on (what it imports), up to N levels deep.
	 *
	 * @param filePath - Relative path of the source file.
	 * @param depth - How many levels to traverse. Default: 1.
	 * @returns SubGraph of dependency files.
	 */
	getDependencies(filePath: string, depth = 1): SubGraph {
		return this.traverseGraph(filePath, depth, "downstream");
	}

	/**
	 * Get the highest PageRank files/symbols (hotspots).
	 *
	 * @param limit - Maximum results. Default: 10.
	 * @returns SubGraph of highest-ranked files.
	 */
	getHotSpots(limit = 10): SubGraph {
		const sorted = [...this.rankScores.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit);

		const nodes: SubGraphNode[] = sorted.map(([fp, score]) => ({
			filePath: fp,
			symbols: this.symbolMap.get(fp) ?? [],
			rankScore: score,
			depth: 0,
		}));

		return { nodes, edges: [], totalFiles: this.fileCount };
	}

	/**
	 * Query the graph for an entity (symbol name or file path) and return
	 * a subgraph of related files up to the specified depth.
	 *
	 * @param entity - Symbol name or file path to query.
	 * @param depth - Traversal depth. Default: 1.
	 * @param direction - "upstream" (dependents), "downstream" (dependencies), or "both".
	 * @returns Full query result with matched symbols and subgraph.
	 */
	query(entity: string, depth = 1, direction: QueryDirection = "both"): GraphQueryResult {
		const matchedSymbols = this.findSymbol(entity);

		// Determine starting file(s): either direct file path match or files containing the symbol
		const startFiles = new Set<string>();

		// Check if entity is a file path
		if (this.forwardGraph.has(entity)) {
			startFiles.add(entity);
		}

		// Add files containing matching symbols
		for (const sym of matchedSymbols) {
			startFiles.add(sym.filePath);
		}

		// Merge subgraphs from all starting points
		const allNodes = new Map<string, SubGraphNode>();
		const allEdges = new Map<string, SubGraphEdge>();

		for (const startFile of startFiles) {
			const sub = this.traverseGraph(startFile, depth, direction);
			for (const node of sub.nodes) {
				const existing = allNodes.get(node.filePath);
				if (!existing || node.depth < existing.depth) {
					allNodes.set(node.filePath, node);
				}
			}
			for (const edge of sub.edges) {
				allEdges.set(`${edge.from}->${edge.to}`, edge);
			}
		}

		return {
			entity,
			direction,
			depth,
			subgraph: {
				nodes: [...allNodes.values()],
				edges: [...allEdges.values()],
				totalFiles: this.fileCount,
			},
			matchedSymbols,
		};
	}

	// ─── Private BFS Traversal ──────────────────────────────────────────

	/** BFS traversal of the graph in a given direction. */
	private traverseGraph(startFile: string, maxDepth: number, direction: QueryDirection): SubGraph {
		const visited = new Map<string, number>(); // file -> depth
		const edges: SubGraphEdge[] = [];
		const queue: Array<{ file: string; depth: number }> = [];

		if (!this.forwardGraph.has(startFile)) {
			return { nodes: [], edges: [], totalFiles: this.fileCount };
		}

		queue.push({ file: startFile, depth: 0 });
		visited.set(startFile, 0);

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.depth >= maxDepth) continue;

			const nextDepth = current.depth + 1;
			const neighbors = this.getNeighbors(current.file, direction);

			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					visited.set(neighbor, nextDepth);
					queue.push({ file: neighbor, depth: nextDepth });
				}
				// Record edge regardless (for edge completeness)
				if (direction === "upstream" || direction === "both") {
					if ((this.reverseImportGraph.get(current.file) ?? []).includes(neighbor)) {
						edges.push({ from: neighbor, to: current.file });
					}
				}
				if (direction === "downstream" || direction === "both") {
					if ((this.forwardGraph.get(current.file) ?? []).includes(neighbor)) {
						edges.push({ from: current.file, to: neighbor });
					}
				}
			}
		}

		const nodes: SubGraphNode[] = [...visited.entries()].map(([fp, depth]) => ({
			filePath: fp,
			symbols: this.symbolMap.get(fp) ?? [],
			rankScore: this.rankScores.get(fp) ?? 0,
			depth,
		}));

		// Deduplicate edges
		const edgeSet = new Set<string>();
		const uniqueEdges = edges.filter((e) => {
			const key = `${e.from}->${e.to}`;
			if (edgeSet.has(key)) return false;
			edgeSet.add(key);
			return true;
		});

		return { nodes, edges: uniqueEdges, totalFiles: this.fileCount };
	}

	/** Get neighbors for traversal based on direction. */
	private getNeighbors(file: string, direction: QueryDirection): string[] {
		const neighbors: string[] = [];
		if (direction === "upstream" || direction === "both") {
			neighbors.push(...(this.reverseImportGraph.get(file) ?? []));
		}
		if (direction === "downstream" || direction === "both") {
			neighbors.push(...(this.forwardGraph.get(file) ?? []));
		}
		return [...new Set(neighbors)];
	}
}

// ─── Builder ───────────────────────────────────────────────────────────────

/**
 * Build a semantic graph from a project directory.
 *
 * Scans source files, extracts symbols via regex, builds the import graph,
 * runs PageRank for importance scoring, and assembles the SemanticGraph.
 *
 * @param projectDir - Absolute path to the project root.
 * @param options - Configuration for file discovery and parsing.
 * @returns A fully constructed SemanticGraph.
 */
export function buildSemanticGraph(projectDir: string, options?: SemanticGraphOptions): SemanticGraph {
	const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
	const excludeDirs = options?.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
	const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;

	// Discover files
	const files = discoverFiles(projectDir, extensions, excludeDirs, maxFiles);

	// Build import graph
	const importGraph = buildImportGraph(files, { projectDir });

	// Run PageRank
	const prResult = computePageRank(importGraph);
	const rankScores = normalizeScores(prResult.scores);

	// Extract symbols per file
	const symbolMap = new Map<string, SymbolInfo[]>();
	for (const file of files) {
		const absPath = path.join(projectDir, file);
		try {
			const stat = fs.statSync(absPath);
			if (stat.size > MAX_FILE_SIZE) {
				symbolMap.set(file, []);
				continue;
			}
			const content = fs.readFileSync(absPath, "utf-8");
			symbolMap.set(file, extractSymbols(content, file));
		} catch {
			symbolMap.set(file, []);
		}
	}

	return new SemanticGraph(projectDir, importGraph, symbolMap, rankScores);
}
