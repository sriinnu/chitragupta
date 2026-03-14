/**
 * Cancellation-specific overnight loop cleanup helpers.
 *
 * I keep these helpers separate from the main round runner so cancel handling
 * stays small, testable, and easy to audit.
 */

import type {
	ResearchFinalizeResult,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import { recoverResearchFailure } from "./chitragupta-nodes-research-runner.js";
import { stopReasonFromCancelReason } from "./chitragupta-nodes-research-overnight-types.js";

const CANCELLED_CLEANUP_GRACE_MS = 7_500;

/**
 * Cancellation wins over generic closure failure when the follow-up cleanup
 * path has already been entered. I preserve the cleanup degradation in the
 * returned error payload instead of mutating the operator-facing stop reason.
 */
export function stopReasonForCancelledCleanup(
	_recoveryError: unknown,
): ReturnType<typeof stopReasonFromCancelReason> {
	return "cancelled";
}

/**
 * Detect cleanup errors that were themselves caused by cancellation or abort.
 *
 * I still keep this helper because callers may want to distinguish "cancelled
 * and degraded" from "cancelled cleanly" without rewriting the terminal stop
 * reason.
 */
export function isExplicitCancellationCleanupError(error: unknown): boolean {
	if ((error as { cancelled?: boolean } | null)?.cancelled === true) return true;
	if (!(error instanceof Error)) return false;
	const normalized = error.message.trim().toLowerCase();
	return normalized.includes("abort") || normalized.includes("cancel");
}

/**
 * Convert a cancellation cleanup result into the degraded-error payload I keep
 * on terminal loop state.
 */
export function degradedErrorForCancelledCleanup(
	stopReason: ReturnType<typeof stopReasonFromCancelReason>,
	recoveryError: unknown,
): unknown {
	return stopReason === "cancelled" ? recoveryError : null;
}

/**
 * Cancellation should still attempt bounded scope cleanup, but I do not reuse
 * the already-aborted loop signal for that work. Instead I give cleanup a
 * short grace budget so the round can restore its bounded files without
 * hanging the terminal cancel path indefinitely.
 */
export async function recoverCancelledRoundCleanup(
	scope: ResearchScope,
	failedRun: Record<string, unknown>,
): Promise<ResearchFinalizeResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("Cleanup exceeded the bounded cancellation grace budget."));
	}, CANCELLED_CLEANUP_GRACE_MS);
	try {
		return await recoverResearchFailure(scope, failedRun, controller.signal);
	} finally {
		clearTimeout(timeout);
	}
}
