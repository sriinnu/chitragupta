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

/** Merge duplicate project scopes so the daemon refines each project once per pass. */
export function mergeResearchRefinementScopes(
	scopes: readonly ResearchRefinementProjectScope[],
): ResearchRefinementProjectScope[] {
	const merged = new Map<string, {
		sessionIds: Set<string>;
		sessionLineageKeys: Set<string>;
		priorityScore?: number;
	}>();
	for (const scope of scopes) {
		const projectPath = scope.projectPath.trim();
		if (!projectPath) continue;
		const bucket = merged.get(projectPath) ?? {
			sessionIds: new Set<string>(),
			sessionLineageKeys: new Set<string>(),
			priorityScore: undefined,
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
	}));
}
