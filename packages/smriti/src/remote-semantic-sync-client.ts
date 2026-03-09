import { createHash } from "node:crypto";
import { loadGlobalSettings } from "@chitragupta/core";
import type { RemoteSemanticMirrorConfig, RemoteSemanticSyncStatus } from "./remote-semantic-sync-types.js";

const DEFAULT_COLLECTION = "chitragupta_memory";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_BATCH_SIZE = 32;

function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

function parseEnabledFlag(value: string | undefined): boolean | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
	if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
	return null;
}

function readFirstEnv(...names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeQdrantId(value: string): string {
	const hex = createHash("sha1").update(value).digest("hex").slice(0, 32).split("");
	hex[12] = "5";
	hex[16] = "a";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

function buildHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers["api-key"] = apiKey;
	return headers;
}

export async function requestRemoteSemantic<T = Record<string, unknown>>(params: {
	url: string;
	method: string;
	apiKey?: string;
	body?: unknown;
	timeoutMs?: number;
}): Promise<T> {
	const response = await fetch(params.url, {
		method: params.method,
		headers: buildHeaders(params.apiKey),
		body: params.body ? JSON.stringify(params.body) : undefined,
		signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
	});
	const raw = await response.text();
	let payload: Record<string, unknown> = {};
	if (raw) {
		try {
			payload = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			payload = { message: raw };
		}
	}
	if (!response.ok) {
		const statusPayload = typeof payload.status === "object" && payload.status !== null
			? payload.status as Record<string, unknown>
			: undefined;
		throw new Error(String(statusPayload?.error ?? payload.message ?? response.statusText));
	}
	return payload as T;
}

export function resolveRemoteSemanticMirrorConfig(): RemoteSemanticMirrorConfig | null {
	const settings = loadGlobalSettings() as unknown as {
		remoteSemantic?: {
			enabled?: boolean;
			provider?: "qdrant";
			url?: string;
			apiKey?: string;
			collection?: string;
			timeoutMs?: number;
			batchSize?: number;
		};
	};
	const configured = settings.remoteSemantic ?? {};
	const enabledOverride = parseEnabledFlag(readFirstEnv(
		"CHITRAGUPTA_REMOTE_SEMANTIC_ENABLED",
		"CHITRAGUPTA_QDRANT_ENABLED",
		"VAAYU_QDRANT_ENABLED",
	));
	const provider = configured.provider ?? "qdrant";
	if (provider !== "qdrant") return null;

	const url = configured.url ?? readFirstEnv("CHITRAGUPTA_QDRANT_URL", "VAAYU_QDRANT_URL", "QDRANT_URL");
	const enabled = enabledOverride ?? configured.enabled ?? Boolean(url);
	if (!enabled || !url) return null;

	return {
		provider: "qdrant",
		baseUrl: normalizeUrl(url),
		apiKey: configured.apiKey ?? readFirstEnv("CHITRAGUPTA_QDRANT_API_KEY", "VAAYU_QDRANT_API_KEY", "QDRANT_API_KEY"),
		collection: configured.collection
			?? readFirstEnv("CHITRAGUPTA_QDRANT_COLLECTION", "VAAYU_QDRANT_COLLECTION", "QDRANT_COLLECTION")
			?? DEFAULT_COLLECTION,
		timeoutMs: parsePositiveInt(
			configured.timeoutMs ?? readFirstEnv("CHITRAGUPTA_QDRANT_TIMEOUT_MS", "VAAYU_QDRANT_TIMEOUT_MS", "QDRANT_TIMEOUT_MS"),
			DEFAULT_TIMEOUT_MS,
		),
		batchSize: parsePositiveInt(
			configured.batchSize ?? readFirstEnv("CHITRAGUPTA_QDRANT_BATCH_SIZE"),
			DEFAULT_BATCH_SIZE,
		),
	};
}

export async function ensureRemoteSemanticCollection(config: RemoteSemanticMirrorConfig, vectorSize: number): Promise<void> {
	try {
		await requestRemoteSemantic({
			url: `${config.baseUrl}/collections/${config.collection}`,
			method: "GET",
			apiKey: config.apiKey,
			timeoutMs: config.timeoutMs,
		});
		return;
	} catch {
		/* create on demand */
	}
	await requestRemoteSemantic({
		url: `${config.baseUrl}/collections/${config.collection}`,
		method: "PUT",
		apiKey: config.apiKey,
		timeoutMs: config.timeoutMs,
		body: {
			vectors: {
				size: vectorSize,
				distance: "Cosine",
			},
		},
	});
}

export async function checkRemoteSemanticHealth(config: RemoteSemanticMirrorConfig): Promise<RemoteSemanticSyncStatus["remoteHealth"]> {
	const start = Date.now();
	try {
		const response = await fetch(`${config.baseUrl}/health`, {
			method: "GET",
			headers: config.apiKey ? { "api-key": config.apiKey } : undefined,
			signal: AbortSignal.timeout(config.timeoutMs),
		});
		if (!response.ok) {
			const raw = await response.text().catch(() => "");
			return {
				ok: false,
				status: response.status,
				error: raw ? raw.slice(0, 280) : response.statusText,
				durationMs: Date.now() - start,
			};
		}
		return { ok: true, status: response.status, durationMs: Date.now() - start };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - start,
		};
	}
}
