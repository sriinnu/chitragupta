import {
	heartbeatResearchLoopInterrupt,
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import { researchCancellationError } from "./chitragupta-nodes-research-abort.js";
import type { ResearchCouncilSummary, ResearchScope } from "./chitragupta-nodes-research-shared.js";

/**
 * Detect cancellation-like failures from either explicit interrupt state or
 * transport/runtime errors that surface after the daemon-owned cancel request.
 */
export function isCancellationLikeError(
	error: unknown,
	interrupt: ResearchLoopInterruptHandle,
): boolean {
	if ((error as { cancelled?: boolean } | null)?.cancelled === true) return true;
	if (interrupt.isCancelled() || interrupt.signal.aborted) return true;
	if (!(error instanceof Error)) return false;
	const normalized = error.message.trim().toLowerCase();
	return normalized.includes("abort") || normalized.includes("cancel");
}

/**
 * Fail fast at stage boundaries once the loop has been cancelled.
 * Closure work is cooperative and must check this between side-effectful steps.
 */
export function assertLoopNotCancelled(interrupt: { isCancelled(): boolean; getCancelReason(): string | null }): void {
	if (interrupt.isCancelled()) {
		throw researchCancellationError(interrupt.getCancelReason());
	}
}

/**
 * Refresh daemon-owned cancellation state for the active loop and return the
 * latest cancelled bit. This keeps local abort state synchronized with daemon
 * loop control across long-running closure stages.
 */
export async function refreshCancellationState(
	interrupt: ResearchLoopInterruptHandle,
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	meta: {
		currentRound?: number | null;
		totalRounds?: number | null;
		attemptNumber?: number | null;
		phase: string;
	},
): Promise<boolean> {
	if (interrupt.isCancelled()) return true;
	const loopState = await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
		currentRound: meta.currentRound ?? undefined,
		totalRounds: meta.totalRounds ?? undefined,
		attemptNumber: meta.attemptNumber ?? undefined,
		phase: meta.phase,
	});
	return loopState.cancelled;
}
