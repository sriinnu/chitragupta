/**
 * @chitragupta/yantra — Session management tool.
 *
 * Provides session operations within the agent: listing sessions,
 * showing session details, searching session content, and branching.
 *
 * Reads session markdown files from the Chitragupta data directory.
 * Sessions are stored as .md files with YAML frontmatter.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";

type SessionAction = "list" | "show" | "search" | "branch";

/**
 * Resolve the sessions directory.
 */
function getSessionsDir(): string {
	return path.join(os.homedir(), ".chitragupta", "sessions");
}

/**
 * Parse minimal session metadata from frontmatter without pulling
 * in the full @chitragupta/smriti parser. We just need the YAML header.
 */
function parseMinimalFrontmatter(content: string): Record<string, string> {
	const meta: Record<string, string> = {};
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return meta;

	const lines = fmMatch[1].split("\n");
	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		if (key && value) meta[key] = value;
	}

	return meta;
}

/**
 * List all session files with their metadata.
 */
async function listSessions(): Promise<string> {
	const dir = getSessionsDir();

	try {
		await fs.promises.stat(dir);
	} catch {
		return "No sessions found. Sessions directory does not exist yet.";
	}

	const files = await fs.promises.readdir(dir);
	const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();

	if (mdFiles.length === 0) {
		return "No sessions found.";
	}

	const entries: string[] = [];

	for (const file of mdFiles.slice(0, 50)) {
		try {
			const content = await fs.promises.readFile(path.join(dir, file), "utf-8");
			const meta = parseMinimalFrontmatter(content);
			const id = meta.id || file.replace(".md", "");
			const title = meta.title || "Untitled";
			const created = meta.created || "unknown";
			const model = meta.model || "unknown";
			entries.push(`  ${id}  ${created}  ${model}  ${title}`);
		} catch {
			entries.push(`  ${file.replace(".md", "")}  (could not read)`);
		}
	}

	let output = `Sessions (${mdFiles.length} total):\n\n`;
	output += "  ID                                    Created              Model            Title\n";
	output += "  " + "-".repeat(90) + "\n";
	output += entries.join("\n");

	if (mdFiles.length > 50) {
		output += `\n\n  [Showing 50 of ${mdFiles.length} sessions]`;
	}

	return output;
}

/**
 * Show the contents of a specific session.
 */
async function showSession(sessionId: string): Promise<string> {
	const dir = getSessionsDir();
	const filePath = path.join(dir, `${sessionId}.md`);

	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		return content;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			// Try to find by partial match
			try {
				const files = await fs.promises.readdir(dir);
				const matches = files.filter((f) => f.includes(sessionId));
				if (matches.length === 1) {
					const content = await fs.promises.readFile(path.join(dir, matches[0]), "utf-8");
					return content;
				}
				if (matches.length > 1) {
					return `Multiple sessions match '${sessionId}':\n${matches.map((f) => "  " + f.replace(".md", "")).join("\n")}`;
				}
			} catch {
				// Fall through
			}
			return `Session not found: ${sessionId}`;
		}
		return `Error reading session: ${err.message}`;
	}
}

/**
 * Search across all sessions for a query string.
 */
async function searchSessions(query: string): Promise<string> {
	const dir = getSessionsDir();

	try {
		await fs.promises.stat(dir);
	} catch {
		return "No sessions found. Sessions directory does not exist yet.";
	}

	const files = await fs.promises.readdir(dir);
	const mdFiles = files.filter((f) => f.endsWith(".md"));
	const queryLower = query.toLowerCase();
	const results: string[] = [];

	for (const file of mdFiles) {
		try {
			const content = await fs.promises.readFile(path.join(dir, file), "utf-8");

			if (!content.toLowerCase().includes(queryLower)) continue;

			const meta = parseMinimalFrontmatter(content);
			const id = meta.id || file.replace(".md", "");
			const title = meta.title || "Untitled";

			// Find matching lines
			const lines = content.split("\n");
			const matchingLines: string[] = [];
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].toLowerCase().includes(queryLower)) {
					const preview = lines[i].trim().slice(0, 120);
					matchingLines.push(`    L${i + 1}: ${preview}`);
					if (matchingLines.length >= 3) break;
				}
			}

			results.push(`  ${id} — ${title}\n${matchingLines.join("\n")}`);

			if (results.length >= 20) break;
		} catch {
			continue;
		}
	}

	if (results.length === 0) {
		return `No sessions match query: ${query}`;
	}

	return `Found matches in ${results.length} session(s):\n\n${results.join("\n\n")}`;
}

