import crypto from "node:crypto";
import type { TakumiContext, TakumiResponse } from "./takumi-bridge-types.js";
import {
	auditTakumiResponseAgainstContract,
	extractTakumiErrorMessage as extractErrorMessage,
} from "./takumi-bridge-context-audit.js";
import {
	buildTakumiPrompt as buildPrompt,
	isFreshContext,
	resolveCacheIntent,
	truncate,
} from "./takumi-bridge-context-format.js";
export {
	buildTakumiPrompt as buildPrompt,
	isFreshContext,
	resolveCacheIntent,
	truncate,
} from "./takumi-bridge-context-format.js";
export {
	auditTakumiResponseAgainstContract,
	extractTakumiErrorMessage as extractErrorMessage,
} from "./takumi-bridge-context-audit.js";

export const MAX_REPO_MAP_CHARS = 4_000;
export const MAX_HINT_CHARS = 280;
export const MAX_HINT_COUNT = 8;
export const MAX_FILE_CONTEXT_FILES = 3;
export const MAX_FILE_CONTEXT_CHARS = 1_200;
export const MAX_PACKED_CONTEXT_CHARS = 1_800;
export const MAX_PACKED_HINT_CHARS = 1_400;
export const MIN_PACK_HINT_SECTION_CHARS = 420;
export const MIN_PACK_HINT_SECTION_ITEMS = 4;
export const MAX_ENV_CONTEXT_CHARS = 1_600;

interface SerializedEnvValue {
	serialized: string;
	omitted: boolean;
}

/** Structured env payload plus contract violations detected during Takumi context inspection. */
export interface TakumiContextContractInspection {
	env: Record<string, string>;
	violations: string[];
}

interface TakumiExecutionObservation {
	providerIds: string[];
	modelIds: string[];
}

/** Build the structured env block that Takumi receives for daemon-owned route and memory state. */
export function buildContextEnv(context?: TakumiContext): Record<string, string> {
	return inspectTakumiContextContract(context).env;
}

