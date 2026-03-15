/** MCP coding tool: Lucy bridge first, plain CLI fallback when requested. */

import crypto from "node:crypto";
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { routeCodingTask, detectCodingClis } from "./coding-router.js";
import { executeLucy } from "./lucy-bridge.js";
import type { LucyBridgeConfig, LucyResult } from "./lucy-bridge.js";
import type { TakumiArtifact, TakumiExecutionObject, TakumiFinalReport } from "./takumi-bridge-types.js";
import { leaveAkashaTrace } from "../nervous-system-wiring.js";
import { allowLocalRuntimeFallback } from "../runtime-daemon-proxies.js";
import { type LucyPlanPreview, collectLucyPlanPreview, buildPlanSteps } from "./mcp-tools-coding-plan.js";

/** Valid coding agent execution modes. */
type CodingAgentMode = "full" | "plan-only" | "cli";

interface CodingAgentToolOptions {
	sessionIdResolver?: () => string | undefined;
	consumer?: string;
}

/** Create the `coding_agent` tool for one project root. */
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
						execution: {
							type: "object",
							description:
								"Preferred engine-owned execution object. Top-level taskId/laneId remain compatibility aliases.",
							properties: {
								task: {
									type: "object",
									properties: {
										id: { type: "string", description: "Canonical engine task id." },
									},
									required: ["id"],
								},
								lane: {
									type: "object",
									properties: {
										id: { type: "string", description: "Canonical engine lane id." },
									},
									required: ["id"],
								},
							},
							required: ["task", "lane"],
						},
						taskId: {
							type: "string",
							description:
								"Optional canonical task identity when the caller already owns one.",
						},
						laneId: {
							type: "string",
							description:
								"Optional canonical lane identity when the caller already owns one.",
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
			const execution = normalizeTakumiExecutionObject(args.execution);
			const taskId = typeof args.taskId === "string" && args.taskId.trim()
				? args.taskId.trim()
				: execution?.task.id;
			const laneId = typeof args.laneId === "string" && args.laneId.trim()
				? args.laneId.trim()
				: execution?.lane.id;
			const stableExecution = execution ?? buildExecutionObject(taskId, laneId);
			const stableTaskId = stableExecution.task.id;
			const stableLaneId = stableExecution.lane.id;

			try {
				if (mode === "cli") {
					return await executeCliMode(task, projectPath, {
						execution: stableExecution,
						taskId: stableTaskId,
						laneId: stableLaneId,
					});
				}
					if (mode === "plan-only") {
						return await executePlanOnlyMode(task, projectPath, noCache, {
							execution: stableExecution,
							taskId: stableTaskId,
							laneId: stableLaneId,
							sessionId,
							consumer,
							routeClass,
							capability,
						});
					}
				return await executeLucyMode(task, projectPath, mode, noCache, {
					sessionId,
					consumer,
					routeClass,
					capability,
					execution: stableExecution,
					taskId: stableTaskId,
					laneId: stableLaneId,
				});
			} catch (err) {
				return buildCodingAgentErrorResult(
					err instanceof Error ? err.message : String(err),
					mode,
					noCache,
					stableExecution,
				);
			}
		},
	};
}

async function executePlanOnlyMode(
	task: string,
	projectPath: string,
	noCache: boolean,
	routing: {
		execution: TakumiExecutionObject;
		taskId: string;
		laneId: string;
		sessionId?: string;
		consumer?: string;
		routeClass?: string;
		capability?: string;
	},
): Promise<McpToolResult> {
	const [config, clis] = await Promise.all([
		buildLucyConfig(projectPath, noCache, routing),
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
			execution: routing.execution,
			taskId: routing.taskId,
			laneId: routing.laneId,
			artifacts: [] satisfies TakumiArtifact[],
			availableClis,
			contextPreview: {
				transcendenceHit: context.transcendenceHit?.entity ?? null,
				episodicHints: context.episodicHints.length,
				akashaTraces: context.akashaTraces.length,
			},
		},
	};
}

