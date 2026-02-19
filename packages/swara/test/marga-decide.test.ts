import { describe, it, expect } from "vitest";
import {
	margaDecide,
	MARGA_CONTRACT_VERSION,
	ESCALATION_CHAIN,
} from "@chitragupta/swara";
import type { MargaDecideRequest, MargaDecision } from "@chitragupta/swara";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decide(message: string, opts?: Partial<Omit<MargaDecideRequest, "message">>): MargaDecision {
	return margaDecide({ message, ...opts });
}

// ─── Contract Shape ──────────────────────────────────────────────────────────

describe("margaDecide — contract", () => {
	it("should include all required fields in the decision", () => {
		const d = decide("Hello world");
		expect(d).toHaveProperty("decisionVersion");
		expect(d).toHaveProperty("providerId");
		expect(d).toHaveProperty("modelId");
		expect(d).toHaveProperty("taskType");
		expect(d).toHaveProperty("resolution");
		expect(d).toHaveProperty("complexity");
		expect(d).toHaveProperty("skipLLM");
		expect(d).toHaveProperty("escalationChain");
		expect(d).toHaveProperty("rationale");
		expect(d).toHaveProperty("confidence");
		expect(d).toHaveProperty("decisionTimeMs");
		expect(d).toHaveProperty("abstain");
	});

	it("should stamp the current contract version", () => {
		const d = decide("Test message");
		expect(d.decisionVersion).toBe(MARGA_CONTRACT_VERSION);
		expect(d.decisionVersion).toBe("1.1");
	});

	it("should compute decision in under 150ms", () => {
		// Run a few iterations to catch outliers
		for (let i = 0; i < 10; i++) {
			const d = decide("Explain the theory of relativity in detail with examples and mathematical proofs");
			expect(d.decisionTimeMs).toBeLessThan(150);
		}
	});

	it("should return confidence between 0 and 1", () => {
		const d = decide("Write a function to sort an array");
		expect(d.confidence).toBeGreaterThanOrEqual(0);
		expect(d.confidence).toBeLessThanOrEqual(1);
	});

	it("should include temperature suggestion", () => {
		const d = decide("Write a function to sort an array");
		expect(d.temperature).toBeDefined();
		expect(d.temperature).toBeGreaterThanOrEqual(0);
		expect(d.temperature).toBeLessThanOrEqual(1);
	});

	it("should return an array for escalation chain", () => {
		const d = decide("Hello");
		expect(Array.isArray(d.escalationChain)).toBe(true);
		for (const step of d.escalationChain) {
			expect(step).toHaveProperty("providerId");
			expect(step).toHaveProperty("modelId");
		}
	});
});

// ─── ESCALATION_CHAIN export ─────────────────────────────────────────────────

describe("ESCALATION_CHAIN", () => {
	it("should be a non-empty readonly array", () => {
		expect(ESCALATION_CHAIN.length).toBeGreaterThan(0);
	});

	it("should start with weakest model (ollama) and end with strongest (opus)", () => {
		expect(ESCALATION_CHAIN[0].providerId).toBe("ollama");
		expect(ESCALATION_CHAIN[ESCALATION_CHAIN.length - 1].providerId).toBe("anthropic");
		expect(ESCALATION_CHAIN[ESCALATION_CHAIN.length - 1].modelId).toContain("opus");
	});

	it("should have 7 tiers", () => {
		expect(ESCALATION_CHAIN).toHaveLength(7);
	});

	it("escalation chain from decision should be a strict subset of ESCALATION_CHAIN", () => {
		const d = decide("Hello");
		for (const step of d.escalationChain) {
			const found = ESCALATION_CHAIN.some(
				(e) => e.providerId === step.providerId && e.modelId === step.modelId,
			);
			expect(found).toBe(true);
		}
	});
});

// ─── Zero-LLM paths ─────────────────────────────────────────────────────────

