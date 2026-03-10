/**
 * @chitragupta/cli — Coding CLI Router.
 *
 * Routes coding tasks to the best available CLI tool on PATH.
 * Priority: takumi > claude > codex > aider > gemini > zai
 * Fallback: returns an informative error if no CLI is available.
 *
 * @module
 */

import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { TakumiBridge } from "./takumi-bridge.js";
import type { TakumiContext, TakumiResponse } from "./takumi-bridge-types.js";
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
}

/** Options for {@link routeCodingTask}. */
export interface RouteCodingTaskOptions {
	/** The coding task description / prompt. */
	task: string;
	/** Working directory for the CLI process. */
	cwd: string;
	/** Optional abort signal to cancel a running task. */
	signal?: AbortSignal;
	/** Streaming callback for stdout/stderr chunks. */
	onOutput?: (chunk: string) => void;
}

/** Options for bridge-first routing via {@link routeViaBridge}. */
export interface BridgeRouteOptions {
	/** The coding task description / prompt. */
	task: string;
	/** Working directory. */
	cwd: string;
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
	/** Optional abort signal. */
	signal?: AbortSignal;
}

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
): Promise<CodingRouteResult & { bridgeResult?: TakumiResponse }> {
	const requestedRouteClass = resolveRequestedEngineRouteClass(options);
	const engineRouteRequested = requiresEngineRoute(options, requestedRouteClass);
	const resolvedEngineRoute = await resolveEngineRoutes(options);
	const engineRoute = resolvedEngineRoute.route;
	if (engineRouteRequested && !engineRoute) {
		return {
			cli: "engine-route",
			output: resolvedEngineRoute.error
				?? "Engine route resolution was requested but could not be completed.",
			exitCode: 1,
		};
	}
	if (engineRoute && !isTakumiCompatibleEngineLane(engineRoute)) {
		if (engineRoute.selectedCapabilityId === "tool.coding_agent") {
			return routeCodingTask({
				task: options.task,
				cwd: options.cwd,
				signal: options.signal,
				onOutput: options.onOutput,
			});
		}
		const routeLabel = engineRoute.routeClass ?? engineRoute.capability ?? "coding";
		const selected = engineRoute.selectedCapabilityId ?? "none";
		return {
			cli: "engine-route",
			output: `Engine route '${routeLabel}' resolved to '${selected}'; the Takumi bridge will not override engine policy.`,
			exitCode: 1,
		};
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
				return {
					cli: "engine-route",
					output: `Engine route '${routeLabel}' selected '${engineRoute.selectedCapabilityId ?? "none"}', but the Takumi bridge is unavailable.`,
					exitCode: 1,
				};
			}
			// Fall back to generic CLI routing
			return routeCodingTask({
				task: options.task,
				cwd: options.cwd,
				signal: options.signal,
				onOutput: options.onOutput,
			});
		}

		if (context) {
			bridge.injectContext(context);
		}

		const result = await bridge.execute(
			{ type: "task", task: options.task, context },
			(event) => {
				if (options.onOutput) options.onOutput(event.data);
			},
		);

			return {
				cli: `takumi (${result.modeUsed ?? status.mode})`,
				output: result.output,
				exitCode: result.exitCode,
				bridgeResult: result,
			};
	} finally {
		bridge.dispose();
	}
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
	const { task, cwd, signal, onOutput } = options;

	const available = await detectCodingClis();

	if (available.length === 0) {
		const msg =
			"No coding CLI available on PATH.\n" +
			"Install one of: takumi, claude, codex, aider, gemini, zai\n" +
			"  - claude: https://docs.anthropic.com/en/docs/claude-code\n" +
			"  - codex: https://github.com/openai/codex\n" +
			"  - aider: https://aider.chat\n";
		return { cli: "none", output: msg, exitCode: 1 };
	}

	const cli = available[0];
	const args = cli.buildArgs(task, cwd);

	return spawnCli(cli.command, args, cwd, signal, onOutput);
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
	signal?: AbortSignal,
	onOutput?: (chunk: string) => void,
): Promise<CodingRouteResult> {
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
			if (onOutput) onOutput(text);
		};

		proc.stdout?.on("data", collect);
		proc.stderr?.on("data", collect);

		proc.on("error", (err) => {
			const msg = `Failed to spawn ${command}: ${err.message}`;
			chunks.push(msg);
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
