/**
 * @chitragupta/cli — Coding REPL agent helpers.
 *
 * askCodebase(): Read-only codebase exploration via filtered tools.
 * chatResponse(): Non-coding chat with the AI (no tools).
 * Extracted from code-interactive.ts to keep file sizes under 450 LOC.
 */

import {
	dim,
	gray,
	cyan,
	red,
} from "@chitragupta/ui/ansi";
import type { CodingSetup } from "../coding-setup.js";

/**
 * Ask a question about the codebase using read-only tools.
 * The agent can read, grep, find, and ls files but cannot edit or write.
 *
 * @param question - The question to ask about the codebase.
 * @param codingSetup - The coding environment setup.
 * @param projectPath - The project root path.
 * @param model - Optional model override.
 */
export async function askCodebase(
	question: string,
	codingSetup: CodingSetup,
	projectPath: string,
	model?: string,
): Promise<void> {
	const { stdout } = process;
	stdout.write("\n");
	stdout.write(dim("  ── Exploring codebase ──\n\n"));

	try {
		const { KARTRU_PROFILE } = await import("@chitragupta/core");
		const { Agent } = await import("@chitragupta/anina");

		const readOnlyNames = new Set(["read", "grep", "find", "ls", "bash", "diff"]);
		const readOnlyTools = (codingSetup.tools ?? []).filter(
			(t) => readOnlyNames.has(t.definition.name),
		);

		const agent = new Agent({
			profile: { ...KARTRU_PROFILE, id: "code-explorer", name: "Kartru Explorer" },
			providerId: codingSetup.providerId,
			model: model ?? KARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools: readOnlyTools,
			thinkingLevel: "medium",
			workingDirectory: projectPath,
			maxTurns: 8,
			enableChetana: false,
			enableLearning: false,
			enableAutonomy: false,
			onEvent: (event, data) => {
				if (event === "stream:tool_call") {
					const d = data as Record<string, unknown>;
					const name = (d.name as string) ?? "?";
					const icon = name === "read" ? "📖" : name === "grep" ? "🔎" : name === "find" ? "📂" : name === "ls" ? "📁" : "🔧";
					stdout.write(`    ${icon} ${gray(name)}\n`);
				}
			},
		});
		agent.setProvider(codingSetup.provider as import("@chitragupta/swara").ProviderDefinition);

		const response = await agent.prompt(
			`You are a code exploration assistant. Answer this question about the codebase at ${projectPath}:\n\n${question}\n\nUse the available tools to read files, search code, and explore the project structure. Be thorough but concise in your answer.`,
		);
		const text = response.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { type: "text"; text: string }).text)
			.join("\n");

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
 * Uses a lightweight one-shot agent call — no orchestrator, no git, no tools.
 *
 * @param message - The message to send.
 * @param codingSetup - The coding environment setup.
 * @param projectPath - The project root path.
 * @param model - Optional model override.
 */
export async function chatResponse(
	message: string,
	codingSetup: CodingSetup,
	projectPath: string,
	model?: string,
): Promise<void> {
	const { stdout } = process;
	stdout.write("\n");
	stdout.write(dim("  ── Chat ──\n\n"));

	try {
		const { KARTRU_PROFILE } = await import("@chitragupta/core");
		const { Agent } = await import("@chitragupta/anina");

		const agent = new Agent({
			profile: { ...KARTRU_PROFILE, id: "code-chat", name: "Kartru Chat" },
			providerId: codingSetup.providerId,
			model: model ?? KARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools: [],
			thinkingLevel: "low",
			workingDirectory: projectPath,
			maxTurns: 1,
			enableChetana: false,
			enableLearning: false,
			enableAutonomy: false,
		});
		agent.setProvider(codingSetup.provider as import("@chitragupta/swara").ProviderDefinition);

		const response = await agent.prompt(message);
		const text = response.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { type: "text"; text: string }).text)
			.join("\n");

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
