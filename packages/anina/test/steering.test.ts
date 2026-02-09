import { describe, it, expect } from "vitest";
import { SteeringManager } from "../src/steering.js";

describe("SteeringManager", () => {
  describe("steer()", () => {
    it("should store a steering instruction", () => {
      const sm = new SteeringManager();
      sm.steer("focus on the API layer");
      expect(sm.hasPending()).toBe(true);
    });

    it("should overwrite a previous unconsumed instruction", () => {
      const sm = new SteeringManager();
      sm.steer("first instruction");
      sm.steer("second instruction");
      const result = sm.getSteeringInstruction();
      expect(result).toBe("second instruction");
    });
  });

  describe("getSteeringInstruction()", () => {
    it("should return null when no instruction is pending", () => {
      const sm = new SteeringManager();
      expect(sm.getSteeringInstruction()).toBeNull();
    });

    it("should consume and return the instruction", () => {
      const sm = new SteeringManager();
      sm.steer("do something");
      expect(sm.getSteeringInstruction()).toBe("do something");
      expect(sm.getSteeringInstruction()).toBeNull();
    });
  });

  describe("queueFollowUp()", () => {
    it("should queue follow-up messages in order", () => {
      const sm = new SteeringManager();
      sm.queueFollowUp("first");
      sm.queueFollowUp("second");
      sm.queueFollowUp("third");
      expect(sm.getNextFollowUp()).toBe("first");
      expect(sm.getNextFollowUp()).toBe("second");
      expect(sm.getNextFollowUp()).toBe("third");
      expect(sm.getNextFollowUp()).toBeNull();
    });
  });

  describe("getNextFollowUp()", () => {
    it("should return null when queue is empty", () => {
      const sm = new SteeringManager();
      expect(sm.getNextFollowUp()).toBeNull();
    });

    it("should dequeue in FIFO order", () => {
      const sm = new SteeringManager();
      sm.queueFollowUp("a");
      sm.queueFollowUp("b");
      expect(sm.getNextFollowUp()).toBe("a");
      expect(sm.getNextFollowUp()).toBe("b");
    });
  });

  describe("hasPending()", () => {
    it("should return false when nothing is pending", () => {
      const sm = new SteeringManager();
      expect(sm.hasPending()).toBe(false);
    });

    it("should return true when a steering instruction is pending", () => {
      const sm = new SteeringManager();
      sm.steer("hi");
      expect(sm.hasPending()).toBe(true);
    });

    it("should return true when follow-ups are queued", () => {
      const sm = new SteeringManager();
      sm.queueFollowUp("follow up");
      expect(sm.hasPending()).toBe(true);
    });

    it("should return true when both are pending", () => {
      const sm = new SteeringManager();
      sm.steer("steer");
      sm.queueFollowUp("follow");
      expect(sm.hasPending()).toBe(true);
    });
  });

  describe("clear()", () => {
    it("should clear steering instruction and follow-up queue", () => {
      const sm = new SteeringManager();
      sm.steer("instruction");
      sm.queueFollowUp("f1");
      sm.queueFollowUp("f2");
      sm.clear();
      expect(sm.hasPending()).toBe(false);
      expect(sm.getSteeringInstruction()).toBeNull();
      expect(sm.getNextFollowUp()).toBeNull();
    });
  });
});
