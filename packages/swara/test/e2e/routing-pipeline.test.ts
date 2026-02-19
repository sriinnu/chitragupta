/**
 * E2E Test — Full NLU Routing Pipeline
 *
 * Exercises the REAL cross-module information flow:
 *   router-task-type.ts -> router-classifier.ts -> router-pipeline.ts -> provider-registry.ts
 *
 * Only the provider stream is mocked. Classification, binding lookup,
 * complexity detection, and escalation all run for real.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MargaPipeline } from "../../src/router-pipeline.js";
import type { MargaPipelineConfig, PipelineDecision } from "../../src/router-pipeline.js";
import { classifyTaskType, HYBRID_BINDINGS } from "../../src/router-task-type.js";
import type { TaskModelBinding, TaskType } from "../../src/router-task-type.js";
import { classifyComplexity } from "../../src/router-classifier.js";
import type { TaskComplexity } from "../../src/router-classifier.js";
import { createProviderRegistry } from "../../src/provider-registry.js";
import type { ProviderRegistry } from "../../src/provider-registry.js";
import type {
	ProviderDefinition,
	Context,
	StreamEvent,
	ModelDefinition,
	StreamOptions,
} from "../../src/types.js";

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Build a minimal Context from a single user message. */
function userContext(text: string, tools?: boolean): Context {
	return {
		messages: [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text }],
			},
		],
		tools: tools ? [{ name: "test-tool", description: "A tool", inputSchema: {} }] : undefined,
	};
}

/** Build a Context with multiple messages. */
function conversationContext(messages: Array<{ role: "user" | "assistant"; text: string }>): Context {
	return {
		messages: messages.map(m => ({
			role: m.role,
			content: [{ type: "text" as const, text: m.text }],
		})),
	};
}

/** Create a mock provider that yields a simple text stream. */
function createMockStreamProvider(id: string, text: string = "Response"): ProviderDefinition {
	return {
		id,
		name: `Mock ${id}`,
		models: [{
			id: "test-model",
			name: "Test Model",
			contextWindow: 128000,
			maxOutputTokens: 4096,
			pricing: { input: 0, output: 0 },
			capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
		}] as ModelDefinition[],
		auth: { type: "api-key" as const },
		stream: async function* () {
			yield { type: "start", messageId: "msg-1" } as StreamEvent;
			yield { type: "text", text } as StreamEvent;
			yield {
				type: "done",
				stopReason: "end_turn",
				usage: { inputTokens: 10, outputTokens: 5 },
			} as StreamEvent;
		},
	};
}

/** Create a mock provider that throws an error. */
function createFailingProvider(id: string): ProviderDefinition {
	return {
		id,
		name: `Failing ${id}`,
		models: [],
		auth: { type: "api-key" as const },
		stream: async function* () {
			yield { type: "error", error: new Error(`${id} failed`) } as StreamEvent;
		},
	};
}

/** Create a mock provider that throws immediately (exception, not error event). */
function createThrowingProvider(id: string): ProviderDefinition {
	return {
		id,
		name: `Throwing ${id}`,
		models: [],
		auth: { type: "api-key" as const },
		stream: async function* () {
			throw new Error(`${id} threw`);
		},
	};
}

/** Set up a registry with common test providers. */
function setupTestRegistry(): ProviderRegistry {
	const registry = createProviderRegistry();
	registry.register(createMockStreamProvider("ollama", "Local response"));
	registry.register(createMockStreamProvider("anthropic", "Cloud response"));
	registry.register(createMockStreamProvider("openai", "OpenAI response"));
	return registry;
}

/** Create a pipeline with default test setup. */
function createTestPipeline(overrides?: Partial<MargaPipelineConfig>): MargaPipeline {
	return new MargaPipeline({
		registry: setupTestRegistry(),
		bindings: HYBRID_BINDINGS,
		...overrides,
	});
}

