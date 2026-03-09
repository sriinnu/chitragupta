/**
 * @chitragupta/cli -- `chitragupta run` command.
 *
 * Standalone CLI task runner that makes chitragupta usable as an
 * independent agentic system without Vaayu. Parses a task from CLI args,
 * loads project + memory context, creates a session, runs a multi-turn
 * agent loop with steering support, records turns, and outputs results.
 *
 * Usage:
 *   chitragupta run "fix the login bug"
 *   chitragupta run --resume <id>
 *   chitragupta run --dry-run "refactor the auth module"
 *   chitragupta run --model claude-opus-4-20250918 "add tests"
 *   chitragupta run --project /path/to/project "update docs"
 *   chitragupta run --max-turns 5 "small fix"
 */

import path from "path";

import { loadGlobalSettings, ChitraguptaError } from "@chitragupta/core";
import { SteeringManager } from "@chitragupta/anina";
import type { RunOptions, RunConfig, RunResult } from "./run-types.js";
import type { Session } from "@chitragupta/smriti/types";

import {
	bold,
	green,
	red,
	yellow,
	cyan,
	dim,
	gray,
} from "@chitragupta/ui/ansi";

import {
	buildRunContext,
	loadMemorySnippets,
	loadSessionHistory,
} from "./run-context.js";

import {
	streamSingleTurn,
	renderTurnHeader,
	renderSteeringNotice,
	shouldContinue,
	buildNextMessage,
} from "./run-loop.js";
import {
	openSession as openSessionViaDaemon,
	showSession as showSessionViaDaemon,
} from "../modes/daemon-bridge.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 20;

// ─── Argument Parser ─────────────────────────────────────────────────────────

/**
 * Parse `chitragupta run` arguments into {@link RunOptions}.
 *
 * Supports:
 *   --resume <id>       Resume from a previous session checkpoint
 *   --dry-run           Show plan without executing
 *   --model <model>     Override model
 *   --provider <prov>   Override provider
 *   --project <path>    Override project path
 *   --max-turns <n>     Max agent loop iterations (default: 20)
 *
 * All remaining non-flag arguments are joined as the task description.
 *
 * @param subcommand - First positional arg (may be a flag or task word).
 * @param rest - Remaining arguments after the subcommand.
 * @returns Parsed run options.
 */
export function parseRunArgs(
	subcommand: string | undefined,
	rest: string[],
): RunOptions {
	const args = [subcommand, ...rest].filter(Boolean) as string[];
	const taskParts: string[] = [];
	let resumeId: string | undefined;
	let dryRun = false;
	let model: string | undefined;
	let provider: string | undefined;
	let project: string | undefined;
	let maxTurns: number | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--resume" && i + 1 < args.length) {
			resumeId = args[++i];
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else if ((arg === "--model" || arg === "-m") && i + 1 < args.length) {
			model = args[++i];
		} else if (arg === "--provider" && i + 1 < args.length) {
			provider = args[++i];
		} else if (arg === "--project" && i + 1 < args.length) {
			project = args[++i];
		} else if (arg === "--max-turns" && i + 1 < args.length) {
			maxTurns = parseInt(args[++i], 10) || undefined;
		} else if (!arg.startsWith("-")) {
			taskParts.push(arg);
		}
	}

	return {
		task: taskParts.join(" "),
		resumeId,
		dryRun,
		model,
		provider,
		project,
		maxTurns,
	};
}

// ─── Dry Run ─────────────────────────────────────────────────────────────────

/**
 * Execute a dry-run: show the plan context without calling the LLM.
 */
