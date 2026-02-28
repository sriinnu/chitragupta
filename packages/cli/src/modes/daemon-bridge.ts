/**
 * @chitragupta/cli — Daemon bridge for MCP tools.
 *
 * Provides a lazy-connected daemon client that all MCP tool handlers share.
 * Replaces direct smriti imports with RPC calls through the daemon socket.
 *
 * This is the HARD CUT: MCP tools no longer access databases directly.
 * All writes go through the daemon (single-writer pattern).
 *
 * @module
 */

import { DaemonClient, type DaemonClientConfig } from "@chitragupta/daemon";
import { createLogger } from "@chitragupta/core";

const log = createLogger("cli:daemon-bridge");

/** Singleton client instance. */
let sharedClient: DaemonClient | null = null;

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
	await sharedClient.connect();
	log.info("Connected to daemon");
	return sharedClient;
}

/** Disconnect the shared client (call on shutdown). */
export function disconnectDaemon(): void {
	if (sharedClient) {
		sharedClient.disconnect();
		sharedClient = null;
		log.info("Disconnected from daemon");
	}
}

/** Convenience: call daemon RPC and return typed result. */
export async function daemonCall<T = unknown>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	const client = await getDaemonClient();
	return client.call(method, params) as Promise<T>;
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

/** Get daemon health. */
export async function health(): Promise<Record<string, unknown>> {
	return daemonCall("daemon.health");
}
