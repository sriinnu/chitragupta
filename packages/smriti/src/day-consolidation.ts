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
 *   - Coding sessions -> compress to outcomes (files, commits, errors)
 *   - Discussion sessions -> keep topics, options, decisions
 *   - Mixed sessions -> segment and compress each
 *   - Personal sessions -> keep everything
 *
 * Uses the Fact Extractor (pattern + vector similarity) for intelligent
 * fact detection instead of simple regex.
 *
 * Each day file contains:
 *   - Date header with summary stats
 *   - Per-project sections with event narratives
 *   - Facts extracted for global memory
 *   - Session type indicators
 *
 * Rendering logic lives in ./day-consolidation-renderer.ts
 * Query API lives in ./day-consolidation-query.ts
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";
import { extractEventChain } from "./event-extractor.js";
import { FactExtractor } from "./fact-extractor.js";
import { generateDayMarkdown } from "./day-consolidation-renderer.js";
import type { ProjectDayActivity } from "./day-consolidation-renderer.js";

// ─── Re-exports ─────────────────────────────────────────────────────────────
// Keep all public symbols available from this module so that
// index.ts and cross-machine-sync.ts continue to work unchanged.

export { generateDayMarkdown, eventIcon } from "./day-consolidation-renderer.js";
export type { ProjectDayActivity } from "./day-consolidation-renderer.js";

export {
	readDayFile,
	listDayFiles,
	searchDayFiles,
	isDayConsolidated,
	getUnconsolidatedDates,
} from "./day-consolidation-query.js";

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
