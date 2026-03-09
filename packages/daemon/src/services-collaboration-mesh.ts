import { loadGlobalSettings } from "@chitragupta/core";
import { ActorSystem, type MeshEnvelope, type PeerNetworkConfig } from "@chitragupta/sutra";
import type { Sabha } from "@chitragupta/sutra";
import type { CapableActorBehavior } from "@chitragupta/sutra";
import type {
	SabhaMeshBinding,
	SabhaMeshDispatchRecord,
	SabhaPerspective,
} from "./services-collaboration-types.js";
import {
	asConsultPayload,
	buildObserveReply,
	evidenceDetail,
	type MeshPerspectiveReply,
	type SabhaConsultPayload,
	trimString,
} from "./services-collaboration-mesh-helpers.js";

let sharedCollaborationMesh: ActorSystem | undefined;
let sharedCollaborationMeshBootstrapPromise: Promise<void> | undefined;

interface CollaborationMeshSettings {
	mesh?: Partial<PeerNetworkConfig>;
	meshNetwork?: Partial<PeerNetworkConfig>;
}

function createMemoryConsultActor(): CapableActorBehavior {
	return {
		capabilities: ["sabha.consultation", "sabha.consult.memory", "memory-search", "memory-recall"],
		expertise: ["memory", "recall", "sabha"],
		handle: async (envelope, ctx) => {
			const payload = asConsultPayload(envelope.payload);
			if (!payload || payload.type !== "sabha.consult") {
				if (envelope.type === "ask") ctx.reply({ summary: "Unsupported request", reasoning: "Expected sabha.consult payload." });
				return;
			}
			const topic = trimString(payload.topic);
			if (!topic) {
				ctx.reply(buildObserveReply({
					summary: "No consultation topic was provided.",
					reasoning: "Memory consult requires a non-empty topic to search durable memory.",
					metadata: { source: "sabha.mesh.memory" },
				}));
				return;
			}
			try {
				const { searchMemory } = await import("@chitragupta/smriti");
				const results = searchMemory(topic).slice(0, 3);
				if (results.length === 0) {
					ctx.reply(buildObserveReply({
						summary: "No strong durable memory match was found.",
						reasoning: `Durable memory search for "${topic}" returned no high-signal matches.`,
						recommendedAction: "Proceed with fresh evidence or gather perspectives from other peers.",
						metadata: { source: "sabha.mesh.memory", matches: 0 },
					}));
					return;
				}
				const evidence = results.map((result, index) => ({
					label: `memory-${index + 1}`,
					detail: evidenceDetail(result.content),
					source:
						result.scope.type === "project"
							? `project:${result.scope.path}`
							: result.scope.type === "agent"
								? `agent:${result.scope.agentId}`
								: result.scope.type,
				}));
				ctx.reply(buildObserveReply({
					summary: `Durable memory found ${results.length} relevant scope${results.length === 1 ? "" : "s"} for "${topic}".`,
					reasoning: "The memory layer returned prior facts or preferences that should influence the council before new work proceeds.",
					recommendedAction: "Inspect the cited memory scopes before concluding the Sabha.",
					evidence,
					metadata: { source: "sabha.mesh.memory", matches: results.length },
				}));
			} catch (error) {
				ctx.reply(buildObserveReply({
					summary: "Memory consultation failed.",
					reasoning: error instanceof Error ? error.message : String(error),
					metadata: { source: "sabha.mesh.memory", error: true },
				}));
			}
		},
	};
}

