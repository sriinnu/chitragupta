/**
 * Shared daemon-backed helpers for research council execution.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import {
	type ResearchCouncilSummary,
	type ResearchScope,
	summarizeCouncilParticipants,
} from "./chitragupta-nodes-research-shared.js";

type DaemonClientLike = {
	call(method: string, params?: Record<string, unknown>): Promise<unknown>;
	disconnect(): void;
};

export type LucyGuidance = {
	hit: { entity: string; content: string; source: string } | null;
	predictions: Array<{ entity: string; confidence: number; source: string }>;
	liveSignals: Array<Record<string, unknown>>;
};

export type ResearchRouteSummary = {
	routeClass: string | null;
	capability: string | null;
	selectedCapabilityId: string | null;
	executionBinding: {
		source: string;
		kind: string;
		query?: {
			capability: string;
			mode?: string;
			role?: string;
		};
		selectedModelId?: string;
		selectedProviderId?: string;
		candidateModelIds?: string[];
		preferredModelIds?: string[];
		preferredProviderIds?: string[];
		preferLocalProviders?: boolean;
		allowCrossProvider?: boolean;
	} | null;
	degraded: boolean;
	discoverableOnly: boolean;
	reason: string | null;
	policyTrace: string[];
};

export type BatchResolvedRoute = {
	key?: unknown;
	request?: { capability?: unknown };
	selected?: { id?: unknown } | null;
	routeClass?: { id?: unknown; capability?: unknown } | null;
	executionBinding?: {
		source?: unknown;
		kind?: unknown;
		query?: { capability?: unknown; mode?: unknown; role?: unknown } | null;
		selectedModelId?: unknown;
		selectedProviderId?: unknown;
		candidateModelIds?: unknown;
		preferredModelIds?: unknown;
		preferredProviderIds?: unknown;
		preferLocalProviders?: unknown;
		allowCrossProvider?: unknown;
	} | null;
	degraded?: unknown;
	discoverableOnly?: unknown;
	reason?: unknown;
	policyTrace?: unknown;
};

export function requireResolvedResearchRoute(
	route: ResearchRouteSummary | null,
	message: string,
): ResearchRouteSummary {
	if (!route) throw new Error(message);
	return route;
}

function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeExecutionBinding(
	binding: BatchResolvedRoute["executionBinding"],
): ResearchRouteSummary["executionBinding"] {
	if (!binding || typeof binding !== "object") return null;
	const capability = typeof binding.query?.capability === "string" ? binding.query.capability : null;
	return {
		source: typeof binding.source === "string" ? binding.source : "engine",
		kind: typeof binding.kind === "string" ? binding.kind : "model",
		query: capability
			? {
				capability,
				...(typeof binding.query?.mode === "string" ? { mode: binding.query.mode } : {}),
				...(typeof binding.query?.role === "string" ? { role: binding.query.role } : {}),
			}
			: undefined,
		selectedModelId: typeof binding.selectedModelId === "string" ? binding.selectedModelId : undefined,
		selectedProviderId: typeof binding.selectedProviderId === "string" ? binding.selectedProviderId : undefined,
		candidateModelIds: normalizeStringList(binding.candidateModelIds),
		preferredModelIds: normalizeStringList(binding.preferredModelIds),
		preferredProviderIds: normalizeStringList(binding.preferredProviderIds),
		preferLocalProviders: binding.preferLocalProviders === true,
		allowCrossProvider: binding.allowCrossProvider !== false,
	};
}

export function toResearchRouteSummary(
	resolved: BatchResolvedRoute | null | undefined,
	fallbackRouteClass: string | null,
	fallbackCapability: string | null = null,
): ResearchRouteSummary | null {
	if (!resolved) return null;
	return {
		routeClass: typeof resolved.routeClass?.id === "string" ? resolved.routeClass.id : fallbackRouteClass,
		capability: typeof resolved.request?.capability === "string"
			? resolved.request.capability
			: typeof resolved.routeClass?.capability === "string"
				? resolved.routeClass.capability
				: fallbackCapability,
		selectedCapabilityId: typeof resolved.selected?.id === "string" ? resolved.selected.id : null,
		executionBinding: normalizeExecutionBinding(resolved.executionBinding),
		degraded: resolved.degraded === true,
		discoverableOnly: resolved.discoverableOnly === true,
		reason: typeof resolved.reason === "string" ? resolved.reason : null,
		policyTrace: Array.isArray(resolved.policyTrace)
			? resolved.policyTrace.filter((value): value is string => typeof value === "string")
			: [],
	};
}

export function councilLucyRecommendation(council: Record<string, unknown>): string {
	if (typeof council.lucyRecommendation === "string") return council.lucyRecommendation;
	const lucy = council.lucy;
	if (lucy && typeof lucy === "object") {
		const recommendation = (lucy as { recommendation?: unknown }).recommendation;
		if (typeof recommendation === "string") return recommendation;
	}
	return "unknown";
}

export function scopeRecommendation(
	signals: Array<Record<string, unknown>>,
): "support" | "caution" | "block" {
	const severities = signals.map((signal) => String(signal.severity ?? "warning").toLowerCase());
	if (severities.includes("critical")) return "block";
	if (severities.includes("warning")) return "caution";
	return "support";
}

export async function packLiveResearchSignalText(text: string): Promise<string> {
	if (!text.trim() || text.length < 420) return text;
	const daemonPacked = await withDaemonClient(async (client) => {
		try {
			return await client.call("compression.pack_context", { text }) as Record<string, unknown>;
		} catch {
			return null;
		}
	});
	if (daemonPacked) {
		if (daemonPacked.packed === false) return text;
		if (typeof daemonPacked.packedText === "string" && daemonPacked.packedText.trim()) {
			return daemonPacked.packedText.trim();
		}
	}
	try {
		const { packLiveContextText } = await dynamicImport("@chitragupta/smriti");
		const localPacked = await packLiveContextText(text);
		if (localPacked?.packedText?.trim()) return localPacked.packedText.trim();
	} catch {
		// Fall through to raw text.
	}
	return text;
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

export async function withDaemonClient<T>(
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

export function buildCouncilSummary(
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
	}) as BatchResolvedRoute;
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
	}) as BatchResolvedRoute;
	return toResearchRouteSummary(resolved, scope.executionRouteClass, scope.executionCapability);
}

export async function resolveResearchRouteBatch(
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

export async function buildPackedResearchSignalText(text: string): Promise<string> {
	return packLiveResearchSignalText(text);
}

export type { DaemonClientLike };
