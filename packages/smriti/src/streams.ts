/**
 * @chitragupta/smriti — Memory Streams.
 *
 * The 4 memory streams form the persistent memory architecture:
 *   - identity.md  — WHO  — near-immutable, append-mostly  (preservation: 0.95)
 *   - projects.md  — WHAT — active projects, decisions      (preservation: 0.80)
 *   - tasks.md     — TODO — pending, completed, archived    (preservation: 0.70)
 *   - flow/{id}.md — HOW  — ephemeral, per-device           (preservation: 0.30)
 *
 * .md files are the source of truth. Human-readable. Git-diffable. Grep-able.
 * Storage path: ~/.chitragupta/smriti/streams/
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { StreamType, StreamConfig } from "./types.js";

// ─── Stream Definitions ──────────────────────────────────────────────────────

/**
 * Default stream configurations with preservation ratios.
 * These ratios determine how much of each stream survives compaction
 * and how token budgets are allocated.
 */
export const STREAM_CONFIGS: Record<StreamType, StreamConfig> = {
	identity: {
		type: "identity",
		filename: "identity.md",
		preservation: 0.95,
		description: "WHO — personal preferences, corrections, facts, style. Near-immutable.",
	},
	projects: {
		type: "projects",
		filename: "projects.md",
		preservation: 0.80,
		description: "WHAT — active projects, decisions, stack, architecture notes.",
	},
	tasks: {
		type: "tasks",
		filename: "tasks.md",
		preservation: 0.70,
		description: "TODO — pending tasks, completed items, archived entries.",
	},
	flow: {
		type: "flow",
		filename: "flow/default.md",
		preservation: 0.30,
		description: "HOW — ephemeral context, current topic, mood, open questions. Per-device.",
	},
};

/**
 * All stream types in canonical order: identity, projects, tasks, flow.
 */
export const STREAM_ORDER: StreamType[] = ["identity", "projects", "tasks", "flow"];

/**
 * Preservation ratios in canonical order, matching STREAM_ORDER.
 */
export const PRESERVATION_RATIOS: number[] = STREAM_ORDER.map(
	(s) => STREAM_CONFIGS[s].preservation,
);

// ─── Rough Token Estimation ──────────────────────────────────────────────────

// Import from canonical location and re-export to avoid duplication
import { estimateTokens } from "./graphrag-scoring.js";
export { estimateTokens };

// ─── Storage Paths ───────────────────────────────────────────────────────────

/**
 * Get the root directory for memory streams.
 */
function getStreamsRoot(): string {
	return path.join(getChitraguptaHome(), "smriti", "streams");
}

/**
 * Get the full filesystem path for a stream file.
 * For flow streams, the deviceId determines the filename.
 */
function getStreamPath(streamType: StreamType, deviceId?: string): string {
	const root = getStreamsRoot();
	if (streamType === "flow") {
		const id = deviceId ?? "default";
		return path.join(root, "flow", `${id}.md`);
	}
	return path.join(root, STREAM_CONFIGS[streamType].filename);
}

// ─── Stream File Format ──────────────────────────────────────────────────────

/**
 * Build the initial header for a stream file.
 */
function buildStreamHeader(streamType: StreamType, deviceId?: string): string {
	const config = STREAM_CONFIGS[streamType];
	const lines: string[] = [];

	lines.push(`# ${streamType.charAt(0).toUpperCase() + streamType.slice(1)} Stream`);
	lines.push("");
	lines.push(`> ${config.description}`);
	lines.push(`> Preservation ratio: ${config.preservation}`);
	if (streamType === "flow" && deviceId) {
		lines.push(`> Device: ${deviceId}`);
	}
	lines.push("");

	return lines.join("\n");
}

/**
 * Build the meta footer for a stream file.
 */
