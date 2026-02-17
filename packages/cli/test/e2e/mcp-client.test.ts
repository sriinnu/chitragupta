/**
 * E2E: MCP Client Tests
 *
 * Spawns the REAL Chitragupta MCP server as a child process in stdio mode,
 * then acts as an MCP client: sends JSON-RPC 2.0 messages on stdin,
 * reads JSON-RPC responses from stdout, and validates the protocol flow.
 *
 * This is a TRUE end-to-end test -- no mocks, no stubs. The only
 * concession is a tmp project directory to avoid polluting real state.
 *
 * Protocol reference: MCP over stdio uses line-delimited JSON-RPC 2.0.
 * Each message is a single JSON object terminated by "\n".
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Constants ──────────────────────────────────────────────────────────────

const CLI_DIST = join(import.meta.dirname, "../../dist/mcp-entry.js");
const RESPONSE_TIMEOUT_MS = 8_000;
const SERVER_STARTUP_MS = 2_000;

// ─── JSON-RPC 2.0 Helpers ──────────────────────────────────────────────────

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

function makeRequest(
	method: string,
	params?: Record<string, unknown>,
	id?: number | string,
): JsonRpcRequest {
	return {
		jsonrpc: "2.0",
		id: id ?? globalRequestId++,
		method,
		...(params !== undefined ? { params } : {}),
	};
}

let globalRequestId = 1;

// ─── MCP Test Client ───────────────────────────────────────────────────────

/**
 * Minimal MCP client that communicates with a child process over stdio.
 * Sends JSON-RPC requests as newline-delimited JSON on stdin,
 * reads newline-delimited JSON-RPC responses from stdout.
 */
class McpTestClient {
	private _child: ChildProcess | null = null;
	private _buffer = "";
	private _pendingResponses: Map<
		number | string,
		{
			resolve: (resp: JsonRpcResponse) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	> = new Map();
	private _stderr: string[] = [];

	/**
	 * Spawn the MCP server process and begin listening.
	 */
	async start(entryPoint: string, args: string[] = []): Promise<void> {
		this._buffer = "";
		this._stderr = [];

		this._child = spawn("node", [entryPoint, ...args], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// Prevent any credential loading from polluting the test
				CHITRAGUPTA_HOME: join(tmpdir(), `.chitragupta-mcp-test-${randomUUID()}`),
			},
		});

		this._child.stdout?.setEncoding("utf-8");
		this._child.stdout?.on("data", (chunk: string) => {
			this._buffer += chunk;
			this._drain();
		});

		this._child.stderr?.setEncoding("utf-8");
		this._child.stderr?.on("data", (chunk: string) => {
			this._stderr.push(chunk);
		});

		this._child.on("error", (err) => {
			// Reject all pending requests on process error
			for (const [id, pending] of this._pendingResponses) {
				clearTimeout(pending.timer);
				pending.reject(new Error(`Process error: ${err.message}`));
			}
			this._pendingResponses.clear();
		});

