/**
 * @chitragupta/cli — Coding CLI Router.
 *
 * Routes coding tasks to the best available CLI tool on PATH.
 * Priority: takumi > claude > codex > aider > gemini > zai
 * Fallback: returns an informative error if no CLI is available.
 *
 * @module
 */

import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { TakumiBridge } from "./takumi-bridge.js";
import type {
	TakumiArtifact,
	TakumiContext,
	TakumiExecutionObject,
	TakumiEvent,
	TakumiFinalReport,
	TakumiNormalizedResponse,
} from "./takumi-bridge-types.js";
import {
	inferCodingRouteClass,
	isTakumiCompatibleEngineLane,
	type ResolvedEngineBridgeRoute,
	type ResolvedEngineRouteEnvelope,
	resolveEngineRoutes,
	resolveRequestedEngineRouteClass,
	requiresEngineRoute,
} from "./coding-router-engine-routes.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Descriptor for a coding CLI that can be auto-detected on PATH. */
export interface CodingCli {
	/** Human-readable name (e.g. "claude", "codex"). */
	name: string;
	/** Binary name to look up on PATH. */
	command: string;
	/** Build the argument list for running a coding task. */
	buildArgs: (task: string, cwd: string) => string[];
	/** Check if this CLI binary exists on PATH. */
	detect: () => Promise<boolean>;
}

/** Result of routing a coding task to a CLI. */
export interface CodingRouteResult {
	/** Which CLI handled the task ("none" if nothing was available). */
	cli: string;
	/** Combined stdout+stderr output from the CLI. */
	output: string;
	/** Process exit code (0 = success). */
	exitCode: number;
	/**
	 * Canonical execution object.
	 *
	 * I keep this required on the public router surface because every success,
	 * fallback, and fail-closed path is normalized through one compatibility
	 * contract before the result escapes this module.
	 */
	execution: TakumiExecutionObject;
	/** Canonical engine-owned task identity. */
	taskId: string;
	/** Canonical engine-owned lane identity. */
	laneId: string;
	/** Typed final report synthesized or preserved by the router boundary. */
	finalReport: TakumiFinalReport;
	/** Bridge-synthesized or executor-native artifacts for the routed result. */
	artifacts: TakumiArtifact[];
	/** Full bridge result for compatibility consumers that still need it. */
	bridgeResult?: TakumiNormalizedResponse;
}

/** Options for {@link routeCodingTask}. */
export interface RouteCodingTaskOptions {
	/** The coding task description / prompt. */
	task: string;
	/** Working directory for the CLI process. */
	cwd: string;
	/** Canonical execution object when the caller already owns one. */
	execution?: TakumiExecutionObject;
	/** Canonical engine-owned task identity when the caller already has one. */
	taskId?: string;
	/** Canonical engine-owned lane identity when the caller already has one. */
	laneId?: string;
	/** Optional abort signal to cancel a running task. */
	signal?: AbortSignal;
	/** Streaming callback for stdout/stderr chunks. */
	onOutput?: (chunk: string) => void;
	/** Structured streaming callback with stable task/lane identity. */
	onProgress?: (event: BridgeRouteProgressEvent) => void;
}

/** Options for bridge-first routing via {@link routeViaBridge}. */
export interface BridgeRouteOptions {
	/** The coding task description / prompt. */
	task: string;
	/** Working directory. */
	cwd: string;
	/** Canonical execution object when the caller already owns one. */
	execution?: TakumiExecutionObject;
	/** Canonical engine-owned task identity when the caller already has one. */
	taskId?: string;
	/** Canonical engine-owned lane identity when the caller already has one. */
	laneId?: string;
	/** Optional context to inject into Takumi. */
	context?: TakumiContext;
	/** Force fresh inspection instead of predictive/cached context. */
	noCache?: boolean;
	/** Alias for noCache to make fresh-mode intent explicit. */
	fresh?: boolean;
	/** Canonical engine session id for route resolution. */
	sessionId?: string;
	/** Consumer identity for engine-owned route resolution. */
	consumer?: string;
	/** Optional engine route class to enforce before Takumi execution. */
	routeClass?: string;
	/** Optional capability for engine-owned route resolution. */
	capability?: string;
	/** Streaming callback for stdout/stderr chunks. */
	onOutput?: (chunk: string) => void;
	/**
	 * Structured streaming callback that preserves canonical execution identity.
	 *
	 * I keep `onOutput` for compatibility callers that still want plain text
	 * chunks, but this is the public seam higher layers should use when they need
	 * stable task/lane correlation during execution.
	 */
	onProgress?: (event: BridgeRouteProgressEvent) => void;
	/** Optional abort signal. */
	signal?: AbortSignal;
}

