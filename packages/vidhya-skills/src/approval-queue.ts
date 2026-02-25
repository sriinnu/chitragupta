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
import {
	assessRisk,
	type ApprovalRequest,
	type ApprovalLedgerEntry,
	type ApprovalEventHandler,
	type ApprovalEvent,
	type ApprovalStatus,
} from "./approval-queue-types.js";

// Re-export types and assessRisk for backward compatibility
export {
	assessRisk,
	type ApprovalStatus,
	type RiskLevel,
	type ApprovalRequest,
	type ApprovalLedgerEntry,
	type ApprovalEventHandler,
	type ApprovalEvent,
} from "./approval-queue-types.js";

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
