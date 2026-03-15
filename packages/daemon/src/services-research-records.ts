import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";
import {
	type ResearchNidraBudgetOverride,
	triggerImmediateResearchRefinement,
	type ResearchRefinementBudgetOverride,
} from "./services-research-refinement.js";

type ExpandableExperiment = {
	id: string;
	packedContext?: string | null;
};

/**
 * Best-effort expansion of packed experiment context for operator reads.
 *
 * I keep this read-path helper non-authoritative: failure to unpack must not
 * block ledger reads or mutate the stored experiment payload.
 */
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

/**
 * Translate persisted experiment metadata into the daemon refinement-budget
 * override shape. I keep this narrow so invalid or partial experiment records
 * degrade to "no override" instead of widening the daemon policy surface.
 */
function parseRefinementBudgetOverride(
	record: Record<string, unknown>,
): {
	refinement?: ResearchRefinementBudgetOverride;
	nidra?: ResearchNidraBudgetOverride;
} | null {
	const updateBudgets =
		record.updateBudgets && typeof record.updateBudgets === "object"
			? record.updateBudgets as Record<string, unknown>
			: null;
	const refinement =
		updateBudgets?.refinement && typeof updateBudgets.refinement === "object"
			? updateBudgets.refinement as Record<string, unknown>
			: null;
	const nidra =
		updateBudgets?.nidra && typeof updateBudgets.nidra === "object"
			? updateBudgets.nidra as Record<string, unknown>
			: null;
	const parsedRefinement = refinement
		? {
			dailyCandidateLimit:
				typeof refinement.dailyCandidateLimit === "number" ? refinement.dailyCandidateLimit : undefined,
			projectCandidateLimit:
				typeof refinement.projectCandidateLimit === "number" ? refinement.projectCandidateLimit : undefined,
			dailyMinMdlScore:
				typeof refinement.dailyMinMdlScore === "number" ? refinement.dailyMinMdlScore : undefined,
			projectMinMdlScore:
				typeof refinement.projectMinMdlScore === "number" ? refinement.projectMinMdlScore : undefined,
			dailyMinPriorityScore:
				typeof refinement.dailyMinPriorityScore === "number" ? refinement.dailyMinPriorityScore : undefined,
			projectMinPriorityScore:
				typeof refinement.projectMinPriorityScore === "number" ? refinement.projectMinPriorityScore : undefined,
			dailyMinSourceSessionCount:
				typeof refinement.dailyMinSourceSessionCount === "number" ? refinement.dailyMinSourceSessionCount : undefined,
			projectMinSourceSessionCount:
				typeof refinement.projectMinSourceSessionCount === "number" ? refinement.projectMinSourceSessionCount : undefined,
		}
		: null;
	const parsedNidra = nidra
		? {
			maxResearchProjectsPerCycle:
				typeof nidra.maxResearchProjectsPerCycle === "number" ? nidra.maxResearchProjectsPerCycle : undefined,
			maxSemanticPressure:
				typeof nidra.maxSemanticPressure === "number" ? nidra.maxSemanticPressure : undefined,
		}
		: null;
	if (!parsedRefinement && !parsedNidra) return null;
	return {
		refinement: parsedRefinement ?? undefined,
		nidra: parsedNidra ?? undefined,
	};
}

/**
 * Normalize the subset of outcome-processing state that must survive retries.
 *
 * I keep this explicit so the daemon can tell the difference between
 * "trace already exists" and "the full semantic repair/queue side effects
 * already completed". Only the second case is a true no-op on replay.
 */
function parseOutcomeReplayState(record: Record<string, unknown>): {
	traceId: string | null;
	recordedAt: number | null;
	semanticRepairRecorded: boolean;
	queuedSemanticRefinement: boolean;
	semanticRepair: Record<string, unknown> | null;
} {
	return {
		traceId: typeof record.traceId === "string" ? record.traceId : null,
		recordedAt: typeof record.recordedAt === "number" && Number.isFinite(record.recordedAt)
			? record.recordedAt
			: null,
		semanticRepairRecorded: record.semanticRepairRecorded === true,
		queuedSemanticRefinement: record.queuedSemanticRefinement === true,
		semanticRepair:
			record.semanticRepair && typeof record.semanticRepair === "object" && !Array.isArray(record.semanticRepair)
				? record.semanticRepair as Record<string, unknown>
				: null,
	};
}

/**
 * Queue a deferred research-refinement request when the immediate semantic
 * repair pass could not finish cleanly.
 */
