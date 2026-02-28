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
import { registerServices } from "./services.js";

const log = createLogger("daemon:entry");

/** Main daemon bootstrap — called once on process start. */
async function main(): Promise<void> {
	const paths = resolvePaths();
	ensureDirs(paths);

	log.info("Daemon starting", { pid: process.pid, socket: paths.socket });

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

	// Start Nidra consolidation daemon (cron + backfill)
	let nidraStop: (() => Promise<void>) | null = null;
	try {
		nidraStop = await startNidra(router);
	} catch (err) {
		log.warn("Nidra consolidation failed to start — running without it", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	// Wire shutdown
	const shutdown = async () => {
		log.info("Daemon shutting down");
		if (nidraStop) {
			try { await nidraStop(); } catch { /* best-effort */ }
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
async function startNidra(router: RpcRouter): Promise<() => Promise<void>> {
	const { ChitraguptaDaemon } = await import("@chitragupta/anina");

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
		const state = nidra.getState();
		return { state: state.nidraState, running: state.running };
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

	return () => nidra.stop();
}

main().catch((err) => {
	log.fatal("Daemon crashed", err instanceof Error ? err : undefined);
	process.exit(1);
});
