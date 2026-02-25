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

import path from "path";
import {
	bold,
	green,
	yellow,
	cyan,
	dim,
	red,
} from "@chitragupta/ui/ansi";
import {
	showHealth,
	scanFile,
	learnSkill,
	timeSince,
} from "./skills-display.js";

// Re-export for backward compatibility
export { showHealth, scanFile, learnSkill } from "./skills-display.js";

// ─── Types for lazy-loaded modules ──────────────────────────────────────────

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

// ─── Factory Helpers ────────────────────────────────────────────────────────

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
