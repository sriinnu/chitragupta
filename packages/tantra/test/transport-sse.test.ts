import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSEServerTransport, SSEClientTransport } from "../src/transport/sse.js";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, McpServerAuthConfig } from "../src/types.js";

const VALID_TOKEN = "chg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_TOKEN = "chg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function getBaseUrl(transport: SSEServerTransport): string {
	const server = (transport as { _server: { address(): { port: number } } })._server;
	return `http://127.0.0.1:${server.address().port}`;
}

async function openSse(
	baseUrl: string,
	init: RequestInit = {},
): Promise<{ response: Response; reader: ReadableStreamDefaultReader<Uint8Array>; endpointText: string; clientId: string }> {
	const response = await fetch(`${baseUrl}/sse`, {
		headers: {
			Accept: "text/event-stream",
			...(init.headers ?? {}),
		},
		...init,
	});
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	const { value } = await reader.read();
	const endpointText = decoder.decode(value);
	const match = endpointText.match(/\/message\?clientId=([0-9a-f-]+)/i);
	if (!match) {
		throw new Error(`Missing clientId in SSE endpoint payload: ${endpointText}`);
	}
	return { response, reader, endpointText, clientId: match[1] };
}

function createProtectedAuth(
	overrides: Partial<McpServerAuthConfig> = {},
): McpServerAuthConfig {
	return {
		validateToken(token) {
			if (token === VALID_TOKEN) {
				return { authenticated: true, keyId: "key-a", tenantId: "tenant-local", scopes: ["read", "tools"] };
			}
			if (token === SECOND_TOKEN) {
				return { authenticated: true, keyId: "key-b", tenantId: "tenant-local", scopes: ["read"] };
			}
			return { authenticated: false, error: "invalid token" };
		},
		...overrides,
	};
}

describe("SSEServerTransport", () => {
	let transport: SSEServerTransport;

	beforeEach(() => {
		transport = new SSEServerTransport();
	});

	afterEach(async () => {
		await transport.stop();
	});

	it("should start and stop without error", async () => {
		await transport.start(0);
		await transport.stop();
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should handle HTTP GET /sse endpoint", async () => {
		await transport.start(0);
		const { response, reader, endpointText } = await openSse(getBaseUrl(transport));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(endpointText).toContain("event: endpoint");
		expect(endpointText).toContain("/message?clientId=");
		await reader.cancel();
	});

	it("should handle HTTP POST /message endpoint", async () => {
		const handler = vi.fn();
		transport.onMessage(handler);
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const { reader, clientId } = await openSse(baseUrl);

		const rpcMessage: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "test",
			params: { foo: "bar" },
		};

		const response = await fetch(`${baseUrl}/message?clientId=${clientId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rpcMessage),
		});
		expect(response.status).toBe(200);
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].method).toBe("test");
		expect(handler.mock.calls[0][1]).toEqual({ clientId });
		await reader.cancel();
	});

	it("should require clientId for POST /message", async () => {
		transport.onMessage(vi.fn());
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const response = await fetch(`${baseUrl}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		expect(response.status).toBe(400);
	});

	it("should return 404 for unknown paths", async () => {
		await transport.start(0);
		const response = await fetch(`${getBaseUrl(transport)}/unknown`);
		expect(response.status).toBe(404);
	});

	it("should return 400 for invalid JSON-RPC in POST /message", async () => {
		transport.onMessage(vi.fn());
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const { reader, clientId } = await openSse(baseUrl);
		const response = await fetch(`${baseUrl}/message?clientId=${clientId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not valid json {{{",
		});
		expect(response.status).toBe(400);
		await reader.cancel();
	});

	it("should handle OPTIONS requests for CORS", async () => {
		await transport.start(0);
		const response = await fetch(`${getBaseUrl(transport)}/sse`, { method: "OPTIONS" });
		expect(response.status).toBe(204);
	});

	it("should send message to a connected client", async () => {
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const { reader, clientId } = await openSse(baseUrl);
		const decoder = new TextDecoder();

		const rpcResponse: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 1,
			result: { answer: 42 },
		};
		transport.send(rpcResponse, clientId);

		const { value } = await reader.read();
		expect(decoder.decode(value)).toContain('"answer":42');
		await reader.cancel();
	});

	it("should broadcast to all connected clients", async () => {
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const client1 = await openSse(baseUrl);
		const client2 = await openSse(baseUrl);
		const decoder = new TextDecoder();

		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method: "notify",
			params: { msg: "hello all" },
		};
		transport.broadcast(notification);

		const { value: v1 } = await client1.reader.read();
		const { value: v2 } = await client2.reader.read();
		expect(decoder.decode(v1)).toContain("hello all");
		expect(decoder.decode(v2)).toContain("hello all");
		await client1.reader.cancel();
		await client2.reader.cancel();
	});

	it("should clean up client on disconnect", async () => {
		await transport.start(0);
		const client = await openSse(getBaseUrl(transport));
		expect((transport as { _clients: Map<string, unknown> })._clients.size).toBe(1);
		await client.reader.cancel();
		await new Promise((r) => setTimeout(r, 100));
		expect((transport as { _clients: Map<string, unknown> })._clients.size).toBe(0);
	});
});

describe("SSE transport auth", () => {
	afterEach(async () => {
		// no-op guard for independent transports created inside tests
	});

	it("should reject unauthenticated SSE connections when auth is required", async () => {
		const transport = new SSEServerTransport(createProtectedAuth());
		await transport.start(0);
		const response = await fetch(`${getBaseUrl(transport)}/sse`, {
			headers: { Accept: "text/event-stream" },
		});
		expect(response.status).toBe(401);
		await transport.stop();
	});

	it("should accept authenticated SSE connections and POSTs", async () => {
		const handler = vi.fn();
		const transport = new SSEServerTransport(createProtectedAuth());
		transport.onMessage(handler);
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const client = await openSse(baseUrl, {
			headers: { Authorization: `Bearer ${VALID_TOKEN}` },
		});

		const response = await fetch(`${baseUrl}/message?clientId=${client.clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${VALID_TOKEN}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		expect(response.status).toBe(200);
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][1]).toEqual({
			clientId: client.clientId,
			auth: { keyId: "key-a", tenantId: "tenant-local", scopes: ["read", "tools"] },
		});

		await client.reader.cancel();
		await transport.stop();
	});

	it("should reject client/token mismatches", async () => {
		const transport = new SSEServerTransport(createProtectedAuth());
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const client = await openSse(baseUrl, {
			headers: { Authorization: `Bearer ${VALID_TOKEN}` },
		});

		const response = await fetch(`${baseUrl}/message?clientId=${client.clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${SECOND_TOKEN}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		expect(response.status).toBe(403);
		await client.reader.cancel();
		await transport.stop();
	});

	it("should enforce authorizeMethod scope checks", async () => {
		const transport = new SSEServerTransport(createProtectedAuth({
			authorizeMethod(method, context) {
				if (method === "tools/call" && !context.scopes.includes("tools")) {
					return { allowed: false, requiredScope: "tools" };
				}
				return { allowed: true };
			},
		}));
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const client = await openSse(baseUrl, {
			headers: { Authorization: `Bearer ${SECOND_TOKEN}` },
		});

		const response = await fetch(`${baseUrl}/message?clientId=${client.clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${SECOND_TOKEN}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } }),
		});
		expect(response.status).toBe(403);
		await client.reader.cancel();
		await transport.stop();
	});

	it("should enforce per-key request rate limits", async () => {
		const transport = new SSEServerTransport(createProtectedAuth({
			rateLimit: { maxRequests: 1, windowMs: 60_000 },
		}));
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);
		const client = await openSse(baseUrl, {
			headers: { Authorization: `Bearer ${VALID_TOKEN}` },
		});

		const first = await fetch(`${baseUrl}/message?clientId=${client.clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${VALID_TOKEN}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		const second = await fetch(`${baseUrl}/message?clientId=${client.clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${VALID_TOKEN}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
		await client.reader.cancel();
		await transport.stop();
	});
});

