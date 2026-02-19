/**
 * Kartavya (कर्तव्य — Duty/Obligation) — Auto-Execution Pipeline.
 *
 * Promotion chain: samskara → vasana → niyama → **kartavya** (auto-executed duty).
 * Trigger types: cron, event, threshold, pattern. Full lifecycle management.
 */

import { matchesCronExpr, evaluateThreshold, evaluatePattern, pruneExecutionLog } from "./kartavya-cron.js";
import {
	pauseKartavya, resumeKartavya, retireKartavya,
	listActiveKartavyas, listAllKartavyas, getPendingProposals, countActiveKartavyas,
	persistEngine, restoreEngine, computeEngineStats,
} from "./kartavya-lifecycle.js";
import type { EngineStats } from "./kartavya-lifecycle.js";

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

const HARD_CEILINGS = {
	maxActive: 100,
	maxExecutionsPerHour: 60,
	minCooldownMs: 10_000,
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
	/** Minimum confidence for auto-approval. Default: 0.95. */
	minConfidenceForAutoApprove: number;
	/** Default cooldown between executions (ms). Default: 300000. */
	defaultCooldownMs: number;
	/** Maximum executions per hour. Default: 10. */
	maxExecutionsPerHour: number;
	/** Enable automatic vasana-to-kartavya promotion. Default: true. */
	enableAutoPromotion: boolean;
}

/** Context supplied to trigger evaluation. */
export interface TriggerContext {
	now: number;
	events: string[];
	metrics: Record<string, number>;
	patterns: string[];
}

/** Duck-typed database interface. */
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
	defaultCooldownMs: 300_000,
	maxExecutionsPerHour: 10,
	enableAutoPromotion: true,
};

function clampConfig(cfg: KartavyaConfig): KartavyaConfig {
	return {
		...cfg,
		maxActive: Math.min(cfg.maxActive, HARD_CEILINGS.maxActive),
		maxExecutionsPerHour: Math.min(cfg.maxExecutionsPerHour, HARD_CEILINGS.maxExecutionsPerHour),
		defaultCooldownMs: Math.max(cfg.defaultCooldownMs, HARD_CEILINGS.minCooldownMs),
	};
}

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
 */
export class KartavyaEngine {
	private readonly config: KartavyaConfig;
	private readonly kartavyas = new Map<string, Kartavya>();
	private readonly proposals = new Map<string, NiyamaProposal>();
	private readonly executionLog: number[] = [];

	constructor(config?: Partial<KartavyaConfig>) {
		this.config = clampConfig({ ...DEFAULT_CONFIG, ...config });
	}

	// ─── Promotion Pipeline ─────────────────────────────────────────────

	/**
	 * Propose a niyama from a vasana. Requires user review before activation.
	 * @throws If confidence is below minConfidenceForProposal.
	 */
	proposeNiyama(
		vasanaId: string, name: string, description: string,
		trigger: KartavyaTrigger, action: KartavyaAction,
		evidence: string[], confidence?: number,
	): NiyamaProposal {
		const conf = confidence ?? this.config.minConfidenceForProposal;
		if (conf < this.config.minConfidenceForProposal) {
			throw new Error(
				`Confidence ${conf.toFixed(3)} is below minimum threshold ${this.config.minConfidenceForProposal} for proposal`,
			);
		}

		const now = Date.now();
		const id = fnv1a(`niy:${vasanaId}:${name}:${now}`);
		const clampedTrigger: KartavyaTrigger = {
			...trigger,
			cooldownMs: Math.max(trigger.cooldownMs, HARD_CEILINGS.minCooldownMs),
		};

		const proposal: NiyamaProposal = {
			id, vasanaId, name, description,
			proposedTrigger: clampedTrigger, proposedAction: action,
			confidence: conf, evidence: [...evidence],
			status: "pending", createdAt: now,
		};

		this.proposals.set(id, proposal);
		return proposal;
	}

	/**
	 * Approve a niyama, promoting it to an active kartavya.
	 * @throws If not found, not pending, or max active limit reached.
	 */
	approveNiyama(niyamaId: string): Kartavya {
		const proposal = this.proposals.get(niyamaId);
		if (!proposal) throw new Error(`Niyama proposal '${niyamaId}' not found`);
		if (proposal.status !== "pending") throw new Error(`Niyama '${niyamaId}' is already ${proposal.status}`);

		const activeCount = countActiveKartavyas(this.kartavyas);
		if (activeCount >= this.config.maxActive) {
			throw new Error(`Cannot approve: active kartavya limit reached (${activeCount}/${this.config.maxActive})`);
		}

		proposal.status = "approved";
		const now = Date.now();
		const kartavyaId = fnv1a(`krt:${proposal.vasanaId}:${proposal.name}:${now}`);

		const kartavya: Kartavya = {
			id: kartavyaId, name: proposal.name, description: proposal.description,
			status: "active", sourceVasanaId: proposal.vasanaId, sourceNiyamaId: niyamaId,
			trigger: { ...proposal.proposedTrigger }, action: { ...proposal.proposedAction },
			confidence: proposal.confidence, successCount: 0, failureCount: 0,
			createdAt: now, updatedAt: now,
		};

		this.kartavyas.set(kartavyaId, kartavya);
		return kartavya;
	}

