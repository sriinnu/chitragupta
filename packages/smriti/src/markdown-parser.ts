/**
 * @chitragupta/smriti — Markdown parser for session files.
 *
 * Parses session .md files with YAML frontmatter, turn sections,
 * and tool call blocks into structured Session objects.
 */

import { SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionTurn, SessionToolCall } from "./types.js";

/**
 * Parse YAML frontmatter between --- delimiters into a key-value map.
 * Handles simple scalar values, arrays (both inline and multi-line), and null.
 */
function parseFrontmatter(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yaml.split("\n");
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// Multi-line array item: "  - value"
		if (trimmed.startsWith("- ") && currentKey && currentArray !== null) {
			currentArray.push(trimmed.slice(2).trim());
			continue;
		}

		// Flush any pending array
		if (currentKey && currentArray !== null) {
			result[currentKey] = currentArray;
			currentArray = null;
			currentKey = null;
		}

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1).trim();

		if (rawValue === "" || rawValue === undefined) {
			// Could be start of a multi-line array
			currentKey = key;
			currentArray = [];
			continue;
		}

		// Inline array: [a, b, c]
		if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			const inner = rawValue.slice(1, -1);
			if (inner.trim() === "") {
				result[key] = [];
			} else {
				result[key] = inner.split(",").map((s) => parseScalar(s.trim()));
			}
			continue;
		}

		result[key] = parseScalar(rawValue);
	}

	// Flush any pending array at end
	if (currentKey && currentArray !== null) {
		result[currentKey] = currentArray;
	}

	return result;
}

/**
 * Parse a scalar YAML value: numbers, booleans, null, quoted strings, bare strings.
 */
function parseScalar(value: string): string | number | boolean | null {
	if (value === "null" || value === "~") return null;
	if (value === "true") return true;
	if (value === "false") return false;

	// Quoted strings — unescape \" inside double-quoted values (written by writeFrontmatter)
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\"/g, '"');
	}
	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}

	// Numbers
	const num = Number(value);
	if (!Number.isNaN(num) && value !== "") return num;

	return value;
}

/**
 * Parse a session Markdown file into a structured {@link Session} object.
 *
 * Extracts YAML frontmatter as session metadata and parses `## Turn N` sections
 * as conversation turns, including tool calls within `### Tool:` subsections.
 *
 * @param content - The raw Markdown string to parse.
 * @returns A fully parsed {@link Session} with metadata and turns.
 * @throws {SessionError} If the content is empty, non-string, or missing frontmatter.
 *
 * @example
 * ```ts
 * const session = parseSessionMarkdown(fs.readFileSync("session.md", "utf-8"));
 * console.log(session.meta.title, session.turns.length);
 * ```
 */
export function parseSessionMarkdown(content: string): Session {
	if (!content || typeof content !== "string") {
		throw new SessionError("Cannot parse empty or non-string session content");
	}

	// ─── Extract frontmatter ────────────────────────────────────────────
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) {
		throw new SessionError("Session file missing YAML frontmatter (--- delimiters)");
	}

	const rawMeta = parseFrontmatter(fmMatch[1]);
	const meta = buildSessionMeta(rawMeta);

	// ─── Extract body (everything after frontmatter) ────────────────────
	const body = content.slice(fmMatch[0].length).trim();

	// ─── Split into turn sections ───────────────────────────────────────
	const turns = parseTurns(body);

	return { meta, turns };
}

/**
 * Build a SessionMeta from parsed frontmatter key-value pairs.
 */
function buildSessionMeta(raw: Record<string, unknown>): SessionMeta {
	return {
		id: String(raw.id ?? ""),
		title: String(raw.title ?? "Untitled Session"),
		created: String(raw.created ?? new Date().toISOString()),
		updated: String(raw.updated ?? new Date().toISOString()),
		agent: String(raw.agent ?? "chitragupta"),
		model: String(raw.model ?? "unknown"),
		project: String(raw.project ?? ""),
		parent: raw.parent != null ? String(raw.parent) : null,
		branch: raw.branch != null ? String(raw.branch) : null,
		tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
		totalCost: Number(raw.totalCost ?? 0),
		totalTokens: Number(raw.totalTokens ?? 0),
	};
}

/**
 * Parse the body of a session file into SessionTurn objects.
 * Turns are delimited by `## Turn N — role` headings.
 */
