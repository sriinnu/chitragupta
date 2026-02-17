/**
 * @chitragupta/smriti — Session export/import.
 *
 * Export sessions to portable formats (JSON, Markdown).
 * Import sessions from exported JSON files.
 *
 * Preserves all data: messages, tool calls, metadata, and stats.
 * The JSON format is self-describing with a version number for
 * forward compatibility.
 */

import type { Session, SessionMeta, SessionTurn, SessionToolCall } from "./types.js";

// ─── Export Types ───────────────────────────────────────────────────────────

/** The portable JSON export format for a Chitragupta session. */
export interface ExportedSession {
	version: 1;
	exportedAt: string;
	session: {
		id: string;
		title: string;
		createdAt: string;
		updatedAt: string;
		model: string;
		agent: string;
		project: string;
		parent: string | null;
		branch: string | null;
		tags: string[];
		messages: ExportedMessage[];
		metadata?: Record<string, unknown>;
	};
	stats: {
		turnCount: number;
		totalCost: number;
		totalTokens: number;
	};
}

/** A single message in the exported format. */
export interface ExportedMessage {
	role: "user" | "assistant";
	content: string;
	turnNumber: number;
	agent?: string;
	model?: string;
	toolCalls?: ExportedToolCall[];
}

/** A tool call in the exported format. */
export interface ExportedToolCall {
	name: string;
	input: string;
	result: string;
	isError?: boolean;
}

// ─── Export: JSON ───────────────────────────────────────────────────────────

/**
 * Export a session to the portable JSON format.
 */
export function exportSessionToJson(session: Session): ExportedSession {
	const messages: ExportedMessage[] = session.turns.map((turn) => {
		const msg: ExportedMessage = {
			role: turn.role,
			content: turn.content,
			turnNumber: turn.turnNumber,
		};
		if (turn.agent) msg.agent = turn.agent;
		if (turn.model) msg.model = turn.model;
		if (turn.toolCalls && turn.toolCalls.length > 0) {
			msg.toolCalls = turn.toolCalls.map((tc) => {
				const exported: ExportedToolCall = {
					name: tc.name,
					input: tc.input,
					result: tc.result,
				};
				if (tc.isError) exported.isError = true;
				return exported;
			});
		}
		return msg;
	});

	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		session: {
			id: session.meta.id,
			title: session.meta.title,
			createdAt: session.meta.created,
			updatedAt: session.meta.updated,
			model: session.meta.model,
			agent: session.meta.agent,
			project: session.meta.project,
			parent: session.meta.parent,
			branch: session.meta.branch,
			tags: [...session.meta.tags],
			messages,
		},
		stats: {
			turnCount: session.turns.length,
			totalCost: session.meta.totalCost,
			totalTokens: session.meta.totalTokens,
		},
	};
}

// ─── Export: Markdown ───────────────────────────────────────────────────────

/**
 * Export a session to human-readable Markdown.
 *
 * The output is designed for reading, sharing, and archiving — not for
 * re-import (use JSON for lossless round-tripping).
 */
