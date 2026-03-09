/**
 * MCP Tools — Coding Agent (Lucy Bridge + CLI Router).
 *
 * Factory for the `coding_agent` tool that routes coding tasks through
 * the Lucy Bridge (autonomous context injection, auto-fix, episodic
 * recording, Transcendence pre-cache) → Takumi bridge (structured results)
 * → falls back to the best available CLI on PATH.
 *
 * Lucy (2014) at 40% neural capacity: autonomous environmental control,
 * perceiving beyond normal bounds, acting without permission. The bridge
 * injects Chitragupta's memory layers before execution and records
 * outcomes for collective learning.
 *
 * Supports three modes:
 * - "full" (default): Lucy Bridge → Takumi bridge → CLI fallback.
 * - "plan-only": Bridge only, no execution.
 * - "cli": Force CLI routing, skip bridge entirely.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import {
	routeCodingTask,
	detectCodingClis,
} from "./coding-router.js";
import { executeLucy } from "./lucy-bridge.js";
import type { LucyBridgeConfig, LucyResult } from "./lucy-bridge.js";
import { leaveAkashaTrace } from "../nervous-system-wiring.js";
import { allowLocalRuntimeFallback } from "../runtime-daemon-proxies.js";

/** Valid coding agent execution modes. */
type CodingAgentMode = "full" | "plan-only" | "cli";

interface CodingAgentToolOptions {
	sessionIdResolver?: () => string | undefined;
	consumer?: string;
}

/**
 * Create the `coding_agent` tool — route a coding task through Lucy Bridge
 * (context injection + auto-fix + recording) or the best available CLI.
 *
 * @param projectPath - The project root directory to use as cwd.
 */
