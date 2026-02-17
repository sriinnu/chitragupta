import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  parseMessage,
  isRequest,
  isResponse,
  isNotification,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
} from "../src/jsonrpc.js";

describe("jsonrpc", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Error Codes
  // ═══════════════════════════════════════════════════════════════════════

  describe("error codes", () => {
    it("should define standard JSON-RPC 2.0 error codes", () => {
      expect(PARSE_ERROR).toBe(-32700);
      expect(INVALID_REQUEST).toBe(-32600);
      expect(METHOD_NOT_FOUND).toBe(-32601);
      expect(INVALID_PARAMS).toBe(-32602);
      expect(INTERNAL_ERROR).toBe(-32603);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Message Factories
  // ═══════════════════════════════════════════════════════════════════════

  describe("createRequest", () => {
    it("should create a valid JSON-RPC 2.0 request", () => {
      const req = createRequest("tools/list", { filter: "all" }, 42);
      expect(req.jsonrpc).toBe("2.0");
      expect(req.id).toBe(42);
      expect(req.method).toBe("tools/list");
      expect(req.params).toEqual({ filter: "all" });
    });

    it("should auto-generate an ID when not provided", () => {
      const req1 = createRequest("method-a");
      const req2 = createRequest("method-b");
      expect(typeof req1.id).toBe("number");
      expect(typeof req2.id).toBe("number");
      expect(req1.id).not.toBe(req2.id);
    });

    it("should omit params when undefined", () => {
      const req = createRequest("ping", undefined, 1);
      expect(req.jsonrpc).toBe("2.0");
      expect(req.method).toBe("ping");
      expect("params" in req).toBe(false);
    });

    it("should include params when provided as empty object", () => {
      const req = createRequest("test", {}, 1);
      expect(req.params).toEqual({});
    });
  });

  describe("createResponse", () => {
    it("should create a valid JSON-RPC 2.0 success response", () => {
      const res = createResponse(1, { tools: [] });
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result).toEqual({ tools: [] });
      expect(res.error).toBeUndefined();
    });

    it("should handle null result", () => {
      const res = createResponse(2, null);
      expect(res.result).toBeNull();
    });
  });

  describe("createErrorResponse", () => {
    it("should create a valid JSON-RPC 2.0 error response", () => {
      const res = createErrorResponse(1, METHOD_NOT_FOUND, "Method not found");
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32601);
      expect(res.error!.message).toBe("Method not found");
      expect(res.result).toBeUndefined();
    });

    it("should include optional data in error", () => {
      const res = createErrorResponse(1, INVALID_PARAMS, "Bad params", { field: "name" });
      expect(res.error!.data).toEqual({ field: "name" });
    });

    it("should omit data when not provided", () => {
      const res = createErrorResponse(1, INTERNAL_ERROR, "oops");
      expect(res.error!.data).toBeUndefined();
    });
  });

  describe("createNotification", () => {
    it("should create a valid JSON-RPC 2.0 notification (no id)", () => {
      const notif = createNotification("notifications/initialized", { ready: true });
      expect(notif.jsonrpc).toBe("2.0");
      expect(notif.method).toBe("notifications/initialized");
      expect(notif.params).toEqual({ ready: true });
      expect("id" in notif).toBe(false);
    });

    it("should omit params when undefined", () => {
      const notif = createNotification("ping");
      expect("params" in notif).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // parseMessage
  // ═══════════════════════════════════════════════════════════════════════

  describe("parseMessage", () => {
    it("should parse a valid request", () => {
      const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
      const msg = parseMessage(raw);
      expect(msg).not.toBeNull();
      expect(isRequest(msg!)).toBe(true);
    });

    it("should parse a valid response with result", () => {
      const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
      const msg = parseMessage(raw);
      expect(msg).not.toBeNull();
      expect(isResponse(msg!)).toBe(true);
    });

    it("should parse a valid error response", () => {
      const raw = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Not found" },
      });
      const msg = parseMessage(raw);
      expect(msg).not.toBeNull();
      expect(isResponse(msg!)).toBe(true);
    });

    it("should parse a valid notification", () => {
      const raw = JSON.stringify({ jsonrpc: "2.0", method: "update" });
      const msg = parseMessage(raw);
      expect(msg).not.toBeNull();
      expect(isNotification(msg!)).toBe(true);
    });

    it("should return null for invalid JSON", () => {
      expect(parseMessage("not json")).toBeNull();
    });

    it("should return null for non-object JSON", () => {
      expect(parseMessage('"just a string"')).toBeNull();
      expect(parseMessage("42")).toBeNull();
      expect(parseMessage("null")).toBeNull();
    });

    it("should return null for wrong jsonrpc version", () => {
      expect(parseMessage(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "test" }))).toBeNull();
    });

    it("should return null for unrecognizable message structure", () => {
      // Has jsonrpc but no method and no result/error
      expect(parseMessage(JSON.stringify({ jsonrpc: "2.0", id: 1 }))).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Type Guards
  // ═══════════════════════════════════════════════════════════════════════

  describe("isRequest", () => {
    it("should return true for a request (has id + method)", () => {
      const req = createRequest("tools/list", undefined, 1);
      expect(isRequest(req)).toBe(true);
    });

    it("should return false for a response", () => {
      const res = createResponse(1, {});
      expect(isRequest(res)).toBe(false);
    });

    it("should return false for a notification", () => {
      const notif = createNotification("update");
      expect(isRequest(notif)).toBe(false);
    });
  });

  describe("isResponse", () => {
    it("should return true for a success response", () => {
      const res = createResponse(1, "ok");
      expect(isResponse(res)).toBe(true);
    });

    it("should return true for an error response", () => {
      const res = createErrorResponse(1, INTERNAL_ERROR, "fail");
      expect(isResponse(res)).toBe(true);
    });

    it("should return false for a request", () => {
      const req = createRequest("test", undefined, 1);
      // A request has id + method, isResponse checks for id + result/error
      // Since the request has no result/error, it should be false
      expect(isResponse(req)).toBe(false);
    });
  });

  describe("isNotification", () => {
    it("should return true for a notification", () => {
      const notif = createNotification("event");
      expect(isNotification(notif)).toBe(true);
    });

    it("should return false for a request", () => {
      const req = createRequest("test", undefined, 1);
      expect(isNotification(req)).toBe(false);
    });
  });
});
