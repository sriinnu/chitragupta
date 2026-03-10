import crypto from "node:crypto";
import {
	normalizeContextForReuse,
	packContextWithFallback,
} from "../context-packing.js";
import type { TakumiContext, TakumiResponse } from "./takumi-bridge-types.js";

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

export interface TakumiContextContractInspection {
	env: Record<string, string>;
	violations: string[];
}

interface TakumiExecutionObservation {
	providerIds: string[];
	modelIds: string[];
}

export function buildContextEnv(context?: TakumiContext): Record<string, string> {
	return inspectTakumiContextContract(context).env;
}

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

export async function buildPrompt(
	task: string,
	projectPath: string,
	context?: TakumiContext,
): Promise<string> {
	const trimmedTask = task.trim();
	if (!context) return trimmedTask;

	const sections: string[] = [
		"Use the following Chitragupta context when it helps complete the task.",
		`Project root: ${projectPath}`,
	];

	if (isFreshContext(context)) {
		sections.unshift(
			"Fresh mode is required for this run. Do not rely on cached summaries or stale assumptions. Re-read the relevant files and base your answer on the current workspace state.",
		);
	}

	if (context.repoMap) {
		const repoMapSection = await formatPackedSection({
			title: "Repo map",
			text: context.repoMap,
			maxChars: MAX_REPO_MAP_CHARS,
		});
		sections.push(repoMapSection);
	}
	if (context.episodicHints?.length) {
		sections.push(await formatHintSection("Episodic hints", context.episodicHints));
	}
	if (context.recentDecisions?.length) {
		sections.push(await formatHintSection("Recent decisions", context.recentDecisions));
	}
	if (context.fileContext) {
		const files = Object.entries(context.fileContext)
			.slice(0, MAX_FILE_CONTEXT_FILES)
			.map(([path, content]) => `File: ${path}\n${truncate(content, MAX_FILE_CONTEXT_CHARS)}`);
		if (files.length > 0) {
			const fileSection = await formatPackedSection({
				title: "Relevant file excerpts",
				text: files.join("\n\n"),
				maxChars: MAX_PACKED_CONTEXT_CHARS,
			});
			sections.push(fileSection);
		}
	}
	if (context.engineRoute) {
		sections.push(`Engine route:\n${formatEngineRouteSummary(context.engineRoute)}`);
	}
	if (context.engineRouteEnvelope?.lanes.length) {
		const envelopeLines = [
			`Primary lane: ${context.engineRouteEnvelope.primaryKey}`,
			...context.engineRouteEnvelope.lanes.map(
				(lane) => `${lane.key}:\n${indentBlock(formatEngineRouteSummary(lane))}`,
			),
		].join("\n\n");
		const envelopeSection = await formatPackedSection({
			title: "Engine lane envelope",
			text: envelopeLines,
			maxChars: MAX_PACKED_CONTEXT_CHARS,
		});
		sections.push(envelopeSection);
	}

	return `${trimmedTask}\n\n## Chitragupta Context\n${sections.join("\n\n")}`.trim();
}

async function formatPackedSection(args: {
	title: string;
	text: string;
	maxChars: number;
}): Promise<string> {
	const normalized = await normalizeContextForReuse(args.text);
	const sourceText = typeof normalized === "string" && normalized.trim() ? normalized : args.text;
	const packed = await packContextWithFallback(sourceText);
	if (packed) {
		const packedText = truncate(packed.packedText, args.maxChars);
		return `${args.title} (packed via ${packed.runtime}, saved ${formatSavingsPercent(packed.savings)}):\n${packedText}`;
	}
	return `${args.title}:\n${truncate(sourceText, args.maxChars)}`;
}

async function formatHintSection(title: string, values: string[]): Promise<string> {
	const entries = await Promise.all(values.slice(0, MAX_HINT_COUNT).map((value) => formatHintEntry(value)));
	const raw = entries.map((value) => `- ${value}`).join("\n");
	const shouldPack = entries.length >= MIN_PACK_HINT_SECTION_ITEMS || raw.length >= MIN_PACK_HINT_SECTION_CHARS;
	if (!shouldPack) {
		return `${title}:\n${raw}`;
	}
	return formatPackedSection({
		title,
		text: raw,
		maxChars: MAX_PACKED_HINT_CHARS,
	});
}