		// Wait for the server to start (it writes startup info to stderr)
		await this._waitForStartup();
	}

	/**
	 * Send a JSON-RPC request and wait for the corresponding response.
	 */
	async request(
		method: string,
		params?: Record<string, unknown>,
		id?: number | string,
	): Promise<JsonRpcResponse> {
		if (!this._child?.stdin) {
			throw new Error("McpTestClient: not connected");
		}

		const req = makeRequest(method, params, id);
		const line = JSON.stringify(req) + "\n";

		return new Promise<JsonRpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pendingResponses.delete(req.id);
				reject(
					new Error(
						`Timeout waiting for response to request ${req.id} (method: ${method}) after ${RESPONSE_TIMEOUT_MS}ms`,
					),
				);
			}, RESPONSE_TIMEOUT_MS);

			this._pendingResponses.set(req.id, { resolve, reject, timer });
			this._child!.stdin!.write(line);
		});
	}

	/**
	 * Send raw bytes on stdin (for malformed message testing).
	 */
	sendRaw(data: string): void {
		if (!this._child?.stdin) {
			throw new Error("McpTestClient: not connected");
		}
		this._child.stdin.write(data);
	}

	/**
	 * Get collected stderr output (for diagnostics).
	 */
	getStderr(): string {
		return this._stderr.join("");
	}

	/**
	 * Kill the server process and clean up.
	 */
	async stop(): Promise<void> {
		// Reject remaining pending requests
		for (const [, pending] of this._pendingResponses) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Client stopped"));
		}
		this._pendingResponses.clear();

		if (this._child) {
			const exitPromise = new Promise<void>((resolve) => {
				this._child!.on("close", () => resolve());
				// Fallback timeout in case process does not exit
				setTimeout(() => resolve(), 2_000);
			});

			this._child.kill("SIGTERM");
			await exitPromise;
			this._child = null;
		}
		this._buffer = "";
		this._stderr = [];
	}

	/**
	 * Whether the child process is running.
	 */
	get isRunning(): boolean {
		return this._child !== null && this._child.exitCode === null;
	}

	// ─── Internal ──────────────────────────────────────────────────────

	/**
	 * Wait for the server to write its startup message to stderr.
	 */
	private _waitForStartup(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				// Even if we don't see the startup message, proceed --
				// the server might not emit one or it might be fast enough
				// that data was already buffered.
				resolve();
			}, SERVER_STARTUP_MS);

			const check = (chunk: string) => {
				if (chunk.includes("MCP server starting") || chunk.includes("Tools:")) {
					clearTimeout(timer);
					resolve();
				}
			};

			this._child?.stderr?.on("data", check);

			this._child?.on("close", (code) => {
				clearTimeout(timer);
				reject(new Error(`Server exited prematurely with code ${code}. stderr: ${this._stderr.join("")}`));
			});
		});
	}

	/**
	 * Drain the stdout buffer, extract complete lines, parse as JSON-RPC,
	 * and resolve any matching pending requests.
	 */
	private _drain(): void {
		let newlineIdx = this._buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = this._buffer.slice(0, newlineIdx).trim();
			this._buffer = this._buffer.slice(newlineIdx + 1);

			if (line.length > 0) {
				try {
					const msg = JSON.parse(line) as JsonRpcResponse;
					if (msg.jsonrpc === "2.0" && "id" in msg) {
						const pending = this._pendingResponses.get(msg.id);
						if (pending) {
							clearTimeout(pending.timer);
							this._pendingResponses.delete(msg.id);
							pending.resolve(msg);
						}
					}
				} catch {
					// Not valid JSON -- skip
				}
			}

			newlineIdx = this._buffer.indexOf("\n");
		}
	}
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("E2E: MCP Client → Chitragupta MCP Server (stdio)", () => {
	let client: McpTestClient;
	let tmpProjectDir: string;

	// Pre-flight check: skip entire suite if dist is not built
	beforeAll(() => {
		if (!existsSync(CLI_DIST)) {
			console.warn(
				`[SKIP] MCP E2E tests: dist not built. Run "npm run build --workspace=packages/cli" first.`,
			);
			return;
		}

		// Create a temporary project directory with a MEMORY.md
		tmpProjectDir = join(tmpdir(), `chitragupta-mcp-e2e-${Date.now()}`);
		mkdirSync(tmpProjectDir, { recursive: true });
		writeFileSync(
			join(tmpProjectDir, "MEMORY.md"),
			"# Test Memory\n\n- This project uses tabs for indentation.\n- TypeScript ESM monorepo.\n",
		);
	});

	afterAll(() => {
		// Cleanup temp directory
		if (tmpProjectDir && existsSync(tmpProjectDir)) {
			rmSync(tmpProjectDir, { recursive: true, force: true });
		}
	});

	afterEach(async () => {
		// Ensure client is stopped after each test
		if (client?.isRunning) {
			await client.stop();
		}
		// Reset request ID counter so each test starts fresh
		globalRequestId = 1;
	});

	/**
	 * Helper: create a client, start the server, and perform the
	 * initialize handshake. Most tests need this as a prerequisite.
	 */
	async function startAndInitialize(): Promise<{
		client: McpTestClient;
		initResponse: JsonRpcResponse;
	}> {
		client = new McpTestClient();
		await client.start(CLI_DIST, ["--project", tmpProjectDir]);

		const initResponse = await client.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "chitragupta-e2e-test", version: "0.1.0" },
		});

		return { client, initResponse };
	}

	// ═════════════════════════════════════════════════════════════════════════
	// 1. Initialize Handshake
	// ═════════════════════════════════════════════════════════════════════════

	describe("initialize handshake", () => {
		it("should complete the MCP initialize handshake", async () => {
			if (!existsSync(CLI_DIST)) return;

			const { initResponse } = await startAndInitialize();

			expect(initResponse.jsonrpc).toBe("2.0");
			expect(initResponse.error).toBeUndefined();
			expect(initResponse.result).toBeDefined();

			const result = initResponse.result as Record<string, unknown>;
			expect(result.protocolVersion).toBe("2024-11-05");
			expect(result.serverInfo).toBeDefined();
			expect(result.capabilities).toBeDefined();

			const serverInfo = result.serverInfo as Record<string, unknown>;
			expect(serverInfo.name).toBe("chitragupta");
			expect(serverInfo.version).toBe("0.1.0");
		}, 15_000);

		it("should advertise tools, resources, and prompts capabilities", async () => {
			if (!existsSync(CLI_DIST)) return;

			const { initResponse } = await startAndInitialize();
			const result = initResponse.result as Record<string, unknown>;
			const capabilities = result.capabilities as Record<string, unknown>;

			expect(capabilities.tools).toBeDefined();
			expect(capabilities.resources).toBeDefined();
			expect(capabilities.prompts).toBeDefined();
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 2. List Tools
	// ═════════════════════════════════════════════════════════════════════════

	describe("tools/list", () => {
		it("should return all registered tools with correct schemas", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/list");

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as { tools: Array<Record<string, unknown>> };
			expect(Array.isArray(result.tools)).toBe(true);

			// Should have at least the 3 MCP-specific tools + yantra built-in tools
			expect(result.tools.length).toBeGreaterThanOrEqual(3);

			// Verify MCP-specific tools exist
			const toolNames = result.tools.map((t) => t.name);
			expect(toolNames).toContain("chitragupta_memory_search");
			expect(toolNames).toContain("chitragupta_session_list");
			expect(toolNames).toContain("chitragupta_session_show");
		}, 15_000);

		it("should include proper input schemas for each tool", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/list");
			const result = response.result as { tools: Array<Record<string, unknown>> };

			// Every tool must have name, description, and inputSchema
			for (const tool of result.tools) {
				expect(typeof tool.name).toBe("string");
				expect((tool.name as string).length).toBeGreaterThan(0);
				expect(typeof tool.description).toBe("string");
				expect(tool.inputSchema).toBeDefined();

				const schema = tool.inputSchema as Record<string, unknown>;
				expect(schema.type).toBe("object");
			}
		}, 15_000);

		it("should include chitragupta_memory_search with query parameter", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/list");
			const result = response.result as { tools: Array<Record<string, unknown>> };

			const memSearchTool = result.tools.find(
				(t) => t.name === "chitragupta_memory_search",
			);
			expect(memSearchTool).toBeDefined();

			const schema = memSearchTool!.inputSchema as Record<string, unknown>;
			const properties = schema.properties as Record<string, unknown>;
			expect(properties.query).toBeDefined();
			expect(schema.required).toContain("query");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 3. List Resources
	// ═════════════════════════════════════════════════════════════════════════

	describe("resources/list", () => {
		it("should return the project memory resource", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("resources/list");

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as { resources: Array<Record<string, unknown>> };
			expect(Array.isArray(result.resources)).toBe(true);
			expect(result.resources.length).toBeGreaterThanOrEqual(1);

			const memoryResource = result.resources.find(
				(r) => r.uri === "chitragupta://memory/project",
			);
			expect(memoryResource).toBeDefined();
			expect(memoryResource!.name).toBe("Project Memory");
			expect(memoryResource!.mimeType).toBe("text/markdown");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 4. List Prompts
	// ═════════════════════════════════════════════════════════════════════════

	describe("prompts/list", () => {
		it("should return the code_review prompt template", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("prompts/list");

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as { prompts: Array<Record<string, unknown>> };
			expect(Array.isArray(result.prompts)).toBe(true);
			expect(result.prompts.length).toBeGreaterThanOrEqual(1);

			const reviewPrompt = result.prompts.find((p) => p.name === "code_review");
			expect(reviewPrompt).toBeDefined();
			expect(reviewPrompt!.description).toContain("Review code");

			// Verify arguments
			const args = reviewPrompt!.arguments as Array<Record<string, unknown>>;
			expect(Array.isArray(args)).toBe(true);

			const fileArg = args.find((a) => a.name === "file");
			expect(fileArg).toBeDefined();
			expect(fileArg!.required).toBe(true);

			const focusArg = args.find((a) => a.name === "focus");
			expect(focusArg).toBeDefined();
			expect(focusArg!.required).toBe(false);
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 5. Call a Tool
	// ═════════════════════════════════════════════════════════════════════════

	describe("tools/call", () => {
		it("should execute chitragupta_memory_search and return results", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/call", {
				name: "chitragupta_memory_search",
				arguments: { query: "indentation", limit: 5 },
			});

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as Record<string, unknown>;
			expect(result.content).toBeDefined();
			expect(Array.isArray(result.content)).toBe(true);

			const content = result.content as Array<Record<string, unknown>>;
			expect(content.length).toBeGreaterThan(0);
			expect(content[0].type).toBe("text");
			expect(typeof content[0].text).toBe("string");
		}, 15_000);

		it("should return error for memory_search without query", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/call", {
				name: "chitragupta_memory_search",
				arguments: {},
			});

			expect(response.error).toBeUndefined();
			// Tool returns isError in the result, not a JSON-RPC error
			const result = response.result as Record<string, unknown>;
			expect(result.isError).toBe(true);
		}, 15_000);

		it("should execute chitragupta_session_list and return results", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/call", {
				name: "chitragupta_session_list",
				arguments: { limit: 5 },
			});

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as Record<string, unknown>;
			expect(result.content).toBeDefined();
			expect(Array.isArray(result.content)).toBe(true);

			const content = result.content as Array<Record<string, unknown>>;
			expect(content.length).toBeGreaterThan(0);
			expect(content[0].type).toBe("text");
		}, 15_000);

		it("should return JSON-RPC error for unknown tool", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/call", {
				name: "nonexistent_tool_xyz",
				arguments: {},
			});

			// The server returns an INVALID_PARAMS error for unknown tools
			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602); // INVALID_PARAMS
			expect(response.error!.message).toContain("Unknown tool");
		}, 15_000);

		it("should return JSON-RPC error when name param is missing", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/call", {
				// Missing "name" field
				arguments: { query: "test" },
			});

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602); // INVALID_PARAMS
			expect(response.error!.message).toContain("name");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 6. Read Resource
	// ═════════════════════════════════════════════════════════════════════════

	describe("resources/read", () => {
		it("should read the project memory resource", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("resources/read", {
				uri: "chitragupta://memory/project",
			});

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as { contents: Array<Record<string, unknown>> };
			expect(result.contents).toBeDefined();
			expect(Array.isArray(result.contents)).toBe(true);
			expect(result.contents.length).toBeGreaterThan(0);
			expect(result.contents[0].type).toBe("text");
			expect(typeof result.contents[0].text).toBe("string");
		}, 15_000);

		it("should return error for unknown resource URI", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("resources/read", {
				uri: "chitragupta://nonexistent/resource",
			});

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602); // INVALID_PARAMS
			expect(response.error!.message).toContain("Unknown resource");
		}, 15_000);

		it("should return error when uri param is missing", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("resources/read", {});

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602);
			expect(response.error!.message).toContain("uri");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 7. Get Prompt
	// ═════════════════════════════════════════════════════════════════════════

	describe("prompts/get", () => {
		it("should return the code_review prompt with arguments", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("prompts/get", {
				name: "code_review",
				arguments: { file: "src/index.ts", focus: "security" },
			});

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();

			const result = response.result as Record<string, unknown>;
			expect(result.description).toContain("Review code");

			// The prompt returns messages
			const messages = result.messages as Array<Record<string, unknown>>;
			expect(Array.isArray(messages)).toBe(true);
			expect(messages.length).toBeGreaterThan(0);
			expect(messages[0].role).toBe("user");

			// Content should reference the file and focus (MCP spec: content is a single object per message)
			const content = messages[0].content as Record<string, unknown>;
			expect(content).toBeDefined();
			expect((content.text as string)).toContain("src/index.ts");
			expect((content.text as string)).toContain("security");
		}, 15_000);

		it("should return error for unknown prompt", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("prompts/get", {
				name: "nonexistent_prompt_xyz",
			});

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602);
			expect(response.error!.message).toContain("Unknown prompt");
		}, 15_000);

		it("should return error when name param is missing", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("prompts/get", {});

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32602);
			expect(response.error!.message).toContain("name");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 8. Error Handling
	// ═════════════════════════════════════════════════════════════════════════

	describe("error handling", () => {
		it("should return METHOD_NOT_FOUND for unknown methods", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("nonexistent/method");

			expect(response.error).toBeDefined();
			expect(response.error!.code).toBe(-32601); // METHOD_NOT_FOUND
			expect(response.error!.message).toContain("Method not found");
		}, 15_000);

		it("should handle ping method", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("ping");

			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();
		}, 15_000);

		it("should silently ignore malformed JSON (no crash)", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Send garbage -- the server should ignore it without crashing
			client.sendRaw("this is not json at all\n");
			client.sendRaw("{\"broken json\n");
			client.sendRaw("\n");

			// Wait a moment for the server to process
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Server should still be responsive
			const response = await client.request("ping");
			expect(response.error).toBeUndefined();
			expect(response.result).toBeDefined();
			expect(client.isRunning).toBe(true);
		}, 15_000);

		it("should ignore messages without jsonrpc: 2.0 field", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Send a valid JSON object that is NOT a JSON-RPC 2.0 message
			client.sendRaw(JSON.stringify({ id: 999, method: "ping" }) + "\n");

			// Wait for the server to process
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Server should still work -- the non-2.0 message is ignored
			const response = await client.request("ping");
			expect(response.error).toBeUndefined();
			expect(client.isRunning).toBe(true);
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 9. Concurrent Requests
	// ═════════════════════════════════════════════════════════════════════════

	describe("concurrent requests", () => {
		it("should handle multiple simultaneous requests correctly", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Fire 5 requests in parallel with distinct IDs
			const requests = [
				client.request("tools/list", undefined, 100),
				client.request("resources/list", undefined, 101),
				client.request("prompts/list", undefined, 102),
				client.request("ping", undefined, 103),
				client.request("tools/call", {
					name: "chitragupta_session_list",
					arguments: { limit: 3 },
				}, 104),
			];

			const responses = await Promise.all(requests);

			// Each response should have the correct ID
			expect(responses[0].id).toBe(100);
			expect(responses[1].id).toBe(101);
			expect(responses[2].id).toBe(102);
			expect(responses[3].id).toBe(103);
			expect(responses[4].id).toBe(104);

			// All should be successful (no errors)
			for (const resp of responses) {
				expect(resp.jsonrpc).toBe("2.0");
				expect(resp.error).toBeUndefined();
				expect(resp.result).toBeDefined();
			}

			// Verify correct result shapes
			const toolsResult = responses[0].result as { tools: unknown[] };
			expect(Array.isArray(toolsResult.tools)).toBe(true);

			const resourcesResult = responses[1].result as { resources: unknown[] };
			expect(Array.isArray(resourcesResult.resources)).toBe(true);

			const promptsResult = responses[2].result as { prompts: unknown[] };
			expect(Array.isArray(promptsResult.prompts)).toBe(true);
		}, 20_000);

		it("should maintain request-response correlation under load", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Send 10 ping requests with sequential IDs
			const promises: Promise<JsonRpcResponse>[] = [];
			for (let i = 200; i < 210; i++) {
				promises.push(client.request("ping", undefined, i));
			}

			const responses = await Promise.all(promises);

			// Verify each response has the correct ID
			const receivedIds = responses.map((r) => r.id).sort();
			const expectedIds = Array.from({ length: 10 }, (_, i) => 200 + i);
			expect(receivedIds).toEqual(expectedIds);

			// All should be successful
			for (const resp of responses) {
				expect(resp.error).toBeUndefined();
			}
		}, 20_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 10. Full Protocol Flow (Integration)
	// ═════════════════════════════════════════════════════════════════════════

	describe("full protocol flow", () => {
		it("should complete initialize -> list -> call -> read -> get sequence", async () => {
			if (!existsSync(CLI_DIST)) return;

			// Step 1: Initialize
			const { initResponse } = await startAndInitialize();
			expect(initResponse.error).toBeUndefined();

			const result = initResponse.result as Record<string, unknown>;
			const capabilities = result.capabilities as Record<string, unknown>;

			// Step 2: List tools (if advertised)
			if (capabilities.tools) {
				const toolsResp = await client.request("tools/list");
				expect(toolsResp.error).toBeUndefined();
				const toolsResult = toolsResp.result as { tools: Array<Record<string, unknown>> };
				expect(toolsResult.tools.length).toBeGreaterThan(0);

				// Step 3: Call a tool
				const callResp = await client.request("tools/call", {
					name: "chitragupta_memory_search",
					arguments: { query: "TypeScript" },
				});
				expect(callResp.error).toBeUndefined();
				const callResult = callResp.result as Record<string, unknown>;
				expect(callResult.content).toBeDefined();
			}

			// Step 4: List and read resources (if advertised)
			if (capabilities.resources) {
				const resourcesResp = await client.request("resources/list");
				expect(resourcesResp.error).toBeUndefined();

				const resourcesResult = resourcesResp.result as {
					resources: Array<Record<string, unknown>>;
				};
				if (resourcesResult.resources.length > 0) {
					const uri = resourcesResult.resources[0].uri as string;
					const readResp = await client.request("resources/read", { uri });
					expect(readResp.error).toBeUndefined();
				}
			}

			// Step 5: List and get prompts (if advertised)
			if (capabilities.prompts) {
				const promptsResp = await client.request("prompts/list");
				expect(promptsResp.error).toBeUndefined();

				const promptsResult = promptsResp.result as {
					prompts: Array<Record<string, unknown>>;
				};
				if (promptsResult.prompts.length > 0) {
					const promptName = promptsResult.prompts[0].name as string;
					const getResp = await client.request("prompts/get", {
						name: promptName,
						arguments: { file: "test.ts" },
					});
					expect(getResp.error).toBeUndefined();
				}
			}
		}, 25_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 11. Server Metadata
	// ═════════════════════════════════════════════════════════════════════════

	describe("server metadata", () => {
		it("should log startup info to stderr", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const stderr = client.getStderr();
			expect(stderr).toContain("MCP server starting");
			expect(stderr).toContain("Tools:");
			expect(stderr).toContain("stdio");
		}, 15_000);

		it("should accept a custom server name via --name flag", async () => {
			if (!existsSync(CLI_DIST)) return;

			client = new McpTestClient();
			await client.start(CLI_DIST, [
				"--project", tmpProjectDir,
				"--name", "custom-chitragupta",
			]);

			const initResponse = await client.request("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "0.1.0" },
			});

			expect(initResponse.error).toBeUndefined();

			const result = initResponse.result as Record<string, unknown>;
			const serverInfo = result.serverInfo as Record<string, unknown>;
			expect(serverInfo.name).toBe("custom-chitragupta");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 12. Tool Schema Completeness
	// ═════════════════════════════════════════════════════════════════════════

	describe("tool schema completeness", () => {
		it("should expose yantra built-in tools alongside MCP tools", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/list");
			const result = response.result as { tools: Array<Record<string, unknown>> };
			const toolNames = result.tools.map((t) => t.name as string);

			// The 3 MCP-specific tools
			expect(toolNames).toContain("chitragupta_memory_search");
			expect(toolNames).toContain("chitragupta_session_list");
			expect(toolNames).toContain("chitragupta_session_show");

			// Should also have some yantra built-in tools (the exact set depends
			// on how chitraguptaToolToMcp maps them, but there should be more than 3)
			expect(result.tools.length).toBeGreaterThan(3);
		}, 15_000);

		it("should have chitragupta_session_show with required sessionId param", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			const response = await client.request("tools/list");
			const result = response.result as { tools: Array<Record<string, unknown>> };

			const sessionShowTool = result.tools.find(
				(t) => t.name === "chitragupta_session_show",
			);
			expect(sessionShowTool).toBeDefined();

			const schema = sessionShowTool!.inputSchema as Record<string, unknown>;
			const properties = schema.properties as Record<string, unknown>;
			expect(properties.sessionId).toBeDefined();
			expect(schema.required).toContain("sessionId");
		}, 15_000);
	});

	// ═════════════════════════════════════════════════════════════════════════
	// 13. Graceful Error Recovery
	// ═════════════════════════════════════════════════════════════════════════

	describe("graceful error recovery", () => {
		it("should continue serving after a tool execution error", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Call session_show with a non-existent session -- this will
			// produce an isError result, but should not crash the server
			const errorResp = await client.request("tools/call", {
				name: "chitragupta_session_show",
				arguments: { sessionId: "nonexistent-session-id" },
			});

			// The tool handler catches errors and returns isError: true
			expect(errorResp.error).toBeUndefined();
			const errorResult = errorResp.result as Record<string, unknown>;
			expect(errorResult.content).toBeDefined();
			expect(errorResult.isError).toBe(true);

			// Server should still respond to subsequent requests
			const pingResp = await client.request("ping");
			expect(pingResp.error).toBeUndefined();
			expect(client.isRunning).toBe(true);
		}, 15_000);

		it("should handle rapid sequential requests without dropping", async () => {
			if (!existsSync(CLI_DIST)) return;

			await startAndInitialize();

			// Send 5 requests sequentially in quick succession
			for (let i = 0; i < 5; i++) {
				const resp = await client.request("ping", undefined, 300 + i);
				expect(resp.error).toBeUndefined();
				expect(resp.id).toBe(300 + i);
			}

			expect(client.isRunning).toBe(true);
		}, 20_000);
	});
});
