/**
 * @chitragupta/cli — Session management commands.
 *
 * Handles listing, displaying, searching, exporting, and importing sessions
 * stored in ~/.chitragupta/sessions/.
 */

import fs from "fs";
import path from "path";
import {
	listSessions,
	loadSession,
	saveSession,
} from "@chitragupta/smriti/session-store";
import {
	exportSessionToJson,
	exportSessionToMarkdown,
	importSessionFromJson,
	detectExportFormat,
} from "@chitragupta/smriti/session-export";
import type { SessionMeta } from "@chitragupta/smriti/types";
import {
	bold,
	green,
	gray,
	cyan,
	dim,
	yellow,
	red,
} from "@chitragupta/ui/ansi";

/**
 * Format a date string for display.
 */
function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffHours = diffMs / (1000 * 60 * 60);

		if (diffHours < 1) {
			const mins = Math.floor(diffMs / (1000 * 60));
			return `${mins}m ago`;
		}
		if (diffHours < 24) {
			return `${Math.floor(diffHours)}h ago`;
		}
		if (diffHours < 24 * 7) {
			return `${Math.floor(diffHours / 24)}d ago`;
		}

		return d.toISOString().split("T")[0];
	} catch {
		return iso;
	}
}

/**
 * Format a session meta entry for list display.
 */
function formatSessionEntry(meta: SessionMeta, index: number): string {
	const lines: string[] = [];
	const dateStr = formatDate(meta.updated);
	const cost = meta.totalCost > 0 ? dim(` $${meta.totalCost.toFixed(4)}`) : "";

	lines.push(
		`  ${gray(`${index + 1}.`)} ${bold(meta.title)} ${gray("\u2014")} ${cyan(meta.id)}`,
	);
	lines.push(
		`     ${dim(meta.agent)} ${gray("|")} ${dim(meta.model)} ${gray("|")} ${dim(dateStr)}${cost}`,
	);

	if (meta.tags.length > 0) {
		lines.push(`     ${gray("tags:")} ${meta.tags.map((t) => dim(t)).join(", ")}`);
	}

	return lines.join("\n");
}

/**
 * List sessions for the current project (or all projects).
 */
export async function list(project?: string): Promise<void> {
	const projectPath = project ?? process.cwd();
	const sessions = listSessions(projectPath);

	if (sessions.length === 0) {
		process.stdout.write(
			"\n" + yellow("  No sessions found for this project.") + "\n" +
			gray("  Start a conversation to create your first session.\n\n"),
		);
		return;
	}

	process.stdout.write("\n" + bold("Sessions") + gray(` (${sessions.length})`) + "\n\n");

	for (let i = 0; i < sessions.length; i++) {
		process.stdout.write(formatSessionEntry(sessions[i], i) + "\n\n");
	}

	process.stdout.write(
		gray("  Use `chitragupta session show <id>` to view a session.\n\n"),
	);
}

/**
 * Display a full session transcript.
 */
export async function show(sessionId: string, project?: string): Promise<void> {
	const projectPath = project ?? process.cwd();

	try {
		const session = loadSession(sessionId, projectPath);

		process.stdout.write("\n" + bold(session.meta.title) + "\n");
		process.stdout.write(
			gray(`  ${session.meta.id} | ${session.meta.agent} | ${session.meta.model}\n`),
		);
		process.stdout.write(
			gray(`  Created: ${session.meta.created} | Updated: ${session.meta.updated}\n`),
		);

		if (session.meta.totalCost > 0) {
			process.stdout.write(
				gray(`  Cost: $${session.meta.totalCost.toFixed(4)} | Tokens: ${session.meta.totalTokens}\n`),
			);
		}

		process.stdout.write("\n");

		for (const turn of session.turns) {
			const roleColor = turn.role === "user" ? cyan : green;
			const roleLabel = turn.role === "user" ? "You" : session.meta.agent;
			const modelTag = turn.model ? gray(` [${turn.model}]`) : "";

			process.stdout.write(bold(roleColor(`  ${roleLabel}`)) + modelTag + "\n");
			process.stdout.write("\n");

			// Indent content
			const lines = turn.content.split("\n");
			for (const line of lines) {
				process.stdout.write(`  ${line}\n`);
			}

			// Show tool calls if present
			if (turn.toolCalls && turn.toolCalls.length > 0) {
				process.stdout.write("\n");
				for (const tc of turn.toolCalls) {
					const errorTag = tc.isError ? red(" [error]") : "";
					process.stdout.write(dim(`    [tool: ${tc.name}]`) + errorTag + "\n");
				}
			}

			process.stdout.write("\n");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`\n  Error: ${message}\n\n`));
		process.exit(1);
	}
}

/**
 * Search sessions by query string.
 *
 * Performs a simple text search across session titles and turn content.
 */
