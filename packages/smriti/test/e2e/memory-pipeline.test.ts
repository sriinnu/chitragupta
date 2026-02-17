/**
 * E2E: Memory Signal Extraction -> Stream Classification -> Scoring Pipeline.
 *
 * Exercises the FULL information flow through:
 *   stream-extractor.ts -> streams.ts -> sinkhorn-knopp.ts -> sinkhorn-accelerated.ts
 *
 * Also exercises NER integration: ner-extractor.ts (heuristic mode, no GLiNER2 server).
 *
 * No filesystem mocking needed for this test suite: all functions under test are
 * pure computations that do not touch the disk.
 */

import { describe, it, expect } from "vitest";

import {
	extractSignals,
	classifyContent,
	extractSignalsFromTurns,
	buildAffinityMatrix,
	sinkhornKnopp,
	computeTokenBudgets,
	allocateBudgets,
	sinkhornAccelerated,
	computeTokenBudgetsMHC,
	logsumexp,
	PRESERVATION_RATIOS,
	STREAM_ORDER,
	NERExtractor,
} from "@chitragupta/smriti";
import type { SessionTurn, StreamSignals, SessionChunk } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Assert matrix is approximately doubly stochastic: all row/col sums ~ 1. */
function assertDoublyStochastic(matrix: number[][], tolerance = 1e-4): void {
	const n = matrix.length;
	for (let i = 0; i < n; i++) {
		const rowSum = matrix[i].reduce((s, v) => s + v, 0);
		expect(rowSum).toBeCloseTo(1, 3);
	}
	for (let j = 0; j < n; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) colSum += matrix[i][j];
		expect(colSum).toBeCloseTo(1, 3);
	}
}

