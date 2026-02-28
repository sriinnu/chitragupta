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
		// Fall back on any daemon connectivity error, not just DaemonUnavailableError.
		// Raw ENOENT/ECONNREFUSED from connect() and circuit-open errors all land here.
		if (
			err instanceof DaemonUnavailableError ||
			(err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
			(err as NodeJS.ErrnoException).code === "ENOENT"
		) {
			log.warn("Daemon unavailable, using direct fallback", {
				method,
				error: err instanceof Error ? err.message : String(err),
			});
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

// ─── Write Methods (single-writer through daemon) ───────────────────────────

/** Extract and save facts from text through daemon (single-writer). */
export async function extractFacts(
	text: string,
	projectPath?: string,
): Promise<{ extracted: number }> {
	return daemonCall("fact.extract", { text, projectPath });
}

/** Append to memory through daemon (single-writer). */
export async function appendMemoryViaDaemon(
	scopeType: "global" | "project",
	entry: string,
	scopePath?: string,
): Promise<void> {
	await daemonCall("memory.append", { scopeType, entry, scopePath });
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

/**
 * Methods that have a working direct smriti fallback.
 * Only methods with an implemented switch case below are listed.
 * Every entry MUST have a corresponding case — no silent `{}` returns.
 */
const FALLBACK_METHODS = new Set([
	"session.list", "session.show", "session.dates", "session.projects",
	"turn.list",
	"daemon.ping", "daemon.health",
]);

/**
 * Direct smriti fallback for when daemon is unreachable.
 *
 * Only read operations with a concrete implementation are allowed.
 * Writes and unimplemented reads throw to prevent silent data loss.
 */
async function directFallback<T>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	if (!FALLBACK_METHODS.has(method)) {
		throw new DaemonUnavailableError(
			`Operation '${method}' requires daemon — ` +
			"start daemon or reset circuit breaker",
		);
	}

	// Lazy-import smriti only when needed
	const smriti = await import("@chitragupta/smriti");

	switch (method) {
		case "session.list": {
			const sessions = smriti.listSessions(
				params?.project as string | undefined,
			);
			return { sessions } as T;
		}
		case "session.show": {
			const session = smriti.loadSession(
				params?.id as string, params?.project as string,
			);
			return session as T;
		}
		case "session.dates": {
			const dates = smriti.listSessionDates();
			return { dates } as T;
		}
		case "session.projects": {
			const projects = smriti.listSessionProjects();
			return { projects } as T;
		}
		case "turn.list": {
			const turns = smriti.listTurnsWithTimestamps(
				params?.sessionId as string,
			);
			return { turns } as T;
		}
		case "daemon.ping":
			return { pong: false, mode: "direct-fallback" } as T;
		case "daemon.health":
			return { status: "degraded", mode: "direct-fallback" } as T;
		default:
			// Unreachable — FALLBACK_METHODS gate ensures only implemented methods reach here.
			throw new DaemonUnavailableError(`No fallback for '${method}'`);
	}
}
