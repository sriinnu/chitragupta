/**
 * Skills display helpers — formatted output for health, scan, and learn results.
 *
 * Extracted from skills.ts for maintainability.
 *
 * @module skills-display
 */

import fs from "fs";
import path from "path";
import {
	bold,
	green,
	gray,
	yellow,
	cyan,
	dim,
	red,
	magenta,
} from "@chitragupta/ui/ansi";

/** Lazy loader for vidhya-skills. */
async function loadVidhya() {
	return import("@chitragupta/vidhya-skills");
}

type Staging = import("@chitragupta/vidhya-skills").PratikshaManager;
type Scanner = import("@chitragupta/vidhya-skills").SurakshaScanner;

// ─── Health Report ──────────────────────────────────────────────────────────

/** Display skill health report including evolution, fusions, and deprecation. */
export async function showHealth(stdout: NodeJS.WriteStream): Promise<void> {
	try {
		const { SkillEvolution, PratikshaManager } = await loadVidhya();
		const staging = new PratikshaManager();

		const state = await staging.loadEvolutionState();
		if (!state) {
			stdout.write(dim("\n  No evolution data available yet.\n\n"));
			return;
		}

		const evolution = SkillEvolution.deserialize(state);
		const report = evolution.getEvolutionReport();

		if (report.length === 0) {
			stdout.write(dim("\n  No skill health data recorded.\n\n"));
			return;
		}

		stdout.write("\n" + bold("  Skill Health Report") + "\n\n");

		for (const r of report) {
			const healthBar = renderBar(r.health, 15);
			const healthColor = r.health >= 0.7 ? green : r.health >= 0.4 ? yellow : red;
			const flag = r.flaggedForReview ? red(" [REVIEW]") : "";

			stdout.write(
				`  ${healthBar} ${healthColor((r.health * 100).toFixed(0).padStart(3) + "%")} ` +
				`${bold(r.name.padEnd(20))} ` +
				`${dim(`uses:${r.useCount}`)} ` +
				`${dim(`success:${(r.successRate * 100).toFixed(0)}%`)}` +
				`${flag}\n`,
			);
		}

		// Fusion suggestions
		const fusions = evolution.suggestFusions();
		if (fusions.length > 0) {
			stdout.write("\n" + bold("  Fusion Suggestions") + "\n\n");
			for (const f of fusions) {
				stdout.write(
					`  ${magenta("\u2194")} ${bold(f.skillA)} + ${bold(f.skillB)} ` +
					`${dim(`(${(f.coOccurrenceRate * 100).toFixed(0)}% co-use)`)}\n`,
				);
			}
		}

		// Deprecation candidates
		const deprecated = evolution.getDeprecationCandidates();
		if (deprecated.length > 0) {
			stdout.write("\n" + yellow("  Deprecation Candidates") + "\n\n");
			for (const d of deprecated) {
				stdout.write(`  ${red("\u2717")} ${d.name} ${dim(`(health: ${(d.health * 100).toFixed(0)}%, matches: ${d.matchCount})`)}\n`);
			}
		}

		stdout.write("\n");
	} catch (err) {
		stdout.write(red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
	}
}

// ─── Scan Report ────────────────────────────────────────────────────────────

/** Scan a single file with Suraksha and display the results. */
export async function scanFile(filePath: string | undefined, stdout: NodeJS.WriteStream): Promise<void> {
	if (!filePath) {
		stdout.write(yellow("\n  Usage: /skills scan <file>\n\n"));
		return;
	}

	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		stdout.write(red(`\n  File not found: ${resolved}\n\n`));
		return;
	}

	const content = fs.readFileSync(resolved, "utf-8");
	const { SurakshaScanner } = await loadVidhya();
	const scanner: Scanner = new SurakshaScanner();
	const result = scanner.scan(path.basename(filePath), content);

	// Verdict header
	const verdictColor = {
		clean: green,
		suspicious: yellow,
		dangerous: red,
		malicious: (s: string) => red(bold(s)),
	}[result.verdict] ?? dim;

	stdout.write("\n" + bold("  Suraksha Scan Report") + "\n\n");
	stdout.write(`  File:    ${cyan(resolved)}\n`);
	stdout.write(`  Verdict: ${verdictColor(result.verdict.toUpperCase())}\n`);
	stdout.write(`  Risk:    ${result.riskScore.toFixed(3)}\n`);
	stdout.write(`  Time:    ${result.scanDurationMs.toFixed(1)}ms\n`);
	stdout.write(`  Hash:    ${dim(result.contentHash.toString(16))}\n`);

	if (result.findings.length === 0) {
		stdout.write(green("\n  No findings. Content is clean.\n"));
	} else {
		stdout.write(`\n  Findings (${result.findings.length}):\n\n`);

		for (const f of result.findings) {
			const sevColor = f.severity === "block" ? red
				: f.severity === "critical" ? red
					: f.severity === "warning" ? yellow : dim;

			stdout.write(
				`  ${sevColor(`[${f.severity.toUpperCase().padEnd(8)}]`)} ` +
				`${bold(f.threat)} ` +
				`${f.line > 0 ? dim(`L${f.line}`) : ""}\n`,
			);
			stdout.write(`    ${f.message}\n`);
			if (f.snippet) {
				stdout.write(`    ${dim(f.snippet.slice(0, 80))}\n`);
			}
		}
	}

	stdout.write("\n");
}

