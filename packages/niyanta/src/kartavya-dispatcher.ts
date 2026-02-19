/**
 * @chitragupta/niyanta — KartavyaDispatcher — Autonomous Action Executor.
 *
 * Periodically evaluates KartavyaEngine triggers against the current context
 * and dispatches matched actions. Rate-limited, Rta-checked, and safe by default.
 *
 * Action types:
 *   tool_sequence   — call tools in order via injected executor
 *   vidhi           — apply a learned procedure
 *   command         — execute a bash command (disabled by default, Rta-checked)
 *   notification    — broadcast via Samiti
 */

import type {
	Kartavya,
	KartavyaAction,
	TriggerContext,
} from "./kartavya.js";
import { KartavyaEngine } from "./kartavya.js";
import {
	dispatchNotification,
	dispatchCommand,
	dispatchToolSequence,
	dispatchVidhi,
} from "./dispatcher-handlers.js";
import type {
	DispatcherSamiti,
	DispatcherRta,
	DispatcherVidhiEngine,
	DispatchDeps,
} from "./dispatcher-handlers.js";

// Re-export handler interfaces for consumers
export type { DispatcherSamiti, DispatcherRta, DispatcherVidhiEngine } from "./dispatcher-handlers.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of executing a single kartavya action. */
export interface DispatchResult {
	kartavyaId: string;
	action: KartavyaAction;
	success: boolean;
	result?: string;
	error?: string;
}

/** Result of a single tool execution within a tool_sequence. */
export interface ToolExecResult {
	success: boolean;
	output?: string;
	error?: string;
}

/** Callback for executing a single tool. Injected by the host (CLI/MCP). */
export type ToolExecutor = (
	toolName: string,
	args: Record<string, unknown>,
) => Promise<ToolExecResult>;

/** Configuration for the KartavyaDispatcher. */
export interface KartavyaDispatcherConfig {
	/** Evaluation interval in ms. Default: 60_000 (1 minute). */
	evaluationIntervalMs: number;
	/** Max concurrent action executions. Default: 3. */
	maxConcurrent: number;
	/** Allow command-type actions (bash). Default: false (safety). */
	enableCommandActions: boolean;
	/** Working directory for command execution. */
	workingDirectory: string;
	/** Project path for context. */
	project?: string;
	/** Tool executor for tool_sequence and vidhi actions. */
	toolExecutor?: ToolExecutor;
	/** VidhiEngine for resolving vidhi names to tool sequences. */
	vidhiEngine?: DispatcherVidhiEngine;
}

const DEFAULT_DISPATCHER_CONFIG: KartavyaDispatcherConfig = {
	evaluationIntervalMs: 60_000,
	maxConcurrent: 3,
	enableCommandActions: false,
	workingDirectory: process.cwd(),
};

// ─── KartavyaDispatcher ─────────────────────────────────────────────────────

/**
 * Periodically evaluates kartavya triggers and dispatches matched actions.
 *
 * Actions go through Rta safety checks before execution. Command actions
 * are disabled by default and require explicit opt-in.
 */
export class KartavyaDispatcher {
	private readonly engine: KartavyaEngine;
	private readonly config: KartavyaDispatcherConfig;
	private readonly deps: DispatchDeps;
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly activeExecutions = { count: 0 };
	private readonly results: DispatchResult[] = [];

	constructor(
		engine: KartavyaEngine,
		samiti: DispatcherSamiti | null,
		rta: DispatcherRta | null,
		config?: Partial<KartavyaDispatcherConfig>,
	) {
		this.engine = engine;
		this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
		this.deps = {
			samiti,
			rta,
			config: this.config,
			activeExecutions: this.activeExecutions,
		};
	}

	/** Start the periodic evaluation loop. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.evaluate().catch(() => { /* best-effort */ });
		}, this.config.evaluationIntervalMs);

		this.evaluate().catch(() => { /* best-effort */ });
	}

	/** Stop the evaluation loop. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Get recent dispatch results. */
	getResults(limit = 20): DispatchResult[] {
		return this.results.slice(-limit);
	}

	/** Evaluate triggers and dispatch matching kartavya actions. */
	async evaluate(): Promise<DispatchResult[]> {
		const context: TriggerContext = {
			now: Date.now(),
			events: ["periodic_evaluation"],
			metrics: {},
			patterns: [],
		};

		const matched = this.engine.evaluateTriggers(context);
		const dispatched: DispatchResult[] = [];

		for (const kartavya of matched) {
			if (this.activeExecutions.count >= this.config.maxConcurrent) break;

			try {
				const result = await this.dispatch(kartavya);
				dispatched.push(result);
				this.results.push(result);
				if (this.results.length > 100) this.results.shift();
				this.engine.recordExecution(kartavya.id, result.success, result.result);
			} catch (err) {
				const failResult: DispatchResult = {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: String(err),
				};
				dispatched.push(failResult);
				this.results.push(failResult);
				this.engine.recordExecution(kartavya.id, false, String(err));
			}
		}

		return dispatched;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private async dispatch(kartavya: Kartavya): Promise<DispatchResult> {
		switch (kartavya.action.type) {
			case "notification": return dispatchNotification(kartavya, this.deps);
			case "command": return dispatchCommand(kartavya, this.deps);
			case "tool_sequence": return dispatchToolSequence(kartavya, this.deps);
			case "vidhi": return dispatchVidhi(kartavya, this.deps);
			default:
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Unknown action type: ${(kartavya.action as { type: string }).type}`,
				};
		}
	}
}
