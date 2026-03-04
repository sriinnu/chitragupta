/**
 * MCP Tools — Coding Agent (Bridge + CLI Router).
 *
 * Factory for the `coding_agent` tool that routes coding tasks through
 * the Takumi bridge (structured results) or falls back to the best
 * available CLI on PATH (takumi, claude, codex, aider, gemini, zai).
 *
 * Supports three modes:
 * - "full" (default): Try Takumi bridge first, fall back to CLI routing.
 * - "plan-only": Bridge only, no execution (future: plan without changes).
 * - "cli": Force CLI routing, skip the bridge entirely.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import {
	routeCodingTask,
	routeViaBridge,
	detectCodingClis,
} from "./coding-router.js";
import type { TakumiResponse } from "./takumi-bridge-types.js";

/** Valid coding agent execution modes. */
type CodingAgentMode = "full" | "plan-only" | "cli";

/**
 * Create the `coding_agent` tool — route a coding task through the Takumi
 * bridge (structured) or the best available CLI on PATH.
 *
 * @param projectPath - The project root directory to use as cwd.
 */
export function createCodingAgentTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to Takumi (structured bridge) or the best " +
				"available coding CLI (claude, codex, aider, gemini). " +
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
							"Execution mode: 'full' (bridge + fallback), 'plan-only', or 'cli' (skip bridge).",
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

			try {
				if (mode === "cli") {
					return executeCliMode(task, projectPath);
				}
				return executeBridgeMode(task, projectPath, mode);
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

// ─── Execution Helpers ─────────────────────────────────────────────────────

/**
 * Execute via bridge-first routing (mode: "full" or "plan-only").
 * Returns structured metadata (filesModified, testsRun, diffSummary).
 */
async function executeBridgeMode(
	task: string,
	projectPath: string,
	mode: CodingAgentMode,
): Promise<McpToolResult> {
	const result = await routeViaBridge({ task, cwd: projectPath });
	const bridgeResult: TakumiResponse | undefined = result.bridgeResult;

	const header = result.exitCode === 0
		? `[${result.cli}] Task completed successfully.`
		: `[${result.cli}] Task exited with code ${result.exitCode}.`;

	const clis = await detectCodingClis();
	const availableNames = clis.map((c) => c.name).join(", ") || "none";

	let text = `${header}\nMode: ${mode}\nAvailable CLIs: ${availableNames}\n\n`;
	text += result.output;

	// Append structured summary if bridge provided it
	if (bridgeResult?.filesModified?.length) {
		text += `\n\nFiles modified: ${bridgeResult.filesModified.join(", ")}`;
	}
	if (bridgeResult?.testsRun) {
		const t = bridgeResult.testsRun;
		text += `\nTests: ${t.passed} passed, ${t.failed} failed, ${t.total} total`;
	}

	const metadata: Record<string, unknown> = {
		cli: result.cli,
		exitCode: result.exitCode,
		availableClis: availableNames,
		mode,
	};

	if (bridgeResult) {
		metadata.filesModified = bridgeResult.filesModified;
		metadata.testsRun = bridgeResult.testsRun;
		metadata.diffSummary = bridgeResult.diffSummary;
	}

	return {
		content: [{ type: "text", text }],
		isError: result.exitCode !== 0,
		_metadata: metadata,
	};
}

/**
 * Execute via plain CLI routing (mode: "cli"), skipping the bridge.
 */
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
