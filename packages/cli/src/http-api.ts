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
import { mountAgentTaskCheckpointRoutes } from "./http-routes-agent-tasks.js";
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
import { mountDaemonStatusRoutes } from "./routes/daemon-status.js";
import { mountWebhookRoutes } from "./http-routes-webhooks.js";
import type { CollaborationDeps } from "./routes/collaboration-types.js";
import { createAuthMiddleware } from "@chitragupta/dharma";
import { createLogger } from "@chitragupta/core";

const apiLog = createLogger("http-api");

/**
 * Create a pre-configured server with all Chitragupta API routes.
 *
 * The `deps` object provides access to the CLI's runtime state,
 * injected from `main.ts` so the server does not own those objects.
 */
export function createChitraguptaAPI(deps: ApiDeps, config?: ServerConfig): ChitraguptaServer {
	const server = new ChitraguptaServer(config);

	// Wire Dharma API-key auth middleware when configured
	if (config?.dharmaAuth) {
		const dharma = config.dharmaAuth;
		const enabled = dharma.config?.enabled ?? false;

		if (!enabled) {
			apiLog.warn(
				"Dharma API-key auth is configured but DISABLED. " +
				"Set dharmaAuth.config.enabled = true to enforce authentication.",
			);
		}

		const mw = createAuthMiddleware(dharma.keyStore, {
			...dharma.config,
			enabled,
			bypassPaths: dharma.config?.bypassPaths ?? ["/api/health", "/health"],
		});
		server.use(mw);
	}

	// Mount route groups in order (registration order matters for :param routes)
	mountCoreRoutes(server, deps, config);
	const jobRunner = mountJobRoutes(server, deps, config);
	mountMemoryRoutes(server);
	mountAgentRoutes(server, deps);
	mountAgentTaskCheckpointRoutes(server, deps);

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

	// Daemon monitoring (menubar + Hub dashboard)
	mountDaemonStatusRoutes(server, {
		getDaemonClient: async () => {
			try {
				const { getDaemonClient: getClient } = await import("./modes/daemon-bridge.js");
				const client = await getClient();
				return client as unknown as { call(method: string, params?: Record<string, unknown>): Promise<unknown>; isConnected(): boolean };
			} catch {
				return null;
			}
		},
		getTriguna: deps.getTriguna as () => { getState(): { sattva: number; rajas: number; tamas: number } } | undefined,
	});

	// Workflow engine (Prana DAG)
	mountWorkflowRoutes(server);

	mountDynamicRoutes(server, deps, config);

	// Mount Dvara-Bandhu pairing routes if engine is available
	if (deps.getPairingEngine) {
		mountPairingRoutes(
			server,
			deps.getPairingEngine as () => PairingEngine | undefined,
		);
	}

	// Webhook + Mesh management routes
	mountWebhookRoutes(server, {
		webhookSecret: deps.getWebhookSecret?.(),
		getSamiti: deps.getSamiti as () => { broadcast(channel: string, message: unknown): void } | undefined,
		getMeshRouter: deps.getMeshRouter as () => { route(envelope: unknown): void } | undefined,
		getMeshStatus: deps.getMeshStatus,
		connectToPeer: deps.connectToPeer,
	});

	// Wire WebSocket chat handlers (overrides server.start)
	wireWebSocket(server, jobRunner);

	return server;
}
