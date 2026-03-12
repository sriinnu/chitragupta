/**
 * Packing and persistence helpers for research workflows.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import { throwIfResearchAborted } from "./chitragupta-nodes-research-abort.js";
import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";
import {
	buildResearchExperimentRecord,
	buildResearchRecord,
} from "./chitragupta-nodes-research-records.js";
import { councilLucyRecommendation, withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import {
	buildResearchOutcomePayload,
	buildResearchTraceMetadata,
	persistResearchFallback,
	normalizeStringList,
} from "./chitragupta-nodes-research-recording-helpers.js";

const DAEMON_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES", "EPIPE", "ECONNRESET"]);

function shouldFallbackToLocalResearchRecording(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && DAEMON_UNAVAILABLE_CODES.has(code)) return true;
	if (!(error instanceof Error)) return false;
	return /daemon unavailable|connect econnrefused|enoent|eacces|epipe|econnreset|socket hang up|socket closed/i.test(
		error.message.toLowerCase(),
	);
}

/**
 * Pack the high-signal research round context so later rounds can reuse it without carrying full raw logs.
 */
export async function packResearchContext(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation?: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	throwIfResearchAborted(signal);
	const route = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as {
			routeClass?: unknown;
			capability?: unknown;
			selectedCapabilityId?: unknown;
		}
		: null;
	const text = [
		`topic: ${scope.topic}`,
		`hypothesis: ${scope.hypothesis}`,
		`session id: ${typeof council.sessionId === "string" ? council.sessionId : "none"}`,
		`council verdict: ${String(council.finalVerdict ?? "unknown")}`,
		`lucy recommendation: ${councilLucyRecommendation(council)}`,
		`route class: ${typeof route?.routeClass === "string" ? route.routeClass : "none"}`,
		`route capability: ${typeof route?.capability === "string" ? route.capability : "none"}`,
		`route selected capability: ${typeof route?.selectedCapabilityId === "string" ? route.selectedCapabilityId : "none"}`,
		`metric: ${scope.metricName} (${scope.objective})`,
		`target files: ${scope.targetFiles.join(", ")}`,
		`immutable files: ${scope.immutableFiles.join(", ")}`,
		typeof evaluation?.baselineMetric === "number" ? `baseline: ${evaluation.baselineMetric}` : "",
		typeof evaluation?.observedMetric === "number" ? `observed: ${evaluation.observedMetric}` : "",
		typeof evaluation?.delta === "number" ? `delta: ${evaluation.delta}` : "",
		typeof evaluation?.decision === "string" ? `decision: ${evaluation.decision}` : "",
		`stdout:\n${String(run.stdout ?? "").slice(0, 8_000)}`,
		`stderr:\n${String(run.stderr ?? "").slice(0, 4_000)}`,
	].filter(Boolean).join("\n\n").trim();
	if (!text) {
		return { packed: false, runtime: null, savings: 0, sourceLength: 0, source: "none" };
	}
	const daemonPacked = await withDaemonClient(async (client) => {
		throwIfResearchAborted(signal);
		try {
			return await client.call("compression.pack_context", { text }) as Record<string, unknown>;
		} catch {
			return null;
		}
	});
	throwIfResearchAborted(signal);
	if (daemonPacked) {
		const packedText = typeof daemonPacked.packedText === "string" ? daemonPacked.packedText : null;
		return {
			...daemonPacked,
			packed: daemonPacked.packed === false ? false : packedText !== null,
			packedText: packedText ?? undefined,
			sourceLength: text.length,
			source: "daemon",
		};
	}
	const { packLiveContextText } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const localPacked = await packLiveContextText(text);
	throwIfResearchAborted(signal);
	if (!localPacked) {
		return { packed: false, runtime: null, savings: 0, sourceLength: text.length, source: "fallback" };
	}
	return {
		packed: true,
		runtime: localPacked.runtime,
		savings: localPacked.savings,
		sourceLength: text.length,
		packedText: localPacked.packedText,
		source: "fallback",
	};
}

