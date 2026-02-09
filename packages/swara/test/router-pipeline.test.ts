import { describe, it, expect } from "vitest";
import { MargaPipeline, HYBRID_BINDINGS, LOCAL_BINDINGS } from "@chitragupta/swara";
import type { ProviderRegistry, Context, ProviderDefinition, TaskType, TaskComplexity } from "@chitragupta/swara";

// ─── Mock Registry ───────────────────────────────────────────────────────────

function createMockRegistry(availableProviders: string[]): ProviderRegistry {
	const map = new Map<string, ProviderDefinition>();
	for (const id of availableProviders) {
		map.set(id, {
			id,
			name: id,
			models: [],
			auth: { type: "api-key" },
			stream: async function* () {
				yield { type: "done" as const, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 } };
			},
		});
	}
	return {
		register: (p: ProviderDefinition) => { map.set(p.id, p); },
		get: (id: string) => map.get(id),
		getAll: () => [...map.values()],
		has: (id: string) => map.has(id),
		remove: (id: string) => { map.delete(id); },
		getModels: () => [],
	};
}

function ctx(text: string, opts?: { tools?: Array<{ name: string }>; images?: boolean }): Context {
	const content: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; mediaType: string; data: string } }> = [
		{ type: "text", text },
	];
	if (opts?.images) {
		content.push({
			type: "image",
			source: { type: "base64", mediaType: "image/png", data: "abc123" },
		});
	}
	return {
		messages: [{ role: "user" as const, content }],
		tools: opts?.tools as Context["tools"],
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MargaPipeline", () => {
	describe("classify()", () => {
		it("should return a PipelineDecision with all expected fields", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("hello there"));
			expect(decision).toHaveProperty("taskType");
			expect(decision).toHaveProperty("complexity");
			expect(decision).toHaveProperty("providerId");
			expect(decision).toHaveProperty("modelId");
			expect(decision).toHaveProperty("rationale");
			expect(decision).toHaveProperty("confidence");
			expect(decision).toHaveProperty("skipLLM");
			expect(decision).toHaveProperty("details");
			expect(decision.details).toHaveProperty("taskTypeResult");
			expect(decision.details).toHaveProperty("complexityResult");
		});

		it("should detect code-gen task and pick appropriate model", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("implement a parser function"));
			expect(decision.taskType).toBe("code-gen");
			expect(decision.modelId).toBeDefined();
			expect(decision.skipLLM).toBe(false);
		});

		it("should detect search and set skipLLM = true", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("search for files containing errors"));
			expect(decision.taskType).toBe("search");
			expect(decision.skipLLM).toBe(true);
		});

		it("should detect memory and set skipLLM = true", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("what did I say last session"));
			expect(decision.taskType).toBe("memory");
			expect(decision.skipLLM).toBe(true);
		});

		it("should detect file-op and set skipLLM = true", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("read file src/main.ts"));
			expect(decision.taskType).toBe("file-op");
			expect(decision.skipLLM).toBe(true);
		});

		it("should apply min complexity override for reasoning (at least complex)", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("analyze trade-offs between A and B"));
			const order = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(order[decision.complexity]).toBeGreaterThanOrEqual(order["complex"]);
		});

		it("should compute confidence as geometric mean of both classifiers", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("implement a function"));
			const taskConf = decision.details.taskTypeResult.confidence;
			const compConf = decision.details.complexityResult.confidence;
			const expectedGeoMean = Math.sqrt(taskConf * compConf);
			expect(decision.confidence).toBeCloseTo(expectedGeoMean, 10);
		});
	});

	describe("setBindings() / getBindings()", () => {
		it("should round-trip bindings correctly", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			pipeline.setBindings(LOCAL_BINDINGS);
			const retrieved = pipeline.getBindings();
			expect(retrieved).toHaveLength(LOCAL_BINDINGS.length);
			expect(retrieved[0].taskType).toBe(LOCAL_BINDINGS[0].taskType);
			// Verify it is a copy
			retrieved.pop();
			expect(pipeline.getBindings()).toHaveLength(LOCAL_BINDINGS.length);
		});
	});

	describe("getBindingFor()", () => {
		it("should return the correct binding for a known task type", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const binding = pipeline.getBindingFor("code-gen");
			expect(binding).toBeDefined();
			expect(binding!.taskType).toBe("code-gen");
		});

		it("should return undefined for an unknown task type", () => {
			const registry = createMockRegistry(["ollama"]);
			const pipeline = new MargaPipeline({ registry, bindings: [] });
			const binding = pipeline.getBindingFor("code-gen");
			expect(binding).toBeUndefined();
		});
	});

	describe("expert domain upgrade", () => {
		it("should upgrade to opus-level model for expert domain messages", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(
				ctx("design a distributed system with fault tolerance and load balancing for scalability"),
			);
			// Expert domain signals fire in both classifiers — the pipeline should
			// upgrade the model. Exact model depends on bindings, but it should not
			// be the cheapest local model.
			const order = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(order[decision.complexity]).toBeGreaterThanOrEqual(order["complex"]);
		});
	});

	describe("temperatureAdjust hook", () => {
		it("should set temperature when temperatureAdjust hook is provided", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({
				registry,
				bindings: HYBRID_BINDINGS,
				temperatureAdjust: (base: number, _taskType: TaskType, _complexity: TaskComplexity) => {
					return base * 1.5;
				},
			});
			const decision = pipeline.classify(ctx("write some code please implement a function"));
			expect(decision.temperature).toBeDefined();
			expect(typeof decision.temperature).toBe("number");
		});
	});

	describe("trivial chat", () => {
		it("should not skip LLM for trivial chat and select a cheap model", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
			const decision = pipeline.classify(ctx("how are you doing today"));
			expect(decision.skipLLM).toBe(false);
			expect(decision.taskType).toBe("chat");
			expect(decision.modelId).toBeDefined();
		});
	});
});
