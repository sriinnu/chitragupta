/**
 * @chitragupta/cli — Daemon bridge core lifecycle and RPC transport.
 *
 * Provides a lazy-connected daemon client that all MCP and CLI handlers share.
 * Direct Smriti fallback is only allowed when explicitly enabled.
 *
 * @module
 */

import { DaemonClient, DaemonUnavailableError, type DaemonClientConfig } from "@chitragupta/daemon";
import { HealthState } from "@chitragupta/daemon/resilience";
import { createLogger } from "@chitragupta/core";
import { directFallback } from "./daemon-bridge-fallback.js";
import { allowLocalRuntimeFallback } from "../runtime-daemon-proxies.js";

const log = createLogger("cli:daemon-bridge");

const DAEMON_DOWN_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES"]);
const DIRECT_REPROBE_INTERVAL_MS = 10_000;

export type BridgeMode = "daemon" | "direct";
export type DaemonNotificationParams = Record<string, unknown> | undefined;
export type DaemonNotificationHandler = (params: DaemonNotificationParams) => void;

let sharedClient: DaemonClient | null = null;
let currentMode: BridgeMode = "daemon";
let clientInitPromise: Promise<DaemonClient> | null = null;
let directProbePromise: Promise<void> | null = null;
let lastDirectProbeAt = 0;
const registeredNotificationHandlers = new Map<string, Set<DaemonNotificationHandler>>();
const activeNotificationBindings = new Map<string, Map<DaemonNotificationHandler, () => void>>();

function isDaemonUnavailable(err: unknown): boolean {
	if (err instanceof DaemonUnavailableError) return true;
	const code = (err as NodeJS.ErrnoException).code;
	return typeof code === "string" && DAEMON_DOWN_CODES.has(code);
}

function directFallbackDisabledError(method: string, err?: unknown): DaemonUnavailableError {
	const detail = err instanceof Error ? err.message : err == null ? "" : String(err);
	return new DaemonUnavailableError(
		`Daemon unavailable for ${method}; local runtime fallback is disabled${detail ? ` (${detail})` : ""}`,
	);
}

function bindNotificationHandler(
	client: DaemonClient,
	method: string,
	handler: DaemonNotificationHandler,
): void {
	const current = activeNotificationBindings.get(method);
	const existing = current?.get(handler);
	if (existing) existing();
	const unsubscribe = client.onNotification(method, handler);
	const next = current ?? new Map<DaemonNotificationHandler, () => void>();
	next.set(handler, unsubscribe);
	activeNotificationBindings.set(method, next);
}

function bindRegisteredNotifications(client: DaemonClient): void {
	activeNotificationBindings.clear();
	for (const [method, handlers] of registeredNotificationHandlers.entries()) {
		for (const handler of handlers) {
			bindNotificationHandler(client, method, handler);
		}
	}
}

function clearActiveNotificationBindings(): void {
	for (const bindings of activeNotificationBindings.values()) {
		for (const unsubscribe of bindings.values()) unsubscribe();
	}
	activeNotificationBindings.clear();
}