export async function recordResearchOutcome(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	packed: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	throwIfResearchAborted(signal);
	const experimentRecord = buildResearchExperimentRecord(scope, council, run, evaluation, finalize, packed);
	const entry = buildResearchRecord(scope, council, run, evaluation, finalize, packed);
	const traceMetadata = buildResearchTraceMetadata({
		scope,
		council,
		packed,
		finalize,
		extras: {
			decision: evaluation.decision ?? "record",
		},
	});
	let daemonRecorded: Record<string, unknown> | null = null;
	try {
		daemonRecorded = await withDaemonClient(async (client) => {
			throwIfResearchAborted(signal);
			const outcome = await client.call("research.outcome.record", buildResearchOutcomePayload({
				scope,
				council,
				experimentRecord,
				entry,
				packed,
				traceContent: `${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
				traceMetadata,
			})) as { traceId: string; experimentId: string };
			return {
				...(typeof outcome === "object" && outcome !== null ? outcome : {}),
				recorded: true,
				decision: evaluation.decision ?? "record",
				finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
				experimentRecord,
				source: "daemon",
			};
		});
	} catch (error) {
		if (!shouldFallbackToLocalResearchRecording(error)) throw error;
		daemonRecorded = null;
	}
	throwIfResearchAborted(signal);
	if (daemonRecorded) return daemonRecorded;
	return persistResearchFallback({
		scope,
		entry,
		experimentRecord,
		traceType: evaluation.decision === "keep" ? "pattern" : "correction",
		traceContent: `${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
		traceMetadata,
		packed,
		decision: typeof evaluation.decision === "string" ? evaluation.decision : "record",
		finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
	});
}

/** Record a failed round without promoting it as a successful experiment. */
export async function recordResearchFailure(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	packed: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	throwIfResearchAborted(signal);
	const evaluation = {
		metricName: scope.metricName,
		objective: scope.objective,
		baselineMetric: null,
		observedMetric: typeof run.metric === "number" ? run.metric : null,
		delta: null,
		improved: false,
		decision: "record",
		status: "failed",
		errorMessage:
			typeof run.errorMessage === "string" && run.errorMessage.trim()
				? run.errorMessage.trim()
				: "Research round failed.",
	};
	const experimentRecord = buildResearchExperimentRecord(scope, council, run, evaluation, finalize, packed);
	const entry = buildResearchRecord(scope, council, run, evaluation, finalize, packed);
	const traceMetadata = buildResearchTraceMetadata({
		scope,
		council,
		packed,
		finalize,
		extras: {
			decision: "record",
			status: "failed",
			errorMessage: experimentRecord.errorMessage,
		},
	});
	let daemonRecorded: Record<string, unknown> | null = null;
	try {
		daemonRecorded = await withDaemonClient(async (client) => {
			throwIfResearchAborted(signal);
			const outcome = await client.call("research.outcome.record", buildResearchOutcomePayload({
				scope,
				council,
				experimentRecord,
				entry,
				packed,
				traceContent: `${scope.hypothesis}\nDecision: record\nError: ${experimentRecord.errorMessage ?? "unknown failure"}`,
				traceMetadata,
			})) as { traceId: string; experimentId: string };
			return {
				...(typeof outcome === "object" && outcome !== null ? outcome : {}),
				recorded: true,
				decision: "record",
				finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
				experimentRecord,
				source: "daemon",
			};
		});
	} catch (error) {
		if (!shouldFallbackToLocalResearchRecording(error)) throw error;
		daemonRecorded = null;
	}
	throwIfResearchAborted(signal);
	if (daemonRecorded) return daemonRecorded;
	return persistResearchFallback({
		scope,
		entry,
		experimentRecord,
		traceType: "correction",
		traceContent: `${scope.hypothesis}\nDecision: record\nError: ${experimentRecord.errorMessage ?? "unknown failure"}`,
		traceMetadata,
		packed,
	});
}
