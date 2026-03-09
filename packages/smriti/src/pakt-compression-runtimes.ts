import { handlePaktTool } from "@sriinnu/pakt";
import type { McpClient as McpClientType, McpToolResult } from "@chitragupta/tantra";
import {
	buildUnavailableStatus,
	FAILURE_COOLDOWN_MS,
	isPaktEnabled,
	normalizePaktRuntimeResult,
	REQUIRED_PAKT_TOOLS,
	resolvePaktArgs,
	resolvePaktCommand,
	STATUS_CACHE_TTL_MS,
	type CompressionRuntime,
	type CompressionRuntimeName,
	type CompressionRuntimeStatus,
} from "./pakt-compression-types.js";

function collapseToolResult(result: McpToolResult): string {
	return result.content
		.map((entry) => {
			if (entry.type === "text") return entry.text;
			if (entry.type === "resource") return entry.text ?? "";
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

function parseStructuredResult(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return { result: parsed };
	} catch {
		return { result: raw };
	}
}

export class PaktCoreCompressionRuntime implements CompressionRuntime {
	name: CompressionRuntimeName = "pakt-core";

	async status(): Promise<CompressionRuntimeStatus> {
		if (!isPaktEnabled()) {
			return buildUnavailableStatus(this.name, "inproc", "PAKT runtime disabled");
		}
		return {
			runtime: this.name,
			transport: "inproc",
			available: true,
			command: "@sriinnu/pakt",
			args: [],
			connected: true,
			tools: [...REQUIRED_PAKT_TOOLS],
		};
	}

	async compress(args: { text: string; format?: string }): Promise<Record<string, unknown>> {
		if (!isPaktEnabled()) throw new Error("PAKT runtime disabled");
		const request: Record<string, unknown> = { text: args.text };
		if (typeof args.format === "string" && args.format.trim()) request.format = args.format.trim();
		return normalizePaktRuntimeResult(this.name, {
			action: "compressed",
			...(handlePaktTool("pakt_compress", request) as unknown as Record<string, unknown>),
		});
	}

	async auto(args: { text: string }): Promise<Record<string, unknown>> {
		if (!isPaktEnabled()) throw new Error("PAKT runtime disabled");
		return normalizePaktRuntimeResult(
			this.name,
			handlePaktTool("pakt_auto", { text: args.text }) as unknown as Record<string, unknown>,
		);
	}
}

export class PaktMcpCompressionRuntime implements CompressionRuntime {
	name: CompressionRuntimeName = "pakt";
	private client: McpClientType | null = null;
	private connecting: Promise<McpClientType> | null = null;
	private discoveredTools: string[] = [];
	private lastStatus: CompressionRuntimeStatus | null = null;
	private lastStatusAt = 0;
	private lastFailureAt = 0;

	private buildStatus(
		partial: Omit<CompressionRuntimeStatus, "runtime" | "transport" | "command" | "args">,
	): CompressionRuntimeStatus {
		return {
			runtime: this.name,
			transport: "stdio",
			command: resolvePaktCommand(),
			args: resolvePaktArgs(),
			...partial,
		};
	}

	private setStatus(status: CompressionRuntimeStatus): CompressionRuntimeStatus {
		this.lastStatus = status;
		this.lastStatusAt = Date.now();
		return status;
	}

	private getCachedStatus(): CompressionRuntimeStatus | null {
		if (!this.lastStatus) return null;
		if (Date.now() - this.lastStatusAt > STATUS_CACHE_TTL_MS) return null;
		return this.lastStatus;
	}

	private verifyRequiredTools(tools: string[]): void {
		const missingTools = REQUIRED_PAKT_TOOLS.filter((tool) => !tools.includes(tool));
		if (missingTools.length > 0) {
			throw new Error(`PAKT runtime missing required tools: ${missingTools.join(", ")}`);
		}
	}

	private async ensureClient(): Promise<McpClientType> {
		if (!isPaktEnabled()) throw new Error("PAKT runtime disabled");
		if (this.client && this.client.getState() === "connected") return this.client;
		if (this.connecting) return this.connecting;
		if (this.lastFailureAt > 0 && Date.now() - this.lastFailureAt < FAILURE_COOLDOWN_MS) {
			throw new Error("PAKT MCP runtime cooling down after recent failure");
		}

		const { McpClient } = await import("@chitragupta/tantra");
		const client = new McpClient({
			transport: "stdio",
			serverCommand: resolvePaktCommand(),
			serverArgs: resolvePaktArgs(),
			timeout: 30_000,
		});

		this.connecting = (async () => {
			try {
				await client.connect();
				const tools = await client.listTools();
				this.discoveredTools = tools.map((tool) => tool.name);
				this.verifyRequiredTools(this.discoveredTools);
				this.client = client;
				this.lastFailureAt = 0;
				this.setStatus(this.buildStatus({
					available: true,
					connected: true,
					tools: [...this.discoveredTools],
				}));
				return client;
			} catch (error) {
				this.client = null;
				this.lastFailureAt = Date.now();
				await client.disconnect().catch(() => {});
				const message = error instanceof Error ? error.message : String(error);
				const missingTools = REQUIRED_PAKT_TOOLS.filter((tool) => !this.discoveredTools.includes(tool));
				this.setStatus(this.buildStatus({
					available: false,
					connected: false,
					tools: [...this.discoveredTools],
					missingTools: missingTools.length > 0 ? missingTools : undefined,
					error: message,
				}));
				throw error;
			} finally {
				this.connecting = null;
			}
		})();

		return this.connecting;
	}

	private async callTool(
		name: "pakt_compress" | "pakt_auto",
		args: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const client = await this.ensureClient();
		const result = await client.callTool(name, args);
		const text = collapseToolResult(result);
		if (result.isError) throw new Error(text || `PAKT tool ${name} failed`);
		if (!text) throw new Error(`PAKT tool ${name} returned no text content`);
		return parseStructuredResult(text);
	}

	async status(): Promise<CompressionRuntimeStatus> {
		const cached = this.getCachedStatus();
		if (cached) return cached;
		try {
			await this.ensureClient();
			return this.buildStatus({
				available: true,
				connected: true,
				tools: [...this.discoveredTools],
			});
		} catch (error) {
			return this.setStatus(this.buildStatus({
				available: false,
				connected: false,
				tools: [...this.discoveredTools],
				missingTools: REQUIRED_PAKT_TOOLS.filter((tool) => !this.discoveredTools.includes(tool)),
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}

	async compress(args: { text: string; format?: string }): Promise<Record<string, unknown>> {
		const request: Record<string, unknown> = { text: args.text };
		if (typeof args.format === "string" && args.format.trim()) request.format = args.format.trim();
		return normalizePaktRuntimeResult(this.name, {
			action: "compressed",
			...(await this.callTool("pakt_compress", request)),
		});
	}

	async auto(args: { text: string }): Promise<Record<string, unknown>> {
		return normalizePaktRuntimeResult(
			this.name,
			await this.callTool("pakt_auto", { text: args.text }),
		);
	}
}
