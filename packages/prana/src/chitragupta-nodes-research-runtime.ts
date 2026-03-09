/**
 * Daemon-first runtime helpers for research workflows.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import {
	buildResearchRecord,
	buildSyllogism,
	type ResearchCouncilSummary,
	type ResearchScope,
	summarizeCouncilParticipants,
	validateScope,
} from "./chitragupta-nodes-research-shared.js";
export {
	executeResearchRun,
	evaluateResearchResult,
} from "./chitragupta-nodes-research-runner.js";

type DaemonClientLike = {
	call(method: string, params?: Record<string, unknown>): Promise<unknown>;
	disconnect(): void;
};

type LucyGuidance = {
	hit: { entity: string; content: string; source: string } | null;
	predictions: Array<{ entity: string; confidence: number; source: string }>;
	liveSignals: Array<Record<string, unknown>>;
};

type ResearchRouteSummary = {
	routeClass: string | null;
	capability: string | null;
	selectedCapabilityId: string | null;
	degraded: boolean;
	discoverableOnly: boolean;
	reason: string | null;
	policyTrace: string[];
};

function requireResolvedResearchRoute(
	route: ResearchRouteSummary | null,
	message: string,
): ResearchRouteSummary {
	if (!route) throw new Error(message);
	return route;
}

function councilLucyRecommendation(council: Record<string, unknown>): string {
	if (typeof council.lucyRecommendation === "string") return council.lucyRecommendation;
	const lucy = council.lucy;
	if (lucy && typeof lucy === "object") {
		const recommendation = (lucy as { recommendation?: unknown }).recommendation;
		if (typeof recommendation === "string") return recommendation;
	}
	return "unknown";
}

function scopeRecommendation(signals: Array<Record<string, unknown>>): "support" | "caution" | "block" {
	const severities = signals.map((signal) => String(signal.severity ?? "warning").toLowerCase());
	if (severities.includes("critical")) return "block";
	if (severities.includes("warning")) return "caution";
	return "support";
}

async function createDaemonClient(): Promise<DaemonClientLike | null> {
	try {
		const daemon = await dynamicImport("@chitragupta/daemon");
		const client = await daemon.createClient({ heartbeat: false });
		return client as DaemonClientLike;
	} catch {
		return null;
	}
}

async function withDaemonClient<T>(
	fn: (client: DaemonClientLike) => Promise<T>,
): Promise<T | null> {
	const client = await createDaemonClient();
	if (!client) return null;
	try {
		return await fn(client);
	} finally {
		client.disconnect();
	}
}

export async function fetchLucyGuidance(scope: ResearchScope): Promise<LucyGuidance> {
	const daemonGuidance = await withDaemonClient(async (client) =>
		client.call("lucy.live_context", {
			query: scope.topic,
			project: scope.projectPath,
			limit: 5,
		}) as Promise<LucyGuidance>,
	);
	if (daemonGuidance) return daemonGuidance;
	return { hit: null, predictions: [], liveSignals: [] };
}

function buildCouncilSummary(
	sabhaId: string,
	finalVerdict: string,
	lucy: LucyGuidance,
	source: "daemon" | "local-fallback",
	sessionId: string | null = null,
	route: ResearchRouteSummary | null = null,
	executionRoute: ResearchRouteSummary | null = null,
): ResearchCouncilSummary {
	const participants = summarizeCouncilParticipants();
	return {
		sabhaId,
		sessionId,
		topic: "",
		participantCount: participants.length,
		participants,
		finalVerdict,
		rounds: 1,
		councilSummary: [
			{
				roundNumber: 1,
				verdict: finalVerdict,
				voteCount: participants.length,
				challengeCount: lucy.liveSignals.length > 0 ? 1 : 0,
			},
		],
		lucy: {
			hitEntity: lucy.hit?.entity ?? null,
			predictionCount: lucy.predictions.length,
			criticalSignalCount: lucy.liveSignals.filter(
				(signal) => String(signal.severity ?? "warning").toLowerCase() === "critical",
			).length,
			recommendation: scopeRecommendation(lucy.liveSignals),
		},
		route,
		executionRoute,
		source,
	};
}

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
		degraded?: unknown;
		discoverableOnly?: unknown;
		reason?: unknown;
		policyTrace?: unknown;
	};
	return {
		routeClass: typeof resolved.routeClass?.id === "string" ? resolved.routeClass.id : "research.bounded",
		capability: typeof resolved.request?.capability === "string"
			? resolved.request.capability
			: typeof resolved.routeClass?.capability === "string"
				? resolved.routeClass.capability
				: null,
		selectedCapabilityId: typeof resolved.selected?.id === "string" ? resolved.selected.id : null,
		degraded: resolved.degraded === true,
		discoverableOnly: resolved.discoverableOnly === true,
		reason: typeof resolved.reason === "string" ? resolved.reason : null,
		policyTrace: Array.isArray(resolved.policyTrace)
			? resolved.policyTrace.filter((value): value is string => typeof value === "string")
			: [],
	};
}

async function resolveResearchExecutionRoute(
	client: DaemonClientLike,
	scope: ResearchScope,
	sessionId: string | null,
): Promise<ResearchRouteSummary | null> {
	if (!sessionId) return null;
	const resolved = await client.call("route.resolve", {
		consumer: "prana:autoresearch:execution",
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
		degraded?: unknown;
		discoverableOnly?: unknown;
		reason?: unknown;
		policyTrace?: unknown;
	};
	return {
		routeClass: typeof resolved.routeClass?.id === "string" ? resolved.routeClass.id : scope.executionRouteClass,
		capability: typeof resolved.request?.capability === "string"
			? resolved.request.capability
			: typeof resolved.routeClass?.capability === "string"
				? resolved.routeClass.capability
				: scope.executionCapability,
		selectedCapabilityId: typeof resolved.selected?.id === "string" ? resolved.selected.id : null,
		degraded: resolved.degraded === true,
		discoverableOnly: resolved.discoverableOnly === true,
		reason: typeof resolved.reason === "string" ? resolved.reason : null,
		policyTrace: Array.isArray(resolved.policyTrace)
			? resolved.policyTrace.filter((value): value is string => typeof value === "string")
			: [],
	};
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
		const route = requireResolvedResearchRoute(
			await resolveResearchRoute(client, scope, sessionId),
			"Research route authorization unavailable: route.resolve did not return the bounded research lane.",
		);
		if (route.discoverableOnly || route.selectedCapabilityId !== "engine.research.autoresearch") {
			throw new Error(
				`Research route authorization unavailable: expected engine.research.autoresearch, got ${route.selectedCapabilityId ?? "none"}.`,
			);
		}
		const executionRoute = await resolveResearchExecutionRoute(client, scope, sessionId);
		const asked = await client.call("sabha.ask", {
			question: scope.topic,
			convener: "prana:autoresearch",
			participants,
			project: scope.projectPath,
			sessionId,
		}) as {
			sabha: { id: string; topic: string };
		};
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
			await client.call("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "skeptic",
				summary: lucy.hit?.content ?? "Live guidance reported regression pressure.",
				reasoning: lucy.liveSignals.map((signal) => String(signal.description ?? signal.errorSignature ?? "warning")).join(" | "),
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
			await client.call("sabha.vote", {
				id: asked.sabha.id,
				participantId,
				position,
				reasoning,
			});
		}
		const concluded = await client.call("sabha.vote", {
			id: asked.sabha.id,
			participantId: votingPlan[votingPlan.length - 1]?.[0],
			position: votingPlan[votingPlan.length - 1]?.[1],
			reasoning: votingPlan[votingPlan.length - 1]?.[2],
			conclude: true,
		}) as {
			sabha: { id: string; topic: string; finalVerdict: string; rounds: Array<{ roundNumber: number; verdict: string }>; currentRound?: { allChallenges?: unknown[]; voteSummary?: { count: number } } };
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

export async function packResearchContext(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const route = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as {
			routeClass?: unknown;
			capability?: unknown;
			selectedCapabilityId?: unknown;
		}
		: null;
	const text = [
		`topic: ${scope.topic}`,
		`hypothesis: ${scope.hypothesis}`,
		`session id: ${typeof council.sessionId === "string" ? council.sessionId : "none"}`,
		`council verdict: ${String(council.finalVerdict ?? "unknown")}`,
		`lucy recommendation: ${councilLucyRecommendation(council)}`,
		`route class: ${typeof route?.routeClass === "string" ? route.routeClass : "none"}`,
		`route capability: ${typeof route?.capability === "string" ? route.capability : "none"}`,
		`route selected capability: ${typeof route?.selectedCapabilityId === "string" ? route.selectedCapabilityId : "none"}`,
		`metric: ${scope.metricName} (${scope.objective})`,
		`target files: ${scope.targetFiles.join(", ")}`,
		`immutable files: ${scope.immutableFiles.join(", ")}`,
		typeof evaluation?.baselineMetric === "number" ? `baseline: ${evaluation.baselineMetric}` : "",
		typeof evaluation?.observedMetric === "number" ? `observed: ${evaluation.observedMetric}` : "",
		typeof evaluation?.delta === "number" ? `delta: ${evaluation.delta}` : "",
		typeof evaluation?.decision === "string" ? `decision: ${evaluation.decision}` : "",
		`stdout:\n${String(run.stdout ?? "").slice(0, 8_000)}`,
		`stderr:\n${String(run.stderr ?? "").slice(0, 4_000)}`,
	].filter(Boolean).join("\n\n").trim();
	if (!text) {
		return { packed: false, runtime: null, savings: 0, sourceLength: 0, source: "none" };
	}
	const daemonPacked = await withDaemonClient(async (client) =>
		client.call("compression.pack_context", { text }) as Promise<Record<string, unknown>>,
	);
	if (daemonPacked) {
		const packedText = typeof daemonPacked.packedText === "string" ? daemonPacked.packedText : null;
		return {
			...daemonPacked,
			packed: daemonPacked.packed === false ? false : packedText !== null,
			packedText: packedText ?? undefined,
			sourceLength: text.length,
			source: "daemon",
		};
	}
	const { packLiveContextText } = await dynamicImport("@chitragupta/smriti");
	const localPacked = await packLiveContextText(text);
	if (!localPacked) {
		return { packed: false, runtime: null, savings: 0, sourceLength: text.length, source: "fallback" };
	}
	return {
		packed: true,
		runtime: localPacked.runtime,
		savings: localPacked.savings,
		sourceLength: text.length,
		packedText: localPacked.packedText,
		source: "fallback",
	};
}

export async function recordResearchOutcome(
	scope: ResearchScope,
	council: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	packed: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const entry = buildResearchRecord(scope, council, evaluation, packed);
	const daemonRecorded = await withDaemonClient(async (client) => {
		await client.call("memory.append", {
			scopeType: "project",
			scopePath: scope.projectPath,
			entry,
		});
		const traceResult = await client.call("akasha.leave", {
			agentId: "prana:autoresearch",
			type: evaluation.decision === "keep" ? "pattern" : "correction",
			topic: scope.topic,
			content: `${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
				metadata: {
				projectPath: scope.projectPath,
				metricName: scope.metricName,
				objective: scope.objective,
				decision: evaluation.decision ?? "record",
				workflow: "autoresearch",
					packedRuntime: packed.runtime ?? null,
					packedSource: packed.source ?? null,
					packedSourceLength: typeof packed.sourceLength === "number" ? packed.sourceLength : null,
					packedDeclinedReason: typeof packed.reason === "string" ? packed.reason : null,
					councilVerdict: council.finalVerdict ?? null,
					sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
						routeClass: typeof (council.executionRoute as { routeClass?: unknown } | undefined)?.routeClass === "string"
						? (council.executionRoute as { routeClass: string }).routeClass
						: null,
					selectedCapabilityId: typeof (council.executionRoute as { selectedCapabilityId?: unknown } | undefined)?.selectedCapabilityId === "string"
						? (council.executionRoute as { selectedCapabilityId: string }).selectedCapabilityId
						: null,
				},
		}) as { trace: { id: string } };
		return {
			recorded: true,
			memoryScope: "project",
			traceId: traceResult.trace.id,
			decision: evaluation.decision ?? "record",
			source: "daemon",
		};
	});
	if (daemonRecorded) return daemonRecorded;
	const { appendMemory, AkashaField, DatabaseManager } = await dynamicImport("@chitragupta/smriti");
	await appendMemory({ type: "project", path: scope.projectPath }, entry, { dedupe: false });
	const db = DatabaseManager.instance().get("agent");
	const akasha = new AkashaField();
	akasha.restore(db);
	const trace = akasha.leave(
		"prana:autoresearch",
		evaluation.decision === "keep" ? "pattern" : "correction",
		scope.topic,
		`${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
			{
				projectPath: scope.projectPath,
				metricName: scope.metricName,
				objective: scope.objective,
				decision: evaluation.decision ?? "record",
				workflow: "autoresearch",
				packedRuntime: packed.runtime ?? null,
				packedSource: packed.source ?? null,
				packedSourceLength: typeof packed.sourceLength === "number" ? packed.sourceLength : null,
				packedDeclinedReason: typeof packed.reason === "string" ? packed.reason : null,
				councilVerdict: council.finalVerdict ?? null,
				sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
				routeClass: typeof (council.executionRoute as { routeClass?: unknown } | undefined)?.routeClass === "string"
					? (council.executionRoute as { routeClass: string }).routeClass
					: null,
				selectedCapabilityId: typeof (council.executionRoute as { selectedCapabilityId?: unknown } | undefined)?.selectedCapabilityId === "string"
					? (council.executionRoute as { selectedCapabilityId: string }).selectedCapabilityId
					: null,
			},
		);
	akasha.persist(db);
	return {
		recorded: true,
		memoryScope: "project",
		traceId: trace.id,
		decision: evaluation.decision ?? "record",
		source: "fallback",
	};
}
