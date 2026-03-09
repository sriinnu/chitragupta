/**
 * @chitragupta/daemon — JSON-RPC method router.
 *
 * Registers handler functions by method name, dispatches requests,
 * tracks connected clients, and exposes server-push notifications.
 *
 * @module
 */

import { createLogger } from "@chitragupta/core";
import { ErrorCode, type RpcNotification } from "./protocol.js";
import type {
	MethodMeta,
	RpcClientSnapshot,
	RpcHandler,
	RpcInvocationContext,
	RpcNotifier,
	RpcObservationRecord,
	RpcPatternSummary,
	TrackedClient,
} from "./rpc-router-types.js";
export type {
	MethodMeta,
	RpcClientSnapshot,
	RpcHandler,
	RpcInvocationContext,
	RpcNotifier,
	RpcObservationRecord,
	RpcPatternSummary,
} from "./rpc-router-types.js";

const log = createLogger("daemon:router");

const MAX_OBSERVATIONS_PER_CLIENT = 50;
const MAX_TOP_PATTERNS = 5;

/** Typed error with JSON-RPC error code. */
export class RpcMethodError extends Error {
	code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/** JSON-RPC method router. */
export class RpcRouter {
	private readonly handlers = new Map<string, RpcHandler>();
	private readonly meta = new Map<string, MethodMeta>();
	private readonly clients = new Map<string, TrackedClient>();
	private shutdownFn: (() => Promise<void>) | null = null;
	private connectionCountFn: (() => number) | null = null;
	private notifier: RpcNotifier | null = null;
	private readonly startedAt = Date.now();

	constructor() {
		this.registerBuiltins();
	}

	/** Register a method handler. */
	register(name: string, handler: RpcHandler, description = ""): void {
		if (this.handlers.has(name)) {
			log.warn("Overwriting method handler", { method: name });
		}
		this.handlers.set(name, handler);
		this.meta.set(name, { name, description });
	}

	/** Check if a method is registered. */
	has(name: string): boolean {
		return this.handlers.has(name);
	}

	/** List all registered methods. */
	listMethods(): MethodMeta[] {
		return Array.from(this.meta.values());
	}

	/** Set the shutdown callback (called by daemon.shutdown). */
	setShutdown(fn: () => Promise<void>): void {
		this.shutdownFn = fn;
	}

	/** Set the connection count provider (wired by server after startup). */
	setConnectionCount(fn: () => number): void {
		this.connectionCountFn = fn;
	}

	/** Set the notification delivery surface (wired by the socket server). */
	setNotifier(notifier: RpcNotifier | null): void {
		this.notifier = notifier;
	}

	/** Whether server-push notifications are currently available. */
	hasNotifier(): boolean {
		return this.notifier !== null;
	}

	/** Emit a JSON-RPC notification to connected clients. */
	notify(
		method: string,
		params: Record<string, unknown> = {},
		targetClientIds?: readonly string[],
	): number {
		if (!this.notifier) return 0;
		return this.notifier({ jsonrpc: "2.0", method, params }, targetClientIds);
	}

	/** Register a connected client. */
	attachClient(
		id: string,
		options: {
			transport?: "socket" | "http" | "internal" | "unknown";
			connectedAt?: number;
		} = {},
	): RpcClientSnapshot {
		const now = options.connectedAt ?? Date.now();
		const existing = this.clients.get(id);
		if (existing) {
			existing.transport = options.transport ?? existing.transport;
			existing.lastSeenAt = now;
			return this.toSnapshot(existing);
		}

		const client: TrackedClient = {
			id,
			transport: options.transport ?? "unknown",
			connectedAt: now,
			lastSeenAt: now,
			requestCount: 0,
			notificationCount: 0,
			preferences: {},
			observations: [],
			patterns: new Map(),
			lastObservationAt: null,
		};
		this.clients.set(id, client);
		return this.toSnapshot(client);
	}

	/** Remove a tracked client. */
	detachClient(id: string): void {
		this.clients.delete(id);
	}