function parseTurns(body: string): SessionTurn[] {
	if (!body) return [];

	// Strip the metadata footer before parsing turns so it doesn't
	// bleed into the last turn's content.
	body = stripFooter(body);

	const turnPattern = /^## Turn (\d+) — (user|assistant)(?:\s+\(([^)]*)\))?/gm;
	const turns: SessionTurn[] = [];
	const matches: { index: number; turnNumber: number; role: "user" | "assistant"; meta?: string }[] = [];

	let match: RegExpExecArray | null;
	while ((match = turnPattern.exec(body)) !== null) {
		matches.push({
			index: match.index,
			turnNumber: parseInt(match[1], 10),
			role: match[2] as "user" | "assistant",
			meta: match[3],
		});
	}

	for (let i = 0; i < matches.length; i++) {
		const m = matches[i];
		const headerEnd = body.indexOf("\n", m.index);
		const contentStart = headerEnd + 1;
		const contentEnd = i + 1 < matches.length ? matches[i + 1].index : body.length;
		const rawContent = body.slice(contentStart, contentEnd).trim();

		// Parse optional agent/model from meta like "agent: foo, model: bar"
		let agent: string | undefined;
		let model: string | undefined;
		if (m.meta) {
			const parts = m.meta.split(",").map((s) => s.trim());
			for (const part of parts) {
				const [k, v] = part.split(":").map((s) => s.trim());
				if (k === "agent") agent = v;
				if (k === "model") model = v;
			}
		}

		// Separate content from tool calls
		const { content, toolCalls } = parseContentAndToolCalls(rawContent);

		// Unescape escaped turn boundaries in content
		const unescapedContent = content
			.replace(/^\\(## Turn \d+)/gm, '$1')
			.replace(/^\\---$/gm, '---')
			.replace(/\\<\/(details|summary)>/gi, '</$1>');

		const turn: SessionTurn = {
			turnNumber: m.turnNumber,
			role: m.role,
			content: unescapedContent,
		};
		if (agent) turn.agent = agent;
		if (model) turn.model = model;
		if (toolCalls.length > 0) turn.toolCalls = toolCalls;

		turns.push(turn);
	}

	return turns;
}

/**
 * Strip the session footer from the body.
 *
 * The footer written by {@link writeSessionMarkdown} has the form:
 *
 *     ---
 *
 *     *Session <id> | <agent> | <model> | Cost: $<n> | Tokens: <n>*
 *
 * If present at the end of the body, remove it so it doesn't bleed into
 * the last turn's content.
 */
function stripFooter(body: string): string {
	// Match trailing: \n---\n\n*Session ...*\n (with optional trailing whitespace)
	const footerPattern = /\n---\n\n\*Session [^*]+\*\s*$/;
	return body.replace(footerPattern, "");
}

/**
 * Separate turn content from tool call sections.
 * Tool calls begin with `### Tool: <name>`.
 */
function parseContentAndToolCalls(raw: string): { content: string; toolCalls: SessionToolCall[] } {
	const toolPattern = /^### Tool: (.+)$/gm;
	const toolMatches: { index: number; name: string }[] = [];

	let match: RegExpExecArray | null;
	while ((match = toolPattern.exec(raw)) !== null) {
		toolMatches.push({ index: match.index, name: match[1].trim() });
	}

	if (toolMatches.length === 0) {
		return { content: raw, toolCalls: [] };
	}

	// Content is everything before the first tool section
	const content = raw.slice(0, toolMatches[0].index).trim();
	const toolCalls: SessionToolCall[] = [];

	for (let i = 0; i < toolMatches.length; i++) {
		const tm = toolMatches[i];
		const headerEnd = raw.indexOf("\n", tm.index);
		const sectionStart = headerEnd + 1;
		const sectionEnd = i + 1 < toolMatches.length ? toolMatches[i + 1].index : raw.length;
		const section = raw.slice(sectionStart, sectionEnd).trim();

		toolCalls.push(parseToolCallSection(tm.name, section));
	}

	return { content, toolCalls };
}

/**
 * Parse a single tool call section, extracting input and result.
 *
 * Expected format:
 * ```
 * **Input:**
 * ```json
 * { ... }
 * ```
 *
 * <details>
 * <summary>Result</summary>
 *
 * ```
 * ...
 * ```
 *
 * </details>
 * ```
 */
function parseToolCallSection(name: string, section: string): SessionToolCall {
	let input = "";
	let result = "";
	let isError = false;

	// Extract input: between **Input:** and the next section (<details> or end)
	const inputMatch = section.match(/\*\*Input:\*\*\s*\n```(?:json)?\n([\s\S]*?)```/);
	if (inputMatch) {
		input = inputMatch[1].trim();
	}

	// Extract result from <details> block
	const detailsMatch = section.match(/<details>\s*\n<summary>(.*?)<\/summary>\s*\n([\s\S]*?)<\/details>/);
	if (detailsMatch) {
		const summaryText = detailsMatch[1].trim();
		isError = summaryText.toLowerCase().includes("error");

		// Extract content from code block inside details, or raw text
		const codeMatch = detailsMatch[2].match(/```(?:\w*)\n([\s\S]*?)```/);
		if (codeMatch) {
			result = codeMatch[1].trim();
		} else {
			result = detailsMatch[2].trim();
		}
	}

	const toolCall: SessionToolCall = { name, input, result };
	if (isError) toolCall.isError = true;
	return toolCall;
}
