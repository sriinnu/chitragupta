/**
 * @module approval-notifier
 * @description Bridge between the ApprovalQueue event system and Samiti ambient channels.
 *
 * When a skill is discovered/approved/rejected/quarantined, the notifier
 * broadcasts to Samiti's #alerts channel. Vaayu's ProactiveManager listens
 * on #alerts and delivers notifications to Santhi via Telegram/WhatsApp/iMessage.
 *
 * Flow: ApprovalQueue → ApprovalNotifier → Samiti #alerts → ProactiveManager → Push
 *
 * @packageDocumentation
 */

import type { ApprovalEvent, ApprovalRequest } from "./approval-queue.js";
import type { ApprovalQueue } from "./approval-queue.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal interface for Samiti — avoids hard dependency on @chitragupta/sutra.
 * The daemon injects the real Samiti instance at runtime.
 */
export interface SamitiBroadcaster {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
		},
	): unknown;
}

/** Configuration for the approval notifier. */
export interface ApprovalNotifierConfig {
	/** Samiti channel to broadcast to. Default: "#alerts" */
	channel?: string;
	/** Sender name in Samiti messages. Default: "skill-daemon" */
	sender?: string;
	/** Whether to include risk details in notifications. Default: true */
	includeRiskDetails?: boolean;
}

// ─── Notifier ───────────────────────────────────────────────────────────────

/**
 * Bridges ApprovalQueue events to Samiti broadcasts.
 *
 * Usage:
 * ```ts
 * const notifier = new ApprovalNotifier(samiti, { channel: "#alerts" });
 * notifier.attach(approvalQueue);
 * // Now all approval events are broadcast to Samiti
 * ```
 */
export class ApprovalNotifier {
	private samiti: SamitiBroadcaster;
	private channel: string;
	private sender: string;
	private includeRiskDetails: boolean;
	private unsubscribers: Array<() => void> = [];

	constructor(samiti: SamitiBroadcaster, config?: ApprovalNotifierConfig) {
		this.samiti = samiti;
		this.channel = config?.channel ?? "#alerts";
		this.sender = config?.sender ?? "skill-daemon";
		this.includeRiskDetails = config?.includeRiskDetails !== false;
	}

	/**
	 * Attach to an ApprovalQueue to receive and broadcast events.
	 * Returns an unsubscribe function.
	 */
	attach(queue: ApprovalQueue): () => void {
		const unsub = queue.onEvent((event) => this.handleEvent(event));
		this.unsubscribers.push(unsub);
		return unsub;
	}

	/**
	 * Detach all listeners.
	 */
	detachAll(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
	}

	/**
	 * Handle an approval event and broadcast to Samiti.
	 */
	private handleEvent(event: ApprovalEvent): void {
		try {
			const { message, severity, category } = this.formatEvent(event);

			this.samiti.broadcast(this.channel, {
				sender: this.sender,
				severity,
				category,
				content: message,
				data: {
					requestId: event.request.id,
					skillName: event.request.manifest.name,
					skillVersion: event.request.manifest.version,
					status: event.request.status,
					riskLevel: event.request.riskLevel,
					sourcePath: event.request.sourcePath,
					timestamp: event.timestamp,
				},
			});
		} catch {
			// Best-effort: notification failure should never break the approval flow
		}
	}

	/**
	 * Format an approval event into a human-readable message.
	 */
	private formatEvent(event: ApprovalEvent): {
		message: string;
		severity: "info" | "warning" | "critical";
		category: string;
	} {
		const req = event.request;
		const name = req.manifest.name;
		const version = req.manifest.version;
		const risk = req.riskLevel;

		switch (event.type) {
			case "skill-discovered": {
				const riskEmoji = risk === "critical" ? "!!" : risk === "high" ? "!" : "";
				const riskDetails = this.includeRiskDetails && req.riskFactors.length > 0
					? `\nRisk factors: ${req.riskFactors.join("; ")}`
					: "";
				const validationNote = req.validationErrors.length > 0
					? `\nValidation errors: ${req.validationErrors.length}`
					: "";

				return {
					message: `New skill discovered: ${name}@${version} [${risk}${riskEmoji}]` +
						`\nSource: ${req.sourcePath}` +
						riskDetails +
						validationNote +
						`\nAwaiting manual approval.`,
					severity: risk === "critical" || risk === "high" ? "warning" : "info",
					category: "skill-discovery",
				};
			}

			case "skill-approved":
				return {
					message: `Skill approved: ${name}@${version}` +
						`\nApproved by: ${req.approver}` +
						`\nReason: ${req.reason}` +
						(req.sealHash ? `\nSeal: ${req.sealHash}` : ""),
					severity: "info",
					category: "skill-approved",
				};

			case "skill-rejected":
				return {
					message: `Skill rejected: ${name}@${version}` +
						`\nRejected by: ${req.approver}` +
						`\nReason: ${req.reason}`,
					severity: "info",
					category: "skill-rejected",
				};

			case "skill-quarantined":
				return {
					message: `Skill quarantined: ${name}@${version} [SECURITY]` +
						`\nQuarantined by: ${req.approver}` +
						`\nReason: ${req.reason}` +
						(this.includeRiskDetails ? `\nRisk: ${risk} — ${req.riskFactors.join("; ")}` : ""),
					severity: "critical",
					category: "skill-quarantined",
				};
		}
	}

	/**
	 * Manually broadcast a summary of all pending approvals.
	 * Useful for periodic "you have N skills pending" reminders.
	 */
	broadcastPendingSummary(queue: ApprovalQueue): void {
		const pending = queue.getPending();
		if (pending.length === 0) return;

		const byRisk = {
			critical: pending.filter(r => r.riskLevel === "critical"),
			high: pending.filter(r => r.riskLevel === "high"),
			medium: pending.filter(r => r.riskLevel === "medium"),
			low: pending.filter(r => r.riskLevel === "low"),
		};

		const lines = [`${pending.length} skill(s) awaiting approval:`];
		if (byRisk.critical.length > 0) lines.push(`  !! ${byRisk.critical.length} critical risk`);
		if (byRisk.high.length > 0) lines.push(`  !  ${byRisk.high.length} high risk`);
		if (byRisk.medium.length > 0) lines.push(`     ${byRisk.medium.length} medium risk`);
		if (byRisk.low.length > 0) lines.push(`     ${byRisk.low.length} low risk`);
		lines.push("");
		for (const req of pending.slice(0, 5)) {
			lines.push(`  - ${req.manifest.name}@${req.manifest.version} [${req.riskLevel}]`);
		}
		if (pending.length > 5) {
			lines.push(`  ... and ${pending.length - 5} more`);
		}

		try {
			this.samiti.broadcast(this.channel, {
				sender: this.sender,
				severity: byRisk.critical.length > 0 ? "warning" : "info",
				category: "skill-pending-summary",
				content: lines.join("\n"),
				data: {
					pendingCount: pending.length,
					byRisk: {
						critical: byRisk.critical.length,
						high: byRisk.high.length,
						medium: byRisk.medium.length,
						low: byRisk.low.length,
					},
				},
			});
		} catch {
			// Best-effort
		}
	}
}