/** Structured public progress event for bridge-backed coding routes. */
export interface BridgeRouteProgressEvent extends TakumiEvent {
	/** Canonical execution identity for the streamed update. */
	execution: TakumiExecutionObject;
}

export type CodingExecutionIdentity = {
	execution: TakumiExecutionObject;
	taskId: string;
	laneId: string;
};

// ─── CLI Definitions (priority order) ────────────────────────────────────

/** Registry of known coding CLIs, ordered by priority. First match wins. */
const CODING_CLIS: CodingCli[] = [
	{
		name: "takumi",
		command: "takumi",
		buildArgs: (task, cwd) => ["--print", "--cwd", cwd, task],
		detect: () => commandExists("takumi"),
	},
	{
		name: "claude",
		command: "claude",
		buildArgs: (task, cwd) => ["--print", "--cwd", cwd, task],
		detect: () => commandExists("claude"),
	},
	{
		name: "codex",
		command: "codex",
		buildArgs: (task) => ["exec", "--full-auto", "-q", task],
		detect: () => commandExists("codex"),
	},
	{
		name: "aider",
		command: "aider",
		buildArgs: (task) => ["--message", task, "--yes"],
		detect: () => commandExists("aider"),
	},
	{
		name: "gemini",
		command: "gemini",
		buildArgs: (task) => ["--prompt", task],
		detect: () => commandExists("gemini"),
	},
	{
		name: "zai",
		command: "zai",
		buildArgs: (task) => ["run", task],
		detect: () => commandExists("zai"),
	},
];

// ─── PATH Detection ─────────────────────────────────────────────────────

/**
 * Check if a command exists on PATH.
 *
 * Uses `which` on Unix or `where.exe` on Windows. Returns true if the
 * lookup succeeds (exit code 0), false otherwise.
 */
export function commandExists(cmd: string): Promise<boolean> {
	const lookupCmd = platform() === "win32" ? "where.exe" : "which";
	return new Promise((resolve) => {
		execFile(lookupCmd, [cmd], (error) => {
			resolve(!error);
		});
	});
}

// ─── Detection Cache ────────────────────────────────────────────────────

/** Cached detection result — null means not yet probed. */
let _cachedClis: CodingCli[] | null = null;

/**
 * Detect all available coding CLIs on PATH.
 *
 * Probes all known CLIs concurrently and returns those that are
 * available, preserving priority order. Results are cached for
 * the lifetime of the process.
 */
export async function detectCodingClis(): Promise<CodingCli[]> {
	if (_cachedClis !== null) return _cachedClis;

	const results = await Promise.all(
		CODING_CLIS.map(async (cli) => {
			const available = await cli.detect();
			return { cli, available };
		}),
	);

	_cachedClis = results
		.filter((r) => r.available)
		.map((r) => r.cli);

	return _cachedClis;
}

/** Reset the detection cache (useful for testing). */
export function resetDetectionCache(): void {
	_cachedClis = null;
}

// ─── Bridge-First Routing ──────────────────────────────────────────────

/**
 * Route a coding task through the Takumi bridge first.
 *
 * If Takumi is available (RPC or CLI mode), uses structured communication
 * and returns a rich result with filesModified, testsRun, diffSummary.
 * If Takumi is unavailable, falls back to {@link routeCodingTask}.
 *
 * @returns The coding route result, enriched with bridge metadata when available.
 */
