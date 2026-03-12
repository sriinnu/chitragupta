import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";

type ExpandableExperiment = {
	id: string;
	packedContext?: string | null;
};

type ResearchLoopControlState = {
	loopKey: string;
	projectPath: string | null;
	topic: string | null;
	sessionId: string | null;
	sabhaId: string | null;
	workflowId: string | null;
	status: "running" | "cancelling" | "cancelled" | "completed" | "failed";
	startedAt: number;
	updatedAt: number;
	heartbeatAt: number | null;
	cancelRequestedAt: number | null;
	cancelReason: string | null;
	requestedBy: string | null;
	currentRound: number | null;
	totalRounds: number | null;
	attemptNumber: number | null;
	phase: string | null;
	stopReason: string | null;
	finishedAt: number | null;
};

const activeResearchLoops = new Map<string, ResearchLoopControlState>();

function isTerminalStatus(status: ResearchLoopControlState["status"] | undefined): boolean {
	return status === "completed" || status === "cancelled" || status === "failed";
}

function terminalLoopStatus(
	stopReason: string | null,
): "completed" | "failed" | "cancelled" {
	if (stopReason === "cancelled") return "cancelled";
	if (stopReason === "closure-failed" || stopReason === "round-failed" || stopReason === "unsafe-discard") {
		return "failed";
	}
	return "completed";
}

function getLoopState(loopKey: unknown): ResearchLoopControlState | null {
	return typeof loopKey === "string" && loopKey.trim()
		? activeResearchLoops.get(loopKey.trim()) ?? null
		: null;
}

function ensureLoopKey(loopKey: unknown): string {
	if (typeof loopKey !== "string" || !loopKey.trim()) {
		throw new Error("Missing research loop key");
	}
	return loopKey.trim();
}

async function expandPackedContext<T extends ExpandableExperiment>(
	experiment: T,
): Promise<T & { expandedPackedContext?: string | null }> {
	if (!experiment.packedContext?.trim()) return experiment;
	try {
		const { unpackPackedContextText } = await import("@chitragupta/smriti");
		const expanded = await unpackPackedContextText(experiment.packedContext);
		if (expanded.trim() && expanded !== experiment.packedContext) {
			return { ...experiment, expandedPackedContext: expanded };
		}
	} catch {
		// Best-effort: keep the stored packed form when expansion is unavailable.
	}
	return experiment;
}

