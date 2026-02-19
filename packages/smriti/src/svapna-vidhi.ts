/**
 * @chitragupta/smriti — Svapna Vidhi (Phase 4: PROCEDURALIZE)
 *
 * Extract common tool sequences as parameterized procedures (Vidhis).
 * Uses n-gram extraction + anti-unification for argument parameterization.
 */

import { DatabaseManager } from "./db/index.js";
import type { SessionToolCall, Vidhi, VidhiStep, VidhiParam } from "./types.js";
import type { SvapnaConfig, ProceduralizeResult } from "./svapna-consolidation.js";
import { parseToolCalls } from "./svapna-extraction.js";
import { slugify } from "./svapna-rules.js";

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

// ─── N-gram Extraction ──────────────────────────────────────────────────────

/**
 * Extract all n-grams of sizes [minN, maxN] from a sequence.
 *
 * @returns Map from n-gram string key to occurrence count.
 */
export function extractNgrams(
	sequence: string[],
	minN: number,
	maxN: number,
): Map<string, number> {
	const counts = new Map<string, number>();
	const effectiveMax = Math.min(maxN, sequence.length);

	for (let n = minN; n <= effectiveMax; n++) {
		for (let i = 0; i <= sequence.length - n; i++) {
			const key = sequence.slice(i, i + n).join(" -> ");
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}

	return counts;
}

// ─── Anti-Unification ───────────────────────────────────────────────────────

/**
 * Anti-unification for argument values across multiple invocations.
 * Detects which positions are "variable" vs "fixed" across instances.
 *
 * @param argSets - Array of argument objects (one per occurrence).
 * @returns Template with ${param_N} placeholders and parameter schema.
 */
export function antiUnify(
	argSets: Array<Record<string, unknown>>,
): { template: Record<string, unknown>; params: Record<string, VidhiParam> } {
	if (argSets.length === 0) return { template: {}, params: {} };

	const template: Record<string, unknown> = {};
	const params: Record<string, VidhiParam> = {};

	const allKeys = new Set<string>();
	for (const args of argSets) {
		for (const key of Object.keys(args)) allKeys.add(key);
	}

	for (const key of allKeys) {
		const values = argSets.filter((a) => key in a).map((a) => a[key]);
		const firstStr = JSON.stringify(values[0]);
		const allSame = values.every((v) => JSON.stringify(v) === firstStr);

		if (allSame && values.length === argSets.length) {
			template[key] = values[0];
		} else {
			const paramName = `param_${key}`;
			template[key] = `\${${paramName}}`;

			const types = new Set(values.map((v) => typeof v));
			let inferredType: VidhiParam["type"] = "string";
			if (types.size === 1) {
				const t = [...types][0];
				if (t === "number") inferredType = "number";
				else if (t === "boolean") inferredType = "boolean";
				else if (t === "object") inferredType = Array.isArray(values[0]) ? "array" : "object";
			}

			params[paramName] = {
				name: paramName,
				type: inferredType,
				description: `Variable argument '${key}' — differs across invocations.`,
				required: values.length === argSets.length,
				examples: values.slice(0, 3),
			};
		}
	}

	return { template, params };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Find the first occurrence of a subsequence within a sequence. Returns -1 if not found. */
function findSubsequenceStart(sequence: string[], sub: string[]): number {
	if (sub.length > sequence.length) return -1;

	outer:
	for (let i = 0; i <= sequence.length - sub.length; i++) {
		for (let j = 0; j < sub.length; j++) {
			if (sequence[i + j] !== sub[j]) continue outer;
		}
		return i;
	}

	return -1;
}

/**
 * Generate NLU trigger phrases from a tool name sequence.
 * E.g. ["read", "edit"] -> ["read then edit", "read and edit", "modify file"]
 */
function generateTriggers(tools: string[]): string[] {
	const triggers: string[] = [];
	triggers.push(tools.join(" then "));
	triggers.push(tools.join(" and "));

	const toolSet = new Set(tools);
	if (toolSet.has("read") && toolSet.has("edit")) {
		triggers.push("modify file");
		triggers.push("update file");
	}
	if (toolSet.has("grep") || toolSet.has("find")) {
		triggers.push("search codebase");
		triggers.push("find in code");
	}
	if (toolSet.has("bash")) {
		triggers.push("run command");
		triggers.push("execute");
	}
	if (toolSet.has("write")) {
		triggers.push("create file");
		triggers.push("write file");
	}
	return triggers;
}

// ─── Phase 4: PROCEDURALIZE (Vidhi Extraction) ─────────────────────────────

/**
 * Extract common tool sequences as parameterized procedures (Vidhis).
 *
 * Algorithm:
 *   1. Extract ordered tool-call sequences per session.
 *   2. Compute n-grams of sizes [minSequenceLength, 6].
 *   3. Find n-grams in >= 3 sessions with success rate > minSuccessRate.
 *   4. Anti-unify arguments to produce parameterized templates.
 */
export async function svapnaProceduralize(
	db: DatabaseManager,
	config: SvapnaConfig,
): Promise<ProceduralizeResult> {
	const start = performance.now();
	const agentDb = db.get("agent");
	const createdVidhis: Vidhi[] = [];

	const sessions = agentDb
		.prepare(`SELECT id FROM sessions WHERE project = ? ORDER BY updated_at DESC LIMIT ?`)
		.all(config.project, config.maxSessionsPerCycle) as Array<{ id: string }>;

	if (sessions.length < 3) {
		return { vidhisCreated: 0, vidhis: [], durationMs: performance.now() - start };
	}

	interface SessionToolData {
		sessionId: string;
		names: string[];
		calls: SessionToolCall[][];
		successRate: number;
	}

	const sessionToolData: SessionToolData[] = [];

	for (const session of sessions) {
		const turns = agentDb
			.prepare(
				`SELECT tool_calls FROM turns
				 WHERE session_id = ? AND tool_calls IS NOT NULL ORDER BY turn_number ASC`,
			)
			.all(session.id) as Array<{ tool_calls: string }>;

		const names: string[] = [];
		const calls: SessionToolCall[][] = [];
		let totalCalls = 0;
		let errorCalls = 0;

		for (const turn of turns) {
			const parsed = parseToolCalls(turn.tool_calls);
			for (const tc of parsed) {
				names.push(tc.name);
				calls.push([tc]);
				totalCalls++;
				if (tc.isError) errorCalls++;
			}
		}

		if (names.length >= config.minSequenceLength) {
			sessionToolData.push({
				sessionId: session.id, names, calls,
				successRate: totalCalls > 0 ? (totalCalls - errorCalls) / totalCalls : 1.0,
			});
		}
	}

	// Extract n-grams across sessions and count occurrences
	const maxNgramLen = 6;
	const ngramIndex = new Map<string, {
		sessionIds: Set<string>; toolNames: string[];
		argSets: Array<Array<Record<string, unknown>>>; successRates: number[];
	}>();

	for (const sd of sessionToolData) {
		const ngrams = extractNgrams(sd.names, config.minSequenceLength, maxNgramLen);

		for (const [ngramKey] of ngrams) {
			if (!ngramIndex.has(ngramKey)) {
				ngramIndex.set(ngramKey, {
					sessionIds: new Set(), toolNames: ngramKey.split(" -> "),
					argSets: [], successRates: [],
				});
			}

			const entry = ngramIndex.get(ngramKey)!;
			entry.sessionIds.add(sd.sessionId);
			entry.successRates.push(sd.successRate);

			const ngramToolNames = ngramKey.split(" -> ");
			const startIdx = findSubsequenceStart(sd.names, ngramToolNames);
			if (startIdx >= 0) {
				const args: Array<Record<string, unknown>> = [];
				for (let i = 0; i < ngramToolNames.length; i++) {
					if (startIdx + i >= sd.calls.length) break;
					const callGroup = sd.calls[startIdx + i];
					if (callGroup && callGroup.length > 0) {
						try {
							const parsed = JSON.parse(callGroup[0].input);
							args.push(typeof parsed === "object" && parsed !== null ? parsed : { _raw: callGroup[0].input });
						} catch {
							args.push({ _raw: callGroup[0].input });
						}
					} else {
						args.push({});
					}
				}
				entry.argSets.push(args);
			}
		}
	}

	// Filter to qualifying sequences and build Vidhis
	const now = Date.now();

	for (const [ngramKey, entry] of ngramIndex) {
		if (entry.sessionIds.size < 3) continue;

		const avgSuccess = entry.successRates.reduce((s, r) => s + r, 0) / entry.successRates.length;
		if (avgSuccess < config.minSuccessRate) continue;

		const steps: VidhiStep[] = [];
		const allParams: Record<string, VidhiParam> = {};

		for (let pos = 0; pos < entry.toolNames.length; pos++) {
			const posArgs: Array<Record<string, unknown>> = [];
			for (const argSet of entry.argSets) {
				if (argSet[pos]) posArgs.push(argSet[pos]);
			}

			const { template, params } = antiUnify(posArgs);

			for (const [pName, pDef] of Object.entries(params)) {
				const qualifiedName = `step${pos}_${pName}`;
				allParams[qualifiedName] = { ...pDef, name: qualifiedName };
				const oldRef = `\${${pName}}`;
				const newRef = `\${${qualifiedName}}`;
				for (const key of Object.keys(template)) {
					if (template[key] === oldRef) template[key] = newRef;
				}
			}

			steps.push({
				index: pos, toolName: entry.toolNames[pos],
				argTemplate: template, description: `Invoke ${entry.toolNames[pos]}`,
				critical: pos === 0,
			});
		}

		const vidhiName = slugify(ngramKey.replace(/ -> /g, "-then-"));
		const vidhiId = fnv1a(`${vidhiName}:${config.project}`);

		const existing = agentDb
			.prepare("SELECT id FROM vidhis WHERE id = ?")
			.get(vidhiId) as { id: string } | undefined;
		if (existing) continue;

		const vidhi: Vidhi = {
			id: vidhiId, project: config.project, name: vidhiName,
			learnedFrom: [...entry.sessionIds],
			confidence: Math.min(1.0, avgSuccess * (entry.sessionIds.size / sessions.length)),
			steps, triggers: generateTriggers(entry.toolNames),
			successRate: avgSuccess,
			successCount: Math.round(avgSuccess * entry.sessionIds.size),
			failureCount: Math.round((1 - avgSuccess) * entry.sessionIds.size),
			parameterSchema: allParams, createdAt: now, updatedAt: now,
		};

		agentDb
			.prepare(
				`INSERT OR IGNORE INTO vidhis
				 (id, project, name, learned_from, confidence, steps, triggers,
				  success_rate, success_count, failure_count, parameter_schema,
				  created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				vidhi.id, vidhi.project, vidhi.name,
				JSON.stringify(vidhi.learnedFrom), vidhi.confidence,
				JSON.stringify(vidhi.steps), JSON.stringify(vidhi.triggers),
				vidhi.successRate, vidhi.successCount, vidhi.failureCount,
				JSON.stringify(vidhi.parameterSchema), vidhi.createdAt, vidhi.updatedAt,
			);

		createdVidhis.push(vidhi);
	}

	return { vidhisCreated: createdVidhis.length, vidhis: createdVidhis, durationMs: performance.now() - start };
}