function formatSavingsPercent(value: number): string {
	if (!Number.isFinite(value)) return "0%";
	return `${Math.max(0, Math.round(value * 100))}%`;
}

async function formatHintEntry(value: string): Promise<string> {
	const normalized = await normalizeContextForReuse(value);
	const entry = typeof normalized === "string" && normalized.trim() ? normalized : value;
	if (value.startsWith("[PAKT packed ")) {
		return truncate(entry, MAX_PACKED_HINT_CHARS);
	}
	return truncate(entry, MAX_HINT_CHARS);
}

function formatEngineRouteSummary(route: NonNullable<TakumiContext["engineRoute"]>): string {
	const routeBits = [
		route.routeClass ? `routeClass=${route.routeClass}` : null,
		route.capability ? `capability=${route.capability}` : null,
		route.selectedCapabilityId ? `selected=${route.selectedCapabilityId}` : null,
	]
		.filter(Boolean)
		.join(", ");
	const trace = route.policyTrace?.length
		? `\nPolicy trace: ${route.policyTrace.join(" -> ")}`
		: "";
	const reason = route.reason ? `\nReason: ${route.reason}` : "";
	const enforcement =
		route.enforced === true
			? "\nThis engine-selected lane is authoritative. Do not override it with a different model/runtime choice."
			: "";
	const binding = route.executionBinding
		? [
				route.executionBinding.query
					? `\nDiscovery lane: ${route.executionBinding.query.capability}${route.executionBinding.query.mode ? ` (${route.executionBinding.query.mode})` : ""}${route.executionBinding.query.role ? ` [${route.executionBinding.query.role}]` : ""}`
					: "",
				route.executionBinding.selectedProviderId
					? `\nSelected provider: ${route.executionBinding.selectedProviderId}`
					: "",
				route.executionBinding.selectedModelId
					? `\nSelected model: ${route.executionBinding.selectedModelId}`
					: "",
				route.executionBinding.preferredProviderIds?.length
					? `\nPreferred providers: ${route.executionBinding.preferredProviderIds.join(", ")}`
					: "",
				route.executionBinding.preferredModelIds?.length
					? `\nPreferred models: ${route.executionBinding.preferredModelIds.join(", ")}`
					: "",
				route.executionBinding.candidateModelIds?.length
					? `\nAllowed models: ${route.executionBinding.candidateModelIds.join(", ")}`
					: "",
				route.executionBinding.allowCrossProvider === false
					? "\nDo not switch provider families outside the engine-selected set."
					: "",
			].join("")
		: "";
	return `${routeBits || "engine-selected lane"}${reason}${trace}${binding}${enforcement}`.trim();
}

function indentBlock(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

export function shouldFallbackToCli(result: TakumiResponse): boolean {
	if (result.exitCode === 0) return false;
	return /Unknown option:\s*--stream|invalid .*--stream|unknown .*ndjson/i.test(result.output);
}

export function isFreshContext(context?: TakumiContext): boolean {
	return context?.noCache === true || context?.fresh === true;
}

export function resolveCacheIntent(context?: TakumiContext): "default" | "fresh" {
	return isFreshContext(context) ? "fresh" : "default";
}

export function auditTakumiResponseAgainstContract(
	context: TakumiContext | undefined,
	response: TakumiResponse,
): TakumiResponse {
	if (!context) return response;
	const observation = observeTakumiExecution(response.output);
	const violations = findTakumiContractViolations(context, observation);
	if (violations.length === 0) {
		if (observation.providerIds.length === 0 && observation.modelIds.length === 0) return response;
		return {
			...response,
			contractAudit: {
				observedProviderIds: observation.providerIds,
				observedModelIds: observation.modelIds,
				violations: [],
			},
		};
	}
	const prefix = [
		"Takumi execution violated the Chitragupta engine route contract.",
		...violations.map((violation) => `- ${violation}`),
	];
	return {
		...response,
		exitCode: response.exitCode === 0 ? 1 : response.exitCode,
		output: `${prefix.join("\n")}\n\n${response.output}`.trim(),
		contractAudit: {
			observedProviderIds: observation.providerIds,
			observedModelIds: observation.modelIds,
			violations,
		},
	};
}

export function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const maybeMessage = (error as { message?: unknown }).message;
		if (typeof maybeMessage === "string") return maybeMessage;
	}
	return "Takumi returned an unknown error.";
}

