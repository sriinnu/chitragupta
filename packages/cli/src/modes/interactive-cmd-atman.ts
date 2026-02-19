/**
 * Interactive commands — Atman (complete soul report).
 *
 * Handles: /atman.
 * The /atman command renders a comprehensive dashboard of the agent's
 * identity, consciousness, self-model, health, memory, guardians,
 * tendencies, skills, channels, and temporal awareness.
 *
 * @module
 */

import {
	bold, dim, green, cyan, yellow, red, magenta,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { formatDuration } from "./interactive-cmd-registry.js";

/** Handle the /atman slash command. Returns `null` if the command is not recognized. */
export async function handleAtmanCommand(
	cmd: string,
	_parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	if (cmd !== "/atman") return null;

	const { agent, stdout, stats } = ctx;

	stdout.write("\n");
	stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n");
	stdout.write(bold(magenta("  \u0906\u0924\u094D\u092E\u0928\u094D Atman \u2014 The Soul of the Agent")) + "\n");
	stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n\n");

	// 1. Identity
	{
		const agentAny = agent as unknown as Record<string, unknown>;
		const profile = (agentAny.profile ?? agentAny._profile ?? {}) as Record<string, unknown>;
		const agentName = (profile.name ?? "chitragupta") as string;
		const sessionId = ((agentAny.sessionId ?? agentAny._sessionId ?? "") as string).slice(0, 12) || dim("none");
		const uptime = agentAny._startedAt ? formatDuration(Date.now() - (agentAny._startedAt as number)) : dim("unknown");

		stdout.write("  " + bold(cyan("1. Identity")) + "\n");
		stdout.write(`    Agent:    ${bold(agentName)}\n`);
		stdout.write(`    Model:    ${cyan(ctx.currentModel)}\n`);
		stdout.write(`    Thinking: ${cyan(ctx.currentThinking)}\n`);
		stdout.write(`    Session:  ${dim(String(sessionId))}\n`);
		stdout.write(`    Uptime:   ${dim(String(uptime))}\n`);
		stdout.write(`    Turns:    ${dim(String(stats.turnCount))}\n\n`);
	}

	// 2. Consciousness (Chetana)
	try {
		const chetana = agent.getChetana();
		if (chetana) {
			const report = chetana.getCognitiveReport();
			stdout.write("  " + bold(magenta("2. \u091A\u0947\u0924\u0928\u093E Consciousness")) + "\n");
			const v = report.affect.valence;
			const a = report.affect.arousal;
			const c = report.affect.confidence;
			const f = report.affect.frustration;
			stdout.write(`    Bhava:    val:${v >= 0 ? green(v.toFixed(2)) : red(v.toFixed(2))} ` +
				`aro:${yellow(a.toFixed(2))} conf:${c >= 0.7 ? green(c.toFixed(2)) : dim(c.toFixed(2))} ` +
				`frust:${f >= 0.5 ? red(f.toFixed(2)) : dim(f.toFixed(2))}\n`);
			if (report.topConcepts.length > 0) {
				stdout.write(`    Dhyana:   ${report.topConcepts.slice(0, 4).map((tc: { concept: string; weight: number }) =>
					cyan(tc.concept) + dim("(" + tc.weight.toFixed(1) + ")")
				).join(" ")}\n`);
			}
			const activeGoals = report.intentions.filter((i: { status: string }) => i.status === "active");
			const achievedGoals = report.intentions.filter((i: { status: string }) => i.status === "achieved");
			stdout.write(`    Sankalpa: ${green(String(activeGoals.length) + " active")} ` +
				`${dim(achievedGoals.length + " achieved")}\n\n`);
		}
	} catch { /* skip */ }

	// 3. Self-Model (Atma-Darshana)
	try {
		const chetana = agent.getChetana();
		if (chetana) {
			const report = chetana.getCognitiveReport();
			stdout.write("  " + bold(green("3. \u0906\u0924\u094D\u092E\u0926\u0930\u094D\u0936\u0928 Self-Model")) + "\n");
			const cal = report.selfSummary.calibration;
			const calLabel = cal > 1.2 ? red("overconfident") : cal < 0.8 ? yellow("underconfident") : green("calibrated");
			stdout.write(`    Calibration: ${cal.toFixed(2)} (${calLabel})\n`);
			if (report.selfSummary.topTools.length > 0) {
				stdout.write("    Top Tools: ");
				stdout.write(report.selfSummary.topTools.slice(0, 4).map((t: { tool: string; mastery: { successRate: number } }) => {
					const rate = t.mastery.successRate;
					const rateColor = rate >= 0.8 ? green : rate >= 0.5 ? yellow : red;
					return `${t.tool} ${rateColor((rate * 100).toFixed(0) + "%")}`;
				}).join("  "));
				stdout.write("\n");
			}
			stdout.write("\n");
		}
	} catch { /* skip */ }

	// 4. Health (Triguna)
	try {
		const { Triguna } = await import("@chitragupta/anina");
		const agentAny = agent as unknown as Record<string, unknown>;
		let triguna: InstanceType<typeof Triguna> | undefined;
		const chetanaObj = agentAny._chetana as Record<string, unknown> | undefined;
		if (chetanaObj?.triguna && chetanaObj.triguna instanceof Triguna) triguna = chetanaObj.triguna;
		if (triguna) {
			const state = triguna.getState();
			const dominant = triguna.getDominant();
			const domColor = dominant === "sattva" ? green : dominant === "rajas" ? yellow : red;
			stdout.write("  " + bold(yellow("4. \u0924\u094D\u0930\u093F\u0917\u0941\u0923 Health")) + "\n");
			stdout.write(`    ${green("Sattva")}: ${(state.sattva * 100).toFixed(0)}%  ` +
				`${yellow("Rajas")}: ${(state.rajas * 100).toFixed(0)}%  ` +
				`${red("Tamas")}: ${(state.tamas * 100).toFixed(0)}%  ` +
				`Mode: ${domColor(dominant)}\n\n`);
		}
	} catch { /* skip */ }

	// 5. Memory Stats
	try {
		stdout.write("  " + bold(cyan("5. Memory")) + "\n");
		stdout.write(`    Sessions this run:  ${dim(String(stats.turnCount) + " turns")}\n`);
		stdout.write(`    Tokens consumed:    ${dim(String(stats.totalInputTokens + stats.totalOutputTokens))}\n`);
		stdout.write(`    Total cost:         ${dim("$" + stats.totalCost.toFixed(4))}\n`);
		try {
			const { AkashaField } = await import("@chitragupta/smriti");
			const agentAny = agent as unknown as Record<string, unknown>;
			let akasha: InstanceType<typeof AkashaField> | undefined;
			if (agentAny._akasha && agentAny._akasha instanceof AkashaField) akasha = agentAny._akasha;
			if (akasha) {
				const akStats = akasha.stats();
				stdout.write(`    Akasha traces:      ${dim(String(akStats.totalTraces) + " (" + akStats.activeTraces + " active)")}\n`);
			}
		} catch { /* skip */ }
		stdout.write("\n");
	} catch { /* skip */ }

	// 6. Guardians (Lokapala)
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		const agentAny = agent as unknown as Record<string, unknown>;
		let lokapala: InstanceType<typeof LokapalaController> | undefined;
		if (agentAny._lokapala && agentAny._lokapala instanceof LokapalaController) lokapala = agentAny._lokapala;
		if (lokapala) {
			const gStats = lokapala.stats();
			const criticals = lokapala.criticalFindings();
			const totalFindings = gStats.security.findingsTotal + gStats.performance.findingsTotal + gStats.correctness.findingsTotal;
			stdout.write("  " + bold(red("6. \u0932\u094B\u0915\u092A\u093E\u0932 Guardians")) + "\n");
			stdout.write(`    Security:    ${dim(gStats.security.scansCompleted + " scans, " + gStats.security.findingsTotal + " findings")}\n`);
			stdout.write(`    Performance: ${dim(gStats.performance.scansCompleted + " scans, " + gStats.performance.findingsTotal + " findings")}\n`);
			stdout.write(`    Correctness: ${dim(gStats.correctness.scansCompleted + " scans, " + gStats.correctness.findingsTotal + " findings")}\n`);
			if (criticals.length > 0) {
				stdout.write(`    ${red(bold(criticals.length + " CRITICAL finding(s)!"))}\n`);
			} else {
				stdout.write(`    ${green("All clear")} ${dim("(" + totalFindings + " total findings)")}\n`);
			}
			stdout.write("\n");
		}
	} catch { /* skip */ }

	// 7. Tendencies (Vasana)
	try {
		const { VasanaEngine } = await import("@chitragupta/smriti");
		const engine = new VasanaEngine();
		engine.restore();
		const project = ctx.projectPath ?? process.cwd();
		const vasanas = engine.getVasanas(project, 5);
		if (vasanas.length > 0) {
			stdout.write("  " + bold(yellow("7. \u0935\u093E\u0938\u0928\u093E Tendencies")) + "\n");
			for (const vv of vasanas) {
				const valIcon = vv.valence === "positive" ? green("\u25B2") : vv.valence === "negative" ? red("\u25BC") : dim("\u25CF");
				stdout.write(
					`    ${valIcon} ${bold(vv.tendency)} ` +
					`${dim(`str:${vv.strength.toFixed(2)} stab:${vv.stability.toFixed(2)} [${vv.reinforcementCount}x]`)}\n`
				);
			}
			stdout.write("\n");
		}
	} catch { /* skip */ }

	// 8. Skills
	try {
		if (ctx.vidyaOrchestrator) {
			const ecosystemStats = ctx.vidyaOrchestrator.getEcosystemStats() as Record<string, unknown>;
			stdout.write("  " + bold(cyan("8. Skills")) + "\n");
			stdout.write(`    Total: ${dim(String(ecosystemStats.totalSkills ?? ecosystemStats.total ?? 0))}\n\n`);
		}
	} catch { /* skip */ }

	// 9. Channels (Samiti)
	try {
		const { Samiti } = await import("@chitragupta/sutra");
		const agentAny = agent as unknown as Record<string, unknown>;
		let samiti: InstanceType<typeof Samiti> | undefined;
		if (agentAny._samiti && agentAny._samiti instanceof Samiti) samiti = agentAny._samiti;
		if (samiti) {
			const samitiStats = samiti.stats();
			stdout.write("  " + bold(green("9. \u0938\u093E\u092E\u0940\u0924\u093F Channels")) + "\n");
			stdout.write(`    Channels: ${dim(String(samitiStats.channels))}  ` +
				`Messages: ${dim(String(samitiStats.totalMessages))}  ` +
				`Subscribers: ${dim(String(samitiStats.subscribers))}\n\n`);
		}
	} catch { /* skip */ }

	// 10. Temporal (Kala Chakra)
	try {
		const { KalaChakra } = await import("@chitragupta/smriti");
		const agentAny = agent as unknown as Record<string, unknown>;
		let kala: InstanceType<typeof KalaChakra> | undefined;
		if (agentAny._kalaChakra && agentAny._kalaChakra instanceof KalaChakra) kala = agentAny._kalaChakra;
		if (kala) {
			const now = Date.now();
			const rel5m = kala.relevanceScore(now - 300_000, now);
			const rel1d = kala.relevanceScore(now - 86_400_000, now);
			const rel1w = kala.relevanceScore(now - 7 * 86_400_000, now);
			stdout.write("  " + bold(magenta("10. \u0915\u093E\u0932 \u091A\u0915\u094D\u0930 Temporal")) + "\n");
			stdout.write(`    Relevance: 5m=${green(rel5m.toFixed(3))} 1d=${yellow(rel1d.toFixed(3))} 1w=${dim(rel1w.toFixed(3))}\n\n`);
		}
	} catch { /* skip */ }

	stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n\n");

	return { handled: true };
}
