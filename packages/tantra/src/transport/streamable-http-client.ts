import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpClientAuthConfig } from "../types.js";
import { parseMessage } from "../jsonrpc.js";
import {
	applyAuthToUrl,
	buildAuthHeaders,
	type NormalizedClientAuth,
	normalizeClientAuth,
} from "./transport-auth.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
type MessageHandler = (msg: AnyMessage) => void;

const SESSION_HEADER = "mcp-session-id";

export class StreamableHttpClientTransport {
	private _handler: MessageHandler | null = null;
	private _baseUrl = "";
	private _connected = false;
	private _allowReconnect = true;
	private _reconnectAttempts = 0;
	private _maxReconnectAttempts = 10;
	private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private _auth: NormalizedClientAuth | null = null;
	private _sessionId = "";
	private _streamRequest: ReturnType<typeof httpRequest> | ReturnType<typeof httpsRequest> | null = null;

	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	send(message: AnyMessage): Promise<void> {
		if (!this._connected || !this._sessionId) {
			return Promise.reject(new Error("StreamableHttpClientTransport: not connected"));
		}

		const body = JSON.stringify(message);
		const url = new URL("/mcp", this._baseUrl);
		applyAuthToUrl(url, this._auth);
		const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
		const headers = buildAuthHeaders(this._auth, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(body),
			[SESSION_HEADER]: this._sessionId,
		});

		return new Promise((resolve, reject) => {
			const req = doRequest(url, { method: "POST", headers }, (res) => {
				let responseBody = "";
				res.setEncoding("utf-8");
				res.on("data", (chunk: string) => {
					responseBody += chunk;
				});
				res.on("end", () => {
					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`StreamableHttpClientTransport: POST failed with status ${res.statusCode}`));
						return;
					}
					if (responseBody.trim()) {
						const parsed = parseMessage(responseBody.trim());
						if (parsed && this._handler) this._handler(parsed);
					}
					resolve();
				});
			});

			req.on("error", reject);
			req.setTimeout(30_000, () => {
				req.destroy(new Error("StreamableHttpClientTransport: POST timed out after 30s"));
			});
			req.write(body);
			req.end();
		});
	}

	connect(url: string, auth?: McpClientAuthConfig): Promise<void> {
		this._baseUrl = url;
		this._auth = normalizeClientAuth(auth);
		this._allowReconnect = true;
		this._reconnectAttempts = 0;
		return this._doConnect();
	}

	disconnect(): void {
		this._allowReconnect = false;
		this._connected = false;
		this._sessionId = "";
		this._streamRequest?.destroy();
		this._streamRequest = null;
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
	}

	private _doConnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const streamUrl = new URL("/mcp", this._baseUrl);
			applyAuthToUrl(streamUrl, this._auth);
			const doRequest = streamUrl.protocol === "https:" ? httpsRequest : httpRequest;
			const req = doRequest(
				streamUrl,
				{
					method: "GET",
					headers: buildAuthHeaders(this._auth, { Accept: "text/event-stream" }),
				},
				(res) => {
					if (res.statusCode !== 200) {
						reject(new Error(`StreamableHttpClientTransport: stream connect failed with status ${res.statusCode}`));
						return;
					}
					const sessionId = res.headers[SESSION_HEADER];
					const normalizedSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;
					if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
						reject(new Error("StreamableHttpClientTransport: missing mcp-session-id"));
						return;
					}
					this._sessionId = normalizedSessionId.trim();
					this._connected = true;
					this._reconnectAttempts = 0;
					let buffer = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk: string) => {
						buffer += chunk;
						const events = buffer.split("\n\n");
						buffer = events.pop() ?? "";
						for (const event of events) {
							this._parseEvent(event);
						}
					});
					res.on("end", () => {
						this._connected = false;
						if (this._allowReconnect) this._scheduleReconnect();
					});
					res.on("error", () => {
						this._connected = false;
						if (this._allowReconnect) this._scheduleReconnect();
					});
					resolve();
				},
			);

			this._streamRequest = req;
			req.on("error", (err) => {
				if (this._reconnectAttempts === 0) reject(err);
				else if (this._allowReconnect) this._scheduleReconnect();
			});
			req.end();
		});
	}

	private _parseEvent(event: string): void {
		const lines = event.split("\n");
		let data = "";
		for (const line of lines) {
			if (line.startsWith(":")) continue;
			if (line.startsWith("data:")) {
				data += (data ? "\n" : "") + line.slice(5).trim();
			}
		}
		if (!data) return;
		const msg = parseMessage(data);
		if (msg && this._handler) this._handler(msg);
	}

	private _scheduleReconnect(): void {
		if (!this._allowReconnect || this._reconnectAttempts >= this._maxReconnectAttempts) return;
		const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30_000);
		this._reconnectAttempts++;
		this._reconnectTimer = setTimeout(() => {
			this._doConnect().catch(() => {
				// reconnect loop is interval-driven
			});
		}, delay);
	}
}
