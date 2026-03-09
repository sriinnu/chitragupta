/**
 * @chitragupta/smriti — Swapna Samskara Extraction
 *
 * Extracts session-local behavioral impressions (samskaras) from:
 *   1) assistant tool-call sequences
 *   2) user intent language (preference/decision/correction/convention)
 *
 * Rows are keyed by session + normalized pattern to avoid re-counting the
 * same historical turns on every Swapna cycle.
 */

import { DatabaseManager } from "./db/index.js";
import { parseToolCalls, resolveSwapnaSessionIds } from "./swapna-extraction.js";
import type { SwapnaConfig } from "./swapna-types.js";
import type { PramanaType, SessionToolCall } from "./types.js";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

interface SessionRow {
	id: string;
}

interface TurnRow {
	role: "user" | "assistant";
	content: string;
	tool_calls: string | null;
}

interface PatternCandidate {
	patternType: "tool-sequence" | "preference" | "decision" | "correction" | "convention";
	patternContent: string;
	observationCount: number;
	confidence: number;
	pramanaType: PramanaType;
}

export interface SamskaraExtractionResult {
	samskarasProcessed: number;
	sessionsProcessed: number;
	durationMs: number;
}

/** Compute a 32-bit FNV-1a hash as a zero-padded hex string. */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function normalizePatternContent(content: string): string {
	const cleaned = content.replace(/\s+/g, " ").trim();
	if (cleaned.length <= 280) return cleaned;
	return `${cleaned.slice(0, 280)}...`;
}

function maybePushTextPattern(
	out: PatternCandidate[],
	content: string,
): void {
	const normalized = normalizePatternContent(content);
	if (normalized.length < 12) return;
	const lower = normalized.toLowerCase();

	// Prioritized from strongest signal to weakest.
	if (/\b(wrong|incorrect|not that|don't|do not|instead|should be|fix this|that's not right)\b/i.test(lower)) {
		out.push({
			patternType: "correction",
			patternContent: normalized,
			observationCount: 1,
			confidence: 0.78,
			pramanaType: "shabda",
		});
	}
	if (/\b(we will|let's|decided|decision|going with|choose|chosen|selected|ship this)\b/i.test(lower)) {
		out.push({
			patternType: "decision",
			patternContent: normalized,
			observationCount: 1,
			confidence: 0.72,
			pramanaType: "shabda",
		});
	}
	if (/\b(i prefer|we prefer|i like|we like|please use|always use|our stack|my preference|we use)\b/i.test(lower)) {
		out.push({
			patternType: "preference",
			patternContent: normalized,
			observationCount: 1,
			confidence: 0.68,
			pramanaType: "shabda",
		});
	}
	if (/\b(convention|naming|style|format|kebab-case|camelcase|snake_case|folder structure|pattern)\b/i.test(lower)) {
		out.push({
			patternType: "convention",
			patternContent: normalized,
			observationCount: 1,
			confidence: 0.66,
			pramanaType: "shabda",
		});
	}
}

function extractToolSequencePattern(
	calls: SessionToolCall[],
): PatternCandidate | null {
	if (calls.length === 0) return null;

	const names = calls
		.map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
		.filter((name) => name.length > 0)
		.slice(0, 8);

	if (names.length === 0) return null;

	const okCount = calls.filter((c) => !c.isError).length;
	const successRate = okCount / calls.length;
	const confidence = clamp01(0.55 + 0.45 * successRate);

	return {
		patternType: "tool-sequence",
		patternContent: names.join(" -> "),
		observationCount: 1,
		confidence,
		pramanaType: "pratyaksha",
	};
}

function mergePattern(
	acc: Map<string, PatternCandidate>,
	candidate: PatternCandidate,
): void {
	const key = `${candidate.patternType}:${candidate.patternContent}`;
	const existing = acc.get(key);
	if (!existing) {
		acc.set(key, { ...candidate });
		return;
	}

	existing.observationCount += candidate.observationCount;
	existing.confidence = Math.max(existing.confidence, candidate.confidence);
}

function extractSessionPatterns(turns: TurnRow[]): Map<string, PatternCandidate> {
	const patterns = new Map<string, PatternCandidate>();

	for (const turn of turns) {
		const calls = parseToolCalls(turn.tool_calls);
		const toolPattern = extractToolSequencePattern(calls);
		if (toolPattern) mergePattern(patterns, toolPattern);

		if (turn.role === "user" && typeof turn.content === "string" && turn.content.trim().length > 0) {
			const textPatterns: PatternCandidate[] = [];
			maybePushTextPattern(textPatterns, turn.content);
			for (const candidate of textPatterns) {
				mergePattern(patterns, candidate);
			}
		}
	}

	return patterns;
}

/**
 * Extract and upsert samskaras for recent sessions in project scope.
 *
 * Upsert key includes session id to prevent duplicate counting across repeated
 * Swapna cycles over the same immutable history.
 */
export async function swapnaExtractSamskaras(
	db: DatabaseManager,
	config: SwapnaConfig,
): Promise<SamskaraExtractionResult> {
	const start = performance.now();
	const agentDb = db.get("agent");
	const now = Date.now();
	const sessionIds = resolveSwapnaSessionIds(agentDb, config);
	const sessions = sessionIds.map((id) => ({ id })) as SessionRow[];

	if (sessionIds.length === 0) {
		return { samskarasProcessed: 0, sessionsProcessed: 0, durationMs: performance.now() - start };
	}

	const selectTurns = agentDb.prepare(
		`SELECT role, content, tool_calls
		 FROM turns
		 WHERE session_id = ?
		 ORDER BY turn_number ASC`,
	);

	const upsertSamskara = agentDb.prepare(
		`INSERT INTO samskaras
			(id, session_id, pattern_type, pattern_content, observation_count,
			 confidence, pramana_type, project, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			observation_count = MAX(samskaras.observation_count, excluded.observation_count),
			confidence = MAX(samskaras.confidence, excluded.confidence),
			session_id = excluded.session_id,
			updated_at = excluded.updated_at`,
	);

	let samskarasProcessed = 0;
	let sessionsProcessed = 0;

	const upsertBatch = agentDb.transaction(
		(sessionId: string, patterns: PatternCandidate[]) => {
			for (const p of patterns) {
				const id = fnv1a(`${sessionId}:${p.patternType}:${p.patternContent}`);
				upsertSamskara.run(
					id,
					sessionId,
					p.patternType,
					p.patternContent,
					p.observationCount,
					p.confidence,
					p.pramanaType,
					config.project,
					now,
					now,
				);
			}
		},
	);

	for (const session of sessions) {
		const turns = selectTurns.all(session.id) as TurnRow[];
		if (turns.length === 0) continue;

		const sessionPatterns = extractSessionPatterns(turns);
		if (sessionPatterns.size === 0) continue;

		const rows = [...sessionPatterns.values()];
		upsertBatch(session.id, rows);
		samskarasProcessed += rows.length;
		sessionsProcessed++;
	}

	return {
		samskarasProcessed,
		sessionsProcessed,
		durationMs: performance.now() - start,
	};
}
