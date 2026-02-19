/**
 * Marga Pipeline — The full routing pipeline from user intent to response.
 *
 * This is the "someone" that orchestrates everything:
 *
 *   User Message
 *       ↓
 *   [1] Pravritti (Intent) — WHAT does the user want?
 *       ↓
 *   [2] Vichara (Complexity) — HOW hard is it?
 *       ↓
 *   [3] Atman (Identity) — WHO is this agent? Personality, temperature bias.
 *       ↓
 *   [4] Marga (Route) — Pick the RIGHT model for this intent × complexity.
 *       ↓
 *   [5] LLM (Execute) — Stream from the chosen provider/model.
 *       ↓
 *   [6] Escalation — If the model fails or output is poor, escalate up.
 *
 * Named "Marga" (Sanskrit: मार्ग — the path). Every request follows a path
 * through intent detection, identity awareness, model selection, and execution.
 *
 * @example
 * ```ts
 * import { MargaPipeline, HYBRID_BINDINGS } from "@chitragupta/swara";
 *
 * const pipeline = new MargaPipeline({
 *   registry,
 *   bindings: HYBRID_BINDINGS,
 *   autoEscalate: true,
 * });
 *
 * // Pipeline detects: code-gen task, medium complexity → qwen2.5-coder:7b
 * const decision = pipeline.classify(context);
 * console.log(decision.taskType);    // "code-gen"
 * console.log(decision.complexity);  // "medium"
 * console.log(decision.model);       // "qwen2.5-coder:7b"
 * console.log(decision.rationale);   // "Qwen Coder locally. Escalates to Sonnet if complex."
 *
 * // Or just stream — pipeline handles everything
 * for await (const event of pipeline.stream(context)) {
 *   // events from the auto-selected model
 * }
 * ```
 */

import { ProviderError } from "@chitragupta/core";
import type { ProviderRegistry } from "./provider-registry.js";
import type { Context, StreamEvent, StreamOptions } from "./types.js";
import { classifyComplexity } from "./router-classifier.js";
import type { TaskComplexity, ClassificationResult } from "./router-classifier.js";
import { classifyTaskType } from "./router-task-type.js";
import type { TaskType, TaskTypeResult, TaskModelBinding } from "./router-task-type.js";
import { HYBRID_BINDINGS } from "./router-task-type.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Full classification: intent + complexity + identity. */
export interface PipelineDecision {
	/** What the user wants (task type). */
	taskType: TaskType;
	/** How hard it is (complexity). */
	complexity: TaskComplexity;
	/** The selected provider. */
	providerId: string;
	/** The selected model. */
	modelId: string;
	/** Why this model was chosen. */
	rationale: string;
	/** Confidence in the decision [0, 1]. */
	confidence: number;
	/** Whether the task can skip LLM entirely (e.g. search). */
	skipLLM: boolean;
	/** Identity-adjusted temperature. */
	temperature?: number;
	/** Raw classification details. */
	details: {
		taskTypeResult: TaskTypeResult;
		complexityResult: ClassificationResult;
	};
	/** If escalated from a weaker model. */
	escalatedFrom?: { providerId: string; modelId: string };
}

/** Pipeline configuration. */
export interface MargaPipelineConfig {
	/** Provider registry. */
	registry: ProviderRegistry;
	/** Task-type → model bindings. */
	bindings?: TaskModelBinding[];
	/** Auto-escalate on failure? Default true. */
	autoEscalate?: boolean;
	/** Max escalation attempts. Default 2. */
	maxEscalations?: number;
	/** Identity hook: adjust temperature based on agent soul. */
	temperatureAdjust?: (baseTemp: number, taskType: TaskType, complexity: TaskComplexity) => number;
	/**
	 * Complexity override map: when a task type inherently demands
	 * a stronger model regardless of detected complexity.
	 * e.g. { "reasoning": "complex" } — reasoning always gets at least complex-tier model.
	 */
	minComplexityOverrides?: Partial<Record<TaskType, TaskComplexity>>;
}

// ─── Escalation Chain ───────────────────────────────────────────────────────

/**
 * Escalation chain: when a model fails, where do we go next?
 * Ordered from weakest to strongest.
 */
const ESCALATION_CHAIN: Array<{ providerId: string; modelId: string }> = [
	{ providerId: "ollama", modelId: "llama3.2:1b" },
	{ providerId: "ollama", modelId: "llama3.2:3b" },
	{ providerId: "ollama", modelId: "qwen2.5-coder:7b" },
	{ providerId: "anthropic", modelId: "claude-haiku-3-5" },
	{ providerId: "anthropic", modelId: "claude-sonnet-4-5-20250929" },
	{ providerId: "openai", modelId: "gpt-4o" },
	{ providerId: "anthropic", modelId: "claude-opus-4-6" },
];

