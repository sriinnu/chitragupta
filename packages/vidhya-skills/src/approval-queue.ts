/**
 * @module approval-queue
 * @description Skill approval workflow — queue, ledger, and gating.
 *
 * When the daemon discovers new skills, they enter a pending approval queue
 * instead of being auto-registered. Santhi gets notified (via Samiti #alerts)
 * and can approve/reject. Approved skills are timestamped, fingerprinted
 * (via Mudra), and pushed to the registry.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillManifest } from "./types.js";
import type { EnhancedSkillManifest } from "./types-v2.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Approval status for a discovered skill. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "quarantined";

/** Risk level computed from permissions and capabilities. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** A skill awaiting approval. */
export interface ApprovalRequest {
	/** Unique request ID. */
	readonly id: string;
	/** The discovered skill manifest. */
	readonly manifest: SkillManifest | EnhancedSkillManifest;
	/** Source file path where the skill was found. */
	readonly sourcePath: string;
	/** Current approval status. */
	status: ApprovalStatus;
	/** Computed risk level based on permissions analysis. */
	readonly riskLevel: RiskLevel;
	/** Risk assessment details. */
	readonly riskFactors: string[];
	/** Validation errors (from validator). */
	readonly validationErrors: string[];
	/** Validation warnings (from validator). */
	readonly validationWarnings: string[];
	/** Quarantine ID if submitted to sandbox. */
	readonly quarantineId?: string;
	/** When the skill was discovered. */
	readonly discoveredAt: string;
	/** When the status was last updated. */
	updatedAt: string;
	/** Who approved/rejected (e.g., "santhi", "auto"). */
	approver?: string;
	/** Reason for approval/rejection. */
	reason?: string;
	/** Mudra seal hash after approval. */
	sealHash?: string;
}

/** A ledger entry recording an approval decision. */
export interface ApprovalLedgerEntry {
	/** Request ID. */
	readonly requestId: string;
	/** Skill name. */
	readonly skillName: string;
	/** Skill version. */
	readonly skillVersion: string;
	/** Decision made. */
	readonly decision: "approved" | "rejected" | "quarantined";
	/** Who made the decision. */
	readonly approver: string;
	/** Reason for the decision. */
	readonly reason: string;
	/** Risk level at time of decision. */
	readonly riskLevel: RiskLevel;
	/** Risk factors at time of decision. */
	readonly riskFactors: string[];
	/** Timestamp of the decision. */
	readonly timestamp: string;
	/** Mudra seal hash (only for approved). */
	readonly sealHash?: string;
	/** Source path. */
	readonly sourcePath: string;
}

/** Callback for approval events (used by notification bridge). */
export type ApprovalEventHandler = (event: ApprovalEvent) => void;