export function createCodingAgentTool(
	projectPath: string,
	options: CodingAgentToolOptions = {},
): McpToolHandler {
	return {
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to the Lucy autonomous coding agent. " +
				"Injects episodic memory, Akasha traces, and Transcendence pre-cached context " +
				"before execution. Auto-fixes test failures. Records outcomes for future recall. " +
				"Mode 'full' (default) tries Takumi bridge first with structured results. " +
				"Mode 'cli' forces plain CLI routing. " +
				"Mode 'plan-only' returns a plan without executing changes.",
			inputSchema: {
				type: "object",
				properties: {
					task: {
						type: "string",
						description: "The coding task to accomplish.",
					},
					mode: {
						type: "string",
						enum: ["full", "plan-only", "cli"],
						description:
							"Execution mode: 'full' (Lucy + bridge + fallback), 'plan-only', or 'cli' (skip bridge).",
					},
						noCache: {
							type: "boolean",
							description:
								"Bypass predictive context caches and force fresh memory/context reads before execution.",
						},
						sessionId: {
							type: "string",
							description:
								"Canonical Chitragupta session id. When combined with routeClass or capability, the coding path enforces the engine-selected lane.",
						},
						consumer: {
							type: "string",
							description:
								"Consumer identity to use during engine route resolution. Defaults to the MCP coding surface.",
						},
						routeClass: {
							type: "string",
							description:
								"Optional engine route class to enforce before Takumi/CLI execution, for example 'coding.review.strict'.",
						},
						capability: {
							type: "string",
							description:
								"Optional raw engine capability to enforce before Takumi/CLI execution.",
						},
					},
					required: ["task"],
				},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const task = String(args.task ?? "");
			if (!task) {
				return {
					content: [{ type: "text", text: "Error: task is required" }],
					isError: true,
				};
			}

				const mode = (args.mode as CodingAgentMode) ?? "full";
				const noCache = Boolean(args.noCache);
					const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
						? args.sessionId.trim()
						: options.sessionIdResolver?.();
					const consumer = typeof args.consumer === "string" && args.consumer.trim()
						? args.consumer.trim()
						: options.consumer ?? "mcp:coding_agent";
				const routeClass = typeof args.routeClass === "string" && args.routeClass.trim()
					? args.routeClass.trim()
					: undefined;
				const capability = typeof args.capability === "string" && args.capability.trim()
					? args.capability.trim()
					: undefined;

				try {
					if (mode === "cli") {
						return executeCliMode(task, projectPath);
					}
					if (mode === "plan-only") {
						return executePlanOnlyMode(task, projectPath, noCache);
					}
					return executeLucyMode(task, projectPath, mode, noCache, {
						sessionId,
						consumer,
						routeClass,
						capability,
					});
				} catch (err) {
					return {
						content: [{
						type: "text",
						text: `coding_agent failed: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}

interface LucyPlanPreview {
	transcendenceHit: { entity: string; source: string } | null;
	episodicHints: string[];
	akashaTraces: string[];
}

async function executePlanOnlyMode(
	task: string,
	projectPath: string,
	noCache: boolean,
): Promise<McpToolResult> {
	const [config, clis] = await Promise.all([
		buildLucyConfig(projectPath, noCache),
		detectCodingClis(),
	]);
	const context = await collectLucyPlanPreview(task, projectPath, config);
	const availableClis = clis.map((cli) => cli.name);
	const availableNames = availableClis.join(", ") || "none";

	const lines = [
		"Plan-only mode: no commands were executed.",
		`Task: ${task}`,
		`Available CLIs: ${availableNames}`,
		`No-cache: ${noCache ? "yes" : "no"}`,
		"",
		"Suggested plan:",
		...buildPlanSteps(task, context).map((step, index) => `${index + 1}. ${step}`),
	];

	if (context.transcendenceHit) {
		lines.push("", `Predicted context: ${context.transcendenceHit.entity} (${context.transcendenceHit.source})`);
	}
	if (context.episodicHints.length > 0) {
		lines.push("", "Episodic hints:", ...context.episodicHints.slice(0, 3).map((hint) => `- ${hint}`));
	}
	if (context.akashaTraces.length > 0) {
		lines.push("", "Akasha traces:", ...context.akashaTraces.slice(0, 3).map((trace) => `- ${trace}`));
	}

	return {
		content: [{ type: "text", text: lines.join("\n") }],
		isError: false,
		_metadata: {
			mode: "plan-only",
			executed: false,
			noCache,
			availableClis,
			contextPreview: {
				transcendenceHit: context.transcendenceHit?.entity ?? null,
				episodicHints: context.episodicHints.length,
				akashaTraces: context.akashaTraces.length,
			},
		},
	};
}

async function collectLucyPlanPreview(
	task: string,
	projectPath: string,
	config: LucyBridgeConfig,
): Promise<LucyPlanPreview> {
	const transcendenceHit = config.noCache
		? null
		: await (async () => {
			try {
				const hit = config.queryTranscendence
					? await config.queryTranscendence(task, projectPath)
					: config.transcendenceEngine?.fuzzyLookup(task) ?? null;
				return hit ? { entity: hit.entity, source: hit.source } : null;
			} catch {
				return null;
			}
		})();

	const [episodicHints, akashaTraces] = await Promise.all([
		config.queryEpisodic
			? config.queryEpisodic(task, projectPath).catch(() => [])
			: Promise.resolve([] as string[]),
		config.queryAkasha
			? config.queryAkasha(task).catch(() => [])
			: Promise.resolve([] as string[]),
	]);

	return { transcendenceHit, episodicHints, akashaTraces };
}

function buildPlanSteps(
	task: string,
	context: LucyPlanPreview,
): string[] {
	const steps = [
		`Inspect the code paths and tests touched by "${task}".`,
		"Make the minimum safe code changes needed to satisfy the task.",
		"Run focused verification and iterate only on failing paths.",
	];
	if (context.transcendenceHit) {
		steps[0] = `Inspect the code paths around ${context.transcendenceHit.entity} and the tests touched by "${task}".`;
	}
	if (context.akashaTraces.length > 0) {
		steps.splice(1, 0, "Use the existing Akasha guidance to preserve known patterns and avoid regressions.");
	}
	return steps;
}

// ─── Lucy Bridge Mode ────────────────────────────────────────────────────

/**
 * Execute via Lucy Bridge — full autonomous pipeline:
 * 1. Transcendence pre-cache lookup (predictively loaded context)
 * 2. Episodic recall (past similar tasks + error solutions)
 * 3. Akasha traces (recent architectural decisions)
 * 4. Execute through Takumi bridge
 * 5. Auto-fix loop if tests fail
 * 6. Record results in episodic memory + Akasha
 */
async function executeLucyMode(
	task: string,
	projectPath: string,
	mode: CodingAgentMode,
	noCache: boolean,
	routing: {
		sessionId?: string;
		consumer?: string;
		routeClass?: string;
		capability?: string;
	},
): Promise<McpToolResult> {
	const config = await buildLucyConfig(projectPath, noCache, routing);
	const result = await executeLucy(task, config);
	return lucyResultToMcpResult(result, mode, noCache);
}

/** Build the LucyBridgeConfig with live callbacks from MCP subsystems. */
async function buildLucyConfig(
	projectPath: string,
	noCache = false,
	routing: {
		sessionId?: string;
		consumer?: string;
		routeClass?: string;
		capability?: string;
	} = {},
): Promise<LucyBridgeConfig> {
	const config: LucyBridgeConfig = {
		projectPath,
		noCache,
		maxAutoFixAttempts: 2,
		autoFixThreshold: 0.7,
		sessionId: routing.sessionId,
		consumer: routing.consumer,
		routeClass: routing.routeClass,
		capability: routing.capability,
	};

	// Wire Transcendence pre-cache (highest priority context source)
		try {
			const { getLucyLiveContextViaDaemon } = await import("./daemon-bridge.js");
			config.queryTranscendence = async (taskStr: string, _project: string) => {
				const live = await getLucyLiveContextViaDaemon(taskStr, { limit: 1, project: _project });
				return live.hit;
			};
		} catch { /* Daemon-backed Transcendence optional */ }

	if (allowLocalRuntimeFallback()) {
		try {
			const { getTranscendence } = await import("./mcp-subsystems.js");
			const engine = await getTranscendence();
			config.transcendenceEngine = engine as LucyBridgeConfig["transcendenceEngine"];
		} catch { /* Transcendence optional */ }
	}

	// Wire episodic recall callback
	try {
		const { EpisodicMemoryStore } = await import("@chitragupta/smriti/episodic-store");
		config.queryEpisodic = async (taskStr: string, _project: string) => {
			const store = new EpisodicMemoryStore();
			const results = store.search(taskStr, 5);
			return results.map((ep: { description: string; solution?: string | null }) =>
				ep.solution ? `${ep.description} → ${ep.solution}` : ep.description,
			);
		};
		config.recordEpisode = async (episode) => {
			const store = new EpisodicMemoryStore();
			store.record({
				project: episode.project,
				description: `${episode.success ? "Completed" : "Failed"}: ${episode.task.slice(0, 200)}`,
				solution: episode.success
					? `Files: ${episode.filesModified.join(", ")}. Duration: ${episode.durationMs}ms.`
					: episode.error?.slice(0, 300),
				tags: ["lucy-bridge", episode.success ? "success" : "failure"],
			});
		};
	} catch { /* Episodic optional */ }

	// Wire Akasha trace callbacks
	try {
		const { getAkasha, persistAkasha } = await import("./mcp-subsystems.js");
		config.queryAkasha = async (taskStr: string) => {
			const akasha = await getAkasha();
			const results = await Promise.resolve((akasha as unknown as {
				query(q: string, opts?: { limit?: number }): Array<{ content: string }> | Promise<Array<{ content: string }>>;
			}).query(taskStr, { limit: 5 }));
			return results.map((t: { content: string }) => t.content);
		};
		config.depositAkasha = async (trace) => {
			const akasha = await getAkasha();
			const wroteTrace = leaveAkashaTrace(akasha, {
				agentId: "lucy-bridge",
				type: trace.type,
				topic: trace.topics[0] ?? "coding",
				content: trace.content,
				metadata: { topics: trace.topics },
			});
			if (wroteTrace) {
				await persistAkasha();
			}
		};
	} catch { /* Akasha optional */ }

	return config;
}

/** Convert LucyResult to MCP tool result format. */
async function lucyResultToMcpResult(
	result: LucyResult,
	mode: CodingAgentMode,
	noCache: boolean,
): Promise<McpToolResult> {
	const header = result.success
		? `[${result.cli}] Task completed successfully.`
		: `[${result.cli}] Task exited with code (failure).`;

	const clis = await detectCodingClis();
	const availableNames = clis.map((c) => c.name).join(", ") || "none";

	let text = `${header}\nMode: ${mode}\nAvailable CLIs: ${availableNames}\n`;

	if (result.autoFixAttempts > 0) {
		text += `Auto-fix attempts: ${result.autoFixAttempts}\n`;
	}
	text += `No-cache: ${noCache ? "yes" : "no"}\n`;
	text += `Duration: ${result.durationMs}ms\n\n`;
	text += result.output;

	if (result.filesModified.length > 0) {
		text += `\n\nFiles modified: ${result.filesModified.join(", ")}`;
	}
	if (result.testsRun) {
		const t = result.testsRun;
		text += `\nTests: ${t.passed} passed, ${t.failed} failed, ${t.total} total`;
	}

	return {
		content: [{ type: "text", text }],
		isError: !result.success,
		_metadata: {
			cli: result.cli,
			success: result.success,
			availableClis: availableNames,
			mode,
			noCache,
			autoFixAttempts: result.autoFixAttempts,
			durationMs: result.durationMs,
			filesModified: result.filesModified,
			testsRun: result.testsRun,
		},
	};
}

// ─── CLI Mode ──────────────────────────────────────────────────────────────

/** Execute via plain CLI routing (mode: "cli"), skipping the bridge. */
async function executeCliMode(
	task: string,
	projectPath: string,
): Promise<McpToolResult> {
	const result = await routeCodingTask({ task, cwd: projectPath });

	const clis = await detectCodingClis();
	const availableNames = clis.map((c) => c.name).join(", ") || "none";

	const header = result.exitCode === 0
		? `[${result.cli}] Task completed successfully.`
		: `[${result.cli}] Task exited with code ${result.exitCode}.`;

	const text =
		`${header}\nMode: cli\nAvailable CLIs: ${availableNames}\n\n` +
		result.output;

	return {
		content: [{ type: "text", text }],
		isError: result.exitCode !== 0,
		_metadata: {
			cli: result.cli,
			exitCode: result.exitCode,
			availableClis: availableNames,
			mode: "cli",
		},
	};
}
