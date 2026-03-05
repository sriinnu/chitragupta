/**
 * Scarlett Signal Bridge — Wire 1 of the nervous system.
 *
 * Converts InternalScarlett ProbeResults into RegressionAlert signals
 * and injects them into the TranscendenceEngine's regression pipeline.
 *
 * This closes the loop: InternalScarlett monitors → signal bridge converts
 * → Transcendence ingests → predictions penalise degraded subsystems.
 *
 * Duck-typed interfaces keep daemon free of smriti import dependency.
 *
 * @module scarlett-signal-bridge
 */

import { createLogger } from "@chitragupta/core";
import type { ProbeResult, ProbeSeverity } from "./scarlett-internal.js";

const log = createLogger("daemon:scarlett-signal-bridge");

// ─── Duck Types ───────────────────────────────────────────────────────────────

/** Minimal RegressionAlert shape (mirrors smriti RegressionAlert). */
export interface RegressionAlertLike {
	errorSignature: string;
	description: string;
	currentOccurrences: number;
	previousOccurrences: number;
	severity: "info" | "warning" | "critical";
	lastSeenBefore: string;
	detectedAt: string;
}

/** Duck-typed TranscendenceEngine — only the methods the bridge needs. */
export interface TranscendenceEngineRef {
	/** Ingest regression alerts to boost attention for degraded entities. */
	ingestRegressions(alerts: RegressionAlertLike[]): void;
}

// ─── Probe → Entity Mapping ───────────────────────────────────────────────────

/**
 * Maps InternalScarlett probe names to searchable entity names.
 * These become the `errorSignature` in the RegressionAlert, which
 * Transcendence uses as an entity to boost prediction confidence for.
 */
const PROBE_TO_ENTITY: Readonly<Record<string, string>> = {
	"smriti-db": "smriti",
	"nidra-heartbeat": "nidra",
	"consolidation-queue": "consolidation",
	"memory-pressure": "memory",
};

/**
 * Maps ProbeSeverity to RegressionAlert severity.
 * "ok" probes are never injected — only warn and critical.
 */
const SEVERITY_MAP: Readonly<Record<Exclude<ProbeSeverity, "ok">, "info" | "warning" | "critical">> = {
	warn: "warning",
	critical: "critical",
};

/** Occurrence count per severity (used for Transcendence confidence weighting). */
const OCCURRENCE_BY_SEVERITY: Readonly<Record<"info" | "warning" | "critical", number>> = {
	info: 1,
	warning: 3,
	critical: 5,
};

// ─── Signal Bridge ────────────────────────────────────────────────────────────

/**
 * Convert a single ProbeResult into a RegressionAlertLike signal and
 * inject it into the TranscendenceEngine's regression pipeline.
 *
 * Only unhealthy (warn or critical) probes are injected.
 * Healthy ("ok") probes are silently skipped.
 *
 * @param result  - ProbeResult from InternalScarlett.runCycle()
 * @param engine  - TranscendenceEngine instance (duck-typed)
 */
export function injectProbeSignal(
	result: ProbeResult,
	engine: TranscendenceEngineRef,
): void {
	if (result.healthy || result.severity === "ok") return;

	const entity = PROBE_TO_ENTITY[result.probe] ?? result.probe;
	const alertSeverity = SEVERITY_MAP[result.severity as Exclude<ProbeSeverity, "ok">] ?? "info";
	const occurrences = OCCURRENCE_BY_SEVERITY[alertSeverity];

	const alert: RegressionAlertLike = {
		errorSignature: entity,
		description: result.summary,
		currentOccurrences: occurrences,
		previousOccurrences: 0,
		severity: alertSeverity,
		lastSeenBefore: new Date(0).toISOString(),
		detectedAt: new Date().toISOString(),
	};

	log.debug("Injecting probe signal into Transcendence", {
		probe: result.probe,
		entity,
		severity: alertSeverity,
	});

	engine.ingestRegressions([alert]);
}

/**
 * Batch-inject multiple ProbeResults into TranscendenceEngine.
 *
 * Filters to only unhealthy probes, converts all at once, and
 * makes a single ingestRegressions() call for efficiency.
 *
 * @param results - Array of ProbeResults from a full InternalScarlett cycle
 * @param engine  - TranscendenceEngine instance (duck-typed)
 * @returns Number of signals injected
 */
export function injectCycleSignals(
	results: ProbeResult[],
	engine: TranscendenceEngineRef,
): number {
	const alerts: RegressionAlertLike[] = [];

	for (const result of results) {
		if (result.healthy || result.severity === "ok") continue;

		const entity = PROBE_TO_ENTITY[result.probe] ?? result.probe;
		const alertSeverity = SEVERITY_MAP[result.severity as Exclude<ProbeSeverity, "ok">] ?? "info";
		const occurrences = OCCURRENCE_BY_SEVERITY[alertSeverity];

		alerts.push({
			errorSignature: entity,
			description: result.summary,
			currentOccurrences: occurrences,
			previousOccurrences: 0,
			severity: alertSeverity,
			lastSeenBefore: new Date(0).toISOString(),
			detectedAt: new Date().toISOString(),
		});
	}

	if (alerts.length > 0) {
		log.info("Injecting cycle signals into Transcendence", {
			count: alerts.length,
			entities: alerts.map((a) => a.errorSignature),
		});
		engine.ingestRegressions(alerts);
	}

	return alerts.length;
}
