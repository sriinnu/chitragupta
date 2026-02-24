import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBridge } from "../src/event-bridge.js";
import {
	McpNotificationSink,
	WebSocketSink,
	SSEManagerSink,
} from "../src/event-bridge-sinks.js";
import type {
	ChitraguptaEvent,
	ChitraguptaEventBase,
	EventSink,
} from "../src/event-bridge-types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal valid event for testing. */
function makeEvent(
	overrides: Partial<ChitraguptaEvent> & { type: ChitraguptaEvent["type"] },
): ChitraguptaEvent {
	return {
		id: overrides.id ?? "evt-001",
		timestamp: overrides.timestamp ?? 1_700_000_000_000,
		agentId: overrides.agentId ?? "agent-test",
		type: overrides.type,
		...overrides,
	} as ChitraguptaEvent;
}

/** Create a simple spy sink for testing fan-out. */
function spySink(id: string): EventSink & { deliver: ReturnType<typeof vi.fn> } {
	return { id, deliver: vi.fn() };
}

// ═════════════════════════════════════════════════════════════════════════════
// EventBridge
// ═════════════════════════════════════════════════════════════════════════════

describe("EventBridge", () => {
	let bridge: EventBridge;

	beforeEach(() => {
		bridge = new EventBridge();
	});

	afterEach(() => {
		bridge.destroy();
	});

	// ─── Construction ────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("should create with default buffer size (200)", () => {
			const b = new EventBridge();
			// Emit 201 events — only the last 200 should survive
			for (let i = 0; i < 201; i++) {
				b.emit(makeEvent({ type: "stream:text", text: `msg-${i}`, id: `e-${i}` }));
			}
			const recent = b.getRecentEvents();
			expect(recent).toHaveLength(200);
			// Oldest surviving event should be msg-1 (msg-0 was evicted)
			expect((recent[0] as ChitraguptaEvent & { text: string }).text).toBe("msg-1");
			b.destroy();
		});

		it("should create with custom buffer size", () => {
			const b = new EventBridge({ recentBufferSize: 5 });
			for (let i = 0; i < 8; i++) {
				b.emit(makeEvent({ type: "stream:text", text: `m-${i}`, id: `e-${i}` }));
			}
			const recent = b.getRecentEvents();
			expect(recent).toHaveLength(5);
			// Only the last 5 (m-3 through m-7) should remain
			expect((recent[0] as ChitraguptaEvent & { text: string }).text).toBe("m-3");
			expect((recent[4] as ChitraguptaEvent & { text: string }).text).toBe("m-7");
			b.destroy();
		});
	});

	// ─── addSink / removeSink ────────────────────────────────────────────────

	describe("addSink", () => {
		it("should register a sink and increase sinkCount", () => {
			expect(bridge.sinkCount).toBe(0);
			bridge.addSink(spySink("s1"));
			expect(bridge.sinkCount).toBe(1);
		});

		it("should ignore duplicate sink ids", () => {
			bridge.addSink(spySink("dup"));
			bridge.addSink(spySink("dup"));
			expect(bridge.sinkCount).toBe(1);
		});

		it("should allow multiple sinks with different ids", () => {
			bridge.addSink(spySink("a"));
			bridge.addSink(spySink("b"));
			bridge.addSink(spySink("c"));
			expect(bridge.sinkCount).toBe(3);
		});

		it("should throw after destroy", () => {
			bridge.destroy();
			expect(() => bridge.addSink(spySink("late"))).toThrow(
				"EventBridge has been destroyed.",
			);
		});
	});

	describe("removeSink", () => {
		it("should remove an existing sink by id", () => {
			bridge.addSink(spySink("rem"));
			expect(bridge.sinkCount).toBe(1);
			bridge.removeSink("rem");
			expect(bridge.sinkCount).toBe(0);
		});

		it("should be safe to call with unknown id", () => {
			bridge.removeSink("nonexistent");
			expect(bridge.sinkCount).toBe(0);
		});

		it("should only remove the matching sink", () => {
			bridge.addSink(spySink("keep"));
			bridge.addSink(spySink("drop"));
			bridge.removeSink("drop");
			expect(bridge.sinkCount).toBe(1);
		});

		it("should stop delivering to removed sink", () => {
			const sink = spySink("temp");
			bridge.addSink(sink);
			bridge.removeSink("temp");
			bridge.emit(makeEvent({ type: "stream:text", text: "after-remove" }));
			expect(sink.deliver).not.toHaveBeenCalled();
		});
	});

	// ─── emit ────────────────────────────────────────────────────────────────

	describe("emit", () => {
		it("should fan out to all registered sinks", () => {
			const s1 = spySink("s1");
			const s2 = spySink("s2");
			bridge.addSink(s1);
			bridge.addSink(s2);

			const event = makeEvent({ type: "tool:start", toolName: "grep", input: {} });
			bridge.emit(event);

			expect(s1.deliver).toHaveBeenCalledTimes(1);
			expect(s1.deliver).toHaveBeenCalledWith(event);
			expect(s2.deliver).toHaveBeenCalledTimes(1);
			expect(s2.deliver).toHaveBeenCalledWith(event);
		});

		it("should push events to the ring buffer", () => {
			const event = makeEvent({ type: "turn:start", turnNumber: 1 });
			bridge.emit(event);

			const recent = bridge.getRecentEvents();
			expect(recent).toHaveLength(1);
			expect(recent[0]).toEqual(event);
		});

		it("should deliver events even with no sinks (buffer only)", () => {
			bridge.emit(makeEvent({ type: "stream:text", text: "solo" }));
			expect(bridge.getRecentEvents()).toHaveLength(1);
		});

		it("should throw after destroy", () => {
			bridge.destroy();
			expect(() =>
				bridge.emit(makeEvent({ type: "stream:text", text: "post-destroy" })),
			).toThrow("EventBridge has been destroyed.");
		});
	});

	// ─── getRecentEvents ─────────────────────────────────────────────────────

	describe("getRecentEvents", () => {
		it("should return empty array when no events emitted", () => {
			expect(bridge.getRecentEvents()).toEqual([]);
		});

		it("should return all events when no limit specified", () => {
			bridge.emit(makeEvent({ type: "stream:text", text: "a", id: "1" }));
			bridge.emit(makeEvent({ type: "stream:text", text: "b", id: "2" }));
			bridge.emit(makeEvent({ type: "stream:text", text: "c", id: "3" }));

			const recent = bridge.getRecentEvents();
			expect(recent).toHaveLength(3);
		});

		it("should respect the limit parameter", () => {
			for (let i = 0; i < 10; i++) {
				bridge.emit(makeEvent({ type: "stream:text", text: `e-${i}`, id: `id-${i}` }));
			}

			const recent = bridge.getRecentEvents(3);
			expect(recent).toHaveLength(3);
			// Should return the 3 most recent (oldest-first within the slice)
			expect((recent[0] as ChitraguptaEvent & { text: string }).text).toBe("e-7");
			expect((recent[2] as ChitraguptaEvent & { text: string }).text).toBe("e-9");
		});

		it("should return oldest-first order", () => {
			bridge.emit(makeEvent({ type: "stream:text", text: "first", id: "1" }));
			bridge.emit(makeEvent({ type: "stream:text", text: "second", id: "2" }));
			bridge.emit(makeEvent({ type: "stream:text", text: "third", id: "3" }));

			const recent = bridge.getRecentEvents();
			expect((recent[0] as ChitraguptaEvent & { text: string }).text).toBe("first");
			expect((recent[2] as ChitraguptaEvent & { text: string }).text).toBe("third");
		});

		it("should handle limit larger than buffer contents", () => {
			bridge.emit(makeEvent({ type: "stream:text", text: "only", id: "1" }));
			const recent = bridge.getRecentEvents(100);
			expect(recent).toHaveLength(1);
		});
	});

	// ─── emitTyped ───────────────────────────────────────────────────────────

	describe("emitTyped", () => {
		it("should build and emit a stream:text event", () => {
			const sink = spySink("typed-test");
			bridge.addSink(sink);

			bridge.emitTyped("agent-x", "stream:text", { text: "hello" }, "sess-1");

			expect(sink.deliver).toHaveBeenCalledTimes(1);
			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.type).toBe("stream:text");
			expect(delivered.agentId).toBe("agent-x");
			expect(delivered.sessionId).toBe("sess-1");
			expect((delivered as ChitraguptaEvent & { text: string }).text).toBe("hello");
		});

		it("should build and emit a tool:start event", () => {
			const sink = spySink("tool-test");
			bridge.addSink(sink);

			bridge.emitTyped("agent-y", "tool:start", { toolName: "read", input: { path: "/tmp" } });

			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.type).toBe("tool:start");
			expect((delivered as ChitraguptaEvent & { toolName: string }).toolName).toBe("read");
		});

		it("should build and emit a tool:done event", () => {
			const sink = spySink("done-test");
			bridge.addSink(sink);

			bridge.emitTyped("agent-z", "tool:done", { toolName: "write", durationMs: 150, isError: false });

			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.type).toBe("tool:done");
			expect((delivered as ChitraguptaEvent & { durationMs: number }).durationMs).toBe(150);
		});

		it("should build and emit a memory:change event", () => {
			const sink = spySink("mem-test");
			bridge.addSink(sink);

			bridge.emitTyped("agent-m", "memory:change", { changeType: "create", scope: "session" });

			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.type).toBe("memory:change");
			expect((delivered as ChitraguptaEvent & { changeType: string }).changeType).toBe("create");
		});

		it("should generate a UUID id and timestamp on the base", () => {
			const sink = spySink("base-check");
			bridge.addSink(sink);

			bridge.emitTyped("agent-a", "turn:start", { turnNumber: 1 });

			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(delivered.timestamp).toBeTypeOf("number");
			expect(delivered.timestamp).toBeGreaterThan(0);
		});

		it("should push to the ring buffer", () => {
			bridge.emitTyped("agent-b", "turn:done", { turnNumber: 2 });
			const recent = bridge.getRecentEvents();
			expect(recent).toHaveLength(1);
			expect(recent[0].type).toBe("turn:done");
		});

		it("should work without sessionId", () => {
			const sink = spySink("no-session");
			bridge.addSink(sink);

			bridge.emitTyped("agent-c", "session:handover", { cursor: 42 });

			const delivered = sink.deliver.mock.calls[0][0] as ChitraguptaEvent;
			expect(delivered.sessionId).toBeUndefined();
		});
	});

	// ─── createBase (static) ─────────────────────────────────────────────────

	describe("EventBridge.createBase", () => {
		it("should generate a base with UUID, timestamp, and agentId", () => {
			const base = EventBridge.createBase("agent-1");
			expect(base.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(base.timestamp).toBeTypeOf("number");
			expect(base.timestamp).toBeGreaterThan(0);
			expect(base.agentId).toBe("agent-1");
			expect(base.sessionId).toBeUndefined();
		});

		it("should include sessionId when provided", () => {
			const base = EventBridge.createBase("agent-2", "sess-abc");
			expect(base.sessionId).toBe("sess-abc");
		});

		it("should generate unique ids per call", () => {
			const b1 = EventBridge.createBase("a");
			const b2 = EventBridge.createBase("a");
			expect(b1.id).not.toBe(b2.id);
		});
	});

	// ─── destroy ─────────────────────────────────────────────────────────────

	describe("destroy", () => {
		it("should clear all sinks", () => {
			bridge.addSink(spySink("d1"));
			bridge.addSink(spySink("d2"));
			expect(bridge.sinkCount).toBe(2);
			bridge.destroy();
			expect(bridge.sinkCount).toBe(0);
		});

		it("should clear the ring buffer", () => {
			bridge.emit(makeEvent({ type: "stream:text", text: "before-destroy" }));
			expect(bridge.getRecentEvents()).toHaveLength(1);
			bridge.destroy();
			expect(bridge.getRecentEvents()).toEqual([]);
		});

		it("should throw on emit after destroy", () => {
			bridge.destroy();
			expect(() =>
				bridge.emit(makeEvent({ type: "stream:text", text: "too-late" })),
			).toThrow("EventBridge has been destroyed.");
		});

		it("should throw on addSink after destroy", () => {
			bridge.destroy();
			expect(() => bridge.addSink(spySink("post"))).toThrow(
				"EventBridge has been destroyed.",
			);
		});

		it("should be safe to call destroy multiple times", () => {
			bridge.destroy();
			// Second destroy should not throw
			expect(() => bridge.destroy()).not.toThrow();
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// McpNotificationSink
// ═════════════════════════════════════════════════════════════════════════════

describe("McpNotificationSink", () => {
	it("should generate an id prefixed with 'mcp-' when none provided", () => {
		const sink = new McpNotificationSink(vi.fn());
		expect(sink.id).toMatch(/^mcp-[0-9a-f]{8}$/);
	});

	it("should use a custom id when provided", () => {
		const sink = new McpNotificationSink(vi.fn(), "my-mcp-sink");
		expect(sink.id).toBe("my-mcp-sink");
	});

	it("should send a JSON-RPC 2.0 notification with method 'notifications/event'", () => {
		const sendFn = vi.fn();
		const sink = new McpNotificationSink(sendFn);

		const event = makeEvent({
			type: "stream:text",
			text: "hello world",
			id: "evt-100",
			timestamp: 1_700_000_000_000,
			agentId: "agent-mcp",
		});

		sink.deliver(event);

		expect(sendFn).toHaveBeenCalledTimes(1);
		const notification = sendFn.mock.calls[0][0];
		expect(notification.jsonrpc).toBe("2.0");
		expect(notification.method).toBe("notifications/event");
	});

	it("should include base fields in params", () => {
		const sendFn = vi.fn();
		const sink = new McpNotificationSink(sendFn);

		const event = makeEvent({
			type: "tool:start",
			toolName: "bash",
			input: { cmd: "ls" },
			id: "evt-200",
			timestamp: 1_700_000_001_000,
			agentId: "agent-tools",
		});

		sink.deliver(event);

		const params = sendFn.mock.calls[0][0].params;
		expect(params.type).toBe("tool:start");
		expect(params.id).toBe("evt-200");
		expect(params.timestamp).toBe(1_700_000_001_000);
		expect(params.agentId).toBe("agent-tools");
	});

	it("should include event-specific payload fields in params", () => {
		const sendFn = vi.fn();
		const sink = new McpNotificationSink(sendFn);

		const event = makeEvent({
			type: "tool:done",
			toolName: "grep",
			durationMs: 250,
			isError: false,
			id: "evt-300",
			agentId: "agent-tools",
		});

		sink.deliver(event);

		const params = sendFn.mock.calls[0][0].params;
		expect(params.toolName).toBe("grep");
		expect(params.durationMs).toBe(250);
		expect(params.isError).toBe(false);
	});

	it("should include sessionId in params when present", () => {
		const sendFn = vi.fn();
		const sink = new McpNotificationSink(sendFn);

		const event = makeEvent({
			type: "stream:text",
			text: "with-session",
			sessionId: "sess-xyz",
		});

		sink.deliver(event);

		const params = sendFn.mock.calls[0][0].params;
		expect(params.sessionId).toBe("sess-xyz");
	});

	it("should omit sessionId from params when not present", () => {
		const sendFn = vi.fn();
		const sink = new McpNotificationSink(sendFn);

		const event = makeEvent({ type: "stream:text", text: "no-session" });
		// Ensure sessionId is truly absent
		delete (event as Partial<ChitraguptaEventBase>).sessionId;

		sink.deliver(event);

		const params = sendFn.mock.calls[0][0].params;
		expect(params).not.toHaveProperty("sessionId");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// WebSocketSink
// ═════════════════════════════════════════════════════════════════════════════

describe("WebSocketSink", () => {
	it("should generate an id prefixed with 'ws-' when none provided", () => {
		const sink = new WebSocketSink(vi.fn());
		expect(sink.id).toMatch(/^ws-[0-9a-f]{8}$/);
	});

	it("should use a custom id when provided", () => {
		const sink = new WebSocketSink(vi.fn(), "my-ws-sink");
		expect(sink.id).toBe("my-ws-sink");
	});

	it("should call broadcastFn with event type and full event", () => {
		const broadcastFn = vi.fn();
		const sink = new WebSocketSink(broadcastFn);

		const event = makeEvent({
			type: "turn:start",
			turnNumber: 5,
			id: "evt-ws-1",
			agentId: "agent-ws",
		});

		sink.deliver(event);

		expect(broadcastFn).toHaveBeenCalledTimes(1);
		expect(broadcastFn).toHaveBeenCalledWith("turn:start", event);
	});

	it("should pass the event type as the first argument", () => {
		const broadcastFn = vi.fn();
		const sink = new WebSocketSink(broadcastFn);

		const event = makeEvent({ type: "stream:thinking", text: "pondering..." });
		sink.deliver(event);

		const [type] = broadcastFn.mock.calls[0];
		expect(type).toBe("stream:thinking");
	});

	it("should pass the complete event object as the second argument", () => {
		const broadcastFn = vi.fn();
		const sink = new WebSocketSink(broadcastFn);

		const event = makeEvent({
			type: "tool:done",
			toolName: "read",
			durationMs: 10,
			isError: true,
		});
		sink.deliver(event);

		const [, data] = broadcastFn.mock.calls[0];
		expect(data).toBe(event);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// SSEManagerSink
// ═════════════════════════════════════════════════════════════════════════════

describe("SSEManagerSink", () => {
	it("should generate an id prefixed with 'sse-' when none provided", () => {
		const sink = new SSEManagerSink(vi.fn());
		expect(sink.id).toMatch(/^sse-[0-9a-f]{8}$/);
	});

	it("should use a custom id when provided", () => {
		const sink = new SSEManagerSink(vi.fn(), "my-sse-sink");
		expect(sink.id).toBe("my-sse-sink");
	});

	it("should call broadcastFn with event type and full event", () => {
		const broadcastFn = vi.fn();
		const sink = new SSEManagerSink(broadcastFn);

		const event = makeEvent({
			type: "memory:change",
			changeType: "update" as const,
			scope: "global",
		});

		sink.deliver(event);

		expect(broadcastFn).toHaveBeenCalledTimes(1);
		expect(broadcastFn).toHaveBeenCalledWith("memory:change", event);
	});

	it("should pass the event type as the first argument (event name for SSE)", () => {
		const broadcastFn = vi.fn();
		const sink = new SSEManagerSink(broadcastFn);

		const event = makeEvent({ type: "session:handover", cursor: 99 });
		sink.deliver(event);

		const [eventName] = broadcastFn.mock.calls[0];
		expect(eventName).toBe("session:handover");
	});

	it("should pass the complete event object as the second argument", () => {
		const broadcastFn = vi.fn();
		const sink = new SSEManagerSink(broadcastFn);

		const event = makeEvent({ type: "turn:done", turnNumber: 3 });
		sink.deliver(event);

		const [, data] = broadcastFn.mock.calls[0];
		expect(data).toBe(event);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Multiple Sinks Integration
// ═════════════════════════════════════════════════════════════════════════════

describe("Multiple sinks", () => {
	it("should deliver the same event to MCP, WS, and SSE sinks", () => {
		const bridge = new EventBridge();

		const mcpSendFn = vi.fn();
		const wsBroadcastFn = vi.fn();
		const sseBroadcastFn = vi.fn();

		const mcpSink = new McpNotificationSink(mcpSendFn, "mcp-multi");
		const wsSink = new WebSocketSink(wsBroadcastFn, "ws-multi");
		const sseSink = new SSEManagerSink(sseBroadcastFn, "sse-multi");

		bridge.addSink(mcpSink);
		bridge.addSink(wsSink);
		bridge.addSink(sseSink);

		const event = makeEvent({
			type: "tool:start",
			toolName: "bash",
			input: { command: "echo hi" },
			id: "evt-multi",
			agentId: "agent-multi",
		});

		bridge.emit(event);

		// MCP sink received a JSON-RPC notification
		expect(mcpSendFn).toHaveBeenCalledTimes(1);
		expect(mcpSendFn.mock.calls[0][0].jsonrpc).toBe("2.0");
		expect(mcpSendFn.mock.calls[0][0].method).toBe("notifications/event");

		// WS sink received type + event
		expect(wsBroadcastFn).toHaveBeenCalledTimes(1);
		expect(wsBroadcastFn).toHaveBeenCalledWith("tool:start", event);

		// SSE sink received type + event
		expect(sseBroadcastFn).toHaveBeenCalledTimes(1);
		expect(sseBroadcastFn).toHaveBeenCalledWith("tool:start", event);

		bridge.destroy();
	});

	it("should fan out to all sinks when emitTyped is used", () => {
		const bridge = new EventBridge();

		const s1 = spySink("multi-1");
		const s2 = spySink("multi-2");
		const s3 = spySink("multi-3");

		bridge.addSink(s1);
		bridge.addSink(s2);
		bridge.addSink(s3);

		bridge.emitTyped("agent-fan", "stream:thinking", { text: "deep thought" });

		expect(s1.deliver).toHaveBeenCalledTimes(1);
		expect(s2.deliver).toHaveBeenCalledTimes(1);
		expect(s3.deliver).toHaveBeenCalledTimes(1);

		// All received the same event object
		const e1 = s1.deliver.mock.calls[0][0];
		const e2 = s2.deliver.mock.calls[0][0];
		const e3 = s3.deliver.mock.calls[0][0];
		expect(e1).toBe(e2);
		expect(e2).toBe(e3);

		bridge.destroy();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Sink Error Isolation
// ═════════════════════════════════════════════════════════════════════════════

describe("Sink error isolation", () => {
	it("should continue delivering to other sinks when one throws", () => {
		const bridge = new EventBridge();

		const brokenSink: EventSink = {
			id: "broken",
			deliver: vi.fn().mockImplementation(() => {
				throw new Error("sink exploded");
			}),
		};
		const healthySink = spySink("healthy");

		bridge.addSink(brokenSink);
		bridge.addSink(healthySink);

		const event = makeEvent({ type: "stream:text", text: "resilient" });
		// Should not throw despite broken sink
		expect(() => bridge.emit(event)).not.toThrow();

		// Broken sink was called (and threw internally)
		expect(brokenSink.deliver).toHaveBeenCalledTimes(1);

		// Healthy sink still received the event
		expect(healthySink.deliver).toHaveBeenCalledTimes(1);
		expect(healthySink.deliver).toHaveBeenCalledWith(event);

		bridge.destroy();
	});

	it("should still push to ring buffer when a sink throws", () => {
		const bridge = new EventBridge();

		const brokenSink: EventSink = {
			id: "always-broken",
			deliver: () => { throw new Error("always fails"); },
		};
		bridge.addSink(brokenSink);

		bridge.emit(makeEvent({ type: "turn:start", turnNumber: 1 }));

		// Event should still be in the buffer
		const recent = bridge.getRecentEvents();
		expect(recent).toHaveLength(1);
		expect(recent[0].type).toBe("turn:start");

		bridge.destroy();
	});

	it("should isolate errors between multiple broken sinks", () => {
		const bridge = new EventBridge();

		const broken1: EventSink = {
			id: "broken-1",
			deliver: vi.fn().mockImplementation(() => { throw new Error("err-1"); }),
		};
		const broken2: EventSink = {
			id: "broken-2",
			deliver: vi.fn().mockImplementation(() => { throw new Error("err-2"); }),
		};
		const healthy = spySink("survivor");

		bridge.addSink(broken1);
		bridge.addSink(broken2);
		bridge.addSink(healthy);

		const event = makeEvent({ type: "stream:text", text: "test-isolation" });
		expect(() => bridge.emit(event)).not.toThrow();

		// All sinks were attempted
		expect(broken1.deliver).toHaveBeenCalledTimes(1);
		expect(broken2.deliver).toHaveBeenCalledTimes(1);
		expect(healthy.deliver).toHaveBeenCalledTimes(1);
		expect(healthy.deliver).toHaveBeenCalledWith(event);

		bridge.destroy();
	});
});