function executeDryRun(config: RunConfig, context: string): RunResult {
	process.stdout.write("\n" + bold(cyan("  Dry Run Plan")) + "\n\n");
	process.stdout.write(dim("  Task: ") + bold(config.task) + "\n");
	process.stdout.write(dim("  Project: ") + config.projectPath + "\n");
	process.stdout.write(dim("  Model: ") + config.model + "\n");
	process.stdout.write(dim("  Provider: ") + config.provider + "\n");
	process.stdout.write(dim("  Max turns: ") + String(config.maxTurns) + "\n\n");

	process.stdout.write(bold("  Context that would be sent:") + "\n\n");
	const contextLines = context.split("\n");
	for (const line of contextLines) {
		process.stdout.write(gray(`    ${line}`) + "\n");
	}
	process.stdout.write("\n");

	process.stdout.write(
		yellow("  No LLM call made. Use without --dry-run to execute.") + "\n\n",
	);

	return {
		success: true,
		session: {
			id: "dry-run", title: "Dry Run", created: new Date().toISOString(),
			updated: new Date().toISOString(), agent: "chitragupta",
			model: config.model, project: config.projectPath,
			parent: null, branch: null, tags: ["dry-run"],
			totalCost: 0, totalTokens: 0,
		},
		turnsExecuted: 0,
		durationMs: 0,
		totalCost: 0,
		output: "Dry run completed. No LLM calls were made.",
	};
}

// ─── Session Resume ──────────────────────────────────────────────────────────

/**
 * Resume an existing session by loading its state and replaying context.
 *
 * @param sessionId - The session ID to resume.
 * @param projectPath - Project path for session lookup.
 * @returns The loaded session.
 * @throws {ChitraguptaError} If the session cannot be found.
 */
async function resumeSession(sessionId: string, projectPath: string): Promise<Session> {
	try {
		const session = await showSessionViaDaemon(sessionId, projectPath) as unknown as Session;
		process.stdout.write(
			"\n" + green(`  Resuming session: ${bold(session.meta.title)}`) + "\n" +
			dim(`  ID: ${session.meta.id} | Turns: ${session.turns.length}`) + "\n\n",
		);
		return session;
	} catch (err) {
		throw new ChitraguptaError(
			`Cannot resume session "${sessionId}": ${err instanceof Error ? err.message : String(err)}`,
			"SESSION_ERROR",
		);
	}
}

// ─── Multi-Turn Agent Loop ───────────────────────────────────────────────────

/**
 * Run the multi-turn agent loop: send task + context to the API,
 * process responses, check for steering/follow-ups, and iterate.
 *
 * The loop continues until:
 *   - maxTurns is reached
 *   - The assistant produces a final answer (no pending steering)
 *   - The abort signal fires
 *
 * @param config - Resolved run configuration.
 * @param session - The active session to record turns in.
 * @param context - Assembled context string.
 * @returns The run result with stats.
 */
