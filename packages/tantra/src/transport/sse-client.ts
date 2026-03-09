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

export class SSEClientTransport {
	private _handler: MessageHandler | null = null;
	private _baseUrl = "";
	private _messageEndpoint = "";
	private _connected = false;
	private _allowReconnect = true;
	private _abortController: AbortController | null = null;
	private _reconnectAttempts = 0;
	private _maxReconnectAttempts = 10;
	private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private _auth: NormalizedClientAuth | null = null;

	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	send(message: AnyMessage): Promise<void> {
		if (!this._connected || !this._messageEndpoint) {
			return Promise.reject(new Error("SSEClientTransport: not connected"));
		}

		const body = JSON.stringify(message);
		const url = new URL(this._messageEndpoint, this._baseUrl);
		applyAuthToUrl(url, this._auth);
		const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
		const headers = buildAuthHeaders(this._auth, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(body),
		});

		return new Promise((resolve, reject) => {
			const req = doRequest(url, { method: "POST", headers }, (res) => {
				res.resume();
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					resolve();
				} else {
					reject(new Error(`SSEClientTransport: POST failed with status ${res.statusCode}`));
				}
			});

			req.on("error", reject);
			req.setTimeout(30_000, () => {
				req.destroy(new Error("SSEClientTransport: POST timed out after 30s"));
			});
			req.write(body);
			req.end();
		});
	}

	connect(url: string, auth?: McpClientAuthConfig): Promise<void> {
		this._baseUrl = url;
		this._reconnectAttempts = 0;
		this._allowReconnect = true;
		this._auth = normalizeClientAuth(auth);
		return this._doConnect();
	}

	disconnect(): void {
		this._allowReconnect = false;
		this._connected = false;
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = null;
		}
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
	}

	private _doConnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const sseUrl = new URL("/sse", this._baseUrl);
			applyAuthToUrl(sseUrl, this._auth);
			const doRequest = sseUrl.protocol === "https:" ? httpsRequest : httpRequest;
			this._abortController = new AbortController();

			const req = doRequest(
				sseUrl,
				{
					method: "GET",
					signal: this._abortController.signal,
					headers: buildAuthHeaders(this._auth, { Accept: "text/event-stream" }),
				},
				(res) => {
					if (res.statusCode !== 200) {
						reject(new Error(`SSEClientTransport: SSE connect failed with status ${res.statusCode}`));
						return;
					}

					this._connected = true;
					this._reconnectAttempts = 0;
					let buffer = "";

					res.setEncoding("utf-8");
					res.on("data", (chunk: string) => {
						buffer += chunk;
						const events = buffer.split("\n\n");
						buffer = events.pop() ?? "";
						for (const event of events) {
							this._parseSSEEvent(event);
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

			req.on("error", (err) => {
				if (this._reconnectAttempts === 0) {
					reject(err);
				} else if (this._allowReconnect) {
					this._scheduleReconnect();
				}
			});

			req.end();
		});
	}

	private _parseSSEEvent(event: string): void {
		const lines = event.split("\n");
		let eventType = "";
		let data = "";

		for (const line of lines) {
			if (line.startsWith("event:")) {
				eventType = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				data += (data ? "\n" : "") + line.slice(5).trim();
			}
		}

		if (eventType === "endpoint" && data) {
			this._messageEndpoint = data;
			return;
		}

		if (data) {
			const msg = parseMessage(data);
			if (msg && this._handler) {
				this._handler(msg);
			}
		}
	}

	private _scheduleReconnect(): void {
		if (!this._allowReconnect) return;
		if (this._reconnectAttempts >= this._maxReconnectAttempts) return;

		const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30_000);
		this._reconnectAttempts++;
		this._reconnectTimer = setTimeout(() => {
			this._doConnect().catch(() => {
				// Reconnect failure handled by _scheduleReconnect in the connect flow
			});
		}, delay);
	}
}