async function queueDeferredResearchRefinement(args: {
	projectPath: string;
	date: string;
	sessionId: string | null;
	sessionLineageKey: string | null;
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	nidraBudget?: ResearchNidraBudgetOverride | null;
	repairIntent?: {
		daily?: Record<string, unknown> | null;
		project?: Record<string, unknown> | null;
	} | null;
	lastError?: string | null;
}): Promise<boolean> {
	const { upsertResearchRefinementQueue } = await import("@chitragupta/smriti");
	// I only persist normalized project/session scope here. The daemon re-derives
	// temporal windows later so queue entries stay stable across day-boundary
	// retries and do not encode stale derived periods.
	const queued = upsertResearchRefinementQueue([{
		label: args.date,
		projectPath: args.projectPath,
		sessionIds: args.sessionId ? [args.sessionId] : [],
		sessionLineageKeys: args.sessionLineageKey ? [args.sessionLineageKey] : [],
		refinementBudget: args.refinementBudget ?? null,
		nidraBudget: args.nidraBudget ?? null,
		repairIntent: args.repairIntent ?? null,
	}], {
		notBefore: Date.now(),
		lastError: args.lastError ?? null,
	});
	return queued > 0;
}

/**
 * Register research ledger and outcome methods.
 *
 * These writes are daemon-owned and canonical. They persist experiment rounds,
 * loop summaries, and bounded semantic repair follow-up without creating a
 * second authority in Prana or Takumi.
 */
export function registerResearchLedgerMethods(router: RpcRouter): void {
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
			experimentKey: typeof params.experimentKey === "string" ? params.experimentKey : null,
			attemptKey: typeof params.attemptKey === "string" ? params.attemptKey : null,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : null,
			roundNumber: typeof params.roundNumber === "number" ? params.roundNumber : null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			budgetMs: typeof params.budgetMs === "number" ? params.budgetMs : null,
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
		const payload = {
			projectPath,
			experimentKey: typeof params.experimentKey === "string" ? params.experimentKey : null,
			attemptKey: typeof params.attemptKey === "string" ? params.attemptKey : null,
			loopKey: typeof params.loopKey === "string" ? params.loopKey : null,
			roundNumber: typeof params.roundNumber === "number" ? params.roundNumber : null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			budgetMs: typeof params.budgetMs === "number" ? params.budgetMs : null,
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
		const existingExperiment = upsertResearchExperiment(payload);
		const existingRecord =
			existingExperiment.record && typeof existingExperiment.record === "object"
				? existingExperiment.record as Record<string, unknown>
				: {};
		const replayState = parseOutcomeReplayState(existingRecord);
		if (replayState.traceId && replayState.semanticRepairRecorded) {
			return {
				recorded: true,
				memoryScope: "project",
				traceId: replayState.traceId,
				experimentId: existingExperiment.id,
				experiment: existingExperiment,
				...(replayState.semanticRepair ? { semanticRepair: replayState.semanticRepair } : {}),
				queuedSemanticRefinement: replayState.queuedSemanticRefinement,
			};
		}

		let traceId = replayState.traceId;
		if (!traceId) {
			await appendMemory({ type: "project", path: projectPath }, entry, { dedupe: true });
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
			traceId = trace.id;
		}
		const recordedAt = replayState.recordedAt ?? Date.now();
		const semanticRepair = await triggerImmediateResearchRefinement(projectPath, {
			date: new Date(recordedAt).toISOString().slice(0, 10),
			decision,
			status: typeof params.status === "string" ? params.status : null,
			updateBudgets: parseRefinementBudgetOverride(record),
		});
		const budgetOverride = parseRefinementBudgetOverride(record);
		const refinementBudgetOverride = budgetOverride?.refinement ?? null;
		const repairIntent = await (async () => {
			const { buildImmediateResearchRefinementRequests } = await import("@chitragupta/smriti");
			return buildImmediateResearchRefinementRequests({
				projectPath,
				date: new Date(recordedAt).toISOString().slice(0, 10),
				elevatedSignal:
					decision === "keep"
					|| (typeof params.status === "string" && (
						params.status === "round-failed"
						|| params.status === "closure-failed"
						|| params.status === "control-plane-lost"
						|| params.status === "unsafe-discard"
					)),
				override: refinementBudgetOverride,
			});
		})();
		// I always try the immediate daemon-owned repair first. The durable queue
		// only becomes active when the repair degraded or still reports quality
		// debt that must survive into the next daemon sweep.
		const queuedSemanticRefinement =
			semanticRepair.status === "degraded"
			|| semanticRepair.daily.qualityDeferred > 0
			|| semanticRepair.project.qualityDeferred > 0
				? await queueDeferredResearchRefinement({
					projectPath,
					date: new Date(recordedAt).toISOString().slice(0, 10),
					sessionId: payload.sessionId ?? null,
					sessionLineageKey: payload.sessionLineageKey ?? null,
					refinementBudget: budgetOverride?.refinement ?? null,
					nidraBudget: budgetOverride?.nidra ?? null,
					repairIntent,
					lastError: semanticRepair.status === "degraded" ? semanticRepair.error ?? null : null,
				})
				: false;
		const experiment = upsertResearchExperiment({
			...payload,
			record: {
				...record,
				traceId,
				memoryEntryRecorded: true,
				recordedAt,
				semanticRepairRecorded: true,
				semanticRepair,
				queuedSemanticRefinement,
			},
		});
		return {
			recorded: true,
			memoryScope: "project",
			traceId,
			experimentId: experiment.id,
			experiment,
			semanticRepair,
			queuedSemanticRefinement,
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