	/** Reject a niyama proposal. @throws If not found or not pending. */
	rejectNiyama(niyamaId: string): void {
		const proposal = this.proposals.get(niyamaId);
		if (!proposal) throw new Error(`Niyama proposal '${niyamaId}' not found`);
		if (proposal.status !== "pending") throw new Error(`Niyama '${niyamaId}' is already ${proposal.status}`);
		proposal.status = "rejected";
	}

	/** Auto-promote high-confidence vasanas to kartavyas. */
	autoPromote(vasanas: VasanaInput[]): NiyamaProposal[] {
		if (!this.config.enableAutoPromotion) return [];
		const promoted: NiyamaProposal[] = [];
		for (const v of vasanas) {
			const compositeConfidence = v.strength * v.predictiveAccuracy;
			if (compositeConfidence < this.config.minConfidenceForAutoApprove) continue;
			if (countActiveKartavyas(this.kartavyas) >= this.config.maxActive) break;
			const proposal = this.proposeNiyama(
				v.id, v.tendency, v.description,
				{ type: "pattern", condition: v.tendency, cooldownMs: this.config.defaultCooldownMs },
				{ type: "tool_sequence", payload: { tendency: v.tendency } },
				[`Auto-promoted: strength=${v.strength.toFixed(3)}, accuracy=${v.predictiveAccuracy.toFixed(3)}`],
				compositeConfidence,
			);
			this.approveNiyama(proposal.id);
			promoted.push(proposal);
		}
		return promoted;
	}

	// ─── Trigger Evaluation ─────────────────────────────────────────────

	/** Evaluate all active kartavya triggers against the current context. */
	evaluateTriggers(context: TriggerContext): Kartavya[] {
		pruneExecutionLog(this.executionLog, context.now);
		const ready: Kartavya[] = [];

		for (const k of this.kartavyas.values()) {
			if (k.status !== "active") continue;
			if (this.executionLog.length >= this.config.maxExecutionsPerHour) continue;
			if (k.trigger.lastFired && (context.now - k.trigger.lastFired) < k.trigger.cooldownMs) continue;

			let matched = false;
			switch (k.trigger.type) {
				case "cron": matched = matchesCronExpr(k.trigger.condition, new Date(context.now)); break;
				case "event": matched = context.events.includes(k.trigger.condition); break;
				case "threshold": matched = evaluateThreshold(k.trigger.condition, context.metrics); break;
				case "pattern": matched = evaluatePattern(k.trigger.condition, context.patterns); break;
			}
			if (matched) ready.push(k);
		}
		return ready;
	}

	/** Public cron matcher — delegates to extracted pure function. */
	matchesCron(cronExpr: string, now?: Date): boolean { return matchesCronExpr(cronExpr, now); }

	// ─── Execution ──────────────────────────────────────────────────────

	/** Record execution result. Updates counts, confidence, and auto-pauses on persistent failure. */
	recordExecution(kartavyaId: string, success: boolean, _result?: string): void {
		const k = this.kartavyas.get(kartavyaId);
		if (!k) throw new Error(`Kartavya '${kartavyaId}' not found`);

		const now = Date.now();
		k.lastExecuted = now;
		k.trigger.lastFired = now;
		k.updatedAt = now;

		if (success) {
			k.successCount++;
			k.confidence = Math.min(1.0, k.confidence + 0.01);
		} else {
			k.failureCount++;
			k.confidence = Math.max(0, k.confidence - 0.05);
			const totalExec = k.successCount + k.failureCount;
			if (totalExec >= 5 && k.failureCount / totalExec > 0.5) k.status = "failed";
		}
		this.executionLog.push(now);
	}

	// ─── Lifecycle (delegated) ──────────────────────────────────────────

	/** @see pauseKartavya */
	pause(kartavyaId: string): void { pauseKartavya(this.kartavyas, kartavyaId); }
	/** @see resumeKartavya */
	resume(kartavyaId: string): void { resumeKartavya(this.kartavyas, kartavyaId); }
	/** @see retireKartavya */
	retire(kartavyaId: string): void { retireKartavya(this.kartavyas, kartavyaId); }

	// ─── Queries (delegated) ────────────────────────────────────────────

	/** Get a kartavya by ID. */
	getKartavya(id: string): Kartavya | undefined { return this.kartavyas.get(id); }
	/** List active kartavyas, optionally filtered by project. */
	listActive(project?: string): Kartavya[] { return listActiveKartavyas(this.kartavyas, project); }
	/** List all kartavyas, optionally filtered by project. */
	listAll(project?: string): Kartavya[] { return listAllKartavyas(this.kartavyas, project); }
	/** Get all pending niyama proposals. */
	getPendingNiyamas(): NiyamaProposal[] { return getPendingProposals(this.proposals); }

	// ─── Persistence (delegated) ────────────────────────────────────────

	/** Persist to SQLite. @see persistEngine */
	persist(db: DatabaseLike): void { persistEngine(db, this.kartavyas, this.proposals); }
	/** Restore from SQLite. @see restoreEngine */
	restore(db: DatabaseLike): void { restoreEngine(db, this.kartavyas, this.proposals); }

	// ─── Stats (delegated) ──────────────────────────────────────────────

	/** Aggregate statistics. @see computeEngineStats */
	stats(): EngineStats { return computeEngineStats(this.kartavyas, this.proposals, this.executionLog); }
}
