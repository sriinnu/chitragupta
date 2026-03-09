/**
 * Shared daemon-backed runtime proxies for CLI-owned subsystems.
 *
 * These adapters let TUI/API/serve mode talk to the single daemon-owned
 * nervous system without spinning parallel local owners.
 */

export interface NidraSnapshotLike {
	state: string;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart?: number;
	lastConsolidationEnd?: number;
	consolidationPhase?: string;
	consolidationProgress: number;
	uptime: number;
}

export interface DaemonNidraProxyLike {
	start(): void | Promise<void>;
	stop(): Promise<void>;
	touch(): void | Promise<void>;
	notifySession(sessionId: string): void | Promise<void>;
	wake(): void | Promise<void>;
	snapshot(): NidraSnapshotLike | Promise<NidraSnapshotLike>;
	onDream(cb: (progress: (...args: unknown[]) => void) => Promise<void>): void;
	onDeepSleep(cb: () => Promise<void>): void;
}

export interface DaemonBuddhiProxyLike {
	recordDecision(params: Record<string, unknown>): Promise<Record<string, unknown>>;
	listDecisions(opts: { project?: string; category?: string; limit?: number }): Promise<Array<Record<string, unknown>>>;
	getDecision(id: string): Promise<Record<string, unknown> | null>;
	explainDecision(id: string): Promise<string | null>;
}

export interface DaemonAkashaProxyLike {
	query(topic: string, opts?: { type?: string; limit?: number }): Promise<Array<Record<string, unknown>>>;
	leave(
		agentId: string,
		type: string,
		topic: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
	strongest(limit?: number): Promise<Array<Record<string, unknown>>>;
	stats(): Promise<Record<string, unknown>>;
	setOnEvent(handler: (event: { type: string; trace?: unknown }) => void): void;
}

export interface DaemonSabhaProxyLike {
	listActive(): Promise<Array<Record<string, unknown>>>;
	getSabha(id: string): Promise<Record<string, unknown> | undefined>;
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number; clientId?: string }>,
	): Promise<Record<string, unknown>>;
	propose(
		sabhaId: string,
		proposerId: string,
		syllogism: {
			pratijna: string;
			hetu: string;
			udaharana: string;
			upanaya: string;
			nigamana: string;
		},
	): Promise<Record<string, unknown>>;
	vote(
		sabhaId: string,
		participantId: string,
		position: "support" | "oppose" | "abstain",
		reasoning: string,
	): Promise<Record<string, unknown>>;
	submitPerspective(
		sabhaId: string,
		params: {
			participantId: string;
			summary: string;
			reasoning?: string;
			position?: "support" | "oppose" | "abstain" | "observe";
			recommendedAction?: string;
			evidence?: Array<Record<string, unknown>>;
			metadata?: Record<string, unknown>;
		},
	): Promise<Record<string, unknown>>;
	conclude(sabhaId: string): Promise<Record<string, unknown>>;
	explain(sabhaId: string): Promise<string>;
}

