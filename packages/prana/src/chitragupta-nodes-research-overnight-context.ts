import type { OvernightResearchRound } from "./chitragupta-nodes-research-overnight-types.js";
import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";
import { dynamicImport } from "./chitragupta-nodes.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import {
	closureBudgetExceededError,
	researchCancellationError,
	throwIfResearchAborted,
} from "./chitragupta-nodes-research-abort.js";

export async function unpackContextForReuse(text: string, signal?: AbortSignal): Promise<string> {
	throwIfResearchAborted(signal);
	const daemonResult = await withDaemonClient(async (client) => {
		throwIfResearchAborted(signal);
		try {
			return await client.call("compression.unpack_context", { text }) as Record<string, unknown>;
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
	const { unpackPackedContextText } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const result = await unpackPackedContextText(text);
	throwIfResearchAborted(signal);
	return result;
}

export async function normalizeContextForReuse(text: string, signal?: AbortSignal): Promise<string> {
	throwIfResearchAborted(signal);
	const daemonResult = await withDaemonClient(async (client) => {
		throwIfResearchAborted(signal);
		try {
			return await client.call("compression.normalize_context", { text }) as Record<string, unknown>;
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
	const { normalizePackedContextText } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const result = await normalizePackedContextText(text);
	throwIfResearchAborted(signal);
	return result;
}

export function buildCarryContext(
	scope: ResearchScope,
	round: OvernightResearchRound,
	unpacked: string,
): string {
	return [
		`topic: ${scope.topic}`,
		`loopKey: ${scope.loopKey ?? "none"}`,
		`round: ${round.roundNumber}/${scope.totalRounds ?? scope.maxRounds}`,
		`decision: ${round.decision}`,
		typeof round.observedMetric === "number" ? `observedMetric: ${round.observedMetric}` : "",
		typeof round.delta === "number" ? `delta: ${round.delta}` : "",
		round.finalizeAction ? `finalize: ${round.finalizeAction}` : "",
		round.executionRouteClass ? `executionRouteClass: ${round.executionRouteClass}` : "",
		unpacked.trim(),
	].filter(Boolean).join("\n");
}

/**
 * Run a closure-stage operation inside the remaining loop budget and cancel it
 * promptly when the parent loop is cancelled.
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
	try {
		timeoutHandle = setTimeout(() => {
			controller.abort(closureBudgetExceededError(label));
		}, remainingMs);
		return await Promise.race([
			operation(controller.signal),
			abortPromise,
		]);
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		parentSignal.removeEventListener("abort", onParentAbort);
	}
}
