import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";

export type ResearchExecutionRoute = {
	routeClass?: unknown;
	capability?: unknown;
	selectedCapabilityId?: unknown;
	discoverableOnly?: unknown;
	reason?: unknown;
	executionBinding?: {
		source?: unknown;
		selectedModelId?: unknown;
		selectedProviderId?: unknown;
		preferredModelIds?: unknown;
		preferredProviderIds?: unknown;
		candidateModelIds?: unknown;
		allowCrossProvider?: unknown;
	} | null;
} | null;

export type ResearchRoundContext = {
	plannerRoute?: ResearchExecutionRoute;
	roundNumber?: number;
	totalRounds?: number;
	carryContext?: string | null;
} | null;

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function extractGatingRoute(council: Record<string, unknown>): ResearchExecutionRoute {
	return council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchExecutionRoute
		: council.route && typeof council.route === "object"
			? council.route as ResearchExecutionRoute
			: null;
}

export function extractExecutionRoute(council: Record<string, unknown>): ResearchExecutionRoute {
	return council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchExecutionRoute
		: null;
}

export function extractPlannerRoute(council: Record<string, unknown>): ResearchExecutionRoute {
	return council.plannerRoute && typeof council.plannerRoute === "object"
		? council.plannerRoute as ResearchExecutionRoute
		: null;
}

/**
 * Materialize the daemon-selected research lane into environment variables the child process can consume.
 * This keeps the runner policy-authoritative without forcing every experiment binary to speak daemon RPC.
 */
export function buildResearchExecutionEnv(
	scope: ResearchScope,
	executionRoute: ResearchExecutionRoute,
	roundContext: ResearchRoundContext = null,
): Record<string, string> {
	if (!executionRoute) return {};
	const env: Record<string, string> = {};
	if (scope.executionRouteClass) env.CHITRAGUPTA_ROUTE_CLASS = scope.executionRouteClass;
	if (scope.executionCapability) env.CHITRAGUPTA_ROUTE_CAPABILITY = scope.executionCapability;
	if (typeof executionRoute.routeClass === "string" && executionRoute.routeClass.trim()) {
		env.CHITRAGUPTA_EXECUTION_ROUTE_CLASS = executionRoute.routeClass.trim();
	}
	if (typeof executionRoute.capability === "string" && executionRoute.capability.trim()) {
		env.CHITRAGUPTA_EXECUTION_CAPABILITY = executionRoute.capability.trim();
	}
	if (typeof executionRoute.selectedCapabilityId === "string" && executionRoute.selectedCapabilityId.trim()) {
		env.CHITRAGUPTA_SELECTED_CAPABILITY_ID = executionRoute.selectedCapabilityId.trim();
	}
	const binding = executionRoute.executionBinding;
	if (!binding || typeof binding !== "object") return env;
	env.CHITRAGUPTA_EXECUTION_BINDING = JSON.stringify(binding);
	if (typeof binding.source === "string" && binding.source.trim()) {
		env.CHITRAGUPTA_EXECUTION_BINDING_SOURCE = binding.source.trim();
	}
	if (typeof binding.selectedModelId === "string" && binding.selectedModelId.trim()) {
		env.CHITRAGUPTA_SELECTED_MODEL_ID = binding.selectedModelId.trim();
	}
	if (typeof binding.selectedProviderId === "string" && binding.selectedProviderId.trim()) {
		env.CHITRAGUPTA_SELECTED_PROVIDER_ID = binding.selectedProviderId.trim();
	}
	const preferredModelIds = normalizeStringList(binding.preferredModelIds);
	if (preferredModelIds.length > 0) env.CHITRAGUPTA_PREFERRED_MODEL_IDS = preferredModelIds.join(",");
	const preferredProviderIds = normalizeStringList(binding.preferredProviderIds);
	if (preferredProviderIds.length > 0) env.CHITRAGUPTA_PREFERRED_PROVIDER_IDS = preferredProviderIds.join(",");
	const candidateModelIds = normalizeStringList(binding.candidateModelIds);
	if (candidateModelIds.length > 0) env.CHITRAGUPTA_CANDIDATE_MODEL_IDS = candidateModelIds.join(",");
	if (binding.allowCrossProvider === false) env.CHITRAGUPTA_ALLOW_CROSS_PROVIDER = "0";
	const plannerRoute = roundContext?.plannerRoute;
	if (typeof plannerRoute?.routeClass === "string" && plannerRoute.routeClass.trim()) {
		env.CHITRAGUPTA_PLANNER_ROUTE_CLASS = plannerRoute.routeClass.trim();
	}
	if (typeof plannerRoute?.selectedCapabilityId === "string" && plannerRoute.selectedCapabilityId.trim()) {
		env.CHITRAGUPTA_PLANNER_SELECTED_CAPABILITY_ID = plannerRoute.selectedCapabilityId.trim();
	}
	if (typeof plannerRoute?.executionBinding?.selectedModelId === "string" && plannerRoute.executionBinding.selectedModelId.trim()) {
		env.CHITRAGUPTA_PLANNER_SELECTED_MODEL_ID = plannerRoute.executionBinding.selectedModelId.trim();
	}
	if (typeof plannerRoute?.executionBinding?.selectedProviderId === "string" && plannerRoute.executionBinding.selectedProviderId.trim()) {
		env.CHITRAGUPTA_PLANNER_SELECTED_PROVIDER_ID = plannerRoute.executionBinding.selectedProviderId.trim();
	}
	if (typeof roundContext?.roundNumber === "number") env.CHITRAGUPTA_RESEARCH_ROUND_NUMBER = String(roundContext.roundNumber);
	if (typeof roundContext?.totalRounds === "number") env.CHITRAGUPTA_RESEARCH_TOTAL_ROUNDS = String(roundContext.totalRounds);
	if (typeof roundContext?.carryContext === "string" && roundContext.carryContext.trim()) {
		env.CHITRAGUPTA_RESEARCH_ROUND_CONTEXT = roundContext.carryContext.trim();
	}
	return env;
}
