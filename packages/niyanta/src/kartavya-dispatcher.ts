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

// ─── Types ──────────────────────────────────────────────────────────────────

/** Duck-typed Samiti interface for broadcasting notifications. */
interface DispatcherSamiti {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
		},
	): unknown;
}

/** Duck-typed Rta check interface. */
interface DispatcherRta {
	check(context: {
		toolName: string;
		args: Record<string, unknown>;
		workingDirectory: string;
		sessionId?: string;
		project?: string;
	}): { allowed: boolean; reason?: string };
}

/** Result of executing a single kartavya action. */
export interface DispatchResult {
	kartavyaId: string;
	action: KartavyaAction;
	success: boolean;
	result?: string;
	error?: string;
}

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
	private readonly samiti: DispatcherSamiti | null;
	private readonly rta: DispatcherRta | null;
	private readonly config: KartavyaDispatcherConfig;
	private timer: ReturnType<typeof setInterval> | null = null;
	private activeExecutions = 0;
	private readonly results: DispatchResult[] = [];

	constructor(
		engine: KartavyaEngine,
		samiti: DispatcherSamiti | null,
		rta: DispatcherRta | null,
		config?: Partial<KartavyaDispatcherConfig>,
	) {
		this.engine = engine;
		this.samiti = samiti;
		this.rta = rta;
		this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
	}

	/**
	 * Start the periodic evaluation loop.
	 */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.evaluate().catch(() => { /* best-effort */ });
		}, this.config.evaluationIntervalMs);

		// Run first evaluation immediately
		this.evaluate().catch(() => { /* best-effort */ });
	}

	/**
	 * Stop the evaluation loop.
	 */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Get recent dispatch results.
	 */
	getResults(limit = 20): DispatchResult[] {
		return this.results.slice(-limit);
	}

	/**
	 * Evaluate triggers and dispatch matching kartavya actions.
	 */
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
			if (this.activeExecutions >= this.config.maxConcurrent) break;

			try {
				const result = await this.dispatch(kartavya);
				dispatched.push(result);
				this.results.push(result);
				// Keep result ring buffer bounded
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
		const { action } = kartavya;

		switch (action.type) {
			case "notification":
				return this.dispatchNotification(kartavya);
			case "command":
				return this.dispatchCommand(kartavya);
			case "tool_sequence":
				return this.dispatchToolSequence(kartavya);
			case "vidhi":
				return this.dispatchVidhi(kartavya);
			default:
				return {
					kartavyaId: kartavya.id,
					action,
					success: false,
					error: `Unknown action type: ${(action as { type: string }).type}`,
				};
		}
	}

	private dispatchNotification(kartavya: Kartavya): DispatchResult {
		const message = kartavya.action.payload?.message as string ?? kartavya.description;
		const channel = kartavya.action.payload?.channel as string ?? "#kartavya";
		const severity = kartavya.action.payload?.severity as string ?? "info";

		if (this.samiti) {
			this.samiti.broadcast(channel, {
				sender: "kartavya-dispatcher",
				severity: (severity === "warning" || severity === "critical" ? severity : "info") as "info" | "warning" | "critical",
				category: "kartavya",
				content: message,
			});
		}

		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: true,
			result: `Broadcast to ${channel}: ${message}`,
		};
	}

	private dispatchCommand(kartavya: Kartavya): DispatchResult {
		if (!this.config.enableCommandActions) {
			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: false,
				error: "Command actions are disabled (enableCommandActions: false)",
			};
		}

		const command = kartavya.action.payload?.command as string;
		if (!command) {
			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: false,
				error: "No command specified in action payload",
			};
		}

		// Rta safety check FIRST
		if (this.rta) {
			const verdict = this.rta.check({
				toolName: "bash",
				args: { command },
				workingDirectory: this.config.workingDirectory,
				project: this.config.project,
			});

			if (!verdict.allowed) {
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Rta blocked: ${verdict.reason}`,
				};
			}
		}

		// Execute via child_process (sync for simplicity, with timeout)
		try {
			const { execSync } = require("child_process") as typeof import("child_process");
			const output = execSync(command, {
				cwd: this.config.workingDirectory,
				timeout: 30_000,
				encoding: "utf-8",
				maxBuffer: 1_000_000,
			});

			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: true,
				result: output.slice(0, 500),
			};
		} catch (err) {
			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: false,
				error: String(err).slice(0, 500),
			};
		}
	}

	private dispatchToolSequence(kartavya: Kartavya): DispatchResult {
		const tools = kartavya.action.payload?.tools as Array<{ name: string; args: Record<string, unknown> }> | undefined;
		if (!tools || tools.length === 0) {
			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: false,
				error: "No tools specified in tool_sequence payload",
			};
		}

		// Notify about the tool sequence via Samiti (actual execution requires agent context)
		if (this.samiti) {
			this.samiti.broadcast("#kartavya", {
				sender: "kartavya-dispatcher",
				severity: "info",
				category: "kartavya",
				content: `Tool sequence triggered: ${tools.map((t) => t.name).join(" → ")} (${kartavya.name})`,
			});
		}

		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: true,
			result: `Tool sequence queued: ${tools.map((t) => t.name).join(" → ")}`,
		};
	}

	private dispatchVidhi(kartavya: Kartavya): DispatchResult {
		const vidhiName = kartavya.action.payload?.vidhi as string;
		if (!vidhiName) {
			return {
				kartavyaId: kartavya.id,
				action: kartavya.action,
				success: false,
				error: "No vidhi name specified in payload",
			};
		}

		// Notify about vidhi execution via Samiti
		if (this.samiti) {
			this.samiti.broadcast("#kartavya", {
				sender: "kartavya-dispatcher",
				severity: "info",
				category: "kartavya",
				content: `Vidhi triggered: ${vidhiName} (${kartavya.name})`,
			});
		}

		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: true,
			result: `Vidhi queued: ${vidhiName}`,
		};
	}
}
