/**
 * @chitragupta/daemon — Unix domain socket server.
 *
 * Accepts connections, NDJSON framing, routes to RPC handlers.
 * One instance per user, all clients connect to it.
 *
 * @module
 */

import net from "node:net";
import { createLogger } from "@chitragupta/core";
import { authorizeDaemonMethod, type DaemonAuthContext, type DaemonServerAuthConfig } from "./auth.js";
import type { DaemonPaths } from "./paths.js";
import { ensureDirs } from "./paths.js";
import {
	ErrorCode,
	createErrorResponse,
	createResponse,
	isNotification,
	isRequest,
	parseMessage,
	serialize,
	type RpcNotification,
	type RpcRequest,
	type RpcResponse,
} from "./protocol.js";
import type { RpcRouter } from "./rpc-router.js";
import { bindServerSocket } from "./server-bind.js";

const log = createLogger("daemon:server");

/** Max size of a single NDJSON message (1 MB). */
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** Max accumulated buffer per connection before forced disconnect (5 MB). */
const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

/** Max concurrent pending requests per connection. */
const MAX_PENDING_REQUESTS = 100;

/** Application-level server error code (JSON-RPC). */
const SERVER_ERROR = -32000;
const UNAUTHORIZED_ERROR = -32001;
const FORBIDDEN_ERROR = -32004;
const RATE_LIMIT_ERROR = -32029;

/** Per-connection state. */
interface ClientConnection {
	id: string;
	socket: net.Socket;
	buffer: string;
	connectedAt: number;
	/** Number of in-flight (pending) requests. */
	pendingRequests: number;
	authenticated: boolean;
	auth?: DaemonAuthContext;
}

/** Server configuration. */
export interface DaemonServerConfig {
	/** Resolved daemon paths. */
	paths: DaemonPaths;
	/** RPC method router. */
	router: RpcRouter;
	/** Optional bridge auth validator for daemon socket connections. */
	auth?: DaemonServerAuthConfig;
	/** Max concurrent connections (default: 256). */
	maxConnections?: number;
}

/** Running daemon server instance. */
export interface DaemonServer {
	/** Stop the server and close all connections. */
	stop(): Promise<void>;
	/** Number of active client connections. */
	connectionCount(): number;
	/** Whether the server is listening. */
	isListening(): boolean;
}

/**
 * Start the daemon socket server.
 *
 * Binds to the Unix domain socket, accepts connections,
 * parses NDJSON frames, and routes JSON-RPC requests.
 */
export async function startServer(config: DaemonServerConfig): Promise<DaemonServer> {
	const { paths, router, auth, maxConnections = 256 } = config;
	const clients = new Map<string, ClientConnection>();
	const requestWindows = new Map<string, number[]>();

	const sendNotification = (conn: ClientConnection, notification: RpcNotification): boolean => {
		if (conn.socket.destroyed) return false;
		try {
			conn.socket.write(serialize(notification));
			return true;
		} catch {
			return false;
		}
	};

	router.setNotifier((notification, targetClientIds) => {
		let delivered = 0;
		const targets = targetClientIds ? new Set(targetClientIds) : null;
		for (const [clientId, conn] of clients) {
			if (targets && !targets.has(clientId)) continue;
			if (sendNotification(conn, notification)) {
				delivered++;
			}
		}
		return delivered;
	});

	ensureDirs(paths);

	const server = net.createServer((socket) => {
		if (clients.size >= maxConnections) {
			log.warn("Max connections reached, rejecting", { max: maxConnections });
			socket.end(serialize(createErrorResponse(0, ErrorCode.InternalError, "Too many connections")));
			socket.destroy();
			return;
		}

		const clientId = crypto.randomUUID();
		const conn: ClientConnection = {
			id: clientId, socket, buffer: "", connectedAt: Date.now(), pendingRequests: 0, authenticated: !auth?.required,
		};
		clients.set(clientId, conn);
		router.attachClient(clientId, { transport: "socket", connectedAt: conn.connectedAt });
		log.debug("Client connected", { clientId, total: clients.size });

		socket.on("data", (chunk) => {
			conn.buffer += chunk.toString("utf-8");

			// Buffer overflow guard — disconnect before OOM
				if (conn.buffer.length > MAX_BUFFER_SIZE) {
					log.warn("Buffer limit exceeded, closing connection", {
						clientId, bufferSize: conn.buffer.length,
					});
					const err = createErrorResponse(0, SERVER_ERROR, "Buffer limit exceeded");
					conn.socket.write(serialize(err));
					conn.socket.destroy();
					clients.delete(clientId);
					router.detachClient(clientId);
					return;
				}

				processBuffer(conn, router, auth, requestWindows);
			});

		socket.on("close", () => {
			clients.delete(clientId);
			router.detachClient(clientId);
			log.debug("Client disconnected", { clientId, total: clients.size });
		});

		socket.on("error", (err) => {
			log.warn("Client socket error", { clientId, error: err.message });
			clients.delete(clientId);
			router.detachClient(clientId);
			socket.destroy();
		});
	});

	// Handle server-level errors
	server.on("error", (err) => {
		log.error("Server error", err);
	});

	// Bind to socket path with stale-socket/liveness safety.
	await bindServerSocket(server, paths.socket);
	log.info("Daemon listening", { socket: paths.socket });

	return {
		stop: () => stopServer(server, clients),
		connectionCount: () => clients.size,
		isListening: () => server.listening,
	};
}

