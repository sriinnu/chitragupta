/**
 * @chitragupta/netra — AST Regex Parsing Helpers.
 *
 * Stateless regex-based extraction functions for parsing TypeScript/JavaScript
 * source files into structured AST representations. No tree-sitter or native
 * dependencies. Used by {@link AstIndex} for indexing and diff computation.
 *
 * @module
 */

import type {
	FileAst,
	SymbolInfo,
	ImportInfo,
	ClassInfo,
	FunctionInfo,
	MethodInfo,
	SymbolKind,
} from "./ast-index-types.js";

// ─── Regex Patterns ────────────────────────────────────────────────────────

/** Match named import statements: import { a, b } from "..." */
const IMPORT_NAMED_RE = /^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/gm;
/** Match default import statements: import Foo from "..." */
const IMPORT_DEFAULT_RE = /^import\s+(\w+)\s+from\s+["']([^"']+)["']/gm;
/** Match namespace import statements: import * as X from "..." */
const IMPORT_NAMESPACE_RE = /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/gm;

/** Match function declarations (exported or not). */
const EXPORT_FUNC_RE = /^(export\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\(([^)]*)\)(?:\s*:\s*([^\n{]+))?/gm;
/** Match class declarations (exported, abstract, extends, implements). */
const EXPORT_CLASS_RE = /^(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/gm;
/** Match interface declarations. */
const EXPORT_IFACE_RE = /^(export\s+)?interface\s+(\w+)/gm;
/** Match type alias declarations. */
const EXPORT_TYPE_RE = /^(export\s+)?type\s+(\w+)\s*[=<]/gm;
/** Match variable declarations (const/let). */
const EXPORT_CONST_RE = /^(export\s+)?(const|let)\s+(\w+)(?:\s*:\s*([^\n=]+))?\s*=/gm;
/** Match enum declarations. */
const EXPORT_ENUM_RE = /^(export\s+)?enum\s+(\w+)/gm;
/** Match class methods (inside class bodies). */
const METHOD_RE = /^\s+(static\s+)?(async\s+)?(\w+)\s*\(([^)]*)\)/gm;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get the line number (1-based) for a character offset in content.
 * @param content - Full file content.
 * @param offset - Character offset.
 * @returns 1-based line number.
 */
function lineAt(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < content.length; i++) {
		if (content[i] === "\n") line++;
	}
	return line;
}

/** Reset a global regex so it can be reused safely. */
function resetRegex(re: RegExp): RegExp {
	return new RegExp(re.source, re.flags);
}

// ─── Extraction Functions ──────────────────────────────────────────────────

/** Extract all import statements from source content. */
export function extractImportStatements(content: string): ImportInfo[] {
	const imports: ImportInfo[] = [];

	let re = resetRegex(IMPORT_NAMED_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()?.trim() ?? "").filter(Boolean);
		imports.push({ source: m[2], names, isDefault: false, isNamespace: false, line: lineAt(content, m.index) });
	}

	re = resetRegex(IMPORT_DEFAULT_RE);
	while ((m = re.exec(content)) !== null) {
		if (!imports.some((i) => i.source === m![2] && i.line === lineAt(content, m!.index))) {
			imports.push({ source: m[2], names: [m[1]], isDefault: true, isNamespace: false, line: lineAt(content, m.index) });
		}
	}

	re = resetRegex(IMPORT_NAMESPACE_RE);
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[2], names: [m[1]], isDefault: false, isNamespace: true, line: lineAt(content, m.index) });
	}

	return imports;
}

/** Extract all function declarations from source content. */
export function extractFunctionDecls(content: string): FunctionInfo[] {
	const fns: FunctionInfo[] = [];
	const re = resetRegex(EXPORT_FUNC_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		fns.push({
			name: m[3],
			exported: !!m[1],
			isAsync: !!m[2],
			params: m[4].trim(),
			returnType: m[5]?.trim(),
			line: lineAt(content, m.index),
		});
	}
	return fns;
}

/**
 * Extract methods from a class body starting at the given offset.
 * Finds the opening brace and scans until the matching close brace.
 */
function extractMethodsForClass(content: string, classStart: number): MethodInfo[] {
	const methods: MethodInfo[] = [];
	const braceIdx = content.indexOf("{", classStart);
	if (braceIdx === -1) return methods;

	let depth = 1;
	let end = braceIdx + 1;
	while (end < content.length && depth > 0) {
		if (content[end] === "{") depth++;
		else if (content[end] === "}") depth--;
		end++;
	}

	const classBody = content.slice(braceIdx + 1, end - 1);
	const re = resetRegex(METHOD_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(classBody)) !== null) {
		const methodName = m[3];
		if (methodName === "constructor") continue;
		methods.push({
			name: methodName,
			isStatic: !!m[1],
			isAsync: !!m[2],
			params: m[4].trim(),
			line: lineAt(content, braceIdx + 1 + m.index),
		});
	}
	return methods;
}

/** Extract all class declarations with their methods. */
export function extractClassDecls(content: string): ClassInfo[] {
	const classes: ClassInfo[] = [];
	const re = resetRegex(EXPORT_CLASS_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const implements_ = m[5] ? m[5].split(",").map((s) => s.trim()).filter(Boolean) : [];
		const methods = extractMethodsForClass(content, m.index);
		classes.push({
			name: m[3],
			exported: !!m[1],
			isAbstract: !!m[2],
			extends: m[4],
			implements: implements_,
			methods,
			line: lineAt(content, m.index),
		});
	}
	return classes;
}

