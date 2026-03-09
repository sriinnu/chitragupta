/**
 * Collaboration API Routes — REST endpoints for Phase 3 Multi-Agent Collaboration.
 *
 * Exposes Samiti (ambient channels), Sabha (deliberation), Lokapala (guardians),
 * and Akasha (shared knowledge) via JSON endpoints. Mounts onto the existing
 * ChitraguptaServer via `server.route()`.
 *
 * @module routes/collaboration
 */

import type { CollaborationDeps, ServerLike } from "./collaboration-types.js";
import { mountAkashaCollaborationRoutes } from "./collaboration-akasha-routes.js";
import { mountLokapalaCollaborationRoutes } from "./collaboration-lokapala-routes.js";
import { mountSabhaCollaborationRoutes } from "./collaboration-sabha-routes.js";
import { mountSamitiCollaborationRoutes } from "./collaboration-samiti-routes.js";

/**
 * Mount all Phase 3 Collaboration API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param deps   - Lazy getters for collaboration modules
 */
export function mountCollaborationRoutes(
	server: ServerLike,
	deps: CollaborationDeps,
): void {
	mountSamitiCollaborationRoutes(server, deps);
	mountSabhaCollaborationRoutes(server, deps);
	mountLokapalaCollaborationRoutes(server, deps);
	mountAkashaCollaborationRoutes(server, deps);
}
