/**
 * @chitragupta/cli — Serve mode handler extracted from main.ts.
 *
 * Contains the full HTTP API server setup including:
 *   - TLS provisioning (Kavach)
 *   - Hub Dashboard + Dvara-Bandhu pairing
 *   - Phase 1-4 module wiring (evolution, intelligence, collaboration, autonomy)
 *   - Vidya Orchestrator (skill ecosystem)
 *   - Server agent creation and lifecycle management
 *   - SIGINT-based graceful shutdown
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
	createLogger,
	DEFAULT_FALLBACK_MODEL,
} from "@chitragupta/core";
import type { AgentProfile, ChitraguptaSettings } from "@chitragupta/core";

import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { ProviderDefinition, TuriyaRouter } from "@chitragupta/swara";
import { Agent } from "@chitragupta/anina";
import type { AgentConfig, ToolHandler } from "@chitragupta/anina";

import {
	listSessions,
} from "@chitragupta/smriti/session-store";

import { getAllTools } from "@chitragupta/yantra";

import type { ProjectInfo } from "./project-detector.js";
import type { ApiDeps } from "./http-server-types.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";

import {
	loadProjectMemory,
	resolvePreferredProvider,
} from "./bootstrap.js";
import {
	bootstrapMeshNetwork,
	resolveMeshConfig,
	buildMeshApiHandlers,
	type MeshBootstrapResult,
} from "./mesh-bootstrap.js";
import { createToolNotFoundResolver } from "./shared-factories.js";

const log = createLogger("cli:main-serve");

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

	const port = args.port ?? 3141;
	const host = args.host ?? "127.0.0.1";

	// ── Kavach: TLS provisioning ──
	const tlsCerts = await provisionTlsCerts(args.noTls);

	// Auth from environment or settings
	const authToken = process.env.CHITRAGUPTA_AUTH_TOKEN
		?? (settings as unknown as Record<string, unknown>).authToken as string | undefined;
	const apiKeys = process.env.CHITRAGUPTA_API_KEYS?.split(",").filter(Boolean);

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
		port, host, authToken, apiKeys, enableLogging: true,
		hubDistPath: hubAvailable ? hubDistPath : undefined,
		tls: tlsCerts,
	};

	let serverAgent: unknown = null;
	const serverSession: unknown = null;

	// Wire phase modules
	const { modules, cleanups } = await wireServePhaseModules(projectPath);

	// Cleanup references for shutdown
	let servKaalaRef: { dispose(): void } | undefined;
	let servActorShutdownRef: (() => void) | undefined;
	let servCommHubDestroyRef: (() => void) | undefined;

	const servResolved = resolvePreferredProvider(args.provider, settings, registry);
	if (servResolved) {
		const { result: agentResult, refs } = await createServerAgent({
			servResolved, profile, settings, project, projectPath, modules,
			args: { model: args.model },
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
			const agentAny = serverAgent as { actorSystem?: unknown };
			meshActorSystem = agentAny.actorSystem;
		} catch { /* best-effort */ }
	}

	const server = createChitraguptaAPI(
		buildServerHandlers({
			serverAgent, serverSession, registry, projectPath, turiyaRouter,
			modules, pairingEngine, budgetTracker, meshActorSystem,
			getMeshBootstrapResult: () => meshResult,
		}),
		serverConfig,
	);

	const actualPort = await server.start();

	try { const { EventBridge: EB, WebSocketSink: WSS } = await import("@chitragupta/sutra"); const eb = new EB(); if (server.ws) eb.addSink(new WSS((t: string, d: unknown) => server.ws!.broadcast(t, d))); (server as unknown as Record<string, unknown>)._eventBridge = eb; } catch { /* EventBridge optional */ }
	// Wire Akasha trace events → WS broadcast
	if (server.ws) { const ak = modules.servAkasha as { setOnEvent?: (h: (e: { type: string }) => void) => void } | undefined; ak?.setOnEvent?.((e) => server.ws!.broadcast("akasha:" + e.type, e)); }

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
		(authToken || apiKeys?.length ? `  Auth: enabled\n` : `  Auth: disabled (set CHITRAGUPTA_AUTH_TOKEN to enable)\n`) +
		(hubAvailable ? `  Hub:  ${hubUrl} (open in browser)\n` : `  Hub:  not built (run: pnpm -F @chitragupta/hub build)\n`) +
		(meshResult ? `  Mesh: ws://${host === "0.0.0.0" ? "localhost" : host}:${meshResult.meshPort}/mesh (node: ${meshResult.nodeId.slice(0, 8)})\n` : "") +
		`\n`,
	);
	process.stdout.write(pairingEngine.getTerminalDisplay() + "\n\n");
	process.stdout.write(`  Press Ctrl+C to stop.\n\n`);

	// Block until SIGINT
	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => {
			process.stdout.write(`\n  Shutting down server...\n`);
			const cleanup = async () => {
				if (meshResult) { try { await meshResult.shutdown(); } catch { /* best-effort */ } }
				for (const fn of cleanups.skillWatcherCleanups) { try { fn(); } catch { /* best-effort */ } }
				if (modules.servNidraDaemon) {
					try { await (modules.servNidraDaemon as { stop: () => Promise<void> }).stop(); } catch { /* best-effort */ }
				}
				if (serverAgent && typeof (serverAgent as Agent).dispose === "function") {
					try { (serverAgent as Agent).dispose(); } catch { /* best-effort */ }
				}
				if (cleanups.servKartavyaDispatcher) {
					try { cleanups.servKartavyaDispatcher.stop(); } catch { /* best-effort */ }
				}
				if (servCommHubDestroyRef) { try { servCommHubDestroyRef(); } catch { /* best-effort */ } }
				if (servActorShutdownRef) { try { servActorShutdownRef(); } catch { /* best-effort */ } }
				if (servKaalaRef) { try { servKaalaRef.dispose(); } catch { /* best-effort */ } }
				await server.stop();
			};
			cleanup().then(resolve).catch(resolve);
		});
	});
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Phase modules wired for serve mode. All fields are optional/unknown since each is best-effort. */
interface ServePhaseModules {
	vasanaEngine: unknown; vidhiEngine: unknown; servNidraDaemon: unknown; servTriguna: unknown;
	servRtaEngine: unknown; servBuddhi: unknown; servDatabase: unknown; servSamiti: unknown;
	servSabhaEngine: unknown; servLokapala: unknown; servAkasha: unknown;
	servKartavyaEngine: unknown; servKalaChakra: unknown; servVidyaOrchestrator: unknown;
}