/** Process buffered NDJSON data, dispatch complete lines. */
function processBuffer(
	conn: ClientConnection,
	router: RpcRouter,
	auth: DaemonServerAuthConfig | undefined,
	requestWindows: Map<string, number[]>,
): void {
	let newlineIdx: number;
	while ((newlineIdx = conn.buffer.indexOf("\n")) !== -1) {
		const line = conn.buffer.slice(0, newlineIdx).trim();
		conn.buffer = conn.buffer.slice(newlineIdx + 1);

		if (line.length === 0) continue;

		// Per-message size cap
		if (line.length > MAX_MESSAGE_SIZE) {
			log.warn("Message exceeds size limit", {
				clientId: conn.id, size: line.length, max: MAX_MESSAGE_SIZE,
			});
			const err = createErrorResponse(0, SERVER_ERROR, "Message too large");
			conn.socket.write(serialize(err));
			conn.socket.destroy();
			return;
		}

		const msg = parseMessage(line);
		if (!msg) {
			const errResp = createErrorResponse(0, ErrorCode.ParseError, "Invalid JSON");
			conn.socket.write(serialize(errResp));
			continue;
		}

		if (isRequest(msg)) {
			if (!authorizeRequest(conn, msg.method, auth)) {
				const err = createErrorResponse(msg.id, UNAUTHORIZED_ERROR, "Bridge authentication required");
				conn.socket.write(serialize(err));
				continue;
			}
			if (msg.method === "auth.handshake") {
				handleAuthHandshake(conn, msg, auth);
				continue;
			}
				if (!authorizeMethod(conn, msg.method, auth)) {
					const required = requiredScopeForMethod(conn, msg.method);
					const err = createErrorResponse(msg.id, FORBIDDEN_ERROR, `Insufficient scope for ${msg.method}`, required ? { requiredScope: required } : undefined);
					conn.socket.write(serialize(err));
					continue;
				}
				if (!withinRequestRateLimit(conn, msg.method, auth, requestWindows)) {
					const err = createErrorResponse(msg.id, RATE_LIMIT_ERROR, "Bridge rate limit exceeded");
					conn.socket.write(serialize(err));
					continue;
				}
				// Backpressure: reject if too many pending requests
				if (conn.pendingRequests >= MAX_PENDING_REQUESTS) {
				log.warn("Backpressure: too many pending requests", {
					clientId: conn.id, pending: conn.pendingRequests,
				});
				const err = createErrorResponse(msg.id, SERVER_ERROR, "Too many pending requests");
				conn.socket.write(serialize(err));
				continue;
			}
			conn.pendingRequests++;
			handleRequest(conn, msg, router)
				.catch((err) => {
					log.error("Unhandled request error", err, { method: msg.method });
				})
				.finally(() => { conn.pendingRequests--; });
		} else if (isNotification(msg)) {
			if (!authorizeRequest(conn, msg.method, auth)) {
				const err = createErrorResponse(0, UNAUTHORIZED_ERROR, "Bridge authentication required");
				conn.socket.write(serialize(err));
				conn.socket.destroy();
				return;
			}
			if (msg.method === "auth.handshake") {
				handleAuthHandshake(conn, { ...msg, id: 0 }, auth);
				continue;
			}
				if (!authorizeMethod(conn, msg.method, auth)) {
					const err = createErrorResponse(0, FORBIDDEN_ERROR, `Insufficient scope for ${msg.method}`);
					conn.socket.write(serialize(err));
					continue;
				}
				if (!withinRequestRateLimit(conn, msg.method, auth, requestWindows)) {
					const err = createErrorResponse(0, RATE_LIMIT_ERROR, "Bridge rate limit exceeded");
					conn.socket.write(serialize(err));
					continue;
				}
				router.handle(msg.method, msg.params ?? {}, {
					clientId: conn.id,
				transport: "socket",
				kind: "notification",
				auth: conn.auth,
			}).catch((err) => {
				log.warn("Notification handler error", { method: msg.method, error: String(err) });
			});
		}
		// Responses from client are ignored (we're the server)
	}
}

