/**
 * @chitragupta/smriti — Day Consolidation (Diary Writer)
 *
 * Consolidates all sessions from a given day into a single day file.
 * Day files are the "diary" — a human-readable, consolidated view of
 * everything that happened across all projects on a given date.
 *
 * Day file location: ~/.chitragupta/days/YYYY/MM/DD.md
 *
 * Each day file contains:
 *   - Date header
 *   - Per-project sections (project path, branch, providers used)
 *   - Timeline of significant events (tool calls, decisions, errors)
 *   - Facts extracted for global memory
 *   - Summary statistics
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of consolidating a single day. */
export interface DayConsolidationResult {
	/** The date that was consolidated (YYYY-MM-DD). */
	date: string;
	/** Path to the written day file. */
	filePath: string;
	/** Number of sessions processed. */
	sessionsProcessed: number;
	/** Number of unique projects. */
	projectCount: number;
	/** Total turns across all sessions. */
	totalTurns: number;
	/** Facts extracted for global memory. */
	extractedFacts: string[];
	/** Duration of consolidation in ms. */
	durationMs: number;
}

/** A project's activity for the day. */
interface ProjectDayActivity {
	project: string;
	branch: string | null;
	providers: Set<string>;
	sessions: SessionMeta[];
	turns: Array<SessionTurn & { sessionId: string; createdAt: number }>;
	toolCalls: Array<{ tool: string; args: string; result: string; isError: boolean; sessionId: string; timestamp: number }>;
	decisions: string[];
	filesModified: Set<string>;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/** Get the root directory for day files. */
export function getDaysRoot(): string {
	return path.join(getChitraguptaHome(), "days");
}

/** Get the path for a specific day file: ~/.chitragupta/days/YYYY/MM/DD.md */
export function getDayFilePath(date: string): string {
	const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) throw new SessionError(`Invalid date: ${date}. Expected YYYY-MM-DD.`);
	return path.join(getDaysRoot(), match[1], match[2], `${match[3]}.md`);
}

// ─── Core Consolidation ─────────────────────────────────────────────────────

/**
 * Consolidate all sessions for a given date into a single day file.
 *
 * @param date - Date in YYYY-MM-DD format.
 * @param options - Optional configuration.
 * @returns Consolidation result with stats.
 */