export async function routeViaBridge(
	options: BridgeRouteOptions,
): Promise<CodingRouteResult> {
	const identity = resolveCodingExecutionIdentity(options);
	const requestedRouteClass = resolveRequestedEngineRouteClass(options);
	const engineRouteRequested = requiresEngineRoute(options, requestedRouteClass);
	const resolvedEngineRoute = await resolveEngineRoutes(options);
	const engineRoute = resolvedEngineRoute.route;
	if (engineRouteRequested && resolvedEngineRoute.error) {
		return attachCodingRouteCompatibility(identity, {
			cli: "engine-route",
			output: resolvedEngineRoute.error,
			exitCode: 1,
		}, {
			usedRoute: engineRoute ? buildResolvedEngineUsedRoute(engineRoute) : undefined,
			failureKind: "route-incompatible",
		});
	}
	if (engineRouteRequested && !engineRoute) {
		return attachCodingRouteCompatibility(identity, {
			cli: "engine-route",
			output: resolvedEngineRoute.error
				?? "Engine route resolution was requested but could not be completed.",
			exitCode: 1,
		}, {
			failureKind: "route-incompatible",
		});
	}
	if (engineRoute && !isTakumiCompatibleEngineLane(engineRoute)) {
			if (engineRoute.selectedCapabilityId === "tool.coding_agent") {
					const localResult = await routeCodingTask({
						task: options.task,
						cwd: options.cwd,
						taskId: identity.taskId,
						laneId: identity.laneId,
						signal: options.signal,
						onOutput: options.onOutput,
						onProgress: options.onProgress,
					});
				return attachCodingRouteCompatibility(identity, localResult, {
					usedRoute: buildResolvedEngineUsedRoute(engineRoute),
					failureKind: localResult.exitCode === 0 ? null : "runtime-failure",
				});
			}
			const routeLabel = engineRoute.routeClass ?? engineRoute.capability ?? "coding";
			const selected = engineRoute.selectedCapabilityId ?? "none";
			return attachCodingRouteCompatibility(identity, {
				cli: "engine-route",
				output: `Engine route '${routeLabel}' resolved to '${selected}'; the Takumi bridge will not override engine policy.`,
				exitCode: 1,
			}, {
				usedRoute: buildResolvedEngineUsedRoute(engineRoute),
				failureKind: "route-incompatible",
			});
		}

	const bridge = new TakumiBridge({ cwd: options.cwd });
	const context = buildTakumiContext(
		options,
		engineRoute ?? undefined,
		resolvedEngineRoute.envelope,
	);

	try {
		const status = await bridge.detect();

		if (status.mode === "unavailable") {
			if (engineRouteRequested && engineRoute && engineRoute.selectedCapabilityId !== "tool.coding_agent") {
				const routeLabel = engineRoute.routeClass ?? engineRoute.capability ?? "coding";
				return attachCodingRouteCompatibility(identity, {
						cli: "engine-route",
						output: `Engine route '${routeLabel}' selected '${engineRoute.selectedCapabilityId ?? "none"}', but the Takumi bridge is unavailable.`,
						exitCode: 1,
					}, {
						usedRoute: buildResolvedEngineUsedRoute(engineRoute),
						failureKind: "executor-unavailable",
					});
				}
			// Fall back to generic CLI routing
				const localResult = await routeCodingTask({
					task: options.task,
					cwd: options.cwd,
					taskId: identity.taskId,
					laneId: identity.laneId,
					signal: options.signal,
					onOutput: options.onOutput,
					onProgress: options.onProgress,
				});
			return attachCodingRouteCompatibility(identity, localResult, {
				failureKind: localResult.exitCode === 0 ? null : "runtime-failure",
			});
		}

		if (context) {
			bridge.injectContext(context);
		}

			const result = await bridge.execute(
			{
				type: "task",
				execution: identity.execution,
				taskId: identity.taskId,
				laneId: identity.laneId,
				task: options.task,
				context,
				},
				(event) => {
					emitBridgeRouteProgress(options, identity, event);
				},
			);
			const compatibilityResult = attachCodingRouteCompatibility(identity, {
				cli: `takumi (${result.modeUsed ?? status.mode})`,
				output: result.output,
				exitCode: result.exitCode,
			}, {
				usedRoute: result.finalReport?.usedRoute,
				failureKind: result.finalReport?.failureKind ?? null,
			});
			const normalizedBridgeResult: TakumiNormalizedResponse = {
				...result,
				execution:
					result.execution
					?? result.finalReport?.execution
					?? (
						result.taskId && result.laneId
							? {
								task: { id: result.taskId },
								lane: { id: result.laneId },
							}
							: compatibilityResult.execution
					),
				taskId: result.taskId ?? compatibilityResult.taskId,
				laneId: result.laneId ?? compatibilityResult.laneId,
				finalReport: result.finalReport ?? compatibilityResult.finalReport,
				artifacts: result.artifacts ?? compatibilityResult.artifacts,
			};

			// I keep this merge so older bridge shims and test doubles cannot weaken
			// the stronger public router contract even if they omit compatibility
			// identity/report fields internally.
			return {
				...compatibilityResult,
				execution: normalizedBridgeResult.execution,
				taskId: normalizedBridgeResult.taskId,
				laneId: normalizedBridgeResult.laneId,
				finalReport: normalizedBridgeResult.finalReport,
				artifacts: normalizedBridgeResult.artifacts,
				bridgeResult: normalizedBridgeResult,
			};
		} finally {
		bridge.dispose();
	}
}

