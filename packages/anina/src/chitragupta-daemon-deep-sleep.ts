import type { ConsolidationEvent } from "./chitragupta-daemon-support.js";
import { emitDeepSleepResearchEvents } from "./chitragupta-daemon-reporting.js";
import {
	resolveSessionProjects,
	runSwapnaForProjects,
} from "./chitragupta-daemon-swapna.js";
import { consolidateResearchRefinementDigestsForProjects } from "./chitragupta-daemon-research.js";
import { buildDailyRefinementGovernorPlan } from "./chitragupta-daemon-refinement-governor.js";
import { mergeResearchRefinementScopes } from "./chitragupta-daemon-research-scope.js";
import {
	repairSelectiveReembeddingForResearchScopes,
} from "./chitragupta-daemon-semantic.js";
import type { ResearchRefinementProjectScope } from "./chitragupta-daemon-research-scope.js";

/**
 * Build one stable deferred-session view for the deep-sleep tail.
 *
 * I union missing sessions with resolved-but-unprocessed sessions so the daemon
 * can report truthful backlog debt without counting already-processed sessions
 * twice when the input set is mixed.
 */
function summarizeDeferredDeepSleepSessions(args: {
	sessionIds: readonly string[];
	resolvedIds: ReadonlySet<string>;
	processedIds: ReadonlySet<string>;
}): {
	missingSessionIds: string[];
	deferredSessionIds: string[];
} {
	const missingSessionIds = [...new Set(
		args.sessionIds.filter((id) => !args.resolvedIds.has(id)),
	)];
	const missingSessionIdSet = new Set(missingSessionIds);
	const deferredSessionIds = [...new Set(
		args.sessionIds.filter((id) => missingSessionIdSet.has(id) || !args.processedIds.has(id)),
	)];
	return { missingSessionIds, deferredSessionIds };
}

/** Queue unfinished deep-sleep refinement work into the durable daemon retry lane. */
async function queueDeepSleepRefinementScopes(
	label: string,
	scopes: readonly ResearchRefinementProjectScope[],
	lastError: string,
): Promise<number> {
	if (scopes.length === 0) return 0;
	const { upsertResearchRefinementQueue } = await import("@chitragupta/smriti");
	return upsertResearchRefinementQueue(
		mergeResearchRefinementScopes(scopes).map((scope) => ({
			label,
			projectPath: scope.projectPath,
			sessionIds: scope.sessionIds,
			sessionLineageKeys: scope.sessionLineageKeys,
			policyFingerprints: scope.policyFingerprints,
			primaryObjectiveIds: scope.primaryObjectiveIds,
			primaryStopConditionIds: scope.primaryStopConditionIds,
			primaryStopConditionKinds: scope.primaryStopConditionKinds,
			frontierBestScore: scope.frontierBestScore ?? null,
			refinementBudget: scope.refinementBudget ?? null,
			nidraBudget: scope.nidraBudget ?? null,
		})),
		{
			notBefore: Date.now(),
			lastError,
		},
	);
}

/**
 * Persist one durable backlog note when deep-sleep had to carry unfinished
 * research refinement into the next daemon cycle.
 *
 * I record this once in global memory so later operators can see why the
 * overnight tail is still pending even after Swapna itself succeeded.
 */
async function persistDeepSleepBacklogNote(args: {
	label: string;
	deferredScopes: readonly ResearchRefinementProjectScope[];
	qualityDeferredScopes: readonly ResearchRefinementProjectScope[];
	carriedForward: number;
	queuedQualityDebt: number;
}): Promise<void> {
	if (args.carriedForward <= 0 && args.queuedQualityDebt <= 0) return;
	const affectedProjects = mergeResearchRefinementScopes([
		...args.deferredScopes,
		...args.qualityDeferredScopes,
	]).map((scope) => scope.projectPath);
	const { appendMemory } = await import("@chitragupta/smriti");
	const lines = [
		`## Deep-Sleep Research Backlog [${args.label}]`,
		`- queuedCarriedForward: ${args.carriedForward}`,
		`- queuedQualityDebt: ${args.queuedQualityDebt}`,
		args.deferredScopes.length > 0 ? `- deferredProjects: ${args.deferredScopes.map((scope) => scope.projectPath).join(", ")}` : "",
		args.qualityDeferredScopes.length > 0
			? `- qualityDebtProjects: ${args.qualityDeferredScopes.map((scope) => scope.projectPath).join(", ")}`
			: "",
		affectedProjects.length > 0 ? `- affectedProjects: ${affectedProjects.join(", ")}` : "",
		"- nextStep: replay the queued deep-sleep research scopes before treating the overnight tail as closed.",
	].filter(Boolean);
	await appendMemory({ type: "global" }, lines.join("\n"), { dedupe: true });
}

