/** @chitragupta/anina — Autonomous Agent Wrapper (self-healing, self-aware). */

import type { AgentState, AgentMessage, ToolResult } from "./types.js";
import { CompactionMonitor } from "./context-compaction-informational.js";
import { estimateTotalTokens } from "./context-compaction.js";
import { LearningLoop } from "./learning-loop.js";
import {
	classifyError as classifyErrorFn,
	withRetry as withRetryFn,
	recoverContext as recoverContextFn,
	checkHealthThresholds as checkHealthThresholdsFn,
	type TurnMetrics,
} from "./autonomy-recovery.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the self-healing behavior. */
export interface AutoHealConfig {
	/** Maximum retry attempts for transient errors. Default: 3. */
	maxRetries: number;
	/** Base delay for exponential backoff in ms. Default: 1000. */
	baseDelayMs: number;
	/** Maximum backoff delay in ms. Default: 30000. */
	maxDelayMs: number;
	/** Error rate threshold (0-1) before emitting a warning. Default: 0.3. */
	errorRateWarningThreshold: number;
	/** Latency threshold (ms) before emitting a warning. Default: 15000. */
	latencyWarningMs: number;
	/** Number of consecutive tool failures before disabling a tool. Default: 5. */
	toolDisableThreshold: number;
	/** Context limit for the current model in tokens. Default: 128000. */
	contextLimit: number;
}

/** A snapshot of agent health metrics. */
export interface AgentHealthReport {
	/** Average response latency over recent turns (ms). */
	avgLatencyMs: number;
	/** Total tokens used in current context. */
	currentTokens: number;
	/** Context utilization as fraction of limit (0-1). */
	contextUtilization: number;
	/** Error rate over recent turns (0-1). */
	errorRate: number;
	/** Number of compactions triggered in this session. */
	compactionCount: number;
	/** Last compaction tier applied. */
	lastCompactionTier: "none" | "gentle" | "moderate" | "aggressive";
	/** Number of tools currently disabled due to failures. */
	disabledToolCount: number;
	/** Names of disabled tools. */
	disabledTools: string[];
	/** Total turns processed. */
	totalTurns: number;
	/** Total errors encountered. */
	totalErrors: number;
	/** Whether the agent is in degraded mode. */
	isDegraded: boolean;
	/** Degradation reasons (if any). */
	degradationReasons: string[];
	/** Uptime in ms since the autonomous wrapper was created. */
	uptimeMs: number;
}

/** Event types emitted by the autonomous agent. */
export type AutonomyEventType =
	| "autonomy:retry"
	| "autonomy:error_classified"
	| "autonomy:compaction"
	| "autonomy:tool_disabled"
	| "autonomy:tool_reenabled"
	| "autonomy:health_warning"
	| "autonomy:context_recovered"
	| "autonomy:degraded";

/** Listener for autonomy events. */
export type AutonomyEventListener = (
	event: AutonomyEventType,
	data: Record<string, unknown>,
) => void;

// Re-export classifyError for backward compatibility
export const classifyError = classifyErrorFn;

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AutoHealConfig = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30_000,
	errorRateWarningThreshold: 0.3,
	latencyWarningMs: 15_000,
	toolDisableThreshold: 5,
	contextLimit: 128_000,
};

interface ToolFailureTracker {
	consecutiveFailures: number;
	totalFailures: number;
	disabled: boolean;
	disabledAt?: number;
}

// ─── Autonomous Agent ───────────────────────────────────────────────────────

/**
 * The autonomous agent wrapper — makes any agent self-healing and self-aware.
 *
 * Wraps the agent loop with error recovery, auto-compaction, health
 * monitoring, graceful degradation, and learning integration.
 */
export class AutonomousAgent {
	private config: AutoHealConfig;
	private compactionMonitor: CompactionMonitor;
	private learningLoop: LearningLoop;
	private eventListeners: AutonomyEventListener[] = [];

	/** Turn-by-turn metrics (sliding window of last 100). */
	private turnMetrics: TurnMetrics[] = [];

	/** Per-tool failure tracking. */
	private toolFailures: Map<string, ToolFailureTracker> = new Map();

	/** Last known good messages state for corruption recovery. */
	private lastGoodMessages: AgentMessage[] | null = null;

	/** Compaction statistics. */
	private compactionCount = 0;
	private lastCompactionTier: "none" | "gentle" | "moderate" | "aggressive" = "none";

	/** Whether the agent is operating in degraded mode. */
	private degraded = false;
	private degradationReasons: string[] = [];