export function exportSessionToMarkdown(session: Session): string {
	const lines: string[] = [];

	// Header
	lines.push(`# Session: ${session.meta.title}`);
	lines.push("");
	lines.push(`**ID**: ${session.meta.id}  `);
	lines.push(`**Created**: ${session.meta.created}  `);
	lines.push(`**Updated**: ${session.meta.updated}  `);
	lines.push(`**Model**: ${session.meta.model}  `);
	lines.push(`**Agent**: ${session.meta.agent}  `);
	lines.push(`**Project**: ${session.meta.project}  `);
	lines.push(`**Turns**: ${session.turns.length}  `);
	lines.push(`**Cost**: $${session.meta.totalCost.toFixed(4)}  `);
	lines.push(`**Tokens**: ${session.meta.totalTokens}  `);

	if (session.meta.tags.length > 0) {
		lines.push(`**Tags**: ${session.meta.tags.join(", ")}  `);
	}

	if (session.meta.parent) {
		lines.push(`**Parent**: ${session.meta.parent}  `);
	}

	if (session.meta.branch) {
		lines.push(`**Branch**: ${session.meta.branch}  `);
	}

	lines.push("");
	lines.push("---");
	lines.push("");

	// Turns
	for (const turn of session.turns) {
		const roleLabel = turn.role === "user" ? "User" : "Assistant";
		lines.push(`## ${roleLabel}`);
		lines.push("");
		lines.push(turn.content);
		lines.push("");

		// Tool calls
		if (turn.toolCalls && turn.toolCalls.length > 0) {
			for (const tc of turn.toolCalls) {
				const errorTag = tc.isError ? " (error)" : "";
				lines.push(`### Tool: ${tc.name}${errorTag}`);
				lines.push("");
				lines.push("**Input:**");
				lines.push("```json");
				lines.push(tc.input);
				lines.push("```");
				lines.push("");
				lines.push("**Result:**");
				lines.push("```");
				lines.push(tc.result);
				lines.push("```");
				lines.push("");
			}
		}

		lines.push("---");
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Import: JSON ───────────────────────────────────────────────────────────

/**
 * Import a session from a JSON export file.
 *
 * Accepts either a raw JSON string or a pre-parsed ExportedSession object.
 * Validates the structure before converting to the internal Session format.
 *
 * @throws {Error} If the data is invalid or the version is unsupported.
 */
export function importSessionFromJson(data: string | ExportedSession): Session {
	let exported: ExportedSession;

	if (typeof data === "string") {
		try {
			exported = JSON.parse(data) as ExportedSession;
		} catch {
			throw new Error("Invalid JSON: could not parse session export file");
		}
	} else {
		exported = data;
	}

	// Validate structure
	validateExportedSession(exported);

	const meta: SessionMeta = {
		id: exported.session.id,
		title: exported.session.title,
		created: exported.session.createdAt,
		updated: exported.session.updatedAt,
		model: exported.session.model,
		agent: exported.session.agent,
		project: exported.session.project,
		parent: exported.session.parent ?? null,
		branch: exported.session.branch ?? null,
		tags: exported.session.tags ?? [],
		totalCost: exported.stats?.totalCost ?? 0,
		totalTokens: exported.stats?.totalTokens ?? 0,
	};

	const turns: SessionTurn[] = exported.session.messages.map((msg) => {
		const turn: SessionTurn = {
			turnNumber: msg.turnNumber,
			role: msg.role,
			content: msg.content,
		};
		if (msg.agent) turn.agent = msg.agent;
		if (msg.model) turn.model = msg.model;
		if (msg.toolCalls && msg.toolCalls.length > 0) {
			turn.toolCalls = msg.toolCalls.map((tc) => {
				const toolCall: SessionToolCall = {
					name: tc.name,
					input: tc.input,
					result: tc.result,
				};
				if (tc.isError) toolCall.isError = true;
				return toolCall;
			});
		}
		return turn;
	});

	return { meta, turns };
}

// ─── Format Detection ───────────────────────────────────────────────────────

/**
 * Detect the export format from file content.
 */
export function detectExportFormat(content: string): "json" | "markdown" | "unknown" {
	const trimmed = content.trimStart();

	// JSON starts with { or [
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object" && "version" in parsed && "session" in parsed) {
				return "json";
			}
		} catch {
			// Not valid JSON
		}
	}

	// Markdown starts with # Session: or has YAML frontmatter
	if (trimmed.startsWith("# Session:") || trimmed.startsWith("---\n")) {
		return "markdown";
	}

	return "unknown";
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate the structure of an exported session object.
 * Throws descriptive errors for missing or malformed fields.
 */
function validateExportedSession(data: unknown): asserts data is ExportedSession {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid export: expected an object");
	}

	const obj = data as Record<string, unknown>;

	if (obj.version !== 1) {
		throw new Error(`Unsupported export version: ${obj.version} (expected 1)`);
	}

	if (!obj.session || typeof obj.session !== "object") {
		throw new Error("Invalid export: missing 'session' object");
	}

	const session = obj.session as Record<string, unknown>;

	if (typeof session.id !== "string" || !session.id) {
		throw new Error("Invalid export: session.id is required and must be a string");
	}

	if (typeof session.title !== "string") {
		throw new Error("Invalid export: session.title must be a string");
	}

	if (typeof session.createdAt !== "string") {
		throw new Error("Invalid export: session.createdAt must be a string");
	}

	if (!Array.isArray(session.messages)) {
		throw new Error("Invalid export: session.messages must be an array");
	}

	for (let i = 0; i < session.messages.length; i++) {
		const msg = session.messages[i] as Record<string, unknown>;
		if (!msg || typeof msg !== "object") {
			throw new Error(`Invalid export: session.messages[${i}] must be an object`);
		}
		if (msg.role !== "user" && msg.role !== "assistant") {
			throw new Error(`Invalid export: session.messages[${i}].role must be "user" or "assistant"`);
		}
		if (typeof msg.content !== "string") {
			throw new Error(`Invalid export: session.messages[${i}].content must be a string`);
		}
	}
}
