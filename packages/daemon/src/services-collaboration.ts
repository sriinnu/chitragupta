import { Buddhi, type DecisionCategory } from "@chitragupta/anina";
import { DatabaseManager } from "@chitragupta/smriti";
import { SabhaEngine, type NyayaSyllogism, type Sabha } from "@chitragupta/sutra";
import type { RpcRouter } from "./rpc-router.js";
import {
	assertExpectedRevision,
	buildSabhaAlternatives,
	buildSabhaMetadata,
	buildSabhaReasoning,
	currentRound,
	emitSabhaNotification,
	ensureSabhaParticipant,
	escalateSabha,
	gatherSabhaState,
	notificationTargetsForSabha,
	parseParticipants,
	parsePerspective,
	parseSyllogism,
} from "./services-collaboration-helpers.js";
import {
	dispatchMeshConsultations,
	hydrateCollaborationState,
	loadPersistedSabhaState,
	pruneCollaborationRuntime,
	refreshPersistedSabhaState,
	recordSabhaMutation,
	resetCollaborationRuntime,
	resumeActiveSabhaMeshDispatches,
	resumePendingMeshConsultations,
} from "./services-collaboration-runtime.js";
import {
	getSabhaClientBindingMap,
	getSabhaMeshBindingMap,
	getSabhaPerspectiveMap,
	touchSabhaRuntime,
	withSabhaWriteLock,
} from "./services-collaboration-state.js";
import {
	applyParticipantBindings,
	registerSabhaReplicationMethods,
	resolveReplicatedSabhaState,
} from "./services-collaboration-replication.js";

function getReplicatedSabhaStateOrThrow(id: string) {
	return resolveReplicatedSabhaState(id, getSabhaOrThrow);
}

const sharedSabhaEngine = new SabhaEngine();
function readSabhaId(params: Record<string, unknown>): string {
	const id = String(params.id ?? params.sabhaId ?? "").trim();
	if (!id) throw new Error("Missing id");
	return id;
}

function getSabhaOrThrow(id: string): Sabha {
	pruneCollaborationRuntime(sharedSabhaEngine);
	const sabha = sharedSabhaEngine.getSabha(id) ?? loadPersistedSabhaState(sharedSabhaEngine, id);
	if (!sabha) throw new Error(`Sabha '${id}' not found.`);
	touchSabhaRuntime(id);
	return sabha;
}

export function _resetCollaborationStateForTests(): void {
	resetCollaborationRuntime(sharedSabhaEngine);
}

