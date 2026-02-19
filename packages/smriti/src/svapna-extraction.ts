/**
 * @chitragupta/smriti — Svapna Extraction (Phases 1 & 2)
 *
 * REPLAY (hippocampal replay) and RECOMBINE (dream association) phases
 * of the Svapna consolidation cycle.
 */

import { DatabaseManager } from "./db/index.js";
import type { SessionToolCall } from "./types.js";
import type { SvapnaConfig, ScoredTurn, ReplayResult, CrossSessionAssociation, RecombineResult } from "./svapna-consolidation.js";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Compute a 32-bit FNV-1a hash as a zero-padded hex string. */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Tool Call Utilities ────────────────────────────────────────────────────

/** Parse tool calls from a JSON string. Returns empty array on failure. */
export function parseToolCalls(json: string | null): SessionToolCall[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? (parsed as SessionToolCall[]) : [];
	} catch {
		return [];
	}
}

/** Extract tool names from a list of tool calls. */
export function toolNames(calls: SessionToolCall[]): string[] {
	return calls.map((tc) => tc.name);
}

/** Compute success ratio from tool calls. Returns 1.0 if none. */
export function toolSuccessRate(calls: SessionToolCall[]): number {
	if (calls.length === 0) return 1.0;
	return calls.filter((tc) => !tc.isError).length / calls.length;
}

/**
 * Build a fingerprint of a tool call sequence using FNV-1a bigram hashing.
 * Captures ordered tool names for Jaccard comparison.
 */
