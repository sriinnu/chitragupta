import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
	councilSupports,
	type ResearchFinalizeResult,
	type ResearchRunData,
	type ResearchScope,
	type ResearchScopeSnapshot,
	pickMetric,
	validateScope,
} from "./chitragupta-nodes-research-shared.js";
import {
	assertScopeSnapshot,
	assertWorkspaceReadyForResearch,
	captureScopeSnapshot,
	compareScopeSnapshots,
	type ExecutableResearchScope,
	dirtyStateForSnapshot,
	restoreScopeFromSnapshot,
	serializeScopeSnapshot,
} from "./chitragupta-nodes-research-runner-helpers.js";
import {
	buildResearchExecutionEnv,
	extractExecutionRoute,
	extractGatingRoute,
	extractPlannerRoute,
	type ResearchExecutionRoute,
	type ResearchRoundContext,
} from "./chitragupta-nodes-research-runner-routes.js";

const execFileAsync = promisify(execFile);

async function runBoundedCommand(scope: ExecutableResearchScope): Promise<ResearchRunData> {
	validateScope(scope);
	const before = await captureScopeSnapshot(scope);
	assertScopeSnapshot(scope, before, "before");
	assertWorkspaceReadyForResearch(scope, before);
	const startedAt = Date.now();
	try {
		const { stdout, stderr } = await execFileAsync(scope.command, scope.commandArgs, {
			cwd: scope.cwd,
			env: scope.env ? { ...process.env, ...scope.env } : process.env,
			timeout: scope.budgetMs,
			signal: scope.interruptSignal,
			maxBuffer: 10 * 1024 * 1024,
		});
		const after = await captureScopeSnapshot(scope);
		assertScopeSnapshot(scope, after, "after");
		const compared = compareScopeSnapshots(scope, before, after);
		const combined = `${stdout}\n${stderr}`;
		return {
			command: scope.command,
			commandArgs: scope.commandArgs,
			cwd: scope.cwd,
			metricName: scope.metricName,
			metric: pickMetric(combined, scope.metricPattern),
			stdout,
			stderr,
			exitCode: 0,
			timedOut: false,
			durationMs: Date.now() - startedAt,
			scopeGuard: after.mode,
			targetFilesChanged: compared.targetFilesChanged,
			gitBranch: before.gitBranch,
			gitHeadCommit: before.gitHeadCommit,
			gitDirtyBefore: dirtyStateForSnapshot(before),
			gitDirtyAfter: dirtyStateForSnapshot(after),
			scopeSnapshot: serializeScopeSnapshot(scope, before),
		};
	} catch (error) {
		const after = await captureScopeSnapshot(scope);
		assertScopeSnapshot(scope, after, "after");
		let compared: { targetFilesChanged: string[] } = { targetFilesChanged: [] };
		let scopeError: Error | null = null;
		try {
			compared = compareScopeSnapshots(scope, before, after);
		} catch (compareError) {
			scopeError = compareError instanceof Error ? compareError : new Error(String(compareError));
		}
		const err = error as Error & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			signal?: string | null;
			name?: string;
		};
		const cancelled =
			scope.interruptSignal?.aborted === true
			|| err.name === "AbortError"
			|| err.code === "ABORT_ERR";
		const combined = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
		const message = scopeError
			? scopeError.message
			: cancelled
				? `Research run cancelled: ${err.message}`
				: `Research run failed: ${err.message}`;
		const enriched = Object.assign(new Error(message), {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			metric: pickMetric(combined, scope.metricPattern),
			exitCode: typeof err.code === "number" ? err.code : null,
			durationMs: Date.now() - startedAt,
			timedOut: err.signal === "SIGTERM",
			cancelled,
			scopeGuard: after.mode,
			targetFilesChanged: compared.targetFilesChanged,
			gitBranch: before.gitBranch,
			gitHeadCommit: before.gitHeadCommit,
			gitDirtyBefore: dirtyStateForSnapshot(before),
			gitDirtyAfter: dirtyStateForSnapshot(after),
			scopeSnapshot: serializeScopeSnapshot(scope, before),
		});
		throw enriched;
	}
}

