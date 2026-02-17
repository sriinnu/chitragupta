import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventBus } from "@chitragupta/core";

describe("EventBus", () => {
  let bus: ReturnType<typeof createEventBus>;

  beforeEach(() => {
    bus = createEventBus();
  });

  describe("on / emit", () => {
    it("should call registered handler when event is emitted", () => {
      const handler = vi.fn();
      bus.on("test", handler);
      bus.emit("test", { value: 42 });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it("should call multiple handlers for the same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on("test", handler1);
      bus.on("test", handler2);
      bus.emit("test", "payload");
      expect(handler1).toHaveBeenCalledWith("payload");
      expect(handler2).toHaveBeenCalledWith("payload");
    });

    it("should not call handlers for different events", () => {
      const handler = vi.fn();
      bus.on("eventA", handler);
      bus.emit("eventB", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle emitting to events with no listeners", () => {
      // Should not throw
      expect(() => bus.emit("nonexistent", "data")).not.toThrow();
    });

    it("should pass various data types to handlers", () => {
      const handler = vi.fn();
      bus.on("test", handler);

      bus.emit("test", 123);
      bus.emit("test", "string");
      bus.emit("test", null);
      bus.emit("test", undefined);
      bus.emit("test", [1, 2, 3]);

      expect(handler).toHaveBeenCalledTimes(5);
      expect(handler).toHaveBeenNthCalledWith(1, 123);
      expect(handler).toHaveBeenNthCalledWith(2, "string");
      expect(handler).toHaveBeenNthCalledWith(3, null);
      expect(handler).toHaveBeenNthCalledWith(4, undefined);
      expect(handler).toHaveBeenNthCalledWith(5, [1, 2, 3]);
    });
  });

  describe("off", () => {
    it("should remove a specific handler", () => {
      const handler = vi.fn();
      bus.on("test", handler);
      bus.off("test", handler);
      bus.emit("test", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should only remove the specified handler, leaving others intact", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on("test", handler1);
      bus.on("test", handler2);
      bus.off("test", handler1);
      bus.emit("test", "data");
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith("data");
    });

    it("should handle removing a handler that was never registered", () => {
      const handler = vi.fn();
      // Should not throw
      expect(() => bus.off("test", handler)).not.toThrow();
    });

    it("should handle removing from a non-existent event", () => {
      const handler = vi.fn();
      expect(() => bus.off("nonexistent", handler)).not.toThrow();
    });
  });

  describe("once", () => {
    it("should call handler only once then auto-remove", () => {
      const handler = vi.fn();
      bus.once("test", handler);
      bus.emit("test", "first");
      bus.emit("test", "second");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith("first");
    });

    it("should work alongside regular on handlers", () => {
      const onceHandler = vi.fn();
      const onHandler = vi.fn();
      bus.once("test", onceHandler);
      bus.on("test", onHandler);

      bus.emit("test", "first");
      bus.emit("test", "second");

      expect(onceHandler).toHaveBeenCalledOnce();
      expect(onHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe("removeAll", () => {
    it("should remove all handlers for a specific event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on("test", handler1);
      bus.on("test", handler2);
      bus.removeAll("test");
      bus.emit("test", "data");
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it("should not affect handlers for other events", () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      bus.on("eventA", handlerA);
      bus.on("eventB", handlerB);
      bus.removeAll("eventA");

      bus.emit("eventA", "data");
      bus.emit("eventB", "data");

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledOnce();
    });

    it("should remove all handlers for all events when called without argument", () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      bus.on("eventA", handlerA);
      bus.on("eventB", handlerB);
      bus.removeAll();

      bus.emit("eventA", "data");
      bus.emit("eventB", "data");

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should catch errors in handlers and continue executing other handlers", () => {
      const badHandler = vi.fn(() => {
        throw new Error("handler error");
      });
      const goodHandler = vi.fn();

      bus.on("test", badHandler);
      bus.on("test", goodHandler);
      bus.emit("test", "data");

      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });
});