export function registerCollaborationMethods(router: RpcRouter): void {
	hydrateCollaborationState(sharedSabhaEngine);
	router.register("sabha.list_active", async () => {
		pruneCollaborationRuntime(sharedSabhaEngine);
		return {
			sabhas: sharedSabhaEngine.listActive().map((sabha) => gatherSabhaState(sabha)),
		};
	}, "List active Sabha deliberations");
	router.register("sabha.get", async (params) => {
		const id = readSabhaId(params);
		const sabha = getSabhaOrThrow(id);
		const shouldResumeMesh = params.retryMesh === true || params.resumePending === true;
		const meshDispatches = shouldResumeMesh
			? await resumePendingMeshConsultations(router, sabha, {
				expectedRevision: params.expectedRevision,
				explicitTargets: params.targetClientIds,
				forceFailed: params.retryMesh === true,
			})
			: [];
		return {
			sabha: gatherSabhaState(sabha),
			explanation: sharedSabhaEngine.explain(id),
			meshDispatches,
		};
	}, "Get a Sabha and its current gathered state");
	router.register("sabha.resume", async (params) => {
		const id = readSabhaId(params);
		const sabha = getSabhaOrThrow(id);
		const meshDispatches = await resumePendingMeshConsultations(router, sabha, {
			expectedRevision: params.expectedRevision,
			explicitTargets: params.targetClientIds,
			forceFailed: params.retryMesh === true,
		});
		return {
			sabha: gatherSabhaState(sabha),
			explanation: sharedSabhaEngine.explain(id),
			meshDispatches,
		};
	}, "Explicitly resume pending Sabha mesh consultations");
	router.register("sabha.ask", async (params) => {
		const topic = String(params.topic ?? params.question ?? "").trim();
		const convener = String(params.convener ?? params.askerId ?? "consumer").trim();
		const { participants, clientBindings, meshBindings } = parseParticipants(params.participants);
		if (!topic) throw new Error("Missing topic or question");
		const sabha = sharedSabhaEngine.convene(topic, convener, participants);
		const project = typeof params.project === "string" && params.project.trim() ? params.project.trim() : "";
		const sessionId = typeof params.sessionId === "string" && params.sessionId.trim() ? params.sessionId.trim() : "";
		if (project) (sabha as Sabha & { project?: string }).project = project;
		if (sessionId) (sabha as Sabha & { sessionId?: string }).sessionId = sessionId;
		getSabhaPerspectiveMap(sabha.id);
			applyParticipantBindings(
				sabha.id,
				Object.fromEntries(clientBindings.entries()),
				[...meshBindings.values()],
				getSabhaClientBindingMap,
				getSabhaMeshBindingMap,
			);
		recordSabhaMutation(sabha, "convened", {
			topic,
			convener,
			project: project || null,
			sessionId: sessionId || null,
			participantIds: participants.map((participant) => participant.id),
		});
		const notificationsSent = emitSabhaNotification(router, sabha, "sabha.consult", {
			question: topic,
			convener,
		}, params.targetClientIds);
		const meshDispatches = await dispatchMeshConsultations(router, sabha, {
			explicitTargets: params.targetClientIds,
		});
		return {
			sabha: gatherSabhaState(sabha),
			question: topic,
			targets: participants.map((participant) => participant.id),
			targetClientIds: notificationTargetsForSabha(sabha.id, params.targetClientIds),
			notificationsSent,
			meshDispatches,
		};
	}, "Convene a Sabha as a council ask/consultation");
	router.register("sabha.submit_perspective", async (params, context) => {
		const id = readSabhaId(params);
		return withSabhaWriteLock(id, async () => {
			const sabha = getSabhaOrThrow(id);
			if (sabha.status === "concluded" || sabha.status === "escalated") {
				throw new Error(`Sabha '${id}' is already ${sabha.status}; consultation is closed.`);
			}
			assertExpectedRevision(id, params.expectedRevision);
			const perspective = parsePerspective(params, context);
			ensureSabhaParticipant(sabha, perspective.participantId);
			const boundClientId = getSabhaClientBindingMap(id).get(perspective.participantId);
			if (boundClientId && context?.clientId !== boundClientId) {
				throw new Error(
					`Participant '${perspective.participantId}' is bound to client '${boundClientId}', got '${context?.clientId ?? "unknown"}'.`,
				);
			}
			const perspectiveMap = getSabhaPerspectiveMap(id);
			if (perspectiveMap.has(perspective.participantId)) {
				throw new Error(
					`Participant '${perspective.participantId}' has already submitted a perspective for Sabha '${id}'.`,
				);
			}
			perspectiveMap.set(perspective.participantId, perspective);
			recordSabhaMutation(sabha, "perspective_submitted", {
				participantId: perspective.participantId,
				position: perspective.position,
				clientId: perspective.clientId,
				transport: perspective.transport,
			});
			const state = gatherSabhaState(sabha);
			const notificationsSent = emitSabhaNotification(router, sabha, "sabha.perspective", {
				event: "perspective",
				perspective,
				respondedParticipantIds: state.respondedParticipantIds,
				pendingParticipantIds: state.pendingParticipantIds,
			}, params.targetClientIds);
			return {
				sabha: state,
				perspective,
				notificationsSent,
			};
		});
	}, "Submit a structured peer perspective into an active Sabha consultation");
	router.register("sabha.deliberate", async (params) => {
		const existingId = String(params.id ?? "").trim();
		const run = async () => {
			if (existingId) assertExpectedRevision(existingId, params.expectedRevision);
			const parsedParticipants = parseParticipants(params.participants);
			const sabha = existingId
				? getSabhaOrThrow(existingId)
				: sharedSabhaEngine.convene(
					String(params.topic ?? "").trim(),
					String(params.convener ?? "consumer").trim(),
					parsedParticipants.participants,
				);
			getSabhaPerspectiveMap(sabha.id);
			if (!existingId) {
				applyParticipantBindings(
					sabha.id,
					Object.fromEntries(parsedParticipants.clientBindings.entries()),
					[...parsedParticipants.meshBindings.values()],
					getSabhaClientBindingMap,
					getSabhaMeshBindingMap,
				);
			}
			if (!existingId) {
				recordSabhaMutation(sabha, "convened", {
					topic: sabha.topic,
					convener: sabha.convener,
					participantIds: sabha.participants.map((participant) => participant.id),
				});
			}

			const challenges = Array.isArray(params.challenges) ? params.challenges as Array<Record<string, unknown>> : [];
			const responses = Array.isArray(params.responses) ? params.responses as Array<Record<string, unknown>> : [];
			const votes = Array.isArray(params.votes) ? params.votes as Array<Record<string, unknown>> : [];
			const hasRoundInputs =
				params.syllogism != null
				|| params.proposal != null
				|| challenges.length > 0
				|| responses.length > 0
				|| votes.length > 0;
			const shouldConclude = params.conclude === true || votes.length > 0;

			if (hasRoundInputs) {
				const proposerId = String(params.proposerId ?? sabha.convener).trim();
				const syllogism = parseSyllogism(params.syllogism ?? params.proposal);
				sharedSabhaEngine.propose(sabha.id, proposerId, syllogism);
			} else if (!shouldConclude) {
				throw new Error("Missing Sabha round inputs");
			}

			for (const challenge of challenges) {
				sharedSabhaEngine.challenge(
					sabha.id,
					String(challenge.challengerId ?? "").trim(),
					String(challenge.targetStep ?? "").trim() as keyof NyayaSyllogism,
					String(challenge.challenge ?? "").trim(),
				);
			}

			for (const response of responses) {
				sharedSabhaEngine.respond(
					sabha.id,
					Number(response.recordIndex ?? -1),
					String(response.response ?? "").trim(),
				);
			}

			for (const vote of votes) {
				sharedSabhaEngine.vote(
					sabha.id,
					String(vote.participantId ?? "").trim(),
					String(vote.position ?? "").trim() as "support" | "oppose" | "abstain",
					String(vote.reasoning ?? "").trim(),
				);
			}

			const resultSabha = shouldConclude ? sharedSabhaEngine.conclude(sabha.id) : sabha;
			recordSabhaMutation(resultSabha, shouldConclude ? "concluded" : "deliberated", {
				roundCount: resultSabha.rounds.length,
				finalVerdict: resultSabha.finalVerdict,
				challengeCount: currentRound(resultSabha)?.challenges.length ?? 0,
				voteCount: currentRound(resultSabha)?.votes.length ?? 0,
			});
			const notificationsSent = emitSabhaNotification(router, resultSabha, "sabha.updated", {
				event: shouldConclude ? "concluded" : "deliberating",
				explanation: shouldConclude ? sharedSabhaEngine.explain(resultSabha.id) : null,
			}, params.targetClientIds);
			return {
				sabha: gatherSabhaState(resultSabha),
				explanation: shouldConclude ? sharedSabhaEngine.explain(resultSabha.id) : null,
				notificationsSent,
			};
		};
		return existingId ? withSabhaWriteLock(existingId, run) : run();
	}, "Run a Sabha deliberation round, optionally concluding it");
	router.register("sabha.challenge", async (params) => {
		const id = readSabhaId(params);
		const challengerId = String(params.challengerId ?? "").trim();
		const targetStep = String(params.targetStep ?? "").trim() as keyof NyayaSyllogism;
		const challenge = String(params.challenge ?? "").trim();
		if (!challengerId || !targetStep || !challenge) {
			throw new Error("Missing challengerId, targetStep, or challenge");
		}
		return withSabhaWriteLock(id, async () => {
			assertExpectedRevision(id, params.expectedRevision);
			sharedSabhaEngine.challenge(id, challengerId, targetStep, challenge);
			const sabha = getSabhaOrThrow(id);
			recordSabhaMutation(sabha, "challenge_submitted", { challengerId, targetStep });
			const notificationsSent = emitSabhaNotification(router, sabha, "sabha.updated", {
				event: "challenge",
				challengerId,
				targetStep,
				challenge,
			}, params.targetClientIds);
			return { sabha: gatherSabhaState(sabha), notificationsSent };
		});
	}, "Submit a challenge into an active Sabha round");
	router.register("sabha.respond", async (params) => {
		const id = readSabhaId(params);
		const recordIndex = Number(params.recordIndex ?? -1);
		const response = String(params.response ?? "").trim();
		if (!Number.isInteger(recordIndex) || recordIndex < 0 || !response) {
			throw new Error("Missing recordIndex or response");
		}
		return withSabhaWriteLock(id, async () => {
			assertExpectedRevision(id, params.expectedRevision);
			sharedSabhaEngine.respond(id, recordIndex, response);
			const sabha = getSabhaOrThrow(id);
			recordSabhaMutation(sabha, "challenge_responded", { recordIndex });
			const notificationsSent = emitSabhaNotification(router, sabha, "sabha.updated", {
				event: "response",
				recordIndex,
			}, params.targetClientIds);
			return { sabha: gatherSabhaState(sabha), notificationsSent };
		});
	}, "Respond to a previously raised Sabha challenge");
	router.register("sabha.vote", async (params) => {
		const id = readSabhaId(params);
		const participantId = String(params.participantId ?? "").trim();
		const position = String(params.position ?? "").trim() as "support" | "oppose" | "abstain";
		const reasoning = String(params.reasoning ?? "").trim();
		if (!participantId || !position || !reasoning) {
			throw new Error("Missing participantId, position, or reasoning");
		}
		return withSabhaWriteLock(id, async () => {
			assertExpectedRevision(id, params.expectedRevision);
			sharedSabhaEngine.vote(id, participantId, position, reasoning);
			let sabha = getSabhaOrThrow(id);
			if (params.conclude === true) {
				sabha = sharedSabhaEngine.conclude(id);
			}
			recordSabhaMutation(sabha, params.conclude === true ? "concluded" : "vote_cast", {
				participantId,
				position,
				finalVerdict: sabha.finalVerdict,
			});
			const notificationsSent = emitSabhaNotification(router, sabha, "sabha.updated", {
				event: params.conclude === true ? "concluded" : "vote",
				participantId,
				position,
			}, params.targetClientIds);
			return {
				sabha: gatherSabhaState(sabha),
				explanation: params.conclude === true ? sharedSabhaEngine.explain(id) : null,
				notificationsSent,
			};
		});
	}, "Cast a single vote in an active Sabha round");
	router.register("sabha.gather", async (params) => {
		const id = readSabhaId(params);
		const sabha = getSabhaOrThrow(id);
		const meshDispatches = await resumePendingMeshConsultations(router, sabha, {
			expectedRevision: params.expectedRevision,
			explicitTargets: params.targetClientIds,
			forceFailed: params.retryMesh === true,
		});
		return {
			sabha: gatherSabhaState(sabha),
			explanation: sharedSabhaEngine.explain(id),
			meshDispatches,
		};
	}, "Gather the current state and perspectives of a Sabha");
	registerSabhaReplicationMethods({
		router,
		sharedSabhaEngine,
		readSabhaId,
		getSabhaOrThrow,
		getReplicatedSabhaStateOrThrow,
		getClientBindingMap: getSabhaClientBindingMap,
		getMeshBindingMap: getSabhaMeshBindingMap,
		resumePendingMeshConsultations,
	});
	router.register("sabha.record", async (params, context) => {
		const id = readSabhaId(params);
		const sessionId = String(params.sessionId ?? "").trim();
		const project = String(params.project ?? "").trim();
		const category = String(params.category ?? "architecture").trim() as DecisionCategory;
		if (!sessionId || !project) throw new Error("Missing sessionId or project");
		return withSabhaWriteLock(id, async () => {
			const sabha = getSabhaOrThrow(id);
			assertExpectedRevision(id, params.expectedRevision);
			const dbm = DatabaseManager.instance();
			const buddhi = new Buddhi();
			const decision = buddhi.recordDecision({
				sessionId,
				project,
				category,
				description: `Sabha outcome: ${sabha.topic}`,
				reasoning: buildSabhaReasoning(sabha),
				confidence: Number(params.confidence ?? 0.85),
				alternatives: buildSabhaAlternatives(sabha),
				metadata: buildSabhaMetadata(sabha, context, { recordedBy: "sabha.record" }),
			}, dbm);
			router.notify("sabha.recorded", {
				sabhaId: sabha.id,
				decisionId: decision.id,
				project,
				sessionId,
			});
			recordSabhaMutation(sabha, "recorded", {
				decisionId: decision.id,
				project,
				sessionId,
			});
			return {
				decision,
				sabha: gatherSabhaState(sabha),
			};
		});
	}, "Record a Sabha outcome into Buddhi");
	router.register("sabha.escalate", async (params, context) => {
		const id = readSabhaId(params);
		const reason = String(params.reason ?? "Escalated by operator or policy").trim();
		return withSabhaWriteLock(id, async () => {
			const sabha = getSabhaOrThrow(id);
			assertExpectedRevision(id, params.expectedRevision);
			const escalated = escalateSabha(sabha, reason);
			recordSabhaMutation(escalated, "escalated", {
				reason,
				clientId: context?.clientId ?? null,
			});
			router.notify("sabha.escalated", {
				sabhaId: escalated.id,
				reason,
				clientId: context?.clientId ?? null,
			});
			emitSabhaNotification(router, escalated, "sabha.updated", {
				event: "escalated",
				reason,
			}, params.targetClientIds);
			return {
				sabha: gatherSabhaState(escalated),
				reason,
			};
		});
	}, "Escalate a Sabha to external authority");

	void resumeActiveSabhaMeshDispatches(sharedSabhaEngine, router);
}