interface ServeCleanups { skillWatcherCleanups: Array<() => void>; servKartavyaDispatcher?: { start(): void; stop(): void }; }

/** Provision TLS certificates via Kavach if enabled. */
async function provisionTlsCerts(noTls?: boolean): Promise<import("./tls/tls-types.js").TlsCertificates | undefined> {
	if (noTls) return undefined;
	try {
		const { provisionTls } = await import("./tls/tls-store.js");
		const result = await provisionTls();
		if (result.ok && result.certs) {
			if (result.freshCA) { const { installCATrust } = await import("./tls/tls-trust.js"); const tr = await installCATrust(result.certs.ca); log.info(tr.trusted ? "Kavach: CA trusted in system store" : "Kavach: " + tr.message); }
			return result.certs;
		}
		log.warn("Kavach: TLS provisioning failed", { reason: result.reason });
	} catch (err) { log.warn("Kavach: TLS unavailable", { error: err instanceof Error ? err.message : String(err) }); }
	return undefined;
}

/**
 * Wire all phase modules for serve mode.
 */
async function wireServePhaseModules(
	projectPath: string,
): Promise<{ modules: ServePhaseModules; cleanups: ServeCleanups }> {
	const m: ServePhaseModules = {
		vasanaEngine: undefined, vidhiEngine: undefined, servNidraDaemon: undefined, servTriguna: undefined,
		servRtaEngine: undefined, servBuddhi: undefined, servDatabase: undefined, servSamiti: undefined,
		servSabhaEngine: undefined, servLokapala: undefined, servAkasha: undefined,
		servKartavyaEngine: undefined, servKalaChakra: undefined, servVidyaOrchestrator: undefined,
	};
	const c: ServeCleanups = { skillWatcherCleanups: [] };

	// Phase 1: Self-Evolution
	try { const { VasanaEngine, VidhiEngine } = await import("@chitragupta/smriti"); m.vasanaEngine = new VasanaEngine(); m.vidhiEngine = new VidhiEngine({ project: projectPath }); } catch (e) { log.debug("Self-evolution modules unavailable", { error: String(e) }); }
	try { const { NidraDaemon: N } = await import("@chitragupta/anina"); m.servNidraDaemon = new N({ idleTimeoutMs: 300_000, dreamDurationMs: 600_000, deepSleepDurationMs: 1_800_000, project: projectPath }); (m.servNidraDaemon as { start: () => void }).start(); } catch (e) { log.debug("NidraDaemon unavailable", { error: String(e) }); }

	// Phase 2: Intelligence Layer
	try { const { Triguna } = await import("@chitragupta/anina"); m.servTriguna = new Triguna(); } catch (e) { log.debug("Triguna unavailable", { error: String(e) }); }
	try { const { RtaEngine } = await import("@chitragupta/dharma"); m.servRtaEngine = new RtaEngine(); } catch (e) { log.debug("RtaEngine unavailable", { error: String(e) }); }
	try { const { Buddhi } = await import("@chitragupta/anina"); m.servBuddhi = new Buddhi(); } catch (e) { log.debug("Buddhi unavailable", { error: String(e) }); }
	try { const { DatabaseManager } = await import("@chitragupta/smriti"); m.servDatabase = DatabaseManager.instance(); } catch (e) { log.debug("DatabaseManager unavailable", { error: String(e) }); }

	// Phase 3: Collaboration
	try { const { Samiti, SabhaEngine } = await import("@chitragupta/sutra"); m.servSamiti = new Samiti(); m.servSabhaEngine = new SabhaEngine(); } catch (e) { log.debug("Collaboration modules unavailable", { error: String(e) }); }
	try { const { LokapalaController } = await import("@chitragupta/anina"); m.servLokapala = new LokapalaController(); } catch (e) { log.debug("LokapalaController unavailable", { error: String(e) }); }
	try { const { AkashaField } = await import("@chitragupta/smriti"); m.servAkasha = new AkashaField(); } catch (e) { log.debug("AkashaField unavailable", { error: String(e) }); }

	// Phase 4: Autonomy
	const toolHandlers = new Map<string, ToolHandler>(getAllTools().map((t) => [t.definition.name, t]));
	const toolExecutor = async (toolName: string, toolArgs: Record<string, unknown>) => {
		const handler = toolHandlers.get(toolName);
		if (!handler) return { success: false, error: `Unknown tool: ${toolName}` };
		try {
			const result = await handler.execute(toolArgs ?? {}, { sessionId: "kartavya-dispatcher", workingDirectory: projectPath });
			return result.isError ? { success: false, error: result.content || `Tool "${toolName}" returned error` } : { success: true, output: result.content ?? "ok" };
		} catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
	};
	try {
		const { KartavyaEngine } = await import("@chitragupta/niyanta");
		m.servKartavyaEngine = new KartavyaEngine();
		try {
			const { KartavyaDispatcher } = await import("@chitragupta/niyanta");
			const d = new KartavyaDispatcher(
				m.servKartavyaEngine as InstanceType<typeof KartavyaEngine>,
				m.servSamiti as unknown as ConstructorParameters<typeof KartavyaDispatcher>[1],
				m.servRtaEngine as unknown as ConstructorParameters<typeof KartavyaDispatcher>[2],
				{ enableCommandActions: false, workingDirectory: projectPath, project: projectPath, toolExecutor, vidhiEngine: m.vidhiEngine as import("@chitragupta/niyanta").DispatcherVidhiEngine | undefined },
			);
			d.start();
			c.servKartavyaDispatcher = d;
		} catch { /* best-effort */ }
	} catch (e) { log.debug("KartavyaEngine unavailable", { error: String(e) }); }
	try { const { KalaChakra } = await import("@chitragupta/smriti"); m.servKalaChakra = new KalaChakra(); } catch (e) { log.debug("KalaChakra unavailable", { error: String(e) }); }

	// Vidya Orchestrator
	try {
		const { SkillRegistry, VidyaBridge, SurakshaScanner, SkillPipeline, SkillSandbox, PratikshaManager, ShikshaController, VidyaOrchestrator } = await import("@chitragupta/vidhya-skills");
		const reg = new SkillRegistry();
		const bridge = new VidyaBridge(reg);
		bridge.registerToolsAsSkills(getAllTools().map((t) => ({
			name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
			description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
			inputSchema: ((t as unknown as Record<string, Record<string, unknown>>).definition?.inputSchema ?? {}) as Record<string, unknown>,
		})));
		try { const { loadSkillTiers } = await import("./shared-factories.js"); const r = await loadSkillTiers({ projectPath, skillRegistry: reg }); c.skillWatcherCleanups.push(...r.watcherCleanups); } catch (e) { log.debug("Agent skill loading failed", { error: String(e) }); }
			let scanner: InstanceType<typeof SurakshaScanner> | undefined;
			let shiksha: InstanceType<typeof ShikshaController> | undefined;
			try { scanner = new SurakshaScanner(); const sandbox = new SkillSandbox(); const staging = new PratikshaManager(); const pipeline = new SkillPipeline({ scanner, sandbox, staging, registry: reg }); shiksha = new ShikshaController({ registry: reg, pipeline, scanner }); } catch (e) { log.warn("Suraksha/Shiksha pipeline unavailable; autonomous learning disabled", { error: String(e) }); }
			const stateDir = path.join(projectPath, ".chitragupta");
			m.servVidyaOrchestrator = new VidyaOrchestrator(
				{
					registry: reg,
					bridge,
					scanner: scanner as ConstructorParameters<typeof VidyaOrchestrator>[0]["scanner"],
					shiksha: shiksha as ConstructorParameters<typeof VidyaOrchestrator>[0]["shiksha"],
				},
				{
					persistPath: `${stateDir}/vidya-state.json`,
					enableAutoLearn: Boolean(shiksha),
					enableAutoComposition: true,
				},
			);
		await (m.servVidyaOrchestrator as { initialize: () => Promise<void> }).initialize();
	} catch (e) { log.debug("VidyaOrchestrator unavailable", { error: String(e) }); }

	return { modules: m, cleanups: c };
}