/**
 * Run deep-sleep project consolidation for the exact sessions Nidra handed us.
 *
 * Raw session ownership stays in Smriti; this helper only groups those sessions
 * into project-scoped Swapna and research-refinement passes.
 */
export async function consolidateDeepSleepSessions(
	sessionIds: readonly string[],
	emitConsolidation: (event: ConsolidationEvent) => void,
): Promise<string[]> {
	if (sessionIds.length === 0) return [];

	const label = "deep-sleep";
	emitConsolidation({
		type: "progress",
		date: label,
		phase: "deep-sleep:resolve",
		detail: `${sessionIds.length} pending sessions`,
	});

	const sessions = await resolveSessionProjects(sessionIds);
	const resolvedIds = new Set(sessions.map((session) => session.id));
	const { missingSessionIds } = summarizeDeferredDeepSleepSessions({
		sessionIds,
		resolvedIds,
		processedIds: new Set(),
	});
	const projects = new Map<string, Array<{ id: string; sessionLineageKey: string | null }>>();

	for (const session of sessions) {
		const existing = projects.get(session.project);
		if (existing) existing.push({ id: session.id, sessionLineageKey: session.sessionLineageKey });
		else projects.set(session.project, [{ id: session.id, sessionLineageKey: session.sessionLineageKey }]);
	}

	if (missingSessionIds.length > 0) {
		emitConsolidation({
			type: "progress",
			date: label,
			phase: "deep-sleep:resolve",
			detail: `${missingSessionIds.length} sessions missing from Smriti`,
		});
	}

	if (projects.size === 0) {
		if (missingSessionIds.length > 0) {
			emitConsolidation({
				type: "progress",
				date: label,
				phase: "deep-sleep:swapna",
				detail: `${missingSessionIds.length} pending sessions deferred for retry`,
			});
		}
		emitConsolidation({
			type: "progress",
			date: label,
			phase: "deep-sleep:resolve",
			detail: "no matching projects for pending sessions",
		});
		return [];
	}

	const emitSwapnaEvent = (_eventName: "consolidation", event: ConsolidationEvent): boolean => {
		emitConsolidation(event);
		return true;
	};
	const emitReportedEvent = (event: ConsolidationEvent): boolean => {
		emitConsolidation(event);
		return true;
	};

	const processedSessionIds = await runSwapnaForProjects(
		[...projects.entries()].map(([project, scopedSessions]) => ({
			project,
			sessionIds: scopedSessions.map((session) => session.id),
		})),
		label,
		"deep-sleep:swapna",
		emitSwapnaEvent,
	);

	const processed = new Set(processedSessionIds);
	const { deferredSessionIds } = summarizeDeferredDeepSleepSessions({
		sessionIds,
		resolvedIds,
		processedIds: processed,
	});
	if (deferredSessionIds.length > 0) {
		emitConsolidation({
			type: "progress",
			date: label,
			phase: "deep-sleep:swapna",
			detail: `${deferredSessionIds.length} pending sessions deferred for retry`,
		});
	}

	const researchScopes = [...projects.entries()]
		.map(([projectPath, scopedSessions]) => ({
			projectPath,
			sessionIds: scopedSessions
				.map((session) => session.id)
				.filter((id) => processed.has(id)),
			sessionLineageKeys: [...new Set(
				scopedSessions
					.filter((session) => processed.has(session.id))
					.map((session) => session.sessionLineageKey)
					.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
			)],
		}))
		.filter((scope) => scope.sessionIds.length > 0 || scope.sessionLineageKeys.length > 0);

	if (researchScopes.length > 0) {
		let recoveredResearchScopes: ResearchRefinementProjectScope[] = researchScopes.map((scope) => ({
			projectPath: scope.projectPath,
			sessionIds: scope.sessionIds,
			sessionLineageKeys: scope.sessionLineageKeys,
		}));
		try {
			const research = await consolidateResearchRefinementDigestsForProjects(label, researchScopes);
			if (research.scopes.length === 0) {
				// I only widen the shared refinement governor when the digest
				// actually recovered overnight research signal. A no-signal
				// deep-sleep pass should not relabel an unrelated active budget.
				return processedSessionIds;
			}
			recoveredResearchScopes = research.scopes;
			const {
				readActiveResearchRefinementBudget,
				upsertResearchRefinementBudget,
			} = await import("@chitragupta/smriti");
			const governor = buildDailyRefinementGovernorPlan({
				loopProjects: 0,
				experimentProjects: 0,
				refinementScopes: research.scopes,
				activeBudget: readActiveResearchRefinementBudget(),
			});
				if (governor.effectiveBudget) {
					// I carry deep-sleep research pressure back into the shared daemon
					// budget so the next semantic pass keeps the same widened repair
					// envelope instead of forgetting what the overnight loop learned.
					upsertResearchRefinementBudget({
					refinement: governor.effectiveBudget.refinement,
						nidra: governor.effectiveBudget.nidra,
						source: "nidra.deep-sleep",
					});
				}
				const carriedForward = governor.deferredScopes.length > 0
					? await queueDeepSleepRefinementScopes(
							label,
							governor.deferredScopes,
							"deferred:nidra-project-budget",
						)
					: 0;
				const semanticScopes = governor.selectedScopes.length > 0
					? governor.selectedScopes
					: (research.scopes.length > 0 ? research.scopes : researchScopes);
				const semantic = await repairSelectiveReembeddingForResearchScopes(label, semanticScopes);
				const qualityDeferredScopes = mergeResearchRefinementScopes(
					semantic.scopes
						.filter((scope) => scope.qualityDeferred > 0)
						.map((scope) => semanticScopes.find((candidate) => candidate.projectPath === scope.projectPath))
						.filter((scope): scope is ResearchRefinementProjectScope => Boolean(scope)),
				);
				const queuedQualityDebt = qualityDeferredScopes.length > 0
					? await queueDeepSleepRefinementScopes(
							label,
							qualityDeferredScopes,
							`quality-deferred:nidra-deep-sleep:${semantic.qualityDeferred}`,
						)
					: 0;
				if (carriedForward > 0 || queuedQualityDebt > 0) {
					await persistDeepSleepBacklogNote({
						label,
						deferredScopes: governor.deferredScopes,
						qualityDeferredScopes,
						carriedForward,
						queuedQualityDebt,
					});
					emitConsolidation({
						type: "progress",
						date: label,
						phase: "deep-sleep:research-refinement",
						detail:
							`queued ${carriedForward} deferred scopes and ${queuedQualityDebt} quality-debt scopes for retry`,
					});
				}
				emitDeepSleepResearchEvents(emitReportedEvent, label, research, semantic);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				const carriedForward = recoveredResearchScopes.length > 0
					? await queueDeepSleepRefinementScopes(
							label,
							recoveredResearchScopes,
							`error:nidra-deep-sleep:${errorMessage}`,
						)
					: 0;
				if (carriedForward > 0) {
					await persistDeepSleepBacklogNote({
						label,
						deferredScopes: recoveredResearchScopes,
						qualityDeferredScopes: [],
						carriedForward,
						queuedQualityDebt: 0,
					});
				}
				emitConsolidation({
					type: "error",
					date: label,
					phase: "deep-sleep:research-refinement",
					detail: errorMessage,
				});
				// Swapna already consumed these sessions successfully. I persist the
				// failed research-refinement tail into the durable retry lane, using
				// the richest digest-enriched scopes we already recovered, and return
				// the processed session ids so the next cycle retries only that
				// unfinished refinement tail instead of replaying completed Swapna work.
				return processedSessionIds;
			}
	}

	return processedSessionIds;
}
