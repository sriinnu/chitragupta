/**
 * @chitragupta/smriti — Day Consolidation (Diary Writer)
 *
 * Consolidates all sessions from a given day into a single day file.
 * Day files are the "diary" — a human-readable, consolidated view of
 * everything that happened across all projects on a given date.
 *
 * Day file location: ~/.chitragupta/days/YYYY/MM/DD.md
 *
 * Uses the Event Extractor for session-type-aware gist extraction:
 *   - Coding sessions → compress to outcomes (files, commits, errors)
 *   - Discussion sessions → keep topics, options, decisions
 *   - Mixed sessions → segment and compress each
 *   - Personal sessions → keep everything
 *
 * Uses the Fact Extractor (pattern + vector similarity) for intelligent
 * fact detection instead of simple regex.
 *
 * Each day file contains:
 *   - Date header with summary stats
 *   - Per-project sections with event narratives
 *   - Facts extracted for global memory
 *   - Session type indicators
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";
import { extractEventChain } from "./event-extractor.js";
import type { EventChain, SessionEvent } from "./event-extractor.js";
import { FactExtractor } from "./fact-extractor.js";

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

/** A project's activity for the day (enriched by event extractor). */
interface ProjectDayActivity {
	project: string;
	branch: string | null;
	providers: Set<string>;
	sessions: SessionMeta[];
	eventChains: EventChain[];
	turns: Array<SessionTurn & { sessionId: string; createdAt: number }>;
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

	// Group by project and extract event chains
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
				eventChains: [],
				turns: [],
				filesModified: new Set(),
			});
		}
		const activity = projectMap.get(key)!;
		activity.sessions.push(meta);

		// Extract provider from metadata or agent field
		const provider = (meta.metadata?.provider as string) ?? meta.agent ?? "unknown";
		activity.providers.add(provider);

		if (meta.branch) activity.branch = meta.branch;

		// Run the event extractor on this session's turns
		const eventChain = extractEventChain(meta, turns);
		activity.eventChains.push(eventChain);

		for (const turn of turns) {
			totalTurns++;
			activity.turns.push({ ...turn, sessionId: meta.id, createdAt: turn.createdAt });
		}

		// Collect files from event chain (more reliable than ad-hoc regex)
		for (const event of eventChain.events) {
			if (event.files) {
				for (const f of event.files) {
					activity.filesModified.add(f);
				}
			}
		}

		// Sort turns by timestamp
		activity.turns.sort((a, b) => a.createdAt - b.createdAt);
	}

	// Extract facts using the real FactExtractor (pattern + vector similarity)
	const extractedFacts = await extractFactsWithEngine(sessions);

	// Generate markdown (now using event chains for richer content)
	const markdown = generateDayMarkdown(date, projectMap, sessions.length, totalTurns, extractedFacts);

	// Write day file
	const dir = path.dirname(dayPath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(dayPath, markdown, "utf-8");

	// Vector-index the daily summary for hierarchical search
	try {
		const { indexConsolidationSummary } = await import("./consolidation-indexer.js");
		await indexConsolidationSummary("daily", date, markdown);
	} catch { /* best-effort */ }

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

// ─── Fact Extraction (via FactExtractor engine) ─────────────────────────────

/**
 * Extract personal facts using the real FactExtractor.
 * Uses pattern matching + vector similarity for robust detection.
 * Falls back to simple regex if FactExtractor fails.
 */
async function extractFactsWithEngine(
	sessions: Array<{ meta: SessionMeta; turns: Array<SessionTurn & { createdAt: number }> }>,
): Promise<string[]> {
	const facts: string[] = [];
	const seen = new Set<string>();

	try {
		const extractor = new FactExtractor({ useVectors: true });

		for (const { turns } of sessions) {
			for (const turn of turns) {
				if (turn.role !== "user") continue;
				if (turn.content.length < 5 || turn.content.length > 5000) continue;

				const extracted = await extractor.extract(turn.content);
				for (const fact of extracted) {
					const key = fact.fact.toLowerCase().slice(0, 50);
					if (!seen.has(key)) {
						seen.add(key);
						facts.push(`[${fact.category}] ${fact.fact}`);
					}
				}
			}
		}

		extractor.dispose();
	} catch {
		// Fallback: simple regex extraction if FactExtractor fails
		return extractFactsFallback(sessions);
	}

	return facts;
}

/**
 * Fallback fact extraction — simple regex patterns.
 * Used only when FactExtractor engine fails to initialize.
 */
function extractFactsFallback(
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

	return [...new Set(facts)];
}

// ─── Markdown Generation ────────────────────────────────────────────────────

/**
 * Generate the consolidated day file markdown.
 * Now uses event chains for structured, type-aware content.
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

		// Per-session sections with event chain narratives
		for (let i = 0; i < activity.sessions.length; i++) {
			const session = activity.sessions[i];
			const chain = activity.eventChains[i];
			const time = new Date(session.created).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
			const provider = (session.metadata?.provider as string) ?? session.agent ?? "unknown";
			const turnCount = activity.turns.filter((t) => t.sessionId === session.id).length;

			lines.push(`### Session: ${session.id}`);
			lines.push(`*${time} | ${provider} | ${turnCount} turns | ${chain?.sessionType ?? "unknown"} session*`);
			lines.push("");

			// Event chain narrative (the gist)
			if (chain) {
				// Narrative summary line
				if (chain.narrative) {
					lines.push(`> ${chain.narrative}`);
					lines.push("");
				}

				// Topics discussed
				if (chain.topics.length > 0) {
					lines.push(`**Topics**: ${chain.topics.slice(0, 5).join(", ")}`);
					lines.push("");
				}

				// Key events (decisions, errors, commits — not every action)
				const keyEvents = chain.events.filter((e) =>
					e.type === "decision" || e.type === "error" || e.type === "commit" ||
					e.type === "fact" || e.type === "preference",
				);
				if (keyEvents.length > 0) {
					for (const event of keyEvents.slice(0, 10)) {
						const icon = eventIcon(event.type);
						lines.push(`- ${icon} ${event.summary}`);
					}
					lines.push("");
				}
			}
		}

		// Tool usage summary (aggregated from event chains)
		const toolCounts = new Map<string, number>();
		for (const chain of activity.eventChains) {
			for (const event of chain.events) {
				if (event.tool) {
					toolCounts.set(event.tool, (toolCounts.get(event.tool) ?? 0) + 1);
				}
			}
		}
		if (toolCounts.size > 0) {
			lines.push("### Tools Used");
			lines.push("");
			for (const [tool, count] of toolCounts) {
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

/** Map event types to markdown icons. */
function eventIcon(type: SessionEvent["type"]): string {
	switch (type) {
		case "decision": return "**Decision**:";
		case "error": return "**Error**:";
		case "commit": return "**Commit**:";
		case "fact": return "**Fact**:";
		case "preference": return "**Pref**:";
		case "question": return "**Q**:";
		case "action": return "**Action**:";
		case "topic": return "**Topic**:";
		case "problem": return "**Problem**:";
		default: return "-";
	}
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
