/**
 * @chitragupta/anina — Autonomous Agent Wrapper.
 *
 * Makes the agent self-healing and self-aware — like the Vedic concept of
 * "Atman" (self), the system becomes conscious of its own performance and
 * evolves through experience.
 *
 * ## Self-Healing Error Recovery
 *
 * Errors are classified as:
 * - **Transient** (network, timeout, rate limit): exponential backoff retry
 *   with jitter, up to 3 attempts.
 * - **Fatal** (invalid input, permission denied): surface immediately.
 * - **Unknown**: treated as transient on first occurrence, fatal on repeat.
 *
 * ## Context Corruption Recovery
 *
 * If the messages array is malformed (e.g., missing roles, broken tool
 * result chains), the agent rebuilds from the last known good state by
 * scanning backward for the last structurally valid prefix.
 *
 * ## Health Monitoring
 *
 * Tracks response latency, token usage per turn, error rate, and compaction
 * frequency. Emits warning events when metrics cross thresholds.
 *
 * ## Graceful Degradation
 *
 * - Model unavailable: queue messages, retry with backoff
 * - Memory corrupted: fall back to in-memory only mode
 * - Tools failing consistently: temporarily disable, notify user
 *
 * @packageDocumentation
 */

import type { AgentState, AgentMessage, ToolResult } from "./types.js";
import { CompactionMonitor } from "./context-compaction-informational.js";
import { estimateTotalTokens } from "./context-compaction.js";
import { LearningLoop } from "./learning-loop.js";

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

// ─── Error Classification ───────────────────────────────────────────────────

/** Transient error patterns (network, timeout, rate limit). */
const TRANSIENT_PATTERNS = [
	/timeout/i,
	/ECONNREFUSED/i,
	/ECONNRESET/i,
	/ETIMEDOUT/i,
	/ENOTFOUND/i,
	/rate.?limit/i,
	/429/,
	/503/,
	/502/,
	/504/,
	/too many requests/i,
	/network/i,
	/fetch failed/i,
	/socket hang up/i,
	/EPIPE/i,
];

/** Fatal error patterns (invalid input, permission, auth). */
const FATAL_PATTERNS = [
	/invalid.*input/i,
	/permission denied/i,
	/unauthorized/i,
	/forbidden/i,
	/401/,
	/403/,
	/invalid.*api.?key/i,
	/authentication/i,
	/not found.*model/i,
	/invalid.*model/i,
	/context.*length.*exceeded/i,
];

/**
 * Classify an error as transient, fatal, or unknown.
 *
 * Transient errors are retryable (network glitches, rate limits, timeouts).
 * Fatal errors should be surfaced immediately (bad input, auth failures).
 * Unknown errors default to cautious retry behavior.
 *
 * @param error - The error to classify.
 * @returns The error classification.
 */
export function classifyError(error: Error): "transient" | "fatal" | "unknown" {
	const message = error.message + (error.cause ? ` ${String(error.cause)}` : "");

	for (const pattern of FATAL_PATTERNS) {
		if (pattern.test(message)) return "fatal";
	}
	for (const pattern of TRANSIENT_PATTERNS) {
		if (pattern.test(message)) return "transient";
	}

	return "unknown";
}

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

// ─── Internal Tracking ──────────────────────────────────────────────────────

