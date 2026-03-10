import type { RpcRouter } from "./rpc-router.js";
import { DAEMON_START_MS } from "./services-helpers.js";

/** Daemon introspection methods for observability. */
export function registerDaemonMethods(
	router: RpcRouter,
	db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("daemon.status", async () => {
		const agentDb = db.getAgentDb();
		const mem = process.memoryUsage();

		const count = (table: string): number => {
			try {
				const row = agentDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
				return row?.n ?? 0;
			} catch {
				return 0;
			}
		};

		return {
			version: "0.1.28",
			pid: process.pid,
			uptime: (Date.now() - DAEMON_START_MS) / 1000,
			memory: {
				rss: mem.rss,
				heapUsed: mem.heapUsed,
				heapTotal: mem.heapTotal,
				external: mem.external,
			},
			methods: router.listMethods().length,
			counts: {
				turns: count("turns"),
				sessions: count("sessions"),
				rules: count("consolidation_rules"),
				vidhis: count("vidhis"),
				samskaras: count("samskaras"),
				vasanas: count("vasanas"),
				akashaTraces: count("akasha_traces"),
			},
			timestamp: Date.now(),
		};
	}, "Full daemon status: version, PID, uptime, memory, DB counts");

	router.register("daemon.health", async () => {
		const mem = process.memoryUsage();
		return {
			alive: true,
			pid: process.pid,
			uptime: (Date.now() - DAEMON_START_MS) / 1000,
			memory: mem.rss,
			methods: router.listMethods().length,
			connections: null,
		};
	}, "Lightweight health check for monitoring");
}
