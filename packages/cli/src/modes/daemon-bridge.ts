/**
 * @chitragupta/cli — Daemon bridge with graceful degradation.
 *
 * Provides a lazy-connected daemon client that all MCP tool handlers share.
 * Replaces direct smriti imports with RPC calls through the daemon socket.
 *
 * Resilience lifecycle:
 *   HEALTHY  — all calls go through daemon (single-writer)
 *   DEGRADED — daemon flaky, still trying through daemon
 *   HEALING  — attempting daemon restart (up to 3 times)
 *   DEAD     — falls back to direct smriti access (read-only safe)
 *
 * @module
 */

import { DaemonClient, DaemonUnavailableError, type DaemonClientConfig } from "@chitragupta/daemon";
import { HealthState } from "@chitragupta/daemon/resilience";
import { createLogger } from "@chitragupta/core";

const log = createLogger("cli:daemon-bridge");

/** Current operating mode. */
type BridgeMode = "daemon" | "direct";

/** Singleton client instance. */
let sharedClient: DaemonClient | null = null;
let currentMode: BridgeMode = "daemon";

/**
 * Get the shared daemon client (lazy-connected).
 *
 * First call creates and connects the client.
 * Subsequent calls return the same instance.
 * Auto-starts the daemon if not running.
 */
export async function getDaemonClient(config?: DaemonClientConfig): Promise<DaemonClient> {
	if (sharedClient?.isConnected()) return sharedClient;

	sharedClient = new DaemonClient(config);

	// Wire health state change logging
	sharedClient.health.on("stateChange", (from, to, reason) => {
		log.info("Daemon health state changed", { from, to, reason });
		if (to === HealthState.DEAD) {
			log.warn("Daemon declared DEAD — falling back to direct smriti access");
			currentMode = "direct";
		} else if (to === HealthState.HEALTHY && currentMode === "direct") {
			log.info("Daemon recovered — switching back to daemon mode");
			currentMode = "daemon";
		}
	});

	sharedClient.health.on("healed", (attempts) => {
		log.info("Daemon healed", { restartAttempts: attempts });
	});

	await sharedClient.connect();
	currentMode = "daemon";
	log.info("Connected to daemon");
	return sharedClient;
}

/** Disconnect the shared client (call on shutdown). */
export function disconnectDaemon(): void {
	if (sharedClient) {
		sharedClient.dispose();
		sharedClient = null;
		currentMode = "daemon";
		log.info("Disconnected from daemon");
	}
}

/** Current bridge operating mode. */
export function getBridgeMode(): BridgeMode {
	return currentMode;
}

/** Reset circuit breaker — use after manual daemon restart. */
export function resetDaemonCircuit(): void {
	if (sharedClient) {
		sharedClient.resetCircuit();
		currentMode = "daemon";
		log.info("Circuit breaker reset — will retry daemon");
	}
}

/**
 * Call daemon RPC with automatic fallback.
 *
 * If daemon is DEAD, routes to direct smriti access for read operations.
 * Write operations throw in fallback mode (better to fail than corrupt).
 */
export async function daemonCall<T = unknown>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	// If in direct mode, use smriti fallback
	if (currentMode === "direct") {
		return directFallback<T>(method, params);
	}

	try {
		const client = await getDaemonClient();
		return client.call(method, params) as Promise<T>;
	} catch (err) {
		if (err instanceof DaemonUnavailableError) {
			log.warn("Daemon unavailable, using direct fallback", { method });
			currentMode = "direct";
			return directFallback<T>(method, params);
		}
		throw err;
	}
}

// ─── Session Proxy Methods ──────────────────────────────────────────────────

/** List sessions via daemon. */
export async function listSessions(project?: string): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ sessions: Array<Record<string, unknown>> }>(
		"session.list", project ? { project } : {},
	);
	return result.sessions;
}

/** Show a session by ID. */
export async function showSession(id: string, project: string): Promise<Record<string, unknown>> {
	return daemonCall("session.show", { id, project });
}

/** Create a new session. */
export async function createSession(opts: Record<string, unknown>): Promise<{ id: string }> {
	return daemonCall("session.create", opts);
}

/** Add a turn to a session. */
export async function addTurn(
	sessionId: string,
	project: string,
	turn: Record<string, unknown>,
): Promise<void> {
	await daemonCall("turn.add", { sessionId, project, turn });
}

// ─── Memory Proxy Methods ───────────────────────────────────────────────────

/** Full-text search across turns. */
export async function memorySearch(
	query: string,
	limit = 10,
): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"memory.search", { query, limit },
	);
	return result.results;
}

/** Unified recall across memory layers. */
export async function memoryRecall(
	query: string,
	project?: string,
	limit = 5,
): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"memory.recall", { query, project, limit },
	);
	return result.results;
}

// ─── Daemon Health ──────────────────────────────────────────────────────────

/** Ping the daemon. */
export async function ping(): Promise<boolean> {
	try {
		const result = await daemonCall<{ pong: boolean }>("daemon.ping");
		return result.pong === true;
	} catch {
		return false;
	}
}

/** Get daemon health including resilience state. */
export async function health(): Promise<Record<string, unknown>> {
	const snapshot = sharedClient?.health.getSnapshot();
	try {
		const daemonHealth = await daemonCall<Record<string, unknown>>("daemon.health");
		return { ...daemonHealth, client: snapshot, mode: currentMode };
	} catch {
		return { status: "unreachable", client: snapshot, mode: currentMode };
	}
}

// ─── Direct Smriti Fallback (Degraded Mode) ─────────────────────────────────

/** Read-only methods that can safely fallback to direct smriti access. */
const READ_METHODS = new Set([
	"session.list", "session.show", "session.dates", "session.projects",
	"turn.list", "turn.since",
	"memory.search", "memory.recall",
	"daemon.ping", "daemon.health", "daemon.methods",
	"nidra.status",
]);

/**
 * Direct smriti fallback for when daemon is unreachable.
 *
 * Only read operations are allowed — writes throw to prevent
 * data corruption from concurrent direct access.
 */
async function directFallback<T>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	if (!READ_METHODS.has(method)) {
		throw new DaemonUnavailableError(
			`Write operation '${method}' requires daemon — ` +
			"start daemon or reset circuit breaker",
		);
	}

	// Lazy-import smriti only when needed
	const smriti = await import("@chitragupta/smriti");

	switch (method) {
		case "session.list": {
			const sessions = smriti.listSessions?.(
				params?.project as string | undefined,
			) ?? [];
			return { sessions } as T;
		}
		case "session.show": {
			const session = smriti.getSession?.(
				params?.id as string, params?.project as string,
			);
			return (session ?? {}) as T;
		}
		case "memory.search": {
			const results = smriti.searchTurns?.(
				params?.query as string, params?.limit as number,
			) ?? [];
			return { results } as T;
		}
		case "daemon.ping":
			return { pong: false, mode: "direct-fallback" } as T;
		case "daemon.health":
			return { status: "degraded", mode: "direct-fallback" } as T;
		default:
			return {} as T;
	}
}
