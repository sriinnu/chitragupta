/**
 * MCP Tools -- Netra AST Query.
 *
 * Exposes the AST query tool from @chitragupta/netra as an MCP tool.
 * Provides structured code intelligence for surgical edits — agents
 * query symbols instead of reading full files.
 *
 * @module
 */

import path from "node:path";
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { FileAst, AstIndex as AstIndexType } from "@chitragupta/netra";

// ─── AST Query Formatting ──────────────────────────────────────────────────

/** Format a FileAst into a readable text summary. */
function formatFileAst(ast: FileAst): string {
	const lines: string[] = [`AST for ${ast.filePath}:`];
	if (ast.imports.length > 0) {
		lines.push(`\n  Imports (${ast.imports.length}):`);
		for (const imp of ast.imports) {
			const kind = imp.isDefault ? "default" : imp.isNamespace ? "namespace" : "named";
			lines.push(`    ${kind}: ${imp.names.join(", ")} from "${imp.source}" (line ${imp.line})`);
		}
	}
	if (ast.exports.length > 0) {
		lines.push(`\n  Exports (${ast.exports.length}):`);
		for (const exp of ast.exports) {
			const type = exp.typeAnnotation ? `: ${exp.typeAnnotation}` : "";
			lines.push(`    ${exp.kind} ${exp.name}${type} (line ${exp.line})`);
		}
	}
	if (ast.classes.length > 0) {
		lines.push(`\n  Classes (${ast.classes.length}):`);
		for (const cls of ast.classes) {
			const ext = cls.extends ? ` extends ${cls.extends}` : "";
			const impl = cls.implements.length > 0 ? ` implements ${cls.implements.join(", ")}` : "";
			lines.push(`    ${cls.exported ? "export " : ""}${cls.isAbstract ? "abstract " : ""}class ${cls.name}${ext}${impl} (line ${cls.line})`);
			for (const m of cls.methods) {
				lines.push(`      ${m.isStatic ? "static " : ""}${m.isAsync ? "async " : ""}${m.name}(${m.params}) (line ${m.line})`);
			}
		}
	}
	if (ast.functions.length > 0) {
		lines.push(`\n  Functions (${ast.functions.length}):`);
		for (const fn of ast.functions) {
			const ret = fn.returnType ? `: ${fn.returnType}` : "";
			lines.push(`    ${fn.exported ? "export " : ""}${fn.isAsync ? "async " : ""}function ${fn.name}(${fn.params})${ret} (line ${fn.line})`);
		}
	}
	if (ast.variables.length > 0) {
		lines.push(`\n  Variables (${ast.variables.length}):`);
		for (const v of ast.variables) {
			const type = v.typeAnnotation ? `: ${v.typeAnnotation}` : "";
			lines.push(`    ${v.exported ? "export " : ""}${v.kind} ${v.name}${type} (line ${v.line})`);
		}
	}
	return lines.join("\n");
}

// ─── AST Query Tool ────────────────────────────────────────────────────────

/** Shared AstIndex instance (lazily initialized per project). */
let cachedIndex: { projectPath: string; index: AstIndexType } | undefined;

/**
 * Create the `ast_query` MCP tool.
 *
 * Provides structured AST queries for source files — imports, exports,
 * classes, functions, and symbol search — without reading full file content.
 *
 * @param projectPath - Absolute path to the project root directory.
 * @returns An MCP tool handler for `ast_query`.
 */
