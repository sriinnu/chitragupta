import { daemonCall } from "./daemon-bridge.js";

export interface EngineRouteResolution {
	routeClass?: { id?: string; capability?: string } | null;
	request?: { capability?: string } | null;
	selected?: { id?: string } | null;
	executionBinding?: {
		source?: "engine" | "kosha-discovery";
		kind?: "executor" | "model";
		query?: { capability?: string; mode?: string; role?: string } | null;
		selectedModelId?: string;
		selectedProviderId?: string;
		candidateModelIds?: string[];
		preferredModelIds?: string[];
		preferredProviderIds?: string[];
		preferLocalProviders?: boolean;
		allowCrossProvider?: boolean;
	} | null;
	reason?: string | null;
	policyTrace?: string[];
}

export interface ResolvedEngineBridgeRoute {
	routeClass?: string;
	capability?: string | null;
	selectedCapabilityId?: string | null;
	executionBinding?: {
		source: "engine" | "kosha-discovery";
		kind: "executor" | "model";
		query?: { capability: string; mode?: string; role?: string };
		selectedModelId?: string;
		selectedProviderId?: string;
		candidateModelIds?: string[];
		preferredModelIds?: string[];
		preferredProviderIds?: string[];
		preferLocalProviders?: boolean;
		allowCrossProvider?: boolean;
	} | null;
	enforced?: boolean;
	reason?: string | null;
	policyTrace?: string[];
}

export interface ResolvedEngineRouteEnvelope {
	primaryKey: string;
	lanes: Array<
		ResolvedEngineBridgeRoute & {
			key: string;
		}
	>;
}

export interface EngineRouteRequestOptions {
	task: string;
	cwd: string;
	sessionId?: string;
	consumer?: string;
	routeClass?: string;
	capability?: string;
}

interface EngineBatchRouteResolution extends EngineRouteResolution {
	key?: string;
}

const STRICT_REVIEW_PATTERNS = [
	/\breview\b/i,
	/\baudit\b/i,
	/\bsecurity\b/i,
	/\bregression\b/i,
	/\bthreat model\b/i,
];

const DEEP_REASONING_PATTERNS = [
	/\brefactor\b/i,
	/\barchitecture\b/i,
	/\bdesign\b/i,
	/\binvestigate\b/i,
	/\bdebug\b/i,
	/\broot cause\b/i,
	/\banaly[sz]e\b/i,
	/\bexplain\b/i,
];

const HIGH_TRUST_EXECUTION_PATTERNS = [
	/\bmigrate\b/i,
	/\bdeploy\b/i,
	/\brelease\b/i,
	/\bproduction\b/i,
	/\bexecute\b/i,
	/\bvalidate\b/i,
	/\bverification\b/i,
];

const DEFAULT_TAKUMI_ROUTE_ENVELOPE: Array<{
	key: string;
	routeClass: string;
}> = [
	{ key: "planner", routeClass: "coding.deep-reasoning" },
	{ key: "implementer", routeClass: "coding.patch-cheap" },
	{ key: "reviewer", routeClass: "coding.review.strict" },
	{ key: "validator", routeClass: "coding.validation-high-trust" },
];

export function inferCodingRouteClass(task: string): string {
	if (STRICT_REVIEW_PATTERNS.some((pattern) => pattern.test(task))) {
		return "coding.review.strict";
	}
	if (HIGH_TRUST_EXECUTION_PATTERNS.some((pattern) => pattern.test(task))) {
		return "coding.validation-high-trust";
	}
	if (DEEP_REASONING_PATTERNS.some((pattern) => pattern.test(task))) {
		return "coding.deep-reasoning";
	}
	return "coding.patch-cheap";
}

export function resolveRequestedEngineRouteClass(
	options: EngineRouteRequestOptions,
): string | undefined {
	if (typeof options.routeClass === "string" && options.routeClass.trim()) {
		return options.routeClass.trim();
	}
	if (!options.sessionId || options.capability) return undefined;
	return inferCodingRouteClass(options.task);
}

