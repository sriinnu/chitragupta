/**
 * @chitragupta/yantra — Memory management tool.
 *
 * Chitragupta-specific tool for reading, writing, appending, and searching
 * memory files. Memory is scoped to global, project, or agent levels.
 *
 * For now, directly reads/writes .md files under the Chitragupta data
 * directory. In the future, this will delegate to @chitragupta/smriti's
 * MemoryStore for vector search and GraphRAG integration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

type MemoryAction = "read" | "write" | "append" | "search";
type MemoryScope = "global" | "project" | "agent";

/**
 * Resolve the base directory for Chitragupta data.
 */
function getChitraguptaDir(): string {
	return path.join(os.homedir(), ".chitragupta");
}

/**
 * Resolve the memory file path based on scope.
 */
function getMemoryPath(scope: MemoryScope, context: ToolContext): string {
	const base = getChitraguptaDir();

	switch (scope) {
		case "global":
			return path.join(base, "memory", "global.md");
		case "project": {
			// Hash the working directory to create a project-specific memory file
			const projectName = path.basename(context.workingDirectory);
			return path.join(base, "memory", "projects", `${projectName}.md`);
		}
		case "agent":
			return path.join(base, "memory", "agents", `${context.sessionId}.md`);
	}
}

/**
 * Simple text search across memory files in a scope directory.
 */
async function searchMemory(
	query: string,
	scope: MemoryScope,
	context: ToolContext,
): Promise<string[]> {
	const base = getChitraguptaDir();
	const results: string[] = [];

	let searchDir: string;
	switch (scope) {
		case "global":
			searchDir = path.join(base, "memory");
			break;
		case "project":
			searchDir = path.join(base, "memory", "projects");
			break;
		case "agent":
			searchDir = path.join(base, "memory", "agents");
			break;
	}

	try {
		const stat = await fs.promises.stat(searchDir);
		if (!stat.isDirectory()) return results;
	} catch {
		return results;
	}

	const queryLower = query.toLowerCase();
	const files = await fs.promises.readdir(searchDir);

	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		const filePath = path.join(searchDir, file);

		try {
			const stat = await fs.promises.stat(filePath);
			if (!stat.isFile()) continue;

			const content = await fs.promises.readFile(filePath, "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].toLowerCase().includes(queryLower)) {
					results.push(`[${file}:${i + 1}] ${lines[i].trim()}`);
				}
			}
		} catch {
			continue;
		}
	}

	return results;
}

/**
 * Memory management tool handler.
 *
 * Reads, writes, appends, or searches Chitragupta memory files.
 * Memory is scoped to global, project, or agent levels.
 *
 * @example
 * ```ts
 * const result = await memoryTool.execute(
 *   { action: "read", scope: "project" },
 *   context,
 * );
 * ```
 */
export const memoryTool: ToolHandler = {
	definition: {
		name: "memory",
		description:
			"Read, write, append, or search Chitragupta memory. Memory is scoped " +
			"to global (shared across all projects), project (specific to the " +
			"current workspace), or agent (specific to the current session).",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["read", "write", "append", "search"],
					description: "The memory operation to perform.",
				},
				scope: {
					type: "string",
					enum: ["global", "project", "agent"],
					description: "The memory scope to operate on.",
				},
				content: {
					type: "string",
					description: "Content to write or append. Required for 'write' and 'append' actions.",
				},
				query: {
					type: "string",
					description: "Search query. Required for 'search' action.",
				},
			},
			required: ["action", "scope"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const action = args.action as MemoryAction | undefined;
		const scope = args.scope as MemoryScope | undefined;

		if (!action) {
			return { content: "Error: 'action' argument is required.", isError: true };
		}
		if (!scope) {
			return { content: "Error: 'scope' argument is required.", isError: true };
		}

		const validActions: MemoryAction[] = ["read", "write", "append", "search"];
		if (!validActions.includes(action)) {
			return { content: `Error: Invalid action '${action}'. Must be one of: ${validActions.join(", ")}`, isError: true };
		}

		const validScopes: MemoryScope[] = ["global", "project", "agent"];
		if (!validScopes.includes(scope)) {
			return { content: `Error: Invalid scope '${scope}'. Must be one of: ${validScopes.join(", ")}`, isError: true };
		}

		const memoryPath = getMemoryPath(scope, context);

		switch (action) {
			case "read": {
				try {
					const content = await fs.promises.readFile(memoryPath, "utf-8");
					return {
						content: content || "(empty memory file)",
						metadata: { path: memoryPath, scope },
					};
				} catch (error) {
					const err = error as NodeJS.ErrnoException;
					if (err.code === "ENOENT") {
						return {
							content: `No memory found for scope '${scope}'. Memory file does not exist yet.`,
							metadata: { path: memoryPath, scope, exists: false },
						};
					}
					return { content: `Error reading memory: ${err.message}`, isError: true };
				}
			}

			case "write": {
				const content = args.content as string | undefined;
				if (content === undefined || content === null) {
					return { content: "Error: 'content' argument is required for 'write' action.", isError: true };
				}

				try {
					await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true });
					await fs.promises.writeFile(memoryPath, content, "utf-8");
					return {
						content: `Memory written to ${scope} scope (${content.length} chars).`,
						metadata: { path: memoryPath, scope, size: content.length },
					};
				} catch (error) {
					return { content: `Error writing memory: ${(error as Error).message}`, isError: true };
				}
			}

			case "append": {
				const content = args.content as string | undefined;
				if (content === undefined || content === null) {
					return { content: "Error: 'content' argument is required for 'append' action.", isError: true };
				}

				try {
					await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true });

					let existing = "";
					try {
						existing = await fs.promises.readFile(memoryPath, "utf-8");
					} catch {
						// File doesn't exist yet, that's fine
					}

					const separator = existing && !existing.endsWith("\n") ? "\n" : "";
					const newContent = existing + separator + content;
					await fs.promises.writeFile(memoryPath, newContent, "utf-8");

					return {
						content: `Memory appended to ${scope} scope (+${content.length} chars, total ${newContent.length} chars).`,
						metadata: { path: memoryPath, scope, appended: content.length, total: newContent.length },
					};
				} catch (error) {
					return { content: `Error appending memory: ${(error as Error).message}`, isError: true };
				}
			}

			case "search": {
				const query = args.query as string | undefined;
				if (!query) {
					return { content: "Error: 'query' argument is required for 'search' action.", isError: true };
				}

				try {
					const results = await searchMemory(query, scope, context);

					if (results.length === 0) {
						return {
							content: `No matches found in ${scope} memory for: ${query}`,
							metadata: { scope, matchCount: 0 },
						};
					}

					return {
						content: `Found ${results.length} match(es) in ${scope} memory:\n\n${results.join("\n")}`,
						metadata: { scope, matchCount: results.length },
					};
				} catch (error) {
					return { content: `Error searching memory: ${(error as Error).message}`, isError: true };
				}
			}

			default:
				return { content: `Error: Unknown action '${action}'.`, isError: true };
		}
	},
};
