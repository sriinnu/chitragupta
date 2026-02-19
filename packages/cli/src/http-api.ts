/**
 * Pre-configured API factory — assembles all route modules onto a ChitraguptaServer.
 * @module http-api
 */

import { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps, ServerConfig } from "./http-server-types.js";
import { mountCoreRoutes } from "./http-routes-core.js";
import { mountJobRoutes } from "./http-routes-jobs.js";
import { mountMemoryRoutes } from "./http-routes-memory.js";
import { mountAgentRoutes } from "./http-routes-agents.js";
import { mountDynamicRoutes, wireWebSocket } from "./http-routes-ws.js";
import { mountPairingRoutes } from "./routes/pairing.js";
import type { PairingEngine } from "./pairing-engine.js";

/**
 * Create a pre-configured server with all Chitragupta API routes.
 *
 * The `deps` object provides access to the CLI's runtime state,
 * injected from `main.ts` so the server does not own those objects.
 */
export function createChitraguptaAPI(deps: ApiDeps, config?: ServerConfig): ChitraguptaServer {
	const server = new ChitraguptaServer(config);

	// Mount route groups in order (registration order matters for :param routes)
	mountCoreRoutes(server, deps, config);
	const jobRunner = mountJobRoutes(server, deps, config);
	mountMemoryRoutes(server);
	mountAgentRoutes(server, deps);
	mountDynamicRoutes(server, deps, config);

	// Mount Dvara-Bandhu pairing routes if engine is available
	if (deps.getPairingEngine) {
		mountPairingRoutes(
			server,
			deps.getPairingEngine as () => PairingEngine | undefined,
		);
	}

	// Wire WebSocket chat handlers (overrides server.start)
	wireWebSocket(server, jobRunner);

	return server;
}