/**
 * Create a branch from a session by copying it with a new ID.
 */
async function branchSession(
	sessionId: string,
	branchName: string,
): Promise<string> {
	const dir = getSessionsDir();
	const sourcePath = path.join(dir, `${sessionId}.md`);

	try {
		const content = await fs.promises.readFile(sourcePath, "utf-8");

		// Generate a branch session ID
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).slice(2, 8);
		const branchId = `${branchName}-${timestamp}-${random}`;
		const branchPath = path.join(dir, `${branchId}.md`);

		// Update frontmatter with branch info
		let branchedContent = content;
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (fmMatch) {
			const now = new Date().toISOString();
			let newFm = fmMatch[1];
			// Replace or add fields
			newFm = newFm.replace(/^id:.*$/m, `id: ${branchId}`);
			newFm = newFm.replace(/^updated:.*$/m, `updated: ${now}`);

			if (/^parent:/.test(newFm)) {
				newFm = newFm.replace(/^parent:.*$/m, `parent: ${sessionId}`);
			} else {
				newFm += `\nparent: ${sessionId}`;
			}

			if (/^branch:/.test(newFm)) {
				newFm = newFm.replace(/^branch:.*$/m, `branch: ${branchName}`);
			} else {
				newFm += `\nbranch: ${branchName}`;
			}

			branchedContent = `---\n${newFm}\n---` + content.slice(fmMatch[0].length);
		}

		await fs.promises.writeFile(branchPath, branchedContent, "utf-8");

		return `Session branched successfully.\n  Source: ${sessionId}\n  Branch: ${branchId}\n  Name: ${branchName}\n  File: ${branchPath}`;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return `Source session not found: ${sessionId}`;
		}
		return `Error branching session: ${err.message}`;
	}
}

/**
 * Session management tool handler.
 *
 * Lists all sessions, shows a specific session's content,
 * searches across sessions, or creates a branch from an existing session.
 *
 * @example
 * ```ts
 * const result = await sessionTool.execute(
 *   { action: "list" },
 *   context,
 * );
 * ```
 */
export const sessionTool: ToolHandler = {
	definition: {
		name: "session",
		description:
			"Manage Chitragupta sessions. List all sessions, show a specific session's " +
			"content, search across sessions, or branch from an existing session.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "show", "search", "branch"],
					description: "The session operation to perform.",
				},
				sessionId: {
					type: "string",
					description: "Session ID. Required for 'show' and 'branch' actions.",
				},
				query: {
					type: "string",
					description: "Search query. Required for 'search' action.",
				},
				branchName: {
					type: "string",
					description: "Name for the new branch. Required for 'branch' action.",
				},
			},
			required: ["action"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const action = args.action as SessionAction | undefined;

		if (!action) {
			return { content: "Error: 'action' argument is required.", isError: true };
		}

		const validActions: SessionAction[] = ["list", "show", "search", "branch"];
		if (!validActions.includes(action)) {
			return {
				content: `Error: Invalid action '${action}'. Must be one of: ${validActions.join(", ")}`,
				isError: true,
			};
		}

		switch (action) {
			case "list": {
				const result = await listSessions();
				return { content: result, metadata: { action } };
			}

			case "show": {
				const sessionId = args.sessionId as string | undefined;
				if (!sessionId) {
					return { content: "Error: 'sessionId' is required for 'show' action.", isError: true };
				}
				const result = await showSession(sessionId);
				return { content: result, metadata: { action, sessionId } };
			}

			case "search": {
				const query = args.query as string | undefined;
				if (!query) {
					return { content: "Error: 'query' is required for 'search' action.", isError: true };
				}
				const result = await searchSessions(query);
				return { content: result, metadata: { action, query } };
			}

			case "branch": {
				const sessionId = args.sessionId as string | undefined;
				const branchName = args.branchName as string | undefined;
				if (!sessionId) {
					return { content: "Error: 'sessionId' is required for 'branch' action.", isError: true };
				}
				if (!branchName) {
					return { content: "Error: 'branchName' is required for 'branch' action.", isError: true };
				}
				const result = await branchSession(sessionId, branchName);
				return { content: result, metadata: { action, sessionId, branchName } };
			}

			default:
				return { content: `Error: Unknown action '${action}'.`, isError: true };
		}
	},
};
