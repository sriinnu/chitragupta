/**
 * @chitragupta/daemon — Daemon entry point.
 *
 * Spawned as a detached background process. Initializes:
 * 1. Socket server (RPC for all clients)
 * 2. Nidra consolidation (cron at 2am, backfill on wake)
 * 3. PID file + signal handling
 *
 * @module
 */

import { createLogger } from "@chitragupta/core";
import { resolvePaths, ensureDirs } from "./paths.js";
import { writePid, installSignalHandlers } from "./process.js";
import { RpcRouter } from "./rpc-router.js";
import { startServer, type DaemonServer } from "./server.js";
import { startHttpServer, type DaemonHttpServer } from "./http-server.js";
import { registerServices } from "./services.js";
import { startInternalScarlett, stopInternalScarlett } from "./scarlett-internal.js";

const log = createLogger("daemon:entry");

// ─── Process-Level Resilience ────────────────────────────────────────────────

/**
 * Uncaught exception policy: log and exit.
 *
 * For a single-writer DB process, continuing after unknown state corruption
 * is worse than crashing cleanly. The client's self-healing (HealthMonitor)
 * will detect the death and restart a fresh daemon process.
 */
process.on("uncaughtException", (err) => {
	log.fatal("Uncaught exception — exiting for clean restart", err);
	process.exit(1);
});

/** Unhandled rejections: log and exit (same rationale as uncaught exceptions). */
process.on("unhandledRejection", (reason) => {
	log.fatal("Unhandled rejection — exiting for clean restart",
		reason instanceof Error ? reason : undefined,
		{ reason: reason instanceof Error ? undefined : String(reason) },
	);
	process.exit(1);
});

/** Periodic memory pressure check — warn at 80% of heap limit. */
const HEAP_LIMIT = 256 * 1024 * 1024; // matches --max-old-space-size=256
let memoryWarned = false;

function checkMemoryPressure(): void {
	const { heapUsed } = process.memoryUsage();
	const usage = heapUsed / HEAP_LIMIT;
	if (usage > 0.8 && !memoryWarned) {
		memoryWarned = true;
		log.warn("Memory pressure high", {
			heapUsed: `${(heapUsed / 1024 / 1024).toFixed(0)}MB`,
			limit: `${(HEAP_LIMIT / 1024 / 1024).toFixed(0)}MB`,
			usage: `${(usage * 100).toFixed(0)}%`,
		});
		// Hint to V8 to collect garbage
		if (global.gc) global.gc();
	} else if (usage < 0.6) {
		memoryWarned = false;
	}
}