	/** Mark a client active even if the transport did not send a request body. */
	markClientSeen(
		id: string,
		options: {
			kind?: "request" | "notification";
			transport?: "socket" | "http" | "internal" | "unknown";
		} = {},
	): RpcClientSnapshot {
		const client = this.ensureClient(id, options.transport);
		client.lastSeenAt = Date.now();
		if (options.transport) {
			client.transport = options.transport;
		}
		if (options.kind === "notification") {
			client.notificationCount += 1;
		} else {
			client.requestCount += 1;
		}
		return this.toSnapshot(client);
	}

	/** Store per-client preferences on the daemon side. */
	updateClientPreferences(id: string, patch: Record<string, unknown>): RpcClientSnapshot {
		const client = this.ensureClient(id);
		client.preferences = { ...client.preferences, ...patch };
		client.lastSeenAt = Date.now();
		return this.toSnapshot(client);
	}

	/** Record a batch of observations and derive repeated patterns. */
	recordObservations(
		id: string,
		inputs: Array<Record<string, unknown>>,
	): { accepted: number; recorded: RpcObservationRecord[]; patterns: RpcPatternSummary[] } {
		const client = this.ensureClient(id);
		const recorded = inputs.map((input) => {
			const recordedAt = typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
				? input.timestamp
				: Date.now();
			return this.normalizeObservation(id, input, recordedAt);
		});
		const touchedPatterns = new Set<string>();

		for (const observation of recorded) {
			client.observations.push(observation);
			if (client.observations.length > MAX_OBSERVATIONS_PER_CLIENT) {
				client.observations.shift();
			}
			client.lastObservationAt = observation.recordedAt;
			client.lastSeenAt = observation.recordedAt;

			const key = this.patternKey(observation);
			const current = client.patterns.get(key);
			if (current) {
				current.count += 1;
				current.lastSeenAt = observation.recordedAt;
				if (!current.sample && observation.summary) current.sample = observation.summary;
			} else {
				client.patterns.set(key, {
					clientId: id,
					key,
					type: observation.type,
					entity: observation.entity,
					severity: observation.severity,
					count: 1,
					lastSeenAt: observation.recordedAt,
					sample: observation.summary,
				});
			}
			touchedPatterns.add(key);
		}

		return {
			accepted: recorded.length,
			recorded,
			patterns: Array.from(touchedPatterns)
				.map((key) => client.patterns.get(key))
				.filter((pattern): pattern is RpcPatternSummary => !!pattern)
				.sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt),
		};
	}

	/** Get one tracked client by ID. */
	getClient(id: string): RpcClientSnapshot | null {
		const client = this.clients.get(id);
		return client ? this.toSnapshot(client) : null;
	}

	/** List connected client snapshots. */
	getClientSnapshots(): RpcClientSnapshot[] {
		return Array.from(this.clients.values())
			.map((client) => this.toSnapshot(client))
			.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
	}

	/** Current tracked client count. */
	getTrackedClientCount(): number {
		return this.clients.size;
	}

	/** Flatten recent observations for inspection. */
	getRecentObservations(limit = 20, clientId?: string): RpcObservationRecord[] {
		const source = clientId
			? [this.clients.get(clientId)].filter((client): client is TrackedClient => !!client)
			: Array.from(this.clients.values());
		return source
			.flatMap((client) => client.observations)
			.sort((a, b) => b.recordedAt - a.recordedAt)
			.slice(0, limit);
	}

	/** Query derived observation patterns. */
	getPatternSummaries(limit = 10, clientId?: string): RpcPatternSummary[] {
		const source = clientId
			? [this.clients.get(clientId)].filter((client): client is TrackedClient => !!client)
			: Array.from(this.clients.values());
		return source
			.flatMap((client) => Array.from(client.patterns.values()))
			.sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
			.slice(0, limit);
	}

