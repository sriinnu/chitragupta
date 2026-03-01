/**
 * Daemon monitoring API routes.
 *
 * Aggregates daemon health, nidra state, DB table counts,
 * circuit breaker state, and triguna into a single endpoint
 * consumed by the Hub dashboard and macOS menubar app.
 *
 * @module routes/daemon-status
 */

import { okResponse, errorResponse } from "../server-response.js";

// ── Duck-typed interfaces (avoid hard import coupling) ──────────

interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
		}) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
	): void;
}

/** Shape returned by `daemon.health` RPC. */
interface DaemonHealth {
	status: string;
	pid: number;
	uptime: number;
	memory: number;
	connections: number;
	methods: number;
}

/** Shape returned by `daemon.status` RPC. */
interface DaemonDbCounts {
	counts: {
		turns: number;
		sessions: number;
		rules: number;
		vidhis: number;
		samskaras: number;
		vasanas: number;
		akashaTraces: number;
	};
	timestamp: number;
}

/** Shape returned by `nidra.status` RPC (if available). */
interface NidraStatus {
	state: string;
	consolidationProgress?: number;
	lastConsolidationEnd?: number;
}

/** Triguna health data shape. */
interface TrigunaData {
	sattva: number;
	rajas: number;
	tamas: number;
}

/** Circuit breaker state. */
interface CircuitState {
	state: string;
	consecutiveFailures: number;
	mode: string;
}

/** Aggregated daemon status response. */
interface AggregatedStatus {
	daemon: {
		alive: boolean;
		pid: number | null;
		uptime: number | null;
		memory: number | null;
		connections: number | null;
		methods: number | null;
	};
	nidra: NidraStatus | null;
	db: DaemonDbCounts["counts"] | null;
	circuit: CircuitState | null;
	triguna: TrigunaData | null;
	timestamp: number;
}

/** Daemon client with an `rpc` call method. */
interface BridgeClient {
	call(method: string, params?: Record<string, unknown>): Promise<unknown>;
	isConnected(): boolean;
}

/** Deps injected from http-api.ts mount site. */
export interface DaemonStatusDeps {
	/** Get the shared daemon client (may be null if daemon is down). */
	getDaemonClient: () => Promise<BridgeClient | null>;
	/** Get triguna data (from intelligence subsystem). */
	getTriguna?: () => { getState(): TrigunaData } | undefined;
	/** Get circuit breaker state (from daemon bridge). */
	getCircuitState?: () => CircuitState | null;
}

/**
 * Mount daemon monitoring routes:
 * - `GET  /api/daemon/status` — aggregated status
 * - `POST /api/daemon/start`  — spawn daemon
 * - `POST /api/daemon/stop`   — stop daemon
 */
export function mountDaemonStatusRoutes(
	server: ServerLike,
	deps: DaemonStatusDeps,
): void {
	// ─── GET /api/daemon/status ────────────────────────────────────
	server.route("GET", "/api/daemon/status", async () => {
		const result: AggregatedStatus = {
			daemon: { alive: false, pid: null, uptime: null, memory: null, connections: null, methods: null },
			nidra: null,
			db: null,
			circuit: deps.getCircuitState?.() ?? null,
			triguna: null,
			timestamp: Date.now(),
		};

		try {
			const client = await deps.getDaemonClient();
			if (!client?.isConnected()) {
				return { status: 200, body: okResponse(result) };
			}

			// Fetch daemon.health + daemon.status in parallel
			const [health, dbStatus, nidra] = await Promise.allSettled([
				client.call("daemon.health") as Promise<DaemonHealth>,
				client.call("daemon.status") as Promise<DaemonDbCounts>,
				client.call("nidra.status") as Promise<NidraStatus>,
			]);

			if (health.status === "fulfilled") {
				const h = health.value;
				result.daemon = {
					alive: true,
					pid: h.pid,
					uptime: h.uptime,
					memory: h.memory,
					connections: h.connections,
					methods: h.methods,
				};
			}

			if (dbStatus.status === "fulfilled") {
				result.db = dbStatus.value.counts;
			}

			if (nidra.status === "fulfilled") {
				result.nidra = nidra.value;
			}
		} catch {
			// Daemon unreachable — return partial result with alive: false
		}

		// Triguna from local subsystem (not RPC)
		try {
			const triguna = deps.getTriguna?.();
			if (triguna) {
				result.triguna = triguna.getState();
			}
		} catch {
			// Triguna unavailable
		}

		return { status: 200, body: okResponse(result) };
	});

	// ─── POST /api/daemon/start ───────────────────────────────────
	server.route("POST", "/api/daemon/start", async () => {
		try {
			const { spawnDaemon } = await import("@chitragupta/daemon");
			const pid = await spawnDaemon();
			return { status: 200, body: okResponse({ pid, started: true }) };
		} catch (err) {
			return {
				status: 500,
				body: errorResponse(`Failed to start daemon: ${(err as Error).message}`),
			};
		}
	});

	// ─── POST /api/daemon/stop ────────────────────────────────────
	server.route("POST", "/api/daemon/stop", async () => {
		try {
			const { stopDaemon } = await import("@chitragupta/daemon");
			const stopped = await stopDaemon();
			return { status: 200, body: okResponse({ stopped }) };
		} catch (err) {
			return {
				status: 500,
				body: errorResponse(`Failed to stop daemon: ${(err as Error).message}`),
			};
		}
	});
}
