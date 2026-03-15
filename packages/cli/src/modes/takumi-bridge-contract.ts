import crypto from "node:crypto";
import type {
	TakumiArtifact,
	TakumiContext,
	TakumiExecutionObject,
	TakumiFinalReport,
	TakumiNormalizedResponse,
	TakumiRequest,
	TakumiResponse,
} from "./takumi-bridge-types.js";

type TakumiAssignedLane =
	NonNullable<TakumiContext["engineRoute"]>
	| NonNullable<NonNullable<TakumiContext["engineRouteEnvelope"]>["lanes"]>[number];

/**
 * Attach stable task/lane identity before the bridge starts talking to Takumi.
 *
 * I keep this in one helper so every fallback path carries the same identifiers
 * instead of letting unavailable/blocked/error responses invent different ids.
 */
export function ensureTakumiRequestIdentity(request: TakumiRequest): TakumiRequest {
	const execution = resolveTakumiExecutionObject(request);
	return {
		...request,
		execution,
		taskId: execution.task.id,
		laneId: execution.lane.id,
	};
}

/**
 * Synthesize the executor contract fields that the current Takumi bridge can
 * already support truthfully.
 *
 * I only emit compatibility artifacts and a typed final report from data the
 * bridge already observed. This keeps the contract tighter without pretending
 * Takumi has native daemon-owned reporting yet.
 */
export function attachTakumiExecutionContract(
	request: TakumiRequest,
	context: TakumiContext | undefined,
	response: Omit<TakumiResponse, "taskId" | "laneId" | "finalReport" | "artifacts">,
): TakumiNormalizedResponse {
	const execution = resolveTakumiExecutionObject(request);
	const taskId = execution.task.id;
	const laneId = execution.lane.id;
	const createdAt = Date.now();
	const artifacts = buildTakumiArtifacts(execution, createdAt, response);
	const assignedLane = selectPrimaryTakumiAssignedLane(context);
	const selectedProviderId =
		response.contractAudit?.observedProviderIds?.[0]
		?? (assignedLane?.enforced === true ? null : assignedLane?.executionBinding?.selectedProviderId ?? null);
	const selectedModelId =
		response.contractAudit?.observedModelIds?.[0]
		?? (assignedLane?.enforced === true ? null : assignedLane?.executionBinding?.selectedModelId ?? null);
	const finalReport: TakumiFinalReport = {
		execution,
		taskId,
		laneId,
		status: inferTakumiTerminalStatus(response),
		summary: summarizeTakumiOutput(response.output, response.exitCode),
		usedRoute: {
			routeClass: assignedLane?.routeClass,
			capability: assignedLane?.capability ?? null,
			selectedCapabilityId: assignedLane?.selectedCapabilityId ?? null,
			selectedProviderId,
			selectedModelId,
		},
		selectedProviderId,
		selectedModelId,
		toolCalls: response.toolCalls ?? [],
		validation: response.testsRun,
		artifacts,
		error: response.exitCode === 0 ? null : summarizeTakumiOutput(response.output, response.exitCode),
		failureKind: inferTakumiFailureKind(response),
	};
	return {
		...response,
		execution,
		taskId,
		laneId,
		finalReport,
		artifacts,
	};
}

/**
 * Normalize the canonical execution object for the bridge boundary.
 *
 * I prefer the nested engine-owned object and only fall back to legacy top-level
 * ids when an older caller has not moved over yet.
 */
function resolveTakumiExecutionObject(
	request: Pick<TakumiRequest, "execution" | "taskId" | "laneId">,
): TakumiExecutionObject {
	return {
		task: {
			id:
				normalizeExecutionId(request.execution?.task.id)
				?? normalizeExecutionId(request.taskId)
				?? `task-${crypto.randomUUID()}`,
		},
		lane: {
			id:
				normalizeExecutionId(request.execution?.lane.id)
				?? normalizeExecutionId(request.laneId)
				?? `lane-${crypto.randomUUID()}`,
		},
	};
}

function normalizeExecutionId(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function selectPrimaryTakumiAssignedLane(
	context: TakumiContext | undefined,
): TakumiAssignedLane | undefined {
	if (context?.engineRoute) return context.engineRoute;
	if (!context?.engineRouteEnvelope) return undefined;
	return context.engineRouteEnvelope.lanes.find(
		(lane) => lane.key === context.engineRouteEnvelope?.primaryKey,
	);
}

function inferTakumiFailureKind(
	response: Pick<TakumiResponse, "exitCode" | "output" | "contractAudit">,
): TakumiFinalReport["failureKind"] {
	if (response.exitCode === 0) return null;
	if (response.contractAudit?.violations?.length) return "contract-violation";
	if (/not available on PATH/i.test(response.output)) return "executor-unavailable";
	if (/blocked by the Chitragupta engine route contract/i.test(response.output)) return "route-incompatible";
	if (/\bcancel(?:led|ed)\b/i.test(response.output)) return "cancelled";
	return "runtime-failure";
}

function inferTakumiTerminalStatus(
	response: Pick<TakumiResponse, "exitCode" | "output">,
): TakumiFinalReport["status"] {
	if (response.exitCode === 0) return "completed";
	return /\bcancel(?:led|ed)\b/i.test(response.output) ? "cancelled" : "failed";
}

function summarizeTakumiOutput(output: string, exitCode: number): string {
	const summaryLine = output
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (summaryLine) return summaryLine;
	return exitCode === 0 ? "Takumi completed without textual output." : "Takumi failed without textual output.";
}

function buildTakumiArtifacts(
	execution: TakumiExecutionObject,
	createdAt: number,
	response: Pick<TakumiResponse, "filesModified" | "testsRun" | "diffSummary" | "output">,
): TakumiArtifact[] {
	const artifacts: TakumiArtifact[] = [];
	const taskId = execution.task.id;
	const laneId = execution.lane.id;
	if (response.filesModified.length > 0 || response.diffSummary) {
		const body = response.diffSummary ?? response.filesModified.join("\n");
		artifacts.push(buildTakumiArtifact(execution, createdAt, "patch", "Bridge patch summary", body));
	}
	if (response.testsRun) {
		artifacts.push(buildTakumiArtifact(
			execution,
			createdAt,
			"validation",
			`Validation ${response.testsRun.passed}/${response.testsRun.total} passed`,
			JSON.stringify(response.testsRun),
		));
	}
	if (response.output.trim()) {
		artifacts.push(buildTakumiArtifact(execution, createdAt, "log", "Bridge execution log", response.output));
	}
	return artifacts;
}

function buildTakumiArtifact(
	execution: TakumiExecutionObject,
	createdAt: number,
	kind: TakumiArtifact["kind"],
	summary: string,
	body: string,
): TakumiArtifact {
	const taskId = execution.task.id;
	const laneId = execution.lane.id;
	return {
		artifactId: `${taskId}:${laneId}:${kind}:${hashTakumiValue(body).slice(0, 8)}`,
		execution,
		taskId,
		laneId,
		kind,
		producer: "takumi-bridge",
		summary,
		body,
		contentHash: hashTakumiValue(body),
		createdAt,
		promoted: false,
	};
}

function hashTakumiValue(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}
