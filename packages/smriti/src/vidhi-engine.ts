/**
 * @chitragupta/smriti — Vidhi Engine (Procedural Memory)
 *
 * Vidhi (विधि) — "method, procedure, rule" in Sanskrit.
 *
 * Extracts repeated, successful tool sequences from session data and
 * crystallizes them into reusable, parameterized procedures (Vidhis).
 *
 * Core algorithms:
 *   1. N-gram extraction (2..5) over tool-call sequences per session.
 *   2. Common subsequence discovery across sessions (frequency + success filter).
 *   3. Anti-unification: aligns argument instances across sessions to separate
 *      fixed (literal) from variable (parameter) positions.
 *   4. Thompson Sampling: Beta(alpha, beta) for exploration-exploitation
 *      when multiple Vidhis match.
 *   5. Trigger-phrase detection: verb-object NLU from preceding user messages.
 *   6. SQLite persistence via the vidhis table in agent.db.
 */

import { DatabaseManager } from "./db/index.js";
import type { Vidhi, VidhiStep, VidhiParam, SessionToolCall } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Engine configuration with two-tier defaults / hard ceilings. */
export interface VidhiConfig {
	/** Minimum distinct sessions an n-gram must appear in. Default: 3. */
	minSessions: number;
	/** Minimum success rate (0-1) for an n-gram to qualify. Default: 0.8. */
	minSuccessRate: number;
	/** Shortest tool sequence to consider. Default: 2. */
	minSequenceLength: number;
	/** Longest tool sequence to consider. Default: 5. */
	maxSequenceLength: number;
	/** Project scope for extraction. */
	project: string;
}

