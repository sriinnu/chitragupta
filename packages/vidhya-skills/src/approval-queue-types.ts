/**
 * Approval queue types and risk assessment logic.
 *
 * Extracted from approval-queue.ts for maintainability.
 *
 * @module approval-queue-types
 */

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