/** Events emitted by the approval queue. */
export interface ApprovalEvent {
	readonly type: "skill-discovered" | "skill-approved" | "skill-rejected" | "skill-quarantined";
	readonly request: ApprovalRequest;
	readonly timestamp: string;
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

/**
 * Assess risk level of a skill based on its permissions and capabilities.
 */
export function assessRisk(manifest: SkillManifest | EnhancedSkillManifest): { level: RiskLevel; factors: string[] } {
	const factors: string[] = [];
	const enhanced = manifest as EnhancedSkillManifest;

	// Check network access
	if (enhanced.requirements?.network) {
		factors.push("Requires network access");
	}

	// Check privilege escalation
	if (enhanced.requirements?.privilege) {
		factors.push("Requires elevated privileges");
	}

	// Check granular permissions
	if (enhanced.permissions) {
		const perms = enhanced.permissions;

		// Network policy
		if (perms.networkPolicy) {
			if (!perms.networkPolicy.allowlist || perms.networkPolicy.allowlist.length === 0) {
				factors.push("Network access with no allowlist (unrestricted)");
			}
			if (perms.networkPolicy.denylist && perms.networkPolicy.denylist.length === 0) {
				factors.push("Empty denylist (no blocked domains)");
			}
		}

		// Secrets access
		if (perms.secrets && perms.secrets.length > 0) {
			factors.push(`Accesses ${perms.secrets.length} secret(s): ${perms.secrets.join(", ")}`);
		}

		// User data access
		if (perms.userData) {
			const scopes: string[] = [];
			if (perms.userData.location) scopes.push("location");
			if (perms.userData.memory) scopes.push("memory");
			if (perms.userData.calendar) scopes.push("calendar");
			if (perms.userData.email) scopes.push("email");
			if (scopes.length > 0) {
				factors.push(`Accesses user data: ${scopes.join(", ")}`);
			}
		}

		// Filesystem access — check as string since community skills may use non-standard values
		if (perms.filesystem) {
			const scope = perms.filesystem.scope as string;
			if (scope === "full") {
				factors.push("Full filesystem access");
			} else if (scope === "project") {
				factors.push("Project-scoped filesystem access");
			}
		}

		// PII policy — check as string since community skills may use non-standard values
		if (perms.piiPolicy) {
			const policy = perms.piiPolicy as string;
			if (policy === "collect" || policy === "store") {
				factors.push(`PII policy: ${policy}`);
			}
		}
	}

	// Check capabilities for dangerous verbs
	for (const cap of manifest.capabilities) {
		const verb = cap.verb.toLowerCase();
		if (["execute", "delete", "install", "deploy", "send", "transfer"].includes(verb)) {
			factors.push(`Dangerous capability verb: ${verb}/${cap.object}`);
		}
	}

	// Determine level
	let level: RiskLevel = "low";
	if (factors.length >= 4) level = "critical";
	else if (factors.length >= 2) level = "high";
	else if (factors.length >= 1) level = "medium";

	// Escalate based on specific factors
	if (factors.some(f => f.includes("elevated privileges") || f.includes("Full filesystem") || f.includes("unrestricted"))) {
		if (level === "low") level = "medium";
		if (level === "medium") level = "high";
	}

	return { level, factors };
}

// ─── Approval Queue ─────────────────────────────────────────────────────────

/**
 * Persistent approval queue for discovered skills.
 *
 * Skills enter the queue when discovered by the daemon. They stay pending
 * until explicitly approved or rejected. The queue persists to disk
 * so state survives restarts.
 */
export class ApprovalQueue {
	private queue = new Map<string, ApprovalRequest>();
	private ledger: ApprovalLedgerEntry[] = [];
	private handlers: ApprovalEventHandler[] = [];
	private persistPath: string;
	private counter = 0;

	constructor(persistDir: string) {
		this.persistPath = persistDir;
		this.load();
	}

	/**
	 * Subscribe to approval events.
	 * Returns an unsubscribe function.
	 */
	onEvent(handler: ApprovalEventHandler): () => void {
		this.handlers.push(handler);
		return () => {
			const idx = this.handlers.indexOf(handler);
			if (idx >= 0) this.handlers.splice(idx, 1);
		};
	}

	/**
	 * Submit a newly discovered skill for approval.
	 * Returns the approval request with computed risk assessment.
	 */
	submit(
		manifest: SkillManifest | EnhancedSkillManifest,
		sourcePath: string,
		opts?: {
			validationErrors?: string[];
			validationWarnings?: string[];
			quarantineId?: string;
		},
	): ApprovalRequest {
		// Check if already in queue (by name + version)
		for (const req of this.queue.values()) {
			if (req.manifest.name === manifest.name && req.manifest.version === manifest.version) {
				return req; // Already queued, return existing
			}
		}

		const { level, factors } = assessRisk(manifest);
		const now = new Date().toISOString();

		const request: ApprovalRequest = {
			id: `approval-${Date.now()}-${++this.counter}`,
			manifest,
			sourcePath,
			status: "pending",
			riskLevel: level,
			riskFactors: factors,
			validationErrors: opts?.validationErrors ?? [],
			validationWarnings: opts?.validationWarnings ?? [],
			quarantineId: opts?.quarantineId,
			discoveredAt: now,
			updatedAt: now,
		};

		this.queue.set(request.id, request);
		this.persist();
		this.emit({ type: "skill-discovered", request, timestamp: now });

		return request;
	}

	/**
	 * Approve a pending skill.
	 */
	approve(requestId: string, approver: string, reason: string, sealHash?: string): ApprovalRequest | null {
		const request = this.queue.get(requestId);
		if (!request || request.status !== "pending") return null;

		const now = new Date().toISOString();
		request.status = "approved";
		request.approver = approver;
		request.reason = reason;
		request.sealHash = sealHash;
		request.updatedAt = now;

		// Add to ledger
		this.ledger.push({
			requestId: request.id,
			skillName: request.manifest.name,
			skillVersion: request.manifest.version,
			decision: "approved",
			approver,
			reason,
			riskLevel: request.riskLevel,
			riskFactors: request.riskFactors,
			timestamp: now,
			sealHash,
			sourcePath: request.sourcePath,
		});

		this.persist();
		this.emit({ type: "skill-approved", request, timestamp: now });

		return request;
	}

