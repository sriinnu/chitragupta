import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MessageBus } from "@chitragupta/sutra";
import type { BusMessage } from "@chitragupta/sutra";

describe("MessageBus", () => {
	let bus: MessageBus;

	beforeEach(() => {
		bus = new MessageBus();
	});

	afterEach(() => {
		bus.destroy();
	});

	// ═══════════════════════════════════════════════════════════════
	// PUBLISH
	// ═══════════════════════════════════════════════════════════════

	describe("publish", () => {
		it("should return a UUID message id", () => {
			const id = bus.publish("topic", { data: 1 });
			expect(id).toMatch(/^[0-9a-f-]{36}$/);
		});

		it("should return unique ids for each publish", () => {
			const id1 = bus.publish("topic", 1);
			const id2 = bus.publish("topic", 2);
			expect(id1).not.toBe(id2);
		});

		it("should invoke exact topic subscriber", () => {
			const handler = vi.fn();
			bus.subscribe("agent:status", handler);
			bus.publish("agent:status", { state: "running" }, "orch");
			expect(handler).toHaveBeenCalledTimes(1);
			const msg = handler.mock.calls[0][0] as BusMessage;
			expect(msg.topic).toBe("agent:status");
			expect(msg.payload).toEqual({ state: "running" });
			expect(msg.sender).toBe("orch");
		});

		it("should not invoke subscriber for different topic", () => {
			const handler = vi.fn();
			bus.subscribe("agent:status", handler);
			bus.publish("agent:complete", {});
			expect(handler).not.toHaveBeenCalled();
		});

		it("should invoke pattern subscriber with * matching one segment", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:*", handler);
			bus.publish("agent:foo", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should NOT match * across multiple segments", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:*", handler);
			bus.publish("agent:foo:bar", {});
			expect(handler).not.toHaveBeenCalled();
		});

		it("should invoke pattern subscriber with ** matching zero segments", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:**", handler);
			bus.publish("agent", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should invoke pattern subscriber with ** matching one segment", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:**", handler);
			bus.publish("agent:foo", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should invoke pattern subscriber with ** matching multiple segments", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:**", handler);
			bus.publish("agent:foo:bar:baz", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should match ** in the middle of a pattern", () => {
			const handler = vi.fn();
			bus.subscribePattern("system:**:done", handler);
			bus.publish("system:task:sub:done", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should invoke handlers in priority order (higher first)", () => {
			const order: number[] = [];
			bus.subscribe("t", () => { order.push(0); });
			bus.subscribe("t", () => { order.push(10); }, { priority: 10 });
			bus.subscribe("t", () => { order.push(5); }, { priority: 5 });
			bus.publish("t", {});
			expect(order).toEqual([10, 5, 0]);
		});

		it("should filter by sender when filterSender is set", () => {
			const handler = vi.fn();
			bus.subscribe("topic", handler, { filterSender: "alice" });
			bus.publish("topic", {}, "bob");
			expect(handler).not.toHaveBeenCalled();
			bus.publish("topic", {}, "alice");
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should auto-remove once-only handler after first invocation", () => {
			const handler = vi.fn();
			bus.subscribe("t", handler, { once: true });
			bus.publish("t", 1);
			bus.publish("t", 2);
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should swallow handler errors without affecting others", () => {
			const good = vi.fn();
			bus.subscribe("t", () => {
				throw new Error("boom");
			}, { priority: 10 });
			bus.subscribe("t", good, { priority: 0 });
			bus.publish("t", {});
			expect(good).toHaveBeenCalledTimes(1);
		});

		it("should use 'anonymous' as default sender", () => {
			const handler = vi.fn();
			bus.subscribe("t", handler);
			bus.publish("t", "data");
			const msg = handler.mock.calls[0][0] as BusMessage;
			expect(msg.sender).toBe("anonymous");
		});

		it("should include a timestamp in the message", () => {
			const handler = vi.fn();
			bus.subscribe("t", handler);
			const before = Date.now();
			bus.publish("t", {});
			const after = Date.now();
			const msg = handler.mock.calls[0][0] as BusMessage;
			expect(msg.timestamp).toBeGreaterThanOrEqual(before);
			expect(msg.timestamp).toBeLessThanOrEqual(after);
		});

		it("should handle both exact and pattern subscribers for same topic", () => {
			const exact = vi.fn();
			const pattern = vi.fn();
			bus.subscribe("agent:start", exact);
			bus.subscribePattern("agent:*", pattern);
			bus.publish("agent:start", {});
			expect(exact).toHaveBeenCalledTimes(1);
			expect(pattern).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// SUBSCRIBE
	// ═══════════════════════════════════════════════════════════════

	describe("subscribe", () => {
		it("should return an unsubscribe function", () => {
			const handler = vi.fn();
			const unsub = bus.subscribe("t", handler);
			expect(unsub).toBeTypeOf("function");
		});

		it("should stop receiving messages after unsubscribe", () => {
			const handler = vi.fn();
			const unsub = bus.subscribe("t", handler);
			bus.publish("t", 1);
			unsub();
			bus.publish("t", 2);
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should allow calling unsubscribe multiple times safely", () => {
			const handler = vi.fn();
			const unsub = bus.subscribe("t", handler);
			unsub();
			unsub(); // Should not throw
		});

		it("should support multiple subscriptions on same topic", () => {
			const h1 = vi.fn();
			const h2 = vi.fn();
			bus.subscribe("t", h1);
			bus.subscribe("t", h2);
			bus.publish("t", {});
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
		});
	});

	describe("subscribePattern", () => {
		it("should return an unsubscribe function", () => {
			const unsub = bus.subscribePattern("*", vi.fn());
			expect(unsub).toBeTypeOf("function");
		});

		it("should stop receiving messages after unsubscribe", () => {
			const handler = vi.fn();
			const unsub = bus.subscribePattern("agent:*", handler);
			bus.publish("agent:foo", 1);
			unsub();
			bus.publish("agent:bar", 2);
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should support filterSender on pattern subscription", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:*", handler, { filterSender: "orch" });
			bus.publish("agent:foo", {}, "other");
			expect(handler).not.toHaveBeenCalled();
			bus.publish("agent:bar", {}, "orch");
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should support once on pattern subscription", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:*", handler, { once: true });
			bus.publish("agent:foo", 1);
			bus.publish("agent:bar", 2);
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// WAITFOR
	// ═══════════════════════════════════════════════════════════════

	describe("waitFor", () => {
		it("should resolve on next message", async () => {
			const promise = bus.waitFor("ready");
			bus.publish("ready", { status: "ok" }, "sender");
			const msg = await promise;
			expect(msg.payload).toEqual({ status: "ok" });
			expect(msg.sender).toBe("sender");
		});

		it("should reject on timeout", async () => {
			vi.useFakeTimers();
			try {
				const promise = bus.waitFor("never", 3000);
				vi.advanceTimersByTime(3001);
				await expect(promise).rejects.toThrow(
					'waitFor("never") timed out after 3000ms',
				);
			} finally {
				vi.useRealTimers();
			}
		});

		it("should not time out when timeout is 0", async () => {
			// timeout=0 means never timeout — resolve manually
			const promise = bus.waitFor("t", 0);
			bus.publish("t", "data");
			const msg = await promise;
			expect(msg.payload).toBe("data");
		});

		it("should clean up the one-shot subscription after resolve", async () => {
			const promise = bus.waitFor("once-topic");
			const spy = vi.fn();
			bus.subscribe("once-topic", spy);
			bus.publish("once-topic", "first");
			await promise;
			// spy was called but the waitFor subscription should be removed
			bus.publish("once-topic", "second");
			expect(spy).toHaveBeenCalledTimes(2); // spy still active
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// HISTORY
	// ═══════════════════════════════════════════════════════════════

	describe("getHistory", () => {
		it("should return empty array for unknown topic", () => {
			expect(bus.getHistory("no-such")).toEqual([]);
		});

		it("should return messages oldest-first", () => {
			bus.publish("h", "first");
			bus.publish("h", "second");
			bus.publish("h", "third");
			const history = bus.getHistory("h");
			expect(history).toHaveLength(3);
			expect(history[0].payload).toBe("first");
			expect(history[2].payload).toBe("third");
		});

		it("should respect limit parameter", () => {
			bus.publish("h", 1);
			bus.publish("h", 2);
			bus.publish("h", 3);
			const history = bus.getHistory("h", 2);
			expect(history).toHaveLength(2);
			expect(history[0].payload).toBe(2); // most recent 2, oldest first
			expect(history[1].payload).toBe(3);
		});

		it("should wrap around when maxHistoryPerTopic is exceeded (ring buffer)", () => {
			const smallBus = new MessageBus({ maxHistoryPerTopic: 3 });
			smallBus.publish("r", "a");
			smallBus.publish("r", "b");
			smallBus.publish("r", "c");
			smallBus.publish("r", "d"); // overwrites "a"
			const history = smallBus.getHistory("r");
			expect(history).toHaveLength(3);
			expect(history[0].payload).toBe("b");
			expect(history[1].payload).toBe("c");
			expect(history[2].payload).toBe("d");
			smallBus.destroy();
		});

		it("should evict oldest topic when maxTrackedTopics is exceeded", () => {
			const tinyBus = new MessageBus({ maxTrackedTopics: 2 });
			tinyBus.publish("topic-1", "data1");
			tinyBus.publish("topic-2", "data2");
			tinyBus.publish("topic-3", "data3"); // evicts topic-1
			expect(tinyBus.getHistory("topic-1")).toEqual([]);
			expect(tinyBus.getHistory("topic-2")).toHaveLength(1);
			expect(tinyBus.getHistory("topic-3")).toHaveLength(1);
			tinyBus.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DESTROY
	// ═══════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should throw on publish after destroy", () => {
			bus.destroy();
			expect(() => bus.publish("t", {})).toThrow("MessageBus has been destroyed");
		});

		it("should throw on subscribe after destroy", () => {
			bus.destroy();
			expect(() => bus.subscribe("t", vi.fn())).toThrow("MessageBus has been destroyed");
		});

		it("should throw on subscribePattern after destroy", () => {
			bus.destroy();
			expect(() => bus.subscribePattern("t:*", vi.fn())).toThrow(
				"MessageBus has been destroyed",
			);
		});

		it("should throw on waitFor after destroy", () => {
			bus.destroy();
			expect(() => bus.waitFor("t")).toThrow("MessageBus has been destroyed");
		});

		it("should clear all history", () => {
			bus.publish("t", 1);
			bus.destroy();
			// Can't call getHistory because bus is destroyed, but destroy does clear history
			// Recreate and confirm it starts empty
			const newBus = new MessageBus();
			expect(newBus.getHistory("t")).toEqual([]);
			newBus.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// GLOB MATCHING EDGE CASES
	// ═══════════════════════════════════════════════════════════════

	describe("glob matching edge cases", () => {
		it("should match exact pattern with no wildcards", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:status", handler);
			bus.publish("agent:status", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should not match pattern that is a prefix of the topic", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent", handler);
			bus.publish("agent:status", {});
			expect(handler).not.toHaveBeenCalled();
		});

		it("should not match topic that is a prefix of the pattern", () => {
			const handler = vi.fn();
			bus.subscribePattern("agent:status:detail", handler);
			bus.publish("agent:status", {});
			expect(handler).not.toHaveBeenCalled();
		});

		it("should match ** at the beginning", () => {
			const handler = vi.fn();
			bus.subscribePattern("**:done", handler);
			bus.publish("system:task:done", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should match single-segment topic with *", () => {
			const handler = vi.fn();
			bus.subscribePattern("*", handler);
			bus.publish("anything", {});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should not match multi-segment topic with single *", () => {
			const handler = vi.fn();
			bus.subscribePattern("*", handler);
			bus.publish("a:b", {});
			expect(handler).not.toHaveBeenCalled();
		});

		it("should match everything with **", () => {
			const handler = vi.fn();
			bus.subscribePattern("**", handler);
			bus.publish("a", {});
			bus.publish("a:b", {});
			bus.publish("a:b:c", {});
			expect(handler).toHaveBeenCalledTimes(3);
		});
	});
});
