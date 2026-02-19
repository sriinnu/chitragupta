/**
 * Interactive commands — Meta-reasoning & intelligence commands.
 *
 * Handles: /turiya, /health, /rta, /buddhi.
 * These commands display model routing statistics, system health,
 * invariant rules, and decision-making with Nyaya reasoning.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { renderMiniBar, renderProgressBar, formatAge } from "./interactive-cmd-registry.js";

/** Handle meta-reasoning slash commands. Returns `null` if the command is not recognized. */
export async function handleMetaCommand(
	cmd: string,
	parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { stdout } = ctx;

	switch (cmd) {
		case "/turiya": {
			const turiyaSubCmd = parts[1];
			try {
				const { TuriyaRouter } = await import("@chitragupta/swara");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let router: InstanceType<typeof TuriyaRouter> | undefined;
				if (agentAny._turiyaRouter && agentAny._turiyaRouter instanceof TuriyaRouter) {
					router = agentAny._turiyaRouter;
				} else {
					router = new TuriyaRouter();
				}

				const stats = router.getStats();

				if (turiyaSubCmd === "routing-stats" || turiyaSubCmd === "routing") {
					stdout.write("\n" + bold("\u0924\u0941\u0930\u0940\u092F Turiya") + dim(" \u2014 Routing Statistics") + "\n\n");
					stdout.write("  " + bold("Per-Tier Breakdown:") + "\n");
					for (const tier of stats.tiers) {
						const callPct = stats.totalRequests > 0 ? ((tier.calls / stats.totalRequests) * 100).toFixed(1) : "0.0";
						const rewardColor = tier.averageReward >= 0.7 ? green : tier.averageReward >= 0.4 ? yellow : red;
						const bar = renderMiniBar(tier.averageReward, 0, 1, 15, red, green);
						stdout.write(
							`    ${bold(tier.tier.padEnd(8))} ` +
							`${cyan(String(tier.calls).padStart(4))} calls (${callPct}%)  ` +
							`${bar} ${rewardColor("avg:" + tier.averageReward.toFixed(3))}  ` +
							`${dim("$" + tier.totalCost.toFixed(4))}\n`
						);
					}
					stdout.write("\n  " + bold("Cost Summary:") + "\n");
					stdout.write(`    Actual cost:   ${cyan("$" + stats.totalCost.toFixed(4))}\n`);
					stdout.write(`    Opus baseline: ${dim("$" + stats.opusBaselineCost.toFixed(4))}\n`);
					const savingsColor = stats.savingsPercent >= 50 ? green : stats.savingsPercent >= 20 ? yellow : red;
					stdout.write(`    Savings:       ${savingsColor("$" + stats.costSavings.toFixed(4) + " (" + stats.savingsPercent.toFixed(1) + "%)")}\n\n`);
				} else {
					stdout.write("\n" + bold("\u0924\u0941\u0930\u0940\u092F Turiya") + dim(" \u2014 Meta-Observer & Contextual Model Router") + "\n\n");
					stdout.write("  " + bold("Total Requests:") + " " + cyan(String(stats.totalRequests)) + "\n");
					const activeTiers = stats.tiers.filter((t: { calls: number }) => t.calls > 0);
					if (activeTiers.length > 0) {
						stdout.write("  " + bold("Distribution:") + "\n");
						for (const tier of activeTiers) {
							const pct = stats.totalRequests > 0 ? (tier.calls / stats.totalRequests) : 0;
							const bar = renderProgressBar(pct, 20);
							stdout.write(`    ${tier.tier.padEnd(8)} ${bar} ${dim(String(tier.calls) + " calls")}\n`);
						}
					} else {
						stdout.write(dim("  No requests routed yet.\n"));
					}
					stdout.write("\n");
					const savingsColor = stats.savingsPercent >= 50 ? green : stats.savingsPercent >= 20 ? yellow : dim;
					stdout.write("  " + bold("Cost Savings:") + " " +
						savingsColor(stats.savingsPercent.toFixed(1) + "% vs always-opus") +
						dim(" ($" + stats.costSavings.toFixed(4) + " saved)") + "\n\n");
					stdout.write(dim("  Use /turiya routing-stats for detailed per-tier breakdown.\n\n"));
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/health": {
			try {
				const { Triguna } = await import("@chitragupta/anina");
				const agentAny = ctx.agent as unknown as Record<string, unknown>;
				let triguna: InstanceType<typeof Triguna> | undefined;
				const chetana = agentAny._chetana as Record<string, unknown> | undefined;
				if (chetana?.triguna && chetana.triguna instanceof Triguna) {
					triguna = chetana.triguna;
				}
				if (!triguna) triguna = new Triguna();

				const state = triguna.getState();
				const dominant = triguna.getDominant();
				const trend = triguna.getTrend();

				stdout.write("\n" + bold("\u0924\u094D\u0930\u093F\u0917\u0941\u0923 Triguna") + dim(" \u2014 System Health Monitor") + "\n\n");
				const barWidth = 25;
				const sattvaBar = renderMiniBar(state.sattva, 0, 1, barWidth, dim, green);
				const rajasBar = renderMiniBar(state.rajas, 0, 1, barWidth, dim, yellow);
				const tamasBar = renderMiniBar(state.tamas, 0, 1, barWidth, dim, red);
				const trendArrow = (dir: string) =>
					dir === "rising" ? green("\u2191") : dir === "falling" ? red("\u2193") : dim("\u2192");

				stdout.write(`  ${green("Sattva")}  ${sattvaBar} ${bold((state.sattva * 100).toFixed(1) + "%")} ${trendArrow(trend.sattva)}\n`);
				stdout.write(`  ${yellow("Rajas")}   ${rajasBar} ${bold((state.rajas * 100).toFixed(1) + "%")} ${trendArrow(trend.rajas)}\n`);
				stdout.write(`  ${red("Tamas")}   ${tamasBar} ${bold((state.tamas * 100).toFixed(1) + "%")} ${trendArrow(trend.tamas)}\n\n`);

				const modeColor = dominant === "sattva" ? green : dominant === "rajas" ? yellow : red;
				const modeLabel = dominant === "sattva" ? "Harmonious \u2014 system is healthy and balanced"
					: dominant === "rajas" ? "Hyperactive \u2014 high throughput, elevated stress"
					: "Degraded \u2014 errors or stagnation detected";
				stdout.write("  " + bold("Mode:") + " " + modeColor(dominant) + dim(" \u2014 " + modeLabel) + "\n");

				const trendParts: string[] = [];
				if (trend.sattva !== "stable") trendParts.push(`sattva ${trend.sattva}`);
				if (trend.rajas !== "stable") trendParts.push(`rajas ${trend.rajas}`);
				if (trend.tamas !== "stable") trendParts.push(`tamas ${trend.tamas}`);
				stdout.write("  " + bold("Trend:") + " " + dim(trendParts.length > 0 ? trendParts.join(", ") : "All gunas stable") + "\n\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/rta": {
			const rtaSubCmd = parts[1];
			try {
				const { RtaEngine } = await import("@chitragupta/dharma");
				const rta = new RtaEngine();

				if (rtaSubCmd === "audit") {
					const log = rta.getAuditLog(20);
					stdout.write("\n" + bold("\u090B\u0924 Rta") + dim(" \u2014 Audit Log") + "\n\n");
					if (log.length === 0) {
						stdout.write(dim("  No audit entries yet. Rta checks are recorded when tools are invoked.\n\n"));
					} else {
						for (const entry of log) {
							const status = entry.allowed ? green("ALLOW") : red("BLOCK");
							const age = formatAge(entry.timestamp);
							stdout.write(
								`  ${status} ${bold(entry.ruleId.replace("rta:", ""))} ` +
								`${dim("tool:" + entry.toolName)} ` +
								`${dim(age + " ago")}` +
								(entry.reason ? `\n         ${dim(entry.reason)}` : "") +
								"\n"
							);
						}
						stdout.write("\n");
					}
				} else {
					const rules = rta.getRules();
					const auditLog = rta.getAuditLog();
					stdout.write("\n" + bold("\u090B\u0924 Rta") + dim(" \u2014 Invariant Rules (Cosmic Order)") + "\n\n");
					for (const rule of rules) {
						const violations = auditLog.filter((e: { ruleId: string; allowed: boolean }) => e.ruleId === rule.id && !e.allowed).length;
						const checks = auditLog.filter((e: { ruleId: string }) => e.ruleId === rule.id).length;
						const statusColor = violations > 0 ? yellow : green;
						const statusLabel = violations > 0 ? `${violations} violation${violations > 1 ? "s" : ""}` : "clean";
						stdout.write(
							`  ${bold(rule.id.replace("rta:", "").toUpperCase().padEnd(26))} ` +
							`${statusColor(statusLabel.padEnd(14))} ` +
							`${dim(String(checks) + " checks")}\n`
						);
						stdout.write(`  ${dim(rule.description)}\n\n`);
					}
					stdout.write(dim("  Use /rta audit to see recent audit log entries.\n\n"));
				}
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/buddhi": {
			const buddhiSubCmd = parts[1];
			const buddhiArgs = parts.slice(2);

			try {
				const { Buddhi } = await import("@chitragupta/anina");
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const buddhi = new Buddhi();
				const db = DatabaseManager.instance();
				const project = ctx.projectPath ?? process.cwd();

				if (buddhiSubCmd === "explain" && buddhiArgs.length > 0) {
					const decisionId = buddhiArgs.join(" ");
					const explanation = buddhi.explainDecision(decisionId, db);
					stdout.write("\n" + bold("\u092C\u0941\u0926\u094D\u0927\u093F Buddhi") + dim(" \u2014 Decision Explanation") + "\n\n");

					if (!explanation) {
						stdout.write(red(`  Decision not found: ${decisionId}\n\n`));
					} else {
						const decision = buddhi.getDecision(decisionId, db);
						if (decision) {
							const confPct = Math.round(decision.confidence * 100);
							const confColor = decision.confidence >= 0.8 ? green : decision.confidence >= 0.5 ? yellow : red;
							stdout.write("  " + bold("Decision:") + " " + decision.description + "\n");
							stdout.write("  " + bold("Category:") + " " + cyan(decision.category) +
								" | " + bold("Confidence:") + " " + confColor(confPct + "%") + "\n\n");

							stdout.write("  " + bold("--- Nyaya Reasoning (Panchavayava) ---") + "\n");
							stdout.write("  " + cyan("1. Pratij\u00f1a (Thesis):") + "     " + decision.reasoning.thesis + "\n");
							stdout.write("  " + cyan("2. Hetu (Reason):") + "         " + decision.reasoning.reason + "\n");
							stdout.write("  " + cyan("3. Udaharana (Example):") + "   " + decision.reasoning.example + "\n");
							stdout.write("  " + cyan("4. Upanaya (Application):") + " " + decision.reasoning.application + "\n");
							stdout.write("  " + cyan("5. Nigamana (Conclusion):") + " " + decision.reasoning.conclusion + "\n");

							if (decision.alternatives.length > 0) {
								stdout.write("\n  " + bold("Alternatives Considered:") + "\n");
								for (const alt of decision.alternatives) {
									stdout.write(`    ${dim("\u2022")} ${alt.description}: ${dim(alt.reason_rejected)}\n`);
								}
							}

							stdout.write("\n  " + bold("Outcome:") + " ");
							if (decision.outcome) {
								const outcomeColor = decision.outcome.success ? green : red;
								stdout.write(outcomeColor(decision.outcome.success ? "Success" : "Failure"));
								if (decision.outcome.feedback) stdout.write(" \u2014 " + dim(decision.outcome.feedback));
							} else {
								stdout.write(dim("Pending"));
							}
							stdout.write("\n\n");
						}
					}
				} else {
					const decisions = buddhi.listDecisions({ project, limit: 10 }, db);
					stdout.write("\n" + bold("\u092C\u0941\u0926\u094D\u0927\u093F Buddhi") + dim(` \u2014 Recent Decisions (${project.split("/").pop()})`) + "\n\n");
					if (decisions.length === 0) {
						stdout.write(dim("  No decisions recorded yet. Buddhi logs agent decisions with formal Nyaya reasoning.\n\n"));
					} else {
						for (const d of decisions) {
							const confPct = Math.round(d.confidence * 100);
							const confColor = d.confidence >= 0.8 ? green : d.confidence >= 0.5 ? yellow : red;
							const age = formatAge(d.timestamp);
							const outcomeIcon = d.outcome
								? (d.outcome.success ? green("\u2713") : red("\u2717"))
								: dim("\u25CB");
							stdout.write(
								`  ${outcomeIcon} ${confColor(confPct + "%")} ${bold(d.category.padEnd(16))} ` +
								`${d.description.slice(0, 50)}${d.description.length > 50 ? "\u2026" : ""} ` +
								`${dim(age + " ago")}\n`
							);
							stdout.write(dim(`    id: ${d.id}\n`));
						}
						stdout.write("\n" + dim("  Use /buddhi explain <id> for full Nyaya reasoning.\n\n"));
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
