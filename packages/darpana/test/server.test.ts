import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createServer } from "../src/server.js";
import type { DarpanaConfig, OpenAIResponse } from "../src/types.js";
import type { DarpanaServer } from "../src/server.js";

// Mock upstream server that returns canned OpenAI responses
let mockUpstream: http.Server;
let mockPort: number;

function startMockUpstream(): Promise<void> {
	return new Promise((resolve) => {
		mockUpstream = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => {
				const body = Buffer.concat(chunks).toString();
				const parsed = JSON.parse(body);

				if (parsed.stream) {
					// SSE response
					res.writeHead(200, {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
					});

					const chunks_to_send = [
						{ id: "c1", object: "chat.completion.chunk", model: parsed.model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
						{ id: "c1", object: "chat.completion.chunk", model: parsed.model, choices: [{ index: 0, delta: { content: "Hello from mock!" }, finish_reason: null }] },
						{ id: "c1", object: "chat.completion.chunk", model: parsed.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
					];

					for (const c of chunks_to_send) {
						res.write(`data: ${JSON.stringify(c)}\n\n`);
					}
					res.write("data: [DONE]\n\n");
					res.end();
				} else {
					// Non-streaming response
					const response: OpenAIResponse = {
						id: "chatcmpl-mock",
						object: "chat.completion",
						model: parsed.model,
						choices: [{
							index: 0,
							message: { role: "assistant", content: "Hello from mock upstream!" },
							finish_reason: "stop",
						}],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					};

					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(response));
				}
			});
		});

		mockUpstream.listen(0, "127.0.0.1", () => {
			const addr = mockUpstream.address() as { port: number };
			mockPort = addr.port;
			resolve();
		});
	});
}

function makeRequest(
	port: number,
	path: string,
	body: Record<string, unknown> | string,
	extraHeaders?: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: any }> {
	return new Promise((resolve, reject) => {
		const data = typeof body === "string" ? body : JSON.stringify(body);
		const req = http.request({
			hostname: "127.0.0.1",
			port,
			path,
			method: "POST",
			headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...extraHeaders },
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () => {
				const raw = Buffer.concat(chunks).toString();
				try {
					resolve({ status: res.statusCode ?? 500, headers: res.headers, body: JSON.parse(raw) });
				} catch {
					resolve({ status: res.statusCode ?? 500, headers: res.headers, body: raw });
				}
			});
		});
		req.on("error", reject);
		req.end(data);
	});
}

function makeStreamRequest(
	port: number,
	body: Record<string, unknown>,
): Promise<{ status: number; events: string[] }> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request({
			hostname: "127.0.0.1",
			port,
			path: "/v1/messages",
			method: "POST",
			headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
		}, (res) => {
			const chunks: string[] = [];
			res.on("data", (c: Buffer) => chunks.push(c.toString()));
			res.on("end", () => {
				resolve({ status: res.statusCode ?? 500, events: chunks });
			});
		});
		req.on("error", reject);
		req.end(data);
	});
}

describe("Darpana server integration", () => {
	let server: DarpanaServer;
	let serverPort: number;

	beforeAll(async () => {
		await startMockUpstream();

		const config: DarpanaConfig = {
			port: 0, // Will be assigned by OS — but our server doesn't support port 0 natively
			host: "127.0.0.1",
			providers: {
				mock: {
					type: "openai-compat",
					endpoint: `http://127.0.0.1:${mockPort}/v1`,
					models: { "gpt-4.1": {}, "gpt-4.1-mini": {} },
				},
			},
			aliases: {
				sonnet: "mock/gpt-4.1",
				haiku: "mock/gpt-4.1-mini",
			},
		};

		// Use a random high port
		config.port = 18000 + Math.floor(Math.random() * 1000);
		serverPort = config.port;
		server = createServer(config);
		await server.listen();
	});

	afterAll(async () => {
		await server?.close();
		mockUpstream?.close();
	});

	it("health check returns provider info", async () => {
		const res = await new Promise<{ status: number; body: any }>((resolve) => {
			http.get(`http://127.0.0.1:${serverPort}/`, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => resolve({ status: res.statusCode ?? 500, body: JSON.parse(Buffer.concat(chunks).toString()) }));
			});
		});

		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
		expect(res.body.service).toBe("darpana");
		expect(res.body.providers).toHaveLength(1);
		expect(res.body.aliases).toHaveProperty("sonnet");
	});

	it("proxies non-streaming request", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "sonnet",
			messages: [{ role: "user", content: "Hello" }],
			max_tokens: 1024,
		});

		expect(res.status).toBe(200);
		expect(res.body.type).toBe("message");
		expect(res.body.role).toBe("assistant");
		expect(res.body.content).toHaveLength(1);
		expect(res.body.content[0].type).toBe("text");
		expect(res.body.content[0].text).toBe("Hello from mock upstream!");
		expect(res.body.stop_reason).toBe("end_turn");
		expect(res.body.usage.input_tokens).toBe(10);
		expect(res.body.usage.output_tokens).toBe(5);
	});

	it("proxies streaming request", async () => {
		const res = await makeStreamRequest(serverPort, {
			model: "sonnet",
			messages: [{ role: "user", content: "Hello" }],
			max_tokens: 1024,
			stream: true,
		});

		expect(res.status).toBe(200);
		const combined = res.events.join("");
		expect(combined).toContain("event: message_start");
		expect(combined).toContain("event: content_block_start");
		expect(combined).toContain("event: content_block_delta");
		expect(combined).toContain("event: message_stop");
		expect(combined).toContain("Hello from mock!");
	});

	it("resolves Claude model names via aliases", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Test" }],
			max_tokens: 256,
		});

		expect(res.status).toBe(200);
		expect(res.body.type).toBe("message");
	});

	it("returns 404 for unknown routes", async () => {
		const res = await makeRequest(serverPort, "/v1/unknown", {});
		expect(res.status).toBe(404);
		expect(res.body.error.type).toBe("not_found");
	});

	it("handles CORS preflight", async () => {
		const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((resolve) => {
			const req = http.request({
				hostname: "127.0.0.1",
				port: serverPort,
				path: "/v1/messages",
				method: "OPTIONS",
			}, (res) => {
				resolve({ status: res.statusCode ?? 500, headers: res.headers });
			});
			req.end();
		});

		expect(res.status).toBe(204);
		expect(res.headers["access-control-allow-origin"]).toBe("*");
	});
});