// ─── Learn (Shiksha) ────────────────────────────────────────────────────────

/** Autonomously learn a new skill from a natural language query. */
export async function learnSkill(query: string, stdout: NodeJS.WriteStream): Promise<void> {
	if (!query.trim()) {
		stdout.write(yellow("\n  Usage: /skills learn <query>\n"));
		stdout.write(dim("  Example: /skills learn \"disk space left\"\n\n"));
		return;
	}

	try {
		const {
			ShikshaController,
			SkillRegistry,
			SurakshaScanner,
			SkillSandbox,
			PratikshaManager,
			SkillPipeline,
		} = await loadVidhya();

		const registry = new SkillRegistry();
		const scanner = new SurakshaScanner();
		const pipeline = new SkillPipeline({
			scanner,
			sandbox: new SkillSandbox(),
			staging: new PratikshaManager(),
			registry,
		});

		const shiksha = new ShikshaController(
			{ registry, pipeline, scanner },
		);

		stdout.write(dim(`\n  Learning: "${query}"...\n`));

		const result = await shiksha.learn(query);

		if (result.success && result.skill) {
			const skill = result.skill;
			stdout.write(green(`  Learned: ${bold(skill.manifest.name)}\n`));
			stdout.write(dim(`  Strategy: ${skill.taskAnalysis.strategy}\n`));
			stdout.write(dim(`  Source: ${skill.sourceResult.tier}\n`));
			stdout.write(dim(`  Duration: ${result.durationMs.toFixed(0)}ms\n`));

			if (result.autoApproved) {
				stdout.write(green("  Auto-approved (clean scan, safe pattern)\n"));
			} else {
				stdout.write(yellow(`  Quarantined for review: ${result.quarantineId ?? "N/A"}\n`));
			}

			if (result.executed && result.executionOutput) {
				stdout.write("\n" + bold("  Output:") + "\n");
				stdout.write("  " + result.executionOutput.split("\n").join("\n  ") + "\n");
			}
		} else {
			stdout.write(yellow(`  Could not learn: ${result.error ?? "unknown error"}\n`));
		}

		stdout.write("\n");
	} catch (err) {
		stdout.write(red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
	}
}

// ─── Display Helpers ────────────────────────────────────────────────────────

/** Format elapsed time as "Xs ago", "Xm ago", "Xh ago", or "Xd ago". */
export function timeSince(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/** Render a horizontal bar chart segment. */
export function renderBar(value: number, width: number): string {
	const clamped = Math.max(0, Math.min(1, value));
	const filled = Math.round(clamped * width);
	return green("\u2588".repeat(filled)) + dim("\u2591".repeat(width - filled));
}