/** Handle a single JSON-RPC request and write the response. */
async function handleRequest(conn: ClientConnection, req: RpcRequest, router: RpcRouter): Promise<void> {
	let response: RpcResponse;
	try {
		const result = await router.handle(req.method, req.params ?? {}, {
			clientId: conn.id,
			transport: "socket",
			kind: "request",
			auth: conn.auth,
		});
		response = createResponse(req.id, result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		const code = (err as { code?: number }).code ?? ErrorCode.InternalError;
		response = createErrorResponse(req.id, code, message);
	}

	if (!conn.socket.destroyed) {
		conn.socket.write(serialize(response));
	}
}

function authorizeRequest(
	conn: ClientConnection,
	method: string,
	auth?: DaemonServerAuthConfig,
): boolean {
	if (method === "auth.handshake") return true;
	if (!auth?.required) return true;
	return conn.authenticated;
}

function authorizeMethod(
	conn: ClientConnection,
	method: string,
	auth?: DaemonServerAuthConfig,
): boolean {
	if (!auth?.required) return true;
	const scopes = conn.auth?.scopes ?? [];
	return authorizeDaemonMethod(method, scopes).allowed;
}

function requiredScopeForMethod(conn: ClientConnection, method: string): string | undefined {
	const scopes = conn.auth?.scopes ?? [];
	return authorizeDaemonMethod(method, scopes).required;
}

function handleAuthHandshake(
	conn: ClientConnection,
	req: RpcRequest,
	auth?: DaemonServerAuthConfig,
): void {
	if (!auth?.required) {
		conn.authenticated = true;
		conn.auth = { scopes: ["admin"] };
		conn.socket.write(serialize(createResponse(req.id, { authenticated: true, scopes: conn.auth.scopes })));
		return;
	}

	const token =
		typeof req.params?.apiKey === "string" ? req.params.apiKey
			: typeof req.params?.token === "string" ? req.params.token
				: "";
	const result = auth.validateToken(token);
	if (!result.authenticated) {
		conn.socket.write(serialize(createErrorResponse(req.id, UNAUTHORIZED_ERROR, result.error ?? "Bridge authentication failed")));
		conn.socket.destroy();
		return;
	}

	conn.authenticated = true;
	conn.auth = {
		keyId: result.keyId,
		tenantId: result.tenantId,
		scopes: result.scopes ?? ["read"],
	};
	conn.socket.write(serialize(createResponse(req.id, {
		authenticated: true,
		keyId: result.keyId,
		tenantId: result.tenantId,
		scopes: conn.auth.scopes,
	})));
}

function withinRequestRateLimit(
	conn: ClientConnection,
	method: string,
	auth: DaemonServerAuthConfig | undefined,
	requestWindows: Map<string, number[]>,
): boolean {
	const config = auth?.requestRateLimit;
	if (!config) return true;
	if (config.exemptMethods.includes(method)) return true;

	const key = conn.auth?.keyId ?? conn.auth?.tenantId ?? conn.id;
	const now = Date.now();
	const recent = (requestWindows.get(key) ?? []).filter((ts) => now - ts <= config.windowMs);
	if (recent.length >= config.maxRequests) {
		requestWindows.set(key, recent);
		return false;
	}
	recent.push(now);
	requestWindows.set(key, recent);
	return true;
}

/** Gracefully stop the server and close all client connections. */
async function stopServer(server: net.Server, clients: Map<string, ClientConnection>): Promise<void> {
	log.info("Shutting down daemon server", { activeClients: clients.size });

	// Close all client connections
	for (const [, conn] of clients) {
		conn.socket.destroy();
	}
	clients.clear();

	// Close the server
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});

	log.info("Daemon server stopped");
}
