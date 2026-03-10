/**
 * @chitragupta/prana — Research workflow node adapters.
 *
 * Engine-native bounded experiment loops and ACP-style council planning.
 * These adapters keep Chitragupta as the durable authority while letting
 * Prana orchestrates research/scientific workflows.
 */

import type { NodeContext, NodeResult } from "./chitragupta-nodes.js";
import { fail, timed } from "./chitragupta-nodes.js";
import {
	buildScope,
	type ResearchScope,
	pickMetric,
	resultData,
} from "./chitragupta-nodes-research-shared.js";
import {
	executeResearchRun,
	evaluateResearchResult,
	finalizeResearchResult,
	packResearchContext,
	recordResearchOutcome,
	runResearchCouncil,
} from "./chitragupta-nodes-research-runtime.js";

function scopeFromContext(ctx: NodeContext): ResearchScope {
	return buildScope(ctx);
}

export async function autoresearchScope(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () => scopeFromContext(ctx));
		return {
			ok: true,
			summary: `Bounded research scope prepared for ${result.targetFiles.join(", ")} under ${result.budgetMs}ms`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("Autoresearch scope failed", 0, err);
	}
}

export async function acpResearchCouncil(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () => runResearchCouncil(scopeFromContext(ctx)));
		return {
			ok: true,
			summary: `ACP research council concluded with ${String(result.finalVerdict)}`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("ACP research council failed", 0, err);
	}
}

export async function autoresearchBaseline(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () => {
			const scope = scopeFromContext(ctx);
			const baselineText = typeof ctx.extra.researchBaselineText === "string" ? ctx.extra.researchBaselineText : "";
			const providedBaseline = typeof ctx.extra.researchBaselineMetric === "number"
				? ctx.extra.researchBaselineMetric
				: Number.NaN;
			const baselineMetric = Number.isFinite(providedBaseline)
				? providedBaseline
				: pickMetric(baselineText, scope.metricPattern);
			return {
				metricName: scope.metricName,
				objective: scope.objective,
				baselineMetric,
				hypothesis: scope.hypothesis,
			};
		});
		return {
			ok: true,
			summary: Number.isFinite(result.baselineMetric)
				? `Baseline ${result.metricName} = ${result.baselineMetric}`
				: `Baseline ${result.metricName} not provided`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("Autoresearch baseline failed", 0, err);
	}
}

export async function autoresearchRun(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () =>
			executeResearchRun(
				scopeFromContext(ctx),
				resultData(ctx.stepOutputs["acp-research-council"]),
			),
		);
		return {
			ok: true,
			summary: result.metric !== null
				? `Research run complete: ${result.metricName}=${result.metric}`
				: "Research run complete with no metric match",
			data: result,
			durationMs,
		};
	} catch (err) {
		const error = err as Error & {
			stdout?: string;
			stderr?: string;
			metric?: number | null;
			durationMs?: number;
			timedOut?: boolean;
			exitCode?: number | null;
			scopeGuard?: "git" | "hash-only";
			targetFilesChanged?: string[];
			scopeSnapshot?: unknown;
			executionRouteClass?: string | null;
			selectedCapabilityId?: string | null;
			selectedModelId?: string | null;
			selectedProviderId?: string | null;
		};
		return {
			ok: false,
			summary: `${error.timedOut ? "Autoresearch run timed out" : "Autoresearch run failed"}: ${error.message}`,
			data: {
				message: error.message,
				stdout: error.stdout ?? "",
				stderr: error.stderr ?? "",
				metric: error.metric ?? null,
				exitCode: typeof error.exitCode === "number" ? error.exitCode : null,
				timedOut: error.timedOut === true,
				scopeGuard: error.scopeGuard === "hash-only" ? "hash-only" : "git",
				targetFilesChanged: Array.isArray(error.targetFilesChanged)
					? error.targetFilesChanged.filter((value: unknown): value is string => typeof value === "string")
					: [],
				scopeSnapshot:
					error.scopeSnapshot && typeof error.scopeSnapshot === "object"
						? error.scopeSnapshot
						: null,
				executionRouteClass:
					typeof error.executionRouteClass === "string" ? error.executionRouteClass : null,
				selectedCapabilityId:
					typeof error.selectedCapabilityId === "string" ? error.selectedCapabilityId : null,
				selectedModelId:
					typeof error.selectedModelId === "string" ? error.selectedModelId : null,
				selectedProviderId:
					typeof error.selectedProviderId === "string" ? error.selectedProviderId : null,
			},
			durationMs: error.durationMs ?? 0,
		};
	}
}

export async function autoresearchEvaluate(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () =>
			evaluateResearchResult(
				resultData(ctx.stepOutputs["autoresearch-baseline"]),
				resultData(ctx.stepOutputs["autoresearch-run"]),
			),
		);
		return {
			ok: true,
			summary:
				result.decision === "keep"
					? `Research result accepted (${result.metricName})`
					: `Research result rejected (${result.metricName})`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("Autoresearch evaluation failed", 0, err);
	}
}

export async function autoresearchFinalize(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () =>
			finalizeResearchResult(
				scopeFromContext(ctx),
				resultData(ctx.stepOutputs["autoresearch-run"]),
				resultData(ctx.stepOutputs["autoresearch-evaluate"]),
			),
		);
		return {
			ok: true,
			summary:
				result.action === "reverted"
					? `Research result discarded and reverted (${result.revertedFiles.length} files)`
					: result.action === "kept"
						? "Research result kept"
						: `Research finalize skipped: ${result.reason ?? "no revert action"}`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("Autoresearch finalize failed", 0, err);
	}
}

export async function paktPackResearchContext(ctx: NodeContext): Promise<NodeResult> {
		try {
			const { result, durationMs } = await timed(async () =>
				packResearchContext(
					scopeFromContext(ctx),
					resultData(ctx.stepOutputs["acp-research-council"]),
					resultData(ctx.stepOutputs["autoresearch-run"]),
					resultData(ctx.stepOutputs["autoresearch-evaluate"]),
				),
			);
			const packed = result.packed === true
				|| (result.packed !== false && typeof result.packedText === "string" && result.packedText.trim().length > 0);
			return {
				ok: true,
				summary: packed
					? `Research context packed via ${String(result.runtime)}`
					: "Research context left uncompressed",
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("PAKT research packing failed", 0, err);
	}
}

export async function autoresearchRecord(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result, durationMs } = await timed(async () =>
			recordResearchOutcome(
				scopeFromContext(ctx),
				resultData(ctx.stepOutputs["acp-research-council"]),
				resultData(ctx.stepOutputs["autoresearch-run"]),
				resultData(ctx.stepOutputs["autoresearch-evaluate"]),
				resultData(ctx.stepOutputs["autoresearch-finalize"]),
				resultData(ctx.stepOutputs["pakt-pack-research-context"]),
			),
		);
		return {
			ok: true,
			summary: `Autoresearch record persisted (${String(result.traceId)})`,
			data: result,
			durationMs,
		};
	} catch (err) {
		return fail("Autoresearch record failed", 0, err);
	}
}
