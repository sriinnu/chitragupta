import crypto from "crypto";
import { Agent } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage } from "@chitragupta/anina";
import { getAllTools } from "@chitragupta/yantra";
import type { Session } from "@chitragupta/smriti/types";
import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { TuriyaRouter } from "@chitragupta/swara";
import type { ApiDeps } from "./http-server-types.js";
import {
	addTurn as addTurnViaDaemon,
	listSessions as listSessionsViaDaemon,
	openSession as openSessionViaDaemon,
	openSharedSession as openSharedSessionViaDaemon,
	showSession as showSessionViaDaemon,
} from "./modes/daemon-bridge.js";
import { applyLucyLiveGuidance, type ServeSessionScope } from "./nervous-system-wiring.js";
import type { ServePhaseModules } from "./main-serve-helpers.js";
import type { MeshBootstrapResult } from "./mesh-bootstrap.js";
import { buildMeshApiHandlers } from "./mesh-bootstrap.js";
import { createDaemonBackedMemoryBridge } from "./runtime-daemon-memory-bridge.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";

export type ServePromptOptions = {
	sessionId?: string;
	title?: string;
	clientKey?: string;
	sessionLineageKey?: string;
	sessionReusePolicy?: "isolated" | "same_day";
	consumer?: string;
	surface?: string;
	channel?: string;
	actorId?: string;
	onEvent?: (type: string, data: unknown) => void;
	signal?: AbortSignal;
};

