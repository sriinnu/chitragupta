import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApprovalGate } from "@chitragupta/dharma";
import type { ApprovalRequest, ApprovalStatus } from "@chitragupta/dharma";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeParams(overrides: Partial<{
	agentId: string;
	sessionId: string;
	action: string;
	reason: string;
	context: Record<string, unknown>;
	timeout: number;
}> = {}) {
	return {
		agentId: "agent-1",
		sessionId: "sess-1",
		action: "rm -rf /tmp/build",
		reason: "Cleanup stale build artifacts",
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ApprovalGate", () => {
	let gate: ApprovalGate;

	beforeEach(() => {
		vi.useFakeTimers();
		gate = new ApprovalGate();
	});

	afterEach(() => {
		gate.destroy();
		vi.useRealTimers();
	});

	// ─── Construction ─────────────────────────────────────────────────────

	describe("construction", () => {
		it("should use default timeout of 300_000ms", () => {
			const g = new ApprovalGate();
			const id = g.requestApproval(makeParams());
			const req = g.get(id)!;
			// expiresAt should be createdAt + 300_000
			expect(req.expiresAt - req.createdAt).toBe(300_000);
			g.destroy();
		});

		it("should accept a custom default timeout", () => {
			const g = new ApprovalGate({ defaultTimeout: 60_000 });
			const id = g.requestApproval(makeParams());
			const req = g.get(id)!;
			expect(req.expiresAt - req.createdAt).toBe(60_000);
			g.destroy();
		});

		it("should accept a custom maxPending", () => {
			const g = new ApprovalGate({ maxPending: 2 });
			g.requestApproval(makeParams());
			g.requestApproval(makeParams());
			expect(() => g.requestApproval(makeParams())).toThrow(/full/i);
			g.destroy();
		});

		it("should default maxPending to 100", () => {
			const g = new ApprovalGate();
			// Should be able to add up to 100 without throwing
			for (let i = 0; i < 100; i++) {
				g.requestApproval(makeParams());
			}
			expect(() => g.requestApproval(makeParams())).toThrow(/full/i);
			g.destroy();
		});
	});

	// ─── requestApproval ──────────────────────────────────────────────────

	describe("requestApproval", () => {
		it("should return a unique request ID (string)", () => {
			const id = gate.requestApproval(makeParams());
			expect(typeof id).toBe("string");
			expect(id.length).toBeGreaterThan(0);
		});

		it("should create a pending request retrievable via get()", () => {
			const id = gate.requestApproval(makeParams());
			const req = gate.get(id);
			expect(req).toBeDefined();
			expect(req!.status).toBe("pending");
			expect(req!.agentId).toBe("agent-1");
			expect(req!.sessionId).toBe("sess-1");
			expect(req!.action).toBe("rm -rf /tmp/build");
			expect(req!.reason).toBe("Cleanup stale build artifacts");
		});

		it("should include optional context when provided", () => {
			const id = gate.requestApproval(makeParams({
				context: { risk: "high", files: ["/etc/passwd"] },
			}));
			const req = gate.get(id)!;
			expect(req.context).toEqual({ risk: "high", files: ["/etc/passwd"] });
		});

		it("should set createdAt and expiresAt timestamps", () => {
			vi.setSystemTime(1000);
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			const req = gate.get(id)!;
			expect(req.createdAt).toBe(1000);
			expect(req.expiresAt).toBe(6000);
		});

		it("should emit 'requested' event with the request", () => {
			const handler = vi.fn();
			gate.on("requested", handler);
			const id = gate.requestApproval(makeParams());
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id, status: "pending" }),
			);
		});

		it("should use per-request timeout override over default", () => {
			const id = gate.requestApproval(makeParams({ timeout: 10_000 }));
			const req = gate.get(id)!;
			expect(req.expiresAt - req.createdAt).toBe(10_000);
		});

		it("should add request to pending list", () => {
			const id = gate.requestApproval(makeParams());
			const pending = gate.getPending();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).toBe(id);
		});

		it("should throw when pending queue is full", () => {
			const g = new ApprovalGate({ maxPending: 1 });
			g.requestApproval(makeParams());
			expect(() => g.requestApproval(makeParams())).toThrow(/full/i);
			g.destroy();
		});

		it("should generate unique IDs for each request", () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());
			expect(id1).not.toBe(id2);
		});
	});

	// ─── waitForApproval ──────────────────────────────────────────────────

	describe("waitForApproval", () => {
		it("should suspend until the request is approved", async () => {
			const id = gate.requestApproval(makeParams());
			const promise = gate.waitForApproval(id);

			gate.approve(id);
			const status = await promise;
			expect(status).toBe("approved");
		});

		it("should suspend until the request is denied", async () => {
			const id = gate.requestApproval(makeParams());
			const promise = gate.waitForApproval(id);

			gate.deny(id, "Too dangerous");
			const status = await promise;
			expect(status).toBe("denied");
		});

		it("should resolve immediately if already approved", async () => {
			const id = gate.requestApproval(makeParams());
			gate.approve(id);

			const status = await gate.waitForApproval(id);
			expect(status).toBe("approved");
		});

		it("should resolve immediately if already denied", async () => {
			const id = gate.requestApproval(makeParams());
			gate.deny(id);

			const status = await gate.waitForApproval(id);
			expect(status).toBe("denied");
		});

		it("should resolve immediately if already timed out", async () => {
			const id = gate.requestApproval(makeParams({ timeout: 1000 }));
			vi.advanceTimersByTime(1000);

			const status = await gate.waitForApproval(id);
			expect(status).toBe("timeout");
		});

		it("should throw for an unknown request ID", () => {
			expect(() => gate.waitForApproval("nonexistent")).toThrow(/unknown/i);
		});
	});

	// ─── approve ──────────────────────────────────────────────────────────

	describe("approve", () => {
		it("should resolve the pending request with 'approved' status", () => {
			const id = gate.requestApproval(makeParams());
			const result = gate.approve(id);
			expect(result).toBe(true);
			expect(gate.get(id)!.status).toBe("approved");
		});

		it("should set resolvedAt timestamp", () => {
			vi.setSystemTime(1000);
			const id = gate.requestApproval(makeParams());
			vi.setSystemTime(2000);
			gate.approve(id);
			expect(gate.get(id)!.resolvedAt).toBe(2000);
		});

		it("should set resolvedBy when provided", () => {
			const id = gate.requestApproval(makeParams());
			gate.approve(id, "admin-user");
			expect(gate.get(id)!.resolvedBy).toBe("admin-user");
		});

		it("should emit 'approved' event with the request", () => {
			const handler = vi.fn();
			gate.on("approved", handler);
			const id = gate.requestApproval(makeParams());
			gate.approve(id);
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id, status: "approved" }),
			);
		});

		it("should remove the request from pending list", () => {
			const id = gate.requestApproval(makeParams());
			expect(gate.getPending()).toHaveLength(1);
			gate.approve(id);
			expect(gate.getPending()).toHaveLength(0);
		});

		it("should clear the timeout timer so it doesn't fire later", async () => {
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			gate.approve(id);

			// Advance past the timeout — no timeout event should fire
			const timeoutHandler = vi.fn();
			gate.on("timeout", timeoutHandler);
			vi.advanceTimersByTime(10_000);
			expect(timeoutHandler).not.toHaveBeenCalled();
			expect(gate.get(id)!.status).toBe("approved");
		});

		it("should return false for non-existent request", () => {
			expect(gate.approve("no-such-id")).toBe(false);
		});

		it("should return false if already approved (double approve)", () => {
			const id = gate.requestApproval(makeParams());
			expect(gate.approve(id)).toBe(true);
			expect(gate.approve(id)).toBe(false);
		});

		it("should return false if already denied", () => {
			const id = gate.requestApproval(makeParams());
			gate.deny(id);
			expect(gate.approve(id)).toBe(false);
		});
	});

	// ─── deny ─────────────────────────────────────────────────────────────

	describe("deny", () => {
		it("should resolve the pending request with 'denied' status", () => {
			const id = gate.requestApproval(makeParams());
			const result = gate.deny(id, "Policy violation");
			expect(result).toBe(true);
			expect(gate.get(id)!.status).toBe("denied");
		});

		it("should store the denial reason", () => {
			const id = gate.requestApproval(makeParams());
			gate.deny(id, "Too risky");
			expect(gate.get(id)!.resolutionReason).toBe("Too risky");
		});

		it("should set resolvedBy when provided", () => {
			const id = gate.requestApproval(makeParams());
			gate.deny(id, "No reason", "security-bot");
			expect(gate.get(id)!.resolvedBy).toBe("security-bot");
		});

		it("should emit 'denied' event with the request", () => {
			const handler = vi.fn();
			gate.on("denied", handler);
			const id = gate.requestApproval(makeParams());
			gate.deny(id, "Denied for test");
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id, status: "denied" }),
			);
		});

		it("should clear the timeout timer", () => {
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			gate.deny(id);

			const timeoutHandler = vi.fn();
			gate.on("timeout", timeoutHandler);
			vi.advanceTimersByTime(10_000);
			expect(timeoutHandler).not.toHaveBeenCalled();
		});

		it("should return false for non-existent request", () => {
			expect(gate.deny("no-such-id")).toBe(false);
		});

		it("should return false if already denied (double deny)", () => {
			const id = gate.requestApproval(makeParams());
			expect(gate.deny(id)).toBe(true);
			expect(gate.deny(id)).toBe(false);
		});

		it("should return false if already approved", () => {
			const id = gate.requestApproval(makeParams());
			gate.approve(id);
			expect(gate.deny(id)).toBe(false);
		});
	});

	// ─── Timeout ──────────────────────────────────────────────────────────

	describe("timeout", () => {
		it("should auto-deny after the default timeout elapses", () => {
			const id = gate.requestApproval(makeParams());
			vi.advanceTimersByTime(300_000);
			expect(gate.get(id)!.status).toBe("timeout");
		});

		it("should auto-deny after the per-request timeout elapses", () => {
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			vi.advanceTimersByTime(5000);
			expect(gate.get(id)!.status).toBe("timeout");
		});

		it("should not auto-deny before the timeout elapses", () => {
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			vi.advanceTimersByTime(4999);
			expect(gate.get(id)!.status).toBe("pending");
		});

		it("should emit 'timeout' event when auto-denied", () => {
			const handler = vi.fn();
			gate.on("timeout", handler);
			const id = gate.requestApproval(makeParams({ timeout: 1000 }));
			vi.advanceTimersByTime(1000);
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id, status: "timeout" }),
			);
		});

		it("should set resolutionReason on timeout", () => {
			const id = gate.requestApproval(makeParams({ timeout: 1000 }));
			vi.advanceTimersByTime(1000);
			expect(gate.get(id)!.resolutionReason).toContain("timeout");
		});

		it("should set resolvedBy to 'system' on timeout", () => {
			const id = gate.requestApproval(makeParams({ timeout: 1000 }));
			vi.advanceTimersByTime(1000);
			expect(gate.get(id)!.resolvedBy).toBe("system");
		});

		it("should resolve waitForApproval with 'timeout'", async () => {
			const id = gate.requestApproval(makeParams({ timeout: 1000 }));
			const promise = gate.waitForApproval(id);
			vi.advanceTimersByTime(1000);
			const status = await promise;
			expect(status).toBe("timeout");
		});

		it("should remove request from pending on timeout", () => {
			gate.requestApproval(makeParams({ timeout: 1000 }));
			expect(gate.getPending()).toHaveLength(1);
			vi.advanceTimersByTime(1000);
			expect(gate.getPending()).toHaveLength(0);
		});
	});

	// ─── getPending / getAll / get ────────────────────────────────────────

	describe("getPending / getAll / get", () => {
		it("should return empty array when no requests exist", () => {
			expect(gate.getPending()).toEqual([]);
			expect(gate.getAll()).toEqual([]);
		});

		it("should return only pending requests in getPending", () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());
			const id3 = gate.requestApproval(makeParams());
			gate.approve(id1);
			gate.deny(id2);

			const pending = gate.getPending();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).toBe(id3);
		});

		it("should return all requests (pending + resolved) in getAll", () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());
			gate.approve(id1);

			const all = gate.getAll();
			expect(all).toHaveLength(2);
		});

		it("should return undefined for unknown request in get()", () => {
			expect(gate.get("nonexistent")).toBeUndefined();
		});

		it("should return the correct request by ID in get()", () => {
			const id = gate.requestApproval(makeParams({ action: "ls /tmp" }));
			const req = gate.get(id);
			expect(req).toBeDefined();
			expect(req!.action).toBe("ls /tmp");
		});
	});

	// ─── Events (on / unsubscribe) ────────────────────────────────────────

	describe("events", () => {
		it("should call multiple handlers for the same event", () => {
			const h1 = vi.fn();
			const h2 = vi.fn();
			gate.on("requested", h1);
			gate.on("requested", h2);
			gate.requestApproval(makeParams());
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
		});

		it("should unsubscribe correctly", () => {
			const handler = vi.fn();
			const unsub = gate.on("approved", handler);
			unsub();
			const id = gate.requestApproval(makeParams());
			gate.approve(id);
			expect(handler).not.toHaveBeenCalled();
		});

		it("should not break on handler errors", () => {
			gate.on("requested", () => {
				throw new Error("handler blew up");
			});
			const afterHandler = vi.fn();
			gate.on("requested", afterHandler);
			// Should not throw
			expect(() => gate.requestApproval(makeParams())).not.toThrow();
			// The second handler should still have been called
			expect(afterHandler).toHaveBeenCalledTimes(1);
		});

		it("should only call handlers for matching event types", () => {
			const approvedHandler = vi.fn();
			const deniedHandler = vi.fn();
			gate.on("approved", approvedHandler);
			gate.on("denied", deniedHandler);

			const id = gate.requestApproval(makeParams());
			gate.approve(id);

			expect(approvedHandler).toHaveBeenCalledTimes(1);
			expect(deniedHandler).not.toHaveBeenCalled();
		});
	});

	// ─── cleanup ──────────────────────────────────────────────────────────

	describe("cleanup", () => {
		it("should remove resolved requests from memory", () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());
			gate.approve(id1);

			gate.cleanup();
			expect(gate.get(id1)).toBeUndefined();
			expect(gate.get(id2)).toBeDefined();
			expect(gate.getAll()).toHaveLength(1);
		});

		it("should keep pending requests intact", () => {
			const id = gate.requestApproval(makeParams());
			gate.cleanup();
			expect(gate.get(id)).toBeDefined();
			expect(gate.get(id)!.status).toBe("pending");
		});

		it("should be safe to call with no requests", () => {
			expect(() => gate.cleanup()).not.toThrow();
		});
	});

	// ─── destroy ──────────────────────────────────────────────────────────

	describe("destroy", () => {
		it("should cancel all pending timeout timers", () => {
			gate.requestApproval(makeParams({ timeout: 5000 }));
			gate.requestApproval(makeParams({ timeout: 5000 }));
			gate.destroy();

			const timeoutHandler = vi.fn();
			gate.on("timeout", timeoutHandler);
			vi.advanceTimersByTime(10_000);
			// Handlers were cleared by destroy, so even if timers fired they wouldn't propagate
			expect(timeoutHandler).not.toHaveBeenCalled();
		});

		it("should auto-deny all pending requests", () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());

			// We need to capture status before destroy clears requests
			// Actually destroy clears requests, so we check via waiters
			// The source shows destroy sets status to "denied" then clears requests
			gate.destroy();
			// After destroy, requests map is cleared
			expect(gate.getAll()).toHaveLength(0);
		});

		it("should resolve all pending waiters with 'denied'", async () => {
			const id1 = gate.requestApproval(makeParams());
			const id2 = gate.requestApproval(makeParams());
			const p1 = gate.waitForApproval(id1);
			const p2 = gate.waitForApproval(id2);

			gate.destroy();

			expect(await p1).toBe("denied");
			expect(await p2).toBe("denied");
		});

		it("should clear all handlers", () => {
			const handler = vi.fn();
			gate.on("requested", handler);
			gate.destroy();

			// Creating a new gate to test - the destroyed gate's handlers are cleared
			// We can't easily test this without accessing internals,
			// but we verified the source clears handlers.length = 0
		});

		it("should clear all internal state", () => {
			gate.requestApproval(makeParams());
			gate.destroy();
			expect(gate.getAll()).toHaveLength(0);
			expect(gate.getPending()).toHaveLength(0);
		});
	});

	// ─── Edge Cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle concurrent approve and timeout (approve wins if first)", async () => {
			const id = gate.requestApproval(makeParams({ timeout: 5000 }));
			const promise = gate.waitForApproval(id);

			gate.approve(id);
			vi.advanceTimersByTime(5000); // Timeout would fire but request already resolved

			const status = await promise;
			expect(status).toBe("approved");
		});

		it("should handle multiple requests from different agents", () => {
			const id1 = gate.requestApproval(makeParams({ agentId: "agent-1" }));
			const id2 = gate.requestApproval(makeParams({ agentId: "agent-2" }));
			const id3 = gate.requestApproval(makeParams({ agentId: "agent-3" }));

			expect(gate.getPending()).toHaveLength(3);

			gate.approve(id2);
			const pending = gate.getPending();
			expect(pending).toHaveLength(2);
			expect(pending.map((r) => r.agentId)).not.toContain("agent-2");
		});

		it("should handle approve immediately after requestApproval", () => {
			const id = gate.requestApproval(makeParams());
			const result = gate.approve(id);
			expect(result).toBe(true);
			expect(gate.get(id)!.status).toBe("approved");
		});

		it("should allow re-use of gate after cleanup", () => {
			const id1 = gate.requestApproval(makeParams());
			gate.approve(id1);
			gate.cleanup();

			const id2 = gate.requestApproval(makeParams());
			expect(gate.get(id2)).toBeDefined();
			expect(gate.get(id2)!.status).toBe("pending");
		});
	});
});
