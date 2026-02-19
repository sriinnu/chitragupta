/**
 * Marga Decision API — Stateless routing contract for external consumers (Vaayu).
 *
 * This is the stable, versioned interface that Vaayu (or any external system)
 * calls to get a model routing decision. It wraps the MargaPipeline.classify()
 * method with a strict, versioned payload contract.
 *
 * Contract rules:
 *   - Stateless: no session state, no budget, no health checks
 *   - Fast: must respond within 150ms (it's pure CPU, no I/O)
 *   - Versioned: decisionVersion field for compatibility validation
 *   - Chitragupta does NOT enforce budget/health/policy (that's Vaayu's job)
 */

import type {
	TaskType,
	ResolutionPath,
	TaskModelBinding,
	CheckinSubtype,
} from "./router-task-type.js";
import type { TaskComplexity } from "./router-classifier.js";
import { classifyTaskType, RESOLUTION_MAP, HYBRID_BINDINGS, LOCAL_BINDINGS, CLOUD_BINDINGS } from "./router-task-type.js";
import { classifyComplexity } from "./router-classifier.js";
import type { Context, ContentPart } from "./types.js";

// ─── Contract Version ────────────────────────────────────────────────────────

/** Bump this when the MargaDecision shape or semantics change. */
export const MARGA_CONTRACT_VERSION = "1.1";

type ProviderHealthSignal = {
	healthy?: boolean;
	status?: string;
	note?: string;
};

type ProviderHealthHint = {
	channel: "provider-health";
	providerId: string;
	severity: "info" | "warning";
	message: string;
	status?: string;
};

// ─── Contract Types ──────────────────────────────────────────────────────────

/**
 * Input to the Marga decision API.
 *
 * Minimal inputs: just the user message and optional context.
 * Chitragupta doesn't need session state, budget, or user prefs —
 * those are Vaayu's guardrails applied AFTER the decision.
 */
export interface MargaDecideRequest {
	/** The user's message text. Required. */
	message: string;
	/** Whether the caller has tools available. Affects complexity scoring. */
	hasTools?: boolean;
	/** Whether the message contains images. Affects task type detection. */
	hasImages?: boolean;
	/** Binding strategy override. Default: "hybrid". */
	bindingStrategy?: "local" | "cloud" | "hybrid";
	/** Custom bindings (overrides bindingStrategy if provided). */
	customBindings?: TaskModelBinding[];
	/** Optional provider-health snapshot from Vaayu (advisory only). */
	providerHealth?: Record<string, ProviderHealthSignal>;
}

/**
 * Output from the Marga decision API.
 *
 * This is the strict contract Vaayu consumes. Every field is documented
 * and versioned. Vaayu should validate `decisionVersion` on startup.
 */
export interface MargaDecision {
	/** Contract version for compatibility checks. */
	decisionVersion: string;

	/** Selected provider ID (e.g. "anthropic", "ollama", "openai", "none"). */
	providerId: string;
	/** Selected model ID (e.g. "claude-sonnet-4-5-20250929", "llama3.2:3b"). */
	modelId: string;

	/** Detected task type (15 discrete categories). */
	taskType: TaskType;
	/** How the task should be resolved. */
	resolution: ResolutionPath;
	/** Detected complexity tier. */
	complexity: TaskComplexity;

	/** Whether the task can skip LLM entirely (search, memory, file-op, smalltalk, etc.). */
	skipLLM: boolean;

	/**
	 * Ordered escalation chain: if the selected model fails,
	 * try these in order (weakest to strongest).
	 * Vaayu should apply its own guardrails to each before trying.
	 */
	escalationChain: Array<{ providerId: string; modelId: string }>;

	/** Human-readable explanation of why this model was chosen. */
	rationale: string;

	/** Confidence in the decision [0, 1]. Geometric mean of classifiers. */
	confidence: number;

	/** Time taken to compute the decision (ms). Must be ≤150ms. */
	decisionTimeMs: number;

	/** Secondary task type if ambiguous (e.g. code-gen + reasoning). */
	secondaryTaskType?: TaskType;
	/** Explicit greeting/check-in subtype for smalltalk/heartbeat requests. */
	checkinSubtype?: CheckinSubtype;
	/** True when top-2 task scores are near tied and should be treated as advisory. */
	abstain: boolean;
	/** Reason for abstaining. */
	abstainReason?: "near_tie_top2";
	/** Advisory provider-health hints (enforcement stays in Vaayu). */
	providerHealthHints?: ProviderHealthHint[];