/** Inspect Takumi context transportability and detect enforced-route omissions before execution. */
export function inspectTakumiContextContract(context?: TakumiContext): TakumiContextContractInspection {
	if (!context) return { env: {}, violations: [] };
	const env: Record<string, string> = {};
	const violations: string[] = [];

	if (isFreshContext(context)) {
		env.CHITRAGUPTA_NO_CACHE = "1";
		env.CHITRAGUPTA_FRESH = "1";
	}
	if (context.episodicHints?.length) {
		assignJsonEnv(env, "CHITRAGUPTA_EPISODIC_HINTS", context.episodicHints, "CHITRAGUPTA_EPISODIC_HINTS_OMITTED");
	}
	if (context.recentDecisions?.length) {
		assignJsonEnv(env, "CHITRAGUPTA_RECENT_DECISIONS", context.recentDecisions, "CHITRAGUPTA_RECENT_DECISIONS_OMITTED");
	}
	if (context.fileContext && Object.keys(context.fileContext).length > 0) {
		assignJsonEnv(env, "CHITRAGUPTA_FILE_CONTEXT", context.fileContext, "CHITRAGUPTA_FILE_CONTEXT_OMITTED");
	}
	if (context.engineRoute) {
		const routeValue = serializeJsonEnvValue(context.engineRoute);
		if (!routeValue.omitted) {
			env.CHITRAGUPTA_ENGINE_ROUTE = routeValue.serialized;
		} else {
			env.CHITRAGUPTA_ENGINE_ROUTE_OMITTED = "1";
		}
		env.CHITRAGUPTA_ENGINE_ROUTE_DIGEST = hashContextValue(routeValue.serialized);
		if (context.engineRoute.routeClass) {
			env.CHITRAGUPTA_ROUTE_CLASS = context.engineRoute.routeClass;
		}
		if (context.engineRoute.capability) {
			env.CHITRAGUPTA_ROUTE_CAPABILITY = context.engineRoute.capability;
		}
		if (context.engineRoute.selectedCapabilityId) {
			env.CHITRAGUPTA_SELECTED_CAPABILITY_ID = context.engineRoute.selectedCapabilityId;
		}
		if (context.engineRoute.executionBinding) {
			assignJsonEnv(
				env,
				"CHITRAGUPTA_EXECUTION_BINDING",
				context.engineRoute.executionBinding,
				"CHITRAGUPTA_EXECUTION_BINDING_OMITTED",
			);
			if (context.engineRoute.executionBinding.selectedModelId) {
				env.CHITRAGUPTA_SELECTED_MODEL_ID = context.engineRoute.executionBinding.selectedModelId;
			}
			if (context.engineRoute.executionBinding.selectedProviderId) {
				env.CHITRAGUPTA_SELECTED_PROVIDER_ID = context.engineRoute.executionBinding.selectedProviderId;
			}
			if (context.engineRoute.executionBinding.preferredModelIds?.length) {
				env.CHITRAGUPTA_PREFERRED_MODEL_IDS = context.engineRoute.executionBinding.preferredModelIds.join(",");
			}
			if (context.engineRoute.executionBinding.preferredProviderIds?.length) {
				env.CHITRAGUPTA_PREFERRED_PROVIDER_IDS = context.engineRoute.executionBinding.preferredProviderIds.join(",");
			}
			if (context.engineRoute.executionBinding.candidateModelIds?.length) {
				env.CHITRAGUPTA_ALLOWED_MODEL_IDS = context.engineRoute.executionBinding.candidateModelIds.join(",");
			}
			if (context.engineRoute.executionBinding.preferLocalProviders === true) {
				env.CHITRAGUPTA_PREFER_LOCAL_PROVIDERS = "1";
			}
			env.CHITRAGUPTA_ALLOW_CROSS_PROVIDER =
				context.engineRoute.executionBinding.allowCrossProvider === false
					? "0"
					: "1";
		}
		if (context.engineRoute.enforced === true) {
			env.CHITRAGUPTA_ENGINE_ROUTE_ENFORCED = "1";
			if (!hasAuthoritativeSelection(context.engineRoute.selectedCapabilityId, context.engineRoute.executionBinding)) {
				violations.push("Engine route is enforced but does not pin a capability, provider, or model.");
			}
			if (routeValue.omitted) {
				violations.push("Engine route is enforced but too large for structured Takumi env transport.");
			}
		}
	}
	if (context.engineRouteEnvelope?.lanes.length) {
		const envelopeValue = serializeJsonEnvValue(context.engineRouteEnvelope);
		if (!envelopeValue.omitted) {
			env.CHITRAGUPTA_ENGINE_ROUTE_ENVELOPE = envelopeValue.serialized;
		} else {
			env.CHITRAGUPTA_ENGINE_ROUTE_ENVELOPE_OMITTED = "1";
		}
		env.CHITRAGUPTA_ENGINE_ROUTE_ENVELOPE_DIGEST = hashContextValue(envelopeValue.serialized);
		const enforcedLanes = context.engineRouteEnvelope.lanes.filter((lane) => lane.enforced === true);
		for (const lane of enforcedLanes) {
			if (!hasAuthoritativeSelection(lane.selectedCapabilityId, lane.executionBinding)) {
				violations.push(`Engine lane '${lane.key}' is enforced but does not pin a capability, provider, or model.`);
			}
		}
		if (enforcedLanes.length > 0 && envelopeValue.omitted) {
			violations.push("Engine route envelope is enforced but too large for structured Takumi env transport.");
		}
	}
	return { env, violations };
}

function assignJsonEnv(
	env: Record<string, string>,
	key: string,
	value: unknown,
	omittedKey: string,
): void {
	const serialized = serializeJsonEnvValue(value);
	if (!serialized.omitted) {
		env[key] = serialized.serialized;
		return;
	}
	env[omittedKey] = "1";
}

function serializeJsonEnvValue(value: unknown): SerializedEnvValue {
	const serialized = JSON.stringify(value);
	return {
		serialized,
		omitted: serialized.length > MAX_ENV_CONTEXT_CHARS,
	};
}

function hashContextValue(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hasAuthoritativeSelection(
	selectedCapabilityId: string | null | undefined,
	executionBinding: NonNullable<TakumiContext["engineRoute"]>["executionBinding"] | NonNullable<NonNullable<TakumiContext["engineRouteEnvelope"]>["lanes"][number]["executionBinding"]>,
): boolean {
	return Boolean(
		selectedCapabilityId
		|| executionBinding?.selectedProviderId
		|| executionBinding?.selectedModelId,
	);
}

/** Detect the older Takumi CLI mode that cannot honor NDJSON streaming yet. */
export function shouldFallbackToCli(result: TakumiResponse): boolean {
	if (result.exitCode === 0) return false;
	return /Unknown option:\s*--stream|invalid .*--stream|unknown .*ndjson/i.test(result.output);
}
