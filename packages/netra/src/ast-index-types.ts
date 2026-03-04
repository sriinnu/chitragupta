/**
 * @chitragupta/netra — AST Index Types.
 *
 * Type definitions for the regex-based AST indexing and diff system.
 * Used by {@link AstIndex} to provide structured code intelligence
 * without tree-sitter or other native dependencies.
 *
 * @module
 */

// ─── Symbol Types ──────────────────────────────────────────────────────────

/** The kind of symbol extracted from source code. */
export type SymbolKind =
	| "function"
	| "class"
	| "interface"
	| "type"
	| "const"
	| "let"
	| "enum"
	| "variable"
	| "method";

/** Information about a single symbol in a source file. */
export interface SymbolInfo {
	/** Symbol name (e.g., "MyClass", "doThing"). */
	name: string;
	/** Kind of symbol. */
	kind: SymbolKind;
	/** Whether this symbol is exported. */
	exported: boolean;
	/** Line number (1-based) where the symbol is declared. */
	line: number;
	/** Optional type annotation or return type. */
	typeAnnotation?: string;
}

/** Location of a symbol across indexed files. */
export interface SymbolLocation {
	/** Absolute or relative file path. */
	filePath: string;
	/** The symbol info at that location. */
	symbol: SymbolInfo;
}

// ─── Import Types ──────────────────────────────────────────────────────────

/** Information about an import statement. */
export interface ImportInfo {
	/** The module specifier (e.g., "./utils.js", "lodash"). */
	source: string;
	/** Named imports (e.g., ["foo", "bar"]). Empty for default/namespace. */
	names: string[];
	/** Whether this is a default import. */
	isDefault: boolean;
	/** Whether this is a namespace import (import * as X). */
	isNamespace: boolean;
	/** Line number (1-based). */
	line: number;
}

// ─── Class Types ───────────────────────────────────────────────────────────

/** Information about a method within a class. */
export interface MethodInfo {
	/** Method name. */
	name: string;
	/** Whether the method is async. */
	isAsync: boolean;
	/** Whether the method is static. */
	isStatic: boolean;
	/** Parameter string (e.g., "a: string, b: number"). */
	params: string;
	/** Line number (1-based). */
	line: number;
}

/** Information about a class declaration. */
export interface ClassInfo {
	/** Class name. */
	name: string;
	/** Whether this class is exported. */
	exported: boolean;
	/** Whether this is an abstract class. */
	isAbstract: boolean;
	/** Parent class name (extends). */
	extends?: string;
	/** Implemented interfaces. */
	implements: string[];
	/** Methods declared in the class. */
	methods: MethodInfo[];
	/** Line number (1-based). */
	line: number;
}

// ─── Function Types ────────────────────────────────────────────────────────

/** Information about a function declaration. */
export interface FunctionInfo {
	/** Function name. */
	name: string;
	/** Whether this function is exported. */
	exported: boolean;
	/** Whether this is an async function. */
	isAsync: boolean;
	/** Parameter string (e.g., "x: number, y: string"). */
	params: string;
	/** Return type annotation, if present. */
	returnType?: string;
	/** Line number (1-based). */
	line: number;
}

// ─── File AST ──────────────────────────────────────────────────────────────

/** The complete AST representation of a single source file. */
export interface FileAst {
	/** Absolute path to the file. */
	filePath: string;
	/** All import statements. */
	imports: ImportInfo[];
	/** All exported symbols. */
	exports: SymbolInfo[];
	/** All class declarations. */
	classes: ClassInfo[];
	/** All function declarations (top-level). */
	functions: FunctionInfo[];
	/** All variable declarations (const/let at top level). */
	variables: SymbolInfo[];
	/** Timestamp when this file was last indexed (ms since epoch). */
	lastIndexed: number;
}

// ─── Diff Types ────────────────────────────────────────────────────────────

/** A single entry in an AST diff describing one change. */
export interface DiffEntry {
	/** The symbol that changed. */
	symbol: SymbolInfo;
	/** Type of change. */
	changeType: "added" | "removed" | "modified";
}

/** The diff result between two versions of a file. */
export interface AstDiff {
	/** File path that was diffed. */
	filePath: string;
	/** Symbols that were added in the new version. */
	added: SymbolInfo[];
	/** Symbols that were removed from the old version. */
	removed: SymbolInfo[];
	/** Symbols that were modified (same name, different signature). */
	modified: SymbolInfo[];
}

// ─── Index Options ─────────────────────────────────────────────────────────

/** Options for directory indexing. */
export interface IndexOptions {
	/** File extensions to index. Default: [".ts", ".tsx", ".js", ".jsx"]. */
	extensions?: string[];
	/** Directories to exclude. Default: ["node_modules", "dist", ".git"]. */
	excludeDirs?: string[];
	/** Maximum directory depth to recurse. Default: 10. */
	maxDepth?: number;
	/** Maximum file size in bytes to index. Default: 100_000. */
	maxFileSize?: number;
}
