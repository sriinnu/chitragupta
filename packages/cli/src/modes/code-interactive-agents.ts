/**
 * @chitragupta/cli — Coding REPL agent helpers.
 *
 * askCodebase(): Read-only codebase exploration via the completion router.
 * chatResponse(): Non-coding chat via the completion router.
 * Extracted from code-interactive.ts to keep file sizes under 450 LOC.
 *
 * These helpers use the completion router directly instead of the
 * old CodingOrchestrator, since they never needed the full orchestration
 * pipeline (git branches, validation, review).
 *
 * @module
 */

import {
	dim,
	gray,
	cyan,
	red,
} from "@chitragupta/ui/ansi";

/** Provider info needed for agent helpers (duck-typed to avoid hard deps). */
export interface AgentProviderInfo {
	providerId: string;
	model?: string;
}

/**
 * Ask a question about the codebase using the completion router.
 *
 * Sends the question with codebase context to the configured provider.
 * No tools, no orchestrator — just a direct LLM call.
 *
 * @param question - The question to ask about the codebase.
 * @param providerInfo - Provider and model configuration.
 * @param projectPath - The project root path.
 */
export async function askCodebase(
	question: string,
	providerInfo: AgentProviderInfo,
	projectPath: string,
): Promise<void> {
	const { stdout } = process;
	stdout.write("\n");
	stdout.write(dim("  -- Exploring codebase --\n\n"));

	try {
		const { CompletionRouter } = await import("@chitragupta/swara");

		const router = new CompletionRouter({ providers: [] });
		const prompt =
			`You are a code exploration assistant for the project at ${projectPath}.\n\n` +
			`Answer this question about the codebase:\n\n${question}\n\n` +
			`Be thorough but concise.`;

		const response = await router.complete({
			messages: [{ role: "user", content: prompt }],
			model: providerInfo.model ?? "claude-sonnet-4-5-20250929",
		});

		const text = typeof response.content === "string"
			? response.content
			: Array.isArray(response.content)
				? (response.content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n")
				: "";

		stdout.write("\n");
		if (text) {
			for (const line of text.split("\n")) {
				stdout.write(`  ${line}\n`);
			}
		} else {
			stdout.write(dim("  (no response)\n"));
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stdout.write(red(`  Exploration error: ${msg}\n`));
	}

	stdout.write("\n");
}

/**
 * Send a non-coding message to the AI and display the response.
 * Uses a direct completion call — no orchestrator, no git, no tools.
 *
 * @param message - The message to send.
 * @param providerInfo - Provider and model configuration.
 * @param projectPath - The project root path.
 */
export async function chatResponse(
	message: string,
	providerInfo: AgentProviderInfo,
	projectPath: string,
): Promise<void> {
	const { stdout } = process;
	stdout.write("\n");
	stdout.write(dim("  -- Chat --\n\n"));

	try {
		const { CompletionRouter } = await import("@chitragupta/swara");

		const router = new CompletionRouter({ providers: [] });
		const response = await router.complete({
			messages: [{ role: "user", content: message }],
			model: providerInfo.model ?? "claude-sonnet-4-5-20250929",
		});

		const text = typeof response.content === "string"
			? response.content
			: Array.isArray(response.content)
				? (response.content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n")
				: "";

		if (text) {
			for (const line of text.split("\n")) {
				stdout.write(`  ${line}\n`);
			}
		} else {
			stdout.write(dim("  (no response)\n"));
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stdout.write(red(`  Chat error: ${msg}\n`));
	}

	stdout.write("\n");
}
