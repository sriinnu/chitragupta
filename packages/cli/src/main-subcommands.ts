/**
 * @chitragupta/cli — Subcommand handlers extracted from main.ts.
 *
 * Contains handlers for:
 *   - `daemon` subcommand — starts/stops the Nidra background daemon
 *   - `swapna` subcommand — runs memory consolidation pipeline
 */

import { listSessions, loadSession } from "@chitragupta/smriti/session-store";
import type { Session } from "@chitragupta/smriti/types";

// ─── Daemon Subcommand ────────────────────────────────────────────────────────────

/**
 * Handle the `daemon` subcommand.
 *
 * Delegates to the daemon command module and exits the process.
 *
 * @param subcommand - The daemon subcommand (start, stop, status, etc.)
 */
export async function handleDaemonCommand(subcommand?: string): Promise<never> {
	const { runDaemonCommand } = await import("./modes/daemon-cmd.js");
	await runDaemonCommand(subcommand);
	process.exit(0);
}

// ─── Swapna Subcommand ────────────────────────────────────────────────────────────

/**
 * Handle the `swapna` subcommand (Memory Consolidation).
 *
 * Runs the 6-phase consolidation pipeline:
 *   1. LOAD — Load existing knowledge rules
 *   2. REPLAY — Gather recent sessions
 *   3. RECOMBINE — Extract knowledge rules
 *   4. CRYSTALLIZE — Decay old rules, prune weak ones
 *   5. PROCEDURALIZE — Extract tool sequences into Vidhis
 *   6. COMPRESS — Persist consolidated knowledge
 *
 * @param projectPath - Root directory of the current project
 * @param targetDate - Target date for consolidation (YYYY-MM-DD). Defaults to today.
 */
export async function handleSwapnaCommand(
	projectPath: string,
	targetDate?: string,
): Promise<never> {
	const date = targetDate ?? new Date().toISOString().slice(0, 10);
	process.stdout.write(`\n  Swapna — Memory Consolidation\n`);
	process.stdout.write(`  Date: ${date}\n\n`);

	try {
		const { ConsolidationEngine, VidhiEngine } = await import("@chitragupta/smriti");

		process.stdout.write(`  [1/6] LOAD — Loading existing knowledge rules...\n`);
		const consolidator = new ConsolidationEngine();
		consolidator.load();

		process.stdout.write(`  [2/6] REPLAY — Gathering recent sessions...\n`);
		const recentMetas = listSessions(projectPath).slice(0, 10);
		const recentSessions: Session[] = [];
		for (const meta of recentMetas) {
			try {
				const s = loadSession(meta.id, projectPath);
				if (s) recentSessions.push(s);
			} catch { /* skip unloadable */ }
		}
		process.stdout.write(`    Found ${recentSessions.length} sessions to analyze.\n`);

		if (recentSessions.length === 0) {
			process.stdout.write(`\n  No sessions to consolidate. Run some sessions first.\n\n`);
			process.exit(0);
		}

		process.stdout.write(`  [3/6] RECOMBINE — Extracting knowledge rules...\n`);
		const result = consolidator.consolidate(recentSessions);

		process.stdout.write(`  [4/6] CRYSTALLIZE — Decaying old rules, pruning weak ones...\n`);
		consolidator.decayRules();
		consolidator.pruneRules();

		process.stdout.write(`  [5/6] PROCEDURALIZE — Extracting tool sequences into Vidhis...\n`);
		let vidhiResult: { newVidhis: unknown[]; reinforced: unknown[] } | undefined;
		try {
			const vidhiEngine = new VidhiEngine({ project: projectPath });
			vidhiResult = vidhiEngine.extract();
		} catch { /* vidhi extraction is optional */ }

		process.stdout.write(`  [6/6] COMPRESS — Persisting consolidated knowledge...\n`);
		consolidator.save();

		process.stdout.write(`\n  Swapna Consolidation Complete\n`);
		process.stdout.write(`  Sessions analyzed:    ${result.sessionsAnalyzed}\n`);
		process.stdout.write(`  New rules learned:    ${result.newRules.length}\n`);
		process.stdout.write(`  Rules reinforced:     ${result.reinforcedRules.length}\n`);
		process.stdout.write(`  Rules weakened:       ${result.weakenedRules.length}\n`);
		process.stdout.write(`  Patterns detected:    ${result.patternsDetected.length}\n`);
		if (vidhiResult) {
			process.stdout.write(`  New vidhis:           ${vidhiResult.newVidhis.length}\n`);
			process.stdout.write(`  Vidhis reinforced:    ${vidhiResult.reinforced.length}\n`);
		}

		if (result.newRules.length > 0) {
			process.stdout.write(`\n  New rules:\n`);
			for (const rule of result.newRules.slice(0, 10)) {
				process.stdout.write(`    - [${rule.category}] ${rule.rule}\n`);
			}
			if (result.newRules.length > 10) {
				process.stdout.write(`    ... and ${result.newRules.length - 10} more.\n`);
			}
		}
		process.stdout.write(`\n`);
	} catch (err) {
		process.stderr.write(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`);
		process.exit(1);
	}

	process.exit(0);
}