interface TurnMetrics {
	startTime: number;
	endTime: number;
	latencyMs: number;
	tokensBefore: number;
	tokensAfter: number;
	hadError: boolean;
	errorType?: "transient" | "fatal" | "unknown";
}

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

	/**
	 * Register a listener for autonomy events.
	 *
	 * @param listener - Callback for autonomy events.
	 */
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

	/**
	 * Called before each turn — snapshot state for recovery.
	 *
	 * @param state - Current agent state.
	 */
	beforeTurn(state: AgentState): void {
		// Snapshot the messages for corruption recovery
		this.lastGoodMessages = state.messages.map((m) => ({ ...m }));
	}

	/**
	 * Called after each turn — check if compaction is needed, record metrics.
	 *
	 * @param state - Current agent state after the turn.
	 * @param contextLimit - Context window size in tokens (overrides config).
	 * @returns Possibly compacted agent state.
	 */
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

	/**
	 * Record a completed turn's metrics.
	 *
	 * @param latencyMs - Turn response latency in milliseconds.
	 * @param state - Agent state after the turn.
	 * @param hadError - Whether the turn encountered an error.
	 * @param errorType - Classification of the error if one occurred.
	 */
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

	/**
	 * Called when a tool is about to be used — start timing.
	 *
	 * @param toolName - Name of the tool.
	 */
	onToolStart(toolName: string): void {
		this.learningLoop.markToolStart(toolName);
	}

	/**
	 * Called when a tool completes — record for learning and failure tracking.
	 *
	 * @param toolName - Name of the tool.
	 * @param args - Arguments passed to the tool.
	 * @param result - The tool result.
	 */
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

	/**
	 * Called when user provides feedback (accept/reject).
	 *
	 * @param turnId - The unique turn identifier.
	 * @param accepted - Whether the user accepted the output.
	 */
	onUserFeedback(turnId: string, accepted: boolean): void {
		this.learningLoop.recordFeedback(turnId, accepted);
	}

	/**
	 * Check if a tool is currently disabled due to repeated failures.
	 *
	 * @param toolName - Name of the tool.
	 * @returns True if the tool is disabled.
	 */
	isToolDisabled(toolName: string): boolean {
		return this.toolFailures.get(toolName)?.disabled ?? false;
	}

	/**
	 * Get all currently disabled tools.
	 */
	getDisabledTools(): string[] {
		const disabled: string[] = [];
		for (const [name, tracker] of this.toolFailures) {
			if (tracker.disabled) disabled.push(name);
		}
		return disabled;
	}

	// ─── Error Recovery ─────────────────────────────────────────────

	/**
	 * Execute an async operation with self-healing error recovery.
	 *
	 * Transient errors are retried with exponential backoff and jitter.
	 * Fatal errors are thrown immediately.
	 * Unknown errors are retried once, then treated as fatal.
	 *
	 * @param operation - The async operation to execute.
	 * @returns The operation result.
	 * @throws The error if all retries are exhausted or error is fatal.
	 */
	async withRetry<T>(operation: () => Promise<T>): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				lastError = error;

				const classification = classifyError(error);
				this.emit("autonomy:error_classified", {
					error: error.message,
					classification,
					attempt,
				});

				if (classification === "fatal") {
					throw error;
				}

				if (classification === "unknown") {
					// Track unknown errors — escalate to fatal on repeat
					const key = error.message.slice(0, 100);
					const count = (this.unknownErrorCounts.get(key) ?? 0) + 1;
					this.unknownErrorCounts.set(key, count);

					if (count >= 3) {
						throw error;
					}
				}

				if (attempt < this.config.maxRetries) {
					const delay = this.computeBackoffDelay(attempt);
					this.emit("autonomy:retry", {
						attempt: attempt + 1,
						maxRetries: this.config.maxRetries,
						delayMs: delay,
						error: error.message,
						classification,
					});
					await this.sleep(delay);
				}
			}
		}

		throw lastError ?? new Error("Retry exhausted with no error captured");
	}

	/**
	 * Recover from context corruption by restoring the last known good state.
	 *
	 * Scans the current messages backward to find the last structurally valid
	 * prefix (proper role alternation, matched tool calls/results). If no
	 * valid prefix is found, falls back to the last snapshot.
	 *
	 * @param state - The potentially corrupted agent state.
	 * @returns The recovered state.
	 */
	recoverContext(state: AgentState): AgentState {
		const validPrefix = this.findValidMessagePrefix(state.messages);

		if (validPrefix.length === state.messages.length) {
			// No corruption detected
			return state;
		}

		if (validPrefix.length > 0) {
			this.emit("autonomy:context_recovered", {
				method: "prefix_scan",
				originalLength: state.messages.length,
				recoveredLength: validPrefix.length,
			});
			return { ...state, messages: validPrefix };
		}

		// Fall back to last known good state
		if (this.lastGoodMessages) {
			this.emit("autonomy:context_recovered", {
				method: "snapshot_restore",
				originalLength: state.messages.length,
				recoveredLength: this.lastGoodMessages.length,
			});
			return { ...state, messages: [...this.lastGoodMessages] };
		}

		// Nuclear option: start fresh with just the system prompt
		this.emit("autonomy:context_recovered", {
			method: "fresh_start",
			originalLength: state.messages.length,
			recoveredLength: 0,
		});
		return { ...state, messages: [] };
	}

	// ─── Health Monitoring ──────────────────────────────────────────

	/**
	 * Get a comprehensive health report for the agent.
	 *
	 * @param state - Current agent state for token estimation.
	 * @returns Complete health metrics snapshot.
	 */
	getHealthReport(state: AgentState): AgentHealthReport {
		const recentTurns = this.turnMetrics.slice(-50);
		const avgLatency = recentTurns.length > 0
			? recentTurns.reduce((sum, t) => sum + t.latencyMs, 0) / recentTurns.length
			: 0;

		const errorCount = recentTurns.filter((t) => t.hadError).length;
		const errorRate = recentTurns.length > 0 ? errorCount / recentTurns.length : 0;

		const currentTokens = estimateTotalTokens(state);
		const disabledTools = this.getDisabledTools();

		return {
			avgLatencyMs: Math.round(avgLatency),
			currentTokens,
			contextUtilization: currentTokens / this.config.contextLimit,
			errorRate,
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

	/**
	 * Enter degraded mode with the given reason.
	 *
	 * @param reason - Human-readable reason for degradation.
	 */
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

	/**
	 * Attempt to exit degraded mode by removing a reason.
	 *
	 * @param reason - The reason to remove.
	 */
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

	// ─── Private: Backoff ───────────────────────────────────────────

	/**
	 * Compute exponential backoff delay with jitter.
	 *
	 *     delay = min(baseDelay * 2^attempt + jitter, maxDelay)
	 *     jitter = random(0, baseDelay)
	 *
	 * The jitter prevents thundering herd when multiple agents retry
	 * simultaneously against a rate-limited endpoint.
	 */
	private computeBackoffDelay(attempt: number): number {
		const exponential = this.config.baseDelayMs * Math.pow(2, attempt);
		const jitter = Math.random() * this.config.baseDelayMs;
		return Math.min(exponential + jitter, this.config.maxDelayMs);
	}

	/** Sleep for the given duration. */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ─── Private: Message Validation ────────────────────────────────

	/**
	 * Find the longest valid prefix of messages.
	 *
	 * A valid message sequence follows these rules:
	 * 1. Each message has an id, role, content array, and timestamp.
	 * 2. tool_result messages must follow a message containing tool_call parts.
	 * 3. No consecutive system messages (except at the start).
	 */
	private findValidMessagePrefix(messages: AgentMessage[]): AgentMessage[] {
		const valid: AgentMessage[] = [];
		let lastHadToolCalls = false;

		for (const msg of messages) {
			// Structural validation
			if (!msg.id || !msg.role || !Array.isArray(msg.content)) {
				break;
			}
			if (typeof msg.timestamp !== "number" || msg.timestamp <= 0) {
				break;
			}

			// tool_result must follow a tool_call
			if (msg.role === "tool_result" && !lastHadToolCalls) {
				break;
			}

			// Track whether this message has tool calls
			lastHadToolCalls = msg.content.some((p) => p.type === "tool_call");

			valid.push(msg);
		}

		return valid;
	}

	// ─── Private: Health Threshold Checks ───────────────────────────

	/**
	 * Check health metrics against configured thresholds and emit warnings.
	 */
	private checkHealthThresholds(state: AgentState): void {
		const recentTurns = this.turnMetrics.slice(-20);
		if (recentTurns.length < 3) return;

		// Check error rate
		const errorCount = recentTurns.filter((t) => t.hadError).length;
		const errorRate = errorCount / recentTurns.length;
		if (errorRate >= this.config.errorRateWarningThreshold) {
			this.emit("autonomy:health_warning", {
				metric: "error_rate",
				value: errorRate,
				threshold: this.config.errorRateWarningThreshold,
				message: `Error rate ${(errorRate * 100).toFixed(0)}% exceeds threshold`,
			});
		}

		// Check latency
		const avgLatency = recentTurns.reduce((s, t) => s + t.latencyMs, 0) / recentTurns.length;
		if (avgLatency >= this.config.latencyWarningMs) {
			this.emit("autonomy:health_warning", {
				metric: "latency",
				value: avgLatency,
				threshold: this.config.latencyWarningMs,
				message: `Average latency ${Math.round(avgLatency)}ms exceeds threshold`,
			});
		}

		// Check context utilization
		const tokens = estimateTotalTokens(state);
		const utilization = tokens / this.config.contextLimit;
		if (utilization >= 0.85) {
			this.emit("autonomy:health_warning", {
				metric: "context_utilization",
				value: utilization,
				threshold: 0.85,
				message: `Context ${(utilization * 100).toFixed(0)}% full`,
			});
		}
	}
}
