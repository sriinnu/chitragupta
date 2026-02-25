/**
 * Skill sync helpers for DaemonManager.
 *
 * Extracted from daemon-manager.ts: provides the skill discovery scan logic
 * that periodically discovers, validates, and queues skills for approval.
 *
 * @module daemon-manager-skill-sync
 */

import type { EventEmitter } from "node:events";
import type { DaemonHealth, DaemonManagerConfig, SkillSyncEvent, SamitiBroadcaster } from "./daemon-manager-types.js";

/** Minimal interface for the manager context needed by skill sync. */
export interface SkillSyncContext {
	/** EventEmitter reference for emitting skill-sync events. */
	emitter: EventEmitter;
	/** Whether the manager is currently running. */
	isRunning(): boolean;
	/** Current health status. */
	getHealth(): DaemonHealth;
	/** Manager config. */
	config: DaemonManagerConfig;
	/** Samiti broadcaster (optional). */
	samiti: SamitiBroadcaster | null;
	/** Set the pending approval count on the manager. */
	setPendingApprovalCount(count: number): void;
}

/**
 * Run a single skill discovery scan across configured paths.
 *
 * Lazy-imports vidhya-skills and core to avoid loading at startup.
 * Validates discovered skills and submits them to the approval queue.
 * Optionally auto-approves safe (low-risk, no-error) skills.
 *
 * @param ctx - Skill sync context from the DaemonManager.
 */
export async function executeSkillScan(ctx: SkillSyncContext): Promise<void> {
	if (!ctx.isRunning() || ctx.getHealth() === "crashed") return;

	const timestamp = new Date().toISOString();

	ctx.emitter.emit("skill-sync", {
		type: "scan-start",
		detail: `Scanning ${ctx.config.skillScanPaths.length} path(s)`,
		timestamp,
	} as SkillSyncEvent);

	try {
		// Lazy-import vidhya-skills to avoid loading at startup (builds after anina)
		const { SkillDiscovery } = await import("@chitragupta/vidhya-skills");
		const { ApprovalQueue } = await import("@chitragupta/vidhya-skills");
		const { validateSkill } = await import("@chitragupta/vidhya-skills");
		const { getChitraguptaHome } = await import("@chitragupta/core");

		const home = getChitraguptaHome();
		const queue = new ApprovalQueue(`${home}/approval`);

		const discovery = new SkillDiscovery();
		let discoveredCount = 0;

		for (const scanPath of ctx.config.skillScanPaths) {
			discoveredCount += await scanSinglePath(ctx, discovery, queue, validateSkill, scanPath);
		}

		// Auto-approve safe skills
		const autoApprovedCount = autoApproveSafe(ctx, queue);

		ctx.setPendingApprovalCount(queue.pendingCount);

		ctx.emitter.emit("skill-sync", {
			type: "scan-complete",
			detail: `Discovered ${discoveredCount} new, auto-approved ${autoApprovedCount}, ${queue.pendingCount} pending`,
			timestamp: new Date().toISOString(),
		} as SkillSyncEvent);

		// Notify Samiti if there are pending approvals
		notifyPendingApprovals(ctx, queue.pendingCount, discoveredCount, autoApprovedCount);
	} catch (err) {
		ctx.emitter.emit("skill-sync", {
			type: "scan-error",
			detail: err instanceof Error ? err.message : String(err),
			timestamp: new Date().toISOString(),
		} as SkillSyncEvent);
	}
}

/** Scan a single directory path for skill manifests. Returns count of newly discovered skills. */
async function scanSinglePath<T extends { name?: unknown; version?: unknown; source?: unknown }>(
	ctx: SkillSyncContext,
	discovery: { discoverFromDirectory(path: string): Promise<T[]> },
	queue: { submit(manifest: T, sourcePath: string, meta: { validationErrors: string[]; validationWarnings: string[] }): { status: string; riskLevel: string } },
	validateSkill: (manifest: T) => { errors: Array<{ message: string }>; warnings: Array<{ message: string }> },
	scanPath: string,
): Promise<number> {
	let discoveredCount = 0;

	try {
		const manifests = await discovery.discoverFromDirectory(scanPath);

		for (const manifest of manifests) {
			// Validate
			const validation = validateSkill(manifest);
			const errors = validation.errors.map((e: { message: string }) => e.message);
			const warnings = validation.warnings.map((w: { message: string }) => w.message);

			// Submit to approval queue
			const src = manifest.source as Record<string, unknown> | undefined;
			const sourcePath = (src?.filePath as string) ?? scanPath;
			const req = queue.submit(manifest, sourcePath, {
				validationErrors: errors,
				validationWarnings: warnings,
			});

			// Only count genuinely new discoveries
			if (req.status === "pending") {
				discoveredCount++;
				ctx.emitter.emit("skill-sync", {
					type: "skill-discovered",
					detail: `${String(manifest.name)}@${String(manifest.version)} [${req.riskLevel}]`,
					timestamp: new Date().toISOString(),
				} as SkillSyncEvent);
			}
		}
	} catch (err) {
		ctx.emitter.emit("skill-sync", {
			type: "scan-error",
			detail: `${scanPath}: ${err instanceof Error ? err.message : String(err)}`,
			timestamp: new Date().toISOString(),
		} as SkillSyncEvent);
	}

	return discoveredCount;
}

/** Auto-approve safe (low-risk, no errors) skills if config allows. Returns count approved. */
function autoApproveSafe(
	ctx: SkillSyncContext,
	queue: { autoApproveSafe(): Array<{ manifest: { name: string; version: string } }>; pendingCount: number },
): number {
	if (!ctx.config.autoApproveSafe) return 0;

	const approved = queue.autoApproveSafe();
	for (const req of approved) {
		ctx.emitter.emit("skill-sync", {
			type: "skill-auto-approved",
			detail: `${req.manifest.name}@${req.manifest.version}`,
			timestamp: new Date().toISOString(),
		} as SkillSyncEvent);
	}

	return approved.length;
}

/** Broadcast pending approval count to Samiti alerts channel. */
function notifyPendingApprovals(
	ctx: SkillSyncContext,
	pendingCount: number,
	discoveredCount: number,
	autoApprovedCount: number,
): void {
	if (pendingCount <= 0 || !ctx.samiti) return;

	try {
		ctx.samiti.broadcast("#alerts", {
			sender: "daemon-manager",
			severity: "info",
			category: "skill-pending",
			content: `${pendingCount} skill(s) awaiting manual approval`,
			data: {
				pendingCount,
				newDiscovered: discoveredCount,
				autoApproved: autoApprovedCount,
			},
		});
	} catch {
		// Best-effort
	}
}