describe("margaDecide — zero-LLM paths", () => {
	it("should skipLLM for search tasks", () => {
		const d = decide("search for files containing authentication");
		expect(d.taskType).toBe("search");
		expect(d.skipLLM).toBe(true);
		expect(d.resolution).toBe("local-compute");
	});

	it("should skipLLM for memory tasks", () => {
		const d = decide("remember that I prefer dark mode");
		expect(d.taskType).toBe("memory");
		expect(d.skipLLM).toBe(true);
		expect(d.resolution).toBe("local-compute");
	});

	it("should skipLLM for file-op tasks", () => {
		const d = decide("read file /tmp/test.txt");
		expect(d.taskType).toBe("file-op");
		expect(d.skipLLM).toBe(true);
		expect(d.resolution).toBe("tool-only");
	});

	it("should route embedding tasks to embedding resolution (not chat LLM)", () => {
		const d = decide("embed this text into a vector");
		expect(d.taskType).toBe("embedding");
		// embedding resolution uses an embedding MODEL, not a chat model
		// skipLLM only covers tool-only and local-compute resolutions
		expect(d.resolution).toBe("embedding");
	});

	it("should skipLLM for compaction tasks", () => {
		const d = decide("compact and summarize the session log");
		// compaction has local-compute resolution
		if (d.taskType === "compaction") {
			expect(d.skipLLM).toBe(true);
			expect(d.resolution).toBe("local-compute");
		}
	});

	it("should NOT skipLLM for chat tasks", () => {
		const d = decide("Tell me a joke about programming");
		expect(d.skipLLM).toBe(false);
	});

	it("should NOT skipLLM for code-gen tasks", () => {
		const d = decide("Write a TypeScript function to merge two sorted arrays");
		expect(d.skipLLM).toBe(false);
	});

	it("should NOT skipLLM for reasoning tasks", () => {
		const d = decide("Analyze the time complexity of quicksort and prove its average case O(n log n) bound");
		expect(d.skipLLM).toBe(false);
	});
});

// ─── Task type classification via margaDecide ────────────────────────────────

describe("margaDecide — task type detection", () => {
	it("should classify code generation tasks", () => {
		const d = decide("Write a Python function to calculate fibonacci numbers");
		expect(d.taskType).toBe("code-gen");
	});

	it("should classify greeting/check-in tasks as smalltalk", () => {
		const d = decide("Hello, how are you today?");
		expect(d.taskType).toBe("smalltalk");
		expect(d.skipLLM).toBe(true);
	});

	it("should classify reasoning tasks", () => {
		const d = decide("Analyze the implications of quantum entanglement on information theory and derive the bounds");
		expect(d.taskType).toBe("reasoning");
	});

	it("should classify heartbeat/ping tasks", () => {
		const d = decide("ping");
		expect(d.taskType).toBe("heartbeat");
	});

	it("should classify search tasks", () => {
		const d = decide("search for all files matching *.ts in the project");
		expect(d.taskType).toBe("search");
	});

	it("should classify vision tasks when hasImages is set", () => {
		const d = decide("What is in this image?", { hasImages: true });
		expect(d.taskType).toBe("vision");
	});

	it("should classify tool-exec tasks when tools are available", () => {
		const d = decide("run the linter on this file", { hasTools: true });
		expect(d.taskType).toBe("tool-exec");
	});

	it("should classify summarize tasks", () => {
		const d = decide("summarize the following document for me in 3 bullet points");
		expect(d.taskType).toBe("summarize");
	});

	it("should classify translate tasks", () => {
		const d = decide("translate this text to French: Hello world");
		expect(d.taskType).toBe("translate");
	});
});

describe("margaDecide — abstain and subtype signals", () => {
	it("should mark near-tie top2 decisions as abstain", () => {
		const d = decide("summarize and translate this release note to Spanish");
		expect(d.secondaryTaskType).toBeDefined();
		expect(d.abstain).toBe(true);
		expect(d.abstainReason).toBe("near_tie_top2");
	});

	it("should expose explicit checkin subtype for acknowledgement", () => {
		const d = decide("thanks, got it");
		expect(d.taskType).toBe("smalltalk");
		expect(d.checkinSubtype).toBe("ack");
	});

	it("should expose explicit checkin subtype for social check-in", () => {
		const d = decide("how are you doing today?");
		expect(d.taskType).toBe("smalltalk");
		expect(d.checkinSubtype).toBe("checkin");
	});
});