export function truncate(value: string, maxChars: number): string {
	return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function observeTakumiExecution(output: string): TakumiExecutionObservation {
	const providerIds = new Set<string>();
	const modelIds = new Set<string>();
	const providerPatterns = [
		/^\s*(?:selected\s+)?provider\s*[:=]\s*([A-Za-z0-9._:-]+)\s*$/gim,
		/^\s*using\s+provider\s+([A-Za-z0-9._:-]+)\s*$/gim,
	];
	const modelPatterns = [
		/^\s*(?:selected\s+)?model\s*[:=]\s*([A-Za-z0-9._:-]+)\s*$/gim,
		/^\s*using\s+model\s+([A-Za-z0-9._:-]+)\s*$/gim,
	];
	for (const pattern of providerPatterns) {
		for (const match of output.matchAll(pattern)) {
			const value = match[1]?.trim().toLowerCase();
			if (value) providerIds.add(value);
		}
	}
	for (const pattern of modelPatterns) {
		for (const match of output.matchAll(pattern)) {
			const value = match[1]?.trim().toLowerCase();
			if (value) modelIds.add(value);
		}
	}
	return {
		providerIds: [...providerIds],
		modelIds: [...modelIds],
	};
}

function findTakumiContractViolations(
	context: TakumiContext,
	observation: TakumiExecutionObservation,
): string[] {
	const enforcedLanes = [
		...(context.engineRoute?.enforced === true ? [context.engineRoute] : []),
		...(context.engineRouteEnvelope?.lanes.filter((lane) => lane.enforced === true) ?? []),
	];
	if (enforcedLanes.length === 0) return [];

	const allowCrossProvider = enforcedLanes.some((lane) => lane.executionBinding?.allowCrossProvider !== false);
	const allowedProviders = new Set<string>();
	const allowedModels = new Set<string>();

	for (const lane of enforcedLanes) {
		const binding = lane.executionBinding;
		if (!binding) continue;
		const providerIds = [
			binding.selectedProviderId,
			...(binding.preferredProviderIds ?? []),
		];
		for (const providerId of providerIds) {
			if (typeof providerId === "string" && providerId.trim()) {
				allowedProviders.add(providerId.trim().toLowerCase());
			}
		}
		const modelIds = [
			binding.selectedModelId,
			...(binding.preferredModelIds ?? []),
			...(binding.candidateModelIds ?? []),
		];
		for (const modelId of modelIds) {
			if (typeof modelId === "string" && modelId.trim()) {
				allowedModels.add(modelId.trim().toLowerCase());
			}
		}
	}

	const violations: string[] = [];
	if (!allowCrossProvider && allowedProviders.size > 0) {
		for (const observedProviderId of observation.providerIds) {
			if (!allowedProviders.has(observedProviderId)) {
				violations.push(
					`Observed provider '${observedProviderId}' is outside the engine-selected provider set: ${[...allowedProviders].join(", ")}`,
				);
			}
		}
	}
	if (allowedModels.size > 0) {
		for (const observedModelId of observation.modelIds) {
			if (!allowedModels.has(observedModelId)) {
				violations.push(
					`Observed model '${observedModelId}' is outside the engine-selected model set: ${[...allowedModels].join(", ")}`,
				);
			}
		}
	}
	return violations;
}
