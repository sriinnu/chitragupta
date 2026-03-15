import type {
	ResearchNidraBudgetOverride,
	ResearchRefinementBudgetOverride,
} from "@chitragupta/smriti";

/** Scope one refinement digest pass to a project and optional session lineage. */
export interface ResearchRefinementProjectScope {
	projectPath: string;
	sessionIds?: readonly string[];
	sessionLineageKeys?: readonly string[];
	/**
	 * Priority score for daemon-owned refinement budgeting.
	 *
	 * I treat this as a bounded severity signal derived from overnight loop
	 * outcomes so Nidra/postprocess can spend limited repair budget on the
	 * highest-value research scopes first.
	 */
	priorityScore?: number;
	/** Stable optimizer-policy fingerprints observed in the scoped loop summaries. */
	policyFingerprints?: readonly string[];
	/** Primary objective ids seen in the scoped optimizer snapshots. */
	primaryObjectiveIds?: readonly string[];
	/** Primary stop-condition ids observed in the scoped loop summaries. */
	primaryStopConditionIds?: readonly string[];
	/** Primary stop-condition kinds observed in the scoped loop summaries. */
	primaryStopConditionKinds?: readonly string[];
	/** Strongest scalar optimizer score preserved from the scoped frontier. */
	frontierBestScore?: number;
	/** Widest loop-derived semantic refinement budget seen in this scope. */
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	/** Widest loop-derived Nidra project budget seen in this scope. */
	nidraBudget?: ResearchNidraBudgetOverride | null;
}

/** Build the half-open epoch range covering one calendar day. */
export function buildResearchDayEpochRange(date: string): { start: number; end: number } {
	const start = new Date(`${date}T00:00:00`).getTime();
	return { start, end: start + 24 * 60 * 60 * 1000 };
}

/** Match loop/experiment rows against the explicit project-scoped refinement filter. */
export function matchesResearchScopeSession(
	value: { sessionId?: string | null; parentSessionId?: string | null; sessionLineageKey?: string | null },
	sessionIds: ReadonlySet<string>,
	sessionLineageKeys: ReadonlySet<string>,
): boolean {
	if (sessionIds.size === 0 && sessionLineageKeys.size === 0) return true;
	return (
		sessionIds.has(value.sessionId ?? "")
		|| sessionIds.has(value.parentSessionId ?? "")
		|| sessionLineageKeys.has(value.sessionLineageKey ?? "")
	);
}