const COMPLEXITY_ORDER: Record<TaskComplexity, number> = {
	trivial: 0,
	simple: 1,
	medium: 2,
	complex: 3,
	expert: 4,
};

// ─── Pipeline ───────────────────────────────────────────────────────────────

export class MargaPipeline {
	private readonly registry: ProviderRegistry;
	private bindings: TaskModelBinding[];
	private readonly autoEscalate: boolean;
	private readonly maxEscalations: number;
	private readonly temperatureAdjust?: MargaPipelineConfig["temperatureAdjust"];
	private readonly minComplexityOverrides: Partial<Record<TaskType, TaskComplexity>>;

	constructor(config: MargaPipelineConfig) {
		this.registry = config.registry;
		this.bindings = config.bindings ?? [...HYBRID_BINDINGS];
		this.autoEscalate = config.autoEscalate ?? true;
		this.maxEscalations = config.maxEscalations ?? ESCALATION_CHAIN.length;
		this.temperatureAdjust = config.temperatureAdjust;
		this.minComplexityOverrides = config.minComplexityOverrides ?? {
			reasoning: "complex",   // Reasoning always gets at least complex-tier
			vision: "medium",       // Vision needs at least medium-tier (multimodal)
		};
	}

	/**
	 * Classify a request: detect intent, complexity, and select model.
	 *
	 * This is the brain of the pipeline. It answers:
	 * - WHAT does the user want? (task type)
	 * - HOW hard is it? (complexity)
	 * - WHICH model handles this best? (binding lookup)
	 * - Can we skip the LLM entirely? (search, BM25)
	 */
	classify(context: Context, options?: StreamOptions): PipelineDecision {
		// Step 1: Detect task type (Pravritti)
		const taskTypeResult = classifyTaskType(context, options);

		// Step 2: Detect complexity (Vichara)
		const complexityResult = classifyComplexity(context, options);

		// Step 3: Apply minimum complexity overrides
		let effectiveComplexity = complexityResult.complexity;
		const minOverride = this.minComplexityOverrides[taskTypeResult.type];
		if (minOverride && COMPLEXITY_ORDER[effectiveComplexity] < COMPLEXITY_ORDER[minOverride]) {
			effectiveComplexity = minOverride;
		}

		// Step 4: Find the binding for this task type
		const binding = this.bindings.find((b) => b.taskType === taskTypeResult.type);

		// Step 5: Determine if we can skip LLM (tool-only, local-compute, or embedding)
		const resolution = taskTypeResult.resolution;
		const skipLLM = resolution === "tool-only" || resolution === "local-compute";

		// Step 6: Select provider/model
		let providerId = binding?.providerId ?? "ollama";
		let modelId = binding?.modelId ?? "llama3.2:3b";
		let rationale = binding?.rationale ?? "Default fallback";

		// Step 7: Complexity upgrade — if complexity demands a stronger model
		// than the binding provides, upgrade.
		if (!skipLLM && COMPLEXITY_ORDER[effectiveComplexity] >= COMPLEXITY_ORDER["complex"]) {
			const upgrade = this.findUpgradeForComplexity(effectiveComplexity, taskTypeResult.type);
			if (upgrade) {
				providerId = upgrade.providerId;
				modelId = upgrade.modelId;
				rationale = `Complexity upgrade (${effectiveComplexity}): ${upgrade.rationale}`;
			}
		}

		// Step 8: Identity temperature adjustment
		let temperature: number | undefined;
		if (this.temperatureAdjust) {
			const baseTemp = taskTypeResult.type === "code-gen" ? 0.2
				: taskTypeResult.type === "reasoning" ? 0.5
				: taskTypeResult.type === "chat" || taskTypeResult.type === "smalltalk" ? 0.7
				: 0.4;
			temperature = this.temperatureAdjust(baseTemp, taskTypeResult.type, effectiveComplexity);
		}

		// Confidence: geometric mean of both classifiers
		const confidence = Math.sqrt(taskTypeResult.confidence * complexityResult.confidence);

		return {
			taskType: taskTypeResult.type,
			complexity: effectiveComplexity,
			providerId,
			modelId,
			rationale,
			confidence,
			skipLLM,
			temperature,
			details: { taskTypeResult, complexityResult },
		};
	}