	/** Creation timestamp for uptime tracking. */
	private createdAt: number = Date.now();

	/** Count of unknown errors per error message for escalation. */
	private unknownErrorCounts: Map<string, number> = new Map();

	constructor(
		config?: Partial<AutoHealConfig>,
		learningLoop?: LearningLoop,
		compactionMonitor?: CompactionMonitor,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.learningLoop = learningLoop ?? new LearningLoop();
		this.compactionMonitor = compactionMonitor ?? new CompactionMonitor();
	}

	/** Get the learning loop instance. */
	getLearningLoop(): LearningLoop {
		return this.learningLoop;
	}

	/** Get the compaction monitor instance. */
	getCompactionMonitor(): CompactionMonitor {
		return this.compactionMonitor;
	}

	// ─── Event System ───────────────────────────────────────────────

	/** Register a listener for autonomy events. */
	onEvent(listener: AutonomyEventListener): void {
		this.eventListeners.push(listener);
	}

	/** Emit an autonomy event to all registered listeners. */
	private emit(event: AutonomyEventType, data: Record<string, unknown>): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event, data);
			} catch {
				// Listener errors must not break the autonomy loop
			}
		}
	}

	// ─── Core Hooks ─────────────────────────────────────────────────

	/** Called before each turn — snapshot state for recovery. */
	beforeTurn(state: AgentState): void {
		// Snapshot the messages for corruption recovery
		this.lastGoodMessages = state.messages.map((m) => ({ ...m }));
	}

	/** Called after each turn — check if compaction is needed, record metrics. */
	afterTurn(
		state: AgentState,
		contextLimit?: number,
	): AgentState {
		const limit = contextLimit ?? this.config.contextLimit;
		const tokensBefore = estimateTotalTokens(state);

		// Check and compact
		const result = this.compactionMonitor.checkAndCompact(state, limit);

		if (result.tier !== "none") {
			this.compactionCount++;
			this.lastCompactionTier = result.tier;
			this.emit("autonomy:compaction", {
				tier: result.tier,
				tokensBefore,
				tokensAfter: estimateTotalTokens({ ...state, messages: result.messages }),
				messagesBefore: state.messages.length,
				messagesAfter: result.messages.length,
			});
		}

		// Snapshot post-compaction state as known good
		this.lastGoodMessages = result.messages.map((m) => ({ ...m }));

		return { ...state, messages: result.messages };
	}

	/** Record a completed turn's metrics. */
	recordTurnMetrics(
		latencyMs: number,
		state: AgentState,
		hadError: boolean = false,
		errorType?: "transient" | "fatal" | "unknown",
	): void {
		const now = Date.now();
		const tokens = estimateTotalTokens(state);

		this.turnMetrics.push({
			startTime: now - latencyMs,
			endTime: now,
			latencyMs,
			tokensBefore: tokens,
			tokensAfter: tokens,
			hadError,
			errorType,
		});

		// Sliding window: keep last 100 turns
		if (this.turnMetrics.length > 100) {
			this.turnMetrics.shift();
		}

		// Check health thresholds
		this.checkHealthThresholds(state);
	}

	// ─── Tool Tracking ──────────────────────────────────────────────

	/** Called when a tool is about to be used. */
	onToolStart(toolName: string): void {
		this.learningLoop.markToolStart(toolName);
	}

	/** Called when a tool completes — record for learning and failure tracking. */
	onToolUsed(
		toolName: string,
		args: Record<string, unknown>,
		result: ToolResult,
	): void {
		this.learningLoop.recordToolUsage(toolName, args, result);

		// Track failures for auto-disable
		let tracker = this.toolFailures.get(toolName);
		if (!tracker) {
			tracker = { consecutiveFailures: 0, totalFailures: 0, disabled: false };
			this.toolFailures.set(toolName, tracker);
		}

		if (result.isError) {
			tracker.consecutiveFailures++;
			tracker.totalFailures++;

			if (
				tracker.consecutiveFailures >= this.config.toolDisableThreshold &&
				!tracker.disabled
			) {
				tracker.disabled = true;
				tracker.disabledAt = Date.now();
				this.emit("autonomy:tool_disabled", {
					tool: toolName,
					consecutiveFailures: tracker.consecutiveFailures,
					totalFailures: tracker.totalFailures,
				});
			}
		} else {
			// Reset consecutive failure counter on success
			if (tracker.disabled) {
				// Re-enable on next success after being disabled
				tracker.disabled = false;
				tracker.consecutiveFailures = 0;
				this.emit("autonomy:tool_reenabled", { tool: toolName });
			} else {
				tracker.consecutiveFailures = 0;
			}
		}
	}

	/** Called when user provides feedback (accept/reject). */
	onUserFeedback(turnId: string, accepted: boolean): void {
		this.learningLoop.recordFeedback(turnId, accepted);
	}

	/** Check if a tool is currently disabled due to repeated failures. */
	isToolDisabled(toolName: string): boolean {
		return this.toolFailures.get(toolName)?.disabled ?? false;
	}

	/** Get all currently disabled tools. */
	getDisabledTools(): string[] {
		const disabled: string[] = [];
		for (const [name, tracker] of this.toolFailures) {
			if (tracker.disabled) disabled.push(name);
		}
		return disabled;
	}

	// ─── Error Recovery ─────────────────────────────────────────────

	/** Execute an async operation with self-healing error recovery. */
	async withRetry<T>(operation: () => Promise<T>): Promise<T> {
		return withRetryFn(operation, {
			maxRetries: this.config.maxRetries,
			baseDelayMs: this.config.baseDelayMs,
			maxDelayMs: this.config.maxDelayMs,
			unknownErrorCounts: this.unknownErrorCounts,
			onClassified: (error, classification, attempt) => {
				this.emit("autonomy:error_classified", { error: error.message, classification, attempt });
			},
			onRetry: (attempt, delayMs, error, classification) => {
				this.emit("autonomy:retry", { attempt, maxRetries: this.config.maxRetries, delayMs, error: error.message, classification });
			},
		});
	}

	/** Recover from context corruption by restoring the last known good state. */
	recoverContext(state: AgentState): AgentState {
		return recoverContextFn(state, {
			lastGoodMessages: this.lastGoodMessages,
			onRecovered: (method, originalLength, recoveredLength) => {
				this.emit("autonomy:context_recovered", { method, originalLength, recoveredLength });
			},
		});
	}

	// ─── Health Monitoring ──────────────────────────────────────────

	/** Get a comprehensive health report for the agent. */
	getHealthReport(state: AgentState): AgentHealthReport {
		const recentTurns = this.turnMetrics.slice(-50);
		const avgLatency = recentTurns.length > 0
			? recentTurns.reduce((sum, t) => sum + t.latencyMs, 0) / recentTurns.length : 0;
		const errorCount = recentTurns.filter((t) => t.hadError).length;
		const currentTokens = estimateTotalTokens(state);
		const disabledTools = this.getDisabledTools();
		return {
			avgLatencyMs: Math.round(avgLatency),
			currentTokens,
			contextUtilization: currentTokens / this.config.contextLimit,
			errorRate: recentTurns.length > 0 ? errorCount / recentTurns.length : 0,
			compactionCount: this.compactionCount,
			lastCompactionTier: this.lastCompactionTier,
			disabledToolCount: disabledTools.length,
			disabledTools,
			totalTurns: this.turnMetrics.length,
			totalErrors: this.turnMetrics.filter((t) => t.hadError).length,
			isDegraded: this.degraded,
			degradationReasons: [...this.degradationReasons],
			uptimeMs: Date.now() - this.createdAt,
		};
	}

	// ─── Graceful Degradation ───────────────────────────────────────

	/** Enter degraded mode with the given reason. */
	enterDegradedMode(reason: string): void {
		if (!this.degradationReasons.includes(reason)) {
			this.degradationReasons.push(reason);
		}
		this.degraded = true;
		this.emit("autonomy:degraded", {
			degraded: true,
			reasons: this.degradationReasons,
		});
	}

	/** Attempt to exit degraded mode by removing a reason. */
	exitDegradedMode(reason: string): void {
		this.degradationReasons = this.degradationReasons.filter((r) => r !== reason);
		if (this.degradationReasons.length === 0) {
			this.degraded = false;
		}
		this.emit("autonomy:degraded", {
			degraded: this.degraded,
			reasons: this.degradationReasons,
		});
	}

	/** Whether the agent is currently in degraded mode. */
	isDegradedMode(): boolean {
		return this.degraded;
	}

	/** Check health metrics against configured thresholds. */
	private checkHealthThresholds(state: AgentState): void {
		checkHealthThresholdsFn(this.turnMetrics.slice(-20), estimateTotalTokens(state), {
			errorRateWarningThreshold: this.config.errorRateWarningThreshold,
			latencyWarningMs: this.config.latencyWarningMs,
			contextLimit: this.config.contextLimit,
			onWarning: (metric, value, threshold, message) => {
				this.emit("autonomy:health_warning", { metric, value, threshold, message });
			},
		});
	}
}
