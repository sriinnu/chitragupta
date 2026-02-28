/**
 * @chitragupta/daemon — JSON-RPC method router.
 *
 * Registers handler functions by method name, dispatches requests.
 * Built-in methods: daemon.ping, daemon.health, daemon.shutdown.
 *
 * @module
 */

import { createLogger } from "@chitragupta/core";
import { ErrorCode } from "./protocol.js";

const log = createLogger("daemon:router");

/** Handler function for a single RPC method. */
export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** Method metadata for introspection. */
export interface MethodMeta {
	name: string;
	description: string;
}

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
	private shutdownFn: (() => Promise<void>) | null = null;
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

	/**
	 * Dispatch a method call to its handler.
	 * Throws RpcMethodError on method-not-found or handler errors.
	 */
	async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
		const handler = this.handlers.get(method);
		if (!handler) {
			throw new RpcMethodError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
		}

		const start = performance.now();
		try {
			const result = await handler(params);
			const elapsed = performance.now() - start;
			log.debug("Method handled", { method, elapsed: `${elapsed.toFixed(1)}ms` });
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
			connections: 0, // filled by server
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
}
