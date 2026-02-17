import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StdioServerTransport, StdioClientTransport } from "../src/transport/stdio.js";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../src/types.js";
import { EventEmitter } from "node:events";

describe("StdioServerTransport", () => {
	let transport: StdioServerTransport;
	let mockStdin: EventEmitter & { setEncoding: any; resume: any; pause: any };
	let mockStdoutWrite: ReturnType<typeof vi.fn>;
	let originalStdin: typeof process.stdin;
	let originalStdoutWrite: typeof process.stdout.write;

	beforeEach(() => {
		transport = new StdioServerTransport();

		// Create a mock stdin
		mockStdin = new EventEmitter() as any;
		mockStdin.setEncoding = vi.fn();
		mockStdin.resume = vi.fn();
		mockStdin.pause = vi.fn();

		// Save originals and replace
		originalStdin = process.stdin;
		originalStdoutWrite = process.stdout.write;

		Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });
		mockStdoutWrite = vi.fn().mockReturnValue(true);
		process.stdout.write = mockStdoutWrite as unknown as typeof process.stdout.write;
	});

	afterEach(() => {
		transport.stop();
		Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
		process.stdout.write = originalStdoutWrite;
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should start reading from stdin", () => {
		transport.start();
		expect(mockStdin.setEncoding).toHaveBeenCalledWith("utf-8");
		expect(mockStdin.resume).toHaveBeenCalled();
	});

	it("should stop reading from stdin", () => {
		transport.start();
		transport.stop();
		expect(mockStdin.pause).toHaveBeenCalled();
	});

	it("should not start twice", () => {
		transport.start();
		transport.start();
		// setEncoding and resume should be called only once
		expect(mockStdin.setEncoding).toHaveBeenCalledTimes(1);
	});

	it("should parse JSON-RPC messages from stdin", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.start();

		const rpcReq: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		};
		mockStdin.emit("data", Buffer.from(JSON.stringify(rpcReq) + "\n"));

		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].method).toBe("tools/list");
	});

	it("should handle multiple messages in one chunk", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.start();

		const msg1: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "a" };
		const msg2: JsonRpcRequest = { jsonrpc: "2.0", id: 2, method: "b" };
		const data = JSON.stringify(msg1) + "\n" + JSON.stringify(msg2) + "\n";
		mockStdin.emit("data", Buffer.from(data));

		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler.mock.calls[0][0].method).toBe("a");
		expect(handler.mock.calls[1][0].method).toBe("b");
	});

	it("should handle split messages across chunks", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.start();

		const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "split" };
		const fullMsg = JSON.stringify(rpcReq) + "\n";
		const mid = Math.floor(fullMsg.length / 2);

		mockStdin.emit("data", Buffer.from(fullMsg.slice(0, mid)));
		expect(handler).not.toHaveBeenCalled();

		mockStdin.emit("data", Buffer.from(fullMsg.slice(mid)));
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].method).toBe("split");
	});

	it("should ignore invalid JSON lines", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.start();

		mockStdin.emit("data", Buffer.from("not valid json\n"));
		expect(handler).not.toHaveBeenCalled();
	});

	it("should send JSON-RPC messages to stdout", () => {
		const rpcResp: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 1,
			result: { tools: [] },
		};
		transport.send(rpcResp);

		expect(mockStdoutWrite).toHaveBeenCalledOnce();
		const written = mockStdoutWrite.mock.calls[0][0];
		expect(written).toContain('"jsonrpc":"2.0"');
		expect(written).toContain('"id":1');
		expect(written.endsWith("\n")).toBe(true);
	});

	it("should ignore empty lines", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.start();

		mockStdin.emit("data", Buffer.from("\n\n\n"));
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("StdioClientTransport", () => {
	let transport: StdioClientTransport;

	beforeEach(() => {
		transport = new StdioClientTransport();
	});

	afterEach(() => {
		transport.disconnect();
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should throw when sending before connect", () => {
		const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "test" };
		expect(() => transport.send(rpcReq)).toThrow("not connected");
	});

	it("should connect to a child process (echo command)", () => {
		// Use 'cat' as a simple echo-like command
		transport.connect("cat", []);
		expect((transport as any)._child).not.toBeNull();
	});

	it("should send and receive messages via stdio", async () => {
		const handler = vi.fn();
		transport.onMessage(handler);

		// cat will echo back whatever we write
		transport.connect("cat", []);

		const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "echo" };
		transport.send(rpcReq);

		// Wait for the echo
		await new Promise((r) => setTimeout(r, 200));
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].method).toBe("echo");
	});

	it("should disconnect cleanly", () => {
		transport.connect("cat", []);
		transport.disconnect();
		expect((transport as any)._child).toBeNull();
	});

	it("should handle disconnect when not connected", () => {
		transport.disconnect(); // Should not throw
		expect((transport as any)._child).toBeNull();
	});

	it("should handle multiple messages", async () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		transport.connect("cat", []);

		const msg1: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "a" };
		const msg2: JsonRpcRequest = { jsonrpc: "2.0", id: 2, method: "b" };
		transport.send(msg1);
		transport.send(msg2);

		await new Promise((r) => setTimeout(r, 300));
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("should reconnect by calling connect again", () => {
		transport.connect("cat", []);
		const firstChild = (transport as any)._child;
		expect(firstChild).not.toBeNull();

		transport.connect("cat", []);
		const secondChild = (transport as any)._child;
		expect(secondChild).not.toBeNull();
		// Should be a different child process
		expect(secondChild).not.toBe(firstChild);
	});
});
