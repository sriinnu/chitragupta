/**
 * @chitragupta/cli — Cross-machine sync commands.
 *
 * Syncs Smriti `days/` and `memory/` across machines using a portable snapshot.
 */

import path from "node:path";
import {
	createCrossMachineSnapshot,
	writeCrossMachineSnapshot,
	importCrossMachineSnapshot,
	getCrossMachineSyncStatus,
	type CrossMachineImportStrategy,
} from "@chitragupta/smriti";
import { bold, cyan, dim, gray, green, red, yellow } from "@chitragupta/ui/ansi";

function printUsage(): void {
	process.stdout.write(
		"\n" + bold("Usage: chitragupta sync <status|export|import> [options]") + "\n\n" +
		"  sync status\n" +
		"  sync export [--output <file>] [--max-days <N>] [--days-only|--memory-only]\n" +
		"  sync import <snapshot.json> [--strategy safe|prefer-remote|prefer-local] [--dry-run]\n\n",
	);
}

function parseStrategy(raw: string | undefined): CrossMachineImportStrategy {
	if (!raw || raw === "safe") return "safe";
	if (raw === "prefer-remote") return "preferRemote";
	if (raw === "prefer-local") return "preferLocal";
	throw new Error(`Invalid strategy "${raw}". Expected safe|prefer-remote|prefer-local.`);
}

function isoForFilename(iso: string): string {
	return iso.replace(/[:.]/g, "-");
}

async function runStatus(): Promise<void> {
	const status = getCrossMachineSyncStatus();
	process.stdout.write("\n" + bold("Cross-Machine Sync Status") + "\n");
	process.stdout.write(gray(`  Home: ${status.home}\n`));
	process.stdout.write(gray(`  Day files: ${status.daysCount}\n`));
	process.stdout.write(gray(`  Memory files: ${status.memoryCount}\n`));
	process.stdout.write(gray(`  Last export: ${status.lastExportAt ?? "(never)"}\n`));
	process.stdout.write(gray(`  Last import: ${status.lastImportAt ?? "(never)"}\n`));
	if (status.lastExportPath) {
		process.stdout.write(gray(`  Last export path: ${status.lastExportPath}\n`));
	}
	if (status.lastImportSource) {
		process.stdout.write(gray(`  Last import source: ${status.lastImportSource}\n`));
	}
	if (status.lastImportTotals) {
		const t = status.lastImportTotals;
		process.stdout.write(
			gray(`  Last import totals: created=${t.created}, updated=${t.updated}, merged=${t.merged}, skipped=${t.skipped}, conflicts=${t.conflicts}, errors=${t.errors}\n`),
		);
	}
	process.stdout.write("\n");
}

async function runExport(rest: string[]): Promise<void> {
	let output: string | undefined;
	let includeDays = true;
	let includeMemory = true;
	let maxDays: number | undefined;

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--output" && i + 1 < rest.length) {
			output = rest[++i];
		} else if (arg === "--max-days" && i + 1 < rest.length) {
			const parsed = Number.parseInt(rest[++i], 10);
			if (!Number.isFinite(parsed) || parsed < 0) {
				throw new Error("--max-days must be a non-negative integer");
			}
			maxDays = parsed;
		} else if (arg === "--days-only") {
			includeMemory = false;
		} else if (arg === "--memory-only") {
			includeDays = false;
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}

	if (!includeDays && !includeMemory) {
		throw new Error("Cannot disable both days and memory");
	}

	const snapshot = createCrossMachineSnapshot({
		includeDays,
		includeMemory,
		maxDays,
	});
	const dayCount = snapshot.files.filter((f) => f.kind === "day").length;
	const memoryCount = snapshot.files.filter((f) => f.kind === "memory").length;
	const bytes = snapshot.files.reduce((sum, f) => sum + f.bytes, 0);

	const outputPath = output
		? path.resolve(output)
		: path.resolve(process.cwd(), `chitragupta-sync-${isoForFilename(snapshot.exportedAt)}.json`);
	writeCrossMachineSnapshot(snapshot, outputPath);

	process.stdout.write(
		"\n" + green("  Sync snapshot exported.") + "\n" +
		dim(`  File: ${outputPath}\n`) +
		dim(`  Exported at: ${snapshot.exportedAt}\n`) +
		dim(`  Files: ${snapshot.files.length} (days=${dayCount}, memory=${memoryCount})\n`) +
		dim(`  Bytes: ${bytes}\n\n`),
	);
}

async function runImport(rest: string[]): Promise<void> {
	let snapshotPath: string | undefined;
	let strategyRaw: string | undefined;
	let dryRun = false;

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--strategy" && i + 1 < rest.length) {
			strategyRaw = rest[++i];
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg.startsWith("--")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (!snapshotPath) {
			snapshotPath = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}

	if (!snapshotPath) {
		throw new Error("Snapshot path is required.\nUsage: chitragupta sync import <snapshot.json> [--strategy ...] [--dry-run]");
	}

	const strategy = parseStrategy(strategyRaw);
	const result = importCrossMachineSnapshot(snapshotPath, { strategy, dryRun });
	const t = result.totals;

	process.stdout.write("\n" + bold("Sync Import Result") + "\n");
	process.stdout.write(gray(`  Imported at: ${result.importedAt}\n`));
	process.stdout.write(gray(`  Source exported at: ${result.sourceExportedAt}\n`));
	process.stdout.write(gray(`  Strategy: ${strategy}\n`));
	process.stdout.write(gray(`  Dry run: ${dryRun ? "yes" : "no"}\n`));
	process.stdout.write(
		gray(`  Totals: files=${t.files}, created=${t.created}, updated=${t.updated}, merged=${t.merged}, skipped=${t.skipped}, conflicts=${t.conflicts}, errors=${t.errors}\n`),
	);

	if (result.changedPaths.length > 0) {
		process.stdout.write(cyan("  Changed paths:\n"));
		for (const p of result.changedPaths.slice(0, 20)) {
			process.stdout.write(dim(`    - ${p}\n`));
		}
		if (result.changedPaths.length > 20) {
			process.stdout.write(dim(`    ... and ${result.changedPaths.length - 20} more\n`));
		}
	}

	if (result.conflictPaths.length > 0) {
		process.stdout.write(yellow("  Conflict copies:\n"));
		for (const p of result.conflictPaths.slice(0, 20)) {
			process.stdout.write(dim(`    - ${p}\n`));
		}
		if (result.conflictPaths.length > 20) {
			process.stdout.write(dim(`    ... and ${result.conflictPaths.length - 20} more\n`));
		}
	}

	if (result.errorPaths.length > 0) {
		process.stdout.write(red("  Errors:\n"));
		for (const p of result.errorPaths.slice(0, 20)) {
			process.stdout.write(dim(`    - ${p}\n`));
		}
		if (result.errorPaths.length > 20) {
			process.stdout.write(dim(`    ... and ${result.errorPaths.length - 20} more\n`));
		}
		process.exitCode = 1;
	}

	process.stdout.write("\n");
}

export async function runSyncCommand(subcommand: string | undefined, rest: string[]): Promise<void> {
	try {
		switch (subcommand) {
			case "status":
				await runStatus();
				return;
			case "export":
				await runExport(rest);
				return;
			case "import":
				await runImport(rest);
				return;
			default:
				printUsage();
				process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`\nError: ${message}\n\n`));
		process.exitCode = 1;
	}
}