describe("Darpana server error handling", () => {
	let server: DarpanaServer;
	let serverPort: number;

	beforeAll(async () => {
		await startMockUpstream();

		const config: DarpanaConfig = {
			port: 20000 + Math.floor(Math.random() * 1000),
			host: "127.0.0.1",
			providers: {
				mock: {
					type: "openai-compat",
					endpoint: `http://127.0.0.1:${mockPort}/v1`,
					models: { "gpt-4.1": {} },
				},
			},
			aliases: { sonnet: "mock/gpt-4.1" },
		};

		serverPort = config.port;
		server = createServer(config);
		await server.listen();
	});

	afterAll(async () => {
		await server?.close();
	});

	it("rejects malformed JSON with 400", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", "not valid json{{{");
		expect(res.status).toBe(400);
		expect(res.body.error.type).toBe("invalid_request_body");
	});

	it("rejects missing model field with 400", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			messages: [{ role: "user", content: "Hi" }],
			max_tokens: 256,
		});
		expect(res.status).toBe(400);
		expect(res.body.error.type).toBe("invalid_request");
		expect(res.body.error.message).toContain("model");
	});

	it("rejects missing messages field with 400", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "sonnet",
			max_tokens: 256,
		});
		expect(res.status).toBe(400);
		expect(res.body.error.type).toBe("invalid_request");
		expect(res.body.error.message).toContain("messages");
	});

	it("rejects missing max_tokens with 400", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "sonnet",
			messages: [{ role: "user", content: "Hi" }],
		});
		expect(res.status).toBe(400);
		expect(res.body.error.type).toBe("invalid_request");
		expect(res.body.error.message).toContain("max_tokens");
	});

	it("allows count_tokens without max_tokens", async () => {
		const res = await makeRequest(serverPort, "/v1/messages/count_tokens", {
			model: "sonnet",
			messages: [{ role: "user", content: "Hi" }],
		});
		// Should not be 400 for missing max_tokens (count_tokens doesn't require it)
		expect(res.status).not.toBe(400);
	});

	it("returns x-request-id on every response", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "sonnet",
			messages: [{ role: "user", content: "Hi" }],
			max_tokens: 256,
		});
		expect(res.headers["x-request-id"]).toBeDefined();
		expect(typeof res.headers["x-request-id"]).toBe("string");
	});

	it("propagates client x-request-id", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "sonnet",
			messages: [{ role: "user", content: "Hi" }],
			max_tokens: 256,
		}, { "x-request-id": "my-custom-id-123" });
		expect(res.headers["x-request-id"]).toBe("my-custom-id-123");
	});

	it("rejects unknown model with 400", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "nonexistent-model-xyz",
			messages: [{ role: "user", content: "Hi" }],
			max_tokens: 256,
		});
		expect(res.status).toBe(400);
		expect(res.body.error.type).toBe("invalid_request");
	});
});

describe("Darpana server auth", () => {
	let server: DarpanaServer;
	let serverPort: number;

	beforeAll(async () => {
		const config: DarpanaConfig = {
			port: 19000 + Math.floor(Math.random() * 1000),
			host: "127.0.0.1",
			providers: {
				mock: {
					type: "openai-compat",
					endpoint: "http://127.0.0.1:1/v1",
					models: { "gpt-4.1": {} },
				},
			},
			aliases: {},
			auth: { apiKey: "test-secret-key" },
		};

		serverPort = config.port;
		server = createServer(config);
		await server.listen();
	});

	afterAll(async () => {
		await server?.close();
	});

	it("rejects request without API key", async () => {
		const res = await makeRequest(serverPort, "/v1/messages", {
			model: "gpt-4.1",
			messages: [{ role: "user", content: "Hi" }],
			max_tokens: 256,
		});

		expect(res.status).toBe(401);
		expect(res.body.error.type).toBe("authentication_error");
	});

	it("accepts request with valid x-api-key header", async () => {
		const res = await new Promise<{ status: number; body: any }>((resolve, reject) => {
			const data = JSON.stringify({
				model: "gpt-4.1",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
			});
			const req = http.request({
				hostname: "127.0.0.1",
				port: serverPort,
				path: "/v1/messages",
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(data),
					"x-api-key": "test-secret-key",
				},
			}, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					// Connection to mock will fail but we test auth passed
					resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString() });
				});
			});
			req.on("error", reject);
			req.end(data);
		});

		// Should not be 401 (auth passed, but upstream will fail since mock addr is wrong)
		expect(res.status).not.toBe(401);
	});
});