export async function search(query: string, project?: string): Promise<void> {
	const projectPath = project ?? process.cwd();
	const allSessions = listSessions(projectPath);
	const lowerQuery = query.toLowerCase();

	if (allSessions.length === 0) {
		process.stdout.write(yellow("\n  No sessions to search.\n\n"));
		return;
	}

	process.stdout.write(
		"\n" + bold("Search Results") + gray(` for "${query}"`) + "\n\n",
	);

	const matches: SessionMeta[] = [];

	for (const meta of allSessions) {
		// Check title
		if (meta.title.toLowerCase().includes(lowerQuery)) {
			matches.push(meta);
			continue;
		}

		// Check tags
		if (meta.tags.some((t) => t.toLowerCase().includes(lowerQuery))) {
			matches.push(meta);
			continue;
		}

		// Load full session and check turn content
		try {
			const session = loadSession(meta.id, projectPath);
			const hasMatch = session.turns.some((turn) =>
				turn.content.toLowerCase().includes(lowerQuery),
			);
			if (hasMatch) {
				matches.push(meta);
			}
		} catch {
			// Skip sessions that fail to load
		}
	}

	if (matches.length === 0) {
		process.stdout.write(yellow("  No matching sessions found.\n\n"));
		return;
	}

	for (let i = 0; i < matches.length; i++) {
		process.stdout.write(formatSessionEntry(matches[i], i) + "\n\n");
	}

	process.stdout.write(gray(`  ${matches.length} result(s) found.\n\n`));
}

/**
 * Export a session to a file.
 *
 * Supports JSON (lossless, re-importable) and Markdown (human-readable) formats.
 *
 * @param sessionId - Session to export.
 * @param format - Export format: "json" or "md".
 * @param output - Output file path. Defaults to `./<session-id>.<format>`.
 * @param project - Project path for session lookup.
 */
export async function exportSession(
	sessionId: string,
	format: string = "json",
	output?: string,
	project?: string,
): Promise<void> {
	const projectPath = project ?? process.cwd();

	try {
		const session = loadSession(sessionId, projectPath);

		let content: string;
		let ext: string;

		if (format === "md" || format === "markdown") {
			content = exportSessionToMarkdown(session);
			ext = "md";
		} else {
			const exported = exportSessionToJson(session);
			content = JSON.stringify(exported, null, "\t");
			ext = "json";
		}

		const outputPath = output ?? path.join(process.cwd(), `${sessionId}.${ext}`);
		const dir = path.dirname(outputPath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(outputPath, content, "utf-8");

		process.stdout.write(
			"\n" + green(`  Session exported successfully.`) + "\n" +
			dim(`  Format: ${ext}`) + "\n" +
			dim(`  File: ${outputPath}`) + "\n" +
			dim(`  Turns: ${session.turns.length}`) + "\n" +
			dim(`  Cost: $${session.meta.totalCost.toFixed(4)}`) + "\n\n",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`\n  Error: ${message}\n\n`));
		process.exit(1);
	}
}

/**
 * Import a session from an exported file.
 *
 * Only JSON format is supported for import (Markdown export is lossy).
 * The imported session is saved to the local session store.
 *
 * @param filePath - Path to the export file.
 * @param project - Project path for session storage.
 */
export async function importSession(
	filePath: string,
	project?: string,
): Promise<void> {
	const projectPath = project ?? process.cwd();

	try {
		const resolvedPath = path.resolve(filePath);

		if (!fs.existsSync(resolvedPath)) {
			process.stderr.write(red(`\n  Error: File not found: ${resolvedPath}\n\n`));
			process.exit(1);
		}

		const content = fs.readFileSync(resolvedPath, "utf-8");
		const format = detectExportFormat(content);

		if (format === "unknown") {
			process.stderr.write(
				red("\n  Error: Unrecognized file format.") + "\n" +
				dim("  Only JSON exports can be imported.\n\n"),
			);
			process.exit(1);
		}

		if (format === "markdown") {
			process.stderr.write(
				red("\n  Error: Markdown exports cannot be imported.") + "\n" +
				dim("  Use JSON format for lossless round-trip export/import.\n\n"),
			);
			process.exit(1);
		}

		const session = importSessionFromJson(content);

		// Override the project path so it saves in the right directory
		session.meta.project = projectPath;

		saveSession(session);

		process.stdout.write(
			"\n" + green(`  Session imported successfully.`) + "\n" +
			dim(`  ID: ${session.meta.id}`) + "\n" +
			dim(`  Title: ${session.meta.title}`) + "\n" +
			dim(`  Turns: ${session.turns.length}`) + "\n" +
			dim(`  Model: ${session.meta.model}`) + "\n\n",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`\n  Error: ${message}\n\n`));
		process.exit(1);
	}
}
