import type { OvernightResearchRound } from "./chitragupta-nodes-research-overnight-types.js";
import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";
import { dynamicImport } from "./chitragupta-nodes.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import { buildDefaultResearchUpdateBudgets } from "./chitragupta-nodes-research-shared-defaults.js";
import {
	closureBudgetExceededError,
	researchCancellationError,
	throwIfResearchAborted,
} from "./chitragupta-nodes-research-abort.js";

type ResearchClosureFallbackPolicy = "allow-local" | "daemon-only";
const CLOSURE_ABORT_SETTLE_GRACE_MS = 1_500;

function daemonOnlyCompressionError(label: string): Error {
	return new Error(`${label} requires the daemon-owned compression path`);
}

/** Unpack packed carry-context back into reusable plain text for the next round. */
export async function unpackContextForReuse(text: string, signal?: AbortSignal): Promise<string> {
	return unpackContextForReuseWithPolicy(text, signal, "allow-local");
}

/**
 * Unpack carry-context with an explicit daemon/local fallback policy.
 *
 * I keep this separate from the convenience wrapper so resume and closure
 * paths can force the daemon-owned compression lane when local fallback would
 * create a second source of truth.
 */
export async function unpackContextForReuseWithPolicy(
	text: string,
	signal: AbortSignal | undefined,
	fallbackPolicy: ResearchClosureFallbackPolicy,
): Promise<string> {
	throwIfResearchAborted(signal);
	const daemonResult = await withDaemonClient(async (client) => {
		throwIfResearchAborted(signal);
		try {
			return await client.call("compression.unpack_context", { text }, { signal }) as Record<string, unknown>;
		} catch {
			return null;
		}
	});
	throwIfResearchAborted(signal);
	const unpacked =
		daemonResult && typeof daemonResult.text === "string" && daemonResult.text.trim()
			? daemonResult.text.trim()
			: daemonResult && typeof daemonResult.result === "string" && daemonResult.result.trim()
				? daemonResult.result.trim()
				: null;
	if (unpacked) return unpacked;
	if (fallbackPolicy === "daemon-only") {
		throw daemonOnlyCompressionError("overnight context unpack");
	}
	const { unpackPackedContextText } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const result = await unpackPackedContextText(text);
	throwIfResearchAborted(signal);
	return result;
}

/** Normalize carry-context so later rounds do not keep nesting equivalent packed payloads. */
export async function normalizeContextForReuse(text: string, signal?: AbortSignal): Promise<string> {
	return normalizeContextForReuseWithPolicy(text, signal, "allow-local");
}

/**
 * Normalize carry-context with an explicit daemon/local fallback policy.
 *
 * I use the daemon-only mode in durable overnight paths so normalization stays
 * aligned with the same compression policy that produced the packed payload.
 */
export async function normalizeContextForReuseWithPolicy(
	text: string,
	signal: AbortSignal | undefined,
	fallbackPolicy: ResearchClosureFallbackPolicy,
): Promise<string> {
	throwIfResearchAborted(signal);
	const daemonResult = await withDaemonClient(async (client) => {
		throwIfResearchAborted(signal);
		try {
			return await client.call("compression.normalize_context", { text }, { signal }) as Record<string, unknown>;
		} catch {
			return null;
		}
	});
	throwIfResearchAborted(signal);
	const normalized =
		daemonResult && typeof daemonResult.text === "string" && daemonResult.text.trim()
			? daemonResult.text.trim()
			: daemonResult && typeof daemonResult.result === "string" && daemonResult.result.trim()
				? daemonResult.result.trim()
				: null;
	if (normalized) return normalized;
	if (fallbackPolicy === "daemon-only") {
		throw daemonOnlyCompressionError("overnight context normalize");
	}
	const { normalizePackedContextText } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const result = await normalizePackedContextText(text);
	throwIfResearchAborted(signal);
	return result;
}

/**
 * Build the next-round carry-context in a deterministic order so the packed
 * reuse path remains stable across retries and resume.
 */
