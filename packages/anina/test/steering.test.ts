import { describe, it, expect, beforeEach } from "vitest";
import { SteeringManager } from "../src/steering.js";
import type { SteeringInstruction } from "../src/steering.js";

describe("SteeringManager", () => {
  let sm: SteeringManager;

  beforeEach(() => {
    sm = new SteeringManager();
  });

  // ─── Backward-Compatible API ────────────────────────────────────────

  describe("steer() [legacy]", () => {
    it("should store a steering instruction via interrupt queue", () => {
      sm.steer("focus on the API layer");
      expect(sm.hasPending()).toBe(true);
      expect(sm.interruptCount).toBe(1);
    });

    it("should queue multiple instructions (not overwrite)", () => {
      sm.steer("first instruction");
      sm.steer("second instruction");
      expect(sm.interruptCount).toBe(2);
      // Legacy getSteeringInstruction returns FIFO
      expect(sm.getSteeringInstruction()).toBe("first instruction");
      expect(sm.getSteeringInstruction()).toBe("second instruction");
    });
  });

  describe("getSteeringInstruction() [legacy]", () => {
    it("should return null when no instruction is pending", () => {
      expect(sm.getSteeringInstruction()).toBeNull();
    });

    it("should consume and return the instruction", () => {
      sm.steer("do something");
      expect(sm.getSteeringInstruction()).toBe("do something");
      expect(sm.getSteeringInstruction()).toBeNull();
    });
  });

  describe("queueFollowUp() [legacy]", () => {
    it("should queue follow-up messages in order", () => {
      sm.queueFollowUp("first");
      sm.queueFollowUp("second");
      sm.queueFollowUp("third");
      expect(sm.getNextFollowUp()).toBe("first");
      expect(sm.getNextFollowUp()).toBe("second");
      expect(sm.getNextFollowUp()).toBe("third");
      expect(sm.getNextFollowUp()).toBeNull();
    });
  });

  describe("getNextFollowUp() [legacy]", () => {
    it("should return null when queue is empty", () => {
      expect(sm.getNextFollowUp()).toBeNull();
    });

    it("should dequeue in FIFO order", () => {
      sm.queueFollowUp("a");
      sm.queueFollowUp("b");
      expect(sm.getNextFollowUp()).toBe("a");
      expect(sm.getNextFollowUp()).toBe("b");
    });
  });

  // ─── New Dual-Queue API ─────────────────────────────────────────────

  describe("steerInterrupt()", () => {
    it("should add to the interrupt queue", () => {
      sm.steerInterrupt("urgent fix");
      expect(sm.interruptCount).toBe(1);
      expect(sm.hasPending()).toBe(true);
    });

    it("should queue multiple interrupts in FIFO order", () => {
      sm.steerInterrupt("first");
      sm.steerInterrupt("second");
      expect(sm.interruptCount).toBe(2);
    });
  });

  describe("steerFollowUp()", () => {
    it("should add to the follow-up queue", () => {
      sm.steerFollowUp("next task");
      expect(sm.followUpCount).toBe(1);
      expect(sm.hasPending()).toBe(true);
    });

    it("should queue multiple follow-ups in FIFO order", () => {
      sm.steerFollowUp("a");
      sm.steerFollowUp("b");
      sm.steerFollowUp("c");
      expect(sm.followUpCount).toBe(3);
    });
  });

  describe("getNext() — one-at-a-time mode", () => {
    it("should return null when empty", () => {
      expect(sm.getNext()).toBeNull();
    });

    it("should return interrupts before follow-ups", () => {
      sm.steerFollowUp("follow-up");
      sm.steerInterrupt("interrupt");

      const first = sm.getNext();
      expect(first).not.toBeNull();
      expect(first!.priority).toBe("interrupt");
      expect(first!.message).toBe("interrupt");

      const second = sm.getNext();
      expect(second).not.toBeNull();
      expect(second!.priority).toBe("follow-up");
      expect(second!.message).toBe("follow-up");

      expect(sm.getNext()).toBeNull();
    });

    it("should include queuedAt timestamp", () => {
      const before = Date.now();
      sm.steerInterrupt("timed");
      const result = sm.getNext();
      expect(result).not.toBeNull();
      expect(result!.queuedAt).toBeGreaterThanOrEqual(before);
      expect(result!.queuedAt).toBeLessThanOrEqual(Date.now());
    });

    it("should drain interrupts in FIFO before any follow-up", () => {
      sm.steerInterrupt("int-1");
      sm.steerFollowUp("fu-1");
      sm.steerInterrupt("int-2");
      sm.steerFollowUp("fu-2");

      const results: SteeringInstruction[] = [];
      let next = sm.getNext();
      while (next) {
        results.push(next);
        next = sm.getNext();
      }

      expect(results).toHaveLength(4);
      expect(results[0].message).toBe("int-1");
      expect(results[1].message).toBe("int-2");
      expect(results[2].message).toBe("fu-1");
      expect(results[3].message).toBe("fu-2");
    });
  });

  describe("getNext() — all mode", () => {
    it("should return null when empty", () => {
      const allMode = new SteeringManager("all");
      expect(allMode.getNext()).toBeNull();
    });

    it("should drain all into a single combined instruction", () => {
      const allMode = new SteeringManager("all");
      allMode.steerInterrupt("int-1");
      allMode.steerFollowUp("fu-1");
      allMode.steerInterrupt("int-2");

      const result = allMode.getNext();
      expect(result).not.toBeNull();
      expect(result!.message).toContain("[INTERRUPT] int-1");
      expect(result!.message).toContain("[INTERRUPT] int-2");
      expect(result!.message).toContain("fu-1");
      // Interrupts come first in the combined message
      const intIdx = result!.message.indexOf("[INTERRUPT] int-1");
      const fuIdx = result!.message.indexOf("fu-1");
      expect(intIdx).toBeLessThan(fuIdx);
      // Queue should be empty after drain
      expect(allMode.hasPending()).toBe(false);
    });
  });

  // ─── Introspection ──────────────────────────────────────────────────

  describe("pendingCount", () => {
    it("should sum both queues", () => {
      sm.steerInterrupt("a");
      sm.steerFollowUp("b");
      sm.steerFollowUp("c");
      expect(sm.pendingCount).toBe(3);
    });
  });

  describe("getMode() / setMode()", () => {
    it("should default to one-at-a-time", () => {
      expect(sm.getMode()).toBe("one-at-a-time");
    });

    it("should switch modes dynamically", () => {
      sm.setMode("all");
      expect(sm.getMode()).toBe("all");
    });
  });

  // ─── hasPending / clear ─────────────────────────────────────────────

  describe("hasPending()", () => {
    it("should return false when nothing is pending", () => {
      expect(sm.hasPending()).toBe(false);
    });

    it("should return true when an interrupt is pending", () => {
      sm.steerInterrupt("hi");
      expect(sm.hasPending()).toBe(true);
    });

    it("should return true when follow-ups are queued", () => {
      sm.steerFollowUp("follow up");
      expect(sm.hasPending()).toBe(true);
    });

    it("should return true when both are pending", () => {
      sm.steerInterrupt("steer");
      sm.steerFollowUp("follow");
      expect(sm.hasPending()).toBe(true);
    });
  });

  describe("clear()", () => {
    it("should clear both queues", () => {
      sm.steerInterrupt("instruction");
      sm.steerFollowUp("f1");
      sm.steerFollowUp("f2");
      sm.clear();
      expect(sm.hasPending()).toBe(false);
      expect(sm.getSteeringInstruction()).toBeNull();
      expect(sm.getNextFollowUp()).toBeNull();
      expect(sm.pendingCount).toBe(0);
    });
  });
});
