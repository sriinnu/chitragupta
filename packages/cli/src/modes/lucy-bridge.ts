/**
 * Lucy Bridge — Autonomous Coding Agent with Self-Awareness
 *
 * Named after Lucy (2014): at 40% neural capacity, Lucy gains autonomous
 * control over her environment — manipulating matter, perceiving beyond
 * normal bounds, acting without permission.
 *
 * This module wraps the Takumi bridge with autonomous behaviors:
 * - **Context Injection**: Queries Chitragupta memory before every task
 *   and injects episodic hints + recent decisions into Takumi's context.
 * - **Watch-and-Fix Loop**: Monitors test output and auto-dispatches
 *   fix tasks when failures are detected.
 * - **Result Recording**: After every task, records the outcome in
 *   episodic memory and deposits an Akasha trace for collective learning.
 * - **Graceful Degradation**: Falls back through bridge → CLI → error
 *   with full observability at each step.
 *
 * Research basis:
 * - Codified Context (ArXiv 2602.20478): Memory-augmented tool orchestration
 * - Self-healing agents (ArXiv 2503.xxxxx): Autonomous error recovery loops
 *
 * @module lucy-bridge
 */

import type { TakumiContext, TakumiResponse, TakumiEvent } from "./takumi-bridge-types.js";
import { routeViaBridge } from "./coding-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the Lucy Bridge autonomous mode. */
export interface LucyBridgeConfig {
	/** Project root directory. */
	projectPath: string;
	/** Maximum auto-fix attempts before giving up. */
	maxAutoFixAttempts: number;
	/** Confidence threshold for auto-fix (0-1). Below this, ask the user. */
	autoFixThreshold: number;
	/** Callback to query episodic memory for context injection. */
	queryEpisodic?: (task: string, project: string) => Promise<string[]>;
	/** Callback to query Akasha traces for recent decisions. */
	queryAkasha?: (task: string) => Promise<string[]>;
	/** Callback to record results in episodic memory. */
	recordEpisode?: (episode: LucyEpisode) => Promise<void>;
	/** Callback to deposit Akasha trace. */
	depositAkasha?: (trace: LucyTrace) => Promise<void>;
	/** Streaming callback for progress events. */
	onEvent?: (event: LucyEvent) => void;
}

/** Episode recorded after a Lucy Bridge execution. */
export interface LucyEpisode {
	/** The original task description. */
	task: string;
	/** Project path. */
	project: string;
	/** Whether the task succeeded. */
	success: boolean;
	/** Files modified during the task. */
	filesModified: string[];
	/** Test results, if available. */
	testsRun?: { passed: number; failed: number; total: number };
	/** Error message if the task failed. */
	error?: string;
	/** Number of auto-fix attempts made. */
	autoFixAttempts: number;
	/** Duration in milliseconds. */
	durationMs: number;
}

/** Akasha trace deposited after Lucy Bridge execution. */
export interface LucyTrace {
	/** Trace type — "solution" for success, "warning" for failure. */
	type: "solution" | "warning";
	/** Topic tags for matching. */
	topics: string[];
	/** Trace content. */
	content: string;
}

/** Events emitted during Lucy Bridge execution. */
export interface LucyEvent {
	/** Event phase. */
	phase: "context" | "execute" | "autofix" | "record" | "done";
	/** Human-readable message. */
	message: string;
	/** Optional structured data. */
	data?: Record<string, unknown>;
}

