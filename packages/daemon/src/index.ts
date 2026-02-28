/**
 * @chitragupta/daemon — Centralized daemon package.
 *
 * One process per user, Unix domain socket, all clients connect to it.
 * Single-writer SQLite: daemon owns all databases, no write contention.
 *
 * @module
 */

// Public API: client (what consumers use)
export { DaemonClient, createClient, type DaemonClientConfig } from "./client.js";

// Public API: paths (for tooling and diagnostics)
export { resolvePaths, ensureDirs, cleanStaleSocket, type DaemonPaths } from "./paths.js";

// Public API: process management (for CLI commands)
export { checkStatus, spawnDaemon, stopDaemon, type DaemonStatus } from "./process.js";

// Public API: protocol types (for extensions)
export {
	type RpcRequest,
	type RpcResponse,
	type RpcNotification,
	type RpcError,
	type RpcMessage,
	ErrorCode,
} from "./protocol.js";

// Server + router (for daemon entry point and tests)
export { startServer, type DaemonServer, type DaemonServerConfig } from "./server.js";
export { RpcRouter, RpcMethodError, type RpcHandler, type MethodMeta } from "./rpc-router.js";
export { registerServices } from "./services.js";
