/**
 * @chitragupta/cli — Serve-mode helpers: phase module wiring,
 * TLS provisioning, server agent creation, and handler assembly.
 *
 * Extracted from main-serve-mode.ts to keep both files under 450 LOC.
 */

import type { AgentConfig, ToolHandler } from "@chitragupta/anina";
import { Agent } from "@chitragupta/anina";
import type { AgentProfile, ChitraguptaSettings } from "@chitragupta/core";

import { createLogger, DEFAULT_FALLBACK_MODEL } from "@chitragupta/core";
import type { ProviderDefinition } from "@chitragupta/swara";
import { getAllTools } from "@chitragupta/yantra";
import path from "path";
import { loadProjectMemory } from "./bootstrap.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";
import type { ProjectInfo } from "./project-detector.js";
import { createToolNotFoundResolver } from "./shared-factories.js";

const log = createLogger("cli:main-serve-helpers");

/** Phase modules wired for serve mode. All fields are optional/unknown since each is best-effort. */
export interface ServePhaseModules {
	vasanaEngine: unknown;
	vidhiEngine: unknown;
	servNidraDaemon: unknown;
	servTriguna: unknown;
	servRtaEngine: unknown;
	servBuddhi: unknown;
	servDatabase: unknown;
	servSamiti: unknown;
	servSabhaEngine: unknown;
	servLokapala: unknown;
	servAkasha: unknown;
	servKartavyaEngine: unknown;
	servKalaChakra: unknown;
	servVidyaOrchestrator: unknown;
}

export interface ServeCleanups {
	skillWatcherCleanups: Array<() => void>;
	servKartavyaDispatcher?: { start(): void; stop(): void };
}

/** Provision TLS certificates via Kavach if enabled. */
export async function provisionTlsCerts(noTls?: boolean): Promise<import("./tls/tls-types.js").TlsCertificates | undefined> {
	if (noTls) return undefined;
	try {
		const { provisionTls } = await import("./tls/tls-store.js");
		const result = await provisionTls();
		if (result.ok && result.certs) {
			if (result.freshCA) {
				const { installCATrust } = await import("./tls/tls-trust.js");
				const tr = await installCATrust(result.certs.ca);
				log.info(tr.trusted ? "Kavach: CA trusted in system store" : "Kavach: " + tr.message);
			}
			return result.certs;
		}
		log.warn("Kavach: TLS provisioning failed", { reason: result.reason });
	} catch (err) {
		log.warn("Kavach: TLS unavailable", { error: err instanceof Error ? err.message : String(err) });
	}
	return undefined;
}