	/** Best-effort runtime state for higher-level health/introspection methods. */
	getRuntimeState(): {
		startedAt: number;
		hasNotifier: boolean;
		connectionCount: number;
		trackedClients: RpcClientSnapshot[];
		observations: RpcObservationRecord[];
		patterns: RpcPatternSummary[];
	} {
		return {
			startedAt: this.startedAt,
			hasNotifier: this.hasNotifier(),
			connectionCount: this.connectionCountFn?.() ?? this.clients.size,
			trackedClients: this.getClientSnapshots(),
			observations: this.getRecentObservations(50),
			patterns: this.getPatternSummaries(20),
		};
	}

	/**
	 * Dispatch a method call to its handler.
	 * Throws RpcMethodError on method-not-found or handler errors.
	 */
	async handle(
		method: string,
		params: Record<string, unknown>,
		context: RpcInvocationContext = {},
	): Promise<unknown> {
		const handler = this.handlers.get(method);
		if (!handler) {
			throw new RpcMethodError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
		}

		const start = performance.now();
		try {
			if (context.clientId) {
				this.markClientSeen(context.clientId, {
					kind: context.kind,
					transport: context.transport,
				});
			}
			const result = await handler(params, context);
			const elapsed = performance.now() - start;
			log.debug("Method handled", {
				method,
				elapsed: `${elapsed.toFixed(1)}ms`,
				clientId: context.clientId,
				transport: context.transport,
			});
			return result;
		} catch (err) {
			if (err instanceof RpcMethodError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			log.error("Method handler error", err instanceof Error ? err : undefined, { method });
			throw new RpcMethodError(ErrorCode.InternalError, message);
		}
	}

	/** Register built-in daemon control methods. */
	private registerBuiltins(): void {
		this.register("daemon.ping", async () => ({ pong: true, ts: Date.now() }), "Health check ping");

		this.register("daemon.health", async () => ({
			status: "ok",
			pid: process.pid,
			uptime: Math.floor((Date.now() - this.startedAt) / 1000),
			memory: process.memoryUsage().heapUsed,
			connections: this.connectionCountFn?.() ?? this.clients.size,
			methods: this.handlers.size,
		}), "Daemon health report");

		this.register("daemon.methods", async () => ({
			methods: this.listMethods(),
		}), "List registered RPC methods");

		this.register("daemon.shutdown", async () => {
			log.info("Shutdown requested via RPC");
			if (this.shutdownFn) {
				// Defer shutdown so the response gets sent first
				setTimeout(() => { this.shutdownFn!().catch(() => process.exit(1)); }, 100);
			}
			return { shutting_down: true };
		}, "Gracefully shut down the daemon");
	}

	private ensureClient(
		id: string,
		transport: "socket" | "http" | "internal" | "unknown" = "unknown",
	): TrackedClient {
		const existing = this.clients.get(id);
		if (existing) return existing;
		this.attachClient(id, { transport });
		return this.clients.get(id)!;
	}

	private normalizeObservation(
		clientId: string,
		input: Record<string, unknown>,
		recordedAt: number,
	): RpcObservationRecord {
		const type = firstString(input.type, input.kind, input.category) ?? "observation";
		const entity = firstString(input.entity, input.target, input.scope) ?? null;
		const severity = firstString(input.severity, input.level) ?? null;
		const summary = firstString(input.summary, input.message, input.note) ?? type;

		return {
			clientId,
			recordedAt,
			type,
			entity,
			severity,
			summary,
			data: { ...input },
		};
	}

	private patternKey(observation: RpcObservationRecord): string {
		return [
			observation.type,
			observation.entity ?? "*",
			observation.severity ?? "*",
		].join("|");
	}

	private toSnapshot(client: TrackedClient): RpcClientSnapshot {
		return {
			id: client.id,
			transport: client.transport,
			connectedAt: client.connectedAt,
			lastSeenAt: client.lastSeenAt,
			requestCount: client.requestCount,
			notificationCount: client.notificationCount,
			preferences: { ...client.preferences },
			observationCount: client.observations.length,
			lastObservationAt: client.lastObservationAt,
			topPatterns: Array.from(client.patterns.values())
				.sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
				.slice(0, MAX_TOP_PATTERNS)
				.map((pattern) => ({ ...pattern })),
		};
	}
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return null;
}