/** Extract variable declarations (const/let). */
export function extractVariableDecls(content: string): SymbolInfo[] {
	const vars: SymbolInfo[] = [];
	const re = resetRegex(EXPORT_CONST_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const kind: SymbolKind = m[2] === "const" ? "const" : "let";
		vars.push({ name: m[3], kind, exported: !!m[1], line: lineAt(content, m.index), typeAnnotation: m[4]?.trim() });
	}
	return vars;
}

/** Extract interface declarations. */
export function extractInterfaceDecls(content: string): SymbolInfo[] {
	const ifaces: SymbolInfo[] = [];
	const re = resetRegex(EXPORT_IFACE_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		ifaces.push({ name: m[2], kind: "interface", exported: !!m[1], line: lineAt(content, m.index) });
	}
	return ifaces;
}

/** Extract type alias declarations. */
export function extractTypeDecls(content: string): SymbolInfo[] {
	const types: SymbolInfo[] = [];
	const re = resetRegex(EXPORT_TYPE_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		types.push({ name: m[2], kind: "type", exported: !!m[1], line: lineAt(content, m.index) });
	}
	return types;
}

/** Extract enum declarations. */
export function extractEnumDecls(content: string): SymbolInfo[] {
	const enums: SymbolInfo[] = [];
	const re = resetRegex(EXPORT_ENUM_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		enums.push({ name: m[2], kind: "enum", exported: !!m[1], line: lineAt(content, m.index) });
	}
	return enums;
}

// ─── Aggregation ───────────────────────────────────────────────────────────

/** Collect all exported symbols from the various extraction results. */
export function collectExportedSymbols(
	fns: FunctionInfo[],
	classes: ClassInfo[],
	vars: SymbolInfo[],
	ifaces: SymbolInfo[],
	types: SymbolInfo[],
	enums: SymbolInfo[],
): SymbolInfo[] {
	const exports: SymbolInfo[] = [];
	for (const fn of fns) {
		if (fn.exported) exports.push({ name: fn.name, kind: "function", exported: true, line: fn.line, typeAnnotation: fn.returnType });
	}
	for (const cls of classes) {
		if (cls.exported) exports.push({ name: cls.name, kind: "class", exported: true, line: cls.line });
	}
	for (const v of vars) { if (v.exported) exports.push(v); }
	for (const i of ifaces) { if (i.exported) exports.push(i); }
	for (const t of types) { if (t.exported) exports.push(t); }
	for (const e of enums) { if (e.exported) exports.push(e); }
	return exports;
}

/**
 * Parse a single source file content into a FileAst.
 * @param filePath - The file path (for labeling, not read here).
 * @param content - The source code content.
 * @returns Parsed FileAst structure.
 */
export function parseFileContent(filePath: string, content: string): FileAst {
	const imports = extractImportStatements(content);
	const functions = extractFunctionDecls(content);
	const classes = extractClassDecls(content);
	const variables = extractVariableDecls(content);
	const interfaces = extractInterfaceDecls(content);
	const types = extractTypeDecls(content);
	const enums = extractEnumDecls(content);

	const allVars = [...variables, ...interfaces, ...types, ...enums];
	const exports = collectExportedSymbols(functions, classes, allVars, interfaces, types, enums);

	return { filePath, imports, exports, classes, functions, variables: allVars, lastIndexed: Date.now() };
}

/** Convert a FunctionInfo to a SymbolInfo for unified search. */
export function fnToSymbol(fn: FunctionInfo): SymbolInfo {
	return { name: fn.name, kind: "function", exported: fn.exported, line: fn.line, typeAnnotation: fn.returnType };
}

/** Convert a ClassInfo to a SymbolInfo for unified search. */
export function clsToSymbol(cls: ClassInfo): SymbolInfo {
	return { name: cls.name, kind: "class", exported: cls.exported, line: cls.line };
}

/**
 * Build a serialized signature for a symbol, used for diff comparison.
 * Two symbols with the same name but different signatures are "modified".
 */
export function symbolSignature(s: SymbolInfo): string {
	return `${s.kind}:${s.name}:${s.exported}:${s.typeAnnotation ?? ""}`;
}

/**
 * Rebuild a minimal source stub from a FileAst.
 * Used to generate "old content" for diff when only the AST was cached.
 */
export function rebuildStub(ast: FileAst): string {
	const lines: string[] = [];
	for (const imp of ast.imports) {
		if (imp.isNamespace) lines.push(`import * as ${imp.names[0]} from "${imp.source}";`);
		else if (imp.isDefault) lines.push(`import ${imp.names[0]} from "${imp.source}";`);
		else lines.push(`import { ${imp.names.join(", ")} } from "${imp.source}";`);
	}
	for (const fn of ast.functions) {
		const exp = fn.exported ? "export " : "";
		const async_ = fn.isAsync ? "async " : "";
		const ret = fn.returnType ? `: ${fn.returnType}` : "";
		lines.push(`${exp}${async_}function ${fn.name}(${fn.params})${ret} {}`);
	}
	for (const cls of ast.classes) {
		const exp = cls.exported ? "export " : "";
		const abs = cls.isAbstract ? "abstract " : "";
		const ext = cls.extends ? ` extends ${cls.extends}` : "";
		lines.push(`${exp}${abs}class ${cls.name}${ext} {}`);
	}
	for (const v of ast.variables) {
		const exp = v.exported ? "export " : "";
		const type = v.typeAnnotation ? `: ${v.typeAnnotation}` : "";
		lines.push(`${exp}${v.kind} ${v.name}${type} = undefined;`);
	}
	return lines.join("\n");
}