export function requiresEngineRoute(
	options: EngineRouteRequestOptions,
	requestedRouteClass = resolveRequestedEngineRouteClass(options),
): boolean {
	return Boolean(options.sessionId && (requestedRouteClass || options.capability));
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value.filter(
		(entry): entry is string =>
			typeof entry === "string" && entry.trim().length > 0,
	);
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeResolvedEngineRoute(
	resolved: EngineRouteResolution | null | undefined,
	fallbackRouteClass?: string,
	fallbackCapability?: string,
): ResolvedEngineBridgeRoute | null {
	if (!resolved) return null;
	return {
		routeClass:
			typeof resolved.routeClass?.id === "string"
				? resolved.routeClass.id
				: fallbackRouteClass,
		capability:
			typeof resolved.request?.capability === "string"
				? resolved.request.capability
				: typeof resolved.routeClass?.capability === "string"
					? resolved.routeClass.capability
					: fallbackCapability ?? null,
		selectedCapabilityId:
			typeof resolved.selected?.id === "string" ? resolved.selected.id : null,
		executionBinding:
			typeof resolved.executionBinding === "object" &&
			resolved.executionBinding !== null
				? {
						source:
							resolved.executionBinding.source === "engine"
								? "engine"
								: "kosha-discovery",
						kind:
							resolved.executionBinding.kind === "model"
								? "model"
								: "executor",
						query:
							typeof resolved.executionBinding.query === "object" &&
							resolved.executionBinding.query !== null &&
							typeof resolved.executionBinding.query.capability === "string"
								? {
										capability: resolved.executionBinding.query.capability,
										...(typeof resolved.executionBinding.query.mode === "string"
											? { mode: resolved.executionBinding.query.mode }
											: {}),
										...(typeof resolved.executionBinding.query.role === "string"
											? { role: resolved.executionBinding.query.role }
											: {}),
									}
								: undefined,
						selectedModelId:
							typeof resolved.executionBinding.selectedModelId === "string"
								? resolved.executionBinding.selectedModelId
								: undefined,
						selectedProviderId:
							typeof resolved.executionBinding.selectedProviderId === "string"
								? resolved.executionBinding.selectedProviderId
								: undefined,
						candidateModelIds: normalizeStringArray(
							resolved.executionBinding.candidateModelIds,
						),
						preferredModelIds: normalizeStringArray(
							resolved.executionBinding.preferredModelIds,
						),
						preferredProviderIds: normalizeStringArray(
							resolved.executionBinding.preferredProviderIds,
						),
						preferLocalProviders:
							resolved.executionBinding.preferLocalProviders === true,
						allowCrossProvider:
							resolved.executionBinding.allowCrossProvider !== false,
					}
				: null,
		enforced: true,
		reason: typeof resolved.reason === "string" ? resolved.reason : null,
		policyTrace: Array.isArray(resolved.policyTrace)
			? resolved.policyTrace.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
	};
}

function buildTakumiRouteEnvelopeRequests(
	requestedRouteClass: string | undefined,
	capability: string | undefined,
): Array<{ key: string; routeClass?: string; capability?: string }> {
	const routes: Array<{ key: string; routeClass?: string; capability?: string }> =
		[
			{
				key: "primary",
				...(requestedRouteClass ? { routeClass: requestedRouteClass } : {}),
				...(capability ? { capability } : {}),
			},
		];
	for (const lane of DEFAULT_TAKUMI_ROUTE_ENVELOPE) {
		routes.push({ key: lane.key, routeClass: lane.routeClass });
	}
	return routes;
}

function normalizeEngineRouteEnvelope(
	resolutions: EngineBatchRouteResolution[],
	primaryRoute: ResolvedEngineBridgeRoute | null,
	requestedRouteClass: string | undefined,
	capability: string | undefined,
): ResolvedEngineRouteEnvelope | undefined {
	if (!Array.isArray(resolutions) || resolutions.length === 0) {
		if (!primaryRoute) return undefined;
		return {
			primaryKey: "primary",
			lanes: [{ key: "primary", ...primaryRoute }],
		};
	}
	const lanes = resolutions
		.map((resolved, index) => {
			const key =
				typeof resolved.key === "string" && resolved.key.trim().length > 0
					? resolved.key
					: `lane-${index + 1}`;
			const route = normalizeResolvedEngineRoute(
				resolved,
				key === "primary" ? requestedRouteClass : undefined,
				key === "primary" ? capability : undefined,
			);
			return route ? { key, ...route } : null;
		})
		.filter(
			(
				lane,
			): lane is ResolvedEngineRouteEnvelope["lanes"][number] => lane !== null,
		);
	if (primaryRoute) {
		const primaryIndex = lanes.findIndex((lane) => lane.key === "primary");
		if (primaryIndex >= 0) {
			lanes[primaryIndex] = { key: "primary", ...primaryRoute };
		} else {
			lanes.unshift({ key: "primary", ...primaryRoute });
		}
	}
	if (lanes.length === 0) return undefined;
	return {
		primaryKey: lanes.some((lane) => lane.key === "primary")
			? "primary"
			: lanes[0].key,
		lanes,
	};
}

export function isTakumiCompatibleEngineLane(
	route: ResolvedEngineBridgeRoute,
): boolean {
	if (route.selectedCapabilityId === "adapter.takumi.executor") return true;

	const selected = route.selectedCapabilityId ?? "";
	if (selected.startsWith("discovery.model.")) return true;
	if (selected.startsWith("engine.local.")) return true;

	const capability = route.capability?.trim().toLowerCase();
	if (!capability) return false;
	return (
		capability === "chat" ||
		capability === "function_calling" ||
		capability === "model.chat" ||
		capability === "model.tool-use" ||
		capability === "model.local.chat" ||
		capability === "model.local.tool-use"
	);
}

export async function resolveEngineRoutes(
	options: EngineRouteRequestOptions,
): Promise<{
	route: ResolvedEngineBridgeRoute | null;
	envelope?: ResolvedEngineRouteEnvelope;
	error?: string;
}> {
	const requestedRouteClass = resolveRequestedEngineRouteClass(options);
	if (!requiresEngineRoute(options, requestedRouteClass)) {
		return { route: null };
	}
	try {
		const resolved = await daemonCall<EngineRouteResolution>("route.resolve", {
			consumer: options.consumer ?? "cli:takumi-bridge",
			sessionId: options.sessionId,
			routeClass: requestedRouteClass,
			capability: options.capability,
			context: {
				cwd: options.cwd,
				surface: "cli:takumi-bridge",
			},
		});
		const primaryRoute = normalizeResolvedEngineRoute(
			resolved,
			requestedRouteClass,
			options.capability,
		);
		let envelope = primaryRoute
			? {
					primaryKey: "primary",
					lanes: [{ key: "primary", ...primaryRoute }],
				}
			: undefined;
		try {
			const batch = await daemonCall<{ resolutions?: EngineBatchRouteResolution[] }>(
				"route.resolveBatch",
				{
					consumer: options.consumer ?? "cli:takumi-bridge",
					sessionId: options.sessionId,
					routes: buildTakumiRouteEnvelopeRequests(
						requestedRouteClass,
						options.capability,
					),
				},
			);
			envelope = normalizeEngineRouteEnvelope(
				Array.isArray(batch?.resolutions) ? batch.resolutions : [],
				primaryRoute,
				requestedRouteClass,
				options.capability,
			);
		} catch {
			// Keep the primary authoritative route even when envelope expansion fails.
		}
		return { route: primaryRoute, envelope };
	} catch (error) {
		return {
			route: null,
			error: `Engine route resolution failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}