/**
 * Mint one stable compatibility identity for the routed task.
 *
 * I do this at the router boundary so fail-closed and local-lane paths keep
 * the same task/lane correlation instead of letting nested bridge code invent
 * fresh ids later.
 */
function resolveCodingExecutionIdentity(
	options: Pick<BridgeRouteOptions | RouteCodingTaskOptions, "execution" | "taskId" | "laneId">,
): CodingExecutionIdentity {
	const execution = {
		task: {
			id: options.execution?.task.id ?? options.taskId ?? `task-${crypto.randomUUID()}`,
		},
		lane: {
			id: options.execution?.lane.id ?? options.laneId ?? `lane-${crypto.randomUUID()}`,
		},
	};
	return {
		execution,
		taskId: execution.task.id,
		laneId: execution.lane.id,
	};
}

/**
 * Attach compatibility execution identity and a typed final report to any routed
 * coding result, including plain CLI and fail-closed paths.
 */
export function attachCodingRouteCompatibility(
	identity: CodingExecutionIdentity,
	result: Pick<CodingRouteResult, "cli" | "output" | "exitCode">,
	options?: {
		usedRoute?: TakumiFinalReport["usedRoute"];
		failureKind?: TakumiFinalReport["failureKind"];
	},
): CodingRouteResult {
	const summary = summarizeCodingRouteOutput(result.output, result.exitCode);
	const execution = {
		task: { id: identity.taskId },
		lane: { id: identity.laneId },
	};
	const finalReport: TakumiFinalReport = {
		execution,
		taskId: identity.taskId,
		laneId: identity.laneId,
		status: result.exitCode === 0
			? "completed"
			: options?.failureKind === "cancelled"
				? "cancelled"
				: "failed",
		summary,
		usedRoute: options?.usedRoute,
		toolCalls: [],
		validation: undefined,
		artifacts: [],
		error: result.exitCode === 0 ? null : summary,
		failureKind: result.exitCode === 0 ? null : options?.failureKind ?? "runtime-failure",
	};
	return {
		...result,
		execution: identity.execution,
		taskId: identity.taskId,
		laneId: identity.laneId,
		finalReport,
		artifacts: [],
		};
}

function emitBridgeRouteProgress(
	options: Pick<BridgeRouteOptions, "onOutput" | "onProgress">,
	identity: CodingExecutionIdentity,
	event: TakumiEvent,
): void {
	options.onOutput?.(event.data);
	options.onProgress?.({
		...event,
		execution:
			event.taskId === identity.taskId && event.laneId === identity.laneId
				? event.execution
				: {
					task: { id: event.taskId },
					lane: { id: event.laneId },
				},
	});
}

function buildResolvedEngineUsedRoute(
	route: ResolvedEngineBridgeRoute,
): TakumiFinalReport["usedRoute"] {
	return {
		routeClass: route.routeClass,
		capability: route.capability ?? null,
		selectedCapabilityId: route.selectedCapabilityId ?? null,
		selectedProviderId: route.executionBinding?.selectedProviderId ?? null,
		selectedModelId: route.executionBinding?.selectedModelId ?? null,
	};
}