	/**
	 * Reject a pending skill.
	 */
	reject(requestId: string, approver: string, reason: string): ApprovalRequest | null {
		const request = this.queue.get(requestId);
		if (!request || request.status !== "pending") return null;

		const now = new Date().toISOString();
		request.status = "rejected";
		request.approver = approver;
		request.reason = reason;
		request.updatedAt = now;

		this.ledger.push({
			requestId: request.id,
			skillName: request.manifest.name,
			skillVersion: request.manifest.version,
			decision: "rejected",
			approver,
			reason,
			riskLevel: request.riskLevel,
			riskFactors: request.riskFactors,
			timestamp: now,
			sourcePath: request.sourcePath,
		});

		this.persist();
		this.emit({ type: "skill-rejected", request, timestamp: now });

		return request;
	}

	/**
	 * Quarantine a skill (security concern).
	 */
	quarantine(requestId: string, approver: string, reason: string): ApprovalRequest | null {
		const request = this.queue.get(requestId);
		if (!request) return null;

		const now = new Date().toISOString();
		request.status = "quarantined";
		request.approver = approver;
		request.reason = reason;
		request.updatedAt = now;

		this.ledger.push({
			requestId: request.id,
			skillName: request.manifest.name,
			skillVersion: request.manifest.version,
			decision: "quarantined",
			approver,
			reason,
			riskLevel: request.riskLevel,
			riskFactors: request.riskFactors,
			timestamp: now,
			sourcePath: request.sourcePath,
		});

		this.persist();
		this.emit({ type: "skill-quarantined", request, timestamp: now });

		return request;
	}

	/** Get all pending requests. */
	getPending(): ApprovalRequest[] {
		return [...this.queue.values()].filter(r => r.status === "pending");
	}

	/** Get all requests by status. */
	getByStatus(status: ApprovalStatus): ApprovalRequest[] {
		return [...this.queue.values()].filter(r => r.status === status);
	}

	/** Get a specific request by ID. */
	get(requestId: string): ApprovalRequest | undefined {
		return this.queue.get(requestId);
	}

	/** Get the full approval ledger (all decisions ever made). */
	getLedger(): readonly ApprovalLedgerEntry[] {
		return this.ledger;
	}

	/** Get ledger entries for a specific skill. */
	getLedgerForSkill(skillName: string): ApprovalLedgerEntry[] {
		return this.ledger.filter(e => e.skillName === skillName);
	}

	/** Total queue size. */
	get size(): number {
		return this.queue.size;
	}

	/** Number of pending approvals. */
	get pendingCount(): number {
		return this.getPending().length;
	}

	// ─── Auto-Approval ────────────────────────────────────────────────────

	/**
	 * Auto-approve low-risk skills that pass validation.
	 * Returns the list of auto-approved requests.
	 */
	autoApproveSafe(): ApprovalRequest[] {
		const approved: ApprovalRequest[] = [];
		for (const req of this.getPending()) {
			if (
				req.riskLevel === "low" &&
				req.validationErrors.length === 0
			) {
				const result = this.approve(req.id, "auto", "Low risk, no validation errors");
				if (result) approved.push(result);
			}
		}
		return approved;
	}

	// ─── Persistence ──────────────────────────────────────────────────────

	private persist(): void {
		try {
			fs.mkdirSync(this.persistPath, { recursive: true });

			const queuePath = path.join(this.persistPath, "approval-queue.json");
			const queueData = [...this.queue.values()];
			fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));

			const ledgerPath = path.join(this.persistPath, "approval-ledger.json");
			fs.writeFileSync(ledgerPath, JSON.stringify(this.ledger, null, 2));
		} catch {
			// Best-effort persistence
		}
	}

	private load(): void {
		try {
			const queuePath = path.join(this.persistPath, "approval-queue.json");
			if (fs.existsSync(queuePath)) {
				const data = JSON.parse(fs.readFileSync(queuePath, "utf-8")) as ApprovalRequest[];
				for (const req of data) {
					this.queue.set(req.id, req);
				}
			}

			const ledgerPath = path.join(this.persistPath, "approval-ledger.json");
			if (fs.existsSync(ledgerPath)) {
				this.ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as ApprovalLedgerEntry[];
			}
		} catch {
			// Start fresh on load failure
		}
	}

	private emit(event: ApprovalEvent): void {
		for (const handler of this.handlers) {
			try {
				handler(event);
			} catch {
				// Don't let handler errors break the queue
			}
		}
	}
}
