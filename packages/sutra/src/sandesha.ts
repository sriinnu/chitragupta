/**
 * @chitragupta/sutra — Sandesha (सन्देश) — Input Routing.
 *
 * Routes input requests from sub-agents UP to the root/TUI,
 * and delivers responses DOWN to the requesting agent.
 *
 * Two-channel design:
 *   - UP: Events bubble via onEvent chain (agent:input_request)
 *   - DOWN: CommHub delivers InputResolve directly to requesting agent by ID
 *
 * Features:
 *   - Parent interception: any ancestor can answer, deny, or modify
 *   - Concurrent requests queued FIFO
 *   - Timeout with default value — sub-agent never hangs
 */

import type { CommHub } from "./hub.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** An input request from a sub-agent. */
export interface InputRequest {
	/** Unique request ID. */
	requestId: string;
	/** ID of the agent requesting input. */
	agentId: string;
	/** Depth in the agent tree. */
	depth: number;
	/** What the agent is asking for. */
	prompt: string;
	/** Optional default value (used on timeout). */
	defaultValue?: string;
	/** Timeout in ms. Default: 30000. */
	timeoutMs: number;
	/** When the request was created. */
	createdAt: number;
}

/** Response to an input request. */
export interface InputResponse {
	requestId: string;
	agentId: string;
	/** The value provided (by user or ancestor). */
	value: string;
	/** Who answered: "user", "parent", or "timeout". */
	answeredBy: "user" | "parent" | "timeout";
}

/** Configuration for the Sandesha router. */
export interface SandeshaConfig {
	/** Default timeout for input requests. Default: 30000ms. */
	defaultTimeoutMs?: number;
	/** Maximum concurrent pending requests. Default: 10. */
	maxPendingRequests?: number;
	/** CommHub instance for delivering responses. */
	commHub?: CommHub;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Internal tracking entry for a pending input request. */
interface PendingEntry {
	request: InputRequest;
	resolve: (response: InputResponse) => void;
	timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PENDING = 10;

/** CommHub topic used for input request notifications. */
const TOPIC_INPUT_REQUEST = "input:request";

/** CommHub topic used for input resolve delivery. */
const TOPIC_INPUT_RESOLVE = "input:resolve";

// ─── SandeshaRouter ─────────────────────────────────────────────────────────

/**
 * Sandesha Router — routes input requests from sub-agents to TUI/root
 * and delivers responses back to the requesting agent.
 *
 * @example
 * ```ts
 * const router = new SandeshaRouter({ defaultTimeoutMs: 15000 });
 *
 * // Sub-agent requests input (returns a promise)
 * const responsePromise = router.requestInput({
 *   requestId: "req-1",
 *   agentId: "agent-42",
 *   depth: 2,
 *   prompt: "Which file should I modify?",
 *   timeoutMs: 10000,
 * });
 *
 * // TUI resolves the request when user types a response
 * router.resolveInput("req-1", "/src/main.ts", "user");
 *
 * const response = await responsePromise;
 * // => { requestId: "req-1", agentId: "agent-42", value: "/src/main.ts", answeredBy: "user" }
 * ```
 */
export class SandeshaRouter {
	private readonly pendingRequests = new Map<string, PendingEntry>();
	private readonly defaultTimeoutMs: number;
	private readonly maxPendingRequests: number;
	private readonly commHub: CommHub | undefined;
	private readonly requestQueue: InputRequest[] = [];
	private destroyed = false;

	/**
	 * Create a new SandeshaRouter.
	 *
	 * @param config - Optional configuration for timeouts, queue limits, and CommHub.
	 */
	constructor(config?: SandeshaConfig) {
		this.defaultTimeoutMs = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.maxPendingRequests = config?.maxPendingRequests ?? DEFAULT_MAX_PENDING;
		this.commHub = config?.commHub;
	}

	// ─── Public API ────────────────────────────────────────────────────

	/**
	 * Register an input request from a sub-agent.
	 * Returns a promise that resolves when the input is provided,
	 * denied, or timed out.
	 *
	 * @param request - The input request (without createdAt, which is auto-set).
	 * @returns A promise resolving to the InputResponse when answered.
	 * @throws If the router is destroyed or the queue is full.
	 */
	requestInput(
		request: Omit<InputRequest, "createdAt">,
	): Promise<InputResponse> {
		this.assertNotDestroyed();

		if (this.pendingRequests.size >= this.maxPendingRequests) {
			return Promise.reject(
				new Error(
					`Sandesha: max pending requests (${this.maxPendingRequests}) reached. ` +
					`Resolve existing requests before adding more.`,
				),
			);
		}

		const fullRequest: InputRequest = {
			...request,
			timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
			createdAt: Date.now(),
		};

		return new Promise<InputResponse>((resolve) => {
			const timer = setTimeout(() => {
				this.handleTimeout(fullRequest.requestId);
			}, fullRequest.timeoutMs);

			// Prevent timer from keeping the process alive
			if (typeof timer === "object" && "unref" in timer) {
				timer.unref();
			}

			const entry: PendingEntry = {
				request: fullRequest,
				resolve,
				timer,
			};

			this.pendingRequests.set(fullRequest.requestId, entry);
			this.requestQueue.push(fullRequest);

			// Notify via CommHub if available
			if (this.commHub) {
				try {
					this.commHub.broadcast(
						fullRequest.agentId,
						TOPIC_INPUT_REQUEST,
						fullRequest,
					);
				} catch {
					// CommHub may be destroyed — non-fatal
				}
			}
		});
	}

