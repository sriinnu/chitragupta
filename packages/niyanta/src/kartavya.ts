/**
 * Kartavya (कर्तव्य — Duty/Obligation) — Auto-Execution Pipeline.
 *
 * The highest level of behavioral automation in the promotion chain:
 *
 *   samskara (observation)  →  vasana (crystallized tendency)
 *     →  niyama (proposed rule)  →  **kartavya** (auto-executed duty)
 *
 * A kartavya is a repeatable action triggered by cron schedules, events,
 * threshold conditions, or pattern matches. Kartavyas are promoted from
 * vasanas through an explicit approval pipeline (or auto-approved when
 * confidence is extremely high).
 *
 * Key features:
 * - Four trigger types: cron, event, threshold, pattern
 * - Configurable cooldown and rate limiting
 * - Two-tier config: user defaults clamped by system hard ceilings
 * - FNV-1a hashed IDs
 * - Duck-typed DatabaseLike persistence (SQLite-compatible)
 * - Full lifecycle: proposed → approved → active → paused → retired
 */

// ─── FNV-1a ─────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Hard Ceilings ──────────────────────────────────────────────────────────

/** System-level hard ceilings that cannot be exceeded by user config. */
const HARD_CEILINGS = {
	maxActive: 100,
	maxExecutionsPerHour: 60,
	minCooldownMs: 10_000, // 10s minimum
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export type KartavyaStatus = "proposed" | "approved" | "active" | "paused" | "completed" | "failed" | "retired";

export type TriggerType = "cron" | "event" | "threshold" | "pattern";

export interface KartavyaTrigger {
	type: TriggerType;
	/** Cron expression, event name, threshold expression, or pattern regex. */
	condition: string;
	/** Minimum time between executions (ms). */
	cooldownMs: number;
	/** Epoch ms of last firing. */
	lastFired?: number;
}

export interface Kartavya {
	id: string;
	name: string;
	description: string;
	status: KartavyaStatus;
	sourceVasanaId?: string;
	sourceNiyamaId?: string;
	trigger: KartavyaTrigger;
	action: KartavyaAction;
	/** Confidence in [0, 1]. */
	confidence: number;
	successCount: number;
	failureCount: number;
	lastExecuted?: number;
	createdAt: number;
	updatedAt: number;
	project?: string;
}

export type KartavyaActionType = "tool_sequence" | "vidhi" | "command" | "notification";

export interface KartavyaAction {
	type: KartavyaActionType;
	payload: Record<string, unknown>;
}

export interface NiyamaProposal {
	id: string;
	vasanaId: string;
	name: string;
	description: string;
	proposedTrigger: KartavyaTrigger;
	proposedAction: KartavyaAction;
	confidence: number;
	/** Summary of supporting observations. */
	evidence: string[];
	status: "pending" | "approved" | "rejected";
	createdAt: number;
}

export interface KartavyaConfig {
	/** Maximum simultaneously active kartavyas. Default: 20. */
	maxActive: number;
	/** Minimum confidence to propose a niyama. Default: 0.7. */
	minConfidenceForProposal: number;
	/** Minimum confidence for auto-approval (skip user review). Default: 0.95. */
	minConfidenceForAutoApprove: number;
	/** Default cooldown between executions (ms). Default: 300000 (5 min). */
	defaultCooldownMs: number;
	/** Maximum executions per hour across all kartavyas. Default: 10. */
	maxExecutionsPerHour: number;
	/** Enable automatic vasana-to-kartavya promotion. Default: true. */
	enableAutoPromotion: boolean;
}

/** Context supplied to trigger evaluation. */
export interface TriggerContext {
	/** Current epoch ms. */
	now: number;
	/** Recent event names. */
	events: string[];
	/** Named metric values. */
	metrics: Record<string, number>;
	/** Recent matched pattern strings. */
	patterns: string[];
}

/** Duck-typed database interface -- just needs prepare().run/all/get and exec. */
export interface DatabaseLike {
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
	exec(sql: string): void;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: KartavyaConfig = {
	maxActive: 20,
	minConfidenceForProposal: 0.7,
	minConfidenceForAutoApprove: 0.95,
	defaultCooldownMs: 300_000, // 5 min
	maxExecutionsPerHour: 10,
	enableAutoPromotion: true,
};

/** Clamp user config values to hard ceilings. */
function clampConfig(cfg: KartavyaConfig): KartavyaConfig {
	return {
		...cfg,
		maxActive: Math.min(cfg.maxActive, HARD_CEILINGS.maxActive),
		maxExecutionsPerHour: Math.min(cfg.maxExecutionsPerHour, HARD_CEILINGS.maxExecutionsPerHour),
		defaultCooldownMs: Math.max(cfg.defaultCooldownMs, HARD_CEILINGS.minCooldownMs),
	};
}

// ─── Vasana Input (for autoPromote) ─────────────────────────────────────────

/** Minimal vasana shape accepted by autoPromote. */
export interface VasanaInput {
	id: string;
	tendency: string;
	description: string;
	strength: number;
	predictiveAccuracy: number;
}

// ─── KartavyaEngine ─────────────────────────────────────────────────────────

/**
 * Auto-execution pipeline for behavioral duties.
 *
 * Manages the full lifecycle from niyama proposal through active kartavya
 * execution, with trigger evaluation, cooldown enforcement, rate limiting,
 * and SQLite persistence.
 *
 * @example
 * ```ts
 * const engine = new KartavyaEngine({ maxActive: 10 });
 *
 * // Propose from a vasana
 * const proposal = engine.proposeNiyama("vas-abc", "auto-lint", "Lint on save",
 *   { type: "event", condition: "file:saved", cooldownMs: 60000 },
 *   { type: "command", payload: { cmd: "npm run lint" } },
 *   ["User always runs lint after saving"]
 * );
 *
 * // Approve → becomes active kartavya
 * const kartavya = engine.approveNiyama(proposal.id);
 *
 * // Evaluate triggers
 * const ready = engine.evaluateTriggers({ now: Date.now(), events: ["file:saved"], metrics: {}, patterns: [] });
 * ```
 */
export class KartavyaEngine {
	private readonly config: KartavyaConfig;
	private readonly kartavyas = new Map<string, Kartavya>();
	private readonly proposals = new Map<string, NiyamaProposal>();
	private readonly executionLog: number[] = []; // Epoch ms of each execution

	constructor(config?: Partial<KartavyaConfig>) {
		this.config = clampConfig({ ...DEFAULT_CONFIG, ...config });
	}

	// ─── Promotion Pipeline ─────────────────────────────────────────────

	/**
	 * Propose a niyama from a vasana. The proposal requires user review
	 * before it becomes an active kartavya.
	 *
	 * @param vasanaId - Source vasana ID.
	 * @param name - Human-readable name for the proposed duty.
	 * @param description - What this kartavya does.
	 * @param trigger - When it should fire.
	 * @param action - What it should do.
	 * @param evidence - Supporting observations from the vasana.
	 * @returns The created NiyamaProposal.
	 * @throws If confidence is below minConfidenceForProposal.
	 */
	proposeNiyama(
		vasanaId: string,
		name: string,
		description: string,
		trigger: KartavyaTrigger,
		action: KartavyaAction,
		evidence: string[],
		confidence?: number,
	): NiyamaProposal {
		const conf = confidence ?? this.config.minConfidenceForProposal;
		if (conf < this.config.minConfidenceForProposal) {
			throw new Error(
				`Confidence ${conf.toFixed(3)} is below minimum threshold ${this.config.minConfidenceForProposal} for proposal`,
			);
		}

		const now = Date.now();
		const id = fnv1a(`niy:${vasanaId}:${name}:${now}`);

		// Enforce minimum cooldown
		const clampedTrigger: KartavyaTrigger = {
			...trigger,
			cooldownMs: Math.max(trigger.cooldownMs, HARD_CEILINGS.minCooldownMs),
		};

		const proposal: NiyamaProposal = {
			id,
			vasanaId,
			name,
			description,
			proposedTrigger: clampedTrigger,
			proposedAction: action,
			confidence: conf,
			evidence: [...evidence],
			status: "pending",
			createdAt: now,
		};

		this.proposals.set(id, proposal);
		return proposal;
	}

	/**
	 * User approves a niyama, promoting it to an active kartavya.
	 *
	 * @param niyamaId - ID of the pending niyama proposal.
	 * @returns The newly created Kartavya.
	 * @throws If the niyama does not exist, is not pending, or max active limit reached.
	 */
	approveNiyama(niyamaId: string): Kartavya {
		const proposal = this.proposals.get(niyamaId);
		if (!proposal) {
			throw new Error(`Niyama proposal '${niyamaId}' not found`);
		}
		if (proposal.status !== "pending") {
			throw new Error(`Niyama '${niyamaId}' is already ${proposal.status}`);
		}

		// Check active limit
		const activeCount = this.countActive();
		if (activeCount >= this.config.maxActive) {
			throw new Error(
				`Cannot approve: active kartavya limit reached (${activeCount}/${this.config.maxActive})`,
			);
		}

		proposal.status = "approved";

		const now = Date.now();
		const kartavyaId = fnv1a(`krt:${proposal.vasanaId}:${proposal.name}:${now}`);

		const kartavya: Kartavya = {
			id: kartavyaId,
			name: proposal.name,
			description: proposal.description,
			status: "active",
			sourceVasanaId: proposal.vasanaId,
			sourceNiyamaId: niyamaId,
			trigger: { ...proposal.proposedTrigger },
			action: { ...proposal.proposedAction },
			confidence: proposal.confidence,
			successCount: 0,
			failureCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		this.kartavyas.set(kartavyaId, kartavya);
		return kartavya;
	}

	/**
	 * User rejects a niyama proposal.
	 *
	 * @param niyamaId - ID of the pending niyama proposal.
	 * @throws If the niyama does not exist or is not pending.
	 */
	rejectNiyama(niyamaId: string): void {
		const proposal = this.proposals.get(niyamaId);
		if (!proposal) {
			throw new Error(`Niyama proposal '${niyamaId}' not found`);
		}
		if (proposal.status !== "pending") {
			throw new Error(`Niyama '${niyamaId}' is already ${proposal.status}`);
		}
		proposal.status = "rejected";
	}

	/**
	 * Auto-promote very high confidence vasanas. Vasanas whose combined
	 * strength * predictiveAccuracy meets the auto-approve threshold are
	 * proposed and immediately approved without user review.
	 *
	 * @param vasanas - Array of vasana inputs to consider.
	 * @returns Array of NiyamaProposals that were auto-promoted.
	 */
	autoPromote(vasanas: VasanaInput[]): NiyamaProposal[] {
		if (!this.config.enableAutoPromotion) return [];

		const promoted: NiyamaProposal[] = [];

		for (const v of vasanas) {
			const compositeConfidence = v.strength * v.predictiveAccuracy;
			if (compositeConfidence < this.config.minConfidenceForAutoApprove) continue;

			// Check active limit before promoting
			if (this.countActive() >= this.config.maxActive) break;

			const proposal = this.proposeNiyama(
				v.id,
				v.tendency,
				v.description,
				{
					type: "pattern",
					condition: v.tendency,
					cooldownMs: this.config.defaultCooldownMs,
				},
				{
					type: "tool_sequence",
					payload: { tendency: v.tendency },
				},
				[`Auto-promoted: strength=${v.strength.toFixed(3)}, accuracy=${v.predictiveAccuracy.toFixed(3)}`],
				compositeConfidence,
			);

			// Auto-approve immediately
			this.approveNiyama(proposal.id);
			promoted.push(proposal);
		}

		return promoted;
	}

	// ─── Trigger Evaluation ─────────────────────────────────────────────

	/**
	 * Evaluate all active kartavya triggers against the current context.
	 * Returns the list of kartavyas ready to execute (triggers matched,
	 * cooldown elapsed, rate limit not exceeded).
	 *
	 * @param context - Current trigger context.
	 * @returns Array of kartavyas whose triggers matched.
	 */
	evaluateTriggers(context: TriggerContext): Kartavya[] {
		this.pruneExecutionLog(context.now);

		const ready: Kartavya[] = [];

		for (const k of this.kartavyas.values()) {
			if (k.status !== "active") continue;

			// Rate limit check
			if (this.executionLog.length >= this.config.maxExecutionsPerHour) continue;

			// Cooldown check
			if (k.trigger.lastFired && (context.now - k.trigger.lastFired) < k.trigger.cooldownMs) {
				continue;
			}

			// Trigger-specific matching
			let matched = false;
			switch (k.trigger.type) {
				case "cron":
					matched = this.matchesCron(k.trigger.condition, new Date(context.now));
					break;
				case "event":
					matched = context.events.includes(k.trigger.condition);
					break;
				case "threshold":
					matched = this.evaluateThreshold(k.trigger.condition, context.metrics);
					break;
				case "pattern":
					matched = this.evaluatePattern(k.trigger.condition, context.patterns);
					break;
			}

			if (matched) {
				ready.push(k);
			}
		}

		return ready;
	}

	/**
	 * Check if a simplified cron expression matches the given time.
	 *
	 * Supports: `minute hour dayOfMonth month dayOfWeek`
	 * - `*` matches any value
	 * - Specific numbers: `30`, `14`
	 * - Step values: `* /5` (every 5 units, written without space)
	 *
	 * Only checks if NOW matches -- no scheduling involved.
	 *
	 * @param cronExpr - A 5-field cron expression.
	 * @param now - The time to check against (defaults to current time).
	 * @returns Whether the cron expression matches the given time.
	 */
	matchesCron(cronExpr: string, now?: Date): boolean {
		const date = now ?? new Date();
		const parts = cronExpr.trim().split(/\s+/);
		if (parts.length !== 5) return false;

		const fields = [
			date.getMinutes(),     // minute
			date.getHours(),       // hour
			date.getDate(),        // dayOfMonth
			date.getMonth() + 1,   // month (1-indexed)
			date.getDay(),         // dayOfWeek (0 = Sunday)
		];

		for (let i = 0; i < 5; i++) {
			if (!this.matchCronField(parts[i], fields[i])) return false;
		}

		return true;
	}

	// ─── Execution ──────────────────────────────────────────────────────

	/**
	 * Record the execution result for a kartavya. Updates success/failure
	 * counts, confidence, timestamp, and execution log.
	 *
	 * @param kartavyaId - The kartavya that was executed.
	 * @param success - Whether the execution succeeded.
	 * @param _result - Optional result description (reserved for future use).
	 */
	recordExecution(kartavyaId: string, success: boolean, _result?: string): void {
		const k = this.kartavyas.get(kartavyaId);
		if (!k) throw new Error(`Kartavya '${kartavyaId}' not found`);

		const now = Date.now();
		k.lastExecuted = now;
		k.trigger.lastFired = now;
		k.updatedAt = now;

		if (success) {
			k.successCount++;
			// Reinforce confidence on success (bounded at 1.0)
			k.confidence = Math.min(1.0, k.confidence + 0.01);
		} else {
			k.failureCount++;
			// Decay confidence on failure
			k.confidence = Math.max(0, k.confidence - 0.05);

			// Auto-pause on persistent failure (>50% failure rate after 5+ executions)
			const totalExec = k.successCount + k.failureCount;
			if (totalExec >= 5 && k.failureCount / totalExec > 0.5) {
				k.status = "failed";
			}
		}

		this.executionLog.push(now);
	}

	// ─── Control ────────────────────────────────────────────────────────

	/**
	 * Pause an active kartavya.
	 *
	 * @param kartavyaId - The kartavya to pause.
	 * @throws If the kartavya does not exist or is not active.
	 */
	pause(kartavyaId: string): void {
		const k = this.kartavyas.get(kartavyaId);
		if (!k) throw new Error(`Kartavya '${kartavyaId}' not found`);
		if (k.status !== "active") {
			throw new Error(`Cannot pause kartavya in '${k.status}' status`);
		}
		k.status = "paused";
		k.updatedAt = Date.now();
	}

	/**
	 * Resume a paused kartavya.
	 *
	 * @param kartavyaId - The kartavya to resume.
	 * @throws If the kartavya does not exist or is not paused.
	 */
	resume(kartavyaId: string): void {
		const k = this.kartavyas.get(kartavyaId);
		if (!k) throw new Error(`Kartavya '${kartavyaId}' not found`);
		if (k.status !== "paused") {
			throw new Error(`Cannot resume kartavya in '${k.status}' status`);
		}
		k.status = "active";
		k.updatedAt = Date.now();
	}

	/**
	 * Retire a kartavya permanently.
	 *
	 * @param kartavyaId - The kartavya to retire.
	 * @throws If the kartavya does not exist.
	 */
	retire(kartavyaId: string): void {
		const k = this.kartavyas.get(kartavyaId);
		if (!k) throw new Error(`Kartavya '${kartavyaId}' not found`);
		k.status = "retired";
		k.updatedAt = Date.now();
	}

	// ─── Queries ────────────────────────────────────────────────────────

	/**
	 * Get a kartavya by ID.
	 *
	 * @param id - The kartavya ID.
	 * @returns The kartavya, or undefined if not found.
	 */
	getKartavya(id: string): Kartavya | undefined {
		return this.kartavyas.get(id);
	}

	/**
	 * List all active kartavyas, optionally filtered by project.
	 *
	 * @param project - Optional project scope.
	 * @returns Array of active kartavyas.
	 */
	listActive(project?: string): Kartavya[] {
		const all: Kartavya[] = [];
		for (const k of this.kartavyas.values()) {
			if (k.status !== "active") continue;
			if (project !== undefined && k.project !== project) continue;
			all.push(k);
		}
		return all;
	}

	/**
	 * List all kartavyas, optionally filtered by project.
	 *
	 * @param project - Optional project scope.
	 * @returns Array of all kartavyas.
	 */
	listAll(project?: string): Kartavya[] {
		const all: Kartavya[] = [];
		for (const k of this.kartavyas.values()) {
			if (project !== undefined && k.project !== project) continue;
			all.push(k);
		}
		return all;
	}

	/**
	 * Get all pending niyama proposals.
	 *
	 * @returns Array of NiyamaProposals with status "pending".
	 */
	getPendingNiyamas(): NiyamaProposal[] {
		const pending: NiyamaProposal[] = [];
		for (const p of this.proposals.values()) {
			if (p.status === "pending") pending.push(p);
		}
		return pending;
	}

	// ─── Persistence ────────────────────────────────────────────────────

	/**
	 * Persist all kartavyas and niyama proposals to a SQLite database.
	 * Creates tables if they do not exist, then upserts all rows.
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	persist(db: DatabaseLike): void {
		db.exec(`
			CREATE TABLE IF NOT EXISTS kartavyas (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				status TEXT NOT NULL DEFAULT 'proposed',
				source_vasana_id TEXT,
				source_niyama_id TEXT,
				trigger_json TEXT NOT NULL,
				action_json TEXT NOT NULL,
				confidence REAL NOT NULL DEFAULT 0,
				success_count INTEGER NOT NULL DEFAULT 0,
				failure_count INTEGER NOT NULL DEFAULT 0,
				last_executed INTEGER,
				project TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`);

		db.exec(`
			CREATE TABLE IF NOT EXISTS niyama_proposals (
				id TEXT PRIMARY KEY,
				vasana_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				trigger_json TEXT NOT NULL,
				action_json TEXT NOT NULL,
				confidence REAL NOT NULL,
				evidence_json TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				created_at INTEGER NOT NULL
			);
		`);

		const upsertKartavya = db.prepare(`
			INSERT OR REPLACE INTO kartavyas
				(id, name, description, status, source_vasana_id, source_niyama_id,
				 trigger_json, action_json, confidence, success_count, failure_count,
				 last_executed, project, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		for (const k of this.kartavyas.values()) {
			upsertKartavya.run(
				k.id, k.name, k.description, k.status,
				k.sourceVasanaId ?? null, k.sourceNiyamaId ?? null,
				JSON.stringify(k.trigger), JSON.stringify(k.action),
				k.confidence, k.successCount, k.failureCount,
				k.lastExecuted ?? null, k.project ?? null,
				k.createdAt, k.updatedAt,
			);
		}

		const upsertProposal = db.prepare(`
			INSERT OR REPLACE INTO niyama_proposals
				(id, vasana_id, name, description, trigger_json, action_json,
				 confidence, evidence_json, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		for (const p of this.proposals.values()) {
			upsertProposal.run(
				p.id, p.vasanaId, p.name, p.description,
				JSON.stringify(p.proposedTrigger), JSON.stringify(p.proposedAction),
				p.confidence, JSON.stringify(p.evidence),
				p.status, p.createdAt,
			);
		}
	}

	/**
	 * Restore kartavyas and niyama proposals from a SQLite database.
	 * Existing in-memory data is replaced.
	 *
	 * @param db - A duck-typed database handle with prepare/exec methods.
	 */
	restore(db: DatabaseLike): void {
		// Ensure tables exist (in case restore is called on a fresh DB)
		db.exec(`
			CREATE TABLE IF NOT EXISTS kartavyas (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				status TEXT NOT NULL DEFAULT 'proposed',
				source_vasana_id TEXT,
				source_niyama_id TEXT,
				trigger_json TEXT NOT NULL,
				action_json TEXT NOT NULL,
				confidence REAL NOT NULL DEFAULT 0,
				success_count INTEGER NOT NULL DEFAULT 0,
				failure_count INTEGER NOT NULL DEFAULT 0,
				last_executed INTEGER,
				project TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`);

		db.exec(`
			CREATE TABLE IF NOT EXISTS niyama_proposals (
				id TEXT PRIMARY KEY,
				vasana_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				trigger_json TEXT NOT NULL,
				action_json TEXT NOT NULL,
				confidence REAL NOT NULL,
				evidence_json TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				created_at INTEGER NOT NULL
			);
		`);

		this.kartavyas.clear();
		this.proposals.clear();

		// Load kartavyas
		const kartavyaRows = db.prepare("SELECT * FROM kartavyas").all() as Array<Record<string, unknown>>;
		for (const row of kartavyaRows) {
			try {
				const k: Kartavya = {
					id: row.id as string,
					name: row.name as string,
					description: (row.description as string) ?? "",
					status: row.status as KartavyaStatus,
					sourceVasanaId: row.source_vasana_id as string | undefined,
					sourceNiyamaId: row.source_niyama_id as string | undefined,
					trigger: JSON.parse(row.trigger_json as string) as KartavyaTrigger,
					action: JSON.parse(row.action_json as string) as KartavyaAction,
					confidence: row.confidence as number,
					successCount: row.success_count as number,
					failureCount: row.failure_count as number,
					lastExecuted: row.last_executed as number | undefined,
					project: row.project as string | undefined,
					createdAt: row.created_at as number,
					updatedAt: row.updated_at as number,
				};
				this.kartavyas.set(k.id, k);
			} catch {
				// Skip corrupted kartavya row
			}
		}

		// Load proposals
		const proposalRows = db.prepare("SELECT * FROM niyama_proposals").all() as Array<Record<string, unknown>>;
		for (const row of proposalRows) {
			try {
				const p: NiyamaProposal = {
					id: row.id as string,
					vasanaId: row.vasana_id as string,
					name: row.name as string,
					description: (row.description as string) ?? "",
					proposedTrigger: JSON.parse(row.trigger_json as string) as KartavyaTrigger,
					proposedAction: JSON.parse(row.action_json as string) as KartavyaAction,
					confidence: row.confidence as number,
					evidence: JSON.parse((row.evidence_json as string) ?? "[]") as string[],
					status: row.status as NiyamaProposal["status"],
					createdAt: row.created_at as number,
				};
				this.proposals.set(p.id, p);
			} catch {
				// Skip corrupted proposal row
			}
		}
	}

	// ─── Stats ──────────────────────────────────────────────────────────

	/**
	 * Get aggregate statistics about the kartavya engine.
	 *
	 * @returns Object with counts and execution metrics.
	 */
	stats(): {
		total: number;
		active: number;
		paused: number;
		proposed: number;
		successRate: number;
		executionsThisHour: number;
	} {
		let total = 0;
		let active = 0;
		let paused = 0;
		let totalSuccess = 0;
		let totalExec = 0;

		for (const k of this.kartavyas.values()) {
			total++;
			if (k.status === "active") active++;
			if (k.status === "paused") paused++;
			totalSuccess += k.successCount;
			totalExec += k.successCount + k.failureCount;
		}

		const proposed = this.getPendingNiyamas().length;
		const successRate = totalExec > 0 ? totalSuccess / totalExec : 0;

		this.pruneExecutionLog(Date.now());

		return {
			total,
			active,
			paused,
			proposed,
			successRate,
			executionsThisHour: this.executionLog.length,
		};
	}

	// ─── Internal: Cron Field Matching ──────────────────────────────────

	/**
	 * Match a single cron field against a value.
	 *
	 * Supports:
	 * - `*` (any)
	 * - Specific number (`30`)
	 * - Step values (`* /5` written as `*​/5`)
	 */
	private matchCronField(field: string, value: number): boolean {
		if (field === "*") return true;

		// Step value: */N
		if (field.startsWith("*/")) {
			const step = parseInt(field.slice(2), 10);
			if (isNaN(step) || step <= 0) return false;
			return value % step === 0;
		}

		// Specific number
		const num = parseInt(field, 10);
		if (isNaN(num)) return false;
		return value === num;
	}

	// ─── Internal: Threshold Evaluation ─────────────────────────────────

	/**
	 * Evaluate a threshold expression against metric values.
	 *
	 * Supports: `metric_name > value`, `metric_name < value`,
	 *           `metric_name >= value`, `metric_name <= value`,
	 *           `metric_name == value`
	 */
	private evaluateThreshold(condition: string, metrics: Record<string, number>): boolean {
		// Parse: metric_name operator value
		const match = condition.match(/^(\w+)\s*(>=|<=|>|<|==)\s*([\d.]+)$/);
		if (!match) return false;

		const [, metricName, operator, valueStr] = match;
		const metricValue = metrics[metricName];
		if (metricValue === undefined) return false;

		const threshold = parseFloat(valueStr);
		if (isNaN(threshold)) return false;

		switch (operator) {
			case ">": return metricValue > threshold;
			case "<": return metricValue < threshold;
			case ">=": return metricValue >= threshold;
			case "<=": return metricValue <= threshold;
			case "==": return metricValue === threshold;
			default: return false;
		}
	}

	// ─── Internal: Pattern Evaluation ───────────────────────────────────

	/**
	 * Evaluate a pattern trigger: checks if the condition regex matches
	 * any of the recent pattern strings.
	 */
	private evaluatePattern(condition: string, patterns: string[]): boolean {
		try {
			const regex = new RegExp(condition);
			return patterns.some((p) => regex.test(p));
		} catch {
			// Invalid regex — treat as literal substring match
			return patterns.some((p) => p.includes(condition));
		}
	}

	// ─── Internal: Rate Limit ───────────────────────────────────────────

	/**
	 * Remove execution log entries older than 1 hour.
	 */
	private pruneExecutionLog(now: number): void {
		const oneHourAgo = now - 3_600_000;
		while (this.executionLog.length > 0 && this.executionLog[0] < oneHourAgo) {
			this.executionLog.shift();
		}
	}

	// ─── Internal: Count Helpers ────────────────────────────────────────

	/**
	 * Count currently active kartavyas.
	 */
	private countActive(): number {
		let count = 0;
		for (const k of this.kartavyas.values()) {
			if (k.status === "active") count++;
		}
		return count;
	}
}
