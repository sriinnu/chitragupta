/**
 * @chitragupta/dharma — Dvaara: Approval gate for human-in-the-loop decisions.
 * Named after the Sanskrit word for "gate/door" — the threshold that actions
 * must pass through when autonomous authority is insufficient.
 */

import { randomUUID } from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied" | "timeout";

export interface ApprovalRequest {
	id: string;
	agentId: string;
	sessionId: string;
	/** What is being requested. */
	action: string;
	/** Why approval is needed. */
	reason: string;
	/** Additional context for the reviewer. */
	context?: Record<string, unknown>;
	/** When the request was created (epoch ms). */
	createdAt: number;
	/** When the request expires and auto-denies (epoch ms). */
	expiresAt: number;
	/** Current status. */
	status: ApprovalStatus;
	/** Who resolved it (human identifier). */
	resolvedBy?: string;
	/** Resolution reason (especially for denials). */
	resolutionReason?: string;
	/** Resolution timestamp (epoch ms). */
	resolvedAt?: number;
}

export interface ApprovalGateConfig {
	/** Default timeout in ms before auto-deny. Default: 300_000 (5 min). */
	defaultTimeout?: number;
	/** Maximum pending requests allowed. Default: 100. */
	maxPending?: number;
}

type ApprovalHandler = (request: ApprovalRequest) => void;
type ApprovalEventType = "requested" | "approved" | "denied" | "timeout";

// ─── Approval Gate ─────────────────────────────────────────────────────────

/**
 * Human-in-the-loop approval gate with configurable timeouts and event hooks.
 *
 * When a policy verdict demands human approval (e.g. destructive commands,
 * high-cost operations), the agent creates an approval request through
 * this gate. The request enters a pending state and the agent suspends
 * until a human approves, denies, or the timeout elapses (auto-deny).
 *
 * @example
 * ```ts
 * const gate = new ApprovalGate({ defaultTimeout: 60_000 });
 * const id = gate.requestApproval({
 *   agentId: "agent-1", sessionId: "s-1",
 *   action: "rm -rf /tmp/build", reason: "Cleanup stale build artifacts",
 * });
 * const status = await gate.waitForApproval(id);
 * ```
 */
export class ApprovalGate {
	private requests = new Map<string, ApprovalRequest>();
	private waiters = new Map<string, { resolve: (status: ApprovalStatus) => void }>();
	private handlers: { event: ApprovalEventType; fn: ApprovalHandler }[] = [];
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly defaultTimeout: number;
	private readonly maxPending: number;

	constructor(config?: ApprovalGateConfig) {
		this.defaultTimeout = config?.defaultTimeout ?? 300_000;
		this.maxPending = config?.maxPending ?? 100;
	}

	// ─── Request ─────────────────────────────────────────────────────────

	/**
	 * Create a new approval request. Returns the request ID immediately.
	 * A timeout timer starts; if no resolution arrives before expiry,
	 * the request auto-denies with status "timeout".
	 *
	 * @throws If the pending queue is full.
	 */
	requestApproval(params: {
		agentId: string;
		sessionId: string;
		action: string;
		reason: string;
		context?: Record<string, unknown>;
		timeout?: number;
	}): string {
		const pendingCount = this.getPending().length;
		if (pendingCount >= this.maxPending) {
			throw new Error(
				`Approval gate full: ${pendingCount} pending requests (max ${this.maxPending})`,
			);
		}

		const now = Date.now();
		const timeout = params.timeout ?? this.defaultTimeout;
		const id = randomUUID();

		const request: ApprovalRequest = {
			id,
			agentId: params.agentId,
			sessionId: params.sessionId,
			action: params.action,
			reason: params.reason,
			context: params.context,
			createdAt: now,
			expiresAt: now + timeout,
			status: "pending",
		};

		this.requests.set(id, request);

		// Auto-deny on timeout
		const timer = setTimeout(() => {
			this.resolveRequest(id, "timeout", "Auto-denied: approval timeout elapsed", "system");
		}, timeout);
		this.timers.set(id, timer);

		this.emit("requested", request);
		return id;
	}

	// ─── Wait ────────────────────────────────────────────────────────────

