/**
 * @chitragupta/anina — Agent communication, input routing, and lifecycle helpers.
 *
 * Standalone functions extracted from the Agent class for mesh communication,
 * Sandesha input routing, Samiti event broadcasting, and resource disposal.
 */

import { createLogger } from "@chitragupta/core";

import { AutonomousAgent } from "./agent-autonomy.js";
import { ChetanaController } from "./chetana/controller.js";
import type { ChetanaConfig } from "./chetana/types.js";
import { LearningLoop } from "./learning-loop.js";
import { MemoryBridge } from "./memory-bridge.js";
import { createAgentBehavior } from "./agent-actor-bridge.js";
import type {
	AgentConfig,
	AgentEventType,
	KaalaLifecycle,
	LokapalaGuardians,
	MeshActorRef,
	MeshActorSystem,
	MeshSamiti,
} from "./types.js";

const log = createLogger("anina:agent:comm");

// ─── Subsystem Initialization ────────────────────────────────────────────────

/** Fields populated by initializeSubsystems. */
export interface SubsystemRefs {
	memoryBridge: MemoryBridge | null;
	learningLoop: LearningLoop | null;
	autonomousAgent: AutonomousAgent | null;
	chetana: ChetanaController | null;
	actorSystem: MeshActorSystem | null;
	actorRef: MeshActorRef | null;
	samiti: MeshSamiti | null;
	lokapala: LokapalaGuardians | null;
	kaala: KaalaLifecycle | null;
}

/**
 * Initialize optional subsystems (memory, learning, autonomy, chetana, mesh, lokapala, kaala).
 * Called from the Agent constructor after core state setup.
 */
export function initializeSubsystems(
	config: AgentConfig,
	agentId: string,
	depth: number,
	purpose: string,
	parentId: string | null,
	emit: (event: AgentEventType, data: unknown) => void,
): SubsystemRefs {
	const refs: SubsystemRefs = {
		memoryBridge: null, learningLoop: null, autonomousAgent: null,
		chetana: null, actorSystem: null, actorRef: null, samiti: null,
		lokapala: null, kaala: null,
	};

	if (config.enableMemory && config.project) {
		refs.memoryBridge = new MemoryBridge({
			enabled: true,
			project: config.project,
			embeddingProvider: config.embeddingProvider,
		});
	}

	if (config.enableLearning) {
		refs.learningLoop = new LearningLoop();
	}

	if (config.enableAutonomy) {
		const threshold = config.consecutiveFailureThreshold ?? 3;
		refs.autonomousAgent = new AutonomousAgent(
			{ toolDisableThreshold: threshold },
			refs.learningLoop ?? undefined,
		);
	}

	if (config.enableChetana !== false) {
		refs.chetana = new ChetanaController(
			config.chetanaConfig,
			(event, data) => emit(event as AgentEventType, data),
		);
	}

	// Mesh auto-register
	if (config.actorSystem && config.enableMesh !== false) {
		refs.actorSystem = config.actorSystem;
		refs.samiti = config.samiti ?? null;
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const behavior = createAgentBehavior({ id: agentId } as any);
			refs.actorRef = config.actorSystem.spawn(`agent:${agentId}`, {
				behavior,
				expertise: [config.profile.id, purpose],
				capabilities: config.tools?.map((t) => t.definition.name),
			});
			log.debug("agent registered in mesh", { agentId, actorId: `agent:${agentId}` });
		} catch (err) {
			log.warn("failed to register agent in mesh", { agentId, error: err instanceof Error ? err.message : String(err) });
		}
	} else {
		refs.samiti = config.samiti ?? null;
	}

	refs.lokapala = config.lokapala ?? null;
	refs.kaala = config.kaala ?? null;

	if (refs.kaala) {
		try {
			refs.kaala.registerAgent({
				agentId,
				lastBeat: Date.now(),
				startedAt: Date.now(),
				turnCount: 0,
				tokenUsage: 0,
				status: "alive",
				parentId,
				depth,
				purpose,
				tokenBudget: 200_000,
			});
		} catch {
			// KaalaBrahma registration is best-effort
		}
	}

	return refs;
}

// ─── Input Routing (Sandesha) ────────────────────────────────────────────────

/** Pending input request map entry. */
export interface PendingInput {
	resolve: (value: string) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

/**
 * Create and emit an input request, returning a promise that resolves when the user responds.
 */
export function requestInput(
	pendingInputs: Map<string, PendingInput>,
	agentId: string,
	inputCounter: { value: number },
	emit: (event: AgentEventType, data: unknown) => void,
	prompt: string,
	options?: { choices?: string[]; defaultValue?: string; timeoutMs?: number },
): Promise<string> {
	const requestId = `input_${agentId}_${inputCounter.value++}`;
	emit("agent:input_request", {
		requestId, agentId, prompt,
		choices: options?.choices,
		defaultValue: options?.defaultValue,
		timeoutMs: options?.timeoutMs,
	});

	return new Promise<string>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;

		if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
			timer = setTimeout(() => {
				pendingInputs.delete(requestId);
				if (options.defaultValue !== undefined) {
					resolve(options.defaultValue);
				} else {
					reject(new Error(`Input request "${requestId}" timed out after ${options.timeoutMs}ms with no default value`));
				}
			}, options.timeoutMs);
		}

