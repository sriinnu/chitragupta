/**
 * Interactive commands — Collective intelligence commands.
 *
 * Handles: /samiti, /sabha, /lokapala, /akasha, /kartavya.
 * These commands display multi-agent communication channels,
 * deliberation protocols, guardian agents, shared knowledge,
 * and auto-execution pipelines.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { renderMiniBar, formatAge } from "./interactive-cmd-registry.js";

/** Handle collective intelligence slash commands. Returns `null` if the command is not recognized. */
export async function handleCollectiveCommand(
	cmd: string,
	_parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { stdout } = ctx;

	switch (cmd) {
		case "/samiti": {
			try {
				const { Samiti } = await import("@chitragupta/sutra");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let samiti: InstanceType<typeof Samiti> | undefined;
				if (agentAny._samiti && agentAny._samiti instanceof Samiti) samiti = agentAny._samiti;
				else if (agentAny.samiti && agentAny.samiti instanceof Samiti) samiti = agentAny.samiti;
				if (!samiti) samiti = new Samiti();

				const samitiStats = samiti.stats();
				const channels = samiti.listChannels();

				stdout.write("\n" + bold("\u0938\u093E\u092E\u0940\u0924\u093F Samiti") + dim(" \u2014 Ambient Communication Channels") + "\n\n");
				stdout.write("  " + bold("Channels:") + " " + cyan(String(samitiStats.channels)) +
					"  " + bold("Messages:") + " " + cyan(String(samitiStats.totalMessages)) +
					"  " + bold("Subscribers:") + " " + cyan(String(samitiStats.subscribers)) + "\n\n");

				if (channels.length === 0) {
					stdout.write(dim("  No channels active.\n"));
				} else {
					for (const ch of channels) {
						const msgCount = ch.messages.length;
						const subCount = ch.subscribers.size;
						const msgColor = msgCount > 0 ? yellow : dim;
						stdout.write(
							`  ${bold(ch.name.padEnd(18))} ` +
							`${msgColor(String(msgCount).padStart(3) + " msgs")}  ` +
							`${dim(String(subCount) + " subs")}  ` +
							`${dim(ch.description.slice(0, 45))}\n`
						);
						for (const msg of ch.messages.slice(-3)) {
							const sevColor = msg.severity === "critical" ? red : msg.severity === "warning" ? yellow : dim;
							const age = formatAge(msg.timestamp);
							stdout.write(
								`    ${sevColor("\u25CF")} ${dim(age + " ago")} ` +
								`${sevColor(`[${msg.severity}]`)} ${msg.content.slice(0, 60)}` +
								`${msg.content.length > 60 ? "..." : ""}\n`
							);
						}
					}
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/sabha": {
			try {
				const { SabhaEngine } = await import("@chitragupta/sutra");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let engine: InstanceType<typeof SabhaEngine> | undefined;
				if (agentAny._sabhaEngine && agentAny._sabhaEngine instanceof SabhaEngine) engine = agentAny._sabhaEngine;
				else if (agentAny.sabhaEngine && agentAny.sabhaEngine instanceof SabhaEngine) engine = agentAny.sabhaEngine;
				if (!engine) engine = new SabhaEngine();

				const active = engine.listActive();

				stdout.write("\n" + bold("\u0938\u092D\u093E Sabha") + dim(" \u2014 Multi-Agent Deliberation Protocol") + "\n\n");
				if (active.length === 0) {
					stdout.write(dim("  No active deliberations. Use Sabha when multi-agent consensus is needed.\n"));
				} else {
					stdout.write("  " + bold("Active Deliberations:") + " " + cyan(String(active.length)) + "\n\n");
					for (const s of active) {
						const statusColor = s.status === "voting" ? yellow
							: s.status === "deliberating" ? cyan
							: s.status === "convened" ? green : dim;
						const roundCount = s.rounds.length;
						const age = formatAge(s.createdAt);
						stdout.write(
							`  ${statusColor("\u25CF")} ${bold(s.topic.slice(0, 50))} ` +
							`${statusColor(`[${s.status}]`)} ` +
							`${dim(`${roundCount} round(s), ${s.participants.length} participants, ${age} ago`)}\n`
						);
						if (roundCount > 0) {
							const latestRound = s.rounds[roundCount - 1];
							const verdictLabel = latestRound.verdict ?? "pending";
							const verdictColor = verdictLabel === "accepted" ? green
								: verdictLabel === "rejected" ? red
								: verdictLabel === "no-consensus" ? yellow : dim;
							stdout.write(
								`    Round ${latestRound.roundNumber}: ` +
								`${dim(`${latestRound.votes.length} vote(s), ${latestRound.challenges.length} challenge(s)`)} ` +
								`${verdictColor(verdictLabel)}\n`
							);
						}
					}
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/lokapala": {
			try {
				const { LokapalaController } = await import("@chitragupta/anina");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let controller: InstanceType<typeof LokapalaController> | undefined;
				if (agentAny._lokapala && agentAny._lokapala instanceof LokapalaController) controller = agentAny._lokapala;
				else if (agentAny.lokapala && agentAny.lokapala instanceof LokapalaController) controller = agentAny.lokapala;

				if (!controller) {
					stdout.write(yellow("\n  Lokapala guardians are not active in this session.\n"));
					stdout.write(dim("  Guardians start automatically when the agent is configured with lokapala.\n\n"));
					return { handled: true };
				}

				const guardianStats = controller.stats();
				const recentFindings = controller.allFindings(15);
				const criticals = controller.criticalFindings();

				stdout.write("\n" + bold("\u0932\u094B\u0915\u092A\u093E\u0932 Lokapala") + dim(" \u2014 Guardian Agents") + "\n\n");
				const domains: Array<{ name: string; label: string; color: (s: string) => string }> = [
					{ name: "security", label: "\u0930\u0915\u094D\u0937\u0915 Rakshaka", color: red },
					{ name: "performance", label: "\u0917\u0924\u093F Gati", color: yellow },
					{ name: "correctness", label: "\u0938\u0924\u094D\u092F Satya", color: cyan },
				];
				for (const d of domains) {
					const s = guardianStats[d.name as keyof typeof guardianStats];
					const critCount = s.findingsBySeverity["critical"] ?? 0;
					const warnCount = s.findingsBySeverity["warning"] ?? 0;
					const infoCount = s.findingsBySeverity["info"] ?? 0;
					const lastScan = s.lastScanAt > 0 ? formatAge(s.lastScanAt) + " ago" : "never";
					stdout.write(
						`  ${d.color(bold(d.label))}\n` +
						`    Scans: ${cyan(String(s.scansCompleted))}  ` +
						`Findings: ${s.findingsTotal > 0 ? yellow(String(s.findingsTotal)) : dim("0")}  ` +
						`${critCount > 0 ? red("C:" + critCount) : dim("C:0")} ` +
						`${warnCount > 0 ? yellow("W:" + warnCount) : dim("W:0")} ` +
						`${dim("I:" + infoCount)}  ` +
						`Last: ${dim(lastScan)}\n`
					);
				}

				if (recentFindings.length > 0) {
					stdout.write("\n  " + bold("Recent Findings:") + "\n");
					for (const f of recentFindings.slice(0, 8)) {
						const sevColor = f.severity === "critical" ? red : f.severity === "warning" ? yellow : dim;
						const age = formatAge(f.timestamp);
						stdout.write(
							`    ${sevColor("\u25CF")} ${sevColor(`[${f.severity}]`)} ` +
							`${bold(f.domain)} ${f.title.slice(0, 45)} ` +
							`${dim(age + " ago")}\n`
						);
					}
				}

				if (criticals.length > 0) {
					stdout.write("\n  " + red(bold(`${criticals.length} critical finding(s) require attention!`)) + "\n");
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/akasha": {
			try {
				const { AkashaField } = await import("@chitragupta/smriti");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let field: InstanceType<typeof AkashaField> | undefined;
				if (agentAny._akasha && agentAny._akasha instanceof AkashaField) field = agentAny._akasha;
				else if (agentAny.akasha && agentAny.akasha instanceof AkashaField) field = agentAny.akasha;
				if (!field) field = new AkashaField();

				const akashaStats = field.stats();
				const strongest = field.strongest(5);

				stdout.write("\n" + bold("\u0906\u0915\u093E\u0936 Akasha") + dim(" \u2014 Shared Knowledge Field (Stigmergy)") + "\n\n");
				stdout.write("  " + bold("Total Traces:") + " " + cyan(String(akashaStats.totalTraces)) +
					"  " + bold("Active:") + " " + cyan(String(akashaStats.activeTraces)) +
					"  " + bold("Avg Strength:") + " " + dim(akashaStats.avgStrength.toFixed(3)) +
					"  " + bold("Reinforcements:") + " " + dim(String(akashaStats.totalReinforcements)) + "\n\n");

				const typeEntries = Object.entries(akashaStats.byType).filter(([, count]) => count > 0);
				if (typeEntries.length > 0) {
					stdout.write("  " + bold("By Type:") + " ");
					stdout.write(typeEntries.map(([type, count]) => {
						const typeColor = type === "warning" ? yellow : type === "solution" ? green : type === "correction" ? red : cyan;
						return typeColor(type) + dim(":" + count);
					}).join("  "));
					stdout.write("\n\n");
				}

				if (strongest.length > 0) {
					stdout.write("  " + bold("Strongest Traces:") + "\n");
					for (const trace of strongest) {
						const strengthBar = renderMiniBar(trace.strength, 0, 1, 12, dim, green);
						const typeColor = trace.traceType === "warning" ? yellow
							: trace.traceType === "solution" ? green
							: trace.traceType === "correction" ? red : cyan;
						const age = formatAge(trace.createdAt);
						stdout.write(
							`    ${strengthBar} ${typeColor(`[${trace.traceType}]`)} ` +
							`${bold(trace.topic.slice(0, 35))} ` +
							`${dim(`str:${trace.strength.toFixed(2)} +${trace.reinforcements}`)} ` +
							`${dim(age + " ago")}\n`
						);
					}
				} else {
					stdout.write(dim("  No traces deposited yet. Agents leave traces as they solve problems.\n"));
				}

				if (akashaStats.strongestTopic) {
					stdout.write("\n  " + bold("Strongest Topic:") + " " + cyan(akashaStats.strongestTopic) + "\n");
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/kartavya": {
			try {
				const { KartavyaEngine } = await import("@chitragupta/niyanta");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let engine: InstanceType<typeof KartavyaEngine> | undefined;
				if (agentAny._kartavya && agentAny._kartavya instanceof KartavyaEngine) engine = agentAny._kartavya;
				else if (agentAny.kartavya && agentAny.kartavya instanceof KartavyaEngine) engine = agentAny.kartavya;
				if (!engine) engine = new KartavyaEngine();

				const kartavyaStats = engine.stats();
				const activeKartavyas = engine.listActive();
				const pendingNiyamas = engine.getPendingNiyamas();

				stdout.write("\n" + bold("\u0915\u0930\u094D\u0924\u0935\u094D\u092F Kartavya") + dim(" \u2014 Auto-Execution Pipeline") + "\n\n");
				stdout.write("  " + bold("Total:") + " " + cyan(String(kartavyaStats.total)) +
					"  " + bold("Active:") + " " + green(String(kartavyaStats.active)) +
					"  " + bold("Paused:") + " " + yellow(String(kartavyaStats.paused)) +
					"  " + bold("Pending Niyamas:") + " " + cyan(String(kartavyaStats.proposed)) + "\n");
				const rateColor = kartavyaStats.successRate >= 0.8 ? green : kartavyaStats.successRate >= 0.5 ? yellow : red;
				stdout.write("  " + bold("Success Rate:") + " " + rateColor((kartavyaStats.successRate * 100).toFixed(1) + "%") +
					"  " + bold("Executions/hr:") + " " + dim(String(kartavyaStats.executionsThisHour)) + "\n\n");

				if (pendingNiyamas.length > 0) {
					stdout.write("  " + bold(yellow("Pending Proposals (Niyama):")) + "\n");
					for (const p of pendingNiyamas.slice(0, 5)) {
						const age = formatAge(p.createdAt);
						stdout.write(
							`    ${yellow("\u25CB")} ${bold(p.name)} ` +
							`${dim(`conf:${p.confidence.toFixed(2)} trigger:${p.proposedTrigger.type}`)} ` +
							`${dim(age + " ago")}\n`
						);
					}
					stdout.write("\n");
				}

				if (activeKartavyas.length > 0) {
					stdout.write("  " + bold("Active Duties:") + "\n");
					for (const k of activeKartavyas.slice(0, 8)) {
						const totalExec = k.successCount + k.failureCount;
						const rate = totalExec > 0 ? (k.successCount / totalExec * 100).toFixed(0) : "--";
						const rateCol = totalExec > 0 && k.successCount / totalExec >= 0.8 ? green : yellow;
						const lastExec = k.lastExecuted ? formatAge(k.lastExecuted) + " ago" : "never";
						stdout.write(
							`    ${green("\u25CF")} ${bold(k.name)} ` +
							`${dim(`[${k.trigger.type}]`)} ` +
							`${rateCol(rate + "%")} ` +
							`${dim(`(${totalExec} exec)`)} ` +
							`${dim("last: " + lastExec)}\n`
						);
					}
				} else {
					stdout.write(dim("  No active kartavyas. Promote vasanas through the niyama pipeline.\n"));
				}
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		default:
			return null;
	}
}
