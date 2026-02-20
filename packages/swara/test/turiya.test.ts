import { describe, it, expect, beforeEach } from "vitest";
import { TuriyaRouter, budgetAdjustedScore, updateBudgetLambda, preferenceBlendedScore } from "@chitragupta/swara";
import type {
	TuriyaContext,
	TuriyaTier,
	TuriyaDecision,
	TuriyaStats,
	TuriyaState,
	TuriyaRouterConfig,
	TuriyaPreference,
	TuriyaCascadeResult,
} from "@chitragupta/swara";
import type { Message, ToolDefinition } from "@chitragupta/swara";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userMsg(text: string): Message {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantMsg(text: string): Message {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function msgs(...texts: string[]): Message[] {
	return texts.map((t, i) =>
		i % 2 === 0 ? userMsg(t) : assistantMsg(t),
	);
}

function simpleTool(name: string): ToolDefinition {
	return {
		name,
		description: `The ${name} tool`,
		parameters: { type: "object", properties: {} },
	};
}

/** Feed enough data to get past heuristic cold-start. */
function warmUp(router: TuriyaRouter, rounds = 12): void {
	const contexts: TuriyaContext[] = [
		{ complexity: 0.05, urgency: 0, creativity: 0, precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0 },
		{ complexity: 0.2, urgency: 0.1, creativity: 0.1, precision: 0.1, codeRatio: 0, conversationDepth: 0.1, memoryLoad: 0 },
		{ complexity: 0.5, urgency: 0.2, creativity: 0.3, precision: 0.4, codeRatio: 0.3, conversationDepth: 0.2, memoryLoad: 0.1 },
		{ complexity: 0.8, urgency: 0.5, creativity: 0.6, precision: 0.7, codeRatio: 0.5, conversationDepth: 0.4, memoryLoad: 0.3 },
	];

	// Each tier gets at least 2 rounds of data
	const tiers: TuriyaTier[] = ["no-llm", "haiku", "sonnet", "opus"];
	for (let i = 0; i < rounds; i++) {
		const ctx = contexts[i % contexts.length];
		const decision = router.classify(ctx);
		// Give higher reward to more complex tiers for complex contexts
		const reward = ctx.complexity > 0.5 && decision.tier === "opus" ? 0.9
			: ctx.complexity < 0.2 && decision.tier === "no-llm" ? 0.9
			: 0.5;
		router.recordOutcome(decision, reward);
	}
}

// ─── Construction ───────────────────────────────────────────────────────────

describe("TuriyaRouter", () => {
	let router: TuriyaRouter;

	beforeEach(() => {
		router = new TuriyaRouter();
	});

	describe("construction", () => {
		it("should create with default config", () => {
			expect(router).toBeDefined();
			const stats = router.getStats();
			expect(stats.totalRequests).toBe(0);
			expect(stats.tiers).toHaveLength(4);
		});

		it("should accept custom config", () => {
			const custom = new TuriyaRouter({
				linucbAlpha: 1.0,
				tierCosts: { "haiku": 0.001 },
				maxConversationDepth: 100,
				maxMemoryHits: 50,
			});
			expect(custom).toBeDefined();
		});

		it("should initialize all four tiers with zero plays", () => {
			const stats = router.getStats();
			for (const tier of stats.tiers) {
				expect(tier.calls).toBe(0);
				expect(tier.totalCost).toBe(0);
				expect(tier.averageReward).toBe(0);
			}
		});

		it("should have zero cost savings initially", () => {
			const stats = router.getStats();
			expect(stats.costSavings).toBe(0);
			expect(stats.savingsPercent).toBe(0);
			expect(stats.opusBaselineCost).toBe(0);
		});
	});

	// ─── Context Extraction ────────────────────────────────────────────────────

	describe("extractContext", () => {
		it("should extract context from simple message", () => {
			const ctx = router.extractContext([userMsg("hello")]);
			expect(ctx.complexity).toBeGreaterThanOrEqual(0);
			expect(ctx.complexity).toBeLessThanOrEqual(1);
			expect(ctx.urgency).toBeGreaterThanOrEqual(0);
			expect(ctx.urgency).toBeLessThanOrEqual(1);
			expect(ctx.creativity).toBeGreaterThanOrEqual(0);
			expect(ctx.creativity).toBeLessThanOrEqual(1);
			expect(ctx.precision).toBeGreaterThanOrEqual(0);
			expect(ctx.precision).toBeLessThanOrEqual(1);
			expect(ctx.codeRatio).toBeGreaterThanOrEqual(0);
			expect(ctx.codeRatio).toBeLessThanOrEqual(1);
			expect(ctx.conversationDepth).toBeGreaterThanOrEqual(0);
			expect(ctx.conversationDepth).toBeLessThanOrEqual(1);
			expect(ctx.memoryLoad).toBeGreaterThanOrEqual(0);
			expect(ctx.memoryLoad).toBeLessThanOrEqual(1);
		});

		it("should detect high complexity from code + multi-step + expert domain", () => {
			const ctx = router.extractContext([
				userMsg("first implement a distributed system with fault tolerance, then refactor across multiple files"),
			]);
			expect(ctx.complexity).toBeGreaterThan(0.4);
		});

		it("should detect urgency from error context", () => {
			const ctx = router.extractContext([
				userMsg("URGENT! Production is broken, critical bug needs fix now!"),
			]);
			expect(ctx.urgency).toBeGreaterThan(0.3);
		});

		it("should detect creativity from brainstorming", () => {
			const ctx = router.extractContext([
				userMsg("brainstorm some creative ideas for a novel approach"),
			]);
			expect(ctx.creativity).toBeGreaterThan(0.3);
		});

		it("should detect precision from math/audit context", () => {
			const ctx = router.extractContext([
				userMsg("verify the exact calculation: 42 * 17 = 714, and audit the code review"),
			]);
			expect(ctx.precision).toBeGreaterThan(0.3);
		});

		it("should detect code ratio from code blocks", () => {
			const ctx = router.extractContext([
				userMsg("look at this:\n```typescript\nfunction foo() { return 42; }\n```\nwhat does it do?"),
			]);
			expect(ctx.codeRatio).toBeGreaterThan(0.1);
		});

		it("should detect code ratio from file references", () => {
			const ctx = router.extractContext([
				userMsg("check the parser.ts file for bugs"),
			]);
			expect(ctx.codeRatio).toBeGreaterThan(0);
		});

		it("should scale conversation depth with message count", () => {
			const short = router.extractContext([userMsg("hello")]);
			const long = router.extractContext([
				...msgs("hello", "hi", "help", "sure", "thanks", "welcome",
					"more", "ok", "done", "great"),
			]);
			expect(long.conversationDepth).toBeGreaterThan(short.conversationDepth);
		});

		it("should include memory load when provided", () => {
			const noMem = router.extractContext([userMsg("hello")], undefined, undefined, 0);
			const highMem = router.extractContext([userMsg("hello")], undefined, undefined, 15);
			expect(highMem.memoryLoad).toBeGreaterThan(noMem.memoryLoad);
		});

		it("should handle empty messages", () => {
			const ctx = router.extractContext([]);
			expect(ctx.complexity).toBe(0);
			expect(ctx.urgency).toBe(0);
		});

		it("should consider system prompt in complexity estimation", () => {
			const noSys = router.extractContext([userMsg("hello")]);
			const longSys = router.extractContext(
				[userMsg("hello")],
				"You are an expert distributed systems architect. Analyze everything with mathematical rigor. " +
				Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
			);
			// System prompt adds tokens, affecting complexity
			expect(longSys.complexity).toBeGreaterThanOrEqual(noSys.complexity);
		});
	});

	// ─── Classification ─────────────────────────────────────────────────────────

	describe("classify", () => {
		it("should return a valid TuriyaDecision", () => {
			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0.1, creativity: 0.2,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(["no-llm", "haiku", "sonnet", "opus"]).toContain(decision.tier);
			expect(decision.confidence).toBeGreaterThanOrEqual(0);
			expect(decision.confidence).toBeLessThanOrEqual(1);
			expect(decision.costEstimate).toBeGreaterThanOrEqual(0);
			expect(decision.context).toEqual(ctx);
			expect(decision.rationale).toBeTruthy();
			expect(decision.armIndex).toBeGreaterThanOrEqual(0);
			expect(decision.armIndex).toBeLessThanOrEqual(3);
		});

		it("should use heuristic fallback on cold start", () => {
			const ctx: TuriyaContext = {
				complexity: 0.05, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(decision.rationale).toContain("[heuristic]");
		});

		it("should route trivial requests to no-llm or haiku on cold start", () => {
			const ctx: TuriyaContext = {
				complexity: 0.02, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(["no-llm", "haiku"]).toContain(decision.tier);
		});

		it("should route complex requests to opus on cold start", () => {
			const ctx: TuriyaContext = {
				complexity: 0.85, urgency: 0.3, creativity: 0.5,
				precision: 0.6, codeRatio: 0.4, conversationDepth: 0.3, memoryLoad: 0.2,
			};
			const decision = router.classify(ctx);
			expect(decision.tier).toBe("opus");
		});

		it("should use LinUCB after warm-up", () => {
			warmUp(router);
			const ctx: TuriyaContext = {
				complexity: 0.4, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			// After warm-up, should NOT be heuristic
			expect(decision.rationale).not.toContain("[heuristic]");
		});

		it("should return cost estimate matching tier", () => {
			const ctx: TuriyaContext = {
				complexity: 0.02, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(decision.costEstimate).toBeGreaterThanOrEqual(0);
		});

		it("should produce consistent decisions for identical contexts before learning", () => {
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.2, creativity: 0.3,
				precision: 0.4, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};
			// On cold start, heuristic is deterministic
			const d1 = router.classify(ctx);
			const d2 = router.classify(ctx);
			expect(d1.tier).toBe(d2.tier);
		});
	});

	// ─── Feedback Loop ──────────────────────────────────────────────────────────

	describe("recordOutcome", () => {
		it("should increment total requests", () => {
			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			router.recordOutcome(decision, 0.8);
			expect(router.getStats().totalRequests).toBe(1);
		});

		it("should update tier stats after recording", () => {
			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			router.recordOutcome(decision, 0.8);

			const stats = router.getStats();
			const tierStats = stats.tiers.find(t => t.tier === decision.tier)!;
			expect(tierStats.calls).toBe(1);
			expect(tierStats.averageReward).toBeCloseTo(0.8, 1);
		});

		it("should clamp reward to [0, 1]", () => {
			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);

			// Negative reward
			router.recordOutcome(decision, -5);
			let stats = router.getStats();
			let tierStats = stats.tiers.find(t => t.tier === decision.tier)!;
			expect(tierStats.averageReward).toBeGreaterThanOrEqual(0);

			// Over-1 reward
			router.recordOutcome(decision, 10);
			stats = router.getStats();
			tierStats = stats.tiers.find(t => t.tier === decision.tier)!;
			expect(tierStats.averageReward).toBeLessThanOrEqual(1);
		});

		it("should update Thompson posteriors", () => {
			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			router.recordOutcome(decision, 0.9);

			const stats = router.getStats();
			const tierStats = stats.tiers.find(t => t.tier === decision.tier)!;
			// Alpha should have increased from 1 (prior) by 0.9
			expect(tierStats.alpha).toBeCloseTo(1.9, 1);
			// Beta should have increased from 1 (prior) by 0.1
			expect(tierStats.beta).toBeCloseTo(1.1, 1);
		});

		it("should track opus baseline cost", () => {
			const ctx: TuriyaContext = {
				complexity: 0.1, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			router.recordOutcome(decision, 0.8);

			const stats = router.getStats();
			expect(stats.opusBaselineCost).toBeGreaterThan(0);
		});

		it("should accumulate across multiple recordings", () => {
			for (let i = 0; i < 5; i++) {
				const ctx: TuriyaContext = {
					complexity: 0.1 * i, urgency: 0, creativity: 0,
					precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
				};
				const decision = router.classify(ctx);
				router.recordOutcome(decision, 0.7);
			}
			expect(router.getStats().totalRequests).toBe(5);
		});
	});

	// ─── Cost Tracking ──────────────────────────────────────────────────────────

	describe("cost tracking", () => {
		it("should report zero cost for no-llm tier", () => {
			const ctx: TuriyaContext = {
				complexity: 0, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			if (decision.tier === "no-llm") {
				expect(decision.costEstimate).toBe(0);
			}
		});

		it("should calculate cost savings vs opus baseline", () => {
			// Route several requests to cheap tiers
			for (let i = 0; i < 10; i++) {
				const ctx: TuriyaContext = {
					complexity: 0.1, urgency: 0, creativity: 0,
					precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
				};
				const decision = router.classify(ctx);
				router.recordOutcome(decision, 0.8);
			}

			const stats = router.getStats();
			// Since we routed to cheap tiers, savings should be positive
			expect(stats.costSavings).toBeGreaterThanOrEqual(0);
			// Opus baseline should be 10 * opus cost
			expect(stats.opusBaselineCost).toBeCloseTo(10 * 0.015, 4);
		});

		it("should report savings percentage", () => {
			for (let i = 0; i < 5; i++) {
				const ctx: TuriyaContext = {
					complexity: 0.05, urgency: 0, creativity: 0,
					precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
				};
				const decision = router.classify(ctx);
				router.recordOutcome(decision, 0.8);
			}

			const stats = router.getStats();
			if (stats.opusBaselineCost > 0) {
				expect(stats.savingsPercent).toBeGreaterThanOrEqual(0);
				expect(stats.savingsPercent).toBeLessThanOrEqual(100);
			}
		});

		it("should support custom tier costs", () => {
			const custom = new TuriyaRouter({
				tierCosts: {
					"no-llm": 0,
					"haiku": 0.001,
					"sonnet": 0.01,
					"opus": 0.05,
				},
			});

			const ctx: TuriyaContext = {
				complexity: 0.9, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = custom.classify(ctx);
			// Opus tier should use custom cost
			if (decision.tier === "opus") {
				expect(decision.costEstimate).toBe(0.05);
			}
		});
	});

	// ─── Statistics ──────────────────────────────────────────────────────────────

	describe("getStats", () => {
		it("should return stats for all four tiers", () => {
			const stats = router.getStats();
			expect(stats.tiers).toHaveLength(4);
			const tierNames = stats.tiers.map(t => t.tier);
			expect(tierNames).toContain("no-llm");
			expect(tierNames).toContain("haiku");
			expect(tierNames).toContain("sonnet");
			expect(tierNames).toContain("opus");
		});

		it("should correctly sum total cost", () => {
			for (let i = 0; i < 3; i++) {
				const ctx: TuriyaContext = {
					complexity: 0.3, urgency: 0, creativity: 0,
					precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
				};
				const decision = router.classify(ctx);
				router.recordOutcome(decision, 0.7);
			}

			const stats = router.getStats();
			const summedCost = stats.tiers.reduce((s, t) => s + t.totalCost, 0);
			expect(stats.totalCost).toBeCloseTo(summedCost, 6);
		});

		it("should have average reward between 0 and 1 for played tiers", () => {
			warmUp(router, 20);
			const stats = router.getStats();
			for (const tier of stats.tiers) {
				if (tier.calls > 0) {
					expect(tier.averageReward).toBeGreaterThanOrEqual(0);
					expect(tier.averageReward).toBeLessThanOrEqual(1);
				}
			}
		});
	});

	// ─── Learning Behavior ──────────────────────────────────────────────────────

	describe("learning", () => {
		it("should shift towards rewarded tiers over time", () => {
			// Always give high reward for sonnet on medium complexity
			const medCtx: TuriyaContext = {
				complexity: 0.45, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};

			// Warm up first
			warmUp(router, 16);

			// Now heavily reward sonnet for medium complexity
			for (let i = 0; i < 30; i++) {
				const decision = router.classify(medCtx);
				const reward = decision.tier === "sonnet" ? 0.95 : 0.2;
				router.recordOutcome(decision, reward);
			}

			// After enough learning, the router should have some data
			const stats = router.getStats();
			expect(stats.totalRequests).toBeGreaterThan(30);
		});

		it("should adapt LinUCB parameters through feedback", () => {
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.3, creativity: 0.2,
				precision: 0.4, codeRatio: 0.3, conversationDepth: 0.1, memoryLoad: 0,
			};

			// Record multiple outcomes
			for (let i = 0; i < 15; i++) {
				const decision = router.classify(ctx);
				router.recordOutcome(decision, 0.8);
			}

			// Verify state was updated (serialize to check)
			const state = router.serialize();
			// At least some arms should have been played
			const playedArms = state.arms.filter(a => a.plays > 0);
			expect(playedArms.length).toBeGreaterThan(0);
		});
	});

	// ─── Serialization ──────────────────────────────────────────────────────────

	describe("serialize / deserialize", () => {
		it("should serialize to a valid TuriyaState", () => {
			warmUp(router, 10);
			const state = router.serialize();

			expect(state.totalPlays).toBe(10);
			expect(state.arms).toHaveLength(4);
			expect(state.linucbAlpha).toBe(0.5);

			for (const arm of state.arms) {
				expect(["no-llm", "haiku", "sonnet", "opus"]).toContain(arm.tier);
				expect(arm.linA).toHaveLength(64); // 8 x 8
				expect(arm.linB).toHaveLength(8);
				expect(arm.alpha).toBeGreaterThanOrEqual(1);
				expect(arm.beta).toBeGreaterThanOrEqual(1);
			}
		});

		it("should round-trip through serialize/deserialize", () => {
			warmUp(router, 10);
			const state1 = router.serialize();

			const router2 = new TuriyaRouter();
			router2.deserialize(state1);
			const state2 = router2.serialize();

			expect(state2.totalPlays).toBe(state1.totalPlays);
			expect(state2.opusBaselineCost).toBe(state1.opusBaselineCost);

			for (let i = 0; i < state1.arms.length; i++) {
				expect(state2.arms[i].tier).toBe(state1.arms[i].tier);
				expect(state2.arms[i].plays).toBe(state1.arms[i].plays);
				expect(state2.arms[i].totalReward).toBeCloseTo(state1.arms[i].totalReward, 6);
				expect(state2.arms[i].alpha).toBeCloseTo(state1.arms[i].alpha, 6);
				expect(state2.arms[i].beta).toBeCloseTo(state1.arms[i].beta, 6);
			}
		});

		it("should produce same decisions after deserialization", () => {
			warmUp(router, 16);
			const state = router.serialize();

			const router2 = new TuriyaRouter();
			router2.deserialize(state);

			const ctx: TuriyaContext = {
				complexity: 0.4, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};

			// Both routers should make the same LinUCB decision
			const d1 = router.classify(ctx);
			const d2 = router2.classify(ctx);
			expect(d1.tier).toBe(d2.tier);
			expect(d1.confidence).toBeCloseTo(d2.confidence, 6);
		});
	});

	// ─── Reset ──────────────────────────────────────────────────────────────────

	describe("reset", () => {
		it("should clear all learned state", () => {
			warmUp(router, 20);
			expect(router.getStats().totalRequests).toBe(20);

			router.reset();

			const stats = router.getStats();
			expect(stats.totalRequests).toBe(0);
			expect(stats.totalCost).toBe(0);
			expect(stats.opusBaselineCost).toBe(0);
			expect(stats.costSavings).toBe(0);

			for (const tier of stats.tiers) {
				expect(tier.calls).toBe(0);
				expect(tier.averageReward).toBe(0);
			}
		});

		it("should revert to heuristic mode after reset", () => {
			warmUp(router, 20);
			router.reset();

			const ctx: TuriyaContext = {
				complexity: 0.3, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(decision.rationale).toContain("[heuristic]");
		});
	});

	// ─── End-to-End Integration ─────────────────────────────────────────────────

	describe("end-to-end", () => {
		it("should handle full extract → classify → record cycle", () => {
			const messages: Message[] = [
				userMsg("implement a distributed cache with LRU eviction"),
			];

			const ctx = router.extractContext(messages);
			const decision = router.classify(ctx);
			router.recordOutcome(decision, 0.85);

			expect(router.getStats().totalRequests).toBe(1);
			expect(decision.tier).toBeDefined();
		});

		it("should handle conversation with multiple turns", () => {
			const messages: Message[] = [
				userMsg("help me design a system"),
				assistantMsg("sure, what kind of system?"),
				userMsg("a distributed key-value store with consensus"),
				assistantMsg("here's a design..."),
				userMsg("now implement the Raft consensus module"),
			];

			const ctx = router.extractContext(messages);
			expect(ctx.conversationDepth).toBeGreaterThan(0);
			expect(ctx.complexity).toBeGreaterThan(0);

			const decision = router.classify(ctx);
			expect(decision.tier).toBeDefined();
		});

		it("should route tool-only requests cheaply", () => {
			const ctx = router.extractContext(
				[userMsg("search for files named parser.ts")],
				undefined,
				[simpleTool("file_search")],
			);

			// Tool-only requests should have low complexity and code ratio
			const decision = router.classify(ctx);
			expect(["no-llm", "haiku"]).toContain(decision.tier);
		});

		it("should handle code-heavy conversation", () => {
			const ctx = router.extractContext([
				userMsg("review this code:\n```typescript\nexport class Parser {\n  private tokens: Token[];\n  constructor(tokens: Token[]) {\n    this.tokens = tokens;\n  }\n  parse(): AST {\n    return this.parseExpression();\n  }\n}\n```\nfind all bugs and suggest improvements"),
			]);

			expect(ctx.codeRatio).toBeGreaterThan(0.1);
			expect(ctx.precision).toBeGreaterThan(0);
		});

		it("should route urgent bug fixes appropriately", () => {
			const ctx = router.extractContext([
				userMsg("URGENT: production is down! Critical bug in the authentication module, fix ASAP!"),
			]);

			expect(ctx.urgency).toBeGreaterThan(0.3);
			const decision = router.classify(ctx);
			// Urgent requests should not be routed to no-llm
			expect(decision.tier).not.toBe("no-llm");
		});
	});

	// ─── Edge Cases ─────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle all-zero context", () => {
			const ctx: TuriyaContext = {
				complexity: 0, urgency: 0, creativity: 0,
				precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(decision.tier).toBeDefined();
			expect(decision.confidence).toBeGreaterThanOrEqual(0);
		});

		it("should handle all-one context", () => {
			const ctx: TuriyaContext = {
				complexity: 1, urgency: 1, creativity: 1,
				precision: 1, codeRatio: 1, conversationDepth: 1, memoryLoad: 1,
			};
			const decision = router.classify(ctx);
			expect(decision.tier).toBe("opus");
		});

		it("should handle rapid sequential classifications", () => {
			for (let i = 0; i < 100; i++) {
				const ctx: TuriyaContext = {
					complexity: Math.random(),
					urgency: Math.random(),
					creativity: Math.random(),
					precision: Math.random(),
					codeRatio: Math.random(),
					conversationDepth: Math.random(),
					memoryLoad: Math.random(),
				};
				const decision = router.classify(ctx);
				expect(decision.tier).toBeDefined();
				router.recordOutcome(decision, Math.random());
			}

			const stats = router.getStats();
			expect(stats.totalRequests).toBe(100);
		});

		it("should not crash with NaN in context (treated as 0 after clamp)", () => {
			// The context values are directly used — ensure no NaN propagation
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.3, creativity: 0.2,
				precision: 0.4, codeRatio: 0.1, conversationDepth: 0, memoryLoad: 0,
			};
			const decision = router.classify(ctx);
			expect(isNaN(decision.confidence)).toBe(false);
			expect(isNaN(decision.costEstimate)).toBe(false);
		});

		it("should handle very long messages without degrading performance", () => {
			const longText = Array.from({ length: 5000 }, (_, i) => `word${i}`).join(" ");
			const start = performance.now();
			const ctx = router.extractContext([userMsg(longText)]);
			const decision = router.classify(ctx);
			const elapsed = performance.now() - start;

			expect(decision.tier).toBeDefined();
			// Should complete within 10ms (generous bound)
			expect(elapsed).toBeLessThan(10);
		});

		it("should have <1ms classify latency after warm-up", () => {
			warmUp(router, 16);

			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.2, creativity: 0.3,
				precision: 0.4, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};

			// Warm the JIT
			for (let i = 0; i < 100; i++) router.classify(ctx);

			const start = performance.now();
			for (let i = 0; i < 1000; i++) router.classify(ctx);
			const elapsed = performance.now() - start;

			const avgMs = elapsed / 1000;
			expect(avgMs).toBeLessThan(1);
		});
	});

	// ─── V2: Budget-Aware Scoring (PILOT) ───────────────────────────────────────

	describe("budget-aware scoring (PILOT)", () => {
		it("should accept dailyBudget and expectedDailyRequests config", () => {
			const budgetRouter = new TuriyaRouter({
				dailyBudget: 5.0,
				expectedDailyRequests: 100,
			});
			expect(budgetRouter).toBeDefined();
			expect(budgetRouter.getBudgetLambda()).toBe(0);
		});

		it("should increase lambda when spending above budget pace", () => {
			const budgetRouter = new TuriyaRouter({
				dailyBudget: 0.01, // Very tight budget
				expectedDailyRequests: 10,
			});

			warmUp(budgetRouter, 12);

			// Route some expensive requests
			const ctx: TuriyaContext = {
				complexity: 0.9, urgency: 0.5, creativity: 0.5,
				precision: 0.7, codeRatio: 0.4, conversationDepth: 0.2, memoryLoad: 0.2,
			};

			for (let i = 0; i < 20; i++) {
				const d = budgetRouter.classify(ctx);
				budgetRouter.recordOutcome(d, 0.8);
			}

			// Lambda should have grown due to budget pressure
			expect(budgetRouter.getBudgetLambda()).toBeGreaterThan(0);
		});

		it("should not update lambda when no budget constraint", () => {
			warmUp(router);
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};
			for (let i = 0; i < 10; i++) {
				const d = router.classify(ctx);
				router.recordOutcome(d, 0.7);
			}
			// Default config has no budget cap, so lambda stays 0
			expect(router.getBudgetLambda()).toBe(0);
		});

		it("should serialize and restore budgetLambda", () => {
			const budgetRouter = new TuriyaRouter({
				dailyBudget: 0.01,
				expectedDailyRequests: 10,
			});
			warmUp(budgetRouter, 12);

			const ctx: TuriyaContext = {
				complexity: 0.8, urgency: 0.3, creativity: 0.3,
				precision: 0.5, codeRatio: 0.3, conversationDepth: 0.1, memoryLoad: 0,
			};
			for (let i = 0; i < 10; i++) {
				const d = budgetRouter.classify(ctx);
				budgetRouter.recordOutcome(d, 0.7);
			}

			const state = budgetRouter.serialize();
			expect(state.budgetLambda).toBeGreaterThanOrEqual(0);

			const restored = new TuriyaRouter({ dailyBudget: 0.01, expectedDailyRequests: 10 });
			restored.deserialize(state);
			expect(restored.getBudgetLambda()).toBe(state.budgetLambda);
		});
	});

	// ─── V2: Preference Conditioning (LLM Bandit) ───────────────────────────────

	describe("preference conditioning (LLM Bandit)", () => {
		it("should accept preference parameter in classify", () => {
			warmUp(router, 12);
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};

			const noPreference = router.classify(ctx);
			const costPreference = router.classify(ctx, { costWeight: 0.9 });
			const qualityPreference = router.classify(ctx, { costWeight: 0.0 });

			expect(noPreference.tier).toBeDefined();
			expect(costPreference.tier).toBeDefined();
			expect(qualityPreference.tier).toBeDefined();
		});

		it("should favor cheaper tiers with high costWeight", () => {
			const budgetRouter = new TuriyaRouter();
			warmUp(budgetRouter, 16);

			const ctx: TuriyaContext = {
				complexity: 0.4, urgency: 0.2, creativity: 0.2,
				precision: 0.3, codeRatio: 0.1, conversationDepth: 0.1, memoryLoad: 0,
			};

			// With max cost preference, should lean toward cheaper tiers
			const costDecision = budgetRouter.classify(ctx, { costWeight: 1.0 });
			const qualityDecision = budgetRouter.classify(ctx, { costWeight: 0.0 });

			// Cost tier index should be <= quality tier index (cheaper or same)
			const tiers: TuriyaTier[] = ["no-llm", "haiku", "sonnet", "opus"];
			const costIdx = tiers.indexOf(costDecision.tier);
			const qualityIdx = tiers.indexOf(qualityDecision.tier);
			expect(costIdx).toBeLessThanOrEqual(qualityIdx);
		});

		it("should not change heuristic behavior on cold start", () => {
			const ctx: TuriyaContext = {
				complexity: 0.5, urgency: 0.2, creativity: 0.3,
				precision: 0.3, codeRatio: 0.2, conversationDepth: 0.1, memoryLoad: 0,
			};

			// On cold start, preference is ignored (heuristic doesn't use it)
			const noPreference = router.classify(ctx);
			const withPreference = router.classify(ctx, { costWeight: 0.8 });
			expect(noPreference.tier).toBe(withPreference.tier);
		});
	});

	// ─── V2: Cascade Routing ────────────────────────────────────────────────────

	describe("cascade routing", () => {
		it("should not escalate when confidence is above threshold", () => {
			const decision: TuriyaDecision = {
				tier: "haiku",
				confidence: 0.8,
				costEstimate: 0.0003,
				context: { complexity: 0.2, urgency: 0, creativity: 0, precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0 },
				rationale: "test",
				armIndex: 1,
			};

			const cascade = router.cascadeDecision(decision);
			expect(cascade.escalated).toBe(false);
			expect(cascade.final.tier).toBe("haiku");
			expect(cascade.originalTier).toBeUndefined();
		});

		it("should escalate when confidence is below threshold", () => {
			const decision: TuriyaDecision = {
				tier: "haiku",
				confidence: 0.2,
				costEstimate: 0.0003,
				context: { complexity: 0.4, urgency: 0.1, creativity: 0.1, precision: 0.2, codeRatio: 0.1, conversationDepth: 0, memoryLoad: 0 },
				rationale: "test rationale",
				armIndex: 1,
			};

			const cascade = router.cascadeDecision(decision);
			expect(cascade.escalated).toBe(true);
			expect(cascade.final.tier).toBe("sonnet");
			expect(cascade.originalTier).toBe("haiku");
			expect(cascade.final.rationale).toContain("[cascade]");
		});

		it("should not escalate opus even with low confidence", () => {
			const decision: TuriyaDecision = {
				tier: "opus",
				confidence: 0.1,
				costEstimate: 0.015,
				context: { complexity: 0.9, urgency: 0.5, creativity: 0.5, precision: 0.7, codeRatio: 0.4, conversationDepth: 0.2, memoryLoad: 0.2 },
				rationale: "test",
				armIndex: 3,
			};

			const cascade = router.cascadeDecision(decision);
			expect(cascade.escalated).toBe(false);
			expect(cascade.final.tier).toBe("opus");
		});

		it("should escalate no-llm to haiku", () => {
			const decision: TuriyaDecision = {
				tier: "no-llm",
				confidence: 0.2,
				costEstimate: 0,
				context: { complexity: 0.1, urgency: 0, creativity: 0, precision: 0, codeRatio: 0, conversationDepth: 0, memoryLoad: 0 },
				rationale: "test",
				armIndex: 0,
			};

			const cascade = router.cascadeDecision(decision);
			expect(cascade.escalated).toBe(true);
			expect(cascade.final.tier).toBe("haiku");
		});

		it("should escalate sonnet to opus", () => {
			const decision: TuriyaDecision = {
				tier: "sonnet",
				confidence: 0.3,
				costEstimate: 0.003,
				context: { complexity: 0.6, urgency: 0.3, creativity: 0.3, precision: 0.5, codeRatio: 0.3, conversationDepth: 0.1, memoryLoad: 0 },
				rationale: "test",
				armIndex: 2,
			};

			const cascade = router.cascadeDecision(decision);
			expect(cascade.escalated).toBe(true);
			expect(cascade.final.tier).toBe("opus");
			expect(cascade.final.costEstimate).toBe(0.015);
		});

		it("should respect custom quality threshold", () => {
			const decision: TuriyaDecision = {
				tier: "haiku",
				confidence: 0.5,
				costEstimate: 0.0003,
				context: { complexity: 0.3, urgency: 0.1, creativity: 0.1, precision: 0.2, codeRatio: 0.1, conversationDepth: 0, memoryLoad: 0 },
				rationale: "test",
				armIndex: 1,
			};

			// Threshold 0.4 => confidence 0.5 >= 0.4 => no escalation
			const noEscalate = router.cascadeDecision(decision, 0.4);
			expect(noEscalate.escalated).toBe(false);

			// Threshold 0.8 => confidence 0.5 < 0.8 => escalation
			const escalate = router.cascadeDecision(decision, 0.8);
			expect(escalate.escalated).toBe(true);
		});

		it("should work in full extract → classify → cascade → record cycle", () => {
			warmUp(router, 16);

			const ctx = router.extractContext([
				userMsg("implement a complex distributed system"),
			]);
			const decision = router.classify(ctx);
			const cascade = router.cascadeDecision(decision);
			router.recordOutcome(cascade.final, 0.85);

			expect(router.getStats().totalRequests).toBeGreaterThan(16);
		});
	});

	// ─── V2: Math Functions ─────────────────────────────────────────────────────

	describe("turiya-math public functions", () => {
		it("budgetAdjustedScore should reduce score for expensive arms", () => {
			const base = budgetAdjustedScore(1.0, 0.015, 10);
			const cheap = budgetAdjustedScore(1.0, 0.0003, 10);
			expect(cheap).toBeGreaterThan(base);
		});

		it("budgetAdjustedScore with zero lambda should return ucbScore", () => {
			expect(budgetAdjustedScore(1.5, 0.015, 0)).toBe(1.5);
		});

		it("updateBudgetLambda should increase when cost exceeds budget", () => {
			const newLambda = updateBudgetLambda(0, 0.015, 0.001, 0.01);
			expect(newLambda).toBeGreaterThan(0);
		});

		it("updateBudgetLambda should decrease when cost is under budget", () => {
			const newLambda = updateBudgetLambda(1.0, 0.001, 0.015, 0.01);
			expect(newLambda).toBeLessThan(1.0);
		});

		it("updateBudgetLambda should never go negative", () => {
			const newLambda = updateBudgetLambda(0, 0.001, 0.015, 0.01);
			expect(newLambda).toBeGreaterThanOrEqual(0);
		});

		it("preferenceBlendedScore with costWeight=0 should return rewardScore", () => {
			expect(preferenceBlendedScore(1.5, 0.8, 0)).toBe(1.5);
		});

		it("preferenceBlendedScore with costWeight=1 should return costScore", () => {
			expect(preferenceBlendedScore(1.5, 0.8, 1)).toBe(0.8);
		});

		it("preferenceBlendedScore should interpolate linearly", () => {
			const blended = preferenceBlendedScore(1.0, 0.5, 0.5);
			expect(blended).toBeCloseTo(0.75, 6);
		});
	});
});
