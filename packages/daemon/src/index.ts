/**
 * @chitragupta/daemon — Centralized daemon package.
 *
 * One process per user, Unix domain socket, all clients connect to it.
 * Single-writer SQLite: daemon owns all databases, no write contention.
 *
 * @module
 */

// Public API: client (what consumers use)
export { DaemonClient, DaemonUnavailableError, createClient, type DaemonClientConfig } from "./client.js";

// Public API: resilience (health states, circuit breaker)
export { HealthMonitor, HealthState, type CircuitBreakerConfig, type HealthEvents } from "./resilience.js";

// Public API: paths (for tooling and diagnostics)
export { resolvePaths, ensureDirs, cleanStaleSocket, isWindows, getPlatform, type DaemonPaths } from "./paths.js";

// Public API: process management (for CLI commands)
export { checkStatus, spawnDaemon, stopDaemon, type DaemonStatus } from "./process.js";
export {
	createDaemonServerAuth,
	ensureDaemonBridgeToken,
	resolveDaemonClientToken,
	authorizeDaemonMethod,
	type DaemonAuthContext,
	type DaemonServerAuthConfig,
	type DaemonRateLimitConfig,
} from "./auth.js";

// Public API: protocol types (for extensions)
export {
	type RpcRequest,
	type RpcResponse,
	type RpcNotification,
	type RpcError,
	type RpcMessage,
	ErrorCode,
} from "./protocol.js";

// Public API: watchdog (self-healing process supervisor)
export { ScarlettWatchdog, startScarlett, stopScarlett, type ScarlettConfig, type ScarlettEvents } from "./scarlett-watchdog.js";

// Public API: signal bridge (Wire 1 — InternalScarlett → TranscendenceEngine)
export {
	injectProbeSignal, injectCycleSignals,
	type TranscendenceEngineRef as ScarlettTranscendenceRef, type RegressionAlertLike,
} from "./scarlett-signal-bridge.js";

// Public API: internal health guardian (subsystem probes inside the daemon)
export {
	InternalScarlett, startInternalScarlett, stopInternalScarlett,
	SmritiDbProbe, MemoryPressureProbe, NidraHeartbeatProbe, ConsolidationQueueProbe,
	type InternalScarlettConfig, type InternalScarlettEvents,
	type InternalProbe, type ProbeResult, type ProbeSeverity,
	type NidraLike, type DbManagerLike, type SqliteDbLike,
} from "./scarlett-internal.js";

// Server + router (for daemon entry point and tests)
export { startServer, type DaemonServer, type DaemonServerConfig } from "./server.js";
export { startHttpServer, DEFAULT_HTTP_PORT, type DaemonHttpServer, type DaemonHttpConfig } from "./http-server.js";
export { RpcRouter, RpcMethodError, type RpcHandler, type MethodMeta } from "./rpc-router.js";
export { registerServices } from "./services.js";
