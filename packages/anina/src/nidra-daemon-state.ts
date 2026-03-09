import type { NidraState, SwapnaPhase } from "./types.js";
import type { NidraDaemonState } from "./nidra-daemon-persistence.js";

export interface NidraRuntimeStateFields {
	state: NidraState;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart: number | undefined;
	lastConsolidationEnd: number | undefined;
	consolidationPhase: SwapnaPhase | undefined;
	consolidationProgress: number;
	startedAt: number;
	running: boolean;
	consecutiveIdleDreamCycles: number;
	sessionsProcessedSinceDeepSleep: number;
	sessionNotificationsSinceDeepSleep: number;
	pendingSessionIds: string[];
	preservePendingSessionsOnListening: boolean;
}

export function applyRestoredNidraState(
	target: NidraRuntimeStateFields,
	bag: NidraDaemonState,
): void {
	target.state = bag.state;
	target.lastStateChange = bag.lastStateChange;
	target.lastHeartbeat = bag.lastHeartbeat;
	target.lastConsolidationStart = bag.lastConsolidationStart;
	target.lastConsolidationEnd = bag.lastConsolidationEnd;
	target.consolidationPhase = bag.consolidationPhase;
	target.consolidationProgress = bag.consolidationProgress;
	target.consecutiveIdleDreamCycles = bag.consecutiveIdleDreamCycles;
	target.sessionsProcessedSinceDeepSleep = bag.sessionsProcessedSinceDeepSleep;
	target.sessionNotificationsSinceDeepSleep = bag.sessionNotificationsSinceDeepSleep;
	target.pendingSessionIds = [...bag.pendingSessionIds];
	target.preservePendingSessionsOnListening = bag.preservePendingSessionsOnListening;
}

export function buildNidraRuntimeStateBag(source: NidraRuntimeStateFields): NidraDaemonState {
	return {
		state: source.state,
		lastStateChange: source.lastStateChange,
		lastHeartbeat: source.lastHeartbeat,
		lastConsolidationStart: source.lastConsolidationStart,
		lastConsolidationEnd: source.lastConsolidationEnd,
		consolidationPhase: source.consolidationPhase,
		consolidationProgress: source.consolidationProgress,
		startedAt: source.startedAt,
		running: source.running,
		consecutiveIdleDreamCycles: source.consecutiveIdleDreamCycles,
		sessionsProcessedSinceDeepSleep: source.sessionsProcessedSinceDeepSleep,
		sessionNotificationsSinceDeepSleep: source.sessionNotificationsSinceDeepSleep,
		pendingSessionIds: [...source.pendingSessionIds],
		preservePendingSessionsOnListening: source.preservePendingSessionsOnListening,
	};
}
