/**
 * Pre-configured API factory -- assembles all route modules onto a ChitraguptaServer.
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
import { mountBudgetRoutes } from "./routes/budget.js";
import { mountSettingsRoutes } from "./routes/settings.js";
import { mountModelRoutes } from "./routes/models.js";
import { mountSkillRoutes } from "./routes/skills.js";
import { mountCollaborationRoutes } from "./routes/collaboration.js";
import { mountIntelligenceRoutes } from "./routes/intelligence.js";
import { mountEvolutionRoutes } from "./routes/evolution.js";
import { mountAutonomyRoutes } from "./routes/autonomy.js";
import { mountWorkflowRoutes } from "./routes/workflow.js";
import type { CollaborationDeps } from "./routes/collaboration-types.js";

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

	// Budget, settings, and model routes
	if (deps.getBudgetTracker) {
		mountBudgetRoutes(server, deps.getBudgetTracker as () => undefined);
	}
	mountSettingsRoutes(server);
	mountModelRoutes(server, {
		listProviders: deps.listProviders,
		getTuriyaRouter: deps.getTuriyaRouter as (() => { getState(): Record<string, unknown> } | undefined) | undefined,
	});

	// Skill routes (Vidya ecosystem)
	if (deps.getVidyaOrchestrator) {
		mountSkillRoutes(
			server,
			deps.getVidyaOrchestrator as () => undefined,
		);
	}

	// Phase 3: Collaboration (Samiti, Sabha, Lokapala, Akasha)
	mountCollaborationRoutes(server, {
		getSamiti: deps.getSamiti,
		getSabhaEngine: deps.getSabhaEngine,
		getLokapala: deps.getLokapala,
		getAkasha: deps.getAkasha,
	} as CollaborationDeps);

	// Phase 2: Intelligence (Turiya, Triguna, Rta, Buddhi)
	mountIntelligenceRoutes(server, {
		getTuriyaRouter: deps.getTuriyaRouter as () => undefined,
		getTriguna: deps.getTriguna as () => undefined,
		getRtaEngine: deps.getRtaEngine as () => undefined,
		getBuddhi: deps.getBuddhi as () => undefined,
		getDatabase: deps.getDatabase as () => undefined,
		getProjectPath: deps.getProjectPath ?? (() => "."),
	});

	// Phase 1: Evolution (Vasana, Nidra, Vidhi)
	mountEvolutionRoutes(server, {
		getVasanaEngine: deps.getVasanaEngine as () => undefined,
		getNidraDaemon: deps.getNidraDaemon as () => undefined,
		getVidhiEngine: deps.getVidhiEngine as () => undefined,
		getProjectPath: deps.getProjectPath ?? (() => "."),
	});

	// Phase 4: Autonomy (Kartavya, Kala Chakra)
	mountAutonomyRoutes(server, {
		getKartavyaEngine: deps.getKartavyaEngine as () => undefined,
		getKalaChakra: deps.getKalaChakra as () => undefined,
		getProjectPath: deps.getProjectPath ?? (() => "."),
	});

	// Workflow engine (Vayu DAG)
	mountWorkflowRoutes(server);

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
