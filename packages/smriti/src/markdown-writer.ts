/**
 * @chitragupta/smriti — Markdown writer for session files.
 *
 * Generates human-readable Markdown files from Session objects,
 * with YAML frontmatter, turn sections, and collapsible tool results.
 */

import type { Session, SessionTurn, SessionToolCall, SessionMeta } from "./types.js";

/**
 * Generate YAML frontmatter string from SessionMeta.
 */
function writeFrontmatter(meta: SessionMeta): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`id: ${meta.id}`);
	lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
	lines.push(`created: ${meta.created}`);
	lines.push(`updated: ${meta.updated}`);
	lines.push(`agent: ${meta.agent}`);
	lines.push(`model: ${meta.model}`);
	lines.push(`project: ${meta.project}`);
	lines.push(`parent: ${meta.parent ?? "null"}`);
	lines.push(`branch: ${meta.branch ?? "null"}`);

	if (meta.tags.length === 0) {
		lines.push("tags: []");
	} else {
		lines.push("tags:");
		for (const tag of meta.tags) {
			lines.push(`  - ${tag}`);
		}
	}

	lines.push(`totalCost: ${meta.totalCost}`);
	lines.push(`totalTokens: ${meta.totalTokens}`);
	lines.push("---");
	return lines.join("\n");
}

/**
 * Write a single tool call as a Markdown section with collapsible result.
 */
function writeToolCall(toolCall: SessionToolCall): string {
	const lines: string[] = [];
	lines.push(`### Tool: ${toolCall.name}`);
	lines.push("");
	lines.push("**Input:**");
	lines.push("```json");
	lines.push(toolCall.input);
	lines.push("```");
	lines.push("");

	const summaryLabel = toolCall.isError ? "Error" : "Result";
	lines.push("<details>");
	lines.push(`<summary>${summaryLabel}</summary>`);
	lines.push("");
	lines.push("```");
	lines.push(toolCall.result);
	lines.push("```");
	lines.push("");
	lines.push("</details>");

	return lines.join("\n");
}

/**
 * Write a single turn as a Markdown section.
 */
function writeTurn(turn: SessionTurn): string {
	const lines: string[] = [];

	// Build the heading
	let heading = `## Turn ${turn.turnNumber} — ${turn.role}`;
	const metaParts: string[] = [];
	if (turn.agent) metaParts.push(`agent: ${turn.agent}`);
	if (turn.model) metaParts.push(`model: ${turn.model}`);
	if (metaParts.length > 0) {
		heading += ` (${metaParts.join(", ")})`;
	}

	lines.push(heading);
	lines.push("");
	// Escape lines that could be mistaken for turn boundaries
	const escaped = turn.content
		.replace(/^(## Turn \d+)/gm, '\\$1')
		.replace(/^---$/gm, '\\---')
		.replace(/<\/(details|summary)>/gi, '\\</$1>');
	lines.push(escaped);

	// Append tool calls if present
	if (turn.toolCalls && turn.toolCalls.length > 0) {
		lines.push("");
		for (const toolCall of turn.toolCalls) {
			lines.push(writeToolCall(toolCall));
			lines.push("");
		}
	}

	return lines.join("\n");
}

/**
 * Write a session metadata footer at the bottom of the file.
 */
function writeFooter(meta: SessionMeta): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push("");
	lines.push(`*Session ${meta.id} | ${meta.agent} | ${meta.model} | Cost: $${meta.totalCost.toFixed(4)} | Tokens: ${meta.totalTokens}*`);
	return lines.join("\n");
}

/**
 * Generate a complete session Markdown file from a {@link Session} object.
 *
 * Produces human-readable Markdown with:
 * - YAML frontmatter between `---` delimiters
 * - Turn sections with `## Turn N -- role` headings
 * - Tool calls with `### Tool:` headings and collapsible `<details>` result blocks
 * - A metadata footer with session ID, agent, cost, and token count
 *
 * @param session - The {@link Session} to serialize.
 * @returns The complete Markdown string.
 */
export function writeSessionMarkdown(session: Session): string {
	const parts: string[] = [];

	// Frontmatter
	parts.push(writeFrontmatter(session.meta));
	parts.push("");

	// Turns
	for (const turn of session.turns) {
		parts.push(writeTurn(turn));
		parts.push("");
	}

	// Footer
	parts.push(writeFooter(session.meta));
	parts.push("");

	return parts.join("\n");
}

/**
 * Write a single turn as Markdown, for appending to an existing session file.
 *
 * Produces only the turn section (heading + content + tool calls), without
 * frontmatter or footer.
 *
 * @param turn - The {@link SessionTurn} to serialize.
 * @returns The Markdown string for this turn only.
 */
export function writeTurnMarkdown(turn: SessionTurn): string {
	return writeTurn(turn);
}
