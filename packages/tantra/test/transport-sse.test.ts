import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSEServerTransport, SSEClientTransport } from "../src/transport/sse.js";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../src/types.js";

describe("SSEServerTransport", () => {
	let transport: SSEServerTransport;

	beforeEach(() => {
		transport = new SSEServerTransport();
	});

	afterEach(async () => {
		await transport.stop();
	});

	it("should start and stop without error", async () => {
		await transport.start(0); // port 0 = OS picks a free port
		await transport.stop();
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		// No error thrown
		expect(handler).not.toHaveBeenCalled();
	});

	it("should handle HTTP GET /sse endpoint", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const response = await fetch(`http://localhost:${port}/sse`, {
			headers: { Accept: "text/event-stream" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");

		// Read the first SSE event (endpoint announcement)
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain("event: endpoint");
		expect(text).toContain("/message?clientId=");

		reader.cancel();
	});

	it("should handle HTTP POST /message endpoint", async () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const rpcMessage: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "test",
			params: { foo: "bar" },
		};

		const response = await fetch(`http://localhost:${port}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rpcMessage),
		});
		expect(response.status).toBe(200);

		// Wait a tick for the handler to be invoked
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledOnce();
		const receivedMsg = handler.mock.calls[0][0];
		expect(receivedMsg.method).toBe("test");
	});

	it("should return 404 for unknown paths", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const response = await fetch(`http://localhost:${port}/unknown`);
		expect(response.status).toBe(404);
	});

	it("should return 400 for invalid JSON-RPC in POST /message", async () => {
		transport.onMessage(vi.fn());
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const response = await fetch(`http://localhost:${port}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not valid json {{{",
		});
		expect(response.status).toBe(400);
	});

	it("should handle OPTIONS requests for CORS", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const response = await fetch(`http://localhost:${port}/sse`, {
			method: "OPTIONS",
		});
		expect(response.status).toBe(204);
	});

	it("should send message to a connected client", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		// Connect SSE client
		const sseResponse = await fetch(`http://localhost:${port}/sse`, {
			headers: { Accept: "text/event-stream" },
		});
		const reader = sseResponse.body!.getReader();
		const decoder = new TextDecoder();

		// Read endpoint event
		await reader.read();

		// Send a message via the transport
		const rpcResponse: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 1,
			result: { answer: 42 },
		};
		transport.send(rpcResponse);

		// Read the sent message
		const { value } = await reader.read();
		const text = decoder.decode(value);
		expect(text).toContain("data:");
		expect(text).toContain('"answer":42');

		reader.cancel();
	});

	it("should broadcast to all connected clients", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		// Connect two SSE clients
		const resp1 = await fetch(`http://localhost:${port}/sse`);
		const resp2 = await fetch(`http://localhost:${port}/sse`);
		const reader1 = resp1.body!.getReader();
		const reader2 = resp2.body!.getReader();

		// Read endpoint events
		await reader1.read();
		await reader2.read();

		// Broadcast
		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method: "notify",
			params: { msg: "hello all" },
		};
		transport.broadcast(notification);

		const decoder = new TextDecoder();
		const { value: v1 } = await reader1.read();
		const { value: v2 } = await reader2.read();
		expect(decoder.decode(v1)).toContain("hello all");
		expect(decoder.decode(v2)).toContain("hello all");

		reader1.cancel();
		reader2.cancel();
	});

	it("should clean up client on disconnect", async () => {
		await transport.start(0);
		const server = (transport as any)._server;
		const port = server.address().port;

		const resp = await fetch(`http://localhost:${port}/sse`);
		const reader = resp.body!.getReader();
		await reader.read();

		// Check that we have one client
		expect((transport as any)._clients.size).toBe(1);

		// Cancel the reader (disconnect)
		await reader.cancel();

		// Wait for disconnect to propagate
		await new Promise((r) => setTimeout(r, 100));
		expect((transport as any)._clients.size).toBe(0);
	});
});

describe("SSEClientTransport", () => {
	let serverTransport: SSEServerTransport;
	let clientTransport: SSEClientTransport;
	let port: number;

	beforeEach(async () => {
		serverTransport = new SSEServerTransport();
		await serverTransport.start(0);
		const server = (serverTransport as any)._server;
		port = server.address().port;
		clientTransport = new SSEClientTransport();
	});

	afterEach(async () => {
		clientTransport.disconnect();
		await serverTransport.stop();
	});

	it("should connect to SSE server", async () => {
		await clientTransport.connect(`http://localhost:${port}`);
		// Should not throw
		expect((clientTransport as any)._connected).toBe(true);
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		clientTransport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should send a message to the server via POST", async () => {
		const serverHandler = vi.fn();
		serverTransport.onMessage(serverHandler);

		await clientTransport.connect(`http://localhost:${port}`);
		// Small delay to ensure endpoint is received
		await new Promise((r) => setTimeout(r, 100));

		const rpcReq: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: 42,
			method: "tools/list",
		};
		await clientTransport.send(rpcReq);

		await new Promise((r) => setTimeout(r, 100));
		expect(serverHandler).toHaveBeenCalledOnce();
		expect(serverHandler.mock.calls[0][0].method).toBe("tools/list");
	});

	it("should receive messages from server via SSE", async () => {
		const clientHandler = vi.fn();
		clientTransport.onMessage(clientHandler);

		await clientTransport.connect(`http://localhost:${port}`);
		await new Promise((r) => setTimeout(r, 100));

		const rpcResponse: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 42,
			result: { tools: [] },
		};
		serverTransport.send(rpcResponse);

		await new Promise((r) => setTimeout(r, 200));
		expect(clientHandler).toHaveBeenCalled();
		const msg = clientHandler.mock.calls[0][0];
		expect(msg.id).toBe(42);
	});

	it("should reject send when not connected", async () => {
		const rpcReq: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "test",
		};
		await expect(clientTransport.send(rpcReq)).rejects.toThrow("not connected");
	});

	it("should disconnect cleanly", async () => {
		await clientTransport.connect(`http://localhost:${port}`);
		clientTransport.disconnect();
		expect((clientTransport as any)._connected).toBe(false);
	});

	it("should reject connection to invalid URL", async () => {
		await expect(
			clientTransport.connect("http://localhost:1")
		).rejects.toThrow();
	});
});
