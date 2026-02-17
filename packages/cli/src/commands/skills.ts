/**
 * @chitragupta/cli — Skill Security Pipeline (Suraksha) CLI commands.
 *
 * chitragupta skills pending               — list quarantined skills awaiting review
 * chitragupta skills approve <id>          — promote skill to ecosystem
 * chitragupta skills reject <id> [reason]  — reject and archive skill
 * chitragupta skills list                  — list approved skills
 * chitragupta skills health                — show health reports (evolution)
 * chitragupta skills scan <file>           — run Suraksha on a single file
 * chitragupta skills ingest <path>         — discover and quarantine skills from directory
 * chitragupta skills learn <query>         — autonomously learn a new skill (Shiksha)
 *
 * Also invoked via /skills slash command in interactive mode.
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

// ─── Types for lazy-loaded modules ──────────────────────────────────────────

type Scanner = import("@chitragupta/vidhya-skills").SurakshaScanner;
type Pipeline = import("@chitragupta/vidhya-skills").SkillPipeline;
type Staging = import("@chitragupta/vidhya-skills").PratikshaManager;

// ─── Lazy module loader ─────────────────────────────────────────────────────

async function loadVidhya() {
	return import("@chitragupta/vidhya-skills");
}

// ─── Subcommands ────────────────────────────────────────────────────────────

/**
 * Run the /skills slash command or `chitragupta skills` CLI command.
 *
 * @param subCmd - The subcommand (pending, approve, reject, list, health, scan, ingest).
 * @param args - Additional arguments.
 * @param stdout - Output stream (defaults to process.stdout).
 */
export async function runSkillsCommand(
	subCmd: string | undefined,
	args: string[],
	stdout: NodeJS.WriteStream = process.stdout,
): Promise<void> {
	if (!subCmd) {
		printUsage(stdout);
		return;
	}

	switch (subCmd.toLowerCase()) {
		case "pending":
			await showPending(stdout);
			break;
		case "approve":
			await approveSkill(args[0], stdout);
			break;
		case "reject":
			await rejectSkill(args[0], args.slice(1).join(" ") || "Rejected by user", stdout);
			break;
		case "list":
			await showApproved(stdout);
			break;
		case "health":
			await showHealth(stdout);
			break;
		case "scan":
			await scanFile(args[0], stdout);
			break;
		case "ingest":
			await ingestDirectory(args[0] ?? ".", stdout);
			break;
		case "learn":
			await learnSkill(args.join(" "), stdout);
			break;
		default:
			stdout.write(yellow(`\n  Unknown subcommand: ${subCmd}\n`));
			printUsage(stdout);
			break;
	}
}

// ─── Pending ────────────────────────────────────────────────────────────────

async function showPending(stdout: NodeJS.WriteStream): Promise<void> {
	const staging = await createStaging();
	const pending = await staging.listStaged();

	if (pending.length === 0) {
		stdout.write(dim("\n  No skills pending review.\n\n"));
		return;
	}

	stdout.write("\n" + bold(`  Pending Review (${pending.length} skill${pending.length > 1 ? "s" : ""})`) + "\n\n");

	for (const entry of pending) {
		const risk = entry.riskScore !== undefined
			? `risk:${entry.riskScore.toFixed(2)}`
			: "";
		const riskColor = (entry.riskScore ?? 0) > 0.3 ? yellow : dim;
		const age = timeSince(new Date(entry.stagedAt));

		stdout.write(
			`  ${cyan(entry.quarantineId.slice(0, 14) + "..")}  ` +
			`${bold(entry.skillName.padEnd(20))} ` +
			`${dim(entry.reason.padEnd(10))} ` +
			`${riskColor(risk.padEnd(10))} ` +
			`${dim(entry.status.padEnd(12))} ` +
			`${dim(age)}\n`,
		);
	}

	stdout.write("\n" + dim("  Use /skills approve <id> or /skills reject <id> [reason]") + "\n\n");
}

// ─── Approve ────────────────────────────────────────────────────────────────

