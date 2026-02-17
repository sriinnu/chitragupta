import { describe, it, expect } from "vitest";
import { ModelRouter, DEFAULT_TIERS, CLOUD_TIERS } from "@chitragupta/swara";
import type { ProviderRegistry, Context, ProviderDefinition } from "@chitragupta/swara";

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

function ctx(text: string): Context {
	return {
		messages: [{ role: "user", content: [{ type: "text", text }] }],
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ModelRouter", () => {
	describe("DEFAULT_TIERS", () => {
		it("should have exactly 5 entries, one per complexity level", () => {
			expect(DEFAULT_TIERS).toHaveLength(5);
			const complexities = DEFAULT_TIERS.map((t) => t.complexity);
			expect(complexities).toContain("trivial");
			expect(complexities).toContain("simple");
			expect(complexities).toContain("medium");
			expect(complexities).toContain("complex");
			expect(complexities).toContain("expert");
		});
	});

	describe("CLOUD_TIERS", () => {
		it("should have exactly 5 entries", () => {
			expect(CLOUD_TIERS).toHaveLength(5);
			const complexities = CLOUD_TIERS.map((t) => t.complexity);
			expect(complexities).toContain("trivial");
			expect(complexities).toContain("simple");
			expect(complexities).toContain("medium");
			expect(complexities).toContain("complex");
			expect(complexities).toContain("expert");
		});
	});

	describe("route()", () => {
		it("should return a RoutingDecision with tier and classification", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const decision = router.route(ctx("hello"));
			expect(decision).toHaveProperty("tier");
			expect(decision).toHaveProperty("classification");
			expect(decision.tier).toHaveProperty("complexity");
			expect(decision.tier).toHaveProperty("providerId");
			expect(decision.tier).toHaveProperty("modelId");
			expect(decision.classification).toHaveProperty("complexity");
			expect(decision.classification).toHaveProperty("reason");
			expect(decision.classification).toHaveProperty("confidence");
		});

		it("should select the simple tier for a greeting (greeting + brief request signals)", () => {
			// "hi" fires greeting (weight 0) + brief request (weight 1.0) = 1.0 → simple tier
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const decision = router.route(ctx("hi"));
			expect(decision.tier.complexity).toBe("simple");
			expect(decision.classification.complexity).toBe("simple");
		});

		it("should detect code keywords and route to appropriate tier", () => {
			// "implement a binary search function" → code keywords (weight 2.0) → score 2.0 → simple [1.0, 2.5)
			// Adding tool-augmented signals pushes it higher
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const decision = router.route(ctx("implement a binary search function"));
			expect(decision.classification.reason).toContain("code-related keywords");
		});

		it("should select complex or higher tier when multiple heavy signals fire", () => {
			// code keywords (2.0) + multi-step (3.0) + reasoning (2.5) → score ≥ 4.0 → complex+
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const decision = router.route(
				ctx("first analyze the architecture then refactor the module to implement the new design"),
			);
			const order = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(order[decision.tier.complexity]).toBeGreaterThanOrEqual(order["complex"]);
		});

		it("should fall back to most powerful tier when no exact tier matches", () => {
			// Create a router with only an expert tier — the detected complexity has no match
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const singleTier = [DEFAULT_TIERS[4]]; // expert only
			const router = new ModelRouter({ tiers: singleTier, registry });
			// "hello" classifies as simple, but no simple tier exists → fallback to most powerful
			const decision = router.route(ctx("hello"));
			expect(decision.tier.complexity).toBe("expert");
		});

		it("should throw when no tier matches and no providers are available for fallback", () => {
			// Use an empty registry so getMostPowerfulAvailable() returns undefined,
			// and use a single tier that won't match a simple classification.
			const registry = createMockRegistry([]);
			const singleTier = [DEFAULT_TIERS[4]]; // expert only, provider "anthropic" not registered
			const router = new ModelRouter({ tiers: singleTier, registry });
			// "hello" classifies as simple, no tier matches, getMostPowerful returns undefined → throws
			expect(() => router.route(ctx("hello"))).toThrow();
		});
	});

	describe("setTiers() / getTiers()", () => {
		it("should set custom tiers and getTiers returns a copy", () => {
			const registry = createMockRegistry(["ollama"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const customTiers = [
				{ complexity: "trivial" as const, providerId: "ollama", modelId: "tiny", costPer1kTokens: 0, maxTokens: 1024 },
				{ complexity: "simple" as const, providerId: "ollama", modelId: "small", costPer1kTokens: 0, maxTokens: 2048 },
				{ complexity: "medium" as const, providerId: "ollama", modelId: "med", costPer1kTokens: 0, maxTokens: 4096 },
				{ complexity: "complex" as const, providerId: "ollama", modelId: "big", costPer1kTokens: 0, maxTokens: 8192 },
				{ complexity: "expert" as const, providerId: "ollama", modelId: "huge", costPer1kTokens: 0, maxTokens: 16384 },
			];
			router.setTiers(customTiers);
			const retrieved = router.getTiers();
			expect(retrieved).toHaveLength(5);
			expect(retrieved[0].modelId).toBe("tiny");
			// Verify it is a copy (mutating retrieved does not affect internal state)
			retrieved.pop();
			expect(router.getTiers()).toHaveLength(5);
		});
	});

	describe("getCheapestAvailable()", () => {
		it("should return the lowest cost tier with a registered provider", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const cheapest = router.getCheapestAvailable();
			expect(cheapest).toBeDefined();
			expect(cheapest!.costPer1kTokens).toBe(0);
		});

		it("should return undefined when no providers are registered", () => {
			const registry = createMockRegistry([]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const cheapest = router.getCheapestAvailable();
			expect(cheapest).toBeUndefined();
		});
	});

	describe("getMostPowerfulAvailable()", () => {
		it("should return the highest cost tier with a registered provider", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const powerful = router.getMostPowerfulAvailable();
			expect(powerful).toBeDefined();
			expect(powerful!.costPer1kTokens).toBe(15.0);
			expect(powerful!.complexity).toBe("expert");
		});
	});

	describe("constructor defaults", () => {
		it("should store autoEscalate and maxEscalations defaults", () => {
			const registry = createMockRegistry(["ollama"]);
			// Default autoEscalate is false, maxEscalations is 2
			// We verify indirectly: route should work without escalation config
			const router = new ModelRouter({ tiers: DEFAULT_TIERS, registry });
			const decision = router.route(ctx("hi"));
			expect(decision).toBeDefined();
		});

		it("should accept explicit autoEscalate and maxEscalations", () => {
			const registry = createMockRegistry(["ollama", "anthropic"]);
			const router = new ModelRouter({
				tiers: DEFAULT_TIERS,
				registry,
				autoEscalate: true,
				maxEscalations: 5,
			});
			// Router should still work; we just verify construction does not throw
			const decision = router.route(ctx("hello"));
			expect(decision.tier).toBeDefined();
		});
	});
});
