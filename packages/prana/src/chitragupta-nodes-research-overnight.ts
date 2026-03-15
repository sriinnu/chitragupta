import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import {
	reconcileTerminalResearchLoopInterrupt,
	startResearchLoopInterrupt,
} from "./chitragupta-nodes-research-interrupt.js";
import {
	buildLoopKey,
	type BaselineData,
	type OvernightResearchMutableState,
	type OvernightResearchRound,
	type OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight-types.js";
import { restoreOvernightResearchLoopState } from "./chitragupta-nodes-research-overnight-resume.js";
import { runOvernightResearchRounds } from "./chitragupta-nodes-research-overnight-run.js";
import { finalizeOvernightResearchLoop } from "./chitragupta-nodes-research-overnight-complete.js";

function asRecord(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

/**
 * Normalize restored state into the mutable in-memory shape the round runner
 * expects, while preserving daemon-restored checkpoints and carry-context.
 */
function buildMutableLoopState(
	restored: Awaited<ReturnType<typeof restoreOvernightResearchLoopState>>,
	baseline: BaselineData,
): { state: OvernightResearchMutableState; startRoundNumber: number } {
	const state: OvernightResearchMutableState = {
		currentBaseline: restored.kind === "resume"
			? { ...restored.currentBaseline }
			: { ...baseline },
		progress: restored.kind === "resume"
			? { ...restored.progress }
			: {
				bestMetric: baseline.baselineMetric,
				bestRoundNumber: null,
				noImprovementStreak: 0,
				totalDurationMs: 0,
			},
		roundCounts: restored.kind === "resume"
			? { ...restored.roundCounts }
			: { keptRounds: 0, revertedRounds: 0 },
		carryContext: restored.kind === "resume" ? restored.carryContext : "",
		rounds: restored.kind === "resume" ? [...restored.rounds] : [],
		resumeCheckpoint: restored.kind === "resume" ? restored.checkpoint : null,
		finalSummary: null,
	};
	return {
		state,
		startRoundNumber: restored.kind === "resume" ? restored.nextRoundNumber : 1,
	};
}

/**
 * Execute the canonical overnight research loop.
 *
 * Lifecycle:
 * 1. restore durable daemon/checkpoint state
 * 2. attach or start daemon-owned interrupt control
 * 3. execute bounded rounds
 * 4. finalize into one terminal summary
 *
 * `stopReason` becomes authoritative only after final daemon completion
 * succeeds. Until then, checkpoint state is the durable source of truth for a
 * resume or completion-pending recovery.
 */
export async function executeOvernightResearchLoop(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	baseline: BaselineData,
): Promise<OvernightResearchSummary> {
	const loopKey = scope.loopKey ?? buildLoopKey(scope, asRecord(council));
	const restored = await restoreOvernightResearchLoopState(
		scope,
		council,
		baseline,
		loopKey,
		scope.interruptSignal,
	);
	if (restored.kind === "terminal") {
		await reconcileTerminalResearchLoopInterrupt({
			loopKey,
			projectPath: scope.projectPath,
			leaseOwner: scope.leaseOwner,
			stopReason: restored.summary.stopReason,
		});
		return restored.summary;
	}
	const interrupt = await startResearchLoopInterrupt(
		scope,
		council,
		loopKey,
		restored.kind === "resume"
			? "resume"
			: restored.kind === "complete-pending"
				? "attach"
				: "start",
	);
	if (restored.kind === "complete-pending") {
		// This fast path re-attaches to a loop that already finished its round work
		// and only needs the canonical completion flow rerun to persist/report the
		// terminal summary cleanly.
		return finalizeOvernightResearchLoop({
			scope,
			council,
			interrupt,
			loopKey,
			rounds: restored.summary.rounds,
			progress: {
				bestMetric: restored.summary.bestMetric,
				bestRoundNumber: restored.summary.bestRoundNumber,
				noImprovementStreak: restored.summary.noImprovementStreak,
				totalDurationMs: restored.summary.totalDurationMs,
			},
			roundCounts: {
				keptRounds: restored.summary.keptRounds,
				revertedRounds: restored.summary.revertedRounds,
			},
			finalSummary: restored.summary,
		});
	}
	const { state, startRoundNumber } = buildMutableLoopState(restored, baseline);
	const executed = await runOvernightResearchRounds({
		scope,
		council,
		loopKey,
		interrupt,
		state,
		startRoundNumber,
	});
	return finalizeOvernightResearchLoop({
		scope,
		council,
		interrupt,
		loopKey,
		rounds: executed.rounds,
		progress: executed.progress,
		roundCounts: executed.roundCounts,
		finalSummary: executed.finalSummary,
	});
}

/** Re-export the public overnight research types from the focused loop entrypoint. */
export type {
	BaselineData,
	OvernightResearchRound,
	OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight-types.js";