function buildStreamFooter(content: string): string {
	const now = new Date().toISOString();
	const tokens = estimateTokens(content);
	const lines: string[] = [];

	lines.push("");
	lines.push("---");
	lines.push("");
	lines.push("## Meta");
	lines.push("");
	lines.push(`- last_updated: ${now}`);
	lines.push(`- token_count: ${tokens}`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Parse an existing stream file, separating header, content, and footer.
 * Returns the content body (between header and footer).
 */
function parseStreamFile(raw: string): { header: string; content: string; footer: string } {
	// The header ends at the first blank line after the blockquote section
	// The footer starts at "---\n\n## Meta"
	const footerMarker = "\n---\n\n## Meta";
	const footerIdx = raw.lastIndexOf(footerMarker);

	let bodyWithHeader: string;
	let footer: string;

	if (footerIdx !== -1) {
		bodyWithHeader = raw.slice(0, footerIdx);
		footer = raw.slice(footerIdx);
	} else {
		bodyWithHeader = raw;
		footer = "";
	}

	// Split header from content: header is everything up to and including
	// the first double-newline after the blockquote lines
	const headerEndPattern = /^(?:#[^\n]*\n\n(?:>[^\n]*\n)*)\n/m;
	const headerMatch = bodyWithHeader.match(headerEndPattern);

	let header: string;
	let content: string;

	if (headerMatch) {
		header = headerMatch[0];
		content = bodyWithHeader.slice(header.length);
	} else {
		// Fallback: look for the end of blockquote lines
		const lines = bodyWithHeader.split("\n");
		let headerEndLine = 0;
		let pastTitle = false;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith("#")) {
				pastTitle = true;
				continue;
			}
			if (pastTitle && !lines[i].startsWith(">") && lines[i].trim() === "") {
				headerEndLine = i + 1;
				break;
			}
			if (pastTitle && !lines[i].startsWith(">") && lines[i].trim() !== "") {
				headerEndLine = i;
				break;
			}
		}
		header = lines.slice(0, headerEndLine).join("\n") + "\n";
		content = lines.slice(headerEndLine).join("\n");
	}

	return { header, content: content.trim(), footer };
}

// ─── StreamManager ───────────────────────────────────────────────────────────

/**
 * Manages the 4 memory streams on disk.
 *
 * Each stream is a .md file at ~/.chitragupta/smriti/streams/.
 * The StreamManager enforces preservation ratios, handles reads/writes/appends,
 * and computes token budgets for compaction.
 */
export class StreamManager {
	private root: string;

	constructor() {
		this.root = getStreamsRoot();
	}

	// ─── Ensure Directories ─────────────────────────────────────────

	/**
	 * Ensure the streams directory structure exists.
	 */
	private ensureDirs(): void {
		fs.mkdirSync(this.root, { recursive: true });
		fs.mkdirSync(path.join(this.root, "flow"), { recursive: true });
	}

	// ─── Read ────────────────────────────────────────────────────────

	/**
	 * Read the full content of a stream file.
	 * Returns empty string if the stream file does not exist.
	 */
	read(streamType: StreamType, deviceId?: string): string {
		const filePath = getStreamPath(streamType, deviceId);
		try {
			if (fs.existsSync(filePath)) {
				return fs.readFileSync(filePath, "utf-8");
			}
		} catch {
			// Read errors return empty
		}
		return "";
	}

	/**
	 * Read just the content body of a stream (without header/footer).
	 */
	readContent(streamType: StreamType, deviceId?: string): string {
		const raw = this.read(streamType, deviceId);
		if (!raw) return "";
		const { content } = parseStreamFile(raw);
		return content;
	}

	// ─── Write ───────────────────────────────────────────────────────

	/**
	 * Overwrite a stream file with new content.
	 * Automatically adds the header and meta footer.
	 */
	write(streamType: StreamType, content: string, deviceId?: string): void {
		this.ensureDirs();
		const filePath = getStreamPath(streamType, deviceId);

		const header = buildStreamHeader(streamType, deviceId);
		const fullContent = header + content;
		const footer = buildStreamFooter(fullContent);

		fs.writeFileSync(filePath, fullContent + footer, "utf-8");
	}

	// ─── Append ──────────────────────────────────────────────────────

	/**
	 * Append content to a stream file.
	 * If the stream doesn't exist, creates it with a header.
	 * Updates the meta footer.
	 */
	append(streamType: StreamType, entry: string, deviceId?: string): void {
		this.ensureDirs();
		const filePath = getStreamPath(streamType, deviceId);

		const existing = this.read(streamType, deviceId);

		if (!existing) {
			// Create new stream file
			const header = buildStreamHeader(streamType, deviceId);
			const content = header + entry + "\n";
			const footer = buildStreamFooter(content);
			fs.writeFileSync(filePath, content + footer, "utf-8");
			return;
		}

		// Parse existing, append to content, rebuild with footer
		const { header, content } = parseStreamFile(existing);
		const timestamp = new Date().toISOString();
		const separator = content ? "\n\n" : "";
		const newContent = content + separator + `*${timestamp}*\n\n${entry}`;
		const fullContent = header + newContent + "\n";
		const footer = buildStreamFooter(fullContent);

		fs.writeFileSync(filePath, fullContent + footer, "utf-8");
	}

	// ─── Token Counting ──────────────────────────────────────────────

	/**
	 * Get the estimated token count for a stream.
	 */
	getTokenCount(streamType: StreamType, deviceId?: string): number {
		const raw = this.read(streamType, deviceId);
		return estimateTokens(raw);
	}

	/**
	 * Get token counts for all streams (flow uses default device unless specified).
	 */
	getAllTokenCounts(deviceId?: string): Record<StreamType, number> {
		return {
			identity: this.getTokenCount("identity"),
			projects: this.getTokenCount("projects"),
			tasks: this.getTokenCount("tasks"),
			flow: this.getTokenCount("flow", deviceId),
		};
	}

	// ─── Budget Allocation ───────────────────────────────────────────

	/**
	 * Compute per-stream token budgets from a total budget.
	 *
	 * Budget allocation is proportional to preservation ratios:
	 *   budget_i = totalBudget * (preservation_i / sum(preservation))
	 *
	 * This ensures higher-preservation streams (identity) get more budget
	 * than ephemeral streams (flow).
	 */
	getStreamBudgets(totalBudget: number): Record<StreamType, number> {
		const totalPreservation = STREAM_ORDER.reduce(
			(sum, s) => sum + STREAM_CONFIGS[s].preservation,
			0,
		);

		const budgets: Record<string, number> = {};
		for (const stream of STREAM_ORDER) {
			const ratio = STREAM_CONFIGS[stream].preservation / totalPreservation;
			budgets[stream] = Math.floor(totalBudget * ratio);
		}

		// Distribute any remaining tokens from rounding to the highest-preservation stream
		const allocated = Object.values(budgets).reduce((a, b) => a + b, 0);
		const remainder = totalBudget - allocated;
		if (remainder > 0) {
			budgets.identity += remainder;
		}

		return budgets as Record<StreamType, number>;
	}

	// ─── Preservation Enforcement ────────────────────────────────────

	/**
	 * Trim a stream's content to fit within its preservation budget.
	 * Removes the oldest entries first (from the top of the content section).
	 *
	 * @param streamType - Which stream to trim
	 * @param maxTokens - Maximum token budget for this stream
	 * @param deviceId - Device ID for flow streams
	 * @returns Number of tokens trimmed
	 */
	enforcePreservation(
		streamType: StreamType,
		maxTokens: number,
		deviceId?: string,
	): number {
		const raw = this.read(streamType, deviceId);
		if (!raw) return 0;

		const currentTokens = estimateTokens(raw);
		if (currentTokens <= maxTokens) return 0;

		const { content } = parseStreamFile(raw);

		// Split content into entries (separated by timestamp markers)
		// Use a regex that captures the separator so we can reconstruct it exactly
		const ENTRY_SEP = /(\n\n\*\d{4}-)/;
		const parts = content.split(ENTRY_SEP);
		// parts alternates: [content0, sep1, content1, sep2, content2, ...]
		// Reconstruct entries as [sep+content] pairs, with the first entry having no separator
		if (parts.length <= 1) {
			return 0;
		}

		// Build entries: first part has no separator prefix, rest have sep+content
		const entries: string[] = [parts[0]];
		for (let i = 1; i < parts.length; i += 2) {
			entries.push((parts[i] ?? "") + (parts[i + 1] ?? ""));
		}

		if (entries.length <= 1) {
			return 0;
		}

		// Remove oldest entries until we're under budget
		let trimmedEntries = [...entries];
		let currentContent = trimmedEntries.join("");
		let tokens = estimateTokens(currentContent);
		let totalTrimmed = 0;

		while (tokens > maxTokens && trimmedEntries.length > 1) {
			const removed = trimmedEntries.shift()!;
			totalTrimmed += estimateTokens(removed);
			currentContent = trimmedEntries.join("");
			tokens = estimateTokens(currentContent);
		}

		if (totalTrimmed > 0) {
			this.write(streamType, trimmedEntries.join(""), deviceId);
		}

		return totalTrimmed;
	}

	// ─── Stream Existence ────────────────────────────────────────────

	/**
	 * Check if a stream file exists on disk.
	 */
	exists(streamType: StreamType, deviceId?: string): boolean {
		const filePath = getStreamPath(streamType, deviceId);
		return fs.existsSync(filePath);
	}

	/**
	 * List all flow device files.
	 */
	listFlowDevices(): string[] {
		const flowDir = path.join(this.root, "flow");
		if (!fs.existsSync(flowDir)) return [];

		try {
			return fs
				.readdirSync(flowDir)
				.filter((f) => f.endsWith(".md"))
				.map((f) => f.replace(/\.md$/, ""));
		} catch {
			return [];
		}
	}

	/**
	 * Get the streams root directory path.
	 */
	getRoot(): string {
		return this.root;
	}
}