export function registerResearchMethods(router: RpcRouter): void {
	router.register("research.loops.start", async (params) => {
		const loopKey = ensureLoopKey(params.loopKey);
		const existing = activeResearchLoops.get(loopKey);
		if (existing) {
			if (isTerminalStatus(existing.status)) {
				throw new Error(`Research loop ${loopKey} is already completed; use a new loop key`);
			}
			throw new Error(`Research loop ${loopKey} is already active`);
		}
		const now = Date.now();
		const state: ResearchLoopControlState = {
			loopKey,
			projectPath:
				typeof params.projectPath === "string" ? normalizeProjectPath(params.projectPath) : null,
			topic: typeof params.topic === "string" ? params.topic.trim() : null,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			workflowId: typeof params.workflowId === "string" ? params.workflowId : null,
			status: "running",
			startedAt: now,
			updatedAt: now,
			heartbeatAt: now,
			cancelRequestedAt: null,
			cancelReason: null,
			requestedBy: null,
			currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			phase: typeof params.phase === "string" ? params.phase : null,
			stopReason: null,
			finishedAt: null,
		};
		activeResearchLoops.set(loopKey, state);
		return { state };
	}, "Register or refresh an active overnight research loop in daemon control state");

	router.register("research.loops.heartbeat", async (params) => {
		const loopKey = ensureLoopKey(params.loopKey);
		const existing = activeResearchLoops.get(loopKey);
		if (isTerminalStatus(existing?.status)) {
			return { state: existing };
		}
		const now = Date.now();
		const state: ResearchLoopControlState = {
			loopKey,
			projectPath:
				typeof params.projectPath === "string"
					? normalizeProjectPath(params.projectPath)
					: existing?.projectPath ?? null,
			topic: typeof params.topic === "string" ? params.topic.trim() : existing?.topic ?? null,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : existing?.sessionId ?? null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : existing?.sabhaId ?? null,
			workflowId: typeof params.workflowId === "string" ? params.workflowId : existing?.workflowId ?? null,
			status: existing?.cancelRequestedAt ? "cancelling" : "running",
			startedAt: existing?.startedAt ?? now,
			updatedAt: now,
			heartbeatAt: now,
			cancelRequestedAt: existing?.cancelRequestedAt ?? null,
			cancelReason: existing?.cancelReason ?? null,
			requestedBy: existing?.requestedBy ?? null,
			currentRound: typeof params.currentRound === "number" ? params.currentRound : existing?.currentRound ?? null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : existing?.totalRounds ?? null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : existing?.attemptNumber ?? null,
			phase: typeof params.phase === "string" ? params.phase : existing?.phase ?? null,
			stopReason: existing?.stopReason ?? null,
			finishedAt: existing?.finishedAt ?? null,
		};
		activeResearchLoops.set(loopKey, state);
		return { state };
	}, "Heartbeat an active overnight research loop and surface cancel intent");

	router.register("research.loops.get", async (params) => {
		const state = getLoopState(params.loopKey);
		return { state };
	}, "Get active daemon control state for an overnight research loop");

	router.register("research.loops.cancel", async (params) => {
		const loopKey = ensureLoopKey(params.loopKey);
		const existing = activeResearchLoops.get(loopKey);
		const now = Date.now();
		if (!existing) {
			return { cancelled: false, state: null };
		}
		if (isTerminalStatus(existing.status)) {
			return { cancelled: false, state: existing };
		}
		const state: ResearchLoopControlState = {
			...existing,
			status: "cancelling",
			updatedAt: now,
			cancelRequestedAt: existing.cancelRequestedAt ?? now,
			cancelReason: typeof params.reason === "string" && params.reason.trim()
				? params.reason.trim()
				: existing.cancelReason ?? "operator-interrupt",
			requestedBy: typeof params.requestedBy === "string" && params.requestedBy.trim()
				? params.requestedBy.trim()
				: existing.requestedBy ?? null,
		};
		activeResearchLoops.set(loopKey, state);
		return { cancelled: true, state };
	}, "Request cancellation of an active overnight research loop");

		router.register("research.loops.complete", async (params) => {
			const loopKey = ensureLoopKey(params.loopKey);
			const existing = activeResearchLoops.get(loopKey);
			const now = Date.now();
			const requestedStopReason =
				typeof params.stopReason === "string" ? params.stopReason : existing?.stopReason ?? null;
			const stopReason = existing?.cancelRequestedAt ? "cancelled" : requestedStopReason;
			const state: ResearchLoopControlState = {
			loopKey,
			projectPath: existing?.projectPath ?? null,
			topic: existing?.topic ?? null,
			sessionId: existing?.sessionId ?? null,
			sabhaId: existing?.sabhaId ?? null,
			workflowId: existing?.workflowId ?? null,
			status: terminalLoopStatus(stopReason),
			startedAt: existing?.startedAt ?? now,
			updatedAt: now,
			heartbeatAt: existing?.heartbeatAt ?? null,
			cancelRequestedAt: existing?.cancelRequestedAt ?? null,
			cancelReason: existing?.cancelReason ?? null,
			requestedBy: existing?.requestedBy ?? null,
			currentRound: existing?.currentRound ?? null,
			totalRounds: existing?.totalRounds ?? null,
			attemptNumber: existing?.attemptNumber ?? null,
			phase: "complete",
			stopReason,
			finishedAt: now,
		};
		activeResearchLoops.set(loopKey, state);
		return { state };
	}, "Mark an overnight research loop as completed or cancelled in daemon control state");

	router.register("research.experiments.record", async (params) => {
		const projectPath = normalizeProjectPath(typeof params.projectPath === "string" ? params.projectPath : "");
		const topic = typeof params.topic === "string" ? params.topic.trim() : "";
		const metricName = typeof params.metricName === "string" ? params.metricName.trim() : "";
		const objective = typeof params.objective === "string" ? params.objective.trim() : "";
		const decision = typeof params.decision === "string" ? params.decision.trim() : "";
		const record = params.record && typeof params.record === "object"
			? params.record as Record<string, unknown>
			: null;
		if (!projectPath || !topic || !metricName || !objective || !decision || !record) {
			throw new Error("Missing research experiment fields");
		}

		const { upsertResearchExperiment } = await import("@chitragupta/smriti");
		const payload = {
			projectPath,
			experimentKey:
				typeof params.experimentKey === "string" ? params.experimentKey : null,
			attemptKey:
				typeof params.attemptKey === "string" ? params.attemptKey : null,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : null,
			roundNumber: typeof params.roundNumber === "number" ? params.roundNumber : null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			budgetMs:
				typeof params.budgetMs === "number" ? params.budgetMs : null,
			topic,
			metricName,
			objective,
			decision,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
			sessionLineageKey: typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			councilVerdict: typeof params.councilVerdict === "string" ? params.councilVerdict : null,
			routeClass: typeof params.routeClass === "string" ? params.routeClass : null,
			plannerRouteClass: typeof params.plannerRouteClass === "string" ? params.plannerRouteClass : null,
			plannerSelectedCapabilityId: typeof params.plannerSelectedCapabilityId === "string" ? params.plannerSelectedCapabilityId : null,
			plannerSelectedModelId: typeof params.plannerSelectedModelId === "string" ? params.plannerSelectedModelId : null,
			plannerSelectedProviderId: typeof params.plannerSelectedProviderId === "string" ? params.plannerSelectedProviderId : null,
			executionRouteClass: typeof params.executionRouteClass === "string" ? params.executionRouteClass : null,
				selectedCapabilityId: typeof params.selectedCapabilityId === "string" ? params.selectedCapabilityId : null,
				selectedModelId: typeof params.selectedModelId === "string" ? params.selectedModelId : null,
				selectedProviderId: typeof params.selectedProviderId === "string" ? params.selectedProviderId : null,
				gitBranch: typeof params.gitBranch === "string" ? params.gitBranch : null,
				gitHeadCommit: typeof params.gitHeadCommit === "string" ? params.gitHeadCommit : null,
				gitDirtyBefore: typeof params.gitDirtyBefore === "boolean" ? params.gitDirtyBefore : null,
				gitDirtyAfter: typeof params.gitDirtyAfter === "boolean" ? params.gitDirtyAfter : null,
			baselineMetric: typeof params.baselineMetric === "number" ? params.baselineMetric : null,
			observedMetric: typeof params.observedMetric === "number" ? params.observedMetric : null,
			delta: typeof params.delta === "number" ? params.delta : null,
			status: typeof params.status === "string" ? params.status : null,
			errorMessage: typeof params.errorMessage === "string" ? params.errorMessage : null,
			packedContext: typeof params.packedContext === "string" ? params.packedContext : null,
			packedRuntime: typeof params.packedRuntime === "string" ? params.packedRuntime : null,
			packedSource: typeof params.packedSource === "string" ? params.packedSource : null,
			record,
		} as Parameters<typeof upsertResearchExperiment>[0];
		const experiment = upsertResearchExperiment(payload);
		return { experiment };
	}, "Persist a bounded research experiment record into the canonical engine ledger");

	router.register("research.outcome.record", async (params) => {
		const projectPath = normalizeProjectPath(typeof params.projectPath === "string" ? params.projectPath : "");
		const topic = typeof params.topic === "string" ? params.topic.trim() : "";
		const metricName = typeof params.metricName === "string" ? params.metricName.trim() : "";
		const objective = typeof params.objective === "string" ? params.objective.trim() : "";
		const decision = typeof params.decision === "string" ? params.decision.trim() : "";
		const hypothesis = typeof params.hypothesis === "string" ? params.hypothesis.trim() : "";
		const content = typeof params.traceContent === "string" ? params.traceContent.trim() : "";
		const entry = typeof params.entry === "string" ? params.entry : "";
		const record =
			params.record && typeof params.record === "object"
				? params.record as Record<string, unknown>
				: null;
		if (!projectPath || !topic || !metricName || !objective || !decision || !hypothesis || !content || !entry || !record) {
			throw new Error("Missing research outcome fields");
		}
		const {
			appendMemory,
			AkashaField,
			DatabaseManager,
			upsertResearchExperiment,
		} = await import("@chitragupta/smriti");
		await appendMemory({ type: "project", path: projectPath }, entry, { dedupe: false });
		const db = DatabaseManager.instance().get("agent");
		const akasha = new AkashaField();
		akasha.restore(db);
		const trace = akasha.leave(
			String(params.agentId ?? "prana:autoresearch"),
			decision === "keep" ? "pattern" : "correction",
			topic,
			content,
			typeof params.traceMetadata === "object" && params.traceMetadata !== null && !Array.isArray(params.traceMetadata)
				? params.traceMetadata as Record<string, unknown>
				: undefined,
		);
		akasha.persist(db);
		const payload = {
			projectPath,
			experimentKey:
				typeof params.experimentKey === "string" ? params.experimentKey : null,
			attemptKey:
				typeof params.attemptKey === "string" ? params.attemptKey : null,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : null,
			roundNumber: typeof params.roundNumber === "number" ? params.roundNumber : null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			budgetMs:
				typeof params.budgetMs === "number" ? params.budgetMs : null,
			topic,
			metricName,
			objective,
			decision,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
			sessionLineageKey: typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			councilVerdict: typeof params.councilVerdict === "string" ? params.councilVerdict : null,
			routeClass: typeof params.routeClass === "string" ? params.routeClass : null,
			plannerRouteClass: typeof params.plannerRouteClass === "string" ? params.plannerRouteClass : null,
			plannerSelectedCapabilityId: typeof params.plannerSelectedCapabilityId === "string" ? params.plannerSelectedCapabilityId : null,
			plannerSelectedModelId: typeof params.plannerSelectedModelId === "string" ? params.plannerSelectedModelId : null,
			plannerSelectedProviderId: typeof params.plannerSelectedProviderId === "string" ? params.plannerSelectedProviderId : null,
			executionRouteClass: typeof params.executionRouteClass === "string" ? params.executionRouteClass : null,
				selectedCapabilityId: typeof params.selectedCapabilityId === "string" ? params.selectedCapabilityId : null,
				selectedModelId: typeof params.selectedModelId === "string" ? params.selectedModelId : null,
				selectedProviderId: typeof params.selectedProviderId === "string" ? params.selectedProviderId : null,
				gitBranch: typeof params.gitBranch === "string" ? params.gitBranch : null,
				gitHeadCommit: typeof params.gitHeadCommit === "string" ? params.gitHeadCommit : null,
				gitDirtyBefore: typeof params.gitDirtyBefore === "boolean" ? params.gitDirtyBefore : null,
				gitDirtyAfter: typeof params.gitDirtyAfter === "boolean" ? params.gitDirtyAfter : null,
			baselineMetric: typeof params.baselineMetric === "number" ? params.baselineMetric : null,
			observedMetric: typeof params.observedMetric === "number" ? params.observedMetric : null,
			delta: typeof params.delta === "number" ? params.delta : null,
			status: typeof params.status === "string" ? params.status : null,
			errorMessage: typeof params.errorMessage === "string" ? params.errorMessage : null,
			packedContext: typeof params.packedContext === "string" ? params.packedContext : null,
			packedRuntime: typeof params.packedRuntime === "string" ? params.packedRuntime : null,
			packedSource: typeof params.packedSource === "string" ? params.packedSource : null,
			record,
		} as Parameters<typeof upsertResearchExperiment>[0];
		const experiment = upsertResearchExperiment(payload);
		return {
			recorded: true,
			memoryScope: "project",
			traceId: trace.id,
			experimentId: experiment.id,
			experiment,
		};
	}, "Record research outcome artifacts through the daemon-owned memory and ledger path");

	router.register("research.experiments.list", async (params) => {
		const { listResearchExperiments } = await import("@chitragupta/smriti");
		const experiments = listResearchExperiments({
			projectPath: typeof params.projectPath === "string" ? normalizeProjectPath(params.projectPath) : undefined,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
			decision: typeof params.decision === "string" ? params.decision : undefined,
			limit: parseLimit(params.limit, 10, 100),
		});
		if (params.expandPackedContext !== true) {
			return { experiments };
		}
		return {
			experiments: await Promise.all(experiments.map((experiment) => expandPackedContext(experiment))),
		};
	}, "List bounded research experiments from the canonical engine ledger");

	router.register("research.loops.record", async (params) => {
		const projectPath = normalizeProjectPath(typeof params.projectPath === "string" ? params.projectPath : "");
		const topic = typeof params.topic === "string" ? params.topic.trim() : "";
		const stopReason = typeof params.stopReason === "string" ? params.stopReason.trim() : "";
		const record =
			params.record && typeof params.record === "object"
				? params.record as Record<string, unknown>
				: null;
		if (!projectPath || !topic || !stopReason || !record) {
			throw new Error("Missing research loop summary fields");
		}
		const { upsertResearchLoopSummary } = await import("@chitragupta/smriti");
		const summary = upsertResearchLoopSummary({
			projectPath,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : null,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
			sessionLineageKey: typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			councilVerdict: typeof params.councilVerdict === "string" ? params.councilVerdict : null,
			topic,
			hypothesis: typeof params.hypothesis === "string" ? params.hypothesis : null,
			roundsRequested: typeof params.roundsRequested === "number" ? params.roundsRequested : 0,
			roundsCompleted: typeof params.roundsCompleted === "number" ? params.roundsCompleted : 0,
			stopReason,
			bestMetric: typeof params.bestMetric === "number" ? params.bestMetric : null,
			bestRoundNumber: typeof params.bestRoundNumber === "number" ? params.bestRoundNumber : null,
			noImprovementStreak: typeof params.noImprovementStreak === "number" ? params.noImprovementStreak : null,
			totalDurationMs: typeof params.totalDurationMs === "number" ? params.totalDurationMs : null,
			totalBudgetMs: typeof params.totalBudgetMs === "number" ? params.totalBudgetMs : null,
			keptRounds: typeof params.keptRounds === "number" ? params.keptRounds : null,
			revertedRounds: typeof params.revertedRounds === "number" ? params.revertedRounds : null,
			plannerRouteClass: typeof params.plannerRouteClass === "string" ? params.plannerRouteClass : null,
			plannerSelectedCapabilityId: typeof params.plannerSelectedCapabilityId === "string" ? params.plannerSelectedCapabilityId : null,
			plannerSelectedModelId: typeof params.plannerSelectedModelId === "string" ? params.plannerSelectedModelId : null,
			plannerSelectedProviderId: typeof params.plannerSelectedProviderId === "string" ? params.plannerSelectedProviderId : null,
			executionRouteClass: typeof params.executionRouteClass === "string" ? params.executionRouteClass : null,
			selectedCapabilityId: typeof params.selectedCapabilityId === "string" ? params.selectedCapabilityId : null,
			selectedModelId: typeof params.selectedModelId === "string" ? params.selectedModelId : null,
			selectedProviderId: typeof params.selectedProviderId === "string" ? params.selectedProviderId : null,
			record,
		});
		return { summary };
	}, "Persist an overnight research loop summary into the canonical engine ledger");

	router.register("research.loops.list", async (params) => {
		const { listResearchLoopSummaries } = await import("@chitragupta/smriti");
		const summaries = listResearchLoopSummaries({
			projectPath: typeof params.projectPath === "string" ? normalizeProjectPath(params.projectPath) : undefined,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : undefined,
			updatedAfter: typeof params.updatedAfter === "number" ? params.updatedAfter : undefined,
			updatedBefore: typeof params.updatedBefore === "number" ? params.updatedBefore : undefined,
			limit: parseLimit(params.limit, 10, 200),
		});
		return { summaries };
	}, "List overnight research loop summaries from the canonical engine ledger");
}