interface CreateServerAgentParams {
	servResolved: { providerId: string; provider: ProviderDefinition };
	profile: AgentProfile;
	settings: ChitraguptaSettings;
	project: ProjectInfo;
	projectPath: string;
	modules: ServePhaseModules;
	args: { model?: string };
}

interface ServerAgentRefs {
	kaalaRef?: { dispose(): void };
	actorShutdownRef?: () => void;
	commHubDestroyRef?: () => void;
}

/**
 * Create the server agent with full mesh infrastructure.
 */
async function createServerAgent(params: CreateServerAgentParams): Promise<{ result: Agent; refs: ServerAgentRefs }> {
	const { servResolved, profile, settings, project, projectPath, modules, args } = params;
	const { providerId, provider } = servResolved;
	const modelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;
	const tools = getAllTools();

	const contextFiles = loadContextFiles(projectPath);
	const memory = loadProjectMemory(projectPath);
	const systemPrompt = buildSystemPrompt({ profile, project, contextFiles, memoryContext: memory ?? undefined, tools });

	const { createPolicyAdapter, createMeshInfrastructure } = await import("./shared-factories.js");
	const mesh = await createMeshInfrastructure();

	let commHub: AgentConfig["commHub"];
	let commHubDestroy: (() => void) | undefined;
	try { const { CommHub } = await import("@chitragupta/sutra"); const h = new CommHub({ enableLogging: false }); commHub = h as unknown as AgentConfig["commHub"]; commHubDestroy = () => h.destroy(); } catch { /* best-effort */ }

	const policyEngine = await createPolicyAdapter({ sessionId: "coding-serve", agentId: "kartru", projectPath });

	const agentConfig: AgentConfig = {
		profile, providerId, model: modelId, tools, systemPrompt,
		thinkingLevel: profile.preferredThinking ?? settings.thinkingLevel ?? "medium",
		workingDirectory: projectPath, policyEngine, commHub,
		actorSystem: mesh.actorSystem,
		samiti: modules.servSamiti as unknown as import("@chitragupta/anina").MeshSamiti | undefined,
		lokapala: modules.servLokapala as unknown as import("@chitragupta/anina").LokapalaGuardians | undefined,
		kaala: mesh.kaala as unknown as AgentConfig["kaala"],
		enableLearning: true, enableAutonomy: true, enableMemory: true, project: projectPath,
		onToolNotFound: createToolNotFoundResolver({
			tools,
			vidyaOrchestrator: modules.servVidyaOrchestrator as {
				bridge?: { getSkillForTool(toolName: string): { name: string } | null };
				recommend?(query: string): Array<{ skill?: { name?: string }; score?: number }>;
			} | undefined,
			onGap: (toolName: string) => {
				try { log.debug("tool-not-found", { toolName }); } catch { /* best-effort */ }
			},
		}),
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// Register with KaalaBrahma
	if (mesh.kaala) {
		try {
			(mesh.kaala as unknown as { registerAgent(info: Record<string, unknown>): void }).registerAgent({
				agentId: agent.id, lastBeat: Date.now(), startedAt: Date.now(),
				turnCount: 0, tokenUsage: 0, status: "alive", parentId: null,
				depth: 0, purpose: "HTTP server agent", tokenBudget: 200_000,
			});
			(mesh.kaala as unknown as { startMonitoring(): void }).startMonitoring();
			if (modules.servSamiti) {
				(mesh.kaala as unknown as { onStatusChange(cb: (id: string, o: string, n: string) => void): () => void })
					.onStatusChange((id, o, n) => {
						try { (modules.servSamiti as unknown as { broadcast(ch: string, msg: Record<string, unknown>): void }).broadcast("#alerts", { sender: "kaala-brahma", severity: n === "error" ? "warning" : "info", category: "lifecycle", content: `Agent ${id}: ${o} → ${n}` }); } catch { /* best-effort */ }
					});
			}
		} catch { /* best-effort */ }
	}

	// Wire deep-sleep handler
	if (modules.servNidraDaemon) {
		try {
			(modules.servNidraDaemon as { onDeepSleep(cb: () => Promise<void>): void }).onDeepSleep(async () => {
				try {
					const { DatabaseManager } = await import("@chitragupta/smriti");
					const dbm = DatabaseManager.instance();
					for (const dbName of ["agent", "graph", "vectors"] as const) {
						try { const d = dbm.get(dbName); d.pragma("wal_checkpoint(TRUNCATE)"); d.exec("VACUUM"); } catch { /* best-effort */ }
					}
					try { dbm.get("agent").exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`); } catch { /* best-effort */ }
					try { dbm.get("agent").exec(`DELETE FROM consolidation_log WHERE rowid NOT IN (SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100)`); } catch { /* best-effort */ }
				} catch { /* best-effort */ }
			});
		} catch { /* best-effort */ }
	}

	log.info("Server agent created", { providerId, model: modelId });

	return {
		result: agent,
		refs: {
			kaalaRef: mesh.kaala ? mesh.kaala as unknown as { dispose(): void } : undefined,
			actorShutdownRef: mesh.actorSystemShutdown,
			commHubDestroyRef: commHubDestroy,
		},
	};
}

/** Build the handler map passed to createChitraguptaAPI. */
function buildServerHandlers(opts: {
	serverAgent: unknown; serverSession: unknown; registry: ProviderRegistry;
	projectPath: string; turiyaRouter?: TuriyaRouter; modules: ServePhaseModules;
	pairingEngine: { generateChallenge(): void; getTerminalDisplay(): string };
	budgetTracker: unknown; meshActorSystem?: unknown;
	getMeshBootstrapResult?: () => MeshBootstrapResult | undefined;
}): ApiDeps {
	const { serverAgent, serverSession, registry, projectPath, turiyaRouter, modules: m, pairingEngine, budgetTracker } = opts;
	return {
		getAgent: () => serverAgent, getSession: () => serverSession,
		listSessions: () => { try { return listSessions(projectPath); } catch { return []; } },
		listProviders: () => registry.getAll().map((p) => ({ id: p.id, name: p.name })),
		listTools: () => getAllTools().map((t) => ({ name: (t as unknown as Record<string, Record<string, string>>).definition?.name, description: (t as unknown as Record<string, Record<string, string>>).definition?.description })),
		prompt: serverAgent ? async (message: string) => { const result = await (serverAgent as Agent).prompt(message); return result.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(""); } : undefined,
		getVasanaEngine: () => m.vasanaEngine, getNidraDaemon: () => m.servNidraDaemon, getVidhiEngine: () => m.vidhiEngine,
		getTuriyaRouter: () => turiyaRouter, getTriguna: () => m.servTriguna, getRtaEngine: () => m.servRtaEngine,
		getBuddhi: () => m.servBuddhi, getDatabase: () => m.servDatabase, getSamiti: () => m.servSamiti,
		getSabhaEngine: () => m.servSabhaEngine, getLokapala: () => m.servLokapala, getAkasha: () => m.servAkasha,
		getKartavyaEngine: () => m.servKartavyaEngine, getKalaChakra: () => m.servKalaChakra, getVidyaOrchestrator: () => m.servVidyaOrchestrator, getProjectPath: () => projectPath, getPairingEngine: () => pairingEngine, getBudgetTracker: () => budgetTracker,
		...buildMeshApiHandlers(opts.meshActorSystem, opts.getMeshBootstrapResult ?? (() => undefined)),
	};
}