function createSessionConsultActor(): CapableActorBehavior {
	return {
		capabilities: ["sabha.consultation", "sabha.consult.session", "session-history", "session-search"],
		expertise: ["session", "continuity", "handover", "sabha"],
		handle: async (envelope, ctx) => {
			const payload = asConsultPayload(envelope.payload);
			if (!payload || payload.type !== "sabha.consult") {
				if (envelope.type === "ask") ctx.reply({ summary: "Unsupported request", reasoning: "Expected sabha.consult payload." });
				return;
			}
			const topic = trimString(payload.topic);
			const project = trimString(payload.project);
			if (!topic) {
				ctx.reply(buildObserveReply({
					summary: "No consultation topic was provided.",
					reasoning: "Session consultation requires a non-empty topic to search prior sessions.",
					metadata: { source: "sabha.mesh.session" },
				}));
				return;
			}
			try {
				const { searchSessions } = await import("@chitragupta/smriti");
				const sessions = searchSessions(topic, project || undefined).slice(0, 3);
				if (sessions.length === 0) {
					ctx.reply(buildObserveReply({
						summary: "No relevant prior sessions were found.",
						reasoning: `Session search for "${topic}" returned no matching history${project ? ` in ${project}` : ""}.`,
						recommendedAction: "Treat this as a new thread or gather evidence from other peers.",
						metadata: { source: "sabha.mesh.session", matches: 0 },
					}));
					return;
				}
				const evidence = sessions.map((session, index) => ({
					label: `session-${index + 1}`,
					detail: evidenceDetail(`${session.id} | ${session.title ?? "Untitled"} | ${session.updated}`),
					source: session.id,
				}));
				ctx.reply(buildObserveReply({
					summary: `Session history found ${sessions.length} relevant prior thread${sessions.length === 1 ? "" : "s"} for "${topic}".`,
					reasoning: "Prior sessions provide continuity, previous decisions, and prior unresolved loops that should inform the council.",
					recommendedAction: "Open the cited sessions or handovers before concluding the Sabha.",
					evidence,
					metadata: { source: "sabha.mesh.session", matches: sessions.length, project: project || null },
				}));
			} catch (error) {
				ctx.reply(buildObserveReply({
					summary: "Session consultation failed.",
					reasoning: error instanceof Error ? error.message : String(error),
					metadata: { source: "sabha.mesh.session", error: true },
				}));
			}
		},
	};
}

function ensureBuiltInConsultActors(mesh: ActorSystem): void {
	for (const [id, behavior] of [
		["sabha:memory", createMemoryConsultActor()],
		["sabha:session", createSessionConsultActor()],
	] as const) {
		try {
			mesh.spawn(id, { behavior });
		} catch {
			/* idempotent */
		}
	}
}

function resolveConfiguredCollaborationNodeId(): string | undefined {
	const settings = loadGlobalSettings() as unknown as CollaborationMeshSettings;
	const configured = settings.mesh ?? settings.meshNetwork ?? {};
	const nodeIdRaw = (process.env.CHITRAGUPTA_MESH_NODE_ID ?? "").trim();
	return nodeIdRaw || configured.nodeId || undefined;
}

function resolveCollaborationMeshConfig(): PeerNetworkConfig | null {
	const settings = loadGlobalSettings() as unknown as CollaborationMeshSettings;
	const configured = settings.mesh ?? settings.meshNetwork ?? {};
	const portRaw = (process.env.CHITRAGUPTA_MESH_PORT ?? "").trim();
	const peersRaw = (process.env.CHITRAGUPTA_MESH_PEERS ?? "").trim();
	const hostRaw = (process.env.CHITRAGUPTA_MESH_HOST ?? "").trim();
	const secretRaw = (process.env.CHITRAGUPTA_MESH_SECRET ?? "").trim();
	const nodeIdRaw = resolveConfiguredCollaborationNodeId();
	const listenPort = Number(portRaw || configured.listenPort || 0);
	const staticPeers = peersRaw
		? peersRaw.split(",").map((value) => value.trim()).filter(Boolean)
		: configured.staticPeers;
	const listenHost = hostRaw || configured.listenHost || undefined;
	const meshSecret = secretRaw || configured.meshSecret || undefined;
	const nodeId = nodeIdRaw || undefined;
	if (!listenPort && !staticPeers?.length && !listenHost && !meshSecret && !nodeId) return null;
	return {
		listenPort: Number.isFinite(listenPort) && listenPort > 0 ? listenPort : undefined,
		listenHost,
		staticPeers,
		meshSecret,
		nodeId,
	};
}

function getMesh(): ActorSystem {
	if (!sharedCollaborationMesh) {
		sharedCollaborationMesh = new ActorSystem({
			gossipIntervalMs: 1_000,
			suspectTimeoutMs: 5_000,
			deadTimeoutMs: 15_000,
			defaultAskTimeout: 10_000,
		});
		sharedCollaborationMesh.start();
		ensureBuiltInConsultActors(sharedCollaborationMesh);
	}
	return sharedCollaborationMesh;
}

