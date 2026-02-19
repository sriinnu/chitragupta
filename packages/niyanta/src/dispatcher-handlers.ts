/**
 * Dispatcher handlers — action execution implementations for KartavyaDispatcher.
 *
 * Each handler executes a specific action type (notification, command,
 * tool_sequence, vidhi) using injected dependencies. All Rta safety
 * checks are performed before execution.
 */

import { execSync } from "node:child_process";

import type { Kartavya } from "./kartavya.js";
import type { DispatchResult, ToolExecutor, KartavyaDispatcherConfig } from "./kartavya-dispatcher.js";

// ─── Duck-typed Interfaces ──────────────────────────────────────────────────

/** Duck-typed Samiti interface for broadcasting notifications. */
export interface DispatcherSamiti {
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
export interface DispatcherRta {
	check(context: {
		toolName: string;
		args: Record<string, unknown>;
		workingDirectory: string;
		sessionId?: string;
		project?: string;
	}): { allowed: boolean; reason?: string };
}

/** Duck-typed VidhiEngine interface for resolving vidhis by name. */
export interface DispatcherVidhiEngine {
	match(query: string): {
		name: string;
		steps: Array<{ toolName: string; args: Record<string, unknown> }>;
	} | null;
}

/** Bundled dependencies passed to each handler. */
export interface DispatchDeps {
	samiti: DispatcherSamiti | null;
	rta: DispatcherRta | null;
	config: KartavyaDispatcherConfig;
	/** Mutable ref for tracking concurrent executions. */
	activeExecutions: { count: number };
}

// ─── Notification Handler ───────────────────────────────────────────────────

/** Broadcast a notification via Samiti. */
export function dispatchNotification(kartavya: Kartavya, deps: DispatchDeps): DispatchResult {
	const message = kartavya.action.payload?.message as string ?? kartavya.description;
	const channel = kartavya.action.payload?.channel as string ?? "#kartavya";
	const severity = kartavya.action.payload?.severity as string ?? "info";

	if (deps.samiti) {
		deps.samiti.broadcast(channel, {
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

// ─── Command Handler ────────────────────────────────────────────────────────

/** Execute a bash command with Rta safety check. Disabled by default. */
export function dispatchCommand(kartavya: Kartavya, deps: DispatchDeps): DispatchResult {
	if (!deps.config.enableCommandActions) {
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

	if (deps.rta) {
		const verdict = deps.rta.check({
			toolName: "bash",
			args: { command },
			workingDirectory: deps.config.workingDirectory,
			project: deps.config.project,
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

	try {
		const output = execSync(command, {
			cwd: deps.config.workingDirectory,
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

// ─── Tool Sequence Handler ──────────────────────────────────────────────────

/** Execute a sequence of tools with Rta checks on each step. */
export async function dispatchToolSequence(
	kartavya: Kartavya,
	deps: DispatchDeps,
): Promise<DispatchResult> {
	const tools = kartavya.action.payload?.tools as
		| Array<{ name: string; args: Record<string, unknown> }>
		| undefined;

	if (!tools || tools.length === 0) {
		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: false,
			error: "No tools specified in tool_sequence payload",
		};
	}

	const executor = deps.config.toolExecutor;
	if (!executor) {
		if (deps.samiti) {
			deps.samiti.broadcast("#kartavya", {
				sender: "kartavya-dispatcher",
				severity: "info",
				category: "kartavya",
				content: `Tool sequence triggered (no executor): ${tools.map((t) => t.name).join(" → ")} (${kartavya.name})`,
			});
		}
		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: true,
			result: `Tool sequence broadcast (no executor): ${tools.map((t) => t.name).join(" → ")}`,
		};
	}

	const outputs: string[] = [];
	for (const tool of tools) {
		if (deps.rta) {
			const verdict = deps.rta.check({
				toolName: tool.name,
				args: tool.args ?? {},
				workingDirectory: deps.config.workingDirectory,
				project: deps.config.project,
			});
			if (!verdict.allowed) {
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Rta blocked tool "${tool.name}": ${verdict.reason}`,
				};
			}
		}

		deps.activeExecutions.count++;
		try {
			const result = await executor(tool.name, tool.args ?? {});
			if (!result.success) {
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Tool "${tool.name}" failed: ${result.error ?? "unknown error"}`,
				};
			}
			outputs.push(`${tool.name}: ${(result.output ?? "ok").slice(0, 200)}`);
		} finally {
			deps.activeExecutions.count--;
		}
	}

	if (deps.samiti) {
		deps.samiti.broadcast("#kartavya", {
			sender: "kartavya-dispatcher",
			severity: "info",
			category: "kartavya",
			content: `Tool sequence complete: ${tools.map((t) => t.name).join(" → ")} (${kartavya.name})`,
		});
	}

	return {
		kartavyaId: kartavya.id,
		action: kartavya.action,
		success: true,
		result: outputs.join("\n"),
	};
}

// ─── Vidhi Handler ──────────────────────────────────────────────────────────

/** Execute a learned procedure (vidhi) with Rta checks on each step. */
export async function dispatchVidhi(
	kartavya: Kartavya,
	deps: DispatchDeps,
): Promise<DispatchResult> {
	const vidhiName = kartavya.action.payload?.vidhi as string;
	if (!vidhiName) {
		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: false,
			error: "No vidhi name specified in payload",
		};
	}

	const vidhiEngine = deps.config.vidhiEngine;
	const executor = deps.config.toolExecutor;

	if (!vidhiEngine || !executor) {
		if (deps.samiti) {
			deps.samiti.broadcast("#kartavya", {
				sender: "kartavya-dispatcher",
				severity: "info",
				category: "kartavya",
				content: `Vidhi triggered (no engine/executor): ${vidhiName} (${kartavya.name})`,
			});
		}
		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: true,
			result: `Vidhi broadcast (no engine/executor): ${vidhiName}`,
		};
	}

	const vidhi = vidhiEngine.match(vidhiName);
	if (!vidhi) {
		return {
			kartavyaId: kartavya.id,
			action: kartavya.action,
			success: false,
			error: `Vidhi "${vidhiName}" not found`,
		};
	}

	const outputs: string[] = [];
	for (const step of vidhi.steps) {
		if (deps.rta) {
			const verdict = deps.rta.check({
				toolName: step.toolName,
				args: step.args ?? {},
				workingDirectory: deps.config.workingDirectory,
				project: deps.config.project,
			});
			if (!verdict.allowed) {
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Rta blocked vidhi step "${step.toolName}": ${verdict.reason}`,
				};
			}
		}

		deps.activeExecutions.count++;
		try {
			const result = await executor(step.toolName, step.args ?? {});
			if (!result.success) {
				return {
					kartavyaId: kartavya.id,
					action: kartavya.action,
					success: false,
					error: `Vidhi step "${step.toolName}" failed: ${result.error ?? "unknown error"}`,
				};
			}
			outputs.push(`${step.toolName}: ${(result.output ?? "ok").slice(0, 200)}`);
		} finally {
			deps.activeExecutions.count--;
		}
	}

	if (deps.samiti) {
		deps.samiti.broadcast("#kartavya", {
			sender: "kartavya-dispatcher",
			severity: "info",
			category: "kartavya",
			content: `Vidhi "${vidhiName}" complete: ${vidhi.steps.map((s) => s.toolName).join(" → ")}`,
		});
	}

	return {
		kartavyaId: kartavya.id,
		action: kartavya.action,
		success: true,
		result: `Vidhi "${vidhiName}" executed: ${outputs.join("\n")}`,
	};
}