describe("SSEClientTransport", () => {
	let serverTransport: SSEServerTransport;
	let clientTransport: SSEClientTransport;
	let baseUrl: string;

	beforeEach(async () => {
		serverTransport = new SSEServerTransport();
		await serverTransport.start(0);
		baseUrl = getBaseUrl(serverTransport);
		clientTransport = new SSEClientTransport();
	});

	afterEach(async () => {
		clientTransport.disconnect();
		await serverTransport.stop();
	});

	it("should connect to SSE server", async () => {
		await clientTransport.connect(baseUrl);
		expect((clientTransport as { _connected: boolean })._connected).toBe(true);
	});

	it("should register a message handler", () => {
		const handler = vi.fn();
		clientTransport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should send a message to the server via POST", async () => {
		const serverHandler = vi.fn();
		serverTransport.onMessage(serverHandler);
		await clientTransport.connect(baseUrl);
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
		await clientTransport.connect(baseUrl);
		await new Promise((r) => setTimeout(r, 100));

		const clientId = (serverTransport as { _clients: Map<string, unknown> })._clients.keys().next().value as string;
		const rpcResponse: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 42,
			result: { tools: [] },
		};
		serverTransport.send(rpcResponse, clientId);

		await new Promise((r) => setTimeout(r, 200));
		expect(clientHandler).toHaveBeenCalled();
		expect(clientHandler.mock.calls[0][0].id).toBe(42);
	});

	it("should reject send when not connected", async () => {
		const rpcReq: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "test" };
		await expect(clientTransport.send(rpcReq)).rejects.toThrow("not connected");
	});

	it("should disconnect cleanly", async () => {
		await clientTransport.connect(baseUrl);
		clientTransport.disconnect();
		expect((clientTransport as { _connected: boolean })._connected).toBe(false);
	});

	it("should reject connection to invalid URL", async () => {
		await expect(clientTransport.connect("http://127.0.0.1:1")).rejects.toThrow();
	});

	it("should connect and send with auth token to protected servers", async () => {
		await serverTransport.stop();
		serverTransport = new SSEServerTransport(createProtectedAuth());
		const serverHandler = vi.fn();
		serverTransport.onMessage(serverHandler);
		await serverTransport.start(0);
		baseUrl = getBaseUrl(serverTransport);

		await clientTransport.connect(baseUrl, { token: VALID_TOKEN });
		await new Promise((r) => setTimeout(r, 100));
		await clientTransport.send({ jsonrpc: "2.0", id: 7, method: "ping" });
		await new Promise((r) => setTimeout(r, 100));
		expect(serverHandler).toHaveBeenCalledOnce();
	});

	it("should reject connecting to protected servers without auth token", async () => {
		await serverTransport.stop();
		serverTransport = new SSEServerTransport(createProtectedAuth());
		await serverTransport.start(0);
		baseUrl = getBaseUrl(serverTransport);
		await expect(clientTransport.connect(baseUrl)).rejects.toThrow("status 401");
	});
});
