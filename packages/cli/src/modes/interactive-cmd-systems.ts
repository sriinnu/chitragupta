/**
 * Interactive commands — System commands.
 *
 * Handles: /kala, /workflow.
 * These commands display temporal awareness (Kala Chakra multi-scale
 * relevance decay) and Vayu DAG workflow management.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { renderMiniBar, formatDuration, formatAge } from "./interactive-cmd-registry.js";

/** Handle system slash commands. Returns `null` if the command is not recognized. */
export async function handleSystemCommand(
	cmd: string,
	parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { stdout } = ctx;

	switch (cmd) {
		case "/kala": {
			try {
				const { KalaChakra, TEMPORAL_SCALES } = await import("@chitragupta/smriti");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let kala: InstanceType<typeof KalaChakra> | undefined;
				if (agentAny._kalaChakra && agentAny._kalaChakra instanceof KalaChakra) kala = agentAny._kalaChakra;
				else if (agentAny.kalaChakra && agentAny.kalaChakra instanceof KalaChakra) kala = agentAny.kalaChakra;
				if (!kala) kala = new KalaChakra();

				const decayRates = kala.decayRates;
				const scaleWeights = kala.scaleWeights;

				stdout.write("\n" + bold("\u0915\u093E\u0932 \u091A\u0915\u094D\u0930 Kala Chakra") + dim(" \u2014 Multi-Scale Temporal Awareness") + "\n\n");
				stdout.write("  " + bold("Scale".padEnd(10)) + " " +
					bold("Weight".padEnd(8)) + " " +
					bold("Half-Life".padEnd(12)) + " " +
					bold("Relevance Now".padEnd(14)) + "\n");
				stdout.write("  " + dim("\u2500".repeat(50)) + "\n");

				for (const scale of TEMPORAL_SCALES) {
					const weight = scaleWeights[scale];
					const halfLife = decayRates[scale];
					const halfLifeStr = formatDuration(halfLife);
					const weightBar = renderMiniBar(weight, 0, 0.3, 10, dim, cyan);
					const now = Date.now();
					const dominantNow = kala.dominantScale(0);

					stdout.write(
						`  ${scale === dominantNow ? cyan(bold(scale.padEnd(10))) : dim(scale.padEnd(10))} ` +
						`${weightBar} ${dim(weight.toFixed(2).padStart(5))} ` +
						`${dim(halfLifeStr.padEnd(12))}` + "\n"
					);
				}

				stdout.write("\n  " + bold("Relevance Decay Samples:") + "\n");
				const sampleDistances = [
					{ label: "5 min ago", ms: 300_000 },
					{ label: "1 hour ago", ms: 3_600_000 },
					{ label: "1 day ago", ms: 86_400_000 },
					{ label: "1 week ago", ms: 7 * 86_400_000 },
					{ label: "1 month ago", ms: 30 * 86_400_000 },
					{ label: "1 year ago", ms: 365 * 86_400_000 },
				];

				const now = Date.now();
				for (const sample of sampleDistances) {
					const rel = kala.relevanceScore(now - sample.ms, now);
					const boosted = kala.boostScore(1.0, now - sample.ms, now);
					const relBar = renderMiniBar(rel, 0, 1, 15, red, green);
					const dominant = kala.dominantScale(sample.ms);
					stdout.write(
						`    ${dim(sample.label.padEnd(14))} ${relBar} ${dim(rel.toFixed(3))} ` +
						`${dim("boost:" + boosted.toFixed(3))} ` +
						`${dim("[" + dominant + "]")}\n`
					);
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/workflow": {
			const subCmd = parts[1];

			try {
				if (!subCmd || subCmd === "list") {
					const { listChitraguptaWorkflows, listWorkflows: listSavedWorkflows } = await import("@chitragupta/vayu");
					const builtIn = listChitraguptaWorkflows();
					const saved = listSavedWorkflows();

					stdout.write("\n" + bold("\u0935\u093E\u092F\u0941 Vayu") + dim(" \u2014 DAG Workflows") + "\n\n");
					if (builtIn.length > 0) {
						stdout.write("  " + bold("Built-in Workflows:") + "\n");
						for (const wf of builtIn) {
							stdout.write(`    ${cyan(wf.id.padEnd(18))} ${dim(String(wf.stepCount) + " steps")}  ${wf.description.slice(0, 50)}${wf.description.length > 50 ? "..." : ""}\n`);
						}
						stdout.write("\n");
					}
					if (saved.length > 0) {
						stdout.write("  " + bold("Custom Workflows:") + "\n");
						for (const wf of saved) {
							stdout.write(`    ${cyan(wf.id.padEnd(18))} ${dim(String(wf.steps.length) + " steps")}  ${wf.description.slice(0, 50)}${wf.description.length > 50 ? "..." : ""}\n`);
						}
						stdout.write("\n");
					}
					if (builtIn.length === 0 && saved.length === 0) {
						stdout.write(dim("  No workflows available.\n\n"));
					}
					stdout.write(dim("  /workflow show <name>    ASCII DAG visualization\n"));
					stdout.write(dim("  /workflow run <name>     Execute a workflow\n"));
					stdout.write(dim("  /workflow history        Recent execution history\n\n"));

				} else if (subCmd === "show") {
					const name = parts[2];
					if (!name) {
						stdout.write(yellow("\n  Usage: /workflow show <name>\n\n"));
						return { handled: true };
					}
					const { getChitraguptaWorkflow, loadWorkflow, renderDAG } = await import("@chitragupta/vayu");
					const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
					if (!workflow) {
						stdout.write(red(`\n  Workflow not found: ${name}\n\n`));
						return { handled: true };
					}
					stdout.write("\n");
					for (const line of renderDAG(workflow).split("\n")) stdout.write("  " + line + "\n");
					stdout.write("\n");

				} else if (subCmd === "run") {
					const name = parts[2];
					if (!name) {
						stdout.write(yellow("\n  Usage: /workflow run <name>\n\n"));
						return { handled: true };
					}
					const {
						getChitraguptaWorkflow, loadWorkflow, WorkflowExecutor, renderDAG, saveExecution,
					} = await import("@chitragupta/vayu");
					const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
					if (!workflow) {
						stdout.write(red(`\n  Workflow not found: ${name}\n\n`));
						return { handled: true };
					}
					stdout.write(dim(`\n  Executing workflow: ${bold(workflow.name)}...\n\n`));
					const executor = new WorkflowExecutor();
					const execution = await executor.execute(workflow, (event) => {
						if (event.type === "step:start") {
							const se = event as { stepId: string; stepName: string };
							stdout.write(dim(`    [start] `) + cyan(se.stepName) + "\n");
						} else if (event.type === "step:done") {
							const se = event as { stepId: string; status: string };
							const statusColor = se.status === "completed" ? green : se.status === "failed" ? red : yellow;
							stdout.write(dim(`    [done]  `) + statusColor(se.status) + dim(` (${se.stepId})`) + "\n");
						} else if (event.type === "step:error") {
							const se = event as { stepId: string; error: string };
							stdout.write(dim(`    [error] `) + red(se.error.slice(0, 80)) + "\n");
						} else if (event.type === "step:skip") {
							const se = event as { stepId: string; reason: string };
							stdout.write(dim(`    [skip]  ${se.stepId}: ${se.reason}`) + "\n");
						}
					});
					try { saveExecution(execution); } catch { /* non-fatal */ }
					stdout.write("\n");
					for (const line of renderDAG(workflow, execution).split("\n")) stdout.write("  " + line + "\n");
					stdout.write("\n");

				} else if (subCmd === "history") {
					const { listChitraguptaWorkflows, listWorkflows: listSavedWorkflows, listExecutions } = await import("@chitragupta/vayu");
					const builtInIds = listChitraguptaWorkflows().map((w) => w.id);
					const savedIds = listSavedWorkflows().map((w) => w.id);
					const allIds = new Set([...builtInIds, ...savedIds]);

					interface HistoryEntry {
						executionId: string;
						workflowId: string;
						status: string;
						startTime: number;
						endTime?: number;
					}

					const allExecutions: HistoryEntry[] = [];
					for (const wfId of allIds) {
						const execs = listExecutions(wfId);
						for (const exec of execs) {
							allExecutions.push({
								executionId: exec.executionId, workflowId: exec.workflowId,
								status: exec.status, startTime: exec.startTime, endTime: exec.endTime,
							});
						}
					}
					allExecutions.sort((a, b) => b.startTime - a.startTime);
					const limited = allExecutions.slice(0, 15);

					stdout.write("\n" + bold("Workflow Execution History") + "\n\n");
					if (limited.length === 0) {
						stdout.write(dim("  No executions recorded yet.\n"));
					} else {
						for (const exec of limited) {
							const statusColor = exec.status === "completed" ? green
								: exec.status === "failed" ? red
								: exec.status === "cancelled" ? dim : yellow;
							const durationStr = exec.endTime ? formatDuration(exec.endTime - exec.startTime) : "running...";
							const age = formatAge(exec.startTime);
							stdout.write(
								`  ${statusColor(exec.status.padEnd(10))} ${bold(exec.workflowId.padEnd(18))} ` +
								`${dim(durationStr.padEnd(10))} ${dim(age + " ago")}  ` +
								`${dim(exec.executionId.slice(0, 8))}\n`
							);
						}
					}
					stdout.write("\n");

				} else {
					const name = subCmd;
					const { getChitraguptaWorkflow, loadWorkflow, renderDAG } = await import("@chitragupta/vayu");
					const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
					if (workflow) {
						stdout.write("\n");
						for (const line of renderDAG(workflow).split("\n")) stdout.write("  " + line + "\n");
						stdout.write("\n");
					} else {
						stdout.write(yellow(`\n  Unknown workflow subcommand or name: ${subCmd}\n`));
						stdout.write(dim("  Usage: /workflow [list|show|run|history] [name]\n\n"));
					}
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		default:
			return null;
	}
}