export async function getDaemonClient(config?: DaemonClientConfig): Promise<DaemonClient> {
	if (sharedClient?.isConnected()) return sharedClient;
	if (clientInitPromise) return clientInitPromise;

	clientInitPromise = (async (): Promise<DaemonClient> => {
		if (sharedClient) {
			sharedClient.dispose();
			sharedClient = null;
		}

		sharedClient = new DaemonClient(config);
		sharedClient.health.on("stateChange", (from, to, reason) => {
			log.info("Daemon health state changed", { from, to, reason });
			if (to === HealthState.DEAD) {
				log.warn(
					allowLocalRuntimeFallback()
						? "Daemon declared DEAD — falling back to direct smriti access"
						: "Daemon declared DEAD — local runtime fallback disabled",
				);
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
			sharedClient.dispose();
			sharedClient = null;
			throw err instanceof DaemonUnavailableError
				? err
				: new DaemonUnavailableError(err instanceof Error ? err.message : String(err));
		}

		currentMode = "daemon";
		bindRegisteredNotifications(sharedClient);

		// Identify this client's PID, provider, and workspace on the socket
		// so the daemon can enrich runtime items for the menubar display.
		sharedClient.call("client.identify", {
			pid: process.pid,
			provider: process.env.CLAUDE_CODE_ENTRYPOINT ? "claude"
				: process.env.CODEX_THREAD_ID ? "codex"
				: (process.env._ ?? "").toLowerCase().includes("claude") ? "claude"
				: (process.env._ ?? "").toLowerCase().includes("codex") ? "codex"
				: "unknown",
			workspace: process.cwd(),
		}).catch((err: unknown) => {
			log.debug("client.identify failed (non-fatal)", { err: err instanceof Error ? err.message : err });
		});

		log.info("Connected to daemon");
		return sharedClient;
	})();

	try {
		return await clientInitPromise;
	} finally {
		clientInitPromise = null;
	}
}

export function disconnectDaemon(): void {
	if (!sharedClient) return;
	clearActiveNotificationBindings();
	sharedClient.dispose();
	sharedClient = null;
	currentMode = "daemon";
	clientInitPromise = null;
	directProbePromise = null;
	lastDirectProbeAt = 0;
	log.info("Disconnected from daemon");
}

export function getBridgeMode(): BridgeMode {
	return currentMode;
}

export function getDaemonHealthSnapshot(): Record<string, unknown> | undefined {
	return sharedClient?.health.getSnapshot() as Record<string, unknown> | undefined;
}

export function resetDaemonCircuit(): void {
	if (!sharedClient) return;
	sharedClient.resetCircuit();
	currentMode = "daemon";
	lastDirectProbeAt = 0;
	log.info("Circuit breaker reset — will retry daemon");
}

export async function onDaemonNotification(
	method: string,
	handler: DaemonNotificationHandler,
): Promise<() => void> {
	const handlers = registeredNotificationHandlers.get(method) ?? new Set<DaemonNotificationHandler>();
	handlers.add(handler);
	registeredNotificationHandlers.set(method, handlers);

	if (sharedClient?.isConnected()) {
		bindNotificationHandler(sharedClient, method, handler);
	} else {
		try {
			const client = await getDaemonClient();
			bindNotificationHandler(client, method, handler);
		} catch {
			// Best-effort: keep the handler registered and bind it on a later reconnect.
		}
	}

	return () => {
		const currentHandlers = registeredNotificationHandlers.get(method);
		currentHandlers?.delete(handler);
		if (currentHandlers && currentHandlers.size === 0) {
			registeredNotificationHandlers.delete(method);
		}

		const bindings = activeNotificationBindings.get(method);
		const unsubscribe = bindings?.get(handler);
		if (unsubscribe) unsubscribe();
		bindings?.delete(handler);
		if (bindings && bindings.size === 0) {
			activeNotificationBindings.delete(method);
		}
	};
}

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

export async function daemonCall<T = unknown>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	if (currentMode === "direct") {
		await maybeReprobeDaemon();
		if (currentMode !== "direct") {
			const client = await getDaemonClient();
			return client.call(method, params) as Promise<T>;
		}
		if (!allowLocalRuntimeFallback()) {
			throw directFallbackDisabledError(method);
		}
		return directFallback<T>(method, params);
	}

	try {
		const client = await getDaemonClient();
		return client.call(method, params) as Promise<T>;
	} catch (err) {
		if (!isDaemonUnavailable(err)) throw err;
		currentMode = "direct";
		if (!allowLocalRuntimeFallback()) {
			log.warn("Daemon unavailable and local runtime fallback is disabled", {
				method,
				error: err instanceof Error ? err.message : String(err),
			});
			throw directFallbackDisabledError(method, err);
		}
		log.warn("Daemon unavailable, using direct fallback", {
			method,
			error: err instanceof Error ? err.message : String(err),
		});
		return directFallback<T>(method, params);
	}
}
