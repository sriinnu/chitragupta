/**
 * MCP Tools -- Netra (Repo Map + AST Query).
 *
 * Exposes the repo map generator and AST query tools from @chitragupta/netra
 * as MCP tools. The repo map tool scans the project directory and returns a
 * compact summary. The AST query tool provides structured code intelligence
 * for surgical edits — agents query symbols instead of reading full files.
 *
 * @module
 */

import path from "node:path";
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { FileAst, AstIndex as AstIndexType } from "@chitragupta/netra";

/**
 * Create the `repo_map` MCP tool.
 *
 * Calls {@link generateRepoMap} from `@chitragupta/netra` to produce a
 * file-tree summary with exported symbols. Returns both a human-readable
 * text overview and structured entry data.
 *
 * @param projectPath - Absolute path to the project root directory.
 * @returns An MCP tool handler for `repo_map`.
 */
export function createRepoMapTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "repo_map",
			description:
				"Generate a compact file-tree summary of the project directory, " +
				"highlighting key source files and their exports. Useful for giving " +
				"LLM planners a quick overview of the codebase structure.",
			inputSchema: {
				type: "object",
				properties: {
					maxFiles: {
						type: "number",
						description: "Maximum number of files to include. Default: 50, max: 200.",
					},
					extensions: {
						type: "array",
						items: { type: "string" },
						description:
							'File extensions to include (e.g. [".ts", ".py"]). ' +
							"Default: .ts, .tsx, .js, .jsx, .py, .rs, .go",
					},
					query: {
						type: "string",
						description:
							"Optional query to filter files by path substring. " +
							"When provided, only files whose path contains the query are included.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { generateRepoMap } = await import("@chitragupta/netra");

				const maxFiles = args.maxFiles != null
					? Math.min(200, Math.max(1, Number(args.maxFiles) || 50))
					: undefined;

				const extensions = Array.isArray(args.extensions)
					? (args.extensions as string[]).filter((e) => typeof e === "string" && e.startsWith("."))
					: undefined;

				const result = generateRepoMap(projectPath, { maxFiles, extensions });

				// Optional query filter: narrow entries by path substring
				const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
				if (query) {
					const filtered = result.entries.filter((e) =>
						e.filePath.toLowerCase().includes(query),
					);
					const lines = [
						`Repository Map (query: "${query}", ${filtered.length} of ${result.totalFiles} files):`,
					];
					for (const entry of filtered) {
						const exportStr = entry.exports.length > 0 ? ` [${entry.exports.join(", ")}]` : "";
						lines.push(`  ${entry.filePath}${exportStr}`);
					}
					if (filtered.length === 0) {
						lines.push("  (no files matched the query)");
					}

					return {
						content: [{ type: "text", text: lines.join("\n") }],
						_metadata: {
							typed: {
								totalFiles: result.totalFiles,
								matchedFiles: filtered.length,
								entries: filtered,
							},
						},
					};
				}

				return {
					content: [{ type: "text", text: result.text }],
					_metadata: {
						typed: {
							totalFiles: result.totalFiles,
							shownFiles: result.entries.length,
							entries: result.entries,
						},
					},
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `repo_map failed: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}

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
