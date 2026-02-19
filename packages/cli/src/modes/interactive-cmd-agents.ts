/**
 * Interactive commands — Agent commands.
 *
 * Handles: /code, /review, /debug, /research, /refactor, /docs.
 * These commands spawn specialized agents (Kartru, Parikshaka, Anveshi,
 * Shodhaka, Parikartru, Lekhaka) for focused tasks.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red, magenta,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";

/** Handle agent slash commands. Returns `null` if the command is not recognized. */
export async function handleAgentCommand(
	cmd: string,
	parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { agent, stdout } = ctx;

	switch (cmd) {
		case "/code": {
			const rest = parts.slice(1).join(" ").trim();
			let codeTask = "";
			let codeMode: "full" | "execute" | "plan-only" = "full";
			let codeBranch: boolean | undefined;
			let codeCommit: boolean | undefined;
			let codeReview: boolean | undefined;

			if (rest) {
				const codeParts = rest.split(/\s+/);
				const taskParts: string[] = [];
				for (const cp of codeParts) {
					if (cp === "--plan") codeMode = "plan-only";
					else if (cp === "--execute") codeMode = "execute";
					else if (cp === "--no-branch") codeBranch = false;
					else if (cp === "--no-commit") codeCommit = false;
					else if (cp === "--no-review") codeReview = false;
					else taskParts.push(cp);
				}
				codeTask = taskParts.join(" ");
			}

			if (!codeTask) {
				stdout.write(yellow("\n  Usage: /code <task description> [--plan] [--no-branch] [--no-commit] [--no-review]\n"));
				stdout.write(dim("  Runs the full coding pipeline: Plan → Branch → Execute → Validate → Review → Commit\n"));
				stdout.write(dim("  Shows token usage, tool usage, cost breakdown, and timing.\n\n"));
				return { handled: true };
			}

			stdout.write(dim(`\n  ═══ Coding Agent (Kartru) ═══════════════════\n`));
			stdout.write(dim(`  Task: ${codeTask}\n`));
			stdout.write(dim(`  Mode: ${codeMode}\n`));

			try {
				const { setupFromAgent, createCodingOrchestrator } = await import("../coding-setup.js");
				const projectPath = ctx.projectPath ?? process.cwd();
				const setup = await setupFromAgent(agent, projectPath);
				if (!setup) {
					stdout.write(red("  Error: No provider available. Set a provider first.\n\n"));
					return { handled: true };
				}

				const onProgress = (progress: { phase: string; message: string; elapsedMs: number }) => {
					const mark = progress.phase === "error" ? red("✗") : progress.phase === "done" ? green("✓") : yellow("⧖");
					const ms = progress.elapsedMs < 1000 ? `${progress.elapsedMs}ms` : `${(progress.elapsedMs / 1000).toFixed(1)}s`;
					stdout.write(`  ${mark} ${bold(progress.phase.padEnd(12))} ${dim(ms.padStart(8))}\n`);
				};

				const orchestrator = await createCodingOrchestrator({
					setup, projectPath, mode: codeMode,
					modelId: agent.getState().model,
					createBranch: codeBranch, autoCommit: codeCommit, selfReview: codeReview, onProgress,
				});

				stdout.write("\n");
				const result = await orchestrator.run(codeTask);
				const { stats: codeStats } = result;
				const totalCost = codeStats.totalCost;
				const totalToolCalls = codeStats.totalToolCalls;
				const toolCallMap = new Map(Object.entries(codeStats.toolCalls));
				const turns = codeStats.turns;

				stdout.write("\n");
				const status = result.success ? green("✓ Success") : red("✗ Failed");
				stdout.write(`  Status: ${status} | Complexity: ${result.plan?.complexity ?? "unknown"}\n`);

				if (result.plan && result.plan.steps.length > 0) {
					stdout.write(dim("\n  ── Plan ──\n"));
					for (const step of result.plan.steps) {
						const mark = step.completed ? green("✓") : dim("○");
						stdout.write(`  ${step.index}. [${mark}] ${step.description}\n`);
					}
				}

				if (result.filesModified.length > 0 || result.filesCreated.length > 0) {
					stdout.write(dim("\n  ── Files ──\n"));
					if (result.filesModified.length > 0) stdout.write(`  ${yellow("Modified:")} ${result.filesModified.join(", ")}\n`);
					if (result.filesCreated.length > 0) stdout.write(`  ${green("Created:")}  ${result.filesCreated.join(", ")}\n`);
				}

				if (result.git.featureBranch || result.git.commits.length > 0) {
					stdout.write(dim("\n  ── Git ──\n"));
					if (result.git.featureBranch) stdout.write(`  Branch:  ${cyan(result.git.featureBranch)}\n`);
					if (result.git.commits.length > 0) stdout.write(`  Commits: ${dim(result.git.commits.join(", "))}\n`);
				}

				stdout.write(dim("\n  ── Validation ──\n"));
				stdout.write(`  Result: ${result.validationPassed ? green("✓ passed") : red("✗ failed")}\n`);

				if (result.reviewIssues.length > 0) {
					stdout.write(dim("\n  ── Review ──\n"));
					stdout.write(`  ${result.reviewIssues.length} issue(s) found\n`);
					for (const issue of result.reviewIssues.slice(0, 10)) {
						const sev = issue.severity === "error" ? red(issue.severity) : yellow(issue.severity);
						stdout.write(`    ${sev} ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}\n`);
					}
				}

				if (result.diffPreview) {
					stdout.write(dim("\n  ── Diff Preview ──\n"));
					const diffLines = result.diffPreview.split("\n");
					const show = diffLines.length > 30 ? diffLines.slice(0, 30) : diffLines;
					for (const line of show) {
						if (line.startsWith("+") && !line.startsWith("+++")) stdout.write(`  ${green(line)}\n`);
						else if (line.startsWith("-") && !line.startsWith("---")) stdout.write(`  ${red(line)}\n`);
						else if (line.startsWith("@@")) stdout.write(`  ${cyan(line)}\n`);
						else stdout.write(`  ${dim(line)}\n`);
					}
					if (diffLines.length > 30) stdout.write(dim(`  ... (${diffLines.length - 30} more lines)\n`));
				}

				if (totalToolCalls > 0 || totalCost > 0) {
					stdout.write(dim("\n  ══ Tool Usage ═════════════════════════\n"));
					const sorted = [...toolCallMap.entries()].sort((a, b) => b[1] - a[1]);
					for (const [name, count] of sorted) {
						const pct = totalToolCalls > 0 ? ((count / totalToolCalls) * 100).toFixed(1) : "0.0";
						stdout.write(`  ${magenta("▸")} ${dim(name.padEnd(10))}${String(count).padStart(4)} calls  ${dim(`(${pct}%)`.padStart(8))}\n`);
					}
					stdout.write(dim("  ─────────────────────────────────\n"));
					stdout.write(`  ${bold("Total:")}  ${totalToolCalls} calls | ${turns} turns\n`);
				}

				if (totalCost > 0) {
					stdout.write(dim("\n  ══ Cost ══════════════════════════════\n"));
					stdout.write(`  ${yellow(`$${totalCost.toFixed(4)}`)}\n`);
				}

				if (result.phaseTimings && result.phaseTimings.length > 0) {
					stdout.write(dim("\n  ── Phase Timings ──\n"));
					for (const pt of result.phaseTimings) {
						const dur = pt.durationMs < 1000 ? `${pt.durationMs}ms` : `${(pt.durationMs / 1000).toFixed(1)}s`;
						stdout.write(`  ${dim(pt.phase.padEnd(12))} ${dur}\n`);
					}
				}

				if (result.diffStats) {
					stdout.write(`  ${green(`+${result.diffStats.insertions}`)} ${red(`-${result.diffStats.deletions}`)} in ${result.diffStats.filesChanged} file(s)\n`);
				}

				if (result.errors && result.errors.length > 0) {
					stdout.write(dim("\n  ── Errors ──\n"));
					for (const err of result.errors) {
						stdout.write(`  ${red(`[${err.phase}]`)} ${err.message}${err.recoverable ? dim(" (recovered)") : ""}\n`);
					}
				}

				const elapsed = result.elapsedMs < 1000 ? `${result.elapsedMs}ms`
					: result.elapsedMs < 60000 ? `${(result.elapsedMs / 1000).toFixed(1)}s`
					: `${Math.floor(result.elapsedMs / 60000)}m ${((result.elapsedMs % 60000) / 1000).toFixed(0)}s`;
				stdout.write(`\n  ${bold(dim(`⏱ ${elapsed}`))}\n\n`);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/review": {
			const rest = parts.slice(1).join(" ").trim();
			stdout.write(dim("\n  Spawning Parikshaka review agent...\n"));
			try {
				const { ReviewAgent } = await import("@chitragupta/anina");
				const reviewer = new ReviewAgent({ workingDirectory: process.cwd() });
				const result = rest
					? await reviewer.reviewFiles(rest.split(/\s+/))
					: await reviewer.reviewChanges();

				stdout.write("\n");
				stdout.write(`  Review Score: ${cyan(String(result.overallScore) + "/10")}\n`);
				stdout.write(dim(`  Files reviewed: ${result.filesReviewed.join(", ") || "none"}\n`));
				if (result.issues.length > 0) {
					stdout.write(`\n  Issues (${result.issues.length}):\n`);
					for (const issue of result.issues) {
						const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
						const sev = issue.severity.toUpperCase();
						const sevColor = sev === "ERROR" ? red : sev === "WARNING" ? yellow : dim;
						stdout.write(`    ${sevColor(`[${sev}]`)} ${bold(issue.category)}: ${loc} — ${issue.message}\n`);
						if (issue.suggestion) stdout.write(dim(`      → ${issue.suggestion}\n`));
					}
				}
				stdout.write(`\n  ${bold("Summary:")} ${result.summary}\n\n`);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/debug": {
			const rest = parts.slice(1).join(" ").trim();
			if (!rest) {
				stdout.write(yellow("\n  Usage: /debug <error message or bug description>\n"));
				stdout.write(dim("  /debug --test <test command>  (investigate a failing test)\n\n"));
				return { handled: true };
			}
			stdout.write(dim("\n  Spawning Anveshi debug agent...\n"));
			try {
				const { DebugAgent } = await import("@chitragupta/anina");
				const debugger_ = new DebugAgent({ workingDirectory: process.cwd(), autoFix: false });
				const result = rest.startsWith("--test ")
					? await debugger_.investigateTest(rest.slice(7).trim())
					: await debugger_.investigate({ error: rest });

				stdout.write("\n");
				stdout.write(`  ${bold("Root Cause:")} ${result.rootCause}\n`);
				if (result.bugLocation) stdout.write(dim(`  Location: ${result.bugLocation.file}:${result.bugLocation.line}\n`));
				stdout.write(dim(`  Confidence: ${(result.confidence * 100).toFixed(0)}%\n`));
				stdout.write(dim(`  Files investigated: ${result.filesInvestigated.join(", ")}\n`));
				stdout.write(`\n  ${bold("Proposed Fix:")} ${result.proposedFix}\n`);
				if (result.fixApplied) {
					stdout.write(dim(`  Fix applied: yes (validation: ${result.validationPassed ? green("passed") : red("failed")})\n`));
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/research": {
			const rest = parts.slice(1).join(" ").trim();
			if (!rest) {
				stdout.write(yellow("\n  Usage: /research <question about the codebase>\n"));
				stdout.write(dim("  Examples:\n"));
				stdout.write(dim("    /research how does the auth flow work?\n"));
				stdout.write(dim("    /research what patterns does the router use?\n\n"));
				return { handled: true };
			}
			stdout.write(dim("\n  Spawning Shodhaka research agent...\n"));
			try {
				const { ResearchAgent } = await import("@chitragupta/anina");
				const researcher = new ResearchAgent({ workingDirectory: process.cwd() });
				const result = await researcher.research({ question: rest });

				stdout.write("\n  " + result.answer.replace(/\n/g, "\n  ") + "\n");
				if (result.codeReferences.length > 0) {
					stdout.write("\n  " + bold("References:") + "\n");
					for (const ref of result.codeReferences.slice(0, 10)) {
						stdout.write(`    ${cyan(ref.line ? `${ref.file}:${ref.line}` : ref.file)}\n`);
						if (ref.snippet) stdout.write(dim(`      ${ref.snippet.slice(0, 100)}\n`));
					}
				}
				if (result.relatedTopics.length > 0) stdout.write(dim(`\n  Related: ${result.relatedTopics.join(", ")}\n`));
				stdout.write(dim(`  Confidence: ${(result.confidence * 100).toFixed(0)}%\n\n`));
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/refactor": {
			const rest = parts.slice(1).join(" ").trim();
			if (!rest) {
				stdout.write(yellow("\n  Usage: /refactor <what to refactor>\n"));
				stdout.write(dim("  /refactor --plan <what>          (plan only, don't execute)\n"));
				stdout.write(dim("  /refactor --rename <old> <new>   (rename symbol)\n\n"));
				return { handled: true };
			}
			stdout.write(dim("\n  Spawning Parikartru refactor agent...\n"));
			try {
				const { RefactorAgent } = await import("@chitragupta/anina");
				const refactorer = new RefactorAgent({ workingDirectory: process.cwd(), validatePerFile: true });

				if (rest.startsWith("--plan ")) {
					const plan = await refactorer.plan(rest.slice(7).trim());
					stdout.write("\n");
					stdout.write(`  ${bold("Type:")} ${plan.type}\n`);
					stdout.write(`  ${bold("Description:")} ${plan.description}\n`);
					stdout.write(dim(`  Files affected: ${plan.filesAffected.join(", ")}\n`));
					stdout.write(dim(`  Estimated changes: ${plan.estimatedChanges}\n`));
					if (plan.risks.length > 0) stdout.write(yellow(`  Risks: ${plan.risks.join("; ")}\n`));
				} else if (rest.startsWith("--rename ")) {
					const renameParts = rest.slice(9).trim().split(/\s+/);
					if (renameParts.length < 2) {
						stdout.write(yellow("  Usage: /refactor --rename <oldName> <newName>\n\n"));
						return { handled: true };
					}
					const result = await refactorer.rename(renameParts[0], renameParts[1]);
					stdout.write("\n");
					stdout.write(result.success ? green("  Rename completed\n") : red("  Rename failed\n"));
					stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
					stdout.write(dim(`  Validation: ${result.validationPassed ? "passed" : "failed"}\n`));
					if (result.rollbackCommand) stdout.write(dim(`  Rollback: ${result.rollbackCommand}\n`));
				} else {
					const result = await refactorer.execute(rest);
					stdout.write("\n");
					stdout.write(result.success ? green("  Refactoring completed\n") : red("  Refactoring failed\n"));
					stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
					stdout.write(dim(`  Validation: ${result.validationPassed ? "passed" : "failed"}\n`));
					stdout.write(dim(`  Summary: ${result.summary}\n`));
					if (result.rollbackCommand) stdout.write(dim(`  Rollback: ${result.rollbackCommand}\n`));
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/docs": {
			const rest = parts.slice(1).join(" ").trim();
			if (!rest) {
				stdout.write(yellow("\n  Usage: /docs <task>\n"));
				stdout.write(dim("  /docs readme [path]            Generate/update README\n"));
				stdout.write(dim("  /docs jsdoc <file>             Add JSDoc to exported symbols\n"));
				stdout.write(dim("  /docs changelog [ref]          Generate changelog since ref\n"));
				stdout.write(dim("  /docs architecture [path]      Document architecture\n"));
				stdout.write(dim("  /docs <custom task>            Any documentation task\n\n"));
				return { handled: true };
			}
			stdout.write(dim("\n  Spawning Lekhaka docs agent...\n"));
			try {
				const { DocsAgent } = await import("@chitragupta/anina");
				const docsAgent = new DocsAgent({ workingDirectory: process.cwd() });

				let result;
				if (rest.startsWith("readme")) result = await docsAgent.readme(rest.slice(6).trim() || process.cwd());
				else if (rest.startsWith("jsdoc ")) result = await docsAgent.jsdoc(rest.slice(6).trim());
				else if (rest.startsWith("changelog")) result = await docsAgent.changelog(rest.slice(9).trim() || undefined);
				else if (rest.startsWith("architecture")) result = await docsAgent.architecture(rest.slice(12).trim() || process.cwd());
				else result = await docsAgent.write(rest);

				stdout.write("\n");
				if (result.filesModified.length > 0) stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
				if (result.filesCreated.length > 0) stdout.write(dim(`  Created: ${result.filesCreated.join(", ")}\n`));
				stdout.write(dim(`  Words written: ${result.wordCount}\n`));
				stdout.write(dim(`  Summary: ${result.summary}\n\n`));
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		default:
			return null;
	}
}