		pendingInputs.set(requestId, { resolve, reject, timer });
	});
}

/** Resolve or deny a pending input request. */
export function resolveInput(
	pendingInputs: Map<string, PendingInput>,
	requestId: string,
	value: string,
	denied?: boolean,
	denyReason?: string,
): void {
	const pending = pendingInputs.get(requestId);
	if (!pending) return;
	if (pending.timer) clearTimeout(pending.timer);
	pendingInputs.delete(requestId);
	if (denied) {
		pending.reject(new Error(denyReason ?? "Input request denied by ancestor"));
	} else {
		pending.resolve(value);
	}
}

// ─── Mesh Communication ─────────────────────────────────────────────────────

/** Send a fire-and-forget message to another agent in the mesh. */
export function sendMeshMessage(
	actorRef: MeshActorRef | null,
	actorSystem: MeshActorSystem | null,
	agentId: string,
	targetAgentId: string,
	message: unknown,
): void {
	if (!actorRef || !actorSystem) {
		throw new Error("Mesh integration not enabled. Provide actorSystem in AgentConfig.");
	}
	const targetActorId = targetAgentId.startsWith("agent:") ? targetAgentId : `agent:${targetAgentId}`;
	actorSystem.tell(`agent:${agentId}`, targetActorId, message);
}

/** Send a request-reply message to another agent in the mesh. */
export async function askMeshAgent(
	actorRef: MeshActorRef | null,
	actorSystem: MeshActorSystem | null,
	agentId: string,
	targetAgentId: string,
	message: unknown,
	timeoutMs?: number,
): Promise<unknown> {
	if (!actorRef || !actorSystem) {
		throw new Error("Mesh integration not enabled. Provide actorSystem in AgentConfig.");
	}
	const targetActorId = targetAgentId.startsWith("agent:") ? targetAgentId : `agent:${targetAgentId}`;
	const reply = await actorSystem.ask(`agent:${agentId}`, targetActorId, message, { timeout: timeoutMs ?? 30_000 });
	return reply.payload;
}

/** Broadcast a message to a Samiti ambient channel. */
export function broadcastToSamitiChannel(
	samiti: MeshSamiti | null,
	agentId: string,
	purpose: string,
	depth: number,
	channel: string,
	content: string,
	severity: "info" | "warning" | "critical" = "info",
	category: string = "agent-event",
): void {
	if (!samiti) return;
	try {
		samiti.broadcast(channel, {
			sender: agentId, severity, category, content,
			data: { agentId, purpose, depth },
		});
	} catch (err) {
		log.debug("samiti broadcast failed", { channel, error: err instanceof Error ? err.message : String(err) });
	}
}

// ─── Samiti Event Broadcasting ───────────────────────────────────────────────

/**
 * Route agent events to appropriate Samiti channels.
 * Only broadcasts significant events to avoid noise.
 */
export function broadcastEventToSamiti(
	event: AgentEventType,
	data: unknown,
	samiti: MeshSamiti,
	agentId: string,
	purpose: string,
): void {
	try {
		switch (event) {
			case "tool:error": {
				const d = data as { name?: string; error?: string };
				samiti.broadcast("#correctness", {
					sender: agentId, severity: "warning", category: "tool-error",
					content: `Tool "${d.name}" failed: ${d.error}`,
					data: { agentId, purpose, ...d },
				});
				break;
			}
			case "agent:abort":
				samiti.broadcast("#alerts", {
					sender: agentId, severity: "info", category: "agent-abort",
					content: `Agent "${purpose}" (${agentId}) aborted`,
					data: { agentId, purpose },
				});
				break;
			case "subagent:spawn": {
				const d = data as { childId?: string; purpose?: string };
				samiti.broadcast("#alerts", {
					sender: agentId, severity: "info", category: "agent-spawn",
					content: `Spawned sub-agent "${d.purpose}" (${d.childId})`,
					data: { agentId, ...d },
				});
				break;
			}
			case "subagent:error": {
				const d = data as { childId?: string; purpose?: string; error?: string };
				samiti.broadcast("#correctness", {
					sender: agentId, severity: "warning", category: "subagent-error",
					content: `Sub-agent "${d.purpose}" failed: ${d.error}`,
					data: { agentId, ...d },
				});
				break;
			}
			case "chetana:frustrated":
				samiti.broadcast("#alerts", {
					sender: agentId, severity: "warning", category: "chetana-frustrated",
					content: `Agent "${purpose}" is frustrated`,
					data: { agentId, purpose },
				});
				break;
			default:
				break;
		}
	} catch {
		// Samiti broadcast failures are non-fatal
	}
}

// ─── Disposal ────────────────────────────────────────────────────────────────

/** Clean up mesh registration and null out subsystem references. */
export function disposeSubsystems(
	agentId: string,
	refs: SubsystemRefs,
): void {
	if (refs.actorSystem && refs.actorRef) {
		try { refs.actorSystem.stop(`agent:${agentId}`); } catch { /* non-fatal */ }
	}
	refs.actorRef = null;
	refs.actorSystem = null;
	refs.samiti = null;
	refs.kaala = null;
	refs.memoryBridge = null;
	refs.learningLoop = null;
	refs.autonomousAgent = null;
	refs.chetana = null;
}