function extractServeResponseText(message: AgentMessage): string {
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function replayServeSessionIntoAgent(agent: Agent, session: Session): void {
	agent.clearMessages();
	for (const turn of session.turns) {
		const role = turn.role === "user" ? "user" : "assistant";
		const content = turn.contentParts?.length
			? turn.contentParts
			: [{ type: "text" as const, text: turn.content }];
		agent.pushMessage({
			id: crypto.randomUUID(),
			role,
			content: content as unknown as AgentMessage["content"],
			timestamp: Date.now(),
			agentId: turn.agent,
			model: turn.model,
		});
	}
}

async function createServeRequestAgent(baseAgent: Agent, projectPath: string): Promise<Agent> {
	const baseConfig = typeof baseAgent.getConfig === "function"
		? baseAgent.getConfig()
		: null;
	if (!baseConfig) {
		throw new Error("Serve base agent does not expose getConfig()");
	}
	const contextBridge = createDaemonBackedMemoryBridge({
		enabled: true,
		project: projectPath,
		enableSmaran: true,
		identityPath: projectPath,
	});
	const liveMemoryContext = await contextBridge.loadMemoryContext(projectPath, "serve-http");
	const requestConfig: AgentConfig = {
		...baseConfig,
		systemPrompt: liveMemoryContext?.trim().length
			? `${baseConfig.systemPrompt}\n\n${liveMemoryContext}`
			: baseConfig.systemPrompt,
		enableMemory: false,
		enableMesh: false,
		actorSystem: undefined,
		samiti: undefined,
		lokapala: undefined,
		kaala: undefined,
		commHub: undefined,
		memoryBridge: undefined,
	};
	const requestAgent = new Agent(requestConfig);
	const provider = baseAgent.getProvider();
	if (!provider) throw new Error("Serve agent provider is not initialized");
	requestAgent.setProvider(provider);
	return requestAgent;
}

export function buildServerHandlers(opts: {
	serverAgent: unknown;
	serverSession: Session | null;
	serveSessionScope: ServeSessionScope;
	registry: ProviderRegistry;
	projectPath: string;
	turiyaRouter?: TuriyaRouter;
	modules: ServePhaseModules;
	pairingEngine: { generateChallenge(): void; getTerminalDisplay(): string };
	budgetTracker: unknown;
	meshActorSystem?: unknown;
	getMeshBootstrapResult?: () => MeshBootstrapResult | undefined;
}): ApiDeps {
	const {
		serverAgent,
		serverSession,
		serveSessionScope,
		registry,
		projectPath,
		turiyaRouter,
		modules: m,
		pairingEngine,
		budgetTracker,
	} = opts;
	const serveAgent = serverAgent as Agent | null;
	const serveAgentConfig = typeof serveAgent?.getConfig === "function" ? serveAgent.getConfig() : undefined;
	const serveProfileId = serveAgentConfig?.profile?.id ?? "chitragupta";
	const serveModelId = typeof serveAgent?.getModel === "function" ? serveAgent.getModel() : "unknown";
	let currentSession = serverSession;
	let conversationQueue: Promise<void> = Promise.resolve();

	const acquireConversationLock = async (): Promise<() => void> => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const prior = conversationQueue;
		conversationQueue = prior.then(() => gate);
		await prior;
		return () => { release(); };
	};

	const openServeSession = async (options?: ServePromptOptions): Promise<{ session: Session; created: boolean }> => {
		if (options?.sessionId) {
			const session = await showSessionViaDaemon(options.sessionId, projectPath) as unknown as Session;
			currentSession = session;
			return { session, created: false };
		}

		const opened = await openSessionViaDaemon({
			project: projectPath,
			title: options?.title ?? "Serve Session",
			agent: serveProfileId,
			model: serveModelId,
			consumer: options?.consumer ?? "chitragupta",
			surface: options?.surface ?? "serve",
			channel: options?.channel ?? "http",
			actorId: options?.actorId ?? `serve:${process.pid}`,
			clientKey: options?.clientKey,
			sessionLineageKey: options?.sessionLineageKey,
			sessionReusePolicy: options?.sessionReusePolicy ?? "isolated",
		});
		const session = opened.session as unknown as Session;
		currentSession = session;
		return { session, created: opened.created };
	};

	return {
		getAgent: () => serverAgent,
		getSession: () => currentSession,
		loadSession: async (id: string) => {
			currentSession = await showSessionViaDaemon(id, projectPath) as unknown as Session;
			return currentSession;
		},
		openSession: async (options) => {
			const opened = await openServeSession(options as ServePromptOptions | undefined);
			return { id: opened.session.meta.id, created: opened.created };
		},
		openSharedSession: async (options) => {
			const opened = await openSharedSessionViaDaemon({
				project: projectPath,
				title: options?.title ?? "Shared Collaboration Session",
				agent: serveProfileId,
				model: serveModelId,
				consumer: options?.consumer ?? "chitragupta",
				surface: options?.surface ?? "collaboration",
				channel: options?.channel ?? "shared",
				actorId: options?.actorId ?? `serve:${process.pid}`,
				clientKey: options?.clientKey,
				sessionLineageKey: options?.sessionLineageKey,
			});
			const session = (opened.session ?? null) as unknown as Session | null;
			if (session) currentSession = session;
			return { id: session?.meta.id, session: session ?? undefined, created: opened.created };
		},
		listSessions: async () => {
			try {
				return await listSessionsViaDaemon(projectPath);
			} catch {
				return [];
			}
		},
		listProviders: () => registry.getAll().map((p) => ({ id: p.id, name: p.name })),
		listTools: () =>
			getAllTools().map((t) => ({
				name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
				description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
			})),
		prompt: serverAgent
			? async (message: string, options?: ServePromptOptions) => {
				const releaseConversation = await acquireConversationLock();
				let requestAgent: Agent | null = null;
				const abortHandler = () => requestAgent?.abort();
				try {
					if (!serveAgent) throw new Error("Serve agent not initialized");
					const opened = await openServeSession(options);
					const promptSession = opened.session;
					requestAgent = await createServeRequestAgent(serveAgent, projectPath);
					if (options?.onEvent) {
						const previousOnEvent = requestAgent.getConfig().onEvent;
						requestAgent.setOnEvent((event, data) => {
							previousOnEvent?.(event, data);
							options.onEvent?.(event, data);
						});
					}
					if (options?.signal?.aborted) throw new Error("Request aborted");
					options?.signal?.addEventListener("abort", abortHandler, { once: true });
					replayServeSessionIntoAgent(requestAgent, promptSession);
					if (m.servNidraDaemon) {
						try {
							await Promise.resolve(
								(m.servNidraDaemon as { notifySession(id: string): void | Promise<void> }).notifySession(
									`serve-chat:${promptSession.meta.id}`,
								),
							);
						} catch { /* best-effort */ }
						try {
							await Promise.resolve((m.servNidraDaemon as { touch(): void | Promise<void> }).touch());
						} catch { /* best-effort */ }
					}
					const promptInput = await applyLucyLiveGuidance(message, message, projectPath);
					const result = await serveSessionScope.runWithSession(
						promptSession.meta.id,
						() => requestAgent!.prompt(promptInput),
					);
					const text = extractServeResponseText(result);
					try {
						await addTurnViaDaemon(promptSession.meta.id, projectPath, {
							turnNumber: 0,
							role: "user",
							content: message,
						});
						await addTurnViaDaemon(promptSession.meta.id, projectPath, {
							turnNumber: 0,
							role: "assistant",
							content: text,
						});
						currentSession = await showSessionViaDaemon(promptSession.meta.id, projectPath) as unknown as Session;
					} catch (error) {
						if (!allowLocalRuntimeFallback()) throw error;
						const { addTurn, loadSession } = await import("@chitragupta/smriti/session-store");
						await addTurn(promptSession.meta.id, projectPath, {
							turnNumber: 0,
							role: "user",
							content: message,
						});
						await addTurn(promptSession.meta.id, projectPath, {
							turnNumber: 0,
							role: "assistant",
							content: text,
						});
						currentSession = loadSession(promptSession.meta.id, projectPath);
					}
					return text;
				} finally {
					options?.signal?.removeEventListener("abort", abortHandler);
					if (typeof requestAgent?.dispose === "function") requestAgent.dispose();
					releaseConversation();
				}
			}
			: undefined,
		getVasanaEngine: () => m.vasanaEngine,
		getNidraDaemon: () => m.servNidraDaemon,
		getVidhiEngine: () => m.vidhiEngine,
		getTuriyaRouter: () => turiyaRouter,
		getTriguna: () => {
			try {
				const liveTriguna = (serverAgent as Agent | null)?.getChetana()?.getTriguna?.();
				return liveTriguna ?? m.servTriguna;
			} catch {
				return m.servTriguna;
			}
		},
		getRtaEngine: () => m.servRtaEngine,
		getBuddhi: () => m.servBuddhi,
		getDatabase: () => m.servDatabase,
		getSamiti: () => m.servSamiti,
		getSabhaEngine: () => m.servSabhaEngine,
		getLokapala: () => m.servLokapala,
		getAkasha: () => m.servAkasha,
		getKartavyaEngine: () => m.servKartavyaEngine,
		getKalaChakra: () => m.servKalaChakra,
		getVidyaOrchestrator: () => m.servVidyaOrchestrator,
		getProjectPath: () => projectPath,
		getPairingEngine: () => pairingEngine,
		getBudgetTracker: () => budgetTracker,
		...buildMeshApiHandlers(opts.meshActorSystem, opts.getMeshBootstrapResult ?? (() => undefined)),
	};
}