	/** Suggested temperature (identity-adjusted). */
	temperature?: number;
}

// ─── Escalation Chain ────────────────────────────────────────────────────────

/**
 * Full escalation chain, weakest to strongest.
 * Exported so Vaayu can inspect the chain without calling decide().
 */
export const ESCALATION_CHAIN: ReadonlyArray<{ providerId: string; modelId: string }> = [
	{ providerId: "ollama", modelId: "llama3.2:1b" },
	{ providerId: "ollama", modelId: "llama3.2:3b" },
	{ providerId: "ollama", modelId: "qwen2.5-coder:7b" },
	{ providerId: "anthropic", modelId: "claude-haiku-3-5" },
	{ providerId: "anthropic", modelId: "claude-sonnet-4-5-20250929" },
	{ providerId: "openai", modelId: "gpt-4o" },
	{ providerId: "anthropic", modelId: "claude-opus-4-6" },
];

// ─── Complexity Order ────────────────────────────────────────────────────────

const COMPLEXITY_ORDER: Record<TaskComplexity, number> = {
	trivial: 0,
	simple: 1,
	medium: 2,
	complex: 3,
	expert: 4,
};

/** Minimum complexity overrides — some task types always need stronger models. */
const MIN_COMPLEXITY_OVERRIDES: Partial<Record<TaskType, TaskComplexity>> = {
	reasoning: "complex",
	vision: "medium",
};

const NEAR_TIE_MAX_SCORE_DELTA = 1;
const NEAR_TIE_MAX_CONFIDENCE = 0.67;

// ─── Decision Function ──────────────────────────────────────────────────────

/**
 * Compute a stateless routing decision.
 *
 * This is the primary API Vaayu calls. It's pure CPU — no I/O, no network,
 * no database. Typical execution time: <5ms.
 *
 * @param request - The decision request with user message and context hints.
 * @returns A versioned {@link MargaDecision} payload.
 */