async function runAgentLoop(
	config: RunConfig,
	session: Session,
	context: string,
): Promise<RunResult> {
	const startTime = Date.now();
	const abortController = new AbortController();
	const steering = new SteeringManager();
	let turnsExecuted = 0;
	let lastOutput = "";
	let totalCost = 0;

	// Graceful shutdown handlers
	const shutdown = () => {
		process.stdout.write(yellow("\n  Shutting down gracefully...\n"));
		abortController.abort();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	try {
		const { createChitragupta } = await import("../api.js");
		const instance = await createChitragupta({
			provider: config.provider,
			model: config.model,
			workingDir: config.projectPath,
			sessionId: session.meta.id,
		});

		// Build the initial prompt with context
		let currentMessage = context
			? `${context}\n\n## Task\n${config.task}`
			: config.task;

		// ─── Multi-turn loop ──────────────────────────────────────────
		while (turnsExecuted < config.maxTurns) {
			if (abortController.signal.aborted) break;

			turnsExecuted++;
			renderTurnHeader(turnsExecuted, config.maxTurns);

			// Stream the response for this turn
			const turnResult = await streamSingleTurn(
				instance.stream(currentMessage),
				abortController.signal,
			);

			totalCost += turnResult.cost;
			lastOutput = turnResult.text;

			// Check abort after turn
			if (turnResult.aborted || abortController.signal.aborted) break;

			// Check steering for the next iteration
			const next = steering.getNext();
			if (!shouldContinue(turnResult, next)) break;

			// There is a steering instruction — render and continue
			renderSteeringNotice(next!);
			currentMessage = buildNextMessage(next!);
		}

		process.stdout.write("\n\n");
		await instance.destroy();
		let refreshedMeta = session.meta;
		try {
			const refreshed = await showSessionViaDaemon(session.meta.id, config.projectPath) as unknown as Session;
			refreshedMeta = refreshed.meta;
		} catch {
			// Keep the original session metadata if final refresh fails after a successful run.
		}

		return {
			success: true,
			session: refreshedMeta,
			turnsExecuted,
			durationMs: Date.now() - startTime,
			totalCost,
			output: lastOutput,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isAbort = abortController.signal.aborted;

		return {
			success: false,
			session: session.meta,
			turnsExecuted,
			durationMs: Date.now() - startTime,
			totalCost,
			output: lastOutput,
			error: isAbort ? "Run aborted by user" : message,
		};
	} finally {
		process.removeListener("SIGINT", shutdown);
		process.removeListener("SIGTERM", shutdown);
		steering.clear();
	}
}

// ─── Result Renderer ─────────────────────────────────────────────────────────

/**
 * Render the run result summary to stdout.
 */
function renderResult(result: RunResult): void {
	const statusIcon = result.success ? green("completed") : red("failed");
	const duration = result.durationMs < 1000
		? `${result.durationMs}ms`
		: `${(result.durationMs / 1000).toFixed(1)}s`;

	process.stdout.write(bold("  Run Summary") + "\n");
	process.stdout.write(`  Status: ${statusIcon}\n`);
	process.stdout.write(dim(`  Session: ${result.session.id}\n`));
	process.stdout.write(dim(`  Turns: ${result.turnsExecuted}\n`));
	process.stdout.write(dim(`  Duration: ${duration}\n`));

	if (result.totalCost > 0) {
		process.stdout.write(dim(`  Cost: $${result.totalCost.toFixed(4)}\n`));
	}

	if (result.error) {
		process.stdout.write(red(`  Error: ${result.error}`) + "\n");
	}

	process.stdout.write("\n");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Route `chitragupta run <subcommand>` to the correct handler.
 *
 * This is the main entry point called from cli.ts when the `run`
 * subcommand is detected.
 *
 * @param subcommand - First positional arg after `run`.
 * @param rest - All remaining arguments.
 */
export async function runRunCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	const opts = parseRunArgs(subcommand, rest);

	// Validate: must have a task or a resume ID
	if (!opts.task && !opts.resumeId) {
		process.stderr.write(
			"\n" + red("  Error: Task description or --resume <id> required.") + "\n" +
			gray("  Usage: chitragupta run \"fix the login bug\"") + "\n" +
			gray("         chitragupta run --resume <session-id>") + "\n" +
			gray("         chitragupta run --dry-run \"refactor auth\"") + "\n\n",
		);
		process.exit(1);
	}

	// Resolve configuration
	const settings = loadGlobalSettings();
	const projectPath = path.resolve(opts.project ?? process.cwd());

	const config: RunConfig = {
		task: opts.task || "(resumed session)",
		projectPath,
		model: opts.model ?? settings.defaultModel,
		provider: opts.provider ?? settings.defaultProvider,
		dryRun: opts.dryRun,
		resumeId: opts.resumeId,
		maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
	};

	// Load memory and session context
	const memorySnippets = loadMemorySnippets(config.task);
	const sessionHistory = loadSessionHistory(config.task, projectPath);

	// Build context
	const context = buildRunContext(
		config.projectPath,
		memorySnippets,
		sessionHistory,
	);

	// Dry run mode
	if (config.dryRun) {
		executeDryRun(config, context);
		return;
	}

	// Create or resume session
	let session: Session;
	if (config.resumeId) {
		session = await resumeSession(config.resumeId, projectPath);
	} else {
		const opened = await openSessionViaDaemon({
			project: projectPath,
			agent: "chitragupta",
			model: config.model,
			provider: config.provider,
			title: config.task.slice(0, 80),
			tags: ["run"],
			consumer: "chitragupta",
			surface: "cli",
			channel: "terminal",
			actorId: `run:${process.pid}`,
			sessionReusePolicy: "isolated",
		});
		session = opened.session as unknown as Session;

		process.stdout.write(
			"\n" + green(`  Session created: ${dim(session.meta.id)}`) + "\n",
		);
	}

	// Run the multi-turn agent loop
	const result = await runAgentLoop(config, session, context);
	renderResult(result);

	if (!result.success) {
		process.exit(1);
	}
}
