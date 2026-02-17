/**
 * @chitragupta/cli — Daemon Mode.
 *
 * Runs the Chitragupta background daemon for calendar-aware session
 * consolidation. Wraps the Nidra sleep-cycle daemon with scheduling
 * so that day files, Svapna consolidation, and Vasana extraction
 * happen automatically on idle, on a cron schedule, and on startup
 * backfill.
 *
 * Usage:
 *   chitragupta daemon [--hour N] [--backfill-days N] [--no-idle] [--no-backfill]
 *
 * Options:
 *   --hour N           Hour of day (0-23) for full consolidation. Default: 2.
 *   --backfill-days N  Max days to backfill on startup. Default: 7.
 *   --no-idle          Disable consolidation on idle.
 *   --no-backfill      Disable startup backfill.
 */

import { ChitraguptaDaemon } from "@chitragupta/anina";
import type { ChitraguptaDaemonConfig, ConsolidationEvent } from "@chitragupta/anina";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DaemonModeOptions {
	/** Hour of day (0-23) for full consolidation. Default: 2 */
	hour?: number;
	/** Max days to backfill on startup. Default: 7 */
	backfillDays?: number;
	/** Whether to consolidate on idle. Default: true */
	consolidateOnIdle?: boolean;
	/** Whether to backfill on startup. Default: true */
	backfillOnStartup?: boolean;
}

// ─── Arg Parsing ────────────────────────────────────────────────────────────

/**
 * Parse daemon-specific CLI arguments from process.argv.
 *
 * Supports:
 *   --hour N, --backfill-days N, --no-idle, --no-backfill
 */
export function parseDaemonArgs(argv: string[] = process.argv.slice(2)): DaemonModeOptions {
	const opts: DaemonModeOptions = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "--hour" && i + 1 < argv.length) {
			const val = parseInt(argv[++i], 10);
			if (!isNaN(val) && val >= 0 && val <= 23) {
				opts.hour = val;
			} else {
				process.stderr.write(`Warning: --hour must be 0-23, got "${argv[i]}". Using default.\n`);
			}
		} else if (arg === "--backfill-days" && i + 1 < argv.length) {
			const val = parseInt(argv[++i], 10);
			if (!isNaN(val) && val >= 0) {
				opts.backfillDays = val;
			} else {
				process.stderr.write(`Warning: --backfill-days must be >= 0, got "${argv[i]}". Using default.\n`);
			}
		} else if (arg === "--no-idle") {
			opts.consolidateOnIdle = false;
		} else if (arg === "--no-backfill") {
			opts.backfillOnStartup = false;
		}
	}

	return opts;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Format a consolidation event for stderr output. */
function formatEvent(event: ConsolidationEvent): string {
	const ts = new Date().toLocaleTimeString();
	switch (event.type) {
		case "start":
			return `[${ts}] Consolidating ${event.date}...`;
		case "progress":
			return `[${ts}]   ${event.phase}: ${event.detail ?? ""}`;
		case "complete":
			return `[${ts}] Done ${event.date} (${event.durationMs ?? 0}ms) — ${event.detail ?? ""}`;
		case "error":
			return `[${ts}] ERROR ${event.date} — ${event.detail ?? "unknown"}`;
		default:
			return `[${ts}] ${event.type} ${event.date}`;
	}
}

// ─── Run ────────────────────────────────────────────────────────────────────

/**
 * Run the daemon mode — starts the ChitraguptaDaemon and blocks until signal.
 *
 * This is the function called from the CLI `chitragupta daemon` command.
 */
export async function runDaemonMode(options?: DaemonModeOptions): Promise<void> {
	const config: Partial<ChitraguptaDaemonConfig> = {};

	if (options?.hour !== undefined) config.consolidationHour = options.hour;
	if (options?.backfillDays !== undefined) config.maxBackfillDays = options.backfillDays;
	if (options?.consolidateOnIdle !== undefined) config.consolidateOnIdle = options.consolidateOnIdle;
	if (options?.backfillOnStartup !== undefined) config.backfillOnStartup = options.backfillOnStartup;

	const daemon = new ChitraguptaDaemon(config);

	// Wire up event logging to stderr
	daemon.on("consolidation", (event: ConsolidationEvent) => {
		process.stderr.write(formatEvent(event) + "\n");
	});

	daemon.on("error", (err: unknown) => {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[ERROR] ${msg}\n`);
	});

	daemon.on("started", () => {
		const state = daemon.getState();
		const banner = [
			"",
			"  \u091A\u093F   D A E M O N",
			"",
			`  Consolidation hour : ${config.consolidationHour ?? 2}:00`,
			`  Backfill days      : ${config.maxBackfillDays ?? 7}`,
			`  Consolidate on idle: ${config.consolidateOnIdle !== false ? "yes" : "no"}`,
			`  Backfill on startup: ${config.backfillOnStartup !== false ? "yes" : "no"}`,
			`  Nidra state        : ${state.nidraState}`,
			"",
			"  Press Ctrl+C to stop.",
			"",
		].join("\n");
		process.stderr.write(banner);
	});

	daemon.on("stopped", () => {
		process.stderr.write("\n  Daemon stopped.\n\n");
	});

	// Graceful shutdown on signals
	const onSignal = () => {
		process.stderr.write("\n  Shutting down daemon...\n");
		daemon
			.stop()
			.then(() => process.exit(0))
			.catch((err) => {
				process.stderr.write(`  Shutdown error: ${(err as Error).message}\n`);
				process.exit(1);
			});
	};

	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	// Start the daemon
	await daemon.start();

	// Keep the process alive — the daemon timers handle the rest
	await new Promise<void>(() => {
		// Intentionally never resolves — daemon runs until signal
	});
}
