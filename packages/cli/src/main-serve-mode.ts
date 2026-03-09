/**
 * @chitragupta/cli — Serve mode: HTTP API server with TLS, Hub dashboard,
 * phase module wiring, Vidya Orchestrator, and graceful shutdown.
 */

import { Agent } from "@chitragupta/anina";
import type { AgentProfile, ChitraguptaSettings } from "@chitragupta/core";

import { createLogger, DEFAULT_FALLBACK_MODEL } from "@chitragupta/core";
import type { Session } from "@chitragupta/smriti/types";
import type { TuriyaRouter } from "@chitragupta/swara";
import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { resolvePreferredProvider } from "./bootstrap.js";
import { applyLucyLiveGuidance, createServeSessionScope, type ServeSessionScope } from "./nervous-system-wiring.js";
import {
	createServerAgent,
	provisionTlsCerts,
	type ServePhaseModules,
	wireServePhaseModules,
} from "./main-serve-helpers.js";
import { buildServerHandlers } from "./main-serve-api.js";
import type { MeshBootstrapResult } from "./mesh-bootstrap.js";
import { bootstrapMeshNetwork, resolveMeshConfig } from "./mesh-bootstrap.js";
import type { ProjectInfo } from "./project-detector.js";

const log = createLogger("cli:main-serve");

function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/** Options passed from main() to the serve command handler. */
export interface ServeCommandOptions {
	args: {
		port?: number;
		host?: string;
		noTls?: boolean;
		provider?: string;
		model?: string;
	};
	settings: ChitraguptaSettings;
	profile: AgentProfile;
	registry: ProviderRegistry;
	project: ProjectInfo;
	projectPath: string;
	turiyaRouter?: TuriyaRouter;
}