export async function consolidateDay(
	date: string,
	options?: {
		/** Force re-consolidation even if day file exists. */
		force?: boolean;
		/** Custom session loader (for testing). */
		loadSessions?: (date: string) => Promise<{ meta: SessionMeta; turns: Array<SessionTurn & { createdAt: number }> }[]>;
	},
): Promise<DayConsolidationResult> {
	const t0 = performance.now();

	const dayPath = getDayFilePath(date);

	// Skip if already consolidated (unless forced)
	if (!options?.force && fs.existsSync(dayPath)) {
		const content = fs.readFileSync(dayPath, "utf-8");
		const sessionCount = (content.match(/^### Session:/gm) || []).length;
		return {
			date,
			filePath: dayPath,
			sessionsProcessed: sessionCount,
			projectCount: (content.match(/^## Project:/gm) || []).length,
			totalTurns: 0,
			extractedFacts: [],
			durationMs: performance.now() - t0,
		};
	}

	// Load sessions for this date
	let sessions: Array<{ meta: SessionMeta; turns: Array<SessionTurn & { createdAt: number }> }>;

	if (options?.loadSessions) {
		sessions = await options.loadSessions(date);
	} else {
		const { listSessionsByDate, listTurnsWithTimestamps, loadSession } = await import("./session-store.js");
		const metas = listSessionsByDate(date);
		sessions = metas.map((meta) => {
			try {
				const turns = listTurnsWithTimestamps(meta.id, meta.project);
				return { meta, turns };
			} catch {
				// If turns can't be loaded from DB, try from file
				try {
					const session = loadSession(meta.id, meta.project);
					const baseTime = new Date(meta.created).getTime();
					return {
						meta,
						turns: session.turns.map((t, i) => ({
							...t,
							createdAt: baseTime + i * 1000,
						})),
					};
				} catch {
					return { meta, turns: [] };
				}
			}
		});
	}

	if (sessions.length === 0) {
		return {
			date,
			filePath: dayPath,
			sessionsProcessed: 0,
			projectCount: 0,
			totalTurns: 0,
			extractedFacts: [],
			durationMs: performance.now() - t0,
		};
	}

	// Group by project
	const projectMap = new Map<string, ProjectDayActivity>();
	let totalTurns = 0;

	for (const { meta, turns } of sessions) {
		const key = meta.project;
		if (!projectMap.has(key)) {
			projectMap.set(key, {
				project: meta.project,
				branch: meta.branch,
				providers: new Set(),
				sessions: [],
				turns: [],
				toolCalls: [],
				decisions: [],
				filesModified: new Set(),
			});
		}
		const activity = projectMap.get(key)!;
		activity.sessions.push(meta);

		// Extract provider from metadata or agent field
		const provider = (meta.metadata?.provider as string) ?? meta.agent ?? "unknown";
		activity.providers.add(provider);

		if (meta.branch) activity.branch = meta.branch;

		for (const turn of turns) {
			totalTurns++;
			activity.turns.push({ ...turn, sessionId: meta.id, createdAt: turn.createdAt });

			// Extract tool calls from turn content
			const toolMatch = turn.content.match(/\[tool:(\w+)\]\s*(\{.*\})?/);
			if (toolMatch) {
				activity.toolCalls.push({
					tool: toolMatch[1],
					args: toolMatch[2] ?? "",
					result: "",
					isError: false,
					sessionId: meta.id,
					timestamp: turn.createdAt,
				});
			}

			// Extract file paths from content
			const filePatterns = turn.content.match(/(?:File (?:created|edited|modified|deleted):\s*)(.+)/g);
			if (filePatterns) {
				for (const fp of filePatterns) {
					const filePath = fp.replace(/File (?:created|edited|modified|deleted):\s*/, "").trim();
					activity.filesModified.add(filePath);
				}
			}
		}

		// Sort turns by timestamp
		activity.turns.sort((a, b) => a.createdAt - b.createdAt);
	}

	// Extract facts (simple heuristic)
	const extractedFacts = extractFacts(sessions);

	// Generate markdown
	const markdown = generateDayMarkdown(date, projectMap, sessions.length, totalTurns, extractedFacts);

	// Write day file
	const dir = path.dirname(dayPath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(dayPath, markdown, "utf-8");

	return {
		date,
		filePath: dayPath,
		sessionsProcessed: sessions.length,
		projectCount: projectMap.size,
		totalTurns,
		extractedFacts,
		durationMs: performance.now() - t0,
	};
}

// ─── Fact Extraction ────────────────────────────────────────────────────────

/**
 * Extract personal facts from session content.
 * Looks for patterns like "I live in ...", "my name is ...", etc.
 */
function extractFacts(
	sessions: Array<{ meta: SessionMeta; turns: Array<SessionTurn & { createdAt: number }> }>,
): string[] {
	const facts: string[] = [];
	const factPatterns = [
		/(?:i live in|i'm from|i am from|my home is in)\s+([^.!?\n]+)/i,
		/(?:my name is|i'm called|i am called)\s+([^.!?\n]+)/i,
		/(?:i work at|i work for|my company is)\s+([^.!?\n]+)/i,
		/(?:i use|i prefer|my editor is|my ide is)\s+([^.!?\n]+)/i,
		/(?:always use|never use|remember to|don't forget)\s+([^.!?\n]+)/i,
	];

	for (const { turns } of sessions) {
		for (const turn of turns) {
			if (turn.role !== "user") continue;
			for (const pattern of factPatterns) {
				const match = turn.content.match(pattern);
				if (match) {
					facts.push(match[0].trim());
				}
			}
		}
	}

	// Deduplicate
	return [...new Set(facts)];
}

// ─── Markdown Generation ────────────────────────────────────────────────────

/**
 * Generate the consolidated day file markdown.
 */
function generateDayMarkdown(
	date: string,
	projectMap: Map<string, ProjectDayActivity>,
	sessionCount: number,
	totalTurns: number,
	facts: string[],
): string {
	const lines: string[] = [];

	// Header
	const dayName = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" });
	lines.push(`# ${date} — ${dayName}`);
	lines.push("");
	lines.push(`> ${sessionCount} sessions | ${projectMap.size} projects | ${totalTurns} turns`);
	lines.push("");

	// Facts section (if any)
	if (facts.length > 0) {
		lines.push("## Facts Learned");
		lines.push("");
		for (const fact of facts) {
			lines.push(`- ${fact}`);
		}
		lines.push("");
	}

	// Per-project sections
	for (const [, activity] of projectMap) {
		lines.push(`## Project: ${activity.project}`);
		lines.push("");

		// Metadata
		const meta: string[] = [];
		if (activity.branch) meta.push(`**Branch**: ${activity.branch}`);
		meta.push(`**Providers**: ${[...activity.providers].join(", ")}`);
		meta.push(`**Sessions**: ${activity.sessions.length}`);
		if (activity.filesModified.size > 0) {
			meta.push(`**Files Modified**: ${activity.filesModified.size}`);
		}
		lines.push(meta.join(" | "));
		lines.push("");

		// Session listing
		for (const session of activity.sessions) {
			const time = new Date(session.created).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
			const provider = (session.metadata?.provider as string) ?? session.agent ?? "unknown";
			const turnCount = activity.turns.filter((t) => t.sessionId === session.id).length;
			lines.push(`### Session: ${session.id}`);
			lines.push(`*${time} | ${provider} | ${turnCount} turns*`);
			lines.push("");
		}

		// Tool call timeline
		if (activity.toolCalls.length > 0) {
			lines.push("### Tool Timeline");
			lines.push("");
			const uniqueTools = new Map<string, number>();
			for (const tc of activity.toolCalls) {
				uniqueTools.set(tc.tool, (uniqueTools.get(tc.tool) ?? 0) + 1);
			}
			for (const [tool, count] of uniqueTools) {
				lines.push(`- **${tool}**: ${count} calls`);
			}
			lines.push("");
		}

		// Files modified
		if (activity.filesModified.size > 0) {
			lines.push("### Files Modified");
			lines.push("");
			for (const f of activity.filesModified) {
				lines.push(`- ${f}`);
			}
			lines.push("");
		}
	}

	// Footer
	lines.push("---");
	lines.push(`*Consolidated by Chitragupta at ${new Date().toISOString()}*`);
	lines.push("");

	return lines.join("\n");
}

// ─── Query API ──────────────────────────────────────────────────────────────

/**
 * Read a consolidated day file.
 * @param date - Date in YYYY-MM-DD format.
 * @returns The day file content, or null if not consolidated yet.
 */
export function readDayFile(date: string): string | null {
	const dayPath = getDayFilePath(date);
	if (!fs.existsSync(dayPath)) return null;
	return fs.readFileSync(dayPath, "utf-8");
}

/**
 * List all consolidated day files.
 * Returns dates in YYYY-MM-DD format, most recent first.
 */
export function listDayFiles(): string[] {
	const daysRoot = getDaysRoot();
	if (!fs.existsSync(daysRoot)) return [];

	const dates: string[] = [];

	try {
		const years = fs.readdirSync(daysRoot, { withFileTypes: true });
		for (const year of years) {
			if (!year.isDirectory()) continue;
			const yearPath = path.join(daysRoot, year.name);
			const months = fs.readdirSync(yearPath, { withFileTypes: true });
			for (const month of months) {
				if (!month.isDirectory()) continue;
				const monthPath = path.join(yearPath, month.name);
				const days = fs.readdirSync(monthPath);
				for (const day of days) {
					if (!day.endsWith(".md")) continue;
					const dd = day.replace(".md", "");
					dates.push(`${year.name}-${month.name}-${dd}`);
				}
			}
		}
	} catch {
		// Best-effort
	}

	return dates.sort().reverse();
}

/**
 * Search across all day files for a query string (case-insensitive).
 * Returns matching day files with context snippets.
 */
export function searchDayFiles(
	query: string,
	options?: { limit?: number },
): Array<{ date: string; matches: Array<{ line: number; text: string }> }> {
	const limit = options?.limit ?? 10;
	const dates = listDayFiles();
	const results: Array<{ date: string; matches: Array<{ line: number; text: string }> }> = [];
	const queryLower = query.toLowerCase();

	for (const date of dates) {
		if (results.length >= limit) break;

		const content = readDayFile(date);
		if (!content) continue;

		const lines = content.split("\n");
		const matches: Array<{ line: number; text: string }> = [];

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(queryLower)) {
				matches.push({ line: i + 1, text: lines[i].trim() });
			}
		}

		if (matches.length > 0) {
			results.push({ date, matches: matches.slice(0, 5) }); // Max 5 matches per day
		}
	}

	return results;
}

/**
 * Check if a date has been consolidated.
 */
export function isDayConsolidated(date: string): boolean {
	return fs.existsSync(getDayFilePath(date));
}

/**
 * Get dates that have sessions but haven't been consolidated yet.
 */
export async function getUnconsolidatedDates(limit?: number): Promise<string[]> {
	const { listSessionDates } = await import("./session-store.js");
	const sessionDates = listSessionDates();
	const unconsolidated: string[] = [];

	for (const date of sessionDates) {
		if (unconsolidated.length >= (limit ?? 30)) break;
		if (!isDayConsolidated(date)) {
			unconsolidated.push(date);
		}
	}

	return unconsolidated;
}