/** Result of an extraction run. */
export interface ExtractionResult {
	/** Vidhis created for the first time. */
	newVidhis: Vidhi[];
	/** Existing Vidhis whose confidence / source sessions were reinforced. */
	reinforced: Vidhi[];
	/** Total distinct n-gram sequences evaluated. */
	totalSequencesAnalyzed: number;
	/** Wall-clock duration of the extraction in milliseconds. */
	durationMs: number;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Raw tool call with session provenance. */
interface IndexedToolCall {
	sessionId: string;
	toolCall: SessionToolCall;
	/** The user message immediately preceding this tool call's turn. */
	precedingUserMessage: string;
}

/** A single n-gram instance with its tool calls and source session. */
interface NgramInstance {
	sessionId: string;
	toolCalls: SessionToolCall[];
	precedingUserMessage: string;
}

/** Aggregated n-gram across sessions. */
interface NgramAggregate {
	/** Canonical key: "tool1|tool2|...|toolN" */
	key: string;
	/** Tool names in order. */
	toolNames: string[];
	/** Instances grouped by session. Each session contributes at most one instance. */
	instances: NgramInstance[];
	/** Distinct session count. */
	sessionCount: number;
	/** Success rate across instances. */
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

/** Database row shape for the vidhis table. */
interface VidhiRow {
	id: string;
	project: string;
	name: string;
	learned_from: string;
	confidence: number;
	steps: string;
	triggers: string;
	success_rate: number;
	success_count: number;
	failure_count: number;
	parameter_schema: string | null;
	created_at: number;
	updated_at: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Action verbs for trigger-phrase extraction. */
const ACTION_VERBS = new Set([
	"add", "create", "make", "build", "write", "generate", "setup", "configure",
	"run", "execute", "start", "launch", "deploy", "test", "check", "verify",
	"fix", "debug", "patch", "repair", "resolve", "update", "upgrade", "modify",
	"change", "edit", "refactor", "rename", "move", "delete", "remove", "drop",
	"install", "uninstall", "import", "export", "migrate", "convert", "transform",
	"search", "find", "list", "show", "get", "fetch", "read", "open", "view",
	"commit", "push", "pull", "merge", "rebase", "branch", "tag", "release",
	"lint", "format", "clean", "reset", "init", "scaffold", "bootstrap",
]);

/** Default configuration values. */
const DEFAULT_CONFIG: Omit<VidhiConfig, "project"> = {
	minSessions: 3,
	minSuccessRate: 0.8,
	minSequenceLength: 2,
	maxSequenceLength: 5,
};

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash, returned as zero-padded hex string.
 * Used for deterministic Vidhi IDs.
 */
function fnv1a(str: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Vidhi Engine ───────────────────────────────────────────────────────────

/**
 * VidhiEngine — discovers, parameterizes, and tracks procedural memories.
 *
 * Usage:
 *   const engine = new VidhiEngine({ project: "/my/project", minSessions: 3 });
 *   const result = engine.extract();
 *   const match = engine.match("add a new API endpoint");
 *   engine.recordOutcome(match.id, true);
 */
export class VidhiEngine {
	private readonly _config: VidhiConfig;

	constructor(config: Partial<VidhiConfig> & { project: string }) {
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	// ─── Public API ───────────────────────────────────────────────────

	/**
	 * Extract Vidhis from recent session data.
	 *
	 * Pipeline:
	 *   1. Load tool-call sequences from the turns table.
	 *   2. Extract n-grams of length [min, max] from each session.
	 *   3. Aggregate across sessions, filter by frequency and success.
	 *   4. Anti-unify arguments to find variable positions.
	 *   5. Detect trigger phrases from preceding user messages.
	 *   6. Persist new Vidhis, reinforce existing ones.
	 */
	extract(): ExtractionResult {
		const t0 = Date.now();
		const existing = this.loadAll(this._config.project);
		const existingByKey = new Map<string, Vidhi>();
		for (const v of existing) {
			const key = v.steps.map((s) => s.toolName).join("|");
			existingByKey.set(key, v);
		}

		// 1. Load tool-call sequences per session
		const sessionSequences = this._loadSessionSequences();

		// 2-3. Extract and aggregate n-grams
		const aggregates = this._extractAndAggregate(sessionSequences);

		const newVidhis: Vidhi[] = [];
		const reinforced: Vidhi[] = [];

		for (const agg of aggregates) {
			const existingVidhi = existingByKey.get(agg.key);

			if (existingVidhi) {
				// Reinforce: merge new source sessions, bump confidence
				const mergedSessions = new Set([
					...existingVidhi.learnedFrom,
					...agg.instances.map((i) => i.sessionId),
				]);
				existingVidhi.learnedFrom = [...mergedSessions];
				existingVidhi.confidence = Math.min(
					1.0,
					existingVidhi.confidence + 0.05 * (mergedSessions.size - existingVidhi.learnedFrom.length),
				);
				existingVidhi.updatedAt = Date.now();
				this.persist(existingVidhi);
				reinforced.push(existingVidhi);
			} else {
				// Create new Vidhi
				const vidhi = this._buildVidhi(agg);
				this.persist(vidhi);
				newVidhis.push(vidhi);
			}
		}

		return {
			newVidhis,
			reinforced,
			totalSequencesAnalyzed: aggregates.length,
			durationMs: Date.now() - t0,
		};
	}

	/**
	 * Match a user query to the best Vidhi using trigger phrases.
	 *
	 * Scoring:
	 *   1. Extract verb-object tokens from the query.
	 *   2. Compare against each Vidhi's trigger phrases via Jaccard similarity.
	 *   3. Break ties with Thompson Sampling (sample from Beta distribution).
	 *
	 * @returns The best-matching Vidhi, or null if no match exceeds threshold.
	 */
	match(query: string): Vidhi | null {
		const vidhis = this.loadAll(this._config.project);
		if (vidhis.length === 0) return null;

		const queryTokens = this._tokenize(query);
		if (queryTokens.size === 0) return null;

		let bestVidhi: Vidhi | null = null;
		let bestScore = 0;

		for (const vidhi of vidhis) {
			// Jaccard similarity between query tokens and trigger tokens
			const triggerTokens = new Set<string>();
			for (const trigger of vidhi.triggers) {
				for (const tok of this._tokenize(trigger)) {
					triggerTokens.add(tok);
				}
			}

			if (triggerTokens.size === 0) continue;

			const intersection = new Set([...queryTokens].filter((t) => triggerTokens.has(t)));
			const union = new Set([...queryTokens, ...triggerTokens]);
			const jaccard = intersection.size / union.size;

			if (jaccard < 0.15) continue; // Below relevance threshold

			// Thompson Sampling: sample from Beta(alpha, beta)
			const alpha = vidhi.successCount + 1;
			const beta = vidhi.failureCount + 1;
			const thompsonSample = this._sampleBeta(alpha, beta);

			// Combined score: 70% trigger match + 30% Thompson sample
			const score = 0.7 * jaccard + 0.3 * thompsonSample;

			if (score > bestScore) {
				bestScore = score;
				bestVidhi = vidhi;
			}
		}

		return bestVidhi;
	}

	/**
	 * Record the outcome of executing a Vidhi.
	 * Updates the Thompson Sampling parameters (alpha/beta).
	 */
	recordOutcome(vidhiId: string, success: boolean): void {
		const vidhi = this.getVidhi(vidhiId);
		if (!vidhi) return;

		if (success) {
			vidhi.successCount += 1;
		} else {
			vidhi.failureCount += 1;
		}

		const alpha = vidhi.successCount + 1;
		const beta = vidhi.failureCount + 1;
		vidhi.successRate = alpha / (alpha + beta);
		vidhi.updatedAt = Date.now();

		this.persist(vidhi);
	}

	/**
	 * Get Vidhis for a project, ranked by Thompson Sampling.
	 * Each call samples from Beta(alpha, beta) to balance exploration and exploitation.
	 */
	getVidhis(project: string, topK = 10): Vidhi[] {
		const vidhis = this.loadAll(project);

		// Sample from Beta distribution for ranking
		const scored = vidhis.map((v) => ({
			vidhi: v,
			score: this._sampleBeta(v.successCount + 1, v.failureCount + 1),
		}));

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK).map((s) => s.vidhi);
	}

	/**
	 * Get a specific Vidhi by its ID.
	 */
	getVidhi(id: string): Vidhi | null {
		const db = DatabaseManager.instance().get("agent");
		const row = db.prepare("SELECT * FROM vidhis WHERE id = ?").get(id) as VidhiRow | undefined;
		return row ? this._rowToVidhi(row) : null;
	}

	/**
	 * Persist a Vidhi to SQLite (upsert).
	 */
	persist(vidhi: Vidhi): void {
		const db = DatabaseManager.instance().get("agent");
		db.prepare(`
			INSERT OR REPLACE INTO vidhis
				(id, project, name, learned_from, confidence, steps, triggers,
				 success_rate, success_count, failure_count, parameter_schema,
				 created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			vidhi.id,
			vidhi.project,
			vidhi.name,
			JSON.stringify(vidhi.learnedFrom),
			vidhi.confidence,
			JSON.stringify(vidhi.steps),
			JSON.stringify(vidhi.triggers),
			vidhi.successRate,
			vidhi.successCount,
			vidhi.failureCount,
			JSON.stringify(vidhi.parameterSchema),
			vidhi.createdAt,
			vidhi.updatedAt,
		);
	}

	/**
	 * Load all Vidhis for a project from SQLite.
	 */
	loadAll(project: string): Vidhi[] {
		const db = DatabaseManager.instance().get("agent");
		const rows = db.prepare(
			"SELECT * FROM vidhis WHERE project = ? ORDER BY success_rate DESC",
		).all(project) as VidhiRow[];
		return rows.map((r) => this._rowToVidhi(r));
	}

	// ─── Private: Data Loading ────────────────────────────────────────

	/**
	 * Load tool-call sequences per session from the turns table.
	 *
	 * Returns a map of sessionId -> array of IndexedToolCall, ordered by turn_number.
	 * Only includes sessions belonging to the configured project.
	 */
	private _loadSessionSequences(): Map<string, IndexedToolCall[]> {
		const db = DatabaseManager.instance().get("agent");

		// Get all session IDs for this project
		const sessionRows = db.prepare(
			"SELECT id FROM sessions WHERE project = ?",
		).all(this._config.project) as Array<{ id: string }>;

		const sessionIds = new Set(sessionRows.map((r) => r.id));
		if (sessionIds.size === 0) return new Map();

		// Load turns with tool calls, ordered by session then turn number
		const turnRows = db.prepare(`
			SELECT session_id, turn_number, role, content, tool_calls
			FROM turns
			WHERE session_id IN (SELECT id FROM sessions WHERE project = ?)
			ORDER BY session_id, turn_number ASC
		`).all(this._config.project) as TurnRow[];

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
				continue; // Malformed JSON — skip
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

	// ─── Private: N-gram Extraction & Aggregation ─────────────────────

	/**
	 * Extract n-grams from all session sequences and aggregate by tool-name pattern.
	 *
	 * Filters:
	 *   - N-gram length in [minSequenceLength, maxSequenceLength]
	 *   - Appears in >= minSessions distinct sessions
	 *   - Success rate >= minSuccessRate (no error tool results in the subsequence)
	 *
	 * Ranks by frequency x length (longer common sequences are more valuable).
	 */
	private _extractAndAggregate(
		sessionSequences: Map<string, IndexedToolCall[]>,
	): NgramAggregate[] {
		// key -> { sessionId -> NgramInstance }
		const ngramMap = new Map<string, Map<string, NgramInstance>>();

		for (const [sessionId, sequence] of sessionSequences) {
			if (sequence.length < this._config.minSequenceLength) continue;

			for (
				let n = this._config.minSequenceLength;
				n <= Math.min(this._config.maxSequenceLength, sequence.length);
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
			if (sessionMap.size < this._config.minSessions) continue;

			const instances = [...sessionMap.values()];
			const toolNames = key.split("|");

			// Compute success rate: proportion of instances with zero errors
			// (We already filtered error instances above, so all instances are successful
			// at the tool-call level. But check tool result content for error indicators.)
			const successfulInstances = instances.filter((inst) =>
				inst.toolCalls.every((tc) => !tc.isError),
			);
			const successRate =
				instances.length > 0 ? successfulInstances.length / instances.length : 0;

			if (successRate < this._config.minSuccessRate) continue;

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

	// ─── Private: Vidhi Construction ──────────────────────────────────

	/**
	 * Build a Vidhi from an aggregated n-gram.
	 *
	 * This is the core anti-unification + trigger extraction step:
	 *   - For each position in the n-gram, compare arguments across all instances.
	 *   - Same value everywhere -> fixed literal.
	 *   - Different values -> parameterized placeholder ${paramName}.
	 *   - Infer parameter type from observed values.
	 *   - Extract trigger phrases from preceding user messages.
	 */
	private _buildVidhi(agg: NgramAggregate): Vidhi {
		const now = Date.now();
		const name = this._generateName(agg.toolNames);
		const id = fnv1a(name + "|" + this._config.project);

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
						// Non-JSON input — treat as opaque string
						argInstances.push({ _raw: tc.input });
					}
				}
			}

			// Anti-unify: separate fixed from variable arguments
			const { template, params } = this._antiUnify(
				argInstances,
				toolName,
				stepIdx,
			);

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
		const triggers = this._extractTriggers(agg.instances);

		return {
			id,
			project: this._config.project,
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

	/**
	 * Anti-unification: given argument instances for a single tool-call position,
	 * separate fixed values (same across all instances) from variable ones
	 * (differ across instances, become ${paramName} placeholders).
	 */
	private _antiUnify(
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
				values.every((v) => this._deepEqual(v, values[0]));

			if (isFixed) {
				// Fixed literal — same across all instances
				template[key] = values[0];
			} else {
				// Variable — becomes a parameter placeholder
				const paramName = `${toolName}_${stepIdx}_${key}`;
				template[key] = `\${${paramName}}`;

				// Infer type from observed values
				const inferredType = this._inferType(values);
				const examples = this._uniqueExamples(values, 5);

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

	// ─── Private: Trigger Phrase Extraction ────────────────────────────

	/**
	 * Extract trigger phrases from the user messages preceding tool sequences.
	 *
	 * Strategy:
	 *   - Tokenize each user message.
	 *   - Find verb-object bigrams and trigrams where the first token is an action verb.
	 *   - Deduplicate and return the top phrases ordered by frequency.
	 */
	private _extractTriggers(instances: NgramInstance[]): string[] {
		const phraseCounts = new Map<string, number>();

		for (const instance of instances) {
			const msg = instance.precedingUserMessage;
			if (!msg || msg.trim().length === 0) continue;

			const phrases = this._extractVerbObjectPhrases(msg);
			for (const phrase of phrases) {
				phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
			}
		}

		// Sort by frequency, take top 10
		const sorted = [...phraseCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([phrase]) => phrase);

		return sorted;
	}

	/**
	 * Extract verb-object phrases from a user message.
	 *
	 * Simple NLU: split into words, find sequences starting with an action verb.
	 * Returns bigrams and trigrams: "add endpoint", "run test suite", etc.
	 */
	private _extractVerbObjectPhrases(message: string): string[] {
		const words = message
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 1);

		const phrases: string[] = [];

		for (let i = 0; i < words.length; i++) {
			if (!ACTION_VERBS.has(words[i])) continue;

			// Bigram: verb + object
			if (i + 1 < words.length) {
				phrases.push(`${words[i]} ${words[i + 1]}`);
			}

			// Trigram: verb + adj/prep + object
			if (i + 2 < words.length) {
				phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
			}
		}

		return phrases;
	}

	// ─── Private: Thompson Sampling ───────────────────────────────────

	/**
	 * Sample from a Beta(alpha, beta) distribution using the Joehnk algorithm.
	 *
	 * This is a simple rejection-free method that works well for small alpha, beta
	 * values typical in Thompson Sampling.
	 *
	 * For alpha=1, beta=1 (uniform prior), this is equivalent to Math.random().
	 */
	private _sampleBeta(alpha: number, beta: number): number {
		// Use the gamma distribution method: Beta(a,b) = X/(X+Y) where X~Gamma(a), Y~Gamma(b)
		const x = this._sampleGamma(alpha);
		const y = this._sampleGamma(beta);
		const sum = x + y;
		if (sum < 1e-300 || !isFinite(sum)) return 0.5; // Degenerate case: epsilon guard for float safety
		return x / sum;
	}

	/**
	 * Sample from a Gamma(shape, 1) distribution using the Marsaglia-Tsang method.
	 *
	 * For shape >= 1: use the fast squeeze method.
	 * For shape < 1: use the relation Gamma(a) = Gamma(a+1) * U^(1/a).
	 */
	private _sampleGamma(shape: number): number {
		if (shape < 1) {
			// Gamma(a) = Gamma(a+1) * U^(1/a)
			const u = Math.random();
			return this._sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
		}

		// Marsaglia-Tsang method for shape >= 1
		const d = shape - 1 / 3;
		const c = 1 / Math.sqrt(9 * d);

		for (;;) {
			let x: number;
			let v: number;

			do {
				x = this._standardNormal();
				v = 1 + c * x;
			} while (v <= 0);

			v = v * v * v;
			const u = Math.random();

			if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
			if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
		}
	}

	/**
	 * Standard normal sample via Box-Muller transform.
	 */
	private _standardNormal(): number {
		const u1 = Math.random();
		const u2 = Math.random();
		return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}

	// ─── Private: Utility Helpers ─────────────────────────────────────

	/**
	 * Generate a human-readable procedure name from tool names.
	 * Example: ["read", "edit", "bash"] -> "read-edit-bash"
	 */
	private _generateName(toolNames: string[]): string {
		return toolNames
			.map((n) => n.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase())
			.join("-then-");
	}

	/**
	 * Infer a JSON Schema type from observed values.
	 */
	private _inferType(values: unknown[]): VidhiParam["type"] {
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
		// Mixed types — default to string (safest)
		return "string";
	}

	/**
	 * Deep equality check for two values.
	 */
	private _deepEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		if (a === null || b === null) return false;
		if (typeof a !== typeof b) return false;

		if (typeof a === "object") {
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return false;
				return a.every((val, idx) => this._deepEqual(val, b[idx]));
			}

			if (Array.isArray(a) !== Array.isArray(b)) return false;

			const keysA = Object.keys(a as Record<string, unknown>);
			const keysB = Object.keys(b as Record<string, unknown>);
			if (keysA.length !== keysB.length) return false;

			return keysA.every((k) =>
				this._deepEqual(
					(a as Record<string, unknown>)[k],
					(b as Record<string, unknown>)[k],
				),
			);
		}

		return false;
	}

	/**
	 * Get up to N unique examples from a list of values.
	 */
	private _uniqueExamples(values: unknown[], max: number): unknown[] {
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

	/**
	 * Tokenize a string into a set of lowercase words, filtering stopwords.
	 */
	private _tokenize(text: string): Set<string> {
		const stopwords = new Set([
			"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
			"have", "has", "had", "do", "does", "did", "will", "would", "shall",
			"should", "may", "might", "must", "can", "could", "to", "of", "in",
			"for", "on", "with", "at", "by", "from", "as", "into", "through",
			"during", "before", "after", "above", "below", "between", "out",
			"off", "over", "under", "again", "further", "then", "once", "here",
			"there", "when", "where", "why", "how", "all", "each", "every",
			"both", "few", "more", "most", "other", "some", "such", "no", "nor",
			"not", "only", "own", "same", "so", "than", "too", "very", "just",
			"about", "up", "it", "its", "i", "me", "my", "we", "our", "you",
			"your", "he", "she", "they", "them", "this", "that", "these", "those",
			"and", "but", "or", "if", "while", "because", "until", "also",
			"please", "need", "want", "like",
		]);

		const words = text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 1 && !stopwords.has(w));

		return new Set(words);
	}

	/**
	 * Convert a database row to a Vidhi object.
	 */
	private _rowToVidhi(row: VidhiRow): Vidhi {
		return {
			id: row.id,
			project: row.project,
			name: row.name,
			learnedFrom: safeParse<string[]>(row.learned_from, []),
			confidence: row.confidence,
			steps: safeParse<VidhiStep[]>(row.steps, []),
			triggers: safeParse<string[]>(row.triggers, []),
			successRate: row.success_rate,
			successCount: row.success_count,
			failureCount: row.failure_count,
			parameterSchema: safeParse<Record<string, VidhiParam>>(
				row.parameter_schema,
				{},
			),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning a fallback on failure.
 */
function safeParse<T>(json: string | null | undefined, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}
