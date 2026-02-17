import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SandeshaRouter } from "../src/sandesha.js";
import type { InputResponse } from "../src/sandesha.js";

describe("SandeshaRouter", () => {
	let router: SandeshaRouter;

	beforeEach(() => {
		vi.useFakeTimers();
		router = new SandeshaRouter({
			defaultTimeoutMs: 5000,
			maxPendingRequests: 3,
		});
	});

	afterEach(() => {
		router.destroy();
		vi.useRealTimers();
	});

	// ─── requestInput + resolveInput ─────────────────────────────────────

	describe("requestInput + resolveInput", () => {
		it("should create a request and resolve it when resolveInput is called", async () => {
			const promise = router.requestInput({
				requestId: "req-1",
				agentId: "agent-42",
				depth: 2,
				prompt: "Which file?",
				timeoutMs: 5000,
			});

			expect(router.hasPending()).toBe(true);
			expect(router.pendingCount).toBe(1);

			const resolved = router.resolveInput("req-1", "/src/main.ts", "user");
			expect(resolved).toBe(true);

			const response = await promise;
			expect(response).toEqual({
				requestId: "req-1",
				agentId: "agent-42",
				value: "/src/main.ts",
				answeredBy: "user",
			} satisfies InputResponse);

			expect(router.hasPending()).toBe(false);
		});

		it("should default answeredBy to 'user' when not specified", async () => {
			const promise = router.requestInput({
				requestId: "req-2",
				agentId: "agent-7",
				depth: 1,
				prompt: "Continue?",
				timeoutMs: 5000,
			});

			router.resolveInput("req-2", "yes");

			const response = await promise;
			expect(response.answeredBy).toBe("user");
		});

		it("should return false when resolving a non-existent request", () => {
			expect(router.resolveInput("nonexistent", "value")).toBe(false);
		});
	});

	// ─── timeout ─────────────────────────────────────────────────────────

	describe("timeout", () => {
		it("should auto-resolve with defaultValue when timeout fires", async () => {
			const promise = router.requestInput({
				requestId: "req-timeout",
				agentId: "agent-slow",
				depth: 1,
				prompt: "Waiting...",
				defaultValue: "fallback",
				timeoutMs: 2000,
			});

			expect(router.hasPending()).toBe(true);

			vi.advanceTimersByTime(2000);

			const response = await promise;
			expect(response).toEqual({
				requestId: "req-timeout",
				agentId: "agent-slow",
				value: "fallback",
				answeredBy: "timeout",
			} satisfies InputResponse);

			expect(router.hasPending()).toBe(false);
		});

		it("should resolve with empty string when no defaultValue and timeout fires", async () => {
			const promise = router.requestInput({
				requestId: "req-no-default",
				agentId: "agent-x",
				depth: 0,
				prompt: "Input?",
				timeoutMs: 1000,
			});

			vi.advanceTimersByTime(1000);

			const response = await promise;
			expect(response.value).toBe("");
			expect(response.answeredBy).toBe("timeout");
		});
	});

	// ─── denyInput ───────────────────────────────────────────────────────

	describe("denyInput", () => {
		it("should deny a pending request with empty value and parent answeredBy", async () => {
			const promise = router.requestInput({
				requestId: "req-deny",
				agentId: "agent-child",
				depth: 3,
				prompt: "Should I delete?",
				timeoutMs: 5000,
			});

			const denied = router.denyInput("req-deny", "Not allowed");
			expect(denied).toBe(true);

			const response = await promise;
			expect(response.value).toBe("");
			expect(response.answeredBy).toBe("parent");
			expect(router.hasPending()).toBe(false);
		});

		it("should return false when denying a non-existent request", () => {
			expect(router.denyInput("nonexistent")).toBe(false);
		});
	});

	// ─── getPendingRequests ──────────────────────────────────────────────

	describe("getPendingRequests", () => {
		it("should return FIFO-ordered queue of pending requests", async () => {
			router.requestInput({
				requestId: "req-a",
				agentId: "agent-1",
				depth: 1,
				prompt: "First?",
				timeoutMs: 10000,
			});

			router.requestInput({
				requestId: "req-b",
				agentId: "agent-2",
				depth: 2,
				prompt: "Second?",
				timeoutMs: 10000,
			});

			const pending = router.getPendingRequests();
			expect(pending).toHaveLength(2);
			expect(pending[0].requestId).toBe("req-a");
			expect(pending[1].requestId).toBe("req-b");
		});

		it("should remove resolved requests from the queue", async () => {
			router.requestInput({
				requestId: "req-x",
				agentId: "agent-1",
				depth: 1,
				prompt: "X?",
				timeoutMs: 10000,
			});

			router.requestInput({
				requestId: "req-y",
				agentId: "agent-2",
				depth: 1,
				prompt: "Y?",
				timeoutMs: 10000,
			});

			router.resolveInput("req-x", "done");

			const pending = router.getPendingRequests();
			expect(pending).toHaveLength(1);
			expect(pending[0].requestId).toBe("req-y");
		});
	});

	// ─── cancelAll ───────────────────────────────────────────────────────

	describe("cancelAll", () => {
		it("should resolve all pending requests with timeout/default", async () => {
			const p1 = router.requestInput({
				requestId: "cancel-1",
				agentId: "agent-a",
				depth: 0,
				prompt: "A?",
				defaultValue: "default-a",
				timeoutMs: 10000,
			});

			const p2 = router.requestInput({
				requestId: "cancel-2",
				agentId: "agent-b",
				depth: 1,
				prompt: "B?",
				timeoutMs: 10000,
			});

			router.cancelAll();

			const [r1, r2] = await Promise.all([p1, p2]);
			expect(r1.value).toBe("default-a");
			expect(r1.answeredBy).toBe("timeout");
			expect(r2.value).toBe("");
			expect(r2.answeredBy).toBe("timeout");
			expect(router.hasPending()).toBe(false);
			expect(router.getPendingRequests()).toHaveLength(0);
		});
	});

	// ─── maxPendingRequests ──────────────────────────────────────────────

	describe("maxPendingRequests", () => {
		it("should reject when the queue is full", async () => {
			// maxPendingRequests is set to 3 in beforeEach
			router.requestInput({
				requestId: "max-1",
				agentId: "a1",
				depth: 0,
				prompt: "1?",
				timeoutMs: 10000,
			});
			router.requestInput({
				requestId: "max-2",
				agentId: "a2",
				depth: 0,
				prompt: "2?",
				timeoutMs: 10000,
			});
			router.requestInput({
				requestId: "max-3",
				agentId: "a3",
				depth: 0,
				prompt: "3?",
				timeoutMs: 10000,
			});

			expect(router.pendingCount).toBe(3);

			await expect(
				router.requestInput({
					requestId: "max-4",
					agentId: "a4",
					depth: 0,
					prompt: "4?",
					timeoutMs: 10000,
				}),
			).rejects.toThrow("max pending requests");
		});
	});

	// ─── destroy ─────────────────────────────────────────────────────────

	describe("destroy", () => {
		it("should prevent further operations after destruction", () => {
			router.destroy();

			expect(() =>
				router.requestInput({
					requestId: "post-destroy",
					agentId: "agent",
					depth: 0,
					prompt: "fail?",
					timeoutMs: 1000,
				}),
			).toThrow("destroyed");
		});

		it("should be idempotent", () => {
			router.destroy();
			expect(() => router.destroy()).not.toThrow();
		});
	});
});
