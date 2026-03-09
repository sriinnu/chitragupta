import { afterEach, describe, expect, it, vi } from "vitest";
import { createResponse } from "../src/jsonrpc.js";
import { StreamableHttpClientTransport, StreamableHttpServerTransport } from "../src/transport/streamable-http.js";
import type { JsonRpcRequest, McpServerAuthConfig } from "../src/types.js";

const VALID_TOKEN = "chg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_TOKEN = "chg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function getBaseUrl(transport: StreamableHttpServerTransport): string {
	const server = (transport as { _server: { address(): { port: number } } })._server;
	return `http://127.0.0.1:${server.address().port}`;
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

describe("Streamable HTTP transport", () => {
	let transport: StreamableHttpServerTransport | null = null;

	afterEach(async () => {
		if (transport) {
			await transport.stop();
			transport = null;
		}
	});

	it("establishes a session stream and returns mcp-session-id", async () => {
		transport = new StreamableHttpServerTransport();
		await transport.start(0);

		const response = await fetch(`${getBaseUrl(transport)}/mcp`, {
			headers: { Accept: "text/event-stream" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("mcp-session-id")).toBeTruthy();
		await response.body?.cancel();
	});

	it("routes POST /mcp requests and returns the JSON-RPC response body", async () => {
		transport = new StreamableHttpServerTransport(createProtectedAuth());
		transport.onMessage((msg, context) => {
			const req = msg as JsonRpcRequest;
			transport!.send(createResponse(req.id, { pong: true }), context?.clientId);
		});
		await transport.start(0);
		const baseUrl = getBaseUrl(transport);

		const stream = await fetch(`${baseUrl}/mcp`, {
			headers: {
				Accept: "text/event-stream",
				Authorization: `Bearer ${VALID_TOKEN}`,
			},
		});
		const sessionId = stream.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();

		const response = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${VALID_TOKEN}`,
				"mcp-session-id": sessionId!,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "ping",
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: { pong: true },
		});
		await stream.body?.cancel();
	});

	it("rejects unauthenticated stream connections when auth is required", async () => {
		transport = new StreamableHttpServerTransport(createProtectedAuth());
		await transport.start(0);
		const response = await fetch(`${getBaseUrl(transport)}/mcp`, {
			headers: { Accept: "text/event-stream" },
		});
		expect(response.status).toBe(401);
	});

	it("client transport round-trips requests and receives notifications", async () => {
		transport = new StreamableHttpServerTransport(createProtectedAuth());
		transport.onMessage((msg, context) => {
			const req = msg as JsonRpcRequest;
			if (req.method === "ping") {
				transport!.send(createResponse(req.id, { pong: true }), context?.clientId);
				transport!.broadcast({
					jsonrpc: "2.0",
					method: "notifications/tools/list_changed",
				});
			}
		});
		await transport.start(0);

		const client = new StreamableHttpClientTransport();
		const handler = vi.fn();
		client.onMessage(handler);
		await client.connect(getBaseUrl(transport), { token: VALID_TOKEN });

		await client.send({
			jsonrpc: "2.0",
			id: 1,
			method: "ping",
		});
		await new Promise((resolve) => setTimeout(resolve, 25));

		expect(handler).toHaveBeenCalledWith(expect.objectContaining({
			jsonrpc: "2.0",
			id: 1,
			result: { pong: true },
		}));
		expect(handler).toHaveBeenCalledWith(expect.objectContaining({
			jsonrpc: "2.0",
			method: "notifications/tools/list_changed",
		}));

		client.disconnect();
	});
});