export async function ensureCollaborationMeshReady(): Promise<ActorSystem> {
	return ensureMeshReady();
}

export function peekCollaborationMeshSystem(): ActorSystem | undefined {
	return sharedCollaborationMesh;
}

export function getCollaborationMeshPort(): number {
	return resolveCollaborationMeshConfig()?.listenPort ?? 0;
}

export function getCollaborationMeshLeaseOwner(): string {
	return resolveConfiguredCollaborationNodeId() || "sabha-daemon";
}

export function getCollaborationMeshNodeId(): string {
	return getMesh().getConnectionManager()?.nodeId ?? getCollaborationMeshLeaseOwner();
}

async function ensureMeshReady(): Promise<ActorSystem> {
	const mesh = getMesh();
	if (!sharedCollaborationMeshBootstrapPromise) {
		sharedCollaborationMeshBootstrapPromise = (async () => {
			const config = resolveCollaborationMeshConfig();
			if (!config) return;
			if (mesh.getConnectionManager()) return;
			await mesh.bootstrapP2P(config);
		})().catch((error) => {
			sharedCollaborationMeshBootstrapPromise = undefined;
			throw error;
		});
	}
	await sharedCollaborationMeshBootstrapPromise;
	return mesh;
}

function buildPerspectiveFromReply(
	participantId: string,
	envelope: MeshEnvelope,
	binding: SabhaMeshBinding,
): SabhaPerspective | null {
	const reply = envelope.payload as MeshPerspectiveReply;
	const summary = typeof reply.summary === "string" ? reply.summary.trim() : "";
	const reasoning = typeof reply.reasoning === "string"
		? reply.reasoning.trim()
		: summary;
	if (!summary && !reasoning) return null;
	const normalizedPosition = typeof reply.position === "string"
		? reply.position.trim().toLowerCase()
		: "observe";
	const position = normalizedPosition === "support"
		|| normalizedPosition === "oppose"
		|| normalizedPosition === "abstain"
		|| normalizedPosition === "observe"
		? normalizedPosition
		: "observe";
	const metadata = typeof reply.metadata === "object" && reply.metadata !== null
		&& !Array.isArray(reply.metadata)
		? { ...(reply.metadata as Record<string, unknown>) }
		: {};
	const evidence = Array.isArray(reply.evidence)
		? reply.evidence
			.filter((value): value is { label?: unknown; detail?: unknown; source?: unknown } =>
				typeof value === "object" && value !== null,
			)
			.map((value, index) => ({
				label: typeof value.label === "string" && value.label.trim()
					? value.label.trim()
					: `evidence-${index + 1}`,
				detail: typeof value.detail === "string" ? value.detail.trim() : "",
				source: typeof value.source === "string" && value.source.trim()
					? value.source.trim()
					: undefined,
			}))
			.filter((value) => value.detail.length > 0)
		: [];
	return {
		participantId,
		submittedAt: Date.now(),
		summary: summary || reasoning,
		reasoning: reasoning || summary,
		position,
		recommendedAction: typeof reply.recommendedAction === "string" && reply.recommendedAction.trim()
			? reply.recommendedAction.trim()
			: null,
		evidence,
		clientId: null,
		transport: "internal",
		metadata: {
			...metadata,
			source: "sabha.mesh",
			meshReplyFrom: envelope.from,
			meshTarget: binding.target,
			meshMode: binding.mode,
		},
	};
}