export function buildCarryContext(
	scope: ResearchScope,
	round: OvernightResearchRound,
	unpacked: string,
): string {
	const packingBudget =
		scope.updateBudgets?.packing
		?? buildDefaultResearchUpdateBudgets().packing;
	const retrievalBudget =
		scope.updateBudgets?.retrieval
		?? buildDefaultResearchUpdateBudgets().retrieval;
	const reusedBody = unpacked.trim().slice(0, retrievalBudget.maxReuseChars);
	const combined = [
		`topic: ${scope.topic}`,
		`loopKey: ${scope.loopKey ?? "none"}`,
		`round: ${round.roundNumber}/${scope.totalRounds ?? scope.maxRounds}`,
		`decision: ${round.decision}`,
		typeof round.observedMetric === "number" ? `observedMetric: ${round.observedMetric}` : "",
		typeof round.delta === "number" ? `delta: ${round.delta}` : "",
		round.finalizeAction ? `finalize: ${round.finalizeAction}` : "",
		round.executionRouteClass ? `executionRouteClass: ${round.executionRouteClass}` : "",
		// I keep the reused body last so the loop header remains stable and easy
		// to strip/replace during later normalization passes. Retrieval, not
		// packing, decides how much history is worth carrying into the next round.
		reusedBody,
	].filter(Boolean).join("\n");
	// I cap the carry context after composition so later rounds inherit a stable
	// envelope even when one round emits unusually large packed output.
	return combined.slice(0, packingBudget.maxCarryContextChars);
}

/**
 * Run a closure-stage operation inside the remaining loop budget.
 *
 * If the loop is cancelled or the budget expires, this waits for the
 * underlying closure operation to settle before returning. That avoids
 * background side effects continuing after the loop has already surfaced a
 * timeout/cancel and prevents a resumed loop from racing the tail of the
 * previous closure attempt. The wait is bounded so a misbehaving transport
 * cannot deadlock final loop completion forever.
 */
export async function withinRemainingLoopBudget<T>(
	scope: ResearchScope,
	totalDurationMs: number,
	roundStartedAt: number,
	label: string,
	parentSignal: AbortSignal,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const remainingMs = scope.totalBudgetMs - (totalDurationMs + (Date.now() - roundStartedAt));
	if (remainingMs <= 0) {
		throw new Error(`${label} exceeded the overnight loop budget before starting`);
	}
	const controller = new AbortController();
	let timeoutHandle: NodeJS.Timeout | null = null;
	const onParentAbort = () => {
		controller.abort(parentSignal.reason ?? researchCancellationError());
	};
	if (parentSignal.aborted) {
		onParentAbort();
	} else {
		parentSignal.addEventListener("abort", onParentAbort, { once: true });
	}
	const abortPromise = new Promise<never>((_, reject) => {
		controller.signal.addEventListener("abort", () => {
			const reason = controller.signal.reason;
			if (reason instanceof Error) {
				reject(reason);
				return;
			}
			reject(researchCancellationError(typeof reason === "string" ? reason : null));
		}, { once: true });
	});
	let operationSettled = false;
	const operationPromise = Promise.resolve()
		.then(() => operation(controller.signal))
		.finally(() => {
			operationSettled = true;
		});
	try {
		timeoutHandle = setTimeout(() => {
			controller.abort(closureBudgetExceededError(label));
		}, remainingMs);
		return await Promise.race([operationPromise, abortPromise]);
		} catch (error) {
			if (controller.signal.aborted && !operationSettled) {
				// Time out or cancellation cannot guarantee the underlying transport
				// stopped immediately. Wait briefly for it to settle so a resumed loop
				// does not race stale closure side effects.
				await Promise.race([
				operationPromise.catch(() => undefined),
				new Promise<void>((resolve) => setTimeout(resolve, CLOSURE_ABORT_SETTLE_GRACE_MS)),
			]);
		}
		throw error;
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		parentSignal.removeEventListener("abort", onParentAbort);
	}
}
