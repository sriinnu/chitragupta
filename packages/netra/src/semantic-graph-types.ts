/**
 * @chitragupta/netra -- Semantic Graph Types.
 *
 * Types for the semantic code graph query system. Supports symbol-level
 * graph queries: "find all dependents of class X, 2 levels deep".
 *
 * @module
 */

// ─── Symbol Classification ─────────────────────────────────────────────────

/** Kind of a source-level symbol. */
export type SymbolKind =
	| "function"
	| "class"
	| "interface"
	| "type"
	| "enum"
	| "const"
	| "variable";

// ─── Symbol Metadata ───────────────────────────────────────────────────────

/** Information about a single symbol extracted from source. */
export interface SymbolInfo {
	/** Symbol name (e.g. "UserAuthentication"). */
	name: string;
	/** Classification of the symbol. */
	kind: SymbolKind;
	/** File path relative to project root. */
	filePath: string;
	/** Line number where the symbol is declared (1-based). */
	line: number;
	/** Whether the symbol is exported from the file. */
	exported: boolean;
}

// ─── Graph Options ─────────────────────────────────────────────────────────

/** Options for building the semantic graph. */
export interface SemanticGraphOptions {
	/** File extensions to include. Default: ['.ts', '.tsx', '.js', '.jsx']. */
	extensions?: string[];
	/** Directories to exclude. Default: node_modules, dist, .git, etc. */
	excludeDirs?: string[];
	/** Maximum number of files to scan. Default: 500. */
	maxFiles?: number;
}

// ─── Query Direction ───────────────────────────────────────────────────────

/** Direction for traversing the dependency graph. */
export type QueryDirection = "upstream" | "downstream" | "both";

// ─── Subgraph Result ───────────────────────────────────────────────────────

/** A node in the query result subgraph. */
export interface SubGraphNode {
	/** File path relative to project root. */
	filePath: string;
	/** Symbols defined in this file. */
	symbols: SymbolInfo[];
	/** PageRank importance score (0.0 to 1.0). */
	rankScore: number;
	/** Depth from the query origin (0 = the queried file). */
	depth: number;
}

/** An edge in the query result subgraph. */
export interface SubGraphEdge {
	/** Source file (importer). */
	from: string;
	/** Target file (imported). */
	to: string;
}

/** Result of a subgraph query. */
export interface SubGraph {
	/** Nodes in the subgraph. */
	nodes: SubGraphNode[];
	/** Edges in the subgraph. */
	edges: SubGraphEdge[];
	/** Total file count in the full graph. */
	totalFiles: number;
}

/** Result returned by semantic graph query methods. */
export interface GraphQueryResult {
	/** Entity that was queried. */
	entity: string;
	/** Direction of traversal. */
	direction: QueryDirection;
	/** Depth limit used. */
	depth: number;
	/** The resulting subgraph. */
	subgraph: SubGraph;
	/** Matching symbols found for the entity. */
	matchedSymbols: SymbolInfo[];
}