/** Wire all phase modules for serve mode. */
export async function wireServePhaseModules(
	projectPath: string,
): Promise<{ modules: ServePhaseModules; cleanups: ServeCleanups }> {
	const m: ServePhaseModules = {
		vasanaEngine: undefined,
		vidhiEngine: undefined,
		servNidraDaemon: undefined,
		servTriguna: undefined,
		servRtaEngine: undefined,
		servBuddhi: undefined,
		servDatabase: undefined,
		servSamiti: undefined,
		servSabhaEngine: undefined,
		servLokapala: undefined,
		servAkasha: undefined,
		servKartavyaEngine: undefined,
		servKalaChakra: undefined,
		servVidyaOrchestrator: undefined,
	};
	const c: ServeCleanups = { skillWatcherCleanups: [] };

	// Phase 1: Self-Evolution
	try {
		const { VasanaEngine, VidhiEngine } = await import("@chitragupta/smriti");
		m.vasanaEngine = new VasanaEngine();
		m.vidhiEngine = new VidhiEngine({ project: projectPath });
	} catch (e) {
		log.debug("Self-evolution modules unavailable", { error: String(e) });
	}
	try {
		const { NidraDaemon: N } = await import("@chitragupta/anina");
		m.servNidraDaemon = new N({
			idleTimeoutMs: 300_000,
			dreamDurationMs: 600_000,
			deepSleepDurationMs: 1_800_000,
			project: projectPath,
		});
		(m.servNidraDaemon as { start: () => void }).start();
	} catch (e) {
		log.debug("NidraDaemon unavailable", { error: String(e) });
	}

	// Phase 2: Intelligence Layer
	try {
		const { Triguna } = await import("@chitragupta/anina");
		m.servTriguna = new Triguna();
	} catch (e) {
		log.debug("Triguna unavailable", { error: String(e) });
	}
	try {
		const { RtaEngine } = await import("@chitragupta/dharma");
		m.servRtaEngine = new RtaEngine();
	} catch (e) {
		log.debug("RtaEngine unavailable", { error: String(e) });
	}
	try {
		const { Buddhi } = await import("@chitragupta/anina");
		m.servBuddhi = new Buddhi();
	} catch (e) {
		log.debug("Buddhi unavailable", { error: String(e) });
	}
	try {
		const { DatabaseManager } = await import("@chitragupta/smriti");
		m.servDatabase = DatabaseManager.instance();
	} catch (e) {
		log.debug("DatabaseManager unavailable", { error: String(e) });
	}

	// Phase 3: Collaboration
	try {
		const { Samiti, SabhaEngine } = await import("@chitragupta/sutra");
		m.servSamiti = new Samiti();
		m.servSabhaEngine = new SabhaEngine();
	} catch (e) {
		log.debug("Collaboration modules unavailable", { error: String(e) });
	}
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		m.servLokapala = new LokapalaController();
	} catch (e) {
		log.debug("LokapalaController unavailable", { error: String(e) });
	}
	try {
		const { AkashaField } = await import("@chitragupta/smriti");
		m.servAkasha = new AkashaField();
	} catch (e) {
		log.debug("AkashaField unavailable", { error: String(e) });
	}

	// Phase 4: Autonomy
	const toolHandlers = new Map<string, ToolHandler>(getAllTools().map((t) => [t.definition.name, t]));
	const toolExecutor = async (toolName: string, toolArgs: Record<string, unknown>) => {
		const handler = toolHandlers.get(toolName);
		if (!handler) return { success: false, error: `Unknown tool: ${toolName}` };
		try {
			const result = await handler.execute(toolArgs ?? {}, {
				sessionId: "kartavya-dispatcher",
				workingDirectory: projectPath,
			});
			return result.isError
				? { success: false, error: result.content || `Tool "${toolName}" returned error` }
				: { success: true, output: result.content ?? "ok" };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : String(err) };
		}
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
				{
					enableCommandActions: false,
					workingDirectory: projectPath,
					project: projectPath,
					toolExecutor,
					vidhiEngine: m.vidhiEngine as import("@chitragupta/niyanta").DispatcherVidhiEngine | undefined,
				},
			);
			d.start();
			c.servKartavyaDispatcher = d;
		} catch {
			/* best-effort */
		}
	} catch (e) {
		log.debug("KartavyaEngine unavailable", { error: String(e) });
	}
	try {
		const { KalaChakra } = await import("@chitragupta/smriti");
		m.servKalaChakra = new KalaChakra();
	} catch (e) {
		log.debug("KalaChakra unavailable", { error: String(e) });
	}

	// Vidya Orchestrator
	try {
		const {
			SkillRegistry,
			VidyaBridge,
			SurakshaScanner,
			SkillPipeline,
			SkillSandbox,
			PratikshaManager,
			ShikshaController,
			VidyaOrchestrator,
		} = await import("@chitragupta/vidhya-skills");
		const reg = new SkillRegistry();
		const bridge = new VidyaBridge(reg);
		bridge.registerToolsAsSkills(
			getAllTools().map((t) => ({
				name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
				description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
				inputSchema: ((t as unknown as Record<string, Record<string, unknown>>).definition?.inputSchema ??
					{}) as Record<string, unknown>,
			})),
		);
		try {
			const { loadSkillTiers } = await import("./shared-factories.js");
			const r = await loadSkillTiers({ projectPath, skillRegistry: reg });
			c.skillWatcherCleanups.push(...r.watcherCleanups);
		} catch (e) {
			log.debug("Agent skill loading failed", { error: String(e) });
		}
		let scanner: InstanceType<typeof SurakshaScanner> | undefined;
		let shiksha: InstanceType<typeof ShikshaController> | undefined;
		try {
			scanner = new SurakshaScanner();
			const sandbox = new SkillSandbox();
			const staging = new PratikshaManager();
			const pipeline = new SkillPipeline({ scanner, sandbox, staging, registry: reg });
			shiksha = new ShikshaController({ registry: reg, pipeline, scanner });
		} catch (e) {
			log.warn("Suraksha/Shiksha pipeline unavailable; autonomous learning disabled", { error: String(e) });
		}
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
	} catch (e) {
		log.debug("VidyaOrchestrator unavailable", { error: String(e) });
	}

	return { modules: m, cleanups: c };
}

export interface CreateServerAgentParams {
	servResolved: { providerId: string; provider: ProviderDefinition };
	profile: AgentProfile;
	settings: ChitraguptaSettings;
	project: ProjectInfo;
	projectPath: string;
	modules: ServePhaseModules;
	args: { model?: string };
}