async function approveSkill(id: string | undefined, stdout: NodeJS.WriteStream): Promise<void> {
	if (!id) {
		stdout.write(yellow("\n  Usage: /skills approve <quarantine-id>\n\n"));
		return;
	}

	try {
		const pipeline = await createPipeline();
		const result = await pipeline.approve(id);
		stdout.write(green(`\n  Approved: ${bold(result.skillName)}\n`));
		stdout.write(dim(`  Path: ${result.path}\n\n`));
	} catch (err) {
		stdout.write(red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
	}
}

// ─── Reject ─────────────────────────────────────────────────────────────────

async function rejectSkill(
	id: string | undefined,
	reason: string,
	stdout: NodeJS.WriteStream,
): Promise<void> {
	if (!id) {
		stdout.write(yellow("\n  Usage: /skills reject <quarantine-id> [reason]\n\n"));
		return;
	}

	try {
		const pipeline = await createPipeline();
		await pipeline.reject(id, reason);
		stdout.write(yellow(`\n  Rejected: ${bold(id)}\n`));
		stdout.write(dim(`  Reason: ${reason}\n\n`));
	} catch (err) {
		stdout.write(red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
	}
}

// ─── List Approved ──────────────────────────────────────────────────────────

async function showApproved(stdout: NodeJS.WriteStream): Promise<void> {
	const staging = await createStaging();
	const approved = await staging.listApproved();

	if (approved.length === 0) {
		stdout.write(dim("\n  No approved skills.\n\n"));
		return;
	}

	stdout.write("\n" + bold(`  Approved Skills (${approved.length})`) + "\n\n");

	for (const entry of approved) {
		const age = timeSince(new Date(entry.approvedAt));
		stdout.write(
			`  ${green("\u25CF")} ${bold(entry.skillName.padEnd(24))} ` +
			`${dim(age)}\n`,
		);
	}

	stdout.write("\n");
}

// ─── Health ─────────────────────────────────────────────────────────────────

async function showHealth(stdout: NodeJS.WriteStream): Promise<void> {
	try {
		const { SkillEvolution } = await loadVidhya();
		const staging = await createStaging();

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

// ─── Scan ───────────────────────────────────────────────────────────────────

async function scanFile(filePath: string | undefined, stdout: NodeJS.WriteStream): Promise<void> {
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
	const scanner = await createScanner();
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

// ─── Ingest ─────────────────────────────────────────────────────────────────

async function ingestDirectory(dirPath: string, stdout: NodeJS.WriteStream): Promise<void> {
	const resolved = path.resolve(dirPath);

	stdout.write(dim(`\n  Discovering skills in ${resolved}...\n`));

	try {
		const { SkillDiscovery, SkillSandbox, SurakshaScanner } = await loadVidhya();

		const discovery = new SkillDiscovery();
		const sandbox = new SkillSandbox();
		const scanner = new SurakshaScanner();
		discovery.setSecurity({ sandbox, scanner });

		const results = await discovery.discoverAndQuarantine(resolved);

		if (results.length === 0) {
			stdout.write(dim("  No skill.md files found.\n\n"));
			return;
		}

		stdout.write(green(`  Discovered ${results.length} skill(s):\n\n`));

		for (const { manifest, quarantineId } of results) {
			const entry = sandbox.get(quarantineId);
			const status = entry?.status ?? "unknown";
			const statusColor = status === "validated" ? green
				: status === "rejected" ? red : yellow;

			stdout.write(
				`  ${cyan(quarantineId.slice(0, 14) + "..")} ` +
				`${bold(manifest.name.padEnd(20))} ` +
				`${statusColor(status)}\n`,
			);
		}

		stdout.write("\n" + dim("  Use /skills pending to review, /skills approve <id> to promote.") + "\n\n");
	} catch (err) {
		stdout.write(red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
	}
}

// ─── Learn (Shiksha) ─────────────────────────────────────────────────────────

async function learnSkill(query: string, stdout: NodeJS.WriteStream): Promise<void> {
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

// ─── Factory Helpers ────────────────────────────────────────────────────────

async function createScanner(): Promise<Scanner> {
	const { SurakshaScanner } = await loadVidhya();
	return new SurakshaScanner();
}

async function createStaging(): Promise<Staging> {
	const { PratikshaManager } = await loadVidhya();
	return new PratikshaManager();
}

async function createPipeline(): Promise<Pipeline> {
	const {
		SurakshaScanner,
		SkillSandbox,
		PratikshaManager,
		SkillRegistry,
		SkillPipeline,
	} = await loadVidhya();

	return new SkillPipeline({
		scanner: new SurakshaScanner(),
		sandbox: new SkillSandbox(),
		staging: new PratikshaManager(),
		registry: new SkillRegistry(),
	});
}

// ─── Display Helpers ────────────────────────────────────────────────────────

function printUsage(stdout: NodeJS.WriteStream): void {
	stdout.write(yellow("\n  Usage: /skills <subcommand> [args]\n\n"));
	stdout.write(dim("  Subcommands:\n"));
	stdout.write(dim("    pending               List quarantined skills awaiting review\n"));
	stdout.write(dim("    approve <id>          Promote skill to ecosystem\n"));
	stdout.write(dim("    reject <id> [reason]  Reject and archive skill\n"));
	stdout.write(dim("    list                  List approved skills\n"));
	stdout.write(dim("    health                Show health reports (evolution)\n"));
	stdout.write(dim("    scan <file>           Run Suraksha scanner on a file\n"));
	stdout.write(dim("    ingest <path>         Discover and quarantine skills\n"));
	stdout.write(dim("    learn <query>         Autonomously learn a new skill (Shiksha)\n\n"));
}

function timeSince(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function renderBar(value: number, width: number): string {
	const clamped = Math.max(0, Math.min(1, value));
	const filled = Math.round(clamped * width);
	return green("\u2588".repeat(filled)) + dim("\u2591".repeat(width - filled));
}