/** Main daemon bootstrap — called once on process start. */
async function main(): Promise<void> {
	const paths = resolvePaths();
	ensureDirs(paths);

	log.info("Daemon starting", { pid: process.pid, socket: paths.socket });

	// Start memory pressure monitoring (every 30s)
	const memTimer = setInterval(checkMemoryPressure, 30_000);
	memTimer.unref();

	// Build RPC router and register services
	const router = new RpcRouter();
	await registerServices(router);

	// Start socket server
	let server: DaemonServer;
	try {
		server = await startServer({ paths, router });
	} catch (err) {
		log.fatal("Failed to start server", err instanceof Error ? err : undefined);
		process.exit(1);
	}

	// Wire connection count into health report
	router.setConnectionCount(() => server.connectionCount());

	// Start HTTP health server (for menubar/taskbar/browser clients)
	let httpServer: DaemonHttpServer | null = null;
	try {
		httpServer = await startHttpServer({ router });
	} catch (err) {
		log.warn("HTTP health server failed to start — running without it", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Start Nidra consolidation daemon (cron + backfill)
	let nidraStop: (() => Promise<void>) | null = null;
	let nidraInstance: import("./scarlett-internal.js").NidraLike | undefined;
	try {
		const nidraResult = await startNidra(router);
		nidraStop = nidraResult.stop;
		nidraInstance = nidraResult.nidra;
	} catch (err) {
		log.warn("Nidra consolidation failed to start — running without it", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Start InternalScarlett — watches smriti DB, heap, nidra heartbeat, consolidation queue
	try {
		const internalScarlett = startInternalScarlett({ nidra: nidraInstance });
		internalScarlett.on("probe-result", (r) => {
			if (!r.healthy) {
				log.warn("InternalScarlett probe unhealthy", {
					probe: r.probe, severity: r.severity, summary: r.summary,
				});
			}
		});
		internalScarlett.on("recovery-ok", (probe, detail) => {
			log.info("InternalScarlett recovery ok", { probe, detail });
		});
		internalScarlett.on("recovery-failed", (probe, detail) => {
			log.warn("InternalScarlett recovery failed", { probe, detail });
		});
	} catch (err) {
		log.warn("InternalScarlett failed to start — running without it", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Wire shutdown
	const shutdown = async () => {
		log.info("Daemon shutting down");
		stopInternalScarlett();
		if (nidraStop) {
			try { await nidraStop(); } catch { /* best-effort */ }
		}
		if (httpServer) {
			try { await httpServer.stop(); } catch { /* best-effort */ }
		}
		await server.stop();
	};
	router.setShutdown(shutdown);
	installSignalHandlers(shutdown);

	// Write PID file
	writePid(paths.pid);

	// Signal readiness to parent process (if spawned via fork)
	if (process.send) {
		process.send({ ready: true, pid: process.pid });
	}

	log.info("Daemon ready", {
		pid: process.pid,
		socket: paths.socket,
		http: httpServer ? `:${httpServer.port()}` : "disabled",
		methods: router.listMethods().length,
		nidra: nidraStop ? "active" : "disabled",
	});
}

/**
 * Start Nidra deep-sleep consolidation inside the daemon.
 *
 * Runs cron at 2am, backfills missed days on startup.
 * Registers RPC methods for manual consolidation triggers.
 */
async function startNidra(router: RpcRouter): Promise<{ stop: () => Promise<void>; nidra: import("./scarlett-internal.js").NidraLike }> {
	const { ChitraguptaDaemon } = await import("@chitragupta/anina");

	type NidraActivity = "offline" | "listening" | "dreaming" | "consolidating" | "consolidated" | "learning";
	const deriveNidraActivity = (
		summary: {
			running: boolean;
			nidraState: "LISTENING" | "DREAMING" | "DEEP_SLEEP";
		},
		snapshot: {
			state: "LISTENING" | "DREAMING" | "DEEP_SLEEP";
			lastStateChange: number;
			lastHeartbeat: number;
			lastConsolidationStart?: number;
			lastConsolidationEnd?: number;
			consolidationPhase?: string;
			consolidationProgress: number;
		} | null,
		now: number,
	): { activity: NidraActivity; attention: string | null } => {
		if (!summary.running) return { activity: "offline", attention: "nidra_not_running" };
		if (!snapshot) return { activity: "listening", attention: "snapshot_missing" };

		const heartbeatAge = now - snapshot.lastHeartbeat;
		if (heartbeatAge > 8 * 60 * 1000) {
			return { activity: "learning", attention: `heartbeat_stale_${Math.round(heartbeatAge / 1000)}s` };
		}

		if (snapshot.state === "DREAMING" && snapshot.consolidationPhase) {
			return { activity: "consolidating", attention: null };
		}
		if (snapshot.state === "DREAMING") {
			return { activity: "dreaming", attention: null };
		}

		const recentConsolidationEnd = snapshot.lastConsolidationEnd
			? now - snapshot.lastConsolidationEnd
			: Number.POSITIVE_INFINITY;
		if (recentConsolidationEnd <= 10 * 60 * 1000) {
			return { activity: "consolidated", attention: null };
		}

		if (snapshot.state === "DEEP_SLEEP") {
			const deepSleepAge = now - snapshot.lastStateChange;
			if (deepSleepAge > 90 * 60 * 1000) {
				return { activity: "learning", attention: `deep_sleep_long_${Math.round(deepSleepAge / 1000)}s` };
			}
			return { activity: "learning", attention: null };
		}

		return { activity: "listening", attention: null };
	};

	const nidra = new ChitraguptaDaemon({
		consolidationHour: 2,
		maxBackfillDays: 7,
		consolidateOnIdle: true,
		backfillOnStartup: true,
	});

	nidra.on("consolidation", (event: { type: string; date: string; detail?: string }) => {
		log.info("Nidra consolidation", { type: event.type, date: event.date, detail: event.detail });
	});

	nidra.on("error", (err: unknown) => {
		log.warn("Nidra error", { error: err instanceof Error ? err.message : String(err) });
	});

	// Register consolidation RPC methods
	router.register("nidra.status", async () => {
		const summary = nidra.getState();
		const snapshot = nidra.getNidraSnapshot();
		const now = Date.now();
		const activity = deriveNidraActivity(
			{
				running: summary.running,
				nidraState: summary.nidraState,
			},
			snapshot
				? {
					state: snapshot.state,
					lastStateChange: snapshot.lastStateChange,
					lastHeartbeat: snapshot.lastHeartbeat,
					lastConsolidationStart: snapshot.lastConsolidationStart,
					lastConsolidationEnd: snapshot.lastConsolidationEnd,
					consolidationPhase: snapshot.consolidationPhase,
					consolidationProgress: snapshot.consolidationProgress,
				}
				: null,
			now,
		);
		return {
			state: summary.nidraState,
			running: summary.running,
			activity: activity.activity,
			attention: activity.attention,
			lastStateChange: snapshot?.lastStateChange ?? null,
			lastHeartbeat: snapshot?.lastHeartbeat ?? null,
			lastConsolidationStart: snapshot?.lastConsolidationStart ?? null,
			lastConsolidationEnd: snapshot?.lastConsolidationEnd ?? null,
			consolidationPhase: snapshot?.consolidationPhase ?? null,
			consolidationProgress: snapshot?.consolidationProgress ?? 0,
			lastConsolidationDate: summary.lastConsolidation,
			lastBackfillDate: summary.lastBackfill,
			consolidatedDatesCount: summary.consolidatedDates.length,
			uptimeMs: summary.uptime,
			timestamp: now,
		};
	}, "Get Nidra sleep-cycle state");

	router.register("nidra.consolidate", async (params) => {
		const date = typeof params.date === "string" ? params.date : undefined;
		if (date) {
			await nidra.consolidateDate(date);
			return { consolidated: date };
		}
		await nidra.consolidateToday();
		return { consolidated: "today" };
	}, "Trigger manual consolidation");

	await nidra.start();
	log.info("Nidra consolidation active");

	return { stop: () => nidra.stop(), nidra };
}

main().catch((err) => {
	log.fatal("Daemon crashed", err instanceof Error ? err : undefined);
	process.exit(1);
});