export function margaDecide(request: MargaDecideRequest): MargaDecision {
	const startMs = performance.now();

	// Build a minimal Context for the classifiers
	const context = buildContext(request);

	// Select bindings
	const bindings = request.customBindings
		?? selectBindings(request.bindingStrategy ?? "hybrid");

	// Step 1: Classify task type (Pravritti)
	const taskTypeResult = classifyTaskType(context);

	// Step 2: Classify complexity (Vichara)
	const complexityResult = classifyComplexity(context);

	// Step 3: Apply minimum complexity overrides
	let effectiveComplexity = complexityResult.complexity;
	const minOverride = MIN_COMPLEXITY_OVERRIDES[taskTypeResult.type];
	if (minOverride && COMPLEXITY_ORDER[effectiveComplexity] < COMPLEXITY_ORDER[minOverride]) {
		effectiveComplexity = minOverride;
	}

	// Step 4: Find binding for this task type
	const binding = bindings.find((b) => b.taskType === taskTypeResult.type);

	// Step 5: Determine if we can skip LLM
	const resolution = taskTypeResult.resolution;
	const skipLLM = resolution === "tool-only" || resolution === "local-compute";

	// Step 6: Select provider/model from binding
	let providerId = binding?.providerId ?? "ollama";
	let modelId = binding?.modelId ?? "llama3.2:3b";
	let rationale = binding?.rationale ?? "Default fallback";

	// Step 7: Complexity upgrade — if task demands stronger model
	if (!skipLLM && COMPLEXITY_ORDER[effectiveComplexity] >= COMPLEXITY_ORDER["complex"]) {
		const upgrade = upgradeForComplexity(effectiveComplexity, taskTypeResult.type);
		if (upgrade) {
			providerId = upgrade.providerId;
			modelId = upgrade.modelId;
			rationale = `Complexity upgrade (${effectiveComplexity}): ${upgrade.rationale}`;
		}
	}

	// Step 8: Build escalation chain from current position upward
	const escalationChain = buildEscalationChain(providerId, modelId);

	// Step 9: Confidence (geometric mean of both classifiers)
	const confidence = Math.sqrt(taskTypeResult.confidence * complexityResult.confidence);
	const scoreDelta = (taskTypeResult.topScore ?? 0) - (taskTypeResult.secondScore ?? 0);
	const abstain = Boolean(taskTypeResult.secondary)
		&& (taskTypeResult.secondScore ?? 0) > 0
		&& scoreDelta <= NEAR_TIE_MAX_SCORE_DELTA
		&& confidence <= NEAR_TIE_MAX_CONFIDENCE;
	const providerHealthHints = buildProviderHealthHints(request.providerHealth, providerId);

	// Step 10: Default temperature based on task type
	const temperature = taskTypeResult.type === "code-gen" ? 0.2
		: taskTypeResult.type === "reasoning" ? 0.5
		: taskTypeResult.type === "chat" || taskTypeResult.type === "smalltalk" ? 0.7
		: 0.4;

	const decisionTimeMs = performance.now() - startMs;

	return {
		decisionVersion: MARGA_CONTRACT_VERSION,
		providerId,
		modelId,
		taskType: taskTypeResult.type,
		resolution: taskTypeResult.resolution,
		complexity: effectiveComplexity,
		skipLLM,
		escalationChain,
		rationale: abstain && taskTypeResult.secondary
			? `${rationale} | near tie with ${taskTypeResult.secondary}`
			: rationale,
		confidence,
		decisionTimeMs,
		secondaryTaskType: taskTypeResult.secondary,
		checkinSubtype: taskTypeResult.checkinSubtype,
		abstain,
		abstainReason: abstain ? "near_tie_top2" : undefined,
		providerHealthHints,
		temperature,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal Context from the request.
 * The classifiers only need the user message and tool/image presence.
 */
function buildContext(request: MargaDecideRequest): Context {
	const content: ContentPart[] = [{ type: "text", text: request.message }];

	if (request.hasImages) {
		content.push({
			type: "image",
			source: { type: "base64", mediaType: "image/png", data: "" },
		});
	}

	return {
		messages: [{ role: "user", content }],
		tools: request.hasTools
			? [{ name: "_placeholder", description: "", inputSchema: { type: "object", properties: {} } }]
			: [],
	};
}

function selectBindings(strategy: "local" | "cloud" | "hybrid"): TaskModelBinding[] {
	switch (strategy) {
		case "local": return LOCAL_BINDINGS;
		case "cloud": return CLOUD_BINDINGS;
		case "hybrid": return HYBRID_BINDINGS;
	}
}

function upgradeForComplexity(
	complexity: TaskComplexity,
	taskType: TaskType,
): { providerId: string; modelId: string; rationale: string } | undefined {
	if (complexity === "expert") {
		return {
			providerId: "anthropic",
			modelId: "claude-opus-4-6",
			rationale: "Expert-level task requires the most capable model.",
		};
	}
	if (complexity === "complex") {
		return {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5-20250929",
			rationale: taskType === "code-gen" || taskType === "tool-exec"
				? "Complex code task needs Claude Sonnet's code capabilities."
				: "Complex task escalated to Claude Sonnet.",
		};
	}
	return undefined;
}

/**
 * Build the escalation chain starting after the current model.
 * Returns all models stronger than the currently selected one.
 */
function buildEscalationChain(
	currentProvider: string,
	currentModel: string,
): Array<{ providerId: string; modelId: string }> {
	const idx = ESCALATION_CHAIN.findIndex(
		(e) => e.providerId === currentProvider && e.modelId === currentModel,
	);
	// Return everything after the current position
	const startIdx = idx >= 0 ? idx + 1 : 0;
	return ESCALATION_CHAIN.slice(startIdx).map((e) => ({ ...e }));
}

function buildProviderHealthHints(
	health: Record<string, ProviderHealthSignal> | undefined,
	selectedProviderId: string,
): ProviderHealthHint[] | undefined {
	if (!health) return undefined;
	const selected = health[selectedProviderId];
	if (!selected) return undefined;
	const healthy =
		selected.healthy === true ||
		selected.status === "ok" ||
		selected.status === "healthy";
	if (healthy) return undefined;
	const reason = selected.note ?? selected.status ?? "degraded";
	return [
		{
			channel: "provider-health",
			providerId: selectedProviderId,
			severity: "warning",
			status: selected.status,
			message: `selected provider is unhealthy (${reason})`,
		},
	];
}
