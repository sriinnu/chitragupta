import type { TakumiContext, TakumiResponse } from "./takumi-bridge-types.js";

interface TakumiExecutionObservation {
	providerIds: string[];
	modelIds: string[];
}

/**
 * Audit Takumi's declared provider/model usage against an enforced engine route envelope.
 * This is a fail-closed safety check: explicit contradictions are converted into failures.
 */
export function auditTakumiResponseAgainstContract(
	context: TakumiContext | undefined,
	response: Omit<TakumiResponse, "taskId" | "laneId" | "finalReport" | "artifacts">,
): Omit<TakumiResponse, "taskId" | "laneId" | "finalReport" | "artifacts"> {
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

/** Turn unknown Takumi bridge errors into a stable human-readable message. */
export function extractTakumiErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const maybeMessage = (error as { message?: unknown }).message;
		if (typeof maybeMessage === "string") return maybeMessage;
	}
	return "Takumi returned an unknown error.";
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
	if (allowedProviders.size > 0 && observation.providerIds.length === 0) {
		violations.push(
			`Takumi did not declare a provider for the enforced engine-selected lane: ${[...allowedProviders].join(", ")}`,
		);
	}
	if (allowedModels.size > 0 && observation.modelIds.length === 0) {
		violations.push(
			`Takumi did not declare a model for the enforced engine-selected lane: ${[...allowedModels].join(", ")}`,
		);
	}
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
