/**
 * @chitragupta/smriti — Unified Recall Engine
 *
 * The nervous system's query center. Takes a natural language question
 * and searches ALL layers: FTS5 (turns), graph (relationships),
 * vectors (semantic), memory (facts), day files (diary).
 *
 * Returns assembled answers — not raw search results.
 *
 * This is what makes "how did I fix the yaxis interval" work.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single recall result with assembled context. */
export interface RecallAnswer {
	/** Relevance score (0-1). */
	score: number;
	/** Human-readable answer text. */
	answer: string;
	/** Source type that contributed most. */
	primarySource: "turns" | "memory" | "graph" | "dayfile";
	/** Session ID if from a session. */
	sessionId?: string;
	/** Project path if known. */
	project?: string;
	/** Date (YYYY-MM-DD) if known. */
	date?: string;
	/** Provider if known. */
	provider?: string;
	/** Matched content snippet. */
	snippet: string;
}

/** Options for recall. */
export interface RecallOptions {
	/** Max results. Default: 5. */
	limit?: number;
	/** Filter to specific project. */
	project?: string;
	/** Filter to date range [start, end] in YYYY-MM-DD. */
	dateRange?: [string, string];
	/** Include day file search. Default: true. */
	includeDayFiles?: boolean;
	/** Include memory search. Default: true. */
	includeMemory?: boolean;
}

// ─── Unified Recall ─────────────────────────────────────────────────────────

/**
 * Unified recall — searches all layers and assembles answers.
 *
 * @param query - Natural language question.
 * @param options - Search options.
 * @returns Assembled answers ranked by relevance.
 */
export async function recall(
	query: string,
	options?: RecallOptions,
): Promise<RecallAnswer[]> {
	const limit = options?.limit ?? 5;
	const answers: RecallAnswer[] = [];

	// Run searches in parallel for speed
	const [sessionResults, memoryResults, dayFileResults] = await Promise.allSettled([
		searchTurns(query, options?.project),
		options?.includeMemory !== false ? searchMemoryLayer(query) : Promise.resolve([]),
		options?.includeDayFiles !== false ? searchDayFileLayer(query, limit) : Promise.resolve([]),
	]);

	// Process session/turn results (FTS5)
	if (sessionResults.status === "fulfilled") {
		for (const result of sessionResults.value.slice(0, limit)) {
			answers.push({
				score: result.score,
				answer: result.answer,
				primarySource: "turns",
				sessionId: result.sessionId,
				project: result.project,
				date: result.date,
				provider: result.provider,
				snippet: result.snippet,
			});
		}
	}

	// Process memory results
	if (memoryResults.status === "fulfilled") {
		for (const result of memoryResults.value.slice(0, limit)) {
			answers.push(result);
		}
	}

	// Process day file results
	if (dayFileResults.status === "fulfilled") {
		for (const result of dayFileResults.value.slice(0, limit)) {
			answers.push(result);
		}
	}

	// Sort by score, deduplicate similar answers, limit
	const ranked = deduplicateAnswers(answers);
	ranked.sort((a, b) => b.score - a.score);
	return ranked.slice(0, limit);
}

// ─── Layer: Turns (FTS5 + Session Context) ──────────────────────────────────

interface TurnSearchResult {
	score: number;
	answer: string;
	sessionId: string;
	project: string;
	date: string;
	provider?: string;
	snippet: string;
}

async function searchTurns(query: string, project?: string): Promise<TurnSearchResult[]> {
	try {
		const { searchSessions } = await import("./search.js");
		const { loadSession } = await import("./session-store.js");

		const metas = searchSessions(query, project);
		const results: TurnSearchResult[] = [];

		for (const meta of metas.slice(0, 10)) {
			try {
				const session = loadSession(meta.id, meta.project);
				const queryTerms = query.toLowerCase().split(/\s+/);

				// Find the most relevant turn
				let bestTurn = "";
				let bestScore = 0;

				for (const turn of session.turns) {
					const content = turn.content.toLowerCase();
					let termHits = 0;
					for (const term of queryTerms) {
						if (term.length > 2 && content.includes(term)) termHits++;
					}
					const score = queryTerms.length > 0 ? termHits / queryTerms.length : 0;
					if (score > bestScore) {
						bestScore = score;
						bestTurn = turn.content;
					}
				}

				const date = meta.created.slice(0, 10);
				const provider = meta.provider ?? meta.agent;

				// Build contextual answer
				const snippet = bestTurn.slice(0, 300);
				const projectName = meta.project.split("/").pop() ?? meta.project;
				const answer = `In ${projectName} (${date}) via ${provider}: ${snippet}`;

				results.push({
					score: Math.min(bestScore + 0.3, 1.0), // Base boost for FTS5 match
					answer,
					sessionId: meta.id,
					project: meta.project,
					date,
					provider,
					snippet,
				});
			} catch {
				// Skip unloadable sessions
			}
		}

		return results;
	} catch {
		return [];
	}
}

// ─── Layer: Memory ──────────────────────────────────────────────────────────

async function searchMemoryLayer(query: string): Promise<RecallAnswer[]> {
	try {
		const { searchMemory } = await import("./search.js");
		const results = searchMemory(query);

		return results.slice(0, 5).map((r) => ({
			score: Math.min((r.relevance ?? 0.5) + 0.1, 1.0),
			answer: `From memory: ${r.content.slice(0, 300)}`,
			primarySource: "memory" as const,
			snippet: r.content.slice(0, 300),
		}));
	} catch {
		return [];
	}
}

// ─── Layer: Day Files ───────────────────────────────────────────────────────

async function searchDayFileLayer(query: string, limit: number): Promise<RecallAnswer[]> {
	try {
		const { searchDayFiles } = await import("./day-consolidation.js");
		const results = searchDayFiles(query, { limit });

		return results.map((r) => ({
			score: 0.5, // Day file matches are supplementary
			answer: `On ${r.date}: ${r.matches.map((m) => m.text).join(" | ").slice(0, 300)}`,
			primarySource: "dayfile" as const,
			date: r.date,
			snippet: r.matches.map((m) => m.text).join("\n").slice(0, 300),
		}));
	} catch {
		return [];
	}
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicateAnswers(answers: RecallAnswer[]): RecallAnswer[] {
	const seen = new Set<string>();
	return answers.filter((a) => {
		const key = a.sessionId
			? `session:${a.sessionId}`
			: `${a.primarySource}:${a.snippet.slice(0, 50).toLowerCase()}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
