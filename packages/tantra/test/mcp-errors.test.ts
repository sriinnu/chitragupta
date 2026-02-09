import { describe, it, expect } from "vitest";
import {
	McpError,
	McpNotFoundError,
	McpHealthError,
	McpTimeoutError,
	McpTransportError,
	McpProtocolError,
	McpServerCrashedError,
} from "@chitragupta/tantra";

describe("McpError hierarchy", () => {
	// ─── McpError (base) ──────────────────────────────────────────────

	describe("McpError", () => {
		it("should set the message correctly", () => {
			const err = new McpError("something failed");
			expect(err.message).toBe("something failed");
		});

		it("should have name 'McpError'", () => {
			const err = new McpError("test");
			expect(err.name).toBe("McpError");
		});

		it("should be an instance of Error", () => {
			const err = new McpError("test");
			expect(err).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			const err = new McpError("test");
			expect(err).toBeInstanceOf(McpError);
		});

		it("should accept an optional code", () => {
			const err = new McpError("with code", -99999);
			expect(err.code).toBe(-99999);
		});

		it("should have code undefined when not provided", () => {
			const err = new McpError("no code");
			expect(err.code).toBeUndefined();
		});

		it("should have a stack trace", () => {
			const err = new McpError("traced");
			expect(err.stack).toBeDefined();
			expect(err.stack!.length).toBeGreaterThan(0);
		});
	});

	// ─── McpNotFoundError ─────────────────────────────────────────────

	describe("McpNotFoundError", () => {
		it("should have name 'McpNotFoundError'", () => {
			const err = new McpNotFoundError("not found");
			expect(err.name).toBe("McpNotFoundError");
		});

		it("should have code -32001", () => {
			const err = new McpNotFoundError("not found");
			expect(err.code).toBe(-32001);
		});

		it("should be an instance of Error", () => {
			expect(new McpNotFoundError("x")).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpNotFoundError("x")).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpNotFoundError("server xyz not found");
			expect(err.message).toBe("server xyz not found");
		});

		it("should have a stack trace", () => {
			expect(new McpNotFoundError("x").stack).toBeDefined();
		});
	});

	// ─── McpHealthError ───────────────────────────────────────────────

	describe("McpHealthError", () => {
		it("should have name 'McpHealthError'", () => {
			const err = new McpHealthError("unhealthy");
			expect(err.name).toBe("McpHealthError");
		});

		it("should have code -32002", () => {
			const err = new McpHealthError("unhealthy");
			expect(err.code).toBe(-32002);
		});

		it("should be an instance of Error", () => {
			expect(new McpHealthError("x")).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpHealthError("x")).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpHealthError("3 consecutive failures");
			expect(err.message).toBe("3 consecutive failures");
		});
	});

	// ─── McpTimeoutError ──────────────────────────────────────────────

	describe("McpTimeoutError", () => {
		it("should have name 'McpTimeoutError'", () => {
			const err = new McpTimeoutError("timed out", 5000);
			expect(err.name).toBe("McpTimeoutError");
		});

		it("should have code -32003", () => {
			const err = new McpTimeoutError("timed out", 5000);
			expect(err.code).toBe(-32003);
		});

		it("should store the timeoutMs value", () => {
			const err = new McpTimeoutError("timed out", 30000);
			expect(err.timeoutMs).toBe(30000);
		});

		it("should be an instance of Error", () => {
			expect(new McpTimeoutError("x", 100)).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpTimeoutError("x", 100)).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpTimeoutError("connection timed out after 5s", 5000);
			expect(err.message).toBe("connection timed out after 5s");
		});

		it("should have a stack trace", () => {
			expect(new McpTimeoutError("x", 1).stack).toBeDefined();
		});
	});

	// ─── McpTransportError ────────────────────────────────────────────

	describe("McpTransportError", () => {
		it("should have name 'McpTransportError'", () => {
			const err = new McpTransportError("pipe broken");
			expect(err.name).toBe("McpTransportError");
		});

		it("should have code -32004", () => {
			const err = new McpTransportError("pipe broken");
			expect(err.code).toBe(-32004);
		});

		it("should be an instance of Error", () => {
			expect(new McpTransportError("x")).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpTransportError("x")).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpTransportError("SSE connection dropped");
			expect(err.message).toBe("SSE connection dropped");
		});
	});

	// ─── McpProtocolError ─────────────────────────────────────────────

	describe("McpProtocolError", () => {
		it("should have name 'McpProtocolError'", () => {
			const err = new McpProtocolError("invalid transition");
			expect(err.name).toBe("McpProtocolError");
		});

		it("should have code -32005", () => {
			const err = new McpProtocolError("invalid transition");
			expect(err.code).toBe(-32005);
		});

		it("should be an instance of Error", () => {
			expect(new McpProtocolError("x")).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpProtocolError("x")).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpProtocolError("malformed handshake");
			expect(err.message).toBe("malformed handshake");
		});
	});

	// ─── McpServerCrashedError ────────────────────────────────────────

	describe("McpServerCrashedError", () => {
		it("should have name 'McpServerCrashedError'", () => {
			const err = new McpServerCrashedError("crashed", "srv-1");
			expect(err.name).toBe("McpServerCrashedError");
		});

		it("should have code -32006", () => {
			const err = new McpServerCrashedError("crashed", "srv-1");
			expect(err.code).toBe(-32006);
		});

		it("should store the serverId", () => {
			const err = new McpServerCrashedError("server died", "my-server-42");
			expect(err.serverId).toBe("my-server-42");
		});

		it("should be an instance of Error", () => {
			expect(new McpServerCrashedError("x", "s")).toBeInstanceOf(Error);
		});

		it("should be an instance of McpError", () => {
			expect(new McpServerCrashedError("x", "s")).toBeInstanceOf(McpError);
		});

		it("should preserve the message", () => {
			const err = new McpServerCrashedError("exceeded max restarts", "srv-a");
			expect(err.message).toBe("exceeded max restarts");
		});

		it("should have a stack trace", () => {
			expect(new McpServerCrashedError("x", "s").stack).toBeDefined();
		});
	});

	// ─── Cross-cutting ────────────────────────────────────────────────

	describe("cross-cutting concerns", () => {
		it("all subclasses should be instanceof McpError", () => {
			const errors = [
				new McpNotFoundError("a"),
				new McpHealthError("b"),
				new McpTimeoutError("c", 1),
				new McpTransportError("d"),
				new McpProtocolError("e"),
				new McpServerCrashedError("f", "g"),
			];
			for (const err of errors) {
				expect(err).toBeInstanceOf(McpError);
			}
		});

		it("all subclasses should be instanceof Error", () => {
			const errors = [
				new McpNotFoundError("a"),
				new McpHealthError("b"),
				new McpTimeoutError("c", 1),
				new McpTransportError("d"),
				new McpProtocolError("e"),
				new McpServerCrashedError("f", "g"),
			];
			for (const err of errors) {
				expect(err).toBeInstanceOf(Error);
			}
		});

		it("each subclass has a unique error code", () => {
			const codes = [
				new McpNotFoundError("a").code,
				new McpHealthError("b").code,
				new McpTimeoutError("c", 1).code,
				new McpTransportError("d").code,
				new McpProtocolError("e").code,
				new McpServerCrashedError("f", "g").code,
			];
			const uniqueCodes = new Set(codes);
			expect(uniqueCodes.size).toBe(6);
		});

		it("each subclass has a unique name", () => {
			const names = [
				new McpNotFoundError("a").name,
				new McpHealthError("b").name,
				new McpTimeoutError("c", 1).name,
				new McpTransportError("d").name,
				new McpProtocolError("e").name,
				new McpServerCrashedError("f", "g").name,
			];
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(6);
		});
	});
});
