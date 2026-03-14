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
import {
	reusableScopeSnapshot,
	verifyKeptHashOnlyScope,
	verifyRestoredScope,
} from "./chitragupta-nodes-research-runner-verify.js";

const execFileAsync = promisify(execFile);

/**
 * Cleanup can safely no-op when the failed round left no scoped target-file
 * delta behind. Any other skipped cleanup result is treated as unsafe.
 */
export function cleanupResultRequiresFailure(result: ResearchFinalizeResult): boolean {
	if (result.action === "reverted") return false;
	if (
		result.action === "skipped"
		&& result.revertedFiles.length === 0
		&& typeof result.reason === "string"
		&& result.reason.startsWith("Failed run produced no target-file changes to restore.")
	) {
		return false;
	}
	return true;
}

async function runBoundedCommand(scope: ExecutableResearchScope): Promise<ResearchRunData> {
	validateScope(scope);
	const before = await captureScopeSnapshot(scope, scope.interruptSignal);
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
		const after = await captureScopeSnapshot(scope, scope.interruptSignal);
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
		const after = await captureScopeSnapshot(scope, scope.interruptSignal);
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

/**
 * Evaluate a round against the current baseline and convert raw metric output
 * into a keep/discard recommendation that later governance steps can enforce.
 */
export async function evaluateResearchResult(
	baseline: Record<string, unknown>,
	run: Record<string, unknown>,
	policy: Pick<ResearchScope, "minimumImprovementDelta" | "requireTargetFileChangesForKeep"> | null = null,
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
	const minimumImprovementDelta =
		typeof policy?.minimumImprovementDelta === "number" ? policy.minimumImprovementDelta : 0;
	const requireTargetFileChangesForKeep = policy?.requireTargetFileChangesForKeep !== false;
	const targetFilesChanged = Array.isArray(run.targetFilesChanged)
		? run.targetFilesChanged.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		: [];
	const delta = baselineMetric !== null && observedMetric !== null
		? objective === "minimize"
			? baselineMetric - observedMetric
			: observedMetric - baselineMetric
		: null;
	const improvedMetric = delta !== null && delta > minimumImprovementDelta;
	const hasRequiredChanges = !requireTargetFileChangesForKeep || targetFilesChanged.length > 0;
	const improved = improvedMetric && hasRequiredChanges;
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

/**
 * Finalize a completed round by deciding whether to keep or revert the bounded
 * file set touched by the experiment.
 *
 * Restore scope is intentionally limited to the scoped target files or snapshot
 * envelope gathered before the run. This is not a full-worktree rollback API.
 */
export async function finalizeResearchResult(
	scope: ResearchScope,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ResearchFinalizeResult> {
	const requestedKeep = evaluation.decision === "keep";
	const targetFilesChanged = Array.isArray(run.targetFilesChanged)
		? run.targetFilesChanged.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		: [];
	const scopeGuard = run.scopeGuard === "hash-only" ? "hash-only" : "git";
	const keepBlockedByHashOnlyPolicy =
		requestedKeep
		&& scopeGuard === "hash-only"
		&& scope.allowHashOnlyKeep !== true;
	const decision = requestedKeep && scope.requireTargetFileChangesForKeep !== false && targetFilesChanged.length === 0
		? "discard"
		: keepBlockedByHashOnlyPolicy
			? "discard"
			: requestedKeep
			? "keep"
			: "discard";
	if (decision === "keep") {
		if (scopeGuard === "hash-only") {
			const snapshot = reusableScopeSnapshot(run);
			if (!snapshot) {
				return {
					decision: "discard",
					action: "skipped",
					revertedFiles: [],
					reason: "Hash-only keep requires a reusable pre-run scope snapshot.",
					scopeGuard,
				};
			}
			const verifiedKeep = await verifyKeptHashOnlyScope(scope, snapshot, run, signal);
			if (!verifiedKeep.ok) {
				// I actively revert on failed hash-only verification instead of
				// silently downgrading to a skipped keep. The whole point of the
				// hash-only guard is to avoid preserving unprovable mutations.
				const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot, signal);
				return {
					decision: "discard",
					action: revertedFiles.length > 0 ? "reverted" : "skipped",
					revertedFiles,
					reason: verifiedKeep.reason,
					scopeGuard,
				};
			}
		}
		return {
			decision,
			action: "kept",
			revertedFiles: [],
			reason: null,
			scopeGuard,
		};
	}
	const snapshot = reusableScopeSnapshot(run);
	if (!snapshot) {
		return {
			decision,
			action: "skipped",
			revertedFiles: [],
			reason:
				keepBlockedByHashOnlyPolicy
					? "Discarded because hash-only overnight runs require explicit allowHashOnlyKeep to persist changes."
				: requestedKeep && targetFilesChanged.length === 0
					? "Discarded because the run produced no target-file changes to keep."
					: "No reusable scope snapshot was available for discard cleanup.",
			scopeGuard,
		};
	}
	const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot, signal);
	const verification = await verifyRestoredScope(scope, snapshot, run, signal);
	if (!verification.ok) {
		return {
			decision,
			action: "skipped",
			revertedFiles,
			reason: verification.reason ?? "Discard cleanup could not be verified against the pre-run scope snapshot.",
			scopeGuard,
		};
	}
	return {
		decision,
		action: revertedFiles.length > 0 ? "reverted" : "skipped",
		revertedFiles,
		reason:
			keepBlockedByHashOnlyPolicy
				? "Discarded because hash-only overnight runs require explicit allowHashOnlyKeep to persist changes."
			: requestedKeep && targetFilesChanged.length === 0
				? "Discarded because the run produced no target-file changes to keep."
				: revertedFiles.length > 0
					? null
					: "Discarded run produced no target-file changes to restore.",
		scopeGuard,
	};
}

/**
 * Best-effort recovery path for failed or cancelled rounds before the loop
 * continues or exits.
 *
 * This is a scoped cleanup path, not a guarantee that arbitrary side effects
 * outside the tracked file envelope were undone.
 */
export async function recoverResearchFailure(
	scope: ResearchScope,
	run: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ResearchFinalizeResult> {
	const scopeGuard = run.scopeGuard === "hash-only" ? "hash-only" : "git";
	const snapshot = reusableScopeSnapshot(run);
	if (!snapshot) {
		return {
			decision: "discard",
			action: "skipped",
			revertedFiles: [],
			reason: "No reusable scope snapshot was available for failure cleanup.",
			scopeGuard,
		};
	}
	const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot, signal);
	const verification = await verifyRestoredScope(scope, snapshot, run, signal);
	if (!verification.ok) {
		return {
			decision: "discard",
			action: "skipped",
			revertedFiles,
			reason: verification.reason ?? "Failure cleanup could not be verified against the pre-run scope snapshot.",
			scopeGuard,
		};
	}
	return {
		decision: "discard",
		action: revertedFiles.length > 0 ? "reverted" : "skipped",
		revertedFiles,
		reason: revertedFiles.length > 0 ? "Recovered target files after failed research round." : "Failed run produced no target-file changes to restore.",
		scopeGuard,
	};
}