	/**
	 * Wait for a request to be resolved. Resolves immediately if the
	 * request is already in a terminal state; otherwise suspends until
	 * approved, denied, or timed out.
	 *
	 * @throws If the request ID is unknown.
	 */
	waitForApproval(requestId: string): Promise<ApprovalStatus> {
		const request = this.requests.get(requestId);
		if (!request) {
			throw new Error(`Unknown approval request: ${requestId}`);
		}

		if (request.status !== "pending") {
			return Promise.resolve(request.status);
		}

		return new Promise<ApprovalStatus>((resolve) => {
			this.waiters.set(requestId, { resolve });
		});
	}

	// ─── Resolution ──────────────────────────────────────────────────────

	/** Approve a pending request. Returns false if the request is not pending. */
	approve(requestId: string, resolvedBy?: string): boolean {
		return this.resolveRequest(requestId, "approved", undefined, resolvedBy);
	}

	/** Deny a pending request with an optional reason. Returns false if not pending. */
	deny(requestId: string, reason?: string, resolvedBy?: string): boolean {
		return this.resolveRequest(requestId, "denied", reason, resolvedBy);
	}

	/** Internal resolution logic shared by approve, deny, and timeout. */
	private resolveRequest(
		requestId: string,
		status: ApprovalStatus,
		reason?: string,
		resolvedBy?: string,
	): boolean {
		const request = this.requests.get(requestId);
		if (!request || request.status !== "pending") {
			return false;
		}

		request.status = status;
		request.resolvedAt = Date.now();
		request.resolvedBy = resolvedBy;
		if (reason) request.resolutionReason = reason;

		// Clear timeout timer
		const timer = this.timers.get(requestId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(requestId);
		}

		// Resolve any suspended waiter
		const waiter = this.waiters.get(requestId);
		if (waiter) {
			waiter.resolve(status);
			this.waiters.delete(requestId);
		}

		// Emit event (map status to event type)
		const eventType: ApprovalEventType =
			status === "approved" ? "approved"
				: status === "denied" ? "denied"
					: "timeout";
		this.emit(eventType, request);

		return true;
	}

	// ─── Queries ─────────────────────────────────────────────────────────

	/** Get a request by ID. */
	get(requestId: string): ApprovalRequest | undefined {
		return this.requests.get(requestId);
	}

	/** Get all pending (unresolved) requests. */
	getPending(): ApprovalRequest[] {
		return [...this.requests.values()].filter((r) => r.status === "pending");
	}

	/** Get all requests including resolved ones. */
	getAll(): ApprovalRequest[] {
		return [...this.requests.values()];
	}

	// ─── Events ──────────────────────────────────────────────────────────

	/**
	 * Register an event handler. Returns an unsubscribe function.
	 * Events: "requested", "approved", "denied", "timeout".
	 */
	on(event: ApprovalEventType, handler: ApprovalHandler): () => void {
		const entry = { event, fn: handler };
		this.handlers.push(entry);
		return () => {
			const idx = this.handlers.indexOf(entry);
			if (idx !== -1) this.handlers.splice(idx, 1);
		};
	}

	/** Emit an event to all matching handlers. */
	private emit(event: ApprovalEventType, request: ApprovalRequest): void {
		for (const h of this.handlers) {
			if (h.event === event) {
				try {
					h.fn(request);
				} catch {
					// Handler errors must not break the gate
				}
			}
		}
	}

	// ─── Maintenance ─────────────────────────────────────────────────────

	/**
	 * Remove all resolved (non-pending) requests from memory.
	 * Useful for long-running sessions to reclaim memory.
	 */
	cleanup(): void {
		for (const [id, request] of this.requests) {
			if (request.status !== "pending") {
				this.requests.delete(id);
				this.waiters.delete(id);
			}
		}
	}

	/**
	 * Destroy the gate: cancel all pending timers, reject all waiters,
	 * and clear all internal state. The gate should not be used after this.
	 */
	destroy(): void {
		// Cancel all timers
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();

		// Auto-deny all pending requests so waiters resolve
		for (const request of this.requests.values()) {
			if (request.status === "pending") {
				request.status = "denied";
				request.resolvedAt = Date.now();
				request.resolutionReason = "Gate destroyed";
				request.resolvedBy = "system";
			}
		}

		// Resolve all waiters with "denied"
		for (const waiter of this.waiters.values()) {
			waiter.resolve("denied");
		}

		this.waiters.clear();
		this.requests.clear();
		this.handlers.length = 0;
	}
}
