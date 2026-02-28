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
import type { DaemonPaths } from "./paths.js";
import { cleanStaleSocket, ensureDirs } from "./paths.js";
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

/** Per-connection state. */
interface ClientConnection {
	id: string;
	socket: net.Socket;
	buffer: string;
	connectedAt: number;
}

/** Server configuration. */
export interface DaemonServerConfig {
	/** Resolved daemon paths. */
	paths: DaemonPaths;
	/** RPC method router. */
	router: RpcRouter;
	/** Max concurrent connections (default: 32). */
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
	const { paths, router, maxConnections = 32 } = config;
	const clients = new Map<string, ClientConnection>();

	ensureDirs(paths);
	cleanStaleSocket(paths.socket);

	const server = net.createServer((socket) => {
		if (clients.size >= maxConnections) {
			log.warn("Max connections reached, rejecting", { max: maxConnections });
			socket.end(serialize(createErrorResponse(0, ErrorCode.InternalError, "Too many connections")));
			socket.destroy();
			return;
		}

		const clientId = crypto.randomUUID();
		const conn: ClientConnection = { id: clientId, socket, buffer: "", connectedAt: Date.now() };
		clients.set(clientId, conn);
		log.debug("Client connected", { clientId, total: clients.size });

		socket.on("data", (chunk) => {
			conn.buffer += chunk.toString("utf-8");
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

	// Bind to socket path
	await new Promise<void>((resolve, reject) => {
		server.listen(paths.socket, () => {
			log.info("Daemon listening", { socket: paths.socket });
			resolve();
		});
		server.once("error", reject);
	});

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

		const msg = parseMessage(line);
		if (!msg) {
			const errResp = createErrorResponse(0, ErrorCode.ParseError, "Invalid JSON");
			conn.socket.write(serialize(errResp));
			continue;
		}

		if (isRequest(msg)) {
			handleRequest(conn, msg, router).catch((err) => {
				log.error("Unhandled request error", err, { method: msg.method });
			});
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