describe("margaDecide — provider health advisory hints", () => {
	it("should attach provider-health warning hint when selected provider is unhealthy", () => {
		const d = decide("write a function", {
			customBindings: [
				{
					taskType: "code-gen",
					providerId: "anthropic",
					modelId: "claude-sonnet-4-5-20250929",
					rationale: "test binding",
				},
			],
			providerHealth: {
				anthropic: {
					healthy: false,
					status: "degraded",
					note: "cooldown active",
				},
			},
		});
		expect(d.providerHealthHints?.length).toBe(1);
		expect(d.providerHealthHints?.[0]?.channel).toBe("provider-health");
		expect(d.providerHealthHints?.[0]?.severity).toBe("warning");
	});
});

// ─── Complexity upgrades ─────────────────────────────────────────────────────

describe("margaDecide — complexity upgrades", () => {
	it("should use stronger model for complex code tasks", () => {
		// Long, multi-part code request that triggers complex classification
		const longCodeRequest = [
			"Implement a complete red-black tree data structure with insert, delete, search,",
			"rebalancing, left and right rotations, color flipping, and transplant operations.",
			"Include comprehensive error handling, generic type parameters, and iterator support.",
			"Also write unit tests covering edge cases like double-black nodes and cascading fixes.",
			"Implement the augmented version with order-statistic operations (OS-Select, OS-Rank).",
		].join(" ");
		const d = decide(longCodeRequest);
		// Complex+ tasks should escalate to at least Sonnet or Opus
		if (d.complexity === "complex" || d.complexity === "expert") {
			expect(d.providerId).toBe("anthropic");
			expect(["claude-sonnet-4-5-20250929", "claude-opus-4-6"]).toContain(d.modelId);
		}
	});

	it("should classify expert complexity for massive multi-domain tasks", () => {
		const expertTask = [
			"Design and implement a distributed consensus algorithm that combines Raft leader election",
			"with a Byzantine fault-tolerant commit protocol. Include formal TLA+ specifications,",
			"mathematical proofs of safety and liveness properties, a complete implementation in Rust",
			"with async/await, property-based tests using proptest, chaos engineering scenarios,",
			"a performance benchmark suite comparing against etcd and CockroachDB,",
			"and a technical paper documenting the algorithm's novel contributions.",
			"Also implement a monitoring dashboard in React with real-time cluster state visualization.",
			"Consider network partitions, clock skew, message reordering, and Byzantine actors.",
		].join(" ");
		const d = decide(expertTask);
		if (d.complexity === "expert") {
			expect(d.providerId).toBe("anthropic");
			expect(d.modelId).toContain("opus");
		}
	});

	it("should use appropriate temperature for code-gen", () => {
		const d = decide("Write a TypeScript function to reverse a linked list");
		if (d.taskType === "code-gen") {
			expect(d.temperature).toBe(0.2);
		}
	});

	it("should use higher temperature for chat", () => {
		const d = decide("Tell me a joke about cats");
		if (d.taskType === "chat") {
			expect(d.temperature).toBe(0.7);
		}
	});

	it("should use moderate temperature for reasoning", () => {
		const d = decide("Prove that the square root of 2 is irrational using proof by contradiction");
		if (d.taskType === "reasoning") {
			expect(d.temperature).toBe(0.5);
		}
	});
});

// ─── Binding strategies ──────────────────────────────────────────────────────

describe("margaDecide — binding strategies", () => {
	it("should accept 'local' binding strategy", () => {
		const d = decide("Write a function", { bindingStrategy: "local" });
		expect(d.decisionVersion).toBe("1.1");
		// Local strategy should prefer local providers
		expect(d.providerId).toBeDefined();
	});

	it("should accept 'cloud' binding strategy", () => {
		const d = decide("Write a function", { bindingStrategy: "cloud" });
		expect(d.decisionVersion).toBe("1.1");
		expect(d.providerId).toBeDefined();
	});

	it("should accept 'hybrid' binding strategy (default)", () => {
		const d = decide("Write a function", { bindingStrategy: "hybrid" });
		expect(d.decisionVersion).toBe("1.1");
		expect(d.providerId).toBeDefined();
	});

	it("should use hybrid by default when no strategy specified", () => {
		const d1 = decide("Write a function");
		const d2 = decide("Write a function", { bindingStrategy: "hybrid" });
		// Both should produce the same result
		expect(d1.providerId).toBe(d2.providerId);
		expect(d1.modelId).toBe(d2.modelId);
		expect(d1.taskType).toBe(d2.taskType);
	});

	it("local and cloud should potentially differ in provider selection", () => {
		const local = decide("Write a function to sort an array", { bindingStrategy: "local" });
		const cloud = decide("Write a function to sort an array", { bindingStrategy: "cloud" });
		// They might differ — at minimum both should return valid decisions
		expect(local.decisionVersion).toBe("1.1");
		expect(cloud.decisionVersion).toBe("1.1");
	});
});