function mergeWiderCap(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.max(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

function mergeWiderFloor(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.min(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

function mergeRefinementBudget(
	left?: ResearchRefinementBudgetOverride | null,
	right?: ResearchRefinementBudgetOverride | null,
): ResearchRefinementBudgetOverride | undefined {
	if (!left && !right) return undefined;
	return {
		dailyCandidateLimit: mergeWiderCap(left?.dailyCandidateLimit, right?.dailyCandidateLimit),
		projectCandidateLimit: mergeWiderCap(left?.projectCandidateLimit, right?.projectCandidateLimit),
		dailyMinMdlScore: mergeWiderFloor(left?.dailyMinMdlScore, right?.dailyMinMdlScore),
		projectMinMdlScore: mergeWiderFloor(left?.projectMinMdlScore, right?.projectMinMdlScore),
		dailyMinPriorityScore: mergeWiderFloor(left?.dailyMinPriorityScore, right?.dailyMinPriorityScore),
		projectMinPriorityScore: mergeWiderFloor(left?.projectMinPriorityScore, right?.projectMinPriorityScore),
		dailyMinSourceSessionCount: mergeWiderFloor(left?.dailyMinSourceSessionCount, right?.dailyMinSourceSessionCount),
		projectMinSourceSessionCount: mergeWiderFloor(left?.projectMinSourceSessionCount, right?.projectMinSourceSessionCount),
	};
}

function mergeNidraBudget(
	left?: ResearchNidraBudgetOverride | null,
	right?: ResearchNidraBudgetOverride | null,
): ResearchNidraBudgetOverride | undefined {
	if (!left && !right) return undefined;
	return {
		maxResearchProjectsPerCycle: mergeWiderCap(left?.maxResearchProjectsPerCycle, right?.maxResearchProjectsPerCycle),
		maxSemanticPressure: mergeWiderCap(left?.maxSemanticPressure, right?.maxSemanticPressure),
	};
}

/** Merge duplicate project scopes so the daemon refines each project once per pass. */
export function mergeResearchRefinementScopes(
	scopes: readonly ResearchRefinementProjectScope[],
): ResearchRefinementProjectScope[] {
	const merged = new Map<string, {
		sessionIds: Set<string>;
		sessionLineageKeys: Set<string>;
		priorityScore?: number;
		policyFingerprints: Set<string>;
		primaryObjectiveIds: Set<string>;
		primaryStopConditionIds: Set<string>;
		primaryStopConditionKinds: Set<string>;
		frontierBestScore?: number;
		refinementBudget?: ResearchRefinementBudgetOverride;
		nidraBudget?: ResearchNidraBudgetOverride;
	}>();
	for (const scope of scopes) {
		const projectPath = scope.projectPath.trim();
		if (!projectPath) continue;
		const bucket = merged.get(projectPath) ?? {
			sessionIds: new Set<string>(),
			sessionLineageKeys: new Set<string>(),
			priorityScore: undefined,
			policyFingerprints: new Set<string>(),
			primaryObjectiveIds: new Set<string>(),
			primaryStopConditionIds: new Set<string>(),
			primaryStopConditionKinds: new Set<string>(),
			frontierBestScore: undefined,
			refinementBudget: undefined,
			nidraBudget: undefined,
		};
		for (const sessionId of scope.sessionIds ?? []) {
			const normalized = sessionId.trim();
			if (normalized) bucket.sessionIds.add(normalized);
		}
		for (const lineageKey of scope.sessionLineageKeys ?? []) {
			const normalized = lineageKey.trim();
			if (normalized) bucket.sessionLineageKeys.add(normalized);
		}
		if (typeof scope.priorityScore === "number" && Number.isFinite(scope.priorityScore)) {
			// I keep the strongest project pressure so a weaker duplicate scope
			// cannot lower the daemon's refinement urgency for that project.
			bucket.priorityScore = Math.max(bucket.priorityScore ?? 0, scope.priorityScore);
		}
		for (const fingerprint of scope.policyFingerprints ?? []) {
			const normalized = fingerprint.trim();
			if (normalized) bucket.policyFingerprints.add(normalized);
		}
		for (const objectiveId of scope.primaryObjectiveIds ?? []) {
			const normalized = objectiveId.trim();
			if (normalized) bucket.primaryObjectiveIds.add(normalized);
		}
		for (const stopConditionId of scope.primaryStopConditionIds ?? []) {
			const normalized = stopConditionId.trim();
			if (normalized) bucket.primaryStopConditionIds.add(normalized);
		}
		for (const stopConditionKind of scope.primaryStopConditionKinds ?? []) {
			const normalized = stopConditionKind.trim();
			if (normalized) bucket.primaryStopConditionKinds.add(normalized);
		}
		if (typeof scope.frontierBestScore === "number" && Number.isFinite(scope.frontierBestScore)) {
			bucket.frontierBestScore = Math.max(bucket.frontierBestScore ?? 0, scope.frontierBestScore);
		}
		bucket.refinementBudget = mergeRefinementBudget(bucket.refinementBudget, scope.refinementBudget);
		bucket.nidraBudget = mergeNidraBudget(bucket.nidraBudget, scope.nidraBudget);
		merged.set(projectPath, bucket);
	}
	return [...merged.entries()].map(([projectPath, bucket]) => ({
		projectPath,
		sessionIds: [...bucket.sessionIds],
		sessionLineageKeys: [...bucket.sessionLineageKeys],
		priorityScore:
			typeof (bucket as { priorityScore?: number }).priorityScore === "number"
				? (bucket as { priorityScore: number }).priorityScore
				: undefined,
		policyFingerprints: [...bucket.policyFingerprints],
		primaryObjectiveIds: [...bucket.primaryObjectiveIds],
		primaryStopConditionIds: [...bucket.primaryStopConditionIds],
		primaryStopConditionKinds: [...bucket.primaryStopConditionKinds],
		frontierBestScore:
			typeof bucket.frontierBestScore === "number" ? bucket.frontierBestScore : undefined,
		refinementBudget: bucket.refinementBudget,
		nidraBudget: bucket.nidraBudget,
	}));
}
