import type { ConsolidationEvent } from "./chitragupta-daemon-support.js";
import { emitDeepSleepResearchEvents } from "./chitragupta-daemon-reporting.js";
import {
	resolveSessionProjects,
	runSwapnaForProjects,
} from "./chitragupta-daemon-swapna.js";
import { consolidateResearchRefinementDigestsForProjects } from "./chitragupta-daemon-research.js";
import {
	repairSelectiveReembeddingForResearchScopes,
} from "./chitragupta-daemon-semantic.js";

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
	const missingCount = sessionIds.reduce(
		(count, id) => count + (resolvedIds.has(id) ? 0 : 1),
		0,
	);
	const projects = new Map<string, Array<{ id: string; sessionLineageKey: string | null }>>();

	for (const session of sessions) {
		const existing = projects.get(session.project);
		if (existing) existing.push({ id: session.id, sessionLineageKey: session.sessionLineageKey });
		else projects.set(session.project, [{ id: session.id, sessionLineageKey: session.sessionLineageKey }]);
	}

	if (missingCount > 0) {
		emitConsolidation({
			type: "progress",
			date: label,
			phase: "deep-sleep:resolve",
			detail: `${missingCount} sessions missing from Smriti`,
		});
	}

	if (projects.size === 0) {
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

	if (processedSessionIds.length !== sessionIds.length) {
		const processed = new Set(processedSessionIds);
		const deferred = sessionIds.filter((id) => !processed.has(id));
		if (deferred.length > 0) {
			emitConsolidation({
				type: "progress",
				date: label,
				phase: "deep-sleep:swapna",
				detail: `${deferred.length} pending sessions deferred for retry`,
			});
		}
	}

	const processed = new Set(processedSessionIds);
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
		try {
			const research = await consolidateResearchRefinementDigestsForProjects(label, researchScopes);
			const semantic = await repairSelectiveReembeddingForResearchScopes(label, researchScopes);
			emitDeepSleepResearchEvents(emitReportedEvent, label, research, semantic);
		} catch {
			/* best-effort */
		}
	}

	return processedSessionIds;
}
