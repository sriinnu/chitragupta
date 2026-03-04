/**
 * MCP Tools — Coding Agent (CLI Router).
 *
 * Factory for the `coding_agent` tool that routes coding tasks to the
 * best available CLI on PATH (takumi, claude, codex, aider, gemini, zai).
 * Replaces the old CodingOrchestrator-based implementation.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { routeCodingTask, detectCodingClis } from "./coding-router.js";

/**
 * Create the `coding_agent` tool — route a coding task to the best
 * available CLI on PATH.
 *
 * @param projectPath - The project root directory to use as cwd.
 */
export function createCodingAgentTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to the best available coding CLI " +
				"(takumi, claude, codex, aider, gemini). " +
				"Detects available tools automatically and routes to the highest-priority one.",
			inputSchema: {
				type: "object",
				properties: {
					task: { type: "string", description: "The coding task to accomplish." },
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

			try {
				const result = await routeCodingTask({ task, cwd: projectPath });

				const clis = await detectCodingClis();
				const availableNames = clis.map((c) => c.name).join(", ") || "none";

				const header = result.exitCode === 0
					? `[${result.cli}] Task completed successfully.`
					: `[${result.cli}] Task exited with code ${result.exitCode}.`;

				const text =
					`${header}\n` +
					`Available CLIs: ${availableNames}\n\n` +
					result.output;

				return {
					content: [{ type: "text", text }],
					isError: result.exitCode !== 0,
					_metadata: {
						cli: result.cli,
						exitCode: result.exitCode,
						availableClis: availableNames,
					},
				};
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