export function allowLocalRuntimeFallback(): boolean {
	const raw = (process.env.CHITRAGUPTA_ALLOW_LOCAL_RUNTIME_FALLBACK ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || process.env.NODE_ENV === "test";
}

export function allowLocalCollectiveFallback(): boolean {
	return process.env.NODE_ENV === "test";
}

export function createDaemonNidraProxy(): DaemonNidraProxyLike {
	return {
		start(): void {
			// Daemon owns Nidra lifecycle. Local callers should not start another loop.
		},
		async stop(): Promise<void> {
			// Daemon-owned lifecycle; local runtime shutdown must not stop the shared daemon.
		},
		async touch(): Promise<void> {
			const { touchNidraViaDaemon } = await import("./modes/daemon-bridge.js");
			await touchNidraViaDaemon();
		},
		async notifySession(sessionId: string): Promise<void> {
			const { notifyNidraSessionViaDaemon } = await import("./modes/daemon-bridge.js");
			await notifyNidraSessionViaDaemon(sessionId);
		},
		async wake(): Promise<void> {
			const { wakeNidraViaDaemon } = await import("./modes/daemon-bridge.js");
			await wakeNidraViaDaemon();
		},
		async snapshot(): Promise<NidraSnapshotLike> {
			const { getNidraStatusViaDaemon } = await import("./modes/daemon-bridge.js");
			const status = await getNidraStatusViaDaemon();
			return {
				state: String(status.state ?? "LISTENING"),
				lastStateChange: Number(status.lastStateChange ?? 0),
				lastHeartbeat: Number(status.lastHeartbeat ?? 0),
				lastConsolidationStart: status.lastConsolidationStart == null ? undefined : Number(status.lastConsolidationStart),
				lastConsolidationEnd: status.lastConsolidationEnd == null ? undefined : Number(status.lastConsolidationEnd),
				consolidationPhase: typeof status.consolidationPhase === "string" ? status.consolidationPhase : undefined,
				consolidationProgress: Number(status.consolidationProgress ?? 0),
				uptime: Number(status.uptimeMs ?? 0),
			};
		},
		onDream(_cb: (progress: (...args: unknown[]) => void) => Promise<void>): void {
			// Daemon owns dream-cycle hooks. Local callers must not attach parallel loops.
		},
		onDeepSleep(_cb: () => Promise<void>): void {
			// Daemon owns deep-sleep hooks. Local callers must not attach parallel loops.
		},
	};
}

export function createDaemonBuddhiProxy(): DaemonBuddhiProxyLike {
	return {
		async recordDecision(params: Record<string, unknown>): Promise<Record<string, unknown>> {
			const { recordBuddhiDecisionViaDaemon } = await import("./modes/daemon-bridge.js");
			return recordBuddhiDecisionViaDaemon(params);
		},
		async listDecisions(opts: { project?: string; category?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
			const { listBuddhiDecisionsViaDaemon } = await import("./modes/daemon-bridge.js");
			return listBuddhiDecisionsViaDaemon(opts);
		},
		async getDecision(id: string): Promise<Record<string, unknown> | null> {
			const { getBuddhiDecisionViaDaemon } = await import("./modes/daemon-bridge.js");
			return getBuddhiDecisionViaDaemon(id);
		},
		async explainDecision(id: string): Promise<string | null> {
			const { explainBuddhiDecisionViaDaemon } = await import("./modes/daemon-bridge.js");
			return explainBuddhiDecisionViaDaemon(id);
		},
	};
}

export function createDaemonAkashaProxy(): DaemonAkashaProxyLike {
	const listeners = new Set<(event: { type: string; trace?: unknown }) => void>();
	let notificationBound = false;

	const bindNotifications = async (): Promise<void> => {
		if (notificationBound) return;
		notificationBound = true;
		try {
			const { onDaemonNotification } = await import("./modes/daemon-bridge.js");
			await onDaemonNotification("akasha.trace_added", (params) => {
				const event = {
					type: typeof params?.type === "string" ? params.type : "trace_added",
					trace: params?.trace,
				};
				for (const listener of listeners) listener(event);
			});
		} catch {
			notificationBound = false;
		}
	};

	return {
		async query(topic: string, opts?: { type?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
			const { queryAkashaViaDaemon } = await import("./modes/daemon-bridge.js");
			return queryAkashaViaDaemon(topic, opts);
		},
		async leave(
			agentId: string,
			type: string,
			topic: string,
			content: string,
			metadata?: Record<string, unknown>,
		): Promise<Record<string, unknown>> {
			const { leaveAkashaViaDaemon } = await import("./modes/daemon-bridge.js");
			return leaveAkashaViaDaemon({ agentId, type, topic, content, metadata });
		},
		async strongest(limit?: number): Promise<Array<Record<string, unknown>>> {
			const { strongestAkashaViaDaemon } = await import("./modes/daemon-bridge.js");
			return strongestAkashaViaDaemon(limit ?? 20);
		},
		async stats(): Promise<Record<string, unknown>> {
			const { getAkashaStatsViaDaemon } = await import("./modes/daemon-bridge.js");
			return getAkashaStatsViaDaemon();
		},
		setOnEvent(handler: (event: { type: string; trace?: unknown }) => void): void {
			listeners.add(handler);
			void bindNotifications();
		},
	};
}

export function createDaemonSabhaProxy(): DaemonSabhaProxyLike {
	let localEnginePromise: Promise<{
		listActive(): Array<Record<string, unknown>>;
		getSabha(id: string): Record<string, unknown> | undefined;
		convene(
			topic: string,
			convener: string,
			participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
		): Record<string, unknown>;
		propose(sabhaId: string, proposerId: string, syllogism: Record<string, string>): unknown;
		vote(sabhaId: string, participantId: string, position: "support" | "oppose" | "abstain", reasoning: string): unknown;
		conclude(sabhaId: string): Record<string, unknown>;
		explain(sabhaId: string): string;
	}> | null = null;
	const localPerspectives = new Map<string, Map<string, Record<string, unknown>>>();

	const buildLocalSabhaState = (sabha: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
		if (!sabha) return undefined;
		const sabhaId = typeof sabha.id === "string" ? sabha.id : "";
		const perspectives = [...(localPerspectives.get(sabhaId)?.values() ?? [])];
		const participants = Array.isArray(sabha.participants) ? sabha.participants as Array<Record<string, unknown>> : [];
		const respondedParticipantIds = perspectives
			.map((perspective) => typeof perspective.participantId === "string" ? perspective.participantId : "")
			.filter((participantId) => participantId.length > 0);
		const respondedSet = new Set(respondedParticipantIds);
		const pendingParticipantIds = participants
			.map((participant) => typeof participant.id === "string" ? participant.id : "")
			.filter((participantId) => participantId.length > 0 && !respondedSet.has(participantId));
		return {
			...sabha,
			perspectives,
			respondedParticipantIds,
			pendingParticipantIds,
			consultationSummary: {
				perspectiveCount: perspectives.length,
				respondedCount: respondedParticipantIds.length,
				pendingCount: pendingParticipantIds.length,
			},
		};
	};

	const getLocalEngine = async () => {
		if (!localEnginePromise) {
			localEnginePromise = import("@chitragupta/sutra").then(({ SabhaEngine }) => new SabhaEngine() as never);
		}
		return localEnginePromise;
	};

	const withFallback = async <T>(
		primary: () => Promise<T>,
		fallback: (engine: Awaited<ReturnType<typeof getLocalEngine>>) => Promise<T> | T,
	): Promise<T> => {
		try {
			return await primary();
		} catch (err) {
			if (!allowLocalCollectiveFallback()) throw err;
			const engine = await getLocalEngine();
			return await fallback(engine);
		}
	};

		return {
			async listActive(): Promise<Array<Record<string, unknown>>> {
				return withFallback(async () => {
					const { listActiveSabhasViaDaemon } = await import("./modes/daemon-bridge.js");
					return listActiveSabhasViaDaemon();
				}, async (engine) => engine.listActive().map((sabha) => buildLocalSabhaState(sabha) ?? sabha));
			},
				async getSabha(id: string): Promise<Record<string, unknown> | undefined> {
					return withFallback(async () => {
						const { getSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
						return (await getSabhaViaDaemon(id))?.sabha;
					}, async (engine) => buildLocalSabhaState(engine.getSabha(id) ?? undefined));
				},
		async convene(
			topic: string,
			convener: string,
			participants: Array<{ id: string; role: string; expertise: number; credibility: number; clientId?: string }>,
			): Promise<Record<string, unknown>> {
				return withFallback(async () => {
					const { askSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await askSabhaViaDaemon({ topic, convener, participants })).sabha;
				}, async (engine) => buildLocalSabhaState(engine.convene(topic, convener, participants)) ?? { id: "" });
			},
		async propose(
			sabhaId: string,
			proposerId: string,
			syllogism: {
				pratijna: string;
				hetu: string;
				udaharana: string;
				upanaya: string;
				nigamana: string;
			},
			): Promise<Record<string, unknown>> {
				return withFallback(async () => {
					const { deliberateSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await deliberateSabhaViaDaemon({ id: sabhaId, proposerId, syllogism, conclude: false })).sabha;
				}, async (engine) => {
					engine.propose(sabhaId, proposerId, syllogism);
					return buildLocalSabhaState(engine.getSabha(sabhaId) ?? undefined) ?? { id: sabhaId };
				});
			},
		async vote(
			sabhaId: string,
			participantId: string,
			position: "support" | "oppose" | "abstain",
			reasoning: string,
			): Promise<Record<string, unknown>> {
				return withFallback(async () => {
					const { voteSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await voteSabhaViaDaemon({ id: sabhaId, participantId, position, reasoning })).sabha;
				}, async (engine) => {
					engine.vote(sabhaId, participantId, position, reasoning);
					return buildLocalSabhaState(engine.getSabha(sabhaId) ?? undefined) ?? { id: sabhaId };
				});
			},
			async submitPerspective(
				sabhaId: string,
				params: {
					participantId: string;
					summary: string;
					reasoning?: string;
					position?: "support" | "oppose" | "abstain" | "observe";
					recommendedAction?: string;
					evidence?: Array<Record<string, unknown>>;
					metadata?: Record<string, unknown>;
				},
			): Promise<Record<string, unknown>> {
				return withFallback(async () => {
					const { submitSabhaPerspectiveViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await submitSabhaPerspectiveViaDaemon({
						id: sabhaId,
						...params,
					})).sabha;
				}, async (engine) => {
					const sabha = engine.getSabha(sabhaId);
					if (!sabha) throw new Error(`Sabha '${sabhaId}' not found.`);
					const perspectives = localPerspectives.get(sabhaId) ?? new Map<string, Record<string, unknown>>();
					perspectives.set(params.participantId, {
						participantId: params.participantId,
						summary: params.summary,
						reasoning: params.reasoning ?? params.summary,
						position: params.position ?? "observe",
						recommendedAction: params.recommendedAction ?? null,
						evidence: params.evidence ?? [],
						metadata: params.metadata ?? {},
						submittedAt: Date.now(),
					});
					localPerspectives.set(sabhaId, perspectives);
					return buildLocalSabhaState(sabha) ?? sabha;
				});
			},
			async conclude(sabhaId: string): Promise<Record<string, unknown>> {
				return withFallback(async () => {
					const { deliberateSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await deliberateSabhaViaDaemon({ id: sabhaId, conclude: true })).sabha;
				}, async (engine) => buildLocalSabhaState(engine.conclude(sabhaId)) ?? { id: sabhaId });
			},
			async explain(sabhaId: string): Promise<string> {
				return withFallback(async () => {
					const { getSabhaViaDaemon } = await import("./modes/daemon-bridge.js");
					return (await getSabhaViaDaemon(sabhaId))?.explanation ?? "";
				}, async (engine) => engine.explain(sabhaId));
			},
	};
}
