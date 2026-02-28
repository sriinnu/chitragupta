/**
 * Tests for the JSON-RPC 2.0 protocol module.
 */

import { describe, expect, it } from "vitest";
import {
	ErrorCode,
	createErrorResponse,
	createRequest,
	createResponse,
	isNotification,
	isRequest,
	parseMessage,
	serialize,
} from "../src/protocol.js";

describe("protocol", () => {
	describe("createRequest", () => {
		it("should create a valid JSON-RPC request", () => {
			const req = createRequest("test.method", { key: "val" }, 42);
			expect(req.jsonrpc).toBe("2.0");
			expect(req.method).toBe("test.method");
			expect(req.params).toEqual({ key: "val" });
			expect(req.id).toBe(42);
		});

		it("should auto-generate id if not provided", () => {
			const req = createRequest("ping");
			expect(typeof req.id).toBe("string");
			expect((req.id as string).length).toBeGreaterThan(0);
		});
	});

	describe("createResponse / createErrorResponse", () => {
		it("should create a success response", () => {
			const resp = createResponse(1, { ok: true });
			expect(resp.jsonrpc).toBe("2.0");
			expect(resp.id).toBe(1);
			expect(resp.result).toEqual({ ok: true });
			expect(resp.error).toBeUndefined();
		});

		it("should create an error response", () => {
			const resp = createErrorResponse(1, ErrorCode.MethodNotFound, "nope");
			expect(resp.error?.code).toBe(-32601);
			expect(resp.error?.message).toBe("nope");
		});
	});

	describe("type guards", () => {
		it("isRequest returns true for requests", () => {
			const req = createRequest("ping", undefined, 1);
			expect(isRequest(req)).toBe(true);
			expect(isNotification(req)).toBe(false);
		});

		it("isNotification returns true for notifications", () => {
			const notif = { jsonrpc: "2.0" as const, method: "event.fired", params: {} };
			expect(isNotification(notif)).toBe(true);
			expect(isRequest(notif)).toBe(false);
		});
	});

	describe("parseMessage", () => {
		it("should parse valid JSON-RPC", () => {
			const msg = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');
			expect(msg).not.toBeNull();
			expect(isRequest(msg!)).toBe(true);
		});

		it("should return null for invalid JSON", () => {
			expect(parseMessage("{not json")).toBeNull();
		});

		it("should return null for non-JSONRPC", () => {
			expect(parseMessage('{"hello":"world"}')).toBeNull();
		});
	});

	describe("serialize", () => {
		it("should produce NDJSON (ends with newline)", () => {
			const req = createRequest("test", undefined, 1);
			const line = serialize(req);
			expect(line.endsWith("\n")).toBe(true);
			expect(JSON.parse(line.trim())).toMatchObject({ jsonrpc: "2.0", method: "test" });
		});
	});
});
