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

import crypto from "node:crypto";
import type {
	BridgeRouteProgressEvent,
	CodingRouteResult,
} from "./coding-router.js";
import type {
	TakumiArtifact,
	TakumiContext,
	TakumiExecutionObject,
	TakumiFinalReport,
	TakumiNormalizedResponse,
} from "./takumi-bridge-types.js";
import { routeViaBridge } from "./coding-router.js";
import {
	normalizeContextForReuse,
	packContextWithFallback,
} from "../context-packing.js";
import {
	buildFixTask,
	extractFailureHint,
	hasTestFailures,
	shouldAutoFix,
} from "./lucy-bridge-fix.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Duck-typed Transcendence engine reference for pre-cached context lookup.
 * Keeps lucy-bridge free of smriti import dependency.
 */
export interface TranscendenceEngineRef {
	/** Fuzzy lookup — returns pre-cached context for the closest matching entity. */
	fuzzyLookup(query: string): { entity: string; content: string; source: string } | null;
}

/** Configuration for the Lucy Bridge autonomous mode. */
export interface LucyBridgeConfig {
	/** Project root directory. */
	projectPath: string;
	/** Preferred engine-owned execution object when the caller already owns one. */
	execution?: TakumiExecutionObject;
	/** Compatibility alias for callers still passing a top-level task id. */
	taskId?: string;
	/** Compatibility alias for callers still passing a top-level lane id. */
	laneId?: string;
	/** When true, bypass predictive caches and favor live reads only. */
	noCache?: boolean;
	/** Alias for `noCache` to make fresh-mode intent explicit at call sites. */
	fresh?: boolean;
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
	/**
	 * Optional Transcendence pre-cache — highest priority context source.
	 * Pre-cached by Transcendence before this task was requested, so it's
	 * more relevant than a just-in-time episodic query.
	 */
	transcendenceEngine?: TranscendenceEngineRef;
	/** Optional async daemon-backed Transcendence query. Preferred over local engine. */
	queryTranscendence?: (task: string, project: string) => Promise<{ entity: string; content: string; source: string } | null>;
	/** Canonical engine session id for route resolution. */
	sessionId?: string;
	/** Consumer identity for engine-owned route resolution. */
	consumer?: string;
	/** Optional engine route class to enforce before Takumi execution. */
	routeClass?: string;
	/** Optional raw capability to enforce before Takumi execution. */
	capability?: string;
}

/** Episode recorded after a Lucy Bridge execution. */
export interface LucyEpisode {
	/** Canonical engine-owned execution object for this Lucy run. */
	execution: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
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
	/** Canonical engine-owned execution object for this Lucy run. */
	execution: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
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
	/**
	 * Optional structured data.
	 *
	 * Lucy now carries `execution`, `taskId`, and `laneId` across every lifecycle
	 * phase so higher layers do not have to reconstruct identity from the final
	 * report after the stream has already been displayed. Execute-phase events may
	 * also include `eventType` to distinguish the initial lifecycle handoff from
	 * streamed bridge progress.
	 */
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
	/** Canonical engine-owned execution object for the Lucy task. */
	execution: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
	/** Typed final report for the final Lucy execution result. */
	finalReport: TakumiFinalReport;
	/** Bridge-synthesized or executor-native artifacts for the final result. */
	artifacts: TakumiArtifact[];
	/** Full routed bridge result for compatibility consumers. */
	bridgeResult?: TakumiNormalizedResponse;
}

type LucyExecutionIdentity = {
	execution: TakumiExecutionObject;
	taskId: string;
	laneId: string;
	sticky: boolean;
};

type LucyEventIdentityData = {
	execution: TakumiExecutionObject;
	taskId: string;
	laneId: string;
};

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default maximum auto-fix attempts. */
const DEFAULT_MAX_AUTOFIX = 2;