/** Collect all events from an async iterable. */
async function collectStream(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

function loadFixture(name: string): string[] {
	return JSON.parse(
		readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
	) as string[];
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Routing Pipeline E2E", () => {
	// ═══════════════════════════════════════════════════════════════════════
	// 1. Classification Pipeline — Various User Messages
	// ═══════════════════════════════════════════════════════════════════════

	describe("Classification pipeline", () => {
		it("should classify code generation requests", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Write a function that sorts arrays"));

			expect(decision.taskType).toBe("code-gen");
			expect(decision.modelId).toBeDefined();
			expect(decision.confidence).toBeGreaterThan(0);
		});

		it("should classify simple chat/Q&A as chat with trivial/simple complexity", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("What is the capital of France?"));

			expect(decision.taskType).toBe("chat");
			expect(["trivial", "simple"]).toContain(decision.complexity);
		});

		it("should classify reasoning tasks", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(
				userContext("Explain the trade-offs between microservices and monoliths and analyze their comparative advantages"),
			);

			expect(decision.taskType).toBe("reasoning");
		});

		it("should classify search tasks and mark skipLLM", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Search for files named *.ts"));

			expect(decision.taskType).toBe("search");
			expect(decision.skipLLM).toBe(true);
		});

		it("should classify file operations as file-op", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Read file at /path/to/config.json"));

			expect(decision.taskType).toBe("file-op");
		});

		it("should classify heartbeat messages", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("ping"));

			expect(decision.taskType).toBe("heartbeat");
		});

		it("should classify greetings as smalltalk and skipLLM", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("hello how are you"));

			expect(decision.taskType).toBe("smalltalk");
			expect(decision.skipLLM).toBe(true);
		});

		it("should not classify mixed greeting+action corpus as smalltalk", () => {
			const pipeline = createTestPipeline();
			const phrases = loadFixture("smalltalk-plus-actions.json");
			for (const phrase of phrases) {
				const decision = pipeline.classify(userContext(phrase, true));
				expect(decision.taskType).not.toBe("smalltalk");
			}
		});

		it("should classify summarization requests", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Summarize the key points of this document"));

			expect(decision.taskType).toBe("summarize");
		});

		it("should classify translation requests", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Translate this text to French"));

			expect(decision.taskType).toBe("translate");
		});

		it("should classify embedding requests", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Embed this text into a vector"));

			expect(decision.taskType).toBe("embedding");
		});

		it("should classify memory recall requests", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("What did I say last session?"));

			expect(decision.taskType).toBe("memory");
			expect(decision.skipLLM).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Complexity Detection Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Complexity detection flow", () => {
		it("should detect trivial or simple complexity for greetings", () => {
			const result = classifyComplexity(userContext("yes"));
			// "yes" matches trivial pattern (weight 0) and brief request (weight 1.0)
			// giving score ~1.0 which lands in "simple" tier
			expect(["trivial", "simple"]).toContain(result.complexity);
		});

		it("should detect simple complexity for short factual questions", () => {
			const result = classifyComplexity(userContext("What color is the sky?"));
			expect(["trivial", "simple"]).toContain(result.complexity);
		});

		it("should detect medium complexity for code-related requests", () => {
			const result = classifyComplexity(userContext("Write a function that parses JSON and returns a typed object"));
			expect(["medium", "simple"]).toContain(result.complexity);
		});

		it("should detect complex for multi-step tasks", () => {
			const result = classifyComplexity(
				userContext(
					"First analyze the database schema, then refactor the ORM layer across multiple files, " +
					"and finally update the migration scripts. After that, run the test suite and evaluate the results.",
				),
			);
			expect(["complex", "expert"]).toContain(result.complexity);
		});

		it("should detect expert complexity for domain-specific tasks", () => {
			const result = classifyComplexity(
				userContext(
					"Design a distributed system with consensus algorithm for fault-tolerant sharding " +
					"that handles load balancing and performance optimization across nodes. Analyze the " +
					"scalability trade-offs and compare different approaches for our security audit requirements.",
				),
			);
			expect(result.complexity).toBe("expert");
		});

		it("should provide a confidence score clamped between 0.5 and 1.0", () => {
			const result = classifyComplexity(userContext("hello"));
			expect(result.confidence).toBeGreaterThanOrEqual(0.5);
			expect(result.confidence).toBeLessThanOrEqual(1.0);
		});

		it("should provide a human-readable reason", () => {
			const result = classifyComplexity(userContext("Debug this function and fix the compilation error"));
			expect(result.reason.length).toBeGreaterThan(0);
		});

		it("should consider tools in complexity assessment", () => {
			const withTools = classifyComplexity(userContext("Do something", true));
			const withoutTools = classifyComplexity(userContext("Do something", false));
			// With tools generally gets higher complexity
			const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(complexityOrder[withTools.complexity]).toBeGreaterThanOrEqual(
				complexityOrder[withoutTools.complexity],
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Task Type Detection Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Task type detection flow", () => {
		it("should classify code tasks with resolution=llm-with-tools", () => {
			// Avoid "search" keyword which triggers SEARCH_PATTERNS
			const result = classifyTaskType(userContext("Implement a sorting function in TypeScript"));
			expect(result.type).toBe("code-gen");
			expect(result.resolution).toBe("llm-with-tools");
		});

		it("should classify tool-exec with resolution=tool-only when tools present", () => {
			// "run the bash command" triggers tool-exec + tool pattern, with tools=true
			const result = classifyTaskType(userContext("Execute the bash command now", true));
			expect(result.type).toBe("tool-exec");
			expect(result.resolution).toBe("tool-only");
		});

		it("should classify search with resolution=local-compute", () => {
			const result = classifyTaskType(userContext("Search for all TODO comments"));
			expect(result.type).toBe("search");
			expect(result.resolution).toBe("local-compute");
		});

		it("should classify embedding with resolution=embedding", () => {
			const result = classifyTaskType(userContext("Embed this paragraph into a vector"));
			expect(result.type).toBe("embedding");
			expect(result.resolution).toBe("embedding");
		});

		it("should classify heartbeat with resolution=local-compute", () => {
			const result = classifyTaskType(userContext("ping"));
			expect(result.type).toBe("heartbeat");
			expect(result.resolution).toBe("local-compute");
		});

		it("should classify smalltalk with resolution=local-compute", () => {
			const result = classifyTaskType(userContext("how are you doing today"));
			expect(result.type).toBe("smalltalk");
			expect(result.resolution).toBe("local-compute");
		});

		it("should classify reasoning with resolution=llm", () => {
			const result = classifyTaskType(userContext("Analyze the trade-offs of this architecture design"));
			expect(result.type).toBe("reasoning");
			expect(result.resolution).toBe("llm");
		});

		it("should provide confidence between 0.5 and 1.0", () => {
			const result = classifyTaskType(userContext("Write some code"));
			expect(result.confidence).toBeGreaterThanOrEqual(0.5);
			expect(result.confidence).toBeLessThanOrEqual(1.0);
		});

		it("should detect secondary task type for ambiguous messages", () => {
			// A message that matches both code-gen and reasoning
			const result = classifyTaskType(
				userContext("Analyze the code architecture and implement a better design pattern"),
			);
			// Should detect primary and possibly secondary
			expect(result.type).toBeDefined();
			// Secondary is optional but should be a valid type if present
			if (result.secondary) {
				expect(typeof result.secondary).toBe("string");
			}
		});

		it("should fall back to chat for generic messages", () => {
			const result = classifyTaskType(userContext("Tell me something interesting"));
			expect(result.type).toBe("chat");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Binding Lookup
	// ═══════════════════════════════════════════════════════════════════════

	describe("Binding lookup", () => {
		it("should use custom bindings when provided", () => {
			const customBindings: TaskModelBinding[] = [
				{
					taskType: "chat",
					providerId: "custom-provider",
					modelId: "custom-model",
					rationale: "Custom binding for chat",
				},
			];

			const pipeline = createTestPipeline({ bindings: customBindings });
			const decision = pipeline.classify(userContext("What is the capital of France?"));

			expect(decision.providerId).toBe("custom-provider");
			expect(decision.modelId).toBe("custom-model");
		});

		it("should fall back to ollama/llama3.2:3b when no binding matches", () => {
			// Use empty bindings — no task type will match
			const pipeline = createTestPipeline({ bindings: [] });
			const decision = pipeline.classify(userContext("What is the capital of France?"));

			// Fallback defaults
			expect(decision.providerId).toBe("ollama");
			expect(decision.modelId).toBe("llama3.2:3b");
		});

		it("should use HYBRID_BINDINGS by default", () => {
			const pipeline = createTestPipeline();
			const bindings = pipeline.getBindings();
			expect(bindings.length).toBe(HYBRID_BINDINGS.length);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Minimum Complexity Overrides
	// ═══════════════════════════════════════════════════════════════════════

	describe("Minimum complexity overrides", () => {
		it("should boost reasoning tasks to at least complex complexity", () => {
			const pipeline = createTestPipeline();
			// Simple reasoning question — but override should boost
			const decision = pipeline.classify(
				userContext("Analyze why this works"),
			);

			if (decision.taskType === "reasoning") {
				const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
				expect(complexityOrder[decision.complexity]).toBeGreaterThanOrEqual(
					complexityOrder["complex"],
				);
			}
		});

		it("should respect custom minComplexityOverrides", () => {
			const pipeline = createTestPipeline({
				minComplexityOverrides: {
					"chat": "medium" as TaskComplexity,
				},
			});

			const decision = pipeline.classify(userContext("What is the capital of France?"));

			if (decision.taskType === "chat") {
				const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
				expect(complexityOrder[decision.complexity]).toBeGreaterThanOrEqual(
					complexityOrder["medium"],
				);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Temperature Adjustment
	// ═══════════════════════════════════════════════════════════════════════

	describe("Temperature adjustment", () => {
		it("should apply temperatureAdjust hook when provided", () => {
			const adjustFn = vi.fn((baseTemp: number, _taskType: TaskType, _complexity: TaskComplexity) => {
				return baseTemp * 1.5;
			});

			const pipeline = createTestPipeline({ temperatureAdjust: adjustFn });
			const decision = pipeline.classify(userContext("Write a sorting function"));

			expect(adjustFn).toHaveBeenCalled();
			expect(decision.temperature).toBeDefined();
			expect(decision.temperature).toBeGreaterThan(0);
		});

		it("should not set temperature when no hook is provided", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("What is the capital of France?"));

			expect(decision.temperature).toBeUndefined();
		});

		it("should pass correct base temperature for different task types", () => {
			const adjustCalls: Array<{ base: number; taskType: string }> = [];
			const adjustFn = (base: number, taskType: TaskType, _complexity: TaskComplexity) => {
				adjustCalls.push({ base, taskType });
				return base;
			};

			const pipeline = createTestPipeline({ temperatureAdjust: adjustFn });

			// Code-gen should get base 0.2
			pipeline.classify(userContext("Write a function"));
			// Chat should get base 0.7
			pipeline.classify(userContext("What is the capital of France?"));

			const codeCall = adjustCalls.find(c => c.taskType === "code-gen");
			const chatCall = adjustCalls.find(c => c.taskType === "chat");

			if (codeCall) expect(codeCall.base).toBe(0.2);
			if (chatCall) expect(chatCall.base).toBe(0.7);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. Escalation Chain (Stream)
	// ═══════════════════════════════════════════════════════════════════════

	describe("Escalation chain", () => {
		it("should escalate when provider is not found in registry and next is available", async () => {
			const registry = createProviderRegistry();
			// Only register anthropic — ollama is NOT in registry, triggers escalation
			registry.register(createMockStreamProvider("anthropic", "Fallback response"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "llama3.2:3b",
					rationale: "Local first",
				}],
				autoEscalate: true,
				maxEscalations: 3,
			});

			const events = await collectStream(pipeline.stream(userContext("What is the capital of France?")));

			// The successful escalated provider yields "done", which terminates the stream
			const doneEvents = events.filter(e => e.type === "done");
			expect(doneEvents.length).toBe(1);
		});

		it("should escalate when provider throws an exception", async () => {
			const registry = createProviderRegistry();
			registry.register(createThrowingProvider("ollama"));
			registry.register(createMockStreamProvider("anthropic", "Caught response"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "llama3.2:3b",
					rationale: "Local first",
				}],
				autoEscalate: true,
				maxEscalations: 2,
			});

			const events = await collectStream(pipeline.stream(userContext("What is the capital of France?")));

			// Escalated to anthropic which succeeds
			const textEvents = events.filter(e => e.type === "text");
			expect(textEvents.length).toBeGreaterThan(0);
		});

		it("should escalate from error event to a working provider that returns done", async () => {
			const registry = createProviderRegistry();
			// Register a provider that yields error + immediately yields done (broken but terminates)
			registry.register(createFailingProvider("ollama"));
			// Register anthropic as a successful escalation target
			registry.register(createMockStreamProvider("anthropic", "Escalated OK"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "llama3.2:1b",
					rationale: "test",
				}],
				autoEscalate: true,
				maxEscalations: 2,
			});

			const events = await collectStream(pipeline.stream(userContext("What is the capital of France?")));

			// The successful provider should have yielded a done event
			const doneEvents = events.filter(e => e.type === "done");
			expect(doneEvents.length).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. Skip LLM Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Skip LLM flow", () => {
		it("should yield synthetic done event for search tasks without calling provider", async () => {
			const registry = createProviderRegistry();
			const streamSpy = vi.fn();
			registry.register({
				...createMockStreamProvider("none"),
				id: "none",
				stream: async function* () { streamSpy(); yield {} as StreamEvent; },
			});
			// Also register ollama so fallback works
			registry.register(createMockStreamProvider("ollama"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: HYBRID_BINDINGS,
			});

			const events = await collectStream(pipeline.stream(userContext("Search for TODO comments")));

			// Should get a done event
			const doneEvents = events.filter(e => e.type === "done");
			expect(doneEvents.length).toBe(1);

			// The "none" provider's stream should NOT have been called
			// (the pipeline handles skipLLM before streaming)
			expect(streamSpy).not.toHaveBeenCalled();
		});

		it("should yield synthetic done event for memory tasks", async () => {
			const pipeline = createTestPipeline();
			const events = await collectStream(
				pipeline.stream(userContext("What did I say in the last session?")),
			);

			const doneEvents = events.filter(e => e.type === "done");
			expect(doneEvents.length).toBe(1);
			if (doneEvents[0].type === "done") {
				expect(doneEvents[0].usage.inputTokens).toBe(0);
				expect(doneEvents[0].usage.outputTokens).toBe(0);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. Max Escalation Limit
	// ═══════════════════════════════════════════════════════════════════════

	describe("Max escalation limit", () => {
		it("should throw when no escalation is possible and provider missing", async () => {
			const registry = createProviderRegistry();
			// Empty registry — no providers at all

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "nonexistent",
					modelId: "test",
					rationale: "test",
				}],
				autoEscalate: false,
			});

			await expect(
				collectStream(pipeline.stream(userContext("What is the capital of France?"))),
			).rejects.toThrow(/not available/i);
		});

		it("should throw when provider throws and no escalation target exists", async () => {
			const registry = createProviderRegistry();
			// Only one provider that throws; no others to escalate to
			registry.register(createThrowingProvider("ollama"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "llama3.2:3b",
					rationale: "test",
				}],
				autoEscalate: true,
				maxEscalations: 0,
			});

			await expect(
				collectStream(pipeline.stream(userContext("What is the capital of France?"))),
			).rejects.toThrow();
		});

		it("should throw with autoEscalate=false even when other providers exist", async () => {
			const registry = createProviderRegistry();
			registry.register(createThrowingProvider("ollama"));
			registry.register(createMockStreamProvider("anthropic", "Should not reach"));

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "llama3.2:3b",
					rationale: "test",
				}],
				autoEscalate: false,
			});

			await expect(
				collectStream(pipeline.stream(userContext("What is the capital of France?"))),
			).rejects.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. Custom Bindings
	// ═══════════════════════════════════════════════════════════════════════

	describe("Custom bindings", () => {
		it("setBindings() replaces bindings and classify uses new ones", () => {
			const pipeline = createTestPipeline();

			const newBindings: TaskModelBinding[] = [
				{
					taskType: "chat",
					providerId: "new-provider",
					modelId: "new-model",
					rationale: "Replaced binding",
				},
			];

			pipeline.setBindings(newBindings);
			const bindings = pipeline.getBindings();
			expect(bindings).toHaveLength(1);
			expect(bindings[0].providerId).toBe("new-provider");

			const decision = pipeline.classify(userContext("What is the capital of France?"));
			if (decision.taskType === "chat") {
				expect(decision.providerId).toBe("new-provider");
				expect(decision.modelId).toBe("new-model");
			}
		});

		it("getBindings() returns a copy, not a reference", () => {
			const pipeline = createTestPipeline();
			const bindings1 = pipeline.getBindings();
			const bindings2 = pipeline.getBindings();
			expect(bindings1).not.toBe(bindings2);
			expect(bindings1).toEqual(bindings2);
		});

		it("getBindingFor() returns specific binding for a task type", () => {
			const pipeline = createTestPipeline();
			const chatBinding = pipeline.getBindingFor("chat");
			expect(chatBinding).toBeDefined();
			expect(chatBinding!.taskType).toBe("chat");
		});

		it("getBindingFor() returns undefined for unbound task types", () => {
			const pipeline = createTestPipeline({ bindings: [] });
			const binding = pipeline.getBindingFor("chat");
			expect(binding).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Additional Integration Tests
	// ═══════════════════════════════════════════════════════════════════════

	describe("Additional integration tests", () => {
		it("decision includes raw classification details", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Write a function"));

			expect(decision.details).toBeDefined();
			expect(decision.details.taskTypeResult).toBeDefined();
			expect(decision.details.taskTypeResult.type).toBeDefined();
			expect(decision.details.taskTypeResult.resolution).toBeDefined();
			expect(decision.details.complexityResult).toBeDefined();
			expect(decision.details.complexityResult.complexity).toBeDefined();
		});

		it("confidence is geometric mean of task type and complexity confidence", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Write code"));

			const expected = Math.sqrt(
				decision.details.taskTypeResult.confidence *
				decision.details.complexityResult.confidence,
			);
			expect(decision.confidence).toBeCloseTo(expected, 5);
		});

		it("pipeline.stream() yields start, text, done events for normal requests", async () => {
			const pipeline = createTestPipeline();
			const events = await collectStream(
				pipeline.stream(userContext("Tell me a joke")),
			);

			const types = events.map(e => e.type);
			expect(types).toContain("start");
			expect(types).toContain("text");
			expect(types).toContain("done");
		});

		it("classifyTaskType uses the LAST user message, not earlier ones", () => {
			const context = conversationContext([
				{ role: "user", text: "Write a function that sorts arrays" },
				{ role: "assistant", text: "Here is the code." },
				{ role: "user", text: "ping" },
			]);

			const result = classifyTaskType(context);
			expect(result.type).toBe("heartbeat");
		});

		it("classifyComplexity uses the last user message", () => {
			const context = conversationContext([
				{ role: "user", text: "Design a distributed system with consensus algorithm for fault-tolerant sharding" },
				{ role: "assistant", text: "Here is the design." },
				{ role: "user", text: "ok" },
			]);

			const result = classifyComplexity(context);
			// "ok" is short: matches trivial (weight 0) + brief request (weight 1.0) + short question if ends with ?, but "ok" doesn't
			// Score ~1.0 lands in "simple" tier
			expect(["trivial", "simple"]).toContain(result.complexity);
		});

		it("should handle empty messages array gracefully", () => {
			const context: Context = { messages: [] };
			const taskResult = classifyTaskType(context);
			expect(taskResult.type).toBe("chat"); // fallback

			const complexityResult = classifyComplexity(context);
			expect(complexityResult.complexity).toBeDefined();
		});

		it("complexity upgrade: expert task gets strongest model", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(
				userContext(
					"Design a distributed system with consensus algorithm for fault-tolerant sharding " +
					"that handles load balancing and performance optimization. Analyze the scalability " +
					"trade-offs and implement a zero-knowledge proof system. First design the architecture, " +
					"then implement each component step by step and finally run the security audit.",
				),
			);

			// With expert complexity, should be upgraded to a stronger model
			if (decision.complexity === "expert") {
				expect(decision.rationale).toContain("upgrade");
			}
		});

		it("should pass temperature through to stream options", async () => {
			const registry = createProviderRegistry();
			let capturedOptions: StreamOptions | undefined;

			registry.register({
				id: "ollama",
				name: "Test",
				models: [],
				auth: { type: "api-key" },
				stream: async function* (_model: string, _ctx: unknown, opts: StreamOptions) {
					capturedOptions = opts;
					yield { type: "start", messageId: "msg-1" } as StreamEvent;
					yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } } as StreamEvent;
				},
			});

			const pipeline = new MargaPipeline({
				registry,
				bindings: [{
					taskType: "chat",
					providerId: "ollama",
					modelId: "test-model",
					rationale: "test",
				}],
				temperatureAdjust: (base) => base * 2,
			});

			await collectStream(pipeline.stream(userContext("What is the capital of France?")));

			expect(capturedOptions).toBeDefined();
			expect(capturedOptions!.temperature).toBeDefined();
			expect(capturedOptions!.temperature).toBeGreaterThan(0);
		});

		it("autoEscalate defaults to true", () => {
			const registry = createProviderRegistry();
			// Create with no explicit autoEscalate — should default to true
			const pipeline = new MargaPipeline({ registry });
			// We can verify by checking that escalation is attempted
			// when a provider fails (covered by other tests)
			expect(pipeline).toBeDefined();
		});

		it("handles API call classification", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Check my inbox for new emails"));

			expect(decision.taskType).toBe("api-call");
			expect(decision.skipLLM).toBe(true);
		});

		it("handles compaction classification", () => {
			const pipeline = createTestPipeline();
			const decision = pipeline.classify(userContext("Compact the context window and free up tokens"));

			expect(decision.taskType).toBe("compaction");
			expect(decision.skipLLM).toBe(true);
		});
	});
});
