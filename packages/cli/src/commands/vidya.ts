/**
 * /vidya — Vidya Ecosystem Dashboard (विद्या सूत्रधार)
 *
 * ANSI dashboard showing ecosystem health:
 * - Skill counts by kula tier and ashrama stage
 * - Pancha Kosha averages
 * - Top compositions
 * - Attention items (extinction, speciation, promotions)
 *
 * Subcommands:
 * - /vidya          — full ecosystem dashboard
 * - /vidya <name>   — single skill deep dive
 * - /vidya lifecycle — run lifecycle evaluation
 */

import {
	bold,
	dim,
	green,
	yellow,
	red,
	cyan,
	magenta,
} from "@chitragupta/ui/ansi";

// ── Types (duck-typed to avoid hard dep) ────────────────────────────────────

interface OrchestratorLike {
	getEcosystemStats(): {
		totalSkills: number;
		byKula: Record<string, number>;
		byAshrama: Record<string, number>;
		avgKosha: { annamaya: number; pranamaya: number; manomaya: number; vijnanamaya: number; anandamaya: number; overall: number };
		topCompositions: Array<{ name: string; type: string; successRate: number }>;
		extinctionCandidates: string[];
		deprecationCandidates: string[];
	};
	getSkillReport(name?: string): SkillReportLike | SkillReportLike[];
	evaluateLifecycles(): {
		promotions: string[];
		demotions: string[];
		archived: string[];
		extinctionCandidates: string[];
		speciationCandidates: Array<{ skill: string; suggestedVariant: string; reason: string }>;
		deprecationCandidates: string[];
		newCompositions: Array<{ name: string; type: string; successRate: number }>;
	};
}

interface SkillReportLike {
	name: string;
	kula: string | null;
	ashrama: { stage: string };
	kosha: { annamaya: number; pranamaya: number; manomaya: number; vijnanamaya: number; anandamaya: number; overall: number };
	mastery: { totalInvocations: number; successRate: number; dreyfusLevel: string; avgLatencyMs: number };
	health: { health: number; useRate: number; matchCount: number; useCount: number };
	compositions: Array<{ name: string; type: string; successRate: number }>;
	parampara?: { trust: { score: number }; links: unknown[]; chainIntact: boolean };
	vamsha?: { variants: string[]; symbionts: string[]; events: unknown[] };
}

// ── Bar renderer ────────────────────────────────────────────────────────────

function renderBar(value: number, width: number): string {
	const clamped = Math.max(0, Math.min(1, value));
	const filled = Math.round(clamped * width);
	return green("\u2588".repeat(filled)) + dim("\u2591".repeat(width - filled));
}