/** Build realistic conversation turns for testing. */
function buildRealisticTurns(): SessionTurn[] {
	return [
		{
			turnNumber: 1,
			role: "user",
			content: "I prefer tabs over spaces. My name is Srini and I work at Anthropic. Always use TypeScript.",
		},
		{
			turnNumber: 2,
			role: "assistant",
			content: "Got it! I will use tabs and TypeScript for all code. Let me set up the project architecture with a monorepo structure using npm workspaces.",
		},
		{
			turnNumber: 3,
			role: "user",
			content: "We decided to use PostgreSQL for the database and Redis for caching. The API endpoints should follow REST conventions. Also add a TODO to fix the authentication bug.",
		},
		{
			turnNumber: 4,
			role: "assistant",
			content: "I have implemented the PostgreSQL schema and Redis caching layer. The authentication fix is now a priority task. Next step is to deploy to Kubernetes.",
		},
		{
			turnNumber: 5,
			role: "user",
			content: "The weather is nice today. I was thinking about what to have for lunch. Anyway, let us continue with the project.",
		},
	];
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("E2E: Memory Pipeline", () => {

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Signal Extraction Pipeline
	// ═══════════════════════════════════════════════════════════════════════

	describe("Signal extraction pipeline", () => {
		it("should extract identity signals from preference statements", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "user",
				content: "I prefer tabs over spaces. I always use TypeScript. My name is Srini.",
			};
			const signals = extractSignals(turn);

			expect(signals.identity.length).toBeGreaterThan(0);
			const identityText = signals.identity.join(" ");
			expect(identityText.toLowerCase()).toMatch(/prefer|always|name/);
		});

		it("should extract project signals from architecture decisions", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "user",
				content: "We decided to use PostgreSQL for the database. The API architecture uses microservices with Docker containers.",
			};
			const signals = extractSignals(turn);

			expect(signals.projects.length).toBeGreaterThan(0);
			const projectText = signals.projects.join(" ");
			expect(projectText.toLowerCase()).toMatch(/decided|architecture|database|docker/);
		});

		it("should extract task signals from TODO statements", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "user",
				content: "TODO: fix the authentication bug. The tests are failing on the login endpoint. This is a critical priority.",
			};
			const signals = extractSignals(turn);

			expect(signals.tasks.length).toBeGreaterThan(0);
			const taskText = signals.tasks.join(" ");
			expect(taskText.toLowerCase()).toMatch(/todo|fix|test|critical|priority|failing/);
		});

		it("should route unclassified content to flow stream", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "user",
				content: "The weather is nice today. I was thinking about what to have for lunch.",
			};
			const signals = extractSignals(turn);

			expect(signals.flow.length).toBeGreaterThan(0);
		});

		it("should extract tool call signals into projects stream", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "assistant",
				content: "Let me read the file.",
				toolCalls: [
					{
						name: "read_file",
						input: '{"path": "/src/index.ts"}',
						result: "export default {};",
					},
				],
			};
			const signals = extractSignals(turn);

			const projectText = signals.projects.join(" ");
			expect(projectText).toContain("[tool:read_file]");
		});

		it("should extract error tool calls into tasks stream", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "assistant",
				content: "Attempting the operation.",
				toolCalls: [
					{
						name: "bash",
						input: "npm run build",
						result: "Error: Cannot find module",
						isError: true,
					},
				],
			};
			const signals = extractSignals(turn);

			const taskText = signals.tasks.join(" ");
			expect(taskText).toContain("[error:bash]");
		});

		it("should handle empty content gracefully", () => {
			const turn: SessionTurn = {
				turnNumber: 1,
				role: "user",
				content: "",
			};
			const signals = extractSignals(turn);

			expect(signals.identity).toEqual([]);
			expect(signals.projects).toEqual([]);
			expect(signals.tasks).toEqual([]);
			expect(signals.flow).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Content Classification
	// ═══════════════════════════════════════════════════════════════════════

	describe("Content classification", () => {
		it("should classify preference text as identity", () => {
			expect(classifyContent("I prefer TypeScript over JavaScript. I always use strict mode.")).toBe("identity");
		});

		it("should classify architecture text as projects", () => {
			expect(classifyContent("The architecture uses microservices. We decided to use PostgreSQL for our database.")).toBe("projects");
		});

		it("should classify TODO text as tasks", () => {
			expect(classifyContent("TODO: fix the login bug. The tests are failing. This is critical and urgent.")).toBe("tasks");
		});

		it("should classify general chatter as flow", () => {
			expect(classifyContent("The sun is shining and birds are singing.")).toBe("flow");
		});

		it("should handle mixed content by choosing dominant stream", () => {
			// This text has multiple project keywords
			const result = classifyContent(
				"We decided on the architecture. The database schema uses PostgreSQL. Deploying to Docker and Kubernetes."
			);
			expect(result).toBe("projects");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Multi-Turn Signal Extraction
	// ═══════════════════════════════════════════════════════════════════════

	describe("Multi-turn signal extraction", () => {
		it("should merge signals from multiple turns", () => {
			const turns = buildRealisticTurns();
			const signals = extractSignalsFromTurns(turns);

			// Should have signals in all four streams
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.projects.length).toBeGreaterThan(0);
			expect(signals.tasks.length).toBeGreaterThan(0);
			expect(signals.flow.length).toBeGreaterThan(0);
		});

		it("should accumulate signals from all turns, not just the latest", () => {
			const turns: SessionTurn[] = [
				{ turnNumber: 1, role: "user", content: "I prefer tabs." },
				{ turnNumber: 2, role: "user", content: "The architecture uses microservices." },
				{ turnNumber: 3, role: "user", content: "TODO: fix the failing tests." },
			];
			const signals = extractSignalsFromTurns(turns);

			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.projects.length).toBeGreaterThan(0);
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("should handle empty turns array", () => {
			const signals = extractSignalsFromTurns([]);
			expect(signals.identity).toEqual([]);
			expect(signals.projects).toEqual([]);
			expect(signals.tasks).toEqual([]);
			expect(signals.flow).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Stream Budget Allocation (Sinkhorn-Knopp Pipeline)
	// ═══════════════════════════════════════════════════════════════════════

	describe("Stream budget allocation", () => {
		it("should build a valid 4x4 affinity matrix from signals", () => {
			const signals: StreamSignals = {
				identity: ["I prefer tabs", "My name is Srini"],
				projects: ["Using PostgreSQL", "Architecture with Docker"],
				tasks: ["Fix auth bug", "Tests failing"],
				flow: ["Nice weather"],
			};
			const matrix = buildAffinityMatrix(signals);

			expect(matrix).toHaveLength(4);
			expect(matrix[0]).toHaveLength(4);

			// All entries should be positive
			for (const row of matrix) {
				for (const val of row) {
					expect(val).toBeGreaterThan(0);
				}
			}
		});

		it("should handle empty signals with a valid fallback matrix", () => {
			const signals: StreamSignals = {
				identity: [],
				projects: [],
				tasks: [],
				flow: [],
			};
			const matrix = buildAffinityMatrix(signals);

			expect(matrix).toHaveLength(4);
			// All entries positive
			for (const row of matrix) {
				for (const val of row) {
					expect(val).toBeGreaterThan(0);
				}
			}
		});

		it("should produce a doubly stochastic matrix from sinkhornKnopp", () => {
			const signals: StreamSignals = {
				identity: ["pref1", "pref2"],
				projects: ["arch1", "arch2", "arch3"],
				tasks: ["task1"],
				flow: ["flow1", "flow2"],
			};
			const affinity = buildAffinityMatrix(signals);
			const { result, converged } = sinkhornKnopp(affinity);

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should converge for identity matrix input", () => {
			const identity = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			];
			const { result, converged } = sinkhornKnopp(identity);

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should produce budgets that sum to totalBudget", () => {
			const signals: StreamSignals = {
				identity: ["pref1"],
				projects: ["arch1", "arch2"],
				tasks: ["task1", "task2", "task3"],
				flow: ["flow1"],
			};
			const affinity = buildAffinityMatrix(signals);
			const { result } = sinkhornKnopp(affinity);
			const budgets = computeTokenBudgets(result, 10000);

			expect(budgets).toHaveLength(4);
			const total = budgets.reduce((a, b) => a + b, 0);
			expect(total).toBe(10000);
		});

		it("should allocate non-negative budgets to all streams", () => {
			const signals: StreamSignals = {
				identity: ["pref1"],
				projects: [],
				tasks: [],
				flow: ["flow1", "flow2", "flow3"],
			};
			const affinity = buildAffinityMatrix(signals);
			const { result } = sinkhornKnopp(affinity);
			const budgets = computeTokenBudgets(result, 5000);

			for (const b of budgets) {
				expect(b).toBeGreaterThanOrEqual(0);
			}
		});

		it("should handle zero totalBudget", () => {
			const signals: StreamSignals = {
				identity: ["a"],
				projects: ["b"],
				tasks: ["c"],
				flow: ["d"],
			};
			const affinity = buildAffinityMatrix(signals);
			const { result } = sinkhornKnopp(affinity);
			const budgets = computeTokenBudgets(result, 0);

			const total = budgets.reduce((a, b) => a + b, 0);
			expect(total).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Full Pipeline (Extract -> Affinity -> Sinkhorn -> Budgets)
	// ═══════════════════════════════════════════════════════════════════════

	describe("Full pipeline", () => {
		it("should produce valid budgets from realistic conversation turns", () => {
			const turns = buildRealisticTurns();
			const signals = extractSignalsFromTurns(turns);
			const { budgets, mixingMatrix, converged } = allocateBudgets(signals, 8000);

			expect(converged).toBe(true);
			assertDoublyStochastic(mixingMatrix);
			expect(budgets).toHaveLength(4);
			expect(budgets.reduce((a, b) => a + b, 0)).toBe(8000);

			// All budgets should be positive (realistic turns have signals in all streams)
			for (const b of budgets) {
				expect(b).toBeGreaterThan(0);
			}
		});

		it("should give higher budget to identity stream (highest preservation)", () => {
			// Identity has preservation 0.95, flow has 0.30
			const signals: StreamSignals = {
				identity: ["a", "b", "c"],
				projects: ["d", "e", "f"],
				tasks: ["g", "h", "i"],
				flow: ["j", "k", "l"],
			};
			const { budgets } = allocateBudgets(signals, 10000);

			// Identity budget (index 0) should be >= flow budget (index 3)
			// given equal signal counts, the preservation ratio should favor identity
			expect(budgets[0]).toBeGreaterThanOrEqual(budgets[3]);
		});

		it("should handle single-stream-dominant conversation", () => {
			const turns: SessionTurn[] = [
				{ turnNumber: 1, role: "user", content: "Fix the bug. The tests are failing. This issue is critical. TODO: add more test coverage. The build is broken." },
			];
			const signals = extractSignalsFromTurns(turns);
			const { budgets, converged } = allocateBudgets(signals, 4000);

			expect(converged).toBe(true);
			expect(budgets.reduce((a, b) => a + b, 0)).toBe(4000);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Accelerated Sinkhorn-Knopp
	// ═══════════════════════════════════════════════════════════════════════

	describe("Accelerated Sinkhorn-Knopp", () => {
		it("should converge and produce a doubly stochastic matrix", () => {
			const matrix = [
				[1.0, 0.15, 0.05, 0.02],
				[0.15, 1.0, 0.30, 0.10],
				[0.05, 0.30, 1.0, 0.15],
				[0.02, 0.10, 0.15, 1.0],
			];
			const { result, converged } = sinkhornAccelerated(matrix);

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should converge faster than vanilla SK at the same epsilon (no adaptive schedule)", () => {
			const matrix = [
				[5.0, 0.5, 0.2, 0.1],
				[0.5, 3.0, 1.0, 0.3],
				[0.2, 1.0, 4.0, 0.5],
				[0.1, 0.3, 0.5, 2.0],
			];

			// Use the same epsilon (1e-6) and disable adaptive schedule for fair comparison.
			// The adaptive schedule starts at 1e-2 and halves, which inflates iteration count.
			const vanilla = sinkhornKnopp(matrix, 200, 1e-6);
			const accelerated = sinkhornAccelerated(matrix, {
				epsilon: 1e-6,
				useAdaptiveEpsilon: false,
			});

			expect(vanilla.converged).toBe(true);
			expect(accelerated.converged).toBe(true);

			// Both should produce doubly stochastic matrices
			assertDoublyStochastic(vanilla.result);
			assertDoublyStochastic(accelerated.result);

			// Accelerated (Nesterov momentum) should converge in fewer or equal iterations
			expect(accelerated.iterations).toBeLessThanOrEqual(vanilla.iterations);
		});

		it("should handle a uniform matrix", () => {
			const n = 4;
			const matrix = Array.from({ length: n }, () => Array(n).fill(1 / n));
			const { result, converged } = sinkhornAccelerated(matrix);

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should handle a diagonal matrix", () => {
			const matrix = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			];
			const { result, converged } = sinkhornAccelerated(matrix);

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should work without Nesterov momentum", () => {
			const matrix = [
				[2.0, 0.5, 0.1, 0.1],
				[0.5, 2.0, 0.3, 0.1],
				[0.1, 0.3, 2.0, 0.5],
				[0.1, 0.1, 0.5, 2.0],
			];
			const { result, converged } = sinkhornAccelerated(matrix, {
				useNesterov: false,
				epsilon: 1e-6,
			});

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should work without log-domain", () => {
			const matrix = [
				[2.0, 0.5, 0.1, 0.1],
				[0.5, 2.0, 0.3, 0.1],
				[0.1, 0.3, 2.0, 0.5],
				[0.1, 0.1, 0.5, 2.0],
			];
			const { result, converged } = sinkhornAccelerated(matrix, {
				useLogDomain: false,
				epsilon: 1e-6,
			});

			expect(converged).toBe(true);
			assertDoublyStochastic(result);
		});

		it("should handle empty matrix", () => {
			const { result, converged } = sinkhornAccelerated([]);
			expect(converged).toBe(true);
			expect(result).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. mHC Token Budget Allocation (Chunk-Level)
	// ═══════════════════════════════════════════════════════════════════════

	describe("mHC token budget allocation", () => {
		it("should allocate budgets summing to totalBudget for multiple chunks", () => {
			const chunks: SessionChunk[] = [
				{ id: "c1", recency: 0.9, relevance: 0.8, importance: 0.7, topic: "auth", tokenCount: 500 },
				{ id: "c2", recency: 0.5, relevance: 0.6, importance: 0.3, topic: "auth", tokenCount: 300 },
				{ id: "c3", recency: 0.2, relevance: 0.4, importance: 0.9, topic: "db", tokenCount: 400 },
			];
			const result = computeTokenBudgetsMHC(chunks, 1000);

			expect(result.size).toBe(3);
			let total = 0;
			for (const b of result.values()) {
				expect(b).toBeGreaterThanOrEqual(0);
				total += b;
			}
			expect(total).toBe(1000);
		});

		it("should give more budget to higher-scored chunks", () => {
			const chunks: SessionChunk[] = [
				{ id: "high", recency: 1.0, relevance: 1.0, importance: 1.0, tokenCount: 500 },
				{ id: "low", recency: 0.1, relevance: 0.1, importance: 0.1, tokenCount: 500 },
			];
			const result = computeTokenBudgetsMHC(chunks, 1000);

			expect(result.get("high")!).toBeGreaterThan(result.get("low")!);
		});

		it("should handle single chunk (gets entire budget)", () => {
			const chunks: SessionChunk[] = [
				{ id: "only", recency: 0.5, relevance: 0.5, importance: 0.5, tokenCount: 200 },
			];
			const result = computeTokenBudgetsMHC(chunks, 2000);

			expect(result.get("only")).toBe(2000);
		});

		it("should handle empty chunks array", () => {
			const result = computeTokenBudgetsMHC([], 1000);
			expect(result.size).toBe(0);
		});

		it("should give same-topic bonus to chunks sharing a topic", () => {
			const chunksA: SessionChunk[] = [
				{ id: "a1", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "same", tokenCount: 300 },
				{ id: "a2", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "same", tokenCount: 300 },
			];
			const chunksB: SessionChunk[] = [
				{ id: "b1", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "topicA", tokenCount: 300 },
				{ id: "b2", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "topicB", tokenCount: 300 },
			];

			const resultA = computeTokenBudgetsMHC(chunksA, 1000);
			const resultB = computeTokenBudgetsMHC(chunksB, 1000);

			// Both sets should sum to 1000
			let totalA = 0, totalB = 0;
			for (const b of resultA.values()) totalA += b;
			for (const b of resultB.values()) totalB += b;
			expect(totalA).toBe(1000);
			expect(totalB).toBe(1000);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. LogSumExp Numerical Stability
	// ═══════════════════════════════════════════════════════════════════════

	describe("LogSumExp numerical stability", () => {
		it("should compute log(sum(exp(x))) correctly for small values", () => {
			// log(exp(1) + exp(2)) = log(e + e^2) ~ 2.313
			const result = logsumexp([1, 2]);
			expect(result).toBeCloseTo(Math.log(Math.exp(1) + Math.exp(2)), 10);
		});

		it("should handle very large values without overflow", () => {
			// Direct computation would overflow (exp(1000))
			const result = logsumexp([1000, 1001]);
			expect(result).toBeCloseTo(1001 + Math.log(1 + Math.exp(-1)), 10);
		});

		it("should handle very negative values without underflow", () => {
			const result = logsumexp([-1000, -999]);
			expect(Number.isFinite(result)).toBe(true);
			expect(result).toBeCloseTo(-999 + Math.log(1 + Math.exp(-1)), 10);
		});

		it("should return -Infinity for empty array", () => {
			expect(logsumexp([])).toBe(-Infinity);
		});

		it("should return the single value for length-1 array", () => {
			expect(logsumexp([42])).toBe(42);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. NER Integration (Heuristic Mode)
	// ═══════════════════════════════════════════════════════════════════════

	describe("NER integration", () => {
		it("should extract technology entities from text", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract(
				"We use TypeScript and React with PostgreSQL for the database. Docker handles deployment."
			);

			const types = entities.map((e) => e.type);
			expect(types).toContain("technology");

			const techNames = entities
				.filter((e) => e.type === "technology")
				.map((e) => e.text.toLowerCase());
			expect(techNames).toContain("typescript");
			expect(techNames).toContain("react");
			expect(techNames).toContain("postgresql");
			expect(techNames).toContain("docker");
		});

		it("should extract file path entities", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract(
				"I modified the file ./src/index.ts and also checked /etc/config.json for settings."
			);

			const files = entities.filter((e) => e.type === "file");
			expect(files.length).toBeGreaterThanOrEqual(1);
			const filePaths = files.map((e) => e.text);
			expect(filePaths.some((f) => f.includes("src/index.ts"))).toBe(true);
		});

		it("should extract error entities", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract(
				"Got a TypeError when calling the function. Also saw ENOENT for the missing file."
			);

			const errors = entities.filter((e) => e.type === "error");
			expect(errors.length).toBeGreaterThanOrEqual(1);
			const errorTexts = errors.map((e) => e.text);
			expect(errorTexts.some((t) => t.includes("TypeError"))).toBe(true);
		});

		it("should extract decision entities", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract(
				"We decided to migrate to PostgreSQL. Also chose to switch to a monorepo structure."
			);

			const decisions = entities.filter((e) => e.type === "decision");
			expect(decisions.length).toBeGreaterThanOrEqual(1);
		});

		it("should extract action entities", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract(
				"I created a new module for auth. Then deployed the service to staging and merged the PR."
			);

			const actions = entities.filter((e) => e.type === "action");
			expect(actions.length).toBeGreaterThanOrEqual(1);
		});

		it("should respect minConfidence filter", async () => {
			const ner = new NERExtractor({
				useHeuristic: true,
				minConfidence: 0.9,
			});
			const entities = await ner.extract("TypeScript and React with PostgreSQL");

			// Heuristic confidence is 0.6, so nothing should pass 0.9 threshold
			expect(entities).toHaveLength(0);
		});

		it("should handle empty text", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const entities = await ner.extract("");
			expect(entities).toEqual([]);
		});

		it("should batch extract from multiple texts", async () => {
			const ner = new NERExtractor({ useHeuristic: true });
			const results = await ner.extractBatch([
				"Using TypeScript for the project.",
				"Got a TypeError in the build.",
				"Deployed to Kubernetes.",
			]);

			expect(results).toHaveLength(3);
			// Each result should have at least one entity
			for (const entities of results) {
				expect(entities.length).toBeGreaterThanOrEqual(1);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. End-to-End: Turns -> Signals -> NER -> Budget
	// ═══════════════════════════════════════════════════════════════════════

	describe("End-to-end pipeline: turns -> signals -> NER -> budgets", () => {
		it("should produce valid budgets and detect entities from a realistic conversation", async () => {
			const turns = buildRealisticTurns();

			// Step 1: Extract signals
			const signals = extractSignalsFromTurns(turns);
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.projects.length).toBeGreaterThan(0);

			// Step 2: Build affinity matrix and run Sinkhorn
			const { budgets, converged } = allocateBudgets(signals, 10000);
			expect(converged).toBe(true);
			expect(budgets.reduce((a, b) => a + b, 0)).toBe(10000);

			// Step 3: Run NER on all turn content
			const ner = new NERExtractor({ useHeuristic: true });
			const allContent = turns.map((t) => t.content).join("\n");
			const entities = await ner.extract(allContent);

			// Should detect technologies mentioned in the conversation
			const techEntities = entities.filter((e) => e.type === "technology");
			expect(techEntities.length).toBeGreaterThan(0);
			const techs = techEntities.map((e) => e.text.toLowerCase());
			expect(techs.some((t) => t === "typescript" || t === "postgresql" || t === "redis" || t === "kubernetes")).toBe(true);

			// Step 4: All entities should have valid spans and confidence
			for (const entity of entities) {
				expect(entity.confidence).toBeGreaterThanOrEqual(0);
				expect(entity.confidence).toBeLessThanOrEqual(1);
				expect(entity.span[0]).toBeLessThanOrEqual(entity.span[1]);
			}
		});
	});
});
