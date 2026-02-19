/**
 * MCP Tools — Coding Agent.
 *
 * Factory for the `coding_agent` tool that delegates coding tasks to
 * Chitragupta's CodingOrchestrator (Sanyojaka). Plans, codes, validates,
 * reviews, and commits autonomously.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { getSamiti } from "./mcp-subsystems.js";
import { formatOrchestratorResult } from "./mcp-tools-introspection.js";

/**
 * Create the `coding_agent` tool — delegate a coding task to
 * Chitragupta's CodingOrchestrator (Sanyojaka).
 */
export function createCodingAgentTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to Chitragupta's coding agent (Kartru). " +
				"Plans, codes, validates, reviews, and commits autonomously.",
			inputSchema: {
				type: "object",
				properties: {
					task: { type: "string", description: "The coding task to accomplish." },
					mode: { type: "string", enum: ["full", "execute", "plan-only"], description: "Execution mode. Default: full" },
					provider: { type: "string", description: "AI provider ID. Default: from config" },
					model: { type: "string", description: "Model ID. Default: from config" },
					createBranch: { type: "boolean", description: "Create a git feature branch. Default: true" },
					autoCommit: { type: "boolean", description: "Auto-commit on success. Default: true" },
					selfReview: { type: "boolean", description: "Run self-review after coding. Default: true" },
				},
				required: ["task"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const task = String(args.task ?? "");
			if (!task) {
				return { content: [{ type: "text", text: "Error: task is required" }], isError: true };
			}

			try {
				const { setupCodingEnvironment, createCodingOrchestrator } = await import("../coding-setup.js");

				// Share the MCP server's Samiti singleton with the coding agent.
				// The duck-typed SamitiLike is structurally compatible with the concrete Samiti.
				const mcpSamiti = await getSamiti();

				type SetupOpts = Parameters<typeof setupCodingEnvironment>[0];
				const setup = await setupCodingEnvironment({
					projectPath,
					explicitProvider: args.provider ? String(args.provider) : undefined,
					sessionId: "coding-mcp",
					samiti: mcpSamiti as unknown as SetupOpts["samiti"],
				});
				if (!setup) {
					return {
						content: [{ type: "text", text: "Error: No AI provider available. Set an API key or install a CLI (claude, codex, gemini)." }],
						isError: true,
					};
				}

				const progressMessages: string[] = [];
				const onProgress = (progress: { phase: string; message: string }) => {
					progressMessages.push(`[${progress.phase}] ${progress.message}`);
				};

				const orchestrator = await createCodingOrchestrator({
					setup,
					projectPath,
					mode: (args.mode as "full" | "execute" | "plan-only") ?? "full",
					modelId: args.model ? String(args.model) : undefined,
					createBranch: args.createBranch != null ? Boolean(args.createBranch) : undefined,
					autoCommit: args.autoCommit != null ? Boolean(args.autoCommit) : undefined,
					selfReview: args.selfReview != null ? Boolean(args.selfReview) : undefined,
					onProgress,
				});

				const result = await orchestrator.run(task);
				const text = formatOrchestratorResult(result);
				const progressSuffix = progressMessages.length > 0
					? `\n\n── Progress Log ──\n${progressMessages.join("\n")}`
					: "";

				return { content: [{ type: "text", text: text + progressSuffix }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `coding_agent failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