export interface ServerAgentRefs {
	kaalaRef?: { dispose(): void };
	actorShutdownRef?: () => void;
	commHubDestroyRef?: () => void;
}

/** Create the server agent with full mesh infrastructure. */
export async function createServerAgent(params: CreateServerAgentParams): Promise<{ result: Agent; refs: ServerAgentRefs }> {
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
	try {
		const { CommHub } = await import("@chitragupta/sutra");
		const h = new CommHub({ enableLogging: false });
		commHub = h as unknown as AgentConfig["commHub"];
		commHubDestroy = () => h.destroy();
	} catch {
		/* best-effort */
	}

	const policyEngine = await createPolicyAdapter({ sessionId: "coding-serve", agentId: "kartru", projectPath });

	const agentConfig: AgentConfig = {
		profile,
		providerId,
		model: modelId,
		tools,
		systemPrompt,
		thinkingLevel: profile.preferredThinking ?? settings.thinkingLevel ?? "medium",
		workingDirectory: projectPath,
		policyEngine,
		commHub,
		actorSystem: mesh.actorSystem,
		samiti: modules.servSamiti as unknown as import("@chitragupta/anina").MeshSamiti | undefined,
		lokapala: modules.servLokapala as unknown as import("@chitragupta/anina").LokapalaGuardians | undefined,
		kaala: mesh.kaala as unknown as AgentConfig["kaala"],
		enableLearning: true,
		enableAutonomy: true,
		enableMemory: true,
		project: projectPath,
		onToolNotFound: createToolNotFoundResolver({
			tools,
			vidyaOrchestrator: modules.servVidyaOrchestrator as
				| {
						bridge?: { getSkillForTool(toolName: string): { name: string } | null };
						recommend?(query: string): Array<{ skill?: { name?: string }; score?: number }>;
				  }
				| undefined,
			onGap: (toolName: string) => {
				try {
					log.debug("tool-not-found", { toolName });
				} catch {
					/* best-effort */
				}
			},
		}),
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// Register with KaalaBrahma
	if (mesh.kaala) {
		try {
			(mesh.kaala as unknown as { registerAgent(info: Record<string, unknown>): void }).registerAgent({
				agentId: agent.id,
				lastBeat: Date.now(),
				startedAt: Date.now(),
				turnCount: 0,
				tokenUsage: 0,
				status: "alive",
				parentId: null,
				depth: 0,
				purpose: "HTTP server agent",
				tokenBudget: 200_000,
			});
			(mesh.kaala as unknown as { startMonitoring(): void }).startMonitoring();
			if (modules.servSamiti) {
				(
					mesh.kaala as unknown as { onStatusChange(cb: (id: string, o: string, n: string) => void): () => void }
				).onStatusChange((id, o, n) => {
					try {
						(modules.servSamiti as unknown as { broadcast(ch: string, msg: Record<string, unknown>): void }).broadcast(
							"#alerts",
							{
								sender: "kaala-brahma",
								severity: n === "error" ? "warning" : "info",
								category: "lifecycle",
								content: `Agent ${id}: ${o} → ${n}`,
							},
						);
					} catch {
						/* best-effort */
					}
				});
			}
		} catch {
			/* best-effort */
		}
	}

	// Wire deep-sleep handler
	if (modules.servNidraDaemon) {
		try {
			(modules.servNidraDaemon as { onDeepSleep(cb: () => Promise<void>): void }).onDeepSleep(async () => {
				try {
					const { DatabaseManager } = await import("@chitragupta/smriti");
					const dbm = DatabaseManager.instance();
					for (const dbName of ["agent", "graph", "vectors"] as const) {
						try {
							const d = dbm.get(dbName);
							d.pragma("wal_checkpoint(TRUNCATE)");
							d.exec("VACUUM");
						} catch {
							/* best-effort */
						}
					}
					try {
						dbm.get("agent").exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`);
					} catch {
						/* best-effort */
					}
					try {
						dbm
							.get("agent")
							.exec(
								`DELETE FROM consolidation_log WHERE rowid NOT IN (SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100)`,
							);
					} catch {
						/* best-effort */
					}
				} catch {
					/* best-effort */
				}
			});
		} catch {
			/* best-effort */
		}
	}

	log.info("Server agent created", { providerId, model: modelId });

	return {
		result: agent,
		refs: {
			kaalaRef: mesh.kaala ? (mesh.kaala as unknown as { dispose(): void }) : undefined,
			actorShutdownRef: mesh.actorSystemShutdown,
			commHubDestroyRef: commHubDestroy,
		},
	};
}