/** Execute the bounded experiment command under the engine-selected route envelope. */
export async function executeResearchRun(
	scope: ResearchScope,
	council: Record<string, unknown>,
	roundContext: ResearchRoundContext = null,
): Promise<ResearchRunData> {
	if (!councilSupports(council.finalVerdict)) {
		throw new Error(`Research council did not approve execution: ${String(council.finalVerdict ?? "unknown")}`);
	}
	const gatingRoute = extractGatingRoute(council);
	const executionRoute = extractExecutionRoute(council);
	if (gatingRoute && (gatingRoute.discoverableOnly === true || typeof gatingRoute.selectedCapabilityId !== "string" || !gatingRoute.selectedCapabilityId.trim())) {
		const reason = typeof gatingRoute.reason === "string" && gatingRoute.reason.trim()
			? gatingRoute.reason.trim()
			: "research route did not resolve to an executable engine capability";
		throw new Error(`Research route did not authorize execution: ${reason}`);
	}
	const plannerRoute = extractPlannerRoute(council);
	let result: ResearchRunData;
	try {
		result = await runBoundedCommand({
			...scope,
			env: buildResearchExecutionEnv(scope, executionRoute, {
				...roundContext,
				plannerRoute,
			}),
		});
	} catch (error) {
		const err = error as Error & Record<string, unknown>;
		err.executionRouteClass =
			typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : scope.executionRouteClass;
		err.selectedCapabilityId =
			typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : null;
		err.selectedModelId =
			typeof executionRoute?.executionBinding?.selectedModelId === "string"
				? executionRoute.executionBinding.selectedModelId
				: null;
		err.selectedProviderId =
			typeof executionRoute?.executionBinding?.selectedProviderId === "string"
				? executionRoute.executionBinding.selectedProviderId
				: null;
		throw err;
	}
	return {
		...result,
		executionRouteClass: typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : scope.executionRouteClass,
		selectedCapabilityId: typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : null,
		selectedModelId: typeof executionRoute?.executionBinding?.selectedModelId === "string"
			? executionRoute.executionBinding.selectedModelId
			: null,
		selectedProviderId: typeof executionRoute?.executionBinding?.selectedProviderId === "string"
			? executionRoute.executionBinding.selectedProviderId
			: null,
	};
}

export async function evaluateResearchResult(
	baseline: Record<string, unknown>,
	run: Record<string, unknown>,
): Promise<{
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	improved: boolean;
	decision: "keep" | "discard";
}> {
	const objective = (baseline.objective === "maximize" || run.objective === "maximize") ? "maximize" : "minimize";
	const baselineMetric = typeof baseline.baselineMetric === "number" ? baseline.baselineMetric : null;
	const observedMetric = typeof run.metric === "number" ? run.metric : null;
	const delta = baselineMetric !== null && observedMetric !== null
		? objective === "minimize"
			? baselineMetric - observedMetric
			: observedMetric - baselineMetric
		: null;
	const improved = delta !== null && delta > 0;
	return {
		metricName: typeof baseline.metricName === "string" ? baseline.metricName : String(run.metricName ?? "val_bpb"),
		objective,
		baselineMetric,
		observedMetric,
		delta,
		improved,
		decision: improved ? "keep" : "discard",
	};
}

/** Finalize a completed round by deciding whether to keep or revert the bounded file set. */
export async function finalizeResearchResult(
	scope: ResearchScope,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
): Promise<ResearchFinalizeResult> {
	const decision = evaluation.decision === "keep" ? "keep" : "discard";
	const scopeGuard = run.scopeGuard === "hash-only" ? "hash-only" : "git";
	if (decision === "keep") {
		return {
			decision,
			action: "kept",
			revertedFiles: [],
			reason: null,
			scopeGuard,
		};
	}
	const snapshot = run.scopeSnapshot;
	if (!snapshot || typeof snapshot !== "object" || !("fileContents" in snapshot) || typeof (snapshot as { fileContents?: unknown }).fileContents !== "object") {
		return {
			decision,
			action: "skipped",
			revertedFiles: [],
			reason: "No reusable scope snapshot was available for discard cleanup.",
			scopeGuard,
		};
	}
	const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot as ResearchScopeSnapshot);
	return {
		decision,
		action: "reverted",
		revertedFiles,
		reason: revertedFiles.length > 0 ? null : "Discarded run produced no target-file changes to restore.",
		scopeGuard,
	};
}

/** Best-effort recovery path for failed or cancelled rounds before the loop continues or exits. */
export async function recoverResearchFailure(
	scope: ResearchScope,
	run: Record<string, unknown>,
): Promise<ResearchFinalizeResult> {
	const scopeGuard = run.scopeGuard === "hash-only" ? "hash-only" : "git";
	const snapshot = run.scopeSnapshot;
	if (
		!snapshot ||
		typeof snapshot !== "object" ||
		!("fileContents" in snapshot) ||
		typeof (snapshot as { fileContents?: unknown }).fileContents !== "object"
	) {
		return {
			decision: "discard",
			action: "skipped",
			revertedFiles: [],
			reason: "No reusable scope snapshot was available for failure cleanup.",
			scopeGuard,
		};
	}
	const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot as ResearchScopeSnapshot);
	return {
		decision: "discard",
		action: revertedFiles.length > 0 ? "reverted" : "skipped",
		revertedFiles,
		reason: revertedFiles.length > 0 ? "Recovered target files after failed research round." : "Failed run produced no target-file changes to restore.",
		scopeGuard,
	};
}