function summarizeCodingRouteOutput(output: string, exitCode: number): string {
	const summaryLine = output
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (summaryLine) return summaryLine;
	return exitCode === 0
		? "Coding route completed without textual output."
		: "Coding route failed without textual output.";
}

function buildTakumiContext(
	options: BridgeRouteOptions,
	engineRoute?: ResolvedEngineBridgeRoute,
	engineRouteEnvelope?: ResolvedEngineRouteEnvelope,
): TakumiContext | undefined {
	if (
		!options.context &&
		options.noCache !== true &&
		options.fresh !== true &&
		!engineRoute &&
		!engineRouteEnvelope
	) {
		return undefined;
	}
	const noCache = options.context?.noCache === true || options.noCache === true;
	const fresh = options.context?.fresh === true || options.fresh === true;
	return {
		...(options.context ?? {}),
		...(noCache ? { noCache: true } : {}),
		...(fresh ? { fresh: true } : {}),
		...(engineRoute ? { engineRoute: { ...engineRoute, enforced: true } } : {}),
		...(engineRouteEnvelope ? { engineRouteEnvelope } : {}),
	};
}

// ─── Task Routing ───────────────────────────────────────────────────────

/**
 * Route a coding task to the best available CLI.
 *
 * 1. Detects available CLIs (cached after first call).
 * 2. Picks the highest-priority available CLI.
 * 3. Spawns the CLI process, streaming stdout/stderr to `onOutput`.
 * 4. Returns the CLI name, combined output, and exit code.
 * 5. If no CLI is found, returns a helpful error message.
 */
export async function routeCodingTask(
	options: RouteCodingTaskOptions,
): Promise<CodingRouteResult> {
	const { task, cwd, signal, onOutput, onProgress } = options;
	const identity = resolveCodingExecutionIdentity(options);

	const available = await detectCodingClis();

	if (available.length === 0) {
		const msg =
			"No coding CLI available on PATH.\n" +
			"Install one of: takumi, claude, codex, aider, gemini, zai\n" +
			"  - claude: https://docs.anthropic.com/en/docs/claude-code\n" +
			"  - codex: https://github.com/openai/codex\n" +
			"  - aider: https://aider.chat\n";
		return attachCodingRouteCompatibility(identity, {
			cli: "none",
			output: msg,
			exitCode: 1,
		}, { failureKind: "executor-unavailable" });
	}

	const cli = available[0];
	const args = cli.buildArgs(task, cwd);

	const result = await spawnCli(cli.command, args, cwd, identity, signal, onOutput, onProgress);
	return attachCodingRouteCompatibility(identity, result, {
		failureKind: result.exitCode === 0 ? null : "runtime-failure",
	});
}

/**
 * Spawn a CLI process and collect output.
 *
 * Streams stdout and stderr to the optional `onOutput` callback.
 * Resolves when the process exits.
 */
function spawnCli(
	command: string,
	args: string[],
	cwd: string,
	identity: CodingExecutionIdentity,
	signal?: AbortSignal,
	onOutput?: (chunk: string) => void,
	onProgress?: (event: BridgeRouteProgressEvent) => void,
): Promise<Pick<CodingRouteResult, "cli" | "output" | "exitCode">> {
	return new Promise((resolve) => {
		const chunks: string[] = [];

		const proc = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});

		const collect = (chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			chunks.push(text);
			emitBridgeRouteProgress({ onOutput, onProgress }, identity, {
				execution: identity.execution,
				taskId: identity.taskId,
				laneId: identity.laneId,
				type: "progress",
				data: text,
			});
		};

		proc.stdout?.on("data", collect);
		proc.stderr?.on("data", collect);

		proc.on("error", (err) => {
			const msg = `Failed to spawn ${command}: ${err.message}`;
			chunks.push(msg);
			emitBridgeRouteProgress({ onOutput, onProgress }, identity, {
				execution: identity.execution,
				taskId: identity.taskId,
				laneId: identity.laneId,
				type: "error",
				data: msg,
			});
			resolve({ cli: command, output: chunks.join(""), exitCode: 1 });
		});

		proc.on("close", (code) => {
			resolve({
				cli: command,
				output: chunks.join(""),
				exitCode: code ?? 1,
			});
		});
	});
}