/** Handle the `serve` subcommand — HTTP API server with full module wiring. */
export async function handleServeCommand(opts: ServeCommandOptions): Promise<void> {
	const { args, settings, profile, registry, project, projectPath, turiyaRouter } = opts;
	const { createChitraguptaAPI } = await import("./http-server.js");
	void import("./modes/mcp-subsystems.js")
		.then(({ primeLucyScarlettRuntime }) => primeLucyScarlettRuntime())
		.catch(() => {
			// Best-effort: live Scarlett/Lucy startup should not block serve mode.
		});

	const port = args.port ?? 3141;
	const host = args.host ?? "127.0.0.1";

	// ── Kavach: TLS provisioning ──
	const tlsCerts = await provisionTlsCerts(args.noTls);

	// Auth from environment or settings
	const authToken =
		process.env.CHITRAGUPTA_AUTH_TOKEN ??
		((settings as unknown as Record<string, unknown>).authToken as string | undefined);
	const apiKeys = process.env.CHITRAGUPTA_API_KEYS?.split(",").filter(Boolean);
	const allowInsecureRemoteServe = process.env.CHITRAGUPTA_ALLOW_INSECURE_REMOTE_SERVE === "1";

	if (!isLoopbackHost(host) && !authToken && !apiKeys?.length && !allowInsecureRemoteServe) {
		throw new Error(
			`Refusing to bind serve mode to non-loopback host "${host}" without auth. `
			+ "Set CHITRAGUPTA_AUTH_TOKEN or CHITRAGUPTA_API_KEYS, or explicitly opt in with "
			+ "CHITRAGUPTA_ALLOW_INSECURE_REMOTE_SERVE=1.",
		);
	}

	// ── Hub Dashboard + Dvara-Bandhu Pairing ──
	const { PairingEngine } = await import("./pairing-engine.js");
	const { BudgetTracker } = await import("./budget-tracker.js");

	const jwtSecret = process.env.CHITRAGUPTA_JWT_SECRET ?? authToken ?? crypto.randomUUID();
	const pairingEngine = new PairingEngine({ port, jwtSecret });
	const budgetTracker = new BudgetTracker(settings.budget);

	// Resolve hub static dist path
	const cliDir = path.dirname(new URL(import.meta.url).pathname);
	const hubDistPath = path.resolve(cliDir, "../../hub/dist");
	const hubAvailable = fs.existsSync(path.join(hubDistPath, "index.html"));

	const serverConfig = {
		port,
		host,
		authToken,
		apiKeys,
		enableLogging: true,
		hubDistPath: hubAvailable ? hubDistPath : undefined,
		tls: tlsCerts,
	};

	let serverAgent: unknown = null;
	let serverSession: Session | null = null;
	const serveSessionScope = createServeSessionScope();

	// Wire phase modules
	const { modules, cleanups } = await wireServePhaseModules(projectPath);

	// Cleanup references for shutdown
	let servKaalaRef: { dispose(): void } | undefined;
	let servActorShutdownRef: (() => void) | undefined;
	let servCommHubDestroyRef: (() => void) | undefined;

	const servResolved = resolvePreferredProvider(args.provider, settings, registry);
	if (servResolved) {
		const serveModelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;
		const { result: agentResult, refs } = await createServerAgent({
			servResolved,
			profile,
			settings,
				project,
				projectPath,
				modules,
				args: { model: args.model },
				sessionIdResolver: () => serveSessionScope.getSessionId(),
			});
		serverAgent = agentResult;
		servKaalaRef = refs.kaalaRef;
		servActorShutdownRef = refs.actorShutdownRef;
		servCommHubDestroyRef = refs.commHubDestroyRef;
	} else {
		log.warn("No provider available — HTTP chat endpoints will return 503");
	}

	// Resolve mesh network config from settings/env
	const meshConfig = resolveMeshConfig(settings as unknown as Record<string, unknown>);
	let meshResult: MeshBootstrapResult | undefined;
	let meshActorSystem: unknown;

	// Extract the ActorSystem from the server agent's mesh infrastructure
	// for P2P bootstrap and mesh status reporting
	if (serverAgent) {
		try {
			const actorSystemAware = serverAgent as { getActorSystem?: () => unknown };
			meshActorSystem = actorSystemAware.getActorSystem?.();
		} catch {
			/* best-effort */
		}
	}

	const server = createChitraguptaAPI(
		buildServerHandlers({
			serverAgent,
			serverSession,
			serveSessionScope,
			registry,
			projectPath,
			turiyaRouter,
			modules,
			pairingEngine,
			budgetTracker,
			meshActorSystem,
			getMeshBootstrapResult: () => meshResult,
		}),
		serverConfig,
	);

	const actualPort = await server.start();

	try {
		const { EventBridge: EB, WebSocketSink: WSS } = await import("@chitragupta/sutra");
		const eb = new EB();
		if (server.ws) eb.addSink(new WSS((t: string, d: unknown) => server.ws!.broadcast(t, d)));
		(server as unknown as Record<string, unknown>)._eventBridge = eb;
	} catch {
		/* EventBridge optional */
	}
	// Wire Akasha trace events → WS broadcast
	if (server.ws) {
		const ak = modules.servAkasha as { setOnEvent?: (h: (e: { type: string }) => void) => void } | undefined;
		ak?.setOnEvent?.((e) => server.ws!.broadcast("akasha:" + e.type, e));
	}

	// Bootstrap P2P mesh if config is present
	if (meshConfig && meshActorSystem) {
		try {
			meshResult = await bootstrapMeshNetwork(meshActorSystem, meshConfig);
			log.info("P2P mesh active", { meshPort: meshResult.meshPort, nodeId: meshResult.nodeId });
		} catch (err) {
			log.warn("P2P mesh bootstrap failed — running local-only", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	pairingEngine.generateChallenge();
	const protocol = tlsCerts ? "https" : "http";
	const hubUrl = `${protocol}://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`;

	process.stdout.write(
		`\n  \u2605 Chitragupta ${protocol.toUpperCase()} API listening on ${hubUrl}\n` +
			(tlsCerts ? `  TLS:  Kavach (local ECDSA P-256)\n` : "") +
			`  Health: ${hubUrl}/api/health\n` +
			(authToken || apiKeys?.length
				? `  Auth: enabled\n`
				: `  Auth: disabled (set CHITRAGUPTA_AUTH_TOKEN to enable)\n`) +
			(hubAvailable
				? `  Hub:  ${hubUrl} (open in browser)\n`
				: `  Hub:  not built (run: pnpm -F @chitragupta/hub build)\n`) +
			(meshResult
				? `  Mesh: ws://${host === "0.0.0.0" ? "localhost" : host}:${meshResult.meshPort}/mesh (node: ${meshResult.nodeId.slice(0, 8)})\n`
				: "") +
			`\n`,
	);
	process.stdout.write(pairingEngine.getTerminalDisplay() + "\n\n");
process.stdout.write(`  Press Ctrl+C to stop.\n\n`);

	// Block until SIGINT
	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => {
			process.stdout.write(`\n  Shutting down server...\n`);
			const cleanup = async () => {
				if (meshResult) {
					try {
						await meshResult.shutdown();
					} catch {
						/* best-effort */
					}
				}
				for (const fn of cleanups.skillWatcherCleanups) {
					try {
						fn();
					} catch {
						/* best-effort */
					}
				}
				if (modules.servNidraDaemon) {
					try {
						await (modules.servNidraDaemon as { stop: () => Promise<void> }).stop();
					} catch {
						/* best-effort */
					}
				}
				if (serverAgent && typeof (serverAgent as Agent).dispose === "function") {
					try {
						(serverAgent as Agent).dispose();
					} catch {
						/* best-effort */
					}
				}
				if (cleanups.lokapalaUnsub) {
					try { cleanups.lokapalaUnsub(); } catch { /* best-effort */ }
				}
				if (modules.servSamiti) {
					try { (modules.servSamiti as { destroy(): void }).destroy(); } catch { /* best-effort */ }
				}
				if (cleanups.servKartavyaDispatcher) {
					try {
						cleanups.servKartavyaDispatcher.stop();
					} catch {
						/* best-effort */
					}
				}
				if (servCommHubDestroyRef) {
					try {
						servCommHubDestroyRef();
					} catch {
						/* best-effort */
					}
				}
				if (servActorShutdownRef) {
					try {
						servActorShutdownRef();
					} catch {
						/* best-effort */
					}
				}
				if (servKaalaRef) {
					try {
						servKaalaRef.dispose();
					} catch {
						/* best-effort */
					}
				}
				await server.stop();
			};
			cleanup().then(resolve).catch(resolve);
		});
	});
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

export { buildServerHandlers } from "./main-serve-api.js";
