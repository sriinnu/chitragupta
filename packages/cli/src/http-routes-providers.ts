import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import {
	getChitraguptaHome,
} from "@chitragupta/core";
import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps } from "./http-server-types.js";

/** Shape of a persisted provider configuration entry. */
interface ProviderConfig {
	id: string;
	type: string;
	apiKey?: string;
	endpoint?: string;
	models?: string[];
}

function getProvidersConfigPath(): string {
	return path.join(getChitraguptaHome(), "config", "providers.json");
}

function readProviderConfigs(): ProviderConfig[] {
	try {
		const filePath = getProvidersConfigPath();
		if (!fs.existsSync(filePath)) return [];
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed as ProviderConfig[] : [];
	} catch {
		return [];
	}
}

function writeProviderConfigs(configs: ProviderConfig[]): void {
	const filePath = getProvidersConfigPath();
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(configs, null, "\t"), "utf-8");
}

async function testProviderConnection(config: ProviderConfig): Promise<Record<string, unknown>> {
	const endpoint = config.endpoint?.trim()
		|| (config.type === "ollama" ? process.env.OLLAMA_HOST?.trim() || "http://localhost:11434" : "");
	if (!endpoint) {
		return {
			success: false,
			providerId: config.id,
			testable: false,
			error: "Provider reachability test requires a configured endpoint. Use the CLI provider test for streamed/authenticated providers.",
		};
	}

	const url = config.type === "ollama" && !endpoint.endsWith("/api/tags")
		? `${endpoint.replace(/\/+$/, "")}/api/tags`
		: endpoint;
	const startedAt = performance.now();
	const response = await fetch(url, {
		method: "GET",
		headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
		signal: AbortSignal.timeout(5_000),
	});
	return {
		success: response.ok,
		testable: true,
		providerId: config.id,
		status: response.status,
		latencyMs: Math.round(performance.now() - startedAt),
		modelsAvailable: config.models?.length ?? 0,
	};
}

export function mountProviderRoutes(server: ChitraguptaServer, deps: ApiDeps): void {
	server.route("GET", "/api/providers", async () => {
		try {
			const providers = deps.listProviders?.() ?? [];
			return { status: 200, body: { providers } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list providers: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/providers", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.id !== "string" || body.id.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'id' field" } };
			}
			if (typeof body.type !== "string" || body.type.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'type' field" } };
			}
			const entry: ProviderConfig = {
				id: body.id.trim(),
				type: body.type.trim(),
				apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
				endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
				models: Array.isArray(body.models)
					? (body.models as unknown[]).filter((m): m is string => typeof m === "string")
					: undefined,
			};
			const configs = readProviderConfigs();
			if (configs.some((c) => c.id === entry.id)) {
				return { status: 409, body: { error: `Provider already exists: ${entry.id}` } };
			}
			configs.push(entry);
			writeProviderConfigs(configs);
			return { status: 201, body: { provider: entry } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to create provider: ${(err as Error).message}` } };
		}
	});

	server.route("PUT", "/api/providers/:id", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (body === null || typeof body !== "object" || Array.isArray(body)) {
				return { status: 400, body: { error: "Request body must be a JSON object" } };
			}
			const configs = readProviderConfigs();
			const idx = configs.findIndex((c) => c.id === req.params.id);
			if (idx === -1) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}
			const existing = configs[idx];
			const updated: ProviderConfig = {
				...existing,
				type: typeof body.type === "string" ? body.type : existing.type,
				apiKey: typeof body.apiKey === "string" ? body.apiKey : existing.apiKey,
				endpoint: typeof body.endpoint === "string" ? body.endpoint : existing.endpoint,
				models: Array.isArray(body.models)
					? (body.models as unknown[]).filter((m): m is string => typeof m === "string")
					: existing.models,
			};
			configs[idx] = updated;
			writeProviderConfigs(configs);
			return { status: 200, body: { provider: updated } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to update provider: ${(err as Error).message}` } };
		}
	});

	server.route("DELETE", "/api/providers/:id", async (req) => {
		try {
			const configs = readProviderConfigs();
			const idx = configs.findIndex((c) => c.id === req.params.id);
			if (idx === -1) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}
			const removed = configs.splice(idx, 1)[0];
			writeProviderConfigs(configs);
			return { status: 200, body: { removed } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to delete provider: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/providers/:id/test", async (req) => {
		try {
			const config = readProviderConfigs().find((entry) => entry.id === req.params.id);
			if (!config) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}
			const result = await testProviderConnection(config);
			return {
				status: result.success ? 200 : result.testable === false ? 501 : 502,
				body: result,
			};
		} catch (err) {
			return { status: 500, body: { error: `Provider test failed: ${(err as Error).message}` } };
		}
	});
}
