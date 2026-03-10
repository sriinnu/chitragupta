/**
 * Daemon-backed research council helpers.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import {
	buildSyllogism,
	type ResearchCouncilSummary,
	type ResearchScope,
	summarizeCouncilParticipants,
	validateScope,
} from "./chitragupta-nodes-research-shared.js";
import {
	type LucyGuidance,
	type ResearchRouteSummary,
	councilLucyRecommendation,
	fetchLucyGuidance,
	buildCouncilSummary,
	packLiveResearchSignalText,
	requireResolvedResearchRoute,
	scopeRecommendation,
	toResearchRouteSummary,
	type BatchResolvedRoute,
	type DaemonClientLike,
	withDaemonClient,
} from "./chitragupta-nodes-research-daemon-shared.js";

export {
	councilLucyRecommendation,
	fetchLucyGuidance,
	withDaemonClient,
};
export type {
	LucyGuidance,
	ResearchRouteSummary,
	DaemonClientLike,
};

async function ensureResearchSession(client: DaemonClientLike, scope: ResearchScope): Promise<string | null> {
	const opened = await client.call("session.open", {
		project: scope.projectPath,
		title: `Autoresearch: ${scope.topic}`,
		agent: "prana:autoresearch",
		parentSessionId: scope.parentSessionId ?? undefined,
		sessionLineageKey: scope.sessionLineageKey ?? undefined,
		consumer: "prana",
		surface: "research",
		channel: "workflow",
		actorId: "prana:autoresearch",
		metadata: {
			workflow: "autoresearch",
			bounded: true,
			projectPath: scope.projectPath,
			cwd: scope.cwd,
			targetFiles: scope.targetFiles,
			immutableFiles: scope.immutableFiles,
			budgetMs: scope.budgetMs,
		},
	}) as {
		session?: { meta?: { id?: unknown } };
	};
	const id = opened?.session?.meta?.id;
	return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function resolveResearchRoute(
	client: DaemonClientLike,
	scope: ResearchScope,
	sessionId: string | null,
): Promise<ResearchRouteSummary | null> {
	if (!sessionId) return null;
	const resolved = await client.call("route.resolve", {
		consumer: "prana:autoresearch",
		sessionId,
		routeClass: "research.bounded",
		context: {
			topic: scope.topic,
			projectPath: scope.projectPath,
			cwd: scope.cwd,
			targetFiles: scope.targetFiles,
			immutableFiles: scope.immutableFiles,
			budgetMs: scope.budgetMs,
			metricName: scope.metricName,
		},
	}) as {
		request?: { capability?: unknown };
		selected?: { id?: unknown } | null;
		routeClass?: { id?: unknown; capability?: unknown } | null;
		executionBinding?: BatchResolvedRoute["executionBinding"];
		degraded?: unknown;
		discoverableOnly?: unknown;
		reason?: unknown;
		policyTrace?: unknown;
	};
	return toResearchRouteSummary(resolved, "research.bounded");
}

async function resolveResearchExecutionRoute(
	client: DaemonClientLike,
	scope: ResearchScope,
	sessionId: string | null,
): Promise<ResearchRouteSummary | null> {
	if (!sessionId) return null;
	const resolved = await client.call("route.resolve", {
		consumer: "prana:autoresearch",
		sessionId,
		routeClass: scope.executionRouteClass,
		capability: scope.executionCapability ?? undefined,
		context: {
			topic: scope.topic,
			projectPath: scope.projectPath,
			cwd: scope.cwd,
			targetFiles: scope.targetFiles,
			immutableFiles: scope.immutableFiles,
			budgetMs: scope.budgetMs,
			metricName: scope.metricName,
			workflow: "autoresearch",
		},
	}) as {
		request?: { capability?: unknown };
		selected?: { id?: unknown } | null;
		routeClass?: { id?: unknown; capability?: unknown } | null;
		executionBinding?: BatchResolvedRoute["executionBinding"];
		degraded?: unknown;
		discoverableOnly?: unknown;
		reason?: unknown;
		policyTrace?: unknown;
	};
	return toResearchRouteSummary(resolved, scope.executionRouteClass, scope.executionCapability);
}

async function resolveResearchRouteBatch(
	client: DaemonClientLike,
	scope: ResearchScope,
	sessionId: string | null,
): Promise<{ route: ResearchRouteSummary | null; executionRoute: ResearchRouteSummary | null }> {
	if (!sessionId) return { route: null, executionRoute: null };
	try {
		const resolved = await client.call("route.resolveBatch", {
			consumer: "prana:autoresearch",
			sessionId,
			routes: [
				{
					key: "research",
					routeClass: "research.bounded",
					context: {
						topic: scope.topic,
						projectPath: scope.projectPath,
						cwd: scope.cwd,
						targetFiles: scope.targetFiles,
						immutableFiles: scope.immutableFiles,
						budgetMs: scope.budgetMs,
						metricName: scope.metricName,
					},
				},
				{
					key: "execution",
					routeClass: scope.executionRouteClass,
					capability: scope.executionCapability ?? undefined,
					context: {
						topic: scope.topic,
						projectPath: scope.projectPath,
						cwd: scope.cwd,
						targetFiles: scope.targetFiles,
						immutableFiles: scope.immutableFiles,
						budgetMs: scope.budgetMs,
						metricName: scope.metricName,
						workflow: "autoresearch",
					},
				},
			],
		}) as { resolutions?: BatchResolvedRoute[] };
		const researchResolution = Array.isArray(resolved.resolutions)
			? resolved.resolutions.find((entry) => entry?.key === "research")
			: null;
		const executionResolution = Array.isArray(resolved.resolutions)
			? resolved.resolutions.find((entry) => entry?.key === "execution")
			: null;
		return {
			route: toResearchRouteSummary(researchResolution, "research.bounded"),
			executionRoute: toResearchRouteSummary(executionResolution, scope.executionRouteClass, scope.executionCapability),
		};
	} catch {
		return {
			route: await resolveResearchRoute(client, scope, sessionId),
			executionRoute: await resolveResearchExecutionRoute(client, scope, sessionId),
		};
	}
}

export async function runResearchCouncil(scope: ResearchScope): Promise<ResearchCouncilSummary> {
	validateScope(scope);
	const lucy = await fetchLucyGuidance(scope);
	const participants = summarizeCouncilParticipants();
	const recommendation = scopeRecommendation(lucy.liveSignals);
	const daemonCouncil = await withDaemonClient(async (client) => {
		const sessionId = await ensureResearchSession(client, scope);
		if (!sessionId) {
			throw new Error("Research route authorization unavailable: daemon session.open did not return a canonical session id.");
		}
		const resolvedRoutes = await resolveResearchRouteBatch(client, scope, sessionId);
		const route = requireResolvedResearchRoute(
			resolvedRoutes.route,
			"Research route authorization unavailable: route.resolve did not return the bounded research lane.",
		);
		if (route.discoverableOnly || route.selectedCapabilityId !== "engine.research.autoresearch") {
			throw new Error(
				`Research route authorization unavailable: expected engine.research.autoresearch, got ${route.selectedCapabilityId ?? "none"}.`,
			);
		}
		const executionRoute = resolvedRoutes.executionRoute;
		const asked = await client.call("sabha.ask", {
			question: scope.topic,
			convener: "prana:autoresearch",
			participants,
			project: scope.projectPath,
			sessionId,
		}) as { sabha: { id: string; topic: string } };
		await client.call("sabha.deliberate", {
			id: asked.sabha.id,
			proposerId: "planner",
			proposal: buildSyllogism(scope),
			challenges: lucy.liveSignals.length > 0
				? [{
					challengerId: "skeptic",
					targetStep: "hetu",
					challenge: lucy.hit?.entity
						? `Explain why this experiment should proceed despite Lucy/Scarlett warning on ${lucy.hit.entity}.`
						: "Explain why the council should proceed while live warnings are present.",
				}]
				: [],
		});
		if (lucy.liveSignals.length > 0) {
			const liveSummary = lucy.hit?.content ?? "Live guidance reported regression pressure.";
			const packedLiveSummary = await packLiveResearchSignalText(liveSummary);
			const liveReasoning = lucy.liveSignals
				.map((signal) => String(signal.description ?? signal.errorSignature ?? "warning"))
				.join(" | ");
			const packedReasoning = await packLiveResearchSignalText(liveReasoning);
			await client.call("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "skeptic",
				summary: packedLiveSummary,
				reasoning: packedReasoning,
				position: recommendation === "block" ? "oppose" : "abstain",
				recommendedAction: recommendation === "block"
					? "Block the experiment until the critical signal clears."
					: "Proceed cautiously and preserve provenance.",
				evidence: lucy.predictions.slice(0, 3).map((prediction) => ({
					label: prediction.entity,
					detail: `${prediction.source}:${prediction.confidence.toFixed(2)}`,
				})),
			});
		}
		const votingPlan = recommendation === "block"
			? [
				["planner", "oppose", "Scope is bounded, but the live risk signal blocks execution."],
				["executor", "oppose", "Execution should not proceed while critical subsystem warnings are active."],
				["evaluator", "oppose", "A measured result is not trustworthy under current live conditions."],
				["skeptic", "oppose", "Lucy/Scarlett surfaced blocking conditions."],
				["recorder", "abstain", "Record the blocked attempt for later retry."],
			]
			: [
				["planner", "support", "The experiment is bounded and the hypothesis is explicit."],
				["executor", recommendation === "caution" ? "abstain" : "support", recommendation === "caution"
					? "Proceed with caution and preserve provenance."
					: "Execution can proceed inside the hard timeout and file scope."],
				["evaluator", "support", "The metric and keep/discard rule are explicit."],
				["skeptic", recommendation === "caution" ? "oppose" : "abstain", recommendation === "caution"
					? "Live warnings warrant skepticism before trusting the outcome."
					: "No blocking contradiction remains after scope review."],
				["recorder", "support", "Outcome and provenance will be persisted through the daemon."],
			];
		for (const [participantId, position, reasoning] of votingPlan.slice(0, -1)) {
			await client.call("sabha.vote", { id: asked.sabha.id, participantId, position, reasoning });
		}
		const concluded = await client.call("sabha.vote", {
			id: asked.sabha.id,
			participantId: votingPlan[votingPlan.length - 1]?.[0],
			position: votingPlan[votingPlan.length - 1]?.[1],
			reasoning: votingPlan[votingPlan.length - 1]?.[2],
			conclude: true,
		}) as {
			sabha: {
				id: string;
				topic: string;
				finalVerdict: string;
				rounds: Array<{ roundNumber: number; verdict: string }>;
				currentRound?: { allChallenges?: unknown[]; voteSummary?: { count: number } };
			};
		};
		return {
			...buildCouncilSummary(
				asked.sabha.id,
				concluded.sabha.finalVerdict,
				lucy,
				"daemon",
				sessionId,
				route,
				executionRoute,
			),
			topic: asked.sabha.topic,
			rounds: concluded.sabha.rounds.length,
			councilSummary: concluded.sabha.rounds.map((round) => ({
				roundNumber: round.roundNumber,
				verdict: round.verdict,
				voteCount: concluded.sabha.currentRound?.voteSummary?.count ?? participants.length,
				challengeCount: concluded.sabha.currentRound?.allChallenges?.length ?? 0,
			})),
		};
	});
	if (daemonCouncil) return daemonCouncil;

	const { SabhaEngine } = await dynamicImport("@chitragupta/sutra");
	const engine = new SabhaEngine({ autoEscalate: false, maxParticipants: participants.length });
	const sabha = engine.convene(scope.topic, "prana:autoresearch", participants);
	engine.propose(sabha.id, "planner", buildSyllogism(scope));
	if (recommendation !== "support") {
		engine.challenge(
			sabha.id,
			"skeptic",
			"hetu",
			lucy.hit?.entity
				? `Explain why this experiment should proceed despite warning on ${lucy.hit.entity}.`
				: "Explain why the experiment should proceed despite live warnings.",
		);
		engine.respond(
			sabha.id,
			0,
			recommendation === "block"
				? "The fallback council blocks execution under current live conditions."
				: "Fallback council will preserve provenance if it proceeds.",
		);
	}
	if (recommendation === "block") {
		engine.vote(sabha.id, "planner", "oppose", "Live signals block execution.");
		engine.vote(sabha.id, "executor", "oppose", "Execution should not proceed under critical signals.");
		engine.vote(sabha.id, "evaluator", "oppose", "Evaluation would be noisy under critical conditions.");
		engine.vote(sabha.id, "skeptic", "oppose", "Live guidance is blocking.");
		engine.vote(sabha.id, "recorder", "abstain", "Persist the blocked attempt.");
	} else {
		engine.vote(sabha.id, "planner", "support", "The experiment is bounded.");
		engine.vote(sabha.id, "executor", recommendation === "caution" ? "abstain" : "support", "Execution respects scope and timeout.");
		engine.vote(sabha.id, "evaluator", "support", "The metric and decision rule are explicit.");
		engine.vote(sabha.id, "skeptic", recommendation === "caution" ? "oppose" : "abstain", "Warnings are noted in the record.");
		engine.vote(sabha.id, "recorder", "support", "Record with provenance.");
	}
	const concluded = engine.conclude(sabha.id) as {
		id: string;
		topic: string;
		finalVerdict: string;
		rounds: Array<{ roundNumber: number; verdict: string; votes: unknown[]; challenges: unknown[] }>;
	};
	return {
		...buildCouncilSummary(concluded.id, concluded.finalVerdict, lucy, "local-fallback"),
		topic: concluded.topic,
		rounds: concluded.rounds.length,
		councilSummary: concluded.rounds.map((round) => ({
			roundNumber: round.roundNumber,
			verdict: round.verdict,
			voteCount: round.votes.length,
			challengeCount: round.challenges.length,
		})),
	};
}