/** Default confidence threshold for auto-fix. */
const DEFAULT_AUTOFIX_THRESHOLD = 0.7;

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
	const identity = ensureLucyExecutionIdentity(config);

	// Phase 1: Context injection — query memory before execution
	const context = await buildLucyContext(task, config);
	emit(config, "context", "Injected episodic + Akasha context", {
		...buildLucyEventIdentityData(identity),
		episodicHints: context.episodicHints?.length ?? 0,
		recentDecisions: context.recentDecisions?.length ?? 0,
	});

	// Phase 2: Execute via bridge
	let result = await executeWithContext(task, config.projectPath, context, config, identity);

	// Phase 3: Auto-fix loop — if tests fail, attempt autonomous repair
	while (
		autoFixAttempts < maxFix &&
		hasTestFailures(result.output) &&
		shouldAutoFix(result, config.autoFixThreshold ?? DEFAULT_AUTOFIX_THRESHOLD)
	) {
		autoFixAttempts++;
		emit(config, "autofix", `Auto-fix attempt ${autoFixAttempts}/${maxFix}`, {
			...buildLucyEventIdentityData(identity),
			failurePattern: extractFailureHint(result.output),
		});

		const fixTask = await buildFixTask(task, result.output);
		const fixContext = await buildLucyContext(fixTask, config);
		result = await executeWithContext(fixTask, config.projectPath, fixContext, config, identity);
	}

	const durationMs = Date.now() - startTime;
	const success = result.exitCode === 0;
	const filesModified = result.bridgeResult?.filesModified ?? [];
	const testsRun = result.bridgeResult?.testsRun;

	// Phase 4: Record results
	await recordLucyResults(config, {
		execution: result.execution ?? identity.execution,
		taskId: result.taskId ?? identity.taskId,
		laneId: result.laneId ?? identity.laneId,
		task, project: config.projectPath, success, filesModified,
		testsRun, autoFixAttempts, durationMs,
		error: success ? undefined : result.output.slice(0, 500),
	}, identity);

	emit(config, "done", success ? "Task completed successfully" : "Task failed", {
		...buildLucyEventIdentityData(identity),
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
		execution: result.execution ?? { task: { id: identity.taskId }, lane: { id: identity.laneId } },
		taskId: result.taskId ?? identity.taskId,
		laneId: result.laneId ?? identity.laneId,
		finalReport: result.finalReport,
		artifacts: result.artifacts,
		bridgeResult: result.bridgeResult,
	};
}

// ─── Context Building ───────────────────────────────────────────────────────

/**
 * Build Takumi context by querying Chitragupta's memory layers.
 *
 * Priority order:
 * 1. Transcendence pre-cache — predictively loaded before task was requested
 * 2. Episodic memory — past error patterns and solutions
 * 3. Akasha traces — recent architectural decisions
 */
async function buildLucyContext(
	task: string,
	config: LucyBridgeConfig,
): Promise<TakumiContext> {
	const context: TakumiContext = {};
	const freshMode = isFreshLucyMode(config);

	// Priority 1: Transcendence pre-cached context (highest signal quality)
	const transcendenceHit = freshMode
		? null
		: config.queryTranscendence
			? await config.queryTranscendence(task, config.projectPath).catch(() => null)
			: config.transcendenceEngine?.fuzzyLookup(task) ?? null;

	const [episodic, decisions] = await Promise.all([
		config.queryEpisodic?.(task, config.projectPath).catch(() => []) ?? Promise.resolve([]),
		config.queryAkasha?.(task).catch(() => []) ?? Promise.resolve([]),
	]);

	// Prepend Transcendence hit as the first episodic hint — it was pre-loaded
	const allEpisodic = transcendenceHit
		? [`[Transcendence:${transcendenceHit.source}] ${transcendenceHit.content}`, ...episodic]
		: episodic;

	context.episodicHints = await packLucyContextEntries("episodic hints", allEpisodic);
	context.recentDecisions = await packLucyContextEntries("recent decisions", decisions);

	return context;
}

async function packLucyContextEntries(label: string, entries: string[]): Promise<string[] | undefined> {
	if (entries.length === 0) return undefined;
	const normalized = await Promise.all(entries.map((entry) => normalizeContextForReuse(entry)));
	const trimmed = normalized.map((entry) => entry.trim()).filter(Boolean).slice(0, 5);
	if (trimmed.length === 0) return undefined;
	const joined = trimmed.map((entry) => `- ${entry}`).join("\n");
	const packed = await packContextWithFallback(joined);
	if (!packed) return trimmed;
	return [
		`[PAKT packed ${label} | runtime=${packed.runtime} | savings=${packed.savings}% | original=${packed.originalLength}]\n${packed.packedText}`,
	];
}

