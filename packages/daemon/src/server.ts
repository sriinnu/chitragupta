/**
 * @chitragupta/daemon — Unix domain socket server.
 *
 * Accepts connections, NDJSON framing, routes to RPC handlers.
 * One instance per user, all clients connect to it.
 *
 * @module
 */

import net from "node:net";
import fs from "node:fs";
import { createLogger } from "@chitragupta/core";
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
	type RpcRequest,
	type RpcResponse,
} from "./protocol.js";
import type { RpcRouter } from "./rpc-router.js";

const log = createLogger("daemon:server");

/** Max size of a single NDJSON message (1 MB). */
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** Max accumulated buffer per connection before forced disconnect (5 MB). */
const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

/** Max concurrent pending requests per connection. */
const MAX_PENDING_REQUESTS = 100;

/** Application-level server error code (JSON-RPC). */
const SERVER_ERROR = -32000;

/** Per-connection state. */
interface ClientConnection {
	id: string;
	socket: net.Socket;
	buffer: string;
	connectedAt: number;
	/** Number of in-flight (pending) requests. */
	pendingRequests: number;
}

/** Server configuration. */
export interface DaemonServerConfig {
	/** Resolved daemon paths. */
	paths: DaemonPaths;
	/** RPC method router. */
	router: RpcRouter;
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
	const { paths, router, maxConnections = 256 } = config;
	const clients = new Map<string, ClientConnection>();

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
			id: clientId, socket, buffer: "", connectedAt: Date.now(), pendingRequests: 0,
		};
		clients.set(clientId, conn);
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
				return;
			}

			processBuffer(conn, router);
		});

		socket.on("close", () => {
			clients.delete(clientId);
			log.debug("Client disconnected", { clientId, total: clients.size });
		});

		socket.on("error", (err) => {
			log.warn("Client socket error", { clientId, error: err.message });
			clients.delete(clientId);
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
function processBuffer(conn: ClientConnection, router: RpcRouter): void {
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
			router.handle(msg.method, msg.params ?? {}).catch((err) => {
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
		const result = await router.handle(req.method, req.params ?? {});
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

/**
 * Bind server to socket path safely.
 *
 * If socket path is in use, probe whether another daemon is alive.
 * - Alive: fail fast (do not unlink live socket)
 * - Dead/stale: unlink once and retry bind
 */
async function bindServerSocket(server: net.Server, socketPath: string): Promise<void> {
	let staleUnlinked = false;

	for (;;) {
		try {
			await listenOnce(server, socketPath);
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EADDRINUSE") throw err;

			const live = await isSocketLive(socketPath);
			if (live) {
				throw new Error(`Socket already in use by a live daemon: ${socketPath}`);
			}
			if (staleUnlinked) {
				throw new Error(`Failed to recover stale socket: ${socketPath}`);
			}
			try {
				fs.unlinkSync(socketPath);
				staleUnlinked = true;
				log.warn("Removed stale socket file before retrying bind", { socket: socketPath });
			} catch (unlinkErr) {
				if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkErr;
				staleUnlinked = true;
			}
		}
	}
}

/** Listen once and resolve on successful bind. */
function listenOnce(server: net.Server, socketPath: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onError = (err: unknown) => {
			server.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(socketPath);
	});
}

/** Probe whether a daemon is actively accepting connections on the socket. */
function isSocketLive(socketPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const probe = net.createConnection(socketPath);
		let settled = false;
		const finish = (live: boolean) => {
			if (settled) return;
			settled = true;
			probe.destroy();
			resolve(live);
		};
		probe.once("connect", () => finish(true));
		probe.once("error", () => finish(false));
		probe.setTimeout(250, () => finish(false));
	});
}