	/**
	 * Stream a response through the full pipeline.
	 *
	 * 1. Classify (intent + complexity + model)
	 * 2. If skipLLM, yield nothing (caller handles search/embed locally)
	 * 3. Otherwise, stream from selected provider with auto-escalation
	 */
	async *stream(context: Context, options?: StreamOptions): AsyncIterable<StreamEvent> {
		const decision = this.classify(context, options);

		if (decision.skipLLM) {
			// Search/BM25 tasks don't need an LLM call.
			// Yield a synthetic done event so the caller knows.
			yield {
				type: "done" as const,
				usage: { inputTokens: 0, outputTokens: 0 },
			} as StreamEvent;
			return;
		}

		let currentProvider = decision.providerId;
		let currentModel = decision.modelId;
		let escalations = 0;

		while (true) {
			const provider = this.registry.get(currentProvider);
			if (!provider) {
				if (this.autoEscalate && escalations < this.maxEscalations) {
					const next = this.findNextInChain(currentProvider, currentModel);
					if (next) {
						currentProvider = next.providerId;
						currentModel = next.modelId;
						escalations++;
						continue;
					}
				}
				throw new ProviderError(
					`Provider "${currentProvider}" not available for ${decision.taskType} task`,
					currentProvider,
				);
			}

			const streamOpts: StreamOptions = {
				...options,
				temperature: decision.temperature ?? options?.temperature,
			};

			try {
				const stream = provider.stream(currentModel, context, streamOpts);
				for await (const event of stream) {
					if (event.type === "error" && this.autoEscalate && escalations < this.maxEscalations) {
						const next = this.findNextInChain(currentProvider, currentModel);
						if (next) {
							currentProvider = next.providerId;
							currentModel = next.modelId;
							escalations++;
							break;
						}
					}
					yield event;
					if (event.type === "done") return;
				}

				// If we broke for escalation, continue outer loop
				if (escalations > 0) continue;
				return;
			} catch (err) {
				if (this.autoEscalate && escalations < this.maxEscalations) {
					const next = this.findNextInChain(currentProvider, currentModel);
					if (next) {
						currentProvider = next.providerId;
						currentModel = next.modelId;
						escalations++;
						continue;
					}
				}
				// All escalation attempts exhausted — provide a clear message
			const detail = err instanceof Error ? err.message : String(err);
			throw new ProviderError(
				`All available providers exhausted for ${decision.taskType} task ` +
				`(last: ${currentProvider}/${currentModel}, ${escalations} escalations tried). ` +
				`Please check provider configuration or try again shortly. Detail: ${detail}`,
				currentProvider,
				undefined,
				err instanceof Error ? err : undefined,
			);
			}
		}
	}

	/**
	 * Replace runtime task bindings.
	 *
	 * This is intended for controlled reconfiguration (CLI/admin flow), not
	 * per-request mutation.
	 */
	setBindings(bindings: TaskModelBinding[]): void {
		this.bindings = [...bindings];
	}

	/** Return a defensive copy of current task bindings. */
	getBindings(): TaskModelBinding[] {
		return [...this.bindings];
	}

	/** Resolve the effective binding for one task type, if configured. */
	getBindingFor(taskType: TaskType): TaskModelBinding | undefined {
		return this.bindings.find((b) => b.taskType === taskType);
	}

	// ─── Private ─────────────────────────────────────────────────────────────

	/**
	 * When complexity demands a stronger model than the task-type binding,
	 * find an appropriate upgrade.
	 */
	private findUpgradeForComplexity(
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
			// For code tasks, Sonnet. For reasoning, Sonnet. For others, Sonnet.
			if (taskType === "code-gen" || taskType === "tool-exec") {
				return {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-5-20250929",
					rationale: "Complex code task needs Claude Sonnet's code capabilities.",
				};
			}
			return {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				rationale: "Complex task escalated to Claude Sonnet.",
			};
		}
		return undefined;
	}

	/** Find the next model up the escalation chain. */
	private findNextInChain(
		currentProvider: string,
		currentModel: string,
	): { providerId: string; modelId: string } | undefined {
		const idx = ESCALATION_CHAIN.findIndex(
			(e) => e.providerId === currentProvider && e.modelId === currentModel,
		);
		// Find the next one in the chain that's actually available
		const startIdx = idx >= 0 ? idx + 1 : 0;
		for (let i = startIdx; i < ESCALATION_CHAIN.length; i++) {
			if (this.registry.has(ESCALATION_CHAIN[i].providerId)) {
				return ESCALATION_CHAIN[i];
			}
		}
		return undefined;
	}
}