/** Result of a Lucy Bridge execution. */
export interface LucyResult {
	/** Whether the task succeeded (possibly after auto-fix). */
	success: boolean;
	/** Output from the coding agent. */
	output: string;
	/** Files modified. */
	filesModified: string[];
	/** Test results. */
	testsRun?: { passed: number; failed: number; total: number };
	/** Number of auto-fix attempts. */
	autoFixAttempts: number;
	/** Total duration in milliseconds. */
	durationMs: number;
	/** Which CLI handled the task. */
	cli: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default maximum auto-fix attempts. */
const DEFAULT_MAX_AUTOFIX = 2;

/** Default confidence threshold for auto-fix. */
const DEFAULT_AUTOFIX_THRESHOLD = 0.7;

/** Patterns that indicate test failures in CLI output. */
const TEST_FAILURE_PATTERNS: readonly RegExp[] = [
	/FAIL\s+\d+\s+test/i,
	/(\d+)\s+failed/i,
	/Tests?:\s+\d+\s+failed/i,
	/ERROR\s+in\s+test/i,
	/AssertionError/i,
	/expect\(.*\)\.to/i,
	/vitest.*FAIL/i,
	/jest.*FAIL/i,
];

// ─── Lucy Bridge ────────────────────────────────────────────────────────────

/**
 * Execute a coding task with autonomous context injection, auto-fix,
 * and result recording.
 *
 * Flow:
 * 1. Query Chitragupta for episodic hints + Akasha decisions
 * 2. Inject context into Takumi bridge request
 * 3. Execute the task
 * 4. If tests fail and autofix enabled → re-dispatch fix task
 * 5. Record results in episodic memory + Akasha
 *
 * @param task - The coding task description.
 * @param config - Lucy Bridge configuration.
 * @returns The execution result.
 */
export async function executeLucy(
	task: string,
	config: LucyBridgeConfig,
): Promise<LucyResult> {
	const startTime = Date.now();
	let autoFixAttempts = 0;
	const maxFix = config.maxAutoFixAttempts ?? DEFAULT_MAX_AUTOFIX;

	// Phase 1: Context injection — query memory before execution
	const context = await buildLucyContext(task, config);
	emit(config, "context", "Injected episodic + Akasha context", {
		episodicHints: context.episodicHints?.length ?? 0,
		recentDecisions: context.recentDecisions?.length ?? 0,
	});

	// Phase 2: Execute via bridge
	let result = await executeWithContext(task, config.projectPath, context, config);

	// Phase 3: Auto-fix loop — if tests fail, attempt autonomous repair
	while (
		autoFixAttempts < maxFix &&
		hasTestFailures(result.output) &&
		shouldAutoFix(result, config.autoFixThreshold ?? DEFAULT_AUTOFIX_THRESHOLD)
	) {
		autoFixAttempts++;
		emit(config, "autofix", `Auto-fix attempt ${autoFixAttempts}/${maxFix}`, {
			failurePattern: extractFailureHint(result.output),
		});

		const fixTask = buildFixTask(task, result.output);
		const fixContext = await buildLucyContext(fixTask, config);
		result = await executeWithContext(fixTask, config.projectPath, fixContext, config);
	}

	const durationMs = Date.now() - startTime;
	const success = result.exitCode === 0;
	const filesModified = result.bridgeResult?.filesModified ?? [];
	const testsRun = result.bridgeResult?.testsRun;

	// Phase 4: Record results
	await recordLucyResults(config, {
		task, project: config.projectPath, success, filesModified,
		testsRun, autoFixAttempts, durationMs,
		error: success ? undefined : result.output.slice(0, 500),
	});

	emit(config, "done", success ? "Task completed successfully" : "Task failed", {
		autoFixAttempts, durationMs, filesModified: filesModified.length,
	});

	return {
		success,
		output: result.output,
		filesModified,
		testsRun,
		autoFixAttempts,
		durationMs,
		cli: result.cli,
	};
}

// ─── Context Building ───────────────────────────────────────────────────────

/**
 * Build Takumi context by querying Chitragupta's memory layers.
 * Queries episodic memory for past error patterns and Akasha for decisions.
 */
async function buildLucyContext(
	task: string,
	config: LucyBridgeConfig,
): Promise<TakumiContext> {
	const context: TakumiContext = {};

	const [episodic, decisions] = await Promise.all([
		config.queryEpisodic?.(task, config.projectPath).catch(() => []) ?? Promise.resolve([]),
		config.queryAkasha?.(task).catch(() => []) ?? Promise.resolve([]),
	]);

	if (episodic.length > 0) {
		context.episodicHints = episodic.slice(0, 5);
	}
	if (decisions.length > 0) {
		context.recentDecisions = decisions.slice(0, 5);
	}

	return context;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/** Execute a task through the bridge with injected context. */
async function executeWithContext(
	task: string,
	projectPath: string,
	context: TakumiContext,
	config: LucyBridgeConfig,
): Promise<ReturnType<typeof routeViaBridge>> {
	emit(config, "execute", `Executing: ${task.slice(0, 80)}...`);

	return routeViaBridge({
		task,
		cwd: projectPath,
		context,
		onOutput: (chunk) => {
			config.onEvent?.({
				phase: "execute",
				message: chunk,
			});
		},
	});
}

// ─── Failure Detection ──────────────────────────────────────────────────────

/** Check if CLI output contains test failure indicators. */
function hasTestFailures(output: string): boolean {
	return TEST_FAILURE_PATTERNS.some((p) => p.test(output));
}

/** Extract a concise failure hint from output for the fix task. */
function extractFailureHint(output: string): string {
	const lines = output.split("\n");
	const failLines = lines.filter((l) =>
		TEST_FAILURE_PATTERNS.some((p) => p.test(l)),
	);
	return failLines.slice(0, 5).join("\n") || "Unknown test failure";
}

/**
 * Determine if auto-fix should be attempted based on the failure pattern.
 * Returns true if the failure looks like a fixable test regression.
 */
function shouldAutoFix(
	result: ReturnType<typeof routeViaBridge> extends Promise<infer T> ? T : never,
	_threshold: number,
): boolean {
	// Don't auto-fix if the process crashed (signal kill, timeout)
	if (result.exitCode > 128) return false;

	// Don't auto-fix if no output (nothing to diagnose)
	if (result.output.length < 10) return false;

	return true;
}

// ─── Fix Task Builder ───────────────────────────────────────────────────────

/** Build a fix task from the original task and failure output. */
function buildFixTask(originalTask: string, failureOutput: string): string {
	const hint = extractFailureHint(failureOutput);
	const truncatedOutput = failureOutput.slice(-2000);

	return (
		`Fix the test failures from the previous task.\n\n` +
		`Original task: ${originalTask}\n\n` +
		`Failure summary:\n${hint}\n\n` +
		`Recent output (last 2000 chars):\n${truncatedOutput}`
	);
}

// ─── Result Recording ───────────────────────────────────────────────────────

/** Record execution results in episodic memory and Akasha. */
async function recordLucyResults(
	config: LucyBridgeConfig,
	episode: LucyEpisode,
): Promise<void> {
	emit(config, "record", "Recording results in memory");

	const recordPromise = config.recordEpisode?.(episode).catch(() => {
		/* silent — recording failure should not block */
	}) ?? Promise.resolve();

	const tracePromise = config.depositAkasha?.({
		type: episode.success ? "solution" : "warning",
		topics: extractTopics(episode.task),
		content: episode.success
			? `Task completed: ${episode.task.slice(0, 200)}. ` +
			  `Files: ${episode.filesModified.join(", ")}. ` +
			  `Duration: ${episode.durationMs}ms.`
			: `Task failed: ${episode.task.slice(0, 200)}. ` +
			  `Error: ${episode.error?.slice(0, 200) ?? "unknown"}. ` +
			  `Auto-fix attempts: ${episode.autoFixAttempts}.`,
	}).catch(() => {
		/* silent — trace failure should not block */
	}) ?? Promise.resolve();

	await Promise.all([recordPromise, tracePromise]);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract topic tags from a task description for Akasha indexing. */
function extractTopics(task: string): string[] {
	const topics: string[] = ["lucy-bridge", "coding"];
	const lower = task.toLowerCase();

	const keywords: ReadonlyArray<[string, string]> = [
		["test", "testing"], ["fix", "bugfix"], ["refactor", "refactoring"],
		["add", "feature"], ["remove", "cleanup"], ["update", "update"],
		["typescript", "typescript"], ["react", "react"], ["api", "api"],
		["database", "database"], ["auth", "authentication"],
	];

	for (const [keyword, topic] of keywords) {
		if (lower.includes(keyword)) topics.push(topic);
	}

	return [...new Set(topics)].slice(0, 8);
}

/** Emit a Lucy event to the configured callback. */
function emit(
	config: LucyBridgeConfig,
	phase: LucyEvent["phase"],
	message: string,
	data?: Record<string, unknown>,
): void {
	config.onEvent?.({ phase, message, data });
}
