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

/** Socket error codes that indicate daemon is not reachable. */
const DAEMON_DOWN_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES"]);

/**
 * Classify whether an error means the daemon is unreachable.
 *
 * Matches:
 * - DaemonUnavailableError (from client circuit breaker / selfHeal / getDaemonClient)
 * - Raw socket errno codes (ECONNREFUSED, ENOENT, EACCES)
 */
function isDaemonUnavailable(err: unknown): boolean {
	if (err instanceof DaemonUnavailableError) return true;
	const code = (err as NodeJS.ErrnoException).code;
	return typeof code === "string" && DAEMON_DOWN_CODES.has(code);
}

/** Current operating mode. */
type BridgeMode = "daemon" | "direct";

/** Singleton client instance. */
let sharedClient: DaemonClient | null = null;
let currentMode: BridgeMode = "daemon";
let clientInitPromise: Promise<DaemonClient> | null = null;
let directProbePromise: Promise<void> | null = null;
let lastDirectProbeAt = 0;

/** Minimum interval between daemon probes while in direct-fallback mode. */
const DIRECT_REPROBE_INTERVAL_MS = 10_000;

/**
 * Get the shared daemon client (lazy-connected).
 *
 * First call creates and connects the client.
 * Subsequent calls return the same instance.
 * Auto-starts the daemon if not running.
 */
export async function getDaemonClient(config?: DaemonClientConfig): Promise<DaemonClient> {
	if (sharedClient?.isConnected()) return sharedClient;
	if (clientInitPromise) return clientInitPromise;

	clientInitPromise = (async (): Promise<DaemonClient> => {
		// Dispose previous client to stop leaked heartbeat timers
		if (sharedClient) {
			sharedClient.dispose();
			sharedClient = null;
		}

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

		try {
			await sharedClient.connect();
		} catch (err) {
			// Normalize all connect-time failures to DaemonUnavailableError.
			// connect() can throw raw errno (ENOENT, ECONNREFUSED, EACCES) or
			// non-errno errors ("Failed to connect after N retries",
			// "Daemon startup timed out", "Daemon entry not found").
			// Wrapping here lets daemonCall() classify them uniformly.
			sharedClient.dispose();
			sharedClient = null;
			throw err instanceof DaemonUnavailableError
				? err
				: new DaemonUnavailableError(err instanceof Error ? err.message : String(err));
		}
		currentMode = "daemon";
		log.info("Connected to daemon");
		return sharedClient;
	})();

	try {
		return await clientInitPromise;
	} finally {
		clientInitPromise = null;
	}
}

/** Disconnect the shared client (call on shutdown). */
export function disconnectDaemon(): void {
	if (sharedClient) {
		sharedClient.dispose();
		sharedClient = null;
		currentMode = "daemon";
		clientInitPromise = null;
		directProbePromise = null;
		lastDirectProbeAt = 0;
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
		lastDirectProbeAt = 0;
		log.info("Circuit breaker reset — will retry daemon");
	}
}

/**
 * While in direct-fallback mode, periodically probe the daemon so we can
 * auto-recover back to single-writer mode without manual reset.
 */
async function maybeReprobeDaemon(): Promise<void> {
	if (currentMode !== "direct") return;
	const now = Date.now();
	if (now - lastDirectProbeAt < DIRECT_REPROBE_INTERVAL_MS) return;
	if (directProbePromise) {
		await directProbePromise;
		return;
	}

	directProbePromise = (async () => {
		lastDirectProbeAt = Date.now();
		try {
			await getDaemonClient({ autoStart: true });
			currentMode = "daemon";
			log.info("Daemon probe succeeded — switching back to daemon mode");
		} catch {
			// Stay in direct mode; next probe attempt is interval-gated.
		} finally {
			directProbePromise = null;
		}
	})();

	await directProbePromise;
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
		await maybeReprobeDaemon();
		if (currentMode !== "direct") {
			const client = await getDaemonClient();
			return client.call(method, params) as Promise<T>;
		}
		return directFallback<T>(method, params);
	}

	try {
		const client = await getDaemonClient();
		return client.call(method, params) as Promise<T>;
	} catch (err) {
		if (isDaemonUnavailable(err)) {
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

// ─── Read-Through Methods (memory files, day files, context) ─────────────────

/** Search memory markdown files via daemon. */
export async function searchMemoryFiles(
	query: string,
): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"memory.file_search", { query },
	);
	return result.results;
}