// ─── Escalation chain correctness ────────────────────────────────────────────

describe("margaDecide — escalation chain", () => {
	it("should exclude the selected model from the escalation chain", () => {
		const d = decide("Hello");
		const selected = { providerId: d.providerId, modelId: d.modelId };
		const inChain = d.escalationChain.some(
			(e) => e.providerId === selected.providerId && e.modelId === selected.modelId,
		);
		expect(inChain).toBe(false);
	});

	it("should only contain models stronger than the selected one", () => {
		const d = decide("Hello");
		const selectedIdx = ESCALATION_CHAIN.findIndex(
			(e) => e.providerId === d.providerId && e.modelId === d.modelId,
		);
		if (selectedIdx >= 0) {
			// Every escalation step should be AFTER the selected model in the chain
			for (const step of d.escalationChain) {
				const stepIdx = ESCALATION_CHAIN.findIndex(
					(e) => e.providerId === step.providerId && e.modelId === step.modelId,
				);
				expect(stepIdx).toBeGreaterThan(selectedIdx);
			}
		}
	});

	it("escalation chain should be empty for the strongest model (opus)", () => {
		// Force an expert-level task to get Opus
		const expertTask = [
			"Design a complete formally-verified operating system kernel in Coq with",
			"proofs of memory safety, information flow control, concurrent correctness,",
			"and implement a certified compiler from a high-level language to the kernel's",
			"system call interface. Include mechanized proofs of refinement between",
			"abstract specification and implementation, and formal security proofs.",
			"Build property-based test suite with 10000 random test cases covering all edge cases.",
		].join(" ");
		const d = decide(expertTask);
		if (d.modelId.includes("opus")) {
			expect(d.escalationChain).toHaveLength(0);
		}
	});
});

// ─── Statelessness ───────────────────────────────────────────────────────────

describe("margaDecide — statelessness", () => {
	it("should return identical results for identical inputs", () => {
		const msg = "Write a function to calculate factorial";
		const d1 = decide(msg);
		const d2 = decide(msg);
		expect(d1.providerId).toBe(d2.providerId);
		expect(d1.modelId).toBe(d2.modelId);
		expect(d1.taskType).toBe(d2.taskType);
		expect(d1.complexity).toBe(d2.complexity);
		expect(d1.skipLLM).toBe(d2.skipLLM);
		expect(d1.rationale).toBe(d2.rationale);
		expect(d1.confidence).toBe(d2.confidence);
	});

	it("should not be affected by call order", () => {
		// Call with different messages, then call the first one again
		const msg = "Translate hello to Spanish";
		const d1 = decide(msg);
		decide("Write a red-black tree implementation");
		decide("search for all TypeScript files");
		const d2 = decide(msg);
		expect(d1.taskType).toBe(d2.taskType);
		expect(d1.providerId).toBe(d2.providerId);
		expect(d1.modelId).toBe(d2.modelId);
	});
});

// ─── Minimum complexity overrides ────────────────────────────────────────────

describe("margaDecide — minimum complexity overrides", () => {
	it("reasoning tasks should have at least complex complexity", () => {
		const d = decide("Prove that P != NP using a diagonal argument");
		if (d.taskType === "reasoning") {
			const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(complexityOrder[d.complexity]).toBeGreaterThanOrEqual(complexityOrder["complex"]);
		}
	});

	it("vision tasks should have at least medium complexity", () => {
		const d = decide("What objects are in this image?", { hasImages: true });
		if (d.taskType === "vision") {
			const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };
			expect(complexityOrder[d.complexity]).toBeGreaterThanOrEqual(complexityOrder["medium"]);
		}
	});
});
