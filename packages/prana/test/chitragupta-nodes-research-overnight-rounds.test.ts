import { describe, expect, it, vi } from "vitest";

vi.mock("../src/chitragupta-nodes-research-recording.js", () => ({
	packResearchContext: vi.fn(async () => ({
		runtime: "pakt-core",
		source: "daemon",
		packedText: "packed:failure",
	})),
	recordResearchFailure: vi.fn(async () => {
		throw new Error("record failed");
	}),
	recordResearchOutcome: vi.fn(),
}));

vi.mock("../src/chitragupta-nodes-research-runner.js", () => ({
	recoverResearchFailure: vi.fn(async () => ({
		decision: "discard",
		action: "reverted",
		revertedFiles: ["train.py"],
		reason: "cleanup",
		scopeGuard: "git",
	})),
}));

vi.mock("../src/chitragupta-nodes-research-overnight-control.js", async () => {
	const actual = await vi.importActual<typeof import("../src/chitragupta-nodes-research-overnight-control.js")>(
		"../src/chitragupta-nodes-research-overnight-control.js",
	);
	return {
		...actual,
		refreshCancellationState: vi.fn(async () => false),
	};
});

describe("failed overnight round closure", () => {
	it("preserves recovery and packed metadata when closure degrades after finalize", async () => {
		const { processFailedRoundClosure } = await import("../src/chitragupta-nodes-research-overnight-rounds.js");

		const result = await processFailedRoundClosure({
			scope: {
				hypothesis: "runner exploded",
				topic: "Failed closure metadata",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: "/repo/project",
				cwd: "/repo/project",
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				allowDirtyWorkspace: false,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 3,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-failed-closure",
				roundNumber: null,
				totalRounds: null,
				attemptNumber: null,
			},
			council: {
				sabhaId: "sabha-1",
				sessionId: "sess-1",
				topic: "Failed closure metadata",
				participantCount: 2,
				participants: [],
				finalVerdict: "accepted",
				rounds: 1,
				councilSummary: [],
				lucy: { hitEntity: null, predictionCount: 0, criticalSignalCount: 0, recommendation: "support" },
				route: null,
				plannerRoute: null,
				executionRoute: null,
				source: "daemon",
			},
			interrupt: {
				loopKey: "loop-failed-closure",
				signal: new AbortController().signal,
				getCancelReason: () => null,
				isCancelled: () => false,
			},
			roundScope: {
				hypothesis: "runner exploded",
				topic: "Failed closure metadata",
				command: "uv",
				commandArgs: ["run", "train.py"],
				projectPath: "/repo/project",
				cwd: "/repo/project",
				parentSessionId: null,
				sessionLineageKey: null,
				targetFiles: ["train.py"],
				immutableFiles: ["prepare.py"],
				metricName: "val_bpb",
				metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
				objective: "minimize",
				budgetMs: 60_000,
				totalBudgetMs: 60_000,
				allowDirtyWorkspace: false,
				plannerRouteClass: "coding.deep-reasoning",
				plannerCapability: null,
				executionRouteClass: "tool.use.flex",
				executionCapability: null,
				maxRounds: 3,
				agentCount: 2,
				stopAfterNoImprovementRounds: 2,
				loopKey: "loop-failed-closure",
				roundNumber: 1,
				totalRounds: 3,
				attemptNumber: 1,
			},
			roundNumber: 1,
			roundStartedAt: Date.now(),
			failedRun: {
				command: "uv",
				commandArgs: ["run", "train.py"],
				cwd: "/repo/project",
				metricName: "val_bpb",
				metric: null,
				stdout: "",
				stderr: "runner exploded",
				exitCode: 1,
				timedOut: false,
				durationMs: 25,
				scopeGuard: "git",
				targetFilesChanged: ["train.py"],
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
				executionRouteClass: "tool.use.flex",
			},
			currentBaseline: {
				metricName: "val_bpb",
				objective: "minimize",
				baselineMetric: 0.99,
				hypothesis: "runner exploded",
			},
			counts: { keptRounds: 0, revertedRounds: 0 },
			state: {
				bestMetric: 0.99,
				bestRoundNumber: null,
				noImprovementStreak: 0,
				totalDurationMs: 0,
				loopKey: "loop-failed-closure",
			},
		});

		expect(result.stopReason).toBe("closure-failed");
		expect(result.round).toEqual(
			expect.objectContaining({
				finalizeAction: "reverted",
				packedRuntime: "pakt-core",
				packedSource: "daemon",
				traceId: null,
				experimentId: null,
				selectedModelId: "qwen-coder",
				selectedProviderId: "ollama",
			}),
		);
	});
});