export function createAstQueryTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "ast_query",
			description:
				"Query structured AST information for source files. Returns imports, " +
				"exports, classes, functions, and variables without reading full file " +
				"content. Supports symbol search across all indexed files.",
			inputSchema: {
				type: "object",
				properties: {
					file_path: {
						type: "string",
						description:
							"Relative or absolute file path to query. " +
							"If relative, resolved against the project root.",
					},
					symbol: {
						type: "string",
						description:
							"Symbol name to search for across all indexed files. " +
							"Returns all files containing this symbol.",
					},
					type: {
						type: "string",
						enum: ["exports", "imports", "classes", "functions"],
						description:
							"Filter results to a specific symbol type. " +
							"Requires file_path to be set.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { AstIndex } = await import("@chitragupta/netra");

				// Lazily initialize or reuse the index for this project
				if (!cachedIndex || cachedIndex.projectPath !== projectPath) {
					const idx = new AstIndex();
					await idx.indexDirectory(projectPath);
					cachedIndex = { projectPath, index: idx };
				}
				const idx = cachedIndex.index;

				const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
				const symbolName = typeof args.symbol === "string" ? args.symbol.trim() : "";
				const filterType = typeof args.type === "string" ? args.type.trim() : "";

				// Symbol search mode
				if (symbolName) {
					const locations = idx.querySymbol(symbolName);
					if (locations.length === 0) {
						return { content: [{ type: "text", text: `Symbol "${symbolName}" not found in indexed files.` }] };
					}
					const lines = [`Symbol "${symbolName}" found in ${locations.length} location(s):`];
					for (const loc of locations) {
						lines.push(`  ${loc.filePath} — ${loc.symbol.kind} (line ${loc.symbol.line}, ${loc.symbol.exported ? "exported" : "internal"})`);
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						_metadata: { typed: { symbol: symbolName, locations } },
					};
				}

				// File query mode
				if (filePath) {
					const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);
					let ast = idx.query(absPath);
					if (!ast) {
						// Try indexing the file on demand
						try { ast = await idx.indexFile(absPath); }
						catch { return { content: [{ type: "text", text: `File not found or unreadable: ${filePath}` }], isError: true }; }
					}

					// Filter by type if requested
					if (filterType === "exports") {
						const exports = idx.getExports(absPath);
						const lines = [`Exports for ${filePath} (${exports.length}):`];
						for (const e of exports) lines.push(`  ${e.kind} ${e.name}${e.typeAnnotation ? `: ${e.typeAnnotation}` : ""} (line ${e.line})`);
						return { content: [{ type: "text", text: lines.join("\n") }], _metadata: { typed: { exports } } };
					}
					if (filterType === "imports") {
						const imports = idx.getImports(absPath);
						const lines = [`Imports for ${filePath} (${imports.length}):`];
						for (const i of imports) lines.push(`  ${i.names.join(", ")} from "${i.source}" (line ${i.line})`);
						return { content: [{ type: "text", text: lines.join("\n") }], _metadata: { typed: { imports } } };
					}
					if (filterType === "classes") {
						const classes = idx.getClasses(absPath);
						const lines = [`Classes for ${filePath} (${classes.length}):`];
						for (const c of classes) {
							lines.push(`  ${c.exported ? "export " : ""}class ${c.name}${c.extends ? " extends " + c.extends : ""} (line ${c.line}, ${c.methods.length} methods)`);
						}
						return { content: [{ type: "text", text: lines.join("\n") }], _metadata: { typed: { classes } } };
					}
					if (filterType === "functions") {
						const functions = idx.getFunctions(absPath);
						const lines = [`Functions for ${filePath} (${functions.length}):`];
						for (const f of functions) {
							lines.push(`  ${f.exported ? "export " : ""}${f.isAsync ? "async " : ""}function ${f.name}(${f.params})${f.returnType ? ": " + f.returnType : ""} (line ${f.line})`);
						}
						return { content: [{ type: "text", text: lines.join("\n") }], _metadata: { typed: { functions } } };
					}

					// Full AST view
					return {
						content: [{ type: "text", text: formatFileAst(ast) }],
						_metadata: { typed: { ast } },
					};
				}

				// No file_path or symbol — return index summary
				return {
					content: [{ type: "text", text: `AST index contains ${idx.size} files. Provide file_path or symbol to query.` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `ast_query failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