function stageColor(stage: string): (s: string) => string {
	switch (stage) {
		case "grihastha": return green;
		case "brahmacharya": return cyan;
		case "vanaprastha": return yellow;
		case "sannyasa": return red;
		default: return dim;
	}
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export function renderVidyaDashboard(
	orchestrator: OrchestratorLike,
	stdout: NodeJS.WriteStream,
): void {
	const stats = orchestrator.getEcosystemStats();

	stdout.write("\n");
	stdout.write(bold("  \u0935\u093F\u0926\u094D\u092F\u093E Vidya Ecosystem") + "\n\n");

	// ── Skill counts ──
	stdout.write(`  Skills: ${bold(String(stats.totalSkills))} total`);
	stdout.write(` (${green(String(stats.byKula.antara ?? 0))} antara`);
	stdout.write(`, ${yellow(String(stats.byKula.bahya ?? 0))} bahya`);
	stdout.write(`, ${cyan(String(stats.byKula.shiksha ?? 0))} shiksha)`);
	stdout.write("\n");

	stdout.write(`  Stages: ${green(String(stats.byAshrama.grihastha ?? 0))} grihastha`);
	stdout.write(`, ${yellow(String(stats.byAshrama.vanaprastha ?? 0))} vanaprastha`);
	stdout.write(`, ${cyan(String(stats.byAshrama.brahmacharya ?? 0))} brahmacharya`);
	stdout.write(`, ${dim(String(stats.byAshrama.sannyasa ?? 0))} sannyasa`);
	stdout.write("\n\n");

	// ── Pancha Kosha averages ──
	stdout.write("  " + bold(magenta("\u092A\u091E\u094D\u091A \u0915\u094B\u0936 Pancha Kosha")) + dim(" \u2014 avg") + "\n");
	const barW = 10;
	const koshaEntries: Array<[string, number]> = [
		["Annamaya ", stats.avgKosha.annamaya],
		["Pranamaya", stats.avgKosha.pranamaya],
		["Manomaya ", stats.avgKosha.manomaya],
		["Vijnanamaya", stats.avgKosha.vijnanamaya],
		["Anandamaya", stats.avgKosha.anandamaya],
	];

	for (const [label, value] of koshaEntries) {
		const bar = renderBar(value, barW);
		stdout.write(`    ${dim(label.padEnd(12))} ${bar} ${value.toFixed(2)}\n`);
	}
	stdout.write(`    ${dim("Overall".padEnd(12))} ${renderBar(stats.avgKosha.overall, barW)} ${bold(stats.avgKosha.overall.toFixed(2))}\n`);
	stdout.write("\n");

	// ── Top Compositions ──
	if (stats.topCompositions.length > 0) {
		stdout.write("  " + bold(cyan("\u092F\u094B\u0917 Yoga")) + dim(" \u2014 Compositions") + "\n");
		for (const comp of stats.topCompositions.slice(0, 5)) {
			const pct = (comp.successRate * 100).toFixed(0);
			stdout.write(`    ${dim(comp.type.padEnd(8))} ${comp.name} ${green(pct + "%")}\n`);
		}
		stdout.write("\n");
	}

	// ── Attention ──
	const hasAttention =
		stats.extinctionCandidates.length > 0 ||
		stats.deprecationCandidates.length > 0;

	if (hasAttention) {
		stdout.write("  " + bold(yellow("\u26A0 Attention")) + "\n");
		if (stats.extinctionCandidates.length > 0) {
			stdout.write(`    ${yellow("\u26A0")} ${stats.extinctionCandidates.length} extinction candidate(s)\n`);
		}
		if (stats.deprecationCandidates.length > 0) {
			stdout.write(`    ${yellow("\u26A0")} ${stats.deprecationCandidates.length} deprecation candidate(s)\n`);
		}
		stdout.write("\n");
	} else {
		stdout.write("  " + green("\u2713") + " Ecosystem healthy\n\n");
	}
}

// ── Skill Detail ────────────────────────────────────────────────────────────

export function renderSkillDetail(
	orchestrator: OrchestratorLike,
	skillName: string,
	stdout: NodeJS.WriteStream,
): void {
	const report = orchestrator.getSkillReport(skillName) as SkillReportLike;

	stdout.write("\n");
	stdout.write(bold(`  ${report.name}`) + dim(` (${report.kula ?? "unknown"} kula)`));
	stdout.write("  " + stageColor(report.ashrama.stage)(report.ashrama.stage));
	stdout.write("\n\n");

	// ── Pancha Kosha ──
	stdout.write("  " + bold(magenta("Pancha Kosha")) + "\n");
	const barW = 10;
	const fields: Array<[string, number]> = [
		["Annamaya", report.kosha.annamaya],
		["Pranamaya", report.kosha.pranamaya],
		["Manomaya", report.kosha.manomaya],
		["Vijnanamaya", report.kosha.vijnanamaya],
		["Anandamaya", report.kosha.anandamaya],
	];
	for (const [label, value] of fields) {
		stdout.write(`    ${dim(label.padEnd(12))} ${renderBar(value, barW)} ${value.toFixed(2)}\n`);
	}
	stdout.write(`    ${dim("Overall".padEnd(12))} ${renderBar(report.kosha.overall, barW)} ${bold(report.kosha.overall.toFixed(2))}\n\n`);

	// ── Mastery ──
	stdout.write("  " + bold(green("Mastery")) + "\n");
	stdout.write(`    Invocations: ${report.mastery.totalInvocations}\n`);
	stdout.write(`    Success:     ${(report.mastery.successRate * 100).toFixed(1)}%\n`);
	stdout.write(`    Dreyfus:     ${report.mastery.dreyfusLevel}\n`);
	stdout.write(`    Latency:     ${report.mastery.avgLatencyMs.toFixed(1)}ms\n\n`);

	// ── Health ──
	stdout.write("  " + bold(yellow("Health")) + "\n");
	stdout.write(`    Score:    ${report.health.health.toFixed(3)}\n`);
	stdout.write(`    Use rate: ${(report.health.useRate * 100).toFixed(1)}%\n`);
	stdout.write(`    Matches:  ${report.health.matchCount}  Uses: ${report.health.useCount}\n\n`);

	// ── Trust ──
	if (report.parampara) {
		stdout.write("  " + bold(cyan("Trust (Parampara)")) + "\n");
		stdout.write(`    Score:    ${report.parampara.trust.score.toFixed(2)}\n`);
		stdout.write(`    Chain:    ${report.parampara.links.length} links`);
		stdout.write(report.parampara.chainIntact ? green(" (intact)") : red(" (BROKEN)"));
		stdout.write("\n\n");
	}

	// ── Compositions ──
	if (report.compositions.length > 0) {
		stdout.write("  " + bold(cyan("Compositions")) + "\n");
		for (const comp of report.compositions.slice(0, 5)) {
			stdout.write(`    ${dim(comp.type.padEnd(8))} ${comp.name} ${green((comp.successRate * 100).toFixed(0) + "%")}\n`);
		}
		stdout.write("\n");
	}
}

// ── Lifecycle Evaluation ────────────────────────────────────────────────────

export function renderLifecycleEvaluation(
	orchestrator: OrchestratorLike,
	stdout: NodeJS.WriteStream,
): void {
	const report = orchestrator.evaluateLifecycles();

	stdout.write("\n" + bold("  Lifecycle Evaluation") + "\n\n");

	if (report.promotions.length > 0) {
		stdout.write("  " + green("\u2191 Promoted:") + "\n");
		for (const name of report.promotions) {
			stdout.write(`    ${green("\u25CF")} ${name}\n`);
		}
		stdout.write("\n");
	}

	if (report.demotions.length > 0) {
		stdout.write("  " + yellow("\u2193 Demoted:") + "\n");
		for (const name of report.demotions) {
			stdout.write(`    ${yellow("\u25CF")} ${name}\n`);
		}
		stdout.write("\n");
	}

	if (report.archived.length > 0) {
		stdout.write("  " + red("\u2717 Archived:") + "\n");
		for (const name of report.archived) {
			stdout.write(`    ${red("\u25CF")} ${name}\n`);
		}
		stdout.write("\n");
	}

	if (report.extinctionCandidates.length > 0) {
		stdout.write("  " + red("\u26A0 Extinction candidates:") + "\n");
		for (const name of report.extinctionCandidates) {
			stdout.write(`    ${red("\u25CF")} ${name}\n`);
		}
		stdout.write("\n");
	}

	if (report.speciationCandidates.length > 0) {
		stdout.write("  " + cyan("\u2727 Speciation candidates:") + "\n");
		for (const c of report.speciationCandidates.slice(0, 5)) {
			stdout.write(`    ${cyan("\u25CF")} ${c.skill} \u2192 ${c.suggestedVariant}\n`);
			stdout.write(`      ${dim(c.reason)}\n`);
		}
		stdout.write("\n");
	}

	const totalActions =
		report.promotions.length +
		report.demotions.length +
		report.archived.length;

	if (totalActions === 0 && report.extinctionCandidates.length === 0 && report.speciationCandidates.length === 0) {
		stdout.write("  " + green("\u2713") + " No lifecycle changes needed.\n\n");
	}
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function runVidyaCommand(
	orchestrator: OrchestratorLike | undefined,
	subcommand: string | undefined,
	stdout: NodeJS.WriteStream,
): Promise<void> {
	if (!orchestrator) {
		stdout.write(yellow("\n  Vidya Orchestrator is not available.\n"));
		stdout.write(dim("  vidhya-skills may not be loaded.\n\n"));
		return;
	}

	if (!subcommand || subcommand.trim() === "") {
		renderVidyaDashboard(orchestrator, stdout);
	} else if (subcommand === "lifecycle" || subcommand === "eval") {
		renderLifecycleEvaluation(orchestrator, stdout);
	} else {
		renderSkillDetail(orchestrator, subcommand, stdout);
	}
}