/** List available memory scopes via daemon. */
export async function listMemoryScopesViaDaemon(): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ scopes: Array<Record<string, unknown>> }>(
		"memory.scopes",
	);
	return result.scopes;
}

/** Read a consolidated day file via daemon. */
export async function readDayFileViaDaemon(
	date: string,
): Promise<string | null> {
	const result = await daemonCall<{ content: string | null }>("day.show", { date });
	return result.content;
}

/** List available day files via daemon. */
export async function listDayFilesViaDaemon(): Promise<string[]> {
	const result = await daemonCall<{ dates: string[] }>("day.list");
	return result.dates;
}

/** Search across day files via daemon. */
export async function searchDayFilesViaDaemon(
	query: string,
	opts?: { limit?: number },
): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"day.search", { query, limit: opts?.limit ?? 10 },
	);
	return result.results;
}

/** Load provider context via daemon. */
export async function loadContextViaDaemon(
	project: string,
): Promise<{ assembled: string; itemCount: number }> {
	return daemonCall("context.load", { project });
}

/** Unified recall across all memory layers via daemon. */
export async function unifiedRecall(query: string, opts?: { project?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ results: Array<Record<string, unknown>> }>("memory.unified_recall", { query, project: opts?.project, limit: opts?.limit ?? 5 })).results;
}

/** Get turns since a given turn number via daemon. */
export async function getTurnsSinceViaDaemon(sessionId: string, sinceTurn: number): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ turns: Array<Record<string, unknown>> }>("turn.since", { sessionId, sinceTurnNumber: sinceTurn })).turns;
}

/** Get max turn number for a session via daemon. */
export async function getMaxTurnNumberViaDaemon(sessionId: string): Promise<number> {
	return (await daemonCall<{ maxTurn: number }>("turn.max_number", { sessionId })).maxTurn;
}

/** Get sessions modified since a timestamp via daemon. */
export async function getSessionsModifiedSinceViaDaemon(project: string, sinceMs: number): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ sessions: Array<Record<string, unknown>> }>("session.modified_since", { project, sinceMs })).sessions;
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
	"session.modified_since",
	"turn.list", "turn.since", "turn.max_number",
	"memory.file_search", "memory.scopes", "memory.unified_recall",
	"day.show", "day.list", "day.search",
	"context.load",
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
			const dates = smriti.listSessionDates(
				typeof params?.project === "string" ? params.project : undefined,
			);
			return { dates } as T;
		}
		case "session.projects": {
			const projects = smriti.listSessionProjects();
			return { projects } as T;
		}
		case "turn.list": {
			const turns = smriti.listTurnsWithTimestamps(
				params?.sessionId as string,
				params?.project as string,
			);
			return { turns } as T;
		}
		case "memory.file_search": {
			const search = await import("@chitragupta/smriti/search");
			return { results: search.searchMemory(params?.query as string) } as T;
		}
		case "memory.scopes": {
			const memStore = await import("@chitragupta/smriti/memory-store");
			return { scopes: memStore.listMemoryScopes() } as T;
		}
		case "day.show": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { date: params?.date, content: dayCon.readDayFile(params?.date as string) ?? null } as T;
		}
		case "day.list": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { dates: dayCon.listDayFiles() } as T;
		}
		case "day.search": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { results: dayCon.searchDayFiles(params?.query as string, { limit: Number(params?.limit ?? 10) }) } as T;
		}
		case "context.load": {
			const provider = await import("@chitragupta/smriti/provider-bridge");
			const ctx = await provider.loadProviderContext(params?.project as string);
			return { assembled: ctx.assembled, itemCount: ctx.itemCount } as T;
		}
		case "memory.unified_recall": {
			const { recall } = await import("@chitragupta/smriti/unified-recall");
			const recallResults = await recall(
				params?.query as string,
				{ limit: Number(params?.limit ?? 5), project: params?.project as string | undefined },
			);
			return { results: recallResults } as T;
		}
		case "turn.since": {
			const turns = smriti.getTurnsSince(
				params?.sessionId as string, Number(params?.sinceTurnNumber ?? 0),
			);
			return { turns } as T;
		}
		case "turn.max_number": {
			const maxTurn = smriti.getMaxTurnNumber(params?.sessionId as string);
			return { maxTurn } as T;
		}
		case "session.modified_since": {
			const modified = smriti.getSessionsModifiedSince(
				params?.project as string, Number(params?.sinceMs ?? 0),
			);
			return { sessions: modified } as T;
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
