import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@chitragupta/anina";
import type { InteractiveModeOptions } from "../src/modes/interactive-types.js";
import { routeModelForTurn } from "../src/modes/interactive-routing.js";

function createAgent(overrides?: Partial<Agent>): Agent {
	return {
		getMessages: () => [],
		getChetana: () => null,
		setModel: vi.fn(),
		setProvider: vi.fn(),
		...overrides,
	} as unknown as Agent;
}

function createStdout() {
	return { write: vi.fn() } as unknown as NodeJS.WriteStream;
}

describe("interactive routing", () => {
	it("passes live triguna pressure into Turiya classification", () => {
		const classify = vi.fn().mockReturnValue({
			tier: "haiku",
			confidence: 0.8,
			costEstimate: 0.0003,
			context: {},
			rationale: "test",
			armIndex: 1,
		});
		const agent = createAgent({
			getChetana: () => ({
				getTriguna: () => ({
					getState: () => ({ sattva: 0.1, rajas: 0.15, tamas: 0.75 }),
				}),
			}) as ReturnType<Agent["getChetana"]>,
		});
		const options = {
			manas: {
				classify: () => ({
					intent: "code-gen",
					route: "llm",
					confidence: 0.9,
					features: { hasCode: true, hasErrorStack: false, multiStep: true, wordCount: 4 },
					durationMs: 1,
				}),
			},
			turiyaRouter: {
				extractContext: () => ({ complexity: 0.2 }),
				classify,
				recordOutcome: () => undefined,
				getStats: () => ({ totalRequests: 0, savingsPercent: 0, totalCost: 0 }),
			},
			userExplicitModel: false,
		} satisfies Partial<InteractiveModeOptions>;

		routeModelForTurn(
			"fix auth flow",
			agent,
			{ currentModel: "claude-haiku-3-5", lastTuriyaDecision: undefined, lastUserMessage: "" },
			options as InteractiveModeOptions,
			createStdout(),
		);

		expect(classify).toHaveBeenCalledWith(
			{ complexity: 0.2 },
			expect.objectContaining({
				costWeightBias: -0.35,
				minimumTier: "sonnet",
			}),
		);
	});

	it("passes triguna routing influence into Marga fallback", () => {
		const classify = vi.fn().mockReturnValue({
			taskType: "search",
			complexity: "simple",
			providerId: "ollama",
			modelId: "qwen3:8b",
			rationale: "test",
			confidence: 0.7,
			skipLLM: false,
		});
		const agent = createAgent({
			getChetana: () => ({
				getTriguna: () => ({
					getState: () => ({ sattva: 0.1, rajas: 0.2, tamas: 0.7 }),
				}),
			}) as ReturnType<Agent["getChetana"]>,
		});
		const options = {
			margaPipeline: { classify },
			userExplicitModel: false,
		} satisfies Partial<InteractiveModeOptions>;

		routeModelForTurn(
			"search logs for auth errors",
			agent,
			{ currentModel: "qwen3:8b", lastTuriyaDecision: undefined, lastUserMessage: "" },
			options as InteractiveModeOptions,
			createStdout(),
		);

		expect(classify).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				routingInfluence: expect.objectContaining({
					minimumComplexity: "complex",
					avoidSkipLLM: true,
				}),
			}),
		);
	});
});