export function buildToolFingerprint(names: string[]): Set<string> {
	const fp = new Set<string>();
	if (names.length === 0) return fp;
	for (const name of names) fp.add(fnv1a(`u:${name}`));
	for (let i = 0; i < names.length - 1; i++) {
		fp.add(fnv1a(`b:${names[i]}:${names[i + 1]}`));
	}
	return fp;
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	const smaller = a.size <= b.size ? a : b;
	const larger = a.size <= b.size ? b : a;
	for (const elem of smaller) {
		if (larger.has(elem)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union > 0 ? intersection / union : 0;
}

// ─── Phase 1: REPLAY (Hippocampal Replay) ───────────────────────────────────

/**
 * Re-traverse recent session turns and score each by surprise.
 *
 * Surprise = -log P(outcome | context), estimated from historical frequency
 * of tool-result patterns. High-surprise turns get boosted retention weight.
 */
export async function svapnaReplay(
	db: DatabaseManager,
	config: SvapnaConfig,
): Promise<ReplayResult> {
	const start = performance.now();
	const agentDb = db.get("agent");

	const sessions = agentDb
		.prepare(
			`SELECT id FROM sessions WHERE project = ? ORDER BY updated_at DESC LIMIT ?`,
		)
		.all(config.project, config.maxSessionsPerCycle) as Array<{ id: string }>;

	if (sessions.length === 0) {
		return { allTurns: [], highSurpriseTurns: [], turnsScored: 0, highSurprise: 0, durationMs: performance.now() - start };
	}

	const sessionIds = sessions.map((s) => s.id);
	const placeholders = sessionIds.map(() => "?").join(",");

	const turns = agentDb
		.prepare(
			`SELECT id, session_id, turn_number, role, content, tool_calls, created_at
			 FROM turns WHERE session_id IN (${placeholders}) ORDER BY created_at ASC`,
		)
		.all(...sessionIds) as Array<{
			id: number; session_id: string; turn_number: number; role: string;
			content: string; tool_calls: string | null; created_at: number;
		}>;

	// Build historical frequency table for tool-result patterns
	const patternCounts = new Map<string, number>();
	let totalPatterns = 0;

	for (const turn of turns) {
		const calls = parseToolCalls(turn.tool_calls);
		for (const tc of calls) {
			const key = `${tc.name}:${tc.isError ? "err" : "ok"}`;
			patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
			totalPatterns++;
		}
	}

	// Score each turn with surprise
	const scoredTurns: ScoredTurn[] = [];

	for (const turn of turns) {
		const calls = parseToolCalls(turn.tool_calls);
		let surprise = 0;

		if (calls.length > 0) {
			let totalSurprise = 0;
			for (const tc of calls) {
				const key = `${tc.name}:${tc.isError ? "err" : "ok"}`;
				const count = patternCounts.get(key) ?? 0;
				const p = totalPatterns > 0 ? count / totalPatterns : 0.5;
				totalSurprise += -Math.log(Math.max(p, 1e-6));
			}
			surprise = totalSurprise / calls.length;
		} else {
			const avgLen = turns.reduce((s, t) => s + t.content.length, 0) / turns.length;
			const deviation = Math.abs(turn.content.length - avgLen) / Math.max(avgLen, 1);
			surprise = Math.min(deviation, 5);
		}

		scoredTurns.push({
			turnId: turn.id, sessionId: turn.session_id, turnNumber: turn.turn_number,
			role: turn.role as "user" | "assistant", content: turn.content, toolCalls: calls,
			surprise, retentionWeight: 1.0, createdAt: turn.created_at,
		});
	}

	// Normalize surprise to [0, 1] and compute retention weights
	if (scoredTurns.length > 0) {
		let maxSurprise = 0;
		for (const st of scoredTurns) if (st.surprise > maxSurprise) maxSurprise = st.surprise;
		if (maxSurprise > 0) {
			for (const st of scoredTurns) {
				st.surprise /= maxSurprise;
				st.retentionWeight = 0.5 + 0.5 * st.surprise;
			}
		}
	}

	const highSurpriseTurns = scoredTurns.filter(
		(st) => st.surprise >= config.surpriseThreshold,
	);

	return {
		allTurns: scoredTurns,
		highSurpriseTurns,
		turnsScored: scoredTurns.length,
		highSurprise: highSurpriseTurns.length,
		durationMs: performance.now() - start,
	};
}

// ─── Phase 2: RECOMBINE (Dream Association) ─────────────────────────────────

/**
 * Cross-session structural similarity via Jaccard fingerprint matching
 * on tool call sequences. Identifies analogous patterns across sessions.
 */
export async function svapnaRecombine(
	db: DatabaseManager,
	config: SvapnaConfig,
	highSurpriseTurns: ScoredTurn[],
): Promise<RecombineResult> {
	const start = performance.now();

	if (highSurpriseTurns.length === 0) {
		return { associations: [], crossSessions: 0, durationMs: performance.now() - start };
	}

	const agentDb = db.get("agent");
	const sessionFingerprints = new Map<string, { fingerprint: Set<string>; fingerprintStr: string }>();

	const sessions = agentDb
		.prepare(`SELECT id FROM sessions WHERE project = ? ORDER BY updated_at DESC LIMIT ?`)
		.all(config.project, config.maxSessionsPerCycle) as Array<{ id: string }>;

	for (const session of sessions) {
		const turns = agentDb
			.prepare(
				`SELECT tool_calls FROM turns
				 WHERE session_id = ? AND tool_calls IS NOT NULL
				 ORDER BY turn_number ASC`,
			)
			.all(session.id) as Array<{ tool_calls: string }>;

		const allNames: string[] = [];
		for (const turn of turns) allNames.push(...toolNames(parseToolCalls(turn.tool_calls)));

		if (allNames.length > 0) {
			const fp = buildToolFingerprint(allNames);
			sessionFingerprints.set(session.id, {
				fingerprint: fp,
				fingerprintStr: [...fp].sort().join(","),
			});
		}
	}

	const associations: CrossSessionAssociation[] = [];
	const crossSessionPairs = new Set<string>();
	const MIN_SIMILARITY = 0.15;

	for (const st of highSurpriseTurns) {
		const turnToolNames = toolNames(st.toolCalls);
		if (turnToolNames.length === 0) continue;

		const turnFp = buildToolFingerprint(turnToolNames);
		const turnFpStr = [...turnFp].sort().join(",");

		for (const [sessionId, sessionFp] of sessionFingerprints) {
			if (sessionId === st.sessionId) continue;

			const sim = jaccardSimilarity(turnFp, sessionFp.fingerprint);
			if (sim >= MIN_SIMILARITY) {
				associations.push({
					anchorTurnId: st.turnId, anchorSessionId: st.sessionId,
					matchedSessionId: sessionId, similarity: sim,
					anchorFingerprint: turnFpStr, matchedFingerprint: sessionFp.fingerprintStr,
				});
				crossSessionPairs.add([st.sessionId, sessionId].sort().join(":"));
			}
		}
	}

	associations.sort((a, b) => b.similarity - a.similarity);
	return { associations, crossSessions: crossSessionPairs.size, durationMs: performance.now() - start };
}