	/**
	 * Resolve a pending input request (called by TUI or parent agent).
	 *
	 * @param requestId - The ID of the request to resolve.
	 * @param value - The input value provided.
	 * @param answeredBy - Who provided the answer. Default: "user".
	 * @returns True if the request was found and resolved; false otherwise.
	 */
	resolveInput(
		requestId: string,
		value: string,
		answeredBy: "user" | "parent" = "user",
	): boolean {
		const entry = this.pendingRequests.get(requestId);
		if (!entry) return false;

		clearTimeout(entry.timer);
		this.pendingRequests.delete(requestId);
		this.removeFromQueue(requestId);

		const response: InputResponse = {
			requestId,
			agentId: entry.request.agentId,
			value,
			answeredBy,
		};

		entry.resolve(response);

		// Deliver via CommHub if available
		if (this.commHub) {
			try {
				this.commHub.send({
					from: "__sandesha__",
					to: entry.request.agentId,
					topic: TOPIC_INPUT_RESOLVE,
					payload: response,
					priority: "high",
				});
			} catch {
				// CommHub may be destroyed — non-fatal
			}
		}

		return true;
	}

	/**
	 * Deny a pending request (parent decides sub-agent should not ask).
	 * Resolves the promise with an empty value and answeredBy "parent".
	 *
	 * @param requestId - The ID of the request to deny.
	 * @param reason - Optional reason for the denial (not sent to agent).
	 * @returns True if the request was found and denied; false otherwise.
	 */
	denyInput(requestId: string, _reason?: string): boolean {
		const entry = this.pendingRequests.get(requestId);
		if (!entry) return false;

		clearTimeout(entry.timer);
		this.pendingRequests.delete(requestId);
		this.removeFromQueue(requestId);

		const response: InputResponse = {
			requestId,
			agentId: entry.request.agentId,
			value: "",
			answeredBy: "parent",
		};

		entry.resolve(response);
		return true;
	}

	/**
	 * Get the FIFO queue of pending requests (for TUI display).
	 * Returns a shallow copy -- safe to iterate without mutation concerns.
	 *
	 * @returns Shallow copy of the pending request queue.
	 */
	getPendingRequests(): InputRequest[] {
		return [...this.requestQueue];
	}

	/**
	 * Check if any requests are pending.
	 *
	 * @returns True if there are unresolved input requests.
	 */
	hasPending(): boolean {
		return this.pendingRequests.size > 0;
	}

	/**
	 * Get the count of pending requests.
	 *
	 * @returns Number of unresolved input requests.
	 */
	get pendingCount(): number {
		return this.pendingRequests.size;
	}

	/**
	 * Cancel all pending requests (on shutdown).
	 * Each pending request is resolved with its defaultValue (or empty string)
	 * and answeredBy "timeout".
	 */
	cancelAll(): void {
		for (const [requestId, entry] of this.pendingRequests) {
			clearTimeout(entry.timer);

			const response: InputResponse = {
				requestId,
				agentId: entry.request.agentId,
				value: entry.request.defaultValue ?? "",
				answeredBy: "timeout",
			};

			entry.resolve(response);
		}

		this.pendingRequests.clear();
		this.requestQueue.length = 0;
	}

	/**
	 * Destroy the router and clean up all timers.
	 * Pending requests are resolved with timeout/default values.
	 * No further operations are allowed after destruction.
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.cancelAll();
	}

	// ─── Private ───────────────────────────────────────────────────────

	/** Handle a request timeout: resolve with defaultValue and "timeout". */
	private handleTimeout(requestId: string): void {
		const entry = this.pendingRequests.get(requestId);
		if (!entry) return;

		this.pendingRequests.delete(requestId);
		this.removeFromQueue(requestId);

		const response: InputResponse = {
			requestId,
			agentId: entry.request.agentId,
			value: entry.request.defaultValue ?? "",
			answeredBy: "timeout",
		};

		entry.resolve(response);
	}

	/** Remove a request from the FIFO queue by ID. */
	private removeFromQueue(requestId: string): void {
		const idx = this.requestQueue.findIndex((r) => r.requestId === requestId);
		if (idx >= 0) {
			this.requestQueue.splice(idx, 1);
		}
	}

	/** Guard against operations on a destroyed router. */
	private assertNotDestroyed(): void {
		if (this.destroyed) {
			throw new Error("SandeshaRouter has been destroyed. No further operations are allowed.");
		}
	}
}
