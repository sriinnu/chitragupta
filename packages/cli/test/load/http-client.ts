/**
 * Dvaara Pariikshaka — HTTP load test client for Chitragupta.
 * Sanskrit: Pariikshaka (परीक्षक) = tester, examiner.
 *
 * Thin wrapper over Node.js `http` module with keep-alive pooling
 * and high-resolution latency tracking via performance.now().
 * NO external dependencies.
 */

import http from "node:http";
import { performance } from "node:perf_hooks";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HttpResponse {
	status: number;
	duration: number;
	body: unknown;
}

export interface HttpDeleteResponse {
	status: number;
	duration: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class LoadHttpClient {
	private readonly baseUrl: string;
	private readonly authToken?: string;
	private readonly agent: http.Agent;

	constructor(baseUrl: string, authToken?: string) {
		this.baseUrl = baseUrl;
		this.authToken = authToken;
		this.agent = new http.Agent({
			keepAlive: true,
			maxSockets: 256,
			maxFreeSockets: 64,
			keepAliveMsecs: 30_000,
		});
	}

	async get(path: string): Promise<HttpResponse> {
		return this.request("GET", path);
	}

	async post(path: string, body: unknown): Promise<HttpResponse> {
		return this.request("POST", path, body);
	}

	async put(path: string, body: unknown): Promise<HttpResponse> {
		return this.request("PUT", path, body);
	}

	async delete(path: string): Promise<HttpDeleteResponse> {
		const result = await this.request("DELETE", path);
		return { status: result.status, duration: result.duration };
	}

	/** Destroy the keep-alive connection pool. */
	destroy(): void {
		this.agent.destroy();
	}

	// ─── Internal ────────────────────────────────────────────────────────

	private request(method: string, path: string, body?: unknown): Promise<HttpResponse> {
		return new Promise<HttpResponse>((resolve, reject) => {
			const url = new URL(path, this.baseUrl);
			const payload = body !== undefined ? JSON.stringify(body) : undefined;

			const headers: Record<string, string> = {
				"Accept": "application/json",
			};
			if (payload !== undefined) {
				headers["Content-Type"] = "application/json";
				headers["Content-Length"] = String(Buffer.byteLength(payload, "utf-8"));
			}
			if (this.authToken) {
				headers["Authorization"] = `Bearer ${this.authToken}`;
			}

			const startMs = performance.now();

			const req = http.request(
				{
					hostname: url.hostname,
					port: url.port,
					path: url.pathname + url.search,
					method,
					headers,
					agent: this.agent,
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () => {
						const duration = performance.now() - startMs;
						const raw = Buffer.concat(chunks).toString("utf-8");
						let parsed: unknown;
						try {
							parsed = JSON.parse(raw);
						} catch {
							parsed = raw;
						}
						resolve({ status: res.statusCode ?? 0, duration, body: parsed });
					});
					res.on("error", reject);
				},
			);

			req.on("error", reject);

			if (payload !== undefined) {
				req.write(payload);
			}
			req.end();
		});
	}
}