export async function dispatchSabhaMeshBinding(
	sabha: Sabha,
	binding: SabhaMeshBinding,
	options: {
		applyPerspective: (perspective: SabhaPerspective) => boolean;
	},
): Promise<SabhaMeshDispatchRecord> {
	const attemptedAt = Date.now();
	const preferredTarget = binding.resolvedTarget?.trim() || binding.target;
	const record: SabhaMeshDispatchRecord = {
		participantId: binding.participantId,
		target: preferredTarget,
		mode: binding.mode,
		status: "pending",
		attemptedAt,
	};
	const mesh = await ensureMeshReady();
	if (!binding.resolvedTarget && binding.target.startsWith("capability:")) {
		const capability = binding.target.slice("capability:".length).trim();
		const localActor = capability
			? mesh.getCapabilityRouter()?.resolve({ capabilities: [capability] })
			: undefined;
		const remotePeers = capability ? mesh.findByCapability(capability) : [];
		if (!capability || (!localActor && remotePeers.length === 0)) {
			record.status = "failed";
			record.completedAt = Date.now();
			record.error = capability
				? `No mesh actor or peer advertises capability '${capability}'.`
				: "Invalid capability binding target.";
			return record;
		}
	}
	const payload = {
		type: "sabha.consult",
		sabhaId: sabha.id,
		topic: sabha.topic,
		participantId: binding.participantId,
		convener: sabha.convener,
		participants: sabha.participants,
		status: sabha.status,
		currentRound: sabha.rounds.length > 0 ? sabha.rounds[sabha.rounds.length - 1] : null,
		project: typeof (sabha as unknown as { project?: unknown }).project === "string"
			? (sabha as unknown as { project?: string }).project
			: null,
		sessionId: typeof (sabha as unknown as { sessionId?: unknown }).sessionId === "string"
			? (sabha as unknown as { sessionId?: string }).sessionId
			: null,
	};
		try {
			const attemptedTargets = binding.resolvedTarget && binding.target.startsWith("capability:")
				? [binding.resolvedTarget, binding.target]
				: binding.resolvedTarget
					? [binding.resolvedTarget]
					: [binding.target];
		for (let index = 0; index < attemptedTargets.length; index += 1) {
			const target = attemptedTargets[index];
			record.target = target;
			if (!target.startsWith("capability:")) {
				const localActor = mesh.ref(target);
				const remoteNode = mesh.getNetworkGossip()?.findNode(target);
				if (!localActor && !remoteNode) {
					record.status = "failed";
					record.completedAt = Date.now();
					record.error = `No local or remote mesh actor '${target}' is available.`;
					if (index === attemptedTargets.length - 1) return record;
					continue;
				}
			}
			if (binding.mode === "tell") {
				mesh.tell("sabha-daemon", target, payload, {
					topic: binding.topic,
					priority: 2,
				});
				record.status = "delivered";
				record.completedAt = Date.now();
				return record;
			}
			try {
				const reply = await mesh.ask("sabha-daemon", target, payload, {
					timeout: binding.timeoutMs,
					topic: binding.topic,
					priority: 2,
				});
				record.status = "replied";
				record.completedAt = Date.now();
				const envelope = reply as MeshEnvelope;
				record.replyFrom = envelope.from;
				if (!target.startsWith("capability:") && envelope.from !== target) {
					record.status = "failed";
					record.error =
						`Sabha mesh reply origin mismatch for '${binding.participantId}': `
						+ `expected '${target}', got '${envelope.from}'.`;
					if (index < attemptedTargets.length - 1) continue;
					return record;
				}
				if (binding.target.startsWith("capability:") && envelope.from.trim()) {
					record.resolvedTarget = envelope.from.trim();
				}
					const perspective = buildPerspectiveFromReply(
						binding.participantId,
						envelope,
						binding,
					);
					if (perspective) {
						const accepted = options.applyPerspective(perspective);
						record.replySummary = perspective.summary;
						if (accepted) {
							record.status = "accepted";
						}
					}
					return record;
			} catch (error) {
				record.status = "failed";
				record.completedAt = Date.now();
				record.error = error instanceof Error ? error.message : String(error);
				if (index === attemptedTargets.length - 1) return record;
			}
		}
		record.status = "failed";
		record.completedAt = Date.now();
		record.error ??= "Sabha mesh dispatch did not reach an accepting peer.";
		return record;
	} catch (error) {
		record.status = "failed";
		record.completedAt = Date.now();
		record.error = error instanceof Error ? error.message : String(error);
		return record;
	}
}

export function getCollaborationMeshSystemForTests(): ActorSystem {
	return getMesh();
}

export function _resetCollaborationMeshForTests(): void {
	sharedCollaborationMesh = undefined;
	sharedCollaborationMeshBootstrapPromise = undefined;
}