/** Execute through Lucy with engine routing and post-run recording. */
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
		execution?: TakumiExecutionObject;
		taskId?: string;
		laneId?: string;
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
		execution?: TakumiExecutionObject;
		taskId?: string;
		laneId?: string;
	} = {},
): Promise<LucyBridgeConfig> {
	const config: LucyBridgeConfig = {
		projectPath,
		execution: routing.execution,
		taskId: routing.taskId,
		laneId: routing.laneId,
		noCache,
		maxAutoFixAttempts: 2,
		autoFixThreshold: 0.7,
		sessionId: routing.sessionId,
		consumer: routing.consumer,
		routeClass: routing.routeClass,
		capability: routing.capability,
	};

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
					description:
						`${episode.success ? "Completed" : "Failed"} [${episode.taskId}/${episode.laneId}]: `
						+ `${episode.task.slice(0, 200)}`,
					solution: episode.success
						? `Files: ${episode.filesModified.join(", ")}. Duration: ${episode.durationMs}ms. Execution: ${episode.execution.task.id}/${episode.execution.lane.id}.`
						: `${episode.error?.slice(0, 300) ?? "Unknown error"}. Execution: ${episode.execution.task.id}/${episode.execution.lane.id}.`,
					tags: ["lucy-bridge", episode.success ? "success" : "failure"],
				});
			};
	} catch { /* Episodic optional */ }

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
					metadata: {
						topics: trace.topics,
						taskId: trace.taskId,
						laneId: trace.laneId,
						execution: trace.execution,
					},
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
			execution: result.execution,
			taskId: result.taskId,
			laneId: result.laneId,
			finalReport: result.finalReport,
			artifacts: result.artifacts,
			autoFixAttempts: result.autoFixAttempts,
			durationMs: result.durationMs,
			filesModified: result.filesModified,
			testsRun: result.testsRun,
		},
	};
}

/** Execute via plain CLI routing, preserving engine execution identity. */
async function executeCliMode(
	task: string,
	projectPath: string,
	identity: {
		execution?: TakumiExecutionObject;
		taskId?: string;
		laneId?: string;
	} = {},
): Promise<McpToolResult> {
	const execution = identity.execution ?? buildExecutionObject(identity.taskId, identity.laneId);
	const result = await routeCodingTask({
		task,
		cwd: projectPath,
		execution,
		taskId: execution.task.id,
		laneId: execution.lane.id,
	});

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
			execution,
			taskId: result.taskId,
			laneId: result.laneId,
			finalReport: result.finalReport,
			artifacts: result.artifacts,
		},
	};
}

/** Parse the preferred engine-owned execution object from MCP args. */
function normalizeTakumiExecutionObject(value: unknown): TakumiExecutionObject | undefined {
	const taskId = typeof (value as { task?: { id?: unknown } } | null | undefined)?.task?.id === "string"
		? (value as { task: { id: string } }).task.id.trim()
		: "";
	const laneId = typeof (value as { lane?: { id?: unknown } } | null | undefined)?.lane?.id === "string"
		? (value as { lane: { id: string } }).lane.id.trim()
		: "";
	return taskId && laneId ? { task: { id: taskId }, lane: { id: laneId } } : undefined;
}

/** Mint a compatibility execution object when the caller only supplied aliases. */
function buildExecutionObject(taskId?: string, laneId?: string): TakumiExecutionObject {
	return {
		task: { id: taskId ?? `task-${crypto.randomUUID()}` },
		lane: { id: laneId ?? `lane-${crypto.randomUUID()}` },
	};
}

/**
 * Preserve typed execution/report metadata even when the public tool fails
 * before Lucy or the CLI can return a normal structured result.
 */
function buildCodingAgentErrorResult(
	message: string,
	mode: CodingAgentMode,
	noCache: boolean,
	execution: TakumiExecutionObject,
): McpToolResult {
	const finalReport: TakumiFinalReport = {
		execution,
		taskId: execution.task.id,
		laneId: execution.lane.id,
		status: "failed",
		summary: message,
		usedRoute: undefined,
		toolCalls: [],
		validation: undefined,
		artifacts: [],
		error: message,
		failureKind: "runtime-failure",
	};
	const artifacts: TakumiArtifact[] = [];
	return {
		content: [{
			type: "text",
			text: `coding_agent failed: ${message}`,
		}],
		isError: true,
		_metadata: {
			mode,
			noCache,
			execution,
			taskId: execution.task.id,
			laneId: execution.lane.id,
			finalReport,
			artifacts,
		},
	};
}