// ─── Execution ──────────────────────────────────────────────────────────────

/** Execute a task through the bridge with injected context. */
async function executeWithContext(
	task: string,
	projectPath: string,
	context: TakumiContext,
	config: LucyBridgeConfig,
	identity: LucyExecutionIdentity,
): Promise<CodingRouteResult> {
	emit(config, "execute", `Executing: ${task.slice(0, 80)}...`, {
		...buildLucyEventIdentityData(identity),
		eventType: "start",
	});

	const freshMode = isFreshLucyMode(config);
	const result = await routeViaBridge({
		task,
		cwd: projectPath,
		execution: identity.execution,
		taskId: identity.taskId,
		laneId: identity.laneId,
		context,
		noCache: freshMode,
		fresh: freshMode,
		sessionId: config.sessionId,
		consumer: config.consumer,
		routeClass: config.routeClass,
		capability: config.capability,
		onProgress: (event) => {
			config.onEvent?.({
				phase: "execute",
				message: event.data,
			data: buildLucyExecuteProgressData(event),
		});
			},
		});
	if (!identity.sticky) {
		return result;
	}
	return {
		...result,
		execution: identity.execution,
		taskId: identity.taskId,
		laneId: identity.laneId,
		finalReport: {
			...result.finalReport,
			execution: identity.execution,
			taskId: identity.taskId,
			laneId: identity.laneId,
		},
		artifacts: result.artifacts.map((artifact) => ({
			...artifact,
			execution: identity.execution,
			taskId: identity.taskId,
			laneId: identity.laneId,
		})),
	};
}

/**
 * Mint one stable execution identity for the whole Lucy task.
 *
 * I keep this outside individual bridge attempts so the initial execution and
 * every auto-fix retry stay correlated as one logical engine task.
 */
function ensureLucyExecutionIdentity(
	config: Pick<LucyBridgeConfig, "execution" | "taskId" | "laneId">,
): LucyExecutionIdentity {
	const sticky = Boolean(config.execution || config.taskId || config.laneId);
	const execution = config.execution ?? {
		task: { id: config.taskId ?? `task-${crypto.randomUUID()}` },
		lane: { id: config.laneId ?? `lane-${crypto.randomUUID()}` },
	};
	return {
		execution,
		taskId: execution.task.id,
		laneId: execution.lane.id,
		sticky,
	};
}

// ─── Result Recording ───────────────────────────────────────────────────────

/** Record execution results in episodic memory and Akasha. */
async function recordLucyResults(
	config: LucyBridgeConfig,
	episode: LucyEpisode,
	identity: LucyExecutionIdentity,
): Promise<void> {
	emit(config, "record", "Recording results in memory", buildLucyEventIdentityData(identity));

	const recordPromise = config.recordEpisode?.(episode).catch(() => {
		/* silent — recording failure should not block */
	}) ?? Promise.resolve();

	const tracePromise = config.depositAkasha?.({
		type: episode.success ? "solution" : "warning",
		execution: episode.execution,
		taskId: episode.taskId,
		laneId: episode.laneId,
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

/**
 * Keep one typed execution identity on every Lucy event phase.
 *
 * I use the same shape across context, execute lifecycle, autofix, record, and
 * done events so higher layers can correlate the full autonomous run without
 * reconstructing identity from the terminal result only.
 */
function buildLucyEventIdentityData(
	identity: LucyExecutionIdentity,
): LucyEventIdentityData {
	return {
		execution: identity.execution,
		taskId: identity.taskId,
		laneId: identity.laneId,
	};
}

function buildLucyExecuteProgressData(
	event: BridgeRouteProgressEvent,
): Record<string, unknown> {
	return {
		execution: event.execution,
		taskId: event.taskId,
		laneId: event.laneId,
		eventType: event.type,
	};
}

function isFreshLucyMode(config: Pick<LucyBridgeConfig, "noCache" | "fresh">): boolean {
	return config.noCache === true || config.fresh === true;
}
