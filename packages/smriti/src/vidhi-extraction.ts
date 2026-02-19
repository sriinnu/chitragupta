/**
 * @chitragupta/smriti — Vidhi Extraction & Construction
 *
 * Data loading from SQLite, n-gram extraction, anti-unification, and Vidhi construction.
 * Extracted from vidhi-engine.ts to keep modules under 450 LOC.
 */
import { DatabaseManager } from "./db/index.js";
import type { Vidhi, VidhiStep, VidhiParam, SessionToolCall } from "./types.js";
import type { VidhiConfig } from "./vidhi-engine.js";
import { extractTriggers, type NgramInstance } from "./vidhi-matching.js";

/** Raw tool call with session provenance. */
interface IndexedToolCall {
	sessionId: string;
	toolCall: SessionToolCall;
	precedingUserMessage: string;
}

/** Aggregated n-gram across sessions. */
export interface NgramAggregate {
	key: string;
	toolNames: string[];
	instances: NgramInstance[];
	sessionCount: number;
	successRate: number;
}

/** Database row shape for the turns table. */
interface TurnRow {
	session_id: string;
	turn_number: number;
	role: string;
	content: string;
	tool_calls: string | null;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash, returned as zero-padded hex string for deterministic Vidhi IDs. */
export function fnv1a(str: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * Load tool-call sequences per session from the turns table.
 * Only includes sessions belonging to the configured project.
 */
export function loadSessionSequences(
	config: VidhiConfig,
): Map<string, IndexedToolCall[]> {
	const db = DatabaseManager.instance().get("agent");

	// Get all session IDs for this project
	const sessionRows = db.prepare(
		"SELECT id FROM sessions WHERE project = ?",
	).all(config.project) as Array<{ id: string }>;

	const sessionIds = new Set(sessionRows.map((r) => r.id));
	if (sessionIds.size === 0) return new Map();

	// Load turns with tool calls, ordered by session then turn number
	const turnRows = db.prepare(`
		SELECT session_id, turn_number, role, content, tool_calls
		FROM turns
		WHERE session_id IN (SELECT id FROM sessions WHERE project = ?)
		ORDER BY session_id, turn_number ASC
	`).all(config.project) as TurnRow[];

	const result = new Map<string, IndexedToolCall[]>();
	let lastUserMessage = "";

	for (const row of turnRows) {
		// Track the most recent user message for trigger extraction
		if (row.role === "user") {
			lastUserMessage = row.content;
			continue;
		}

		// Only process assistant turns with tool calls
		if (row.role !== "assistant" || !row.tool_calls) continue;

		let toolCalls: SessionToolCall[];
		try {
			toolCalls = JSON.parse(row.tool_calls) as SessionToolCall[];
		} catch {
			continue; // Malformed JSON -- skip
		}

		if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue;

		if (!result.has(row.session_id)) {
			result.set(row.session_id, []);
		}

		const seq = result.get(row.session_id)!;
		for (const tc of toolCalls) {
			seq.push({
				sessionId: row.session_id,
				toolCall: tc,
				precedingUserMessage: lastUserMessage,
			});
		}
	}

	return result;
}

/**
 * Extract n-grams from all session sequences and aggregate by tool-name pattern.
 * Filters by length, session frequency, and success rate, then ranks by frequency x length.
 */
export function extractAndAggregate(
	sessionSequences: Map<string, IndexedToolCall[]>,
	config: VidhiConfig,
): NgramAggregate[] {
	// key -> { sessionId -> NgramInstance }
	const ngramMap = new Map<string, Map<string, NgramInstance>>();

	for (const [sessionId, sequence] of sessionSequences) {
		if (sequence.length < config.minSequenceLength) continue;

		for (
			let n = config.minSequenceLength;
			n <= Math.min(config.maxSequenceLength, sequence.length);
			n++
		) {
			for (let i = 0; i <= sequence.length - n; i++) {
				const window = sequence.slice(i, i + n);

				// Skip if any tool call in the window is an error
				const hasError = window.some((w) => w.toolCall.isError === true);
				if (hasError) continue;

				const key = window.map((w) => w.toolCall.name).join("|");

				if (!ngramMap.has(key)) {
					ngramMap.set(key, new Map());
				}

				const sessions = ngramMap.get(key)!;

				// Only keep the first instance per session (avoid inflating frequency)
				if (!sessions.has(sessionId)) {
					sessions.set(sessionId, {
						sessionId,
						toolCalls: window.map((w) => w.toolCall),
						precedingUserMessage: window[0].precedingUserMessage,
					});
				}
			}
		}
	}

	// Aggregate and filter
	const aggregates: NgramAggregate[] = [];

	for (const [key, sessionMap] of ngramMap) {
		if (sessionMap.size < config.minSessions) continue;

		const instances = [...sessionMap.values()];
		const toolNames = key.split("|");

		// Compute success rate: proportion of instances with zero errors
		const successfulInstances = instances.filter((inst) =>
			inst.toolCalls.every((tc) => !tc.isError),
		);
		const successRate =
			instances.length > 0 ? successfulInstances.length / instances.length : 0;

		if (successRate < config.minSuccessRate) continue;

		aggregates.push({
			key,
			toolNames,
			instances,
			sessionCount: sessionMap.size,
			successRate,
		});
	}

	// Rank by frequency x length (longer common sequences preferred)
	aggregates.sort((a, b) => {
		const scoreA = a.sessionCount * a.toolNames.length;
		const scoreB = b.sessionCount * b.toolNames.length;
		return scoreB - scoreA;
	});

	return aggregates;
}

/**
 * Anti-unification: separate fixed values from variable ones across argument instances.
 * Fixed values stay as literals; variable ones become ${paramName} placeholders.
 */
export function antiUnify(
	argInstances: Array<Record<string, unknown>>,
	toolName: string,
	stepIdx: number,
): { template: Record<string, unknown>; params: Record<string, VidhiParam> } {
	if (argInstances.length === 0) {
		return { template: {}, params: {} };
	}

	const template: Record<string, unknown> = {};
	const params: Record<string, VidhiParam> = {};

	// Collect all keys seen across instances
	const allKeys = new Set<string>();
	for (const inst of argInstances) {
		for (const key of Object.keys(inst)) {
			allKeys.add(key);
		}
	}

	for (const key of allKeys) {
		// Collect all values for this key
		const values: unknown[] = [];
		for (const inst of argInstances) {
			if (key in inst) {
				values.push(inst[key]);
			}
		}

		// Check if all values are identical
		const isFixed = values.length === argInstances.length &&
			values.every((v) => deepEqual(v, values[0]));

		if (isFixed) {
			// Fixed literal -- same across all instances
			template[key] = values[0];
		} else {
			// Variable -- becomes a parameter placeholder
			const paramName = `${toolName}_${stepIdx}_${key}`;
			template[key] = `\${${paramName}}`;

			// Infer type from observed values
			const inferredType = inferType(values);
			const examples = uniqueExamples(values, 5);

			params[paramName] = {
				name: paramName,
				type: inferredType,
				description: `Parameter '${key}' for ${toolName} (step ${stepIdx + 1})`,
				required: values.length === argInstances.length,
				defaultValue: undefined,
				examples,
			};
		}
	}

	return { template, params };
}

/**
 * Build a Vidhi from an aggregated n-gram via anti-unification + trigger extraction.
 * For each step, separates fixed from variable arguments and detects trigger phrases.
 */
export function buildVidhi(agg: NgramAggregate, config: VidhiConfig): Vidhi {
	const now = Date.now();
	const name = generateName(agg.toolNames);
	const id = fnv1a(name + "|" + config.project);

	const parameterSchema: Record<string, VidhiParam> = {};
	const steps: VidhiStep[] = [];

	for (let stepIdx = 0; stepIdx < agg.toolNames.length; stepIdx++) {
		const toolName = agg.toolNames[stepIdx];

		// Collect all argument objects for this step across instances
		const argInstances: Array<Record<string, unknown>> = [];
		for (const instance of agg.instances) {
			const tc = instance.toolCalls[stepIdx];
			if (tc) {
				try {
					const parsed =
						typeof tc.input === "string" ? JSON.parse(tc.input) : tc.input;
					if (typeof parsed === "object" && parsed !== null) {
						argInstances.push(parsed as Record<string, unknown>);
					}
				} catch {
					// Non-JSON input -- treat as opaque string
					argInstances.push({ _raw: tc.input });
				}
			}
		}

		// Anti-unify: separate fixed from variable arguments
		const { template, params } = antiUnify(argInstances, toolName, stepIdx);

		// Merge discovered params into schema
		for (const [pName, pDef] of Object.entries(params)) {
			if (!parameterSchema[pName]) {
				parameterSchema[pName] = pDef;
			}
		}

		steps.push({
			index: stepIdx,
			toolName,
			argTemplate: template,
			description: `Execute ${toolName} (step ${stepIdx + 1} of ${agg.toolNames.length})`,
			critical: true,
		});
	}

	// Extract trigger phrases from user messages
	const triggers = extractTriggers(agg.instances);

	return {
		id,
		project: config.project,
		name,
		learnedFrom: agg.instances.map((i) => i.sessionId),
		confidence: Math.min(1.0, 0.5 + 0.1 * agg.sessionCount),
		steps,
		triggers,
		successRate: agg.successRate,
		successCount: 0,
		failureCount: 0,
		parameterSchema,
		createdAt: now,
		updatedAt: now,
	};
}

/** Generate a human-readable procedure name: ["read", "edit"] -> "read-then-edit". */
export function generateName(toolNames: string[]): string {
	return toolNames
		.map((n) => n.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase())
		.join("-then-");
}

/** Infer a JSON Schema type from observed values. Mixed types fall back to "string". */
export function inferType(values: unknown[]): VidhiParam["type"] {
	const types = new Set<string>();
	for (const v of values) {
		if (v === null || v === undefined) continue;
		if (typeof v === "string") types.add("string");
		else if (typeof v === "number") types.add("number");
		else if (typeof v === "boolean") types.add("boolean");
		else if (Array.isArray(v)) types.add("array");
		else if (typeof v === "object") types.add("object");
	}

	if (types.size === 0) return "string";
	if (types.size === 1) return [...types][0] as VidhiParam["type"];
	// Mixed types -- default to string (safest)
	return "string";
}

/** Deep equality check for primitives, arrays, and plain objects. */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;

	if (typeof a === "object") {
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) return false;
			return a.every((val, idx) => deepEqual(val, b[idx]));
		}

		if (Array.isArray(a) !== Array.isArray(b)) return false;

		const keysA = Object.keys(a as Record<string, unknown>);
		const keysB = Object.keys(b as Record<string, unknown>);
		if (keysA.length !== keysB.length) return false;

		return keysA.every((k) =>
			deepEqual(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
			),
		);
	}

	return false;
}

/** Get up to N unique examples from a list of values (JSON-deduped). */
export function uniqueExamples(values: unknown[], max: number): unknown[] {
	const seen = new Set<string>();
	const examples: unknown[] = [];

	for (const v of values) {
		const key = JSON.stringify(v);
		if (seen.has(key)) continue;
		seen.add(key);
		examples.push(v);
		if (examples.length >= max) break;
	}

	return examples;
}
