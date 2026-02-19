/**
 * Interactive commands — Introspection & consciousness commands.
 *
 * Handles: /chetana, /vasana, /nidra, /vidhi, /pratyabhijna.
 * These commands display the agent's internal cognitive state,
 * behavioral tendencies, sleep cycle, procedures, and identity.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red, magenta,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { renderMiniBar, renderProgressBar, formatDuration, formatAge } from "./interactive-cmd-registry.js";

/** Handle introspection slash commands. Returns `null` if the command is not recognized. */
export async function handleIntrospectionCommand(
	cmd: string,
	parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { agent, stdout } = ctx;

	switch (cmd) {
		case "/chetana": {
			const chetana = agent.getChetana();
			if (!chetana) {
				stdout.write(yellow("\n  Chetana (consciousness layer) is not enabled.\n"));
				stdout.write(dim("  Enable it with: enableChetana: true in agent config.\n\n"));
				return { handled: true };
			}

			const report = chetana.getCognitiveReport();
			stdout.write("\n" + bold("\u091A\u0947\u0924\u0928\u093E \u2014 Consciousness Report") + "\n\n");

			// Bhava (Affect)
			stdout.write("  " + bold(magenta("\u092D\u093E\u0935 Bhava")) + dim(" \u2014 Affect") + "\n");
			const ecgWidth = 30;
			const valenceBar = renderMiniBar(report.affect.valence, -1, 1, ecgWidth, red, green);
			const arousalBar = renderMiniBar(report.affect.arousal, 0, 1, ecgWidth, dim, yellow);
			const confidBar = renderMiniBar(report.affect.confidence, 0, 1, ecgWidth, red, green);
			const frustBar = renderMiniBar(report.affect.frustration, 0, 1, ecgWidth, green, red);
			stdout.write(`    Valence:     ${valenceBar} ${report.affect.valence >= 0 ? green(report.affect.valence.toFixed(2)) : red(report.affect.valence.toFixed(2))}\n`);
			stdout.write(`    Arousal:     ${arousalBar} ${yellow(report.affect.arousal.toFixed(2))}\n`);
			stdout.write(`    Confidence:  ${confidBar} ${report.affect.confidence >= 0.7 ? green(report.affect.confidence.toFixed(2)) : dim(report.affect.confidence.toFixed(2))}\n`);
			stdout.write(`    Frustration: ${frustBar} ${report.affect.frustration >= 0.7 ? red(report.affect.frustration.toFixed(2)) : dim(report.affect.frustration.toFixed(2))}\n\n`);

			// Dhyana (Attention)
			stdout.write("  " + bold(cyan("\u0927\u094D\u092F\u093E\u0928 Dhyana")) + dim(" \u2014 Attention") + "\n");
			if (report.topConcepts.length > 0) {
				stdout.write("    Focus: ");
				stdout.write(report.topConcepts.slice(0, 5).map((c: { concept: string; weight: number }) => cyan(c.concept) + dim(`(${c.weight.toFixed(1)})`)).join("  "));
				stdout.write("\n");
			}
			if (report.topTools.length > 0) {
				stdout.write("    Tools: ");
				stdout.write(report.topTools.slice(0, 5).map((t: { tool: string; weight: number }) => bold(t.tool) + dim(`(${t.weight.toFixed(1)})`)).join("  "));
				stdout.write("\n");
			}
			if (report.topConcepts.length === 0 && report.topTools.length === 0) {
				stdout.write(dim("    No attention data yet.\n"));
			}
			stdout.write("\n");

			// Atma-Darshana (Self)
			stdout.write("  " + bold(green("\u0906\u0924\u094D\u092E\u0926\u0930\u094D\u0936\u0928 Atma")) + dim(" \u2014 Self-Model") + "\n");
			const cal = report.selfSummary.calibration;
			const calLabel = cal > 1.2 ? red("overconfident") : cal < 0.8 ? yellow("underconfident") : green("calibrated");
			stdout.write(`    Calibration: ${cal.toFixed(2)} (${calLabel})\n`);
			const vel = report.selfSummary.learningVelocity;
			stdout.write(`    Learning:    ${vel > 0 ? green("+" + vel.toFixed(3)) : vel < 0 ? red(vel.toFixed(3)) : dim("0.000")} /turn\n`);
			if (report.selfSummary.topTools.length > 0) {
				stdout.write("    Mastery:     ");
				stdout.write(report.selfSummary.topTools.slice(0, 3).map((t: { tool: string; mastery: { successRate: number } }) =>
					`${t.tool} ${t.mastery.successRate >= 0.8 ? green((t.mastery.successRate * 100).toFixed(0) + "%") : yellow((t.mastery.successRate * 100).toFixed(0) + "%")}`
				).join("  "));
				stdout.write("\n");
			}
			if (report.selfSummary.limitations.length > 0) {
				stdout.write(dim(`    Limits: ${report.selfSummary.limitations.slice(0, 2).join("; ")}\n`));
			}
			stdout.write("\n");

			// Sankalpa (Intentions)
			stdout.write("  " + bold(yellow("\u0938\u0902\u0915\u0932\u094D\u092A Sankalpa")) + dim(" \u2014 Intentions") + "\n");
			const activeGoals = report.intentions.filter((i: { status: string }) => i.status === "active" || i.status === "paused");
			if (activeGoals.length === 0) {
				stdout.write(dim("    No active goals.\n"));
			} else {
				for (const intent of activeGoals.slice(0, 5)) {
					const pct = Math.round(intent.progress * 100);
					const bar = renderProgressBar(intent.progress, 15);
					const statusColor = intent.status === "active" ? green : yellow;
					const prioColor = intent.priority === "critical" ? red : intent.priority === "high" ? yellow : dim;
					stdout.write(`    ${statusColor("\u25CF")} ${bar} ${dim(pct + "%")} ${prioColor(`[${intent.priority}]`)} ${intent.goal.slice(0, 50)}\n`);
					if (intent.staleTurns > 0) stdout.write(dim(`      stale: ${intent.staleTurns} turns\n`));
				}
			}
			const achieved = report.intentions.filter((i: { status: string }) => i.status === "achieved").length;
			if (achieved > 0) stdout.write(dim(`    ${achieved} goal(s) achieved this session\n`));
			stdout.write("\n");
			return { handled: true };
		}

		case "/vasana": {
			const subCmd = parts[1];
			const vasanaArg = parts.slice(2).join(" ").trim();

			try {
				const { VasanaEngine } = await import("@chitragupta/smriti");
				const engine = new VasanaEngine();
				engine.restore();
				const project = ctx.projectPath ?? process.cwd();

				if (subCmd === "inspect" && vasanaArg) {
					const vasanas = engine.getVasanas(project, 200);
					const match = vasanas.find(
						(v: { id: string; tendency: string }) => v.id === vasanaArg || v.tendency === vasanaArg
					);
					if (!match) {
						stdout.write(yellow(`\n  Vasana not found: ${vasanaArg}\n\n`));
					} else {
						stdout.write("\n" + bold("Vasana Detail") + "\n\n");
						stdout.write(`  ${bold("ID:")}          ${dim(match.id)}\n`);
						stdout.write(`  ${bold("Tendency:")}    ${cyan(match.tendency)}\n`);
						stdout.write(`  ${bold("Description:")} ${match.description}\n`);
						const valColor = match.valence === "positive" ? green : match.valence === "negative" ? red : dim;
						stdout.write(`  ${bold("Valence:")}     ${valColor(match.valence)}\n`);
						stdout.write(`  ${bold("Strength:")}    ${renderMiniBar(match.strength, 0, 1, 20, dim, green)} ${match.strength.toFixed(3)}\n`);
						stdout.write(`  ${bold("Stability:")}   ${renderMiniBar(match.stability, 0, 1, 20, red, green)} ${match.stability.toFixed(3)}\n`);
						stdout.write(`  ${bold("Accuracy:")}    ${match.predictiveAccuracy.toFixed(3)}\n`);
						stdout.write(`  ${bold("Reinforced:")}  ${match.reinforcementCount} times\n`);
						stdout.write(`  ${bold("Sources:")}     ${match.sourceSamskaras.length} samskara(s)\n`);
						if (match.lastActivated) stdout.write(`  ${bold("Last active:")} ${new Date(match.lastActivated).toLocaleString()}\n`);
						stdout.write("\n");
					}
				} else {
					const vasanas = engine.getVasanas(project, 15);
					stdout.write("\n" + bold("\u0935\u093E\u0938\u0928\u093E Vasanas") + dim(` \u2014 Crystallized Tendencies (${project.split("/").pop()})`) + "\n\n");
					if (vasanas.length === 0) {
						stdout.write(dim("  No vasanas crystallized yet. Run more sessions to build behavioral patterns.\n"));
					} else {
						for (const v of vasanas) {
							const valIcon = v.valence === "positive" ? green("\u25B2") : v.valence === "negative" ? red("\u25BC") : dim("\u25CF");
							const strengthBar = renderMiniBar(v.strength, 0, 1, 12, dim, green);
							stdout.write(
								`  ${valIcon} ${strengthBar} ${bold(v.tendency)} ` +
								`${dim(`str:${v.strength.toFixed(2)} stab:${v.stability.toFixed(2)}`)} ` +
								`${dim(`[${v.reinforcementCount}x]`)}\n`
							);
						}
					}
					stdout.write("\n");
					stdout.write(dim("  Use /vasana inspect <tendency> for details.\n\n"));
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/nidra": {
			const subCmd = parts[1];
			try {
				const daemonInstance = ctx.nidraDaemon;
				if (!daemonInstance) {
					stdout.write(yellow("\n  Nidra daemon is not running.\n"));
					stdout.write(dim("  The daemon starts automatically with the agent.\n\n"));
					return { handled: true };
				}

				if (subCmd === "wake") {
					daemonInstance.wake();
					stdout.write(green("\n  Nidra daemon forced to LISTENING state.\n\n"));
				} else if (subCmd === "history") {
					const snap = daemonInstance.snapshot();
					stdout.write("\n" + bold("\u0928\u093F\u0926\u094D\u0930\u093E Nidra Consolidation History") + "\n\n");
					if (snap.lastConsolidationStart) {
						stdout.write(`  Last consolidation started: ${new Date(snap.lastConsolidationStart).toLocaleString()}\n`);
					} else {
						stdout.write(dim("  No consolidations have run yet.\n"));
					}
					if (snap.lastConsolidationEnd) {
						const durationMs = snap.lastConsolidationEnd - (snap.lastConsolidationStart ?? snap.lastConsolidationEnd);
						stdout.write(`  Last consolidation ended:   ${new Date(snap.lastConsolidationEnd).toLocaleString()}\n`);
						stdout.write(`  Duration:                   ${(durationMs / 1000).toFixed(1)}s\n`);
					}
					stdout.write("\n");
				} else {
					const snap = daemonInstance.snapshot();
					const stateColor = snap.state === "LISTENING" ? green : snap.state === "DREAMING" ? yellow : cyan;
					stdout.write("\n" + bold("\u0928\u093F\u0926\u094D\u0930\u093E Nidra Daemon") + dim(" \u2014 Sleep Cycle Manager") + "\n\n");
					stdout.write(`  State:      ${stateColor(bold(snap.state))}\n`);
					stdout.write(`  Uptime:     ${formatDuration(snap.uptime)}\n`);
					stdout.write(`  Heartbeat:  ${dim(formatAge(snap.lastHeartbeat) + " ago")}\n`);
					if (snap.state === "DREAMING" && snap.consolidationPhase) {
						const pct = Math.round(snap.consolidationProgress * 100);
						const bar = renderProgressBar(snap.consolidationProgress, 20);
						stdout.write(`  Phase:      ${yellow(snap.consolidationPhase)} ${bar} ${dim(pct + "%")}\n`);
					}
					if (snap.lastConsolidationEnd) stdout.write(`  Last dream: ${dim(formatAge(snap.lastConsolidationEnd) + " ago")}\n`);
					stdout.write("\n");
					stdout.write(dim("  /nidra wake     Force back to LISTENING\n"));
					stdout.write(dim("  /nidra history  Show consolidation log\n\n"));
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/vidhi": {
			const subCmd = parts[1];
			const vidhiArg = parts.slice(2).join(" ").trim();

			try {
				const { VidhiEngine } = await import("@chitragupta/smriti");
				const project = ctx.projectPath ?? process.cwd();
				const engine = new VidhiEngine({ project });

				if ((subCmd === "inspect" || subCmd === "show") && vidhiArg) {
					const vidhis = engine.loadAll(project);
					const match = vidhis.find(
						(v: { id: string; name: string }) => v.name === vidhiArg || v.id === vidhiArg
					);
					if (!match) {
						stdout.write(yellow(`\n  Vidhi not found: ${vidhiArg}\n\n`));
					} else {
						stdout.write("\n" + bold("Vidhi Detail") + "\n\n");
						stdout.write(`  ${bold("ID:")}           ${dim(match.id)}\n`);
						stdout.write(`  ${bold("Name:")}         ${cyan(match.name)}\n`);
						stdout.write(`  ${bold("Confidence:")}   ${match.confidence.toFixed(3)}\n`);
						stdout.write(`  ${bold("Success rate:")} ${(match.successRate * 100).toFixed(1)}% (${match.successCount}/${match.successCount + match.failureCount})\n`);
						stdout.write(`  ${bold("Learned from:")} ${match.learnedFrom.length} session(s)\n`);
						if (match.triggers.length > 0) stdout.write(`  ${bold("Triggers:")}     ${match.triggers.slice(0, 5).join(", ")}\n`);
						stdout.write(`\n  ${bold("Steps:")}\n`);
						for (const step of match.steps) {
							stdout.write(`    ${dim(`${step.index + 1}.`)} ${bold(step.toolName)} ${dim("\u2014")} ${step.description}\n`);
						}
						const paramNames = Object.keys(match.parameterSchema);
						if (paramNames.length > 0) {
							stdout.write(`\n  ${bold("Parameters:")}\n`);
							for (const pName of paramNames.slice(0, 8)) {
								const p = match.parameterSchema[pName] as { type?: string; required?: boolean };
								stdout.write(`    ${cyan(pName)} ${dim(`(${p.type ?? "string"}${p.required ? ", required" : ""})`)}\n`);
							}
						}
						stdout.write("\n");
					}
				} else {
					const vidhis = engine.getVidhis(project, 15);
					stdout.write("\n" + bold("\u0935\u093F\u0927\u093F Vidhi") + dim(` \u2014 Procedural Memory (${project.split("/").pop()})`) + "\n\n");
					if (vidhis.length === 0) {
						stdout.write(dim("  No procedures learned yet. Repeat tool sequences across sessions to discover patterns.\n"));
					} else {
						for (const v of vidhis) {
							const rate = (v.successRate * 100).toFixed(0);
							const rateColor = v.successRate >= 0.8 ? green : v.successRate >= 0.5 ? yellow : red;
							const steps = v.steps.map((s: { toolName: string }) => s.toolName).join(" \u2192 ");
							stdout.write(
								`  ${rateColor(rate + "%")} ${bold(v.name)} ` +
								`${dim(`conf:${v.confidence.toFixed(2)}`)} ` +
								`${dim(steps)}\n`
							);
							if (v.triggers.length > 0) stdout.write(dim(`       triggers: ${v.triggers.slice(0, 3).join(", ")}`) + "\n");
						}
					}
					stdout.write("\n");
					stdout.write(dim("  Use /vidhi inspect <name> for details.\n\n"));
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/pratyabhijna": {
			try {
				const { Pratyabhijna } = await import("@chitragupta/anina");
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const project = ctx.projectPath ?? process.cwd();
				const pratyabhijna = new Pratyabhijna();
				const db = DatabaseManager.instance();
				const prevCtx = pratyabhijna.loadPrevious(project, db);

				stdout.write("\n" + bold("\u092A\u094D\u0930\u0924\u094D\u092F\u092D\u093F\u091C\u094D\u091E\u093E Pratyabhijna") + dim(" \u2014 Self-Recognition") + "\n\n");
				if (!prevCtx) {
					stdout.write(dim("  No identity context available yet.\n"));
					stdout.write(dim("  The agent builds self-recognition after accumulating vasanas and samskaras.\n\n"));
					return { handled: true };
				}

				stdout.write("  " + bold("Identity Narrative:") + "\n");
				for (const line of prevCtx.identitySummary.split("\n")) stdout.write("    " + line + "\n");
				stdout.write("\n");

				const tools = Object.entries(prevCtx.toolMastery).sort(([, a], [, b]) => b - a).slice(0, 5);
				if (tools.length > 0) {
					stdout.write("  " + bold("Tool Mastery:") + "\n");
					for (const [name, rate] of tools) {
						const pct = Math.round(rate * 100);
						const bar = renderMiniBar(rate, 0, 1, 15, red, green);
						stdout.write(`    ${bar} ${bold(name)} ${dim(pct + "%")}\n`);
					}
					stdout.write("\n");
				}

				if (prevCtx.crossProjectInsights.length > 0) {
					stdout.write("  " + bold("Cross-Project Insights:") + "\n");
					for (const insight of prevCtx.crossProjectInsights) stdout.write(`    ${dim("\u2022")} ${insight}\n`);
					stdout.write("\n");
				}

				stdout.write(dim(`  Warmup: ${prevCtx.warmupMs.toFixed(1)}ms  Session: ${prevCtx.sessionId.slice(0, 8)}\n\n`));
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		default:
			return null;
	}
}
