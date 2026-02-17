/**
 * @chitragupta/cli — Main orchestration.
 *
 * The `main()` function is the central coordinator that:
 *   1. Loads global settings
 *   2. Detects the current project
 *   3. Loads project config if present
 *   4. Resolves the agent profile
 *   5. Initializes the provider registry
 *   6. Creates the agent
 *   7. Loads memory for the project
 *   8. Creates or continues a session
 *   9. Launches the appropriate mode (interactive or print)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
	loadGlobalSettings,
	loadProjectConfig,
	createConfig,
	cascadeConfigs,
	getChitraguptaHome,
	resolveProfile,
	BUILT_IN_PROFILES,
	createLogger,
	DEFAULT_FALLBACK_MODEL,
} from "@chitragupta/core";
import type { ThinkingLevel } from "@chitragupta/core";
import { createProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { MargaPipeline as MargaPipelineType } from "@chitragupta/swara";
import { TuriyaRouter } from "@chitragupta/swara";
import { Agent, MemoryBridge, Manas } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage, ToolHandler } from "@chitragupta/anina";
import {
	createSession,
	listSessions,
	loadSession,
	saveSession,
	addTurn,
} from "@chitragupta/smriti/session-store";
import type { Session } from "@chitragupta/smriti/types";
import { getAllTools } from "@chitragupta/yantra";

import { PolicyEngine, STANDARD_PRESET } from "@chitragupta/dharma";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";
import { CommHub } from "@chitragupta/sutra";

import { KaalaBrahma } from "@chitragupta/anina";
import { SoulManager } from "@chitragupta/anina";
import { AgentReflector } from "@chitragupta/anina";
import { ApprovalGate } from "@chitragupta/dharma";
import { KarmaTracker } from "@chitragupta/dharma";
import { CheckpointManager } from "@chitragupta/smriti";
import { MessageBus } from "@chitragupta/sutra";

import type { ParsedArgs } from "./args.js";
import { detectProject } from "./project-detector.js";
import type { ProjectInfo } from "./project-detector.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";
import { runInteractiveMode } from "./modes/interactive.js";
import { runPrintMode } from "./modes/print.js";
import { isFirstRun, runOnboarding } from "./onboarding.js";
import { loadPlugins } from "./plugin-loader.js";
import type { PluginRegistry } from "./plugin-loader.js";

import {
	loadProjectMemory,
	loadCustomProfiles,
	loadCredentials,
	registerBuiltinProviders,
	registerCLIProviders,
	formatProviderSummary,
	resolvePreferredProvider,
	getBuiltinTools,
	getActionType,
	createEmbeddingProviderInstance,
} from "./bootstrap.js";

const log = createLogger("cli:main");

// ─── Global Error Handlers ───────────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
	const msg = reason instanceof Error ? reason.message : String(reason);
	process.stderr.write(`\nUnhandled rejection: ${msg}\n`);
	if (reason instanceof Error && reason.stack) {
		process.stderr.write(`${reason.stack}\n`);
	}
});

process.on("uncaughtException", (error) => {
	const msg = error instanceof Error ? error.message : String(error);
	process.stderr.write(`\nUncaught exception: ${msg}\n`);
	if (error instanceof Error && error.stack) {
		process.stderr.write(`${error.stack}\n`);
	}
	process.exit(1);
});

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Main entry point for the CLI.
 *
 * Orchestrates the full setup and launches the appropriate mode
 * based on the parsed arguments.
 */
export async function main(args: ParsedArgs): Promise<void> {
	// ─── 0. First-run onboarding ─────────────────────────────────────────
	if (isFirstRun()) {
		const result = await runOnboarding();
		if (!result.completed) {
			// User cancelled or skipped — proceed with defaults
		}
	}

	// ─── 1. Load global settings ────────────────────────────────────────
	loadCredentials();
	const settings = loadGlobalSettings();

	// ─── 2. Detect project ──────────────────────────────────────────────
	const projectPath = process.cwd();
	const project = detectProject(projectPath);

	// ─── 3. Load project config if present ──────────────────────────────
	let projectConfig: Record<string, unknown> = {};
	try {
		projectConfig = loadProjectConfig(projectPath);
	} catch (e) {
		log.debug("No project config found", { error: String(e) });
	}

	// Create merged config layers
	const globalConfig = createConfig("global", settings as unknown as Record<string, unknown>);
	const projConfig = createConfig("project", projectConfig);
	const config = cascadeConfigs(globalConfig, projConfig);

	// ─── 4. Resolve agent profile ───────────────────────────────────────
	const profileId = args.profile ?? settings.agentProfile ?? "chitragupta";
	const customProfiles = loadCustomProfiles();
	const profile = resolveProfile(profileId, customProfiles) ?? BUILT_IN_PROFILES["chitragupta"];

	// ─── 5. Initialize provider registry ────────────────────────────────
	const registry = createProviderRegistry();

	// 5-i. Register CLI providers first (zero cost — use installed CLIs)
	const cliResults = await registerCLIProviders(registry);
	const detectedCLIs = cliResults.filter((c) => c.available);

	// 5-ii. Register API providers (Anthropic, OpenAI, Google, Ollama)
	registerBuiltinProviders(registry, settings);

	// 5-iii. Check Ollama availability (for embedding + local models)
	let hasOllama = false;
	try {
		const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
		const probe = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
		hasOllama = probe.ok;
	} catch {
		// Ollama not running
	}

	// 5-iv. Detect which API keys are set
	const activeApiKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"]
		.filter((k) => !!process.env[k]);

	// 5-v. Print provider summary on first run or when no providers
	const totalProviders = detectedCLIs.length + (hasOllama ? 1 : 0) + activeApiKeys.length;
	if (totalProviders === 0) {
		process.stderr.write("\n" + formatProviderSummary(cliResults, hasOllama, activeApiKeys) + "\n\n");
	} else if (detectedCLIs.length > 0) {
		log.info("CLI providers detected", {
			clis: detectedCLIs.map((c) => `${c.command}${c.version ? ` (${c.version})` : ""}`).join(", "),
		});
	}

	// ─── 5a. Wire MargaPipeline (Marga — intelligent model routing) ─────
	let margaPipeline: MargaPipelineType | undefined;
	try {
		const { MargaPipeline, HYBRID_BINDINGS } = await import("@chitragupta/swara");
		margaPipeline = new MargaPipeline({
			registry,
			bindings: HYBRID_BINDINGS,
			autoEscalate: true,
			maxEscalations: 2,
		});
	} catch (e) {
		log.debug("MargaPipeline unavailable", { error: String(e) });
	}

	// ─── 5a-ii. Wire TuriyaRouter (contextual bandit model routing) ─────
	let turiyaRouter: TuriyaRouter | undefined;
	try {
		turiyaRouter = new TuriyaRouter({ linucbAlpha: 0.5 });
		const turiyaStatePath = path.join(getChitraguptaHome(), "turiya-state.json");
		if (fs.existsSync(turiyaStatePath)) {
			turiyaRouter.deserialize(JSON.parse(fs.readFileSync(turiyaStatePath, "utf8")));
			log.info("Turiya state restored", { plays: turiyaRouter.getStats().totalRequests });
		}
	} catch (e) {
		log.debug("TuriyaRouter unavailable", { error: String(e) });
	}

	// ─── 5a-iii. Wire Manas (zero-cost input classifier) ────────────────
	let manas: Manas | undefined;
	try {
		manas = new Manas();
	} catch (e) {
		log.debug("Manas unavailable", { error: String(e) });
	}

	// ─── 5b. Handle 'serve' subcommand (HTTP API gateway) ───────────────
	if (args.command === "serve") {
		const { createChitraguptaAPI } = await import("./http-server.js");

		const port = args.port ?? 3141;
		const host = args.host ?? "127.0.0.1";

		// Auth from environment or settings
		const authToken = process.env.CHITRAGUPTA_AUTH_TOKEN
			?? (settings as unknown as Record<string, unknown>).authToken as string | undefined;
		const apiKeys = process.env.CHITRAGUPTA_API_KEYS?.split(",").filter(Boolean);

		const serverConfig = {
			port,
			host,
			authToken,
			apiKeys,
			enableLogging: true,
		};

		// Create the API server with all phase modules wired in.
		// Agent and session are lazily initialized — the server exposes
		// health, providers, and tools immediately; chat requires a running agent.
		let serverAgent: unknown = null;
		let serverSession: unknown = null;

		// ── Phase 1: Self-Evolution modules ────────────────────────────
		let vasanaEngine: unknown;
		let vidhiEngine: unknown;
		let servNidraDaemon: unknown;
		try {
			const { VasanaEngine, VidhiEngine } = await import("@chitragupta/smriti");
			vasanaEngine = new VasanaEngine();
			vidhiEngine = new VidhiEngine({ project: projectPath });
		} catch (e) { log.debug("Self-evolution modules unavailable", { error: String(e) }); }
		try {
			const { NidraDaemon: NidraCls } = await import("@chitragupta/anina");
			servNidraDaemon = new NidraCls({
				idleTimeoutMs: 300_000,
				dreamDurationMs: 600_000,
				deepSleepDurationMs: 1_800_000,
				project: projectPath,
			});
			(servNidraDaemon as { start: () => void }).start();
		} catch (e) { log.debug("NidraDaemon unavailable", { error: String(e) }); }

		// ── Phase 2: Intelligence Layer modules ────────────────────────
		let servTriguna: unknown;
		let servRtaEngine: unknown;
		let servBuddhi: unknown;
		let servDatabase: unknown;
		try {
			const { Triguna } = await import("@chitragupta/anina");
			servTriguna = new Triguna();
		} catch (e) { log.debug("Triguna unavailable", { error: String(e) }); }
		try {
			const { RtaEngine } = await import("@chitragupta/dharma");
			servRtaEngine = new RtaEngine();
		} catch (e) { log.debug("RtaEngine unavailable", { error: String(e) }); }
		try {
			const { Buddhi } = await import("@chitragupta/anina");
			servBuddhi = new Buddhi();
		} catch (e) { log.debug("Buddhi unavailable", { error: String(e) }); }
		try {
			const { DatabaseManager } = await import("@chitragupta/smriti");
			servDatabase = DatabaseManager.instance();
		} catch (e) { log.debug("DatabaseManager unavailable", { error: String(e) }); }

		// ── Phase 3: Collaboration modules ─────────────────────────────
		let servSamiti: unknown;
		let servSabhaEngine: unknown;
		let servLokapala: unknown;
		let servAkasha: unknown;
		try {
			const { Samiti, SabhaEngine } = await import("@chitragupta/sutra");
			servSamiti = new Samiti();
			servSabhaEngine = new SabhaEngine();
		} catch (e) { log.debug("Collaboration modules unavailable", { error: String(e) }); }
		try {
			const { LokapalaController } = await import("@chitragupta/anina");
			servLokapala = new LokapalaController();
		} catch (e) { log.debug("LokapalaController unavailable", { error: String(e) }); }
		try {
			const { AkashaField } = await import("@chitragupta/smriti");
			servAkasha = new AkashaField();
		} catch (e) { log.debug("AkashaField unavailable", { error: String(e) }); }

		// ── Phase 4: Autonomy modules ──────────────────────────────────
		let servKartavyaEngine: unknown;
		let servKalaChakra: unknown;
		let servKartavyaDispatcher: { start(): void; stop(): void } | undefined;
		try {
			const { KartavyaEngine } = await import("@chitragupta/niyanta");
			servKartavyaEngine = new KartavyaEngine();

			// Wire KartavyaDispatcher for serve-mode autonomous actions
			try {
				const { KartavyaDispatcher } = await import("@chitragupta/niyanta");
				const dispatcher = new KartavyaDispatcher(
					servKartavyaEngine as InstanceType<typeof KartavyaEngine>,
					servSamiti as unknown as ConstructorParameters<typeof KartavyaDispatcher>[1],
					servRtaEngine as unknown as ConstructorParameters<typeof KartavyaDispatcher>[2],
					{ enableCommandActions: false, workingDirectory: projectPath, project: projectPath },
				);
				dispatcher.start();
				servKartavyaDispatcher = dispatcher;
			} catch { /* best-effort */ }
		} catch (e) { log.debug("KartavyaEngine unavailable", { error: String(e) }); }
		try {
			const { KalaChakra } = await import("@chitragupta/smriti");
			servKalaChakra = new KalaChakra();
		} catch (e) { log.debug("KalaChakra unavailable", { error: String(e) }); }

		// ── Vidya Orchestrator (Skill ecosystem) ───────────────────────
		let servVidyaOrchestrator: unknown;
		const skillWatcherCleanups: Array<() => void> = [];
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

			const skillReg = new SkillRegistry();
			const bridge = new VidyaBridge(skillReg);
			const toolDefs = getAllTools().map((t) => ({
				name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
				description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
				inputSchema: ((t as unknown as Record<string, Record<string, unknown>>).definition?.inputSchema ?? {}) as Record<string, unknown>,
			}));
			bridge.registerToolsAsSkills(toolDefs);

			// Load Agent Skills with candidate-set priorities + live-reload watchers
			// Priority: skills-core=4, ecosystem/skills=3, skill-lab=2, skill-community=1
			// Canonical structure per tier:
			//   core/stable/community: <tier>/<skill-name>/SKILL.md
			//   skill-lab lanes: <tier>/{auto|incubator}/<skill-name>/SKILL.md
			try {
				const { SkillDiscovery: SD } = await import("@chitragupta/vidhya-skills");
				const chitraguptaRoot = path.resolve(
					path.dirname(new URL(import.meta.url).pathname),
					"..", "..", "..",
				);
				const ecosystemRoot = path.resolve(chitraguptaRoot, "..", "ecosystem");
				const discovery = new SD();

				const isAllowedSkillManifestPath = (tierDir: string, filePath: string): boolean => {
					const rel = path.relative(tierDir, filePath);
					if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
					const parts = rel.split(path.sep).filter(Boolean);
					if (parts.length === 2 && parts[1].toLowerCase() === "skill.md") {
						return true;
					}
					if (
						path.basename(tierDir) === "skill-lab" &&
						parts.length === 3 &&
						(parts[0] === "auto" || parts[0] === "incubator") &&
						parts[2].toLowerCase() === "skill.md"
					) {
						return true;
					}
					return false;
				};

				const loadTier = async (dir: string, priority: number) => {
					const discovered = await discovery.discoverFromDirectory(dir);
					let skippedNonFlat = 0;
					for (const skill of discovered) {
						const sp = skill.source?.type === "manual" ? (skill.source as { filePath?: string }).filePath : undefined;
						if (!sp || !isAllowedSkillManifestPath(dir, sp)) {
							skippedNonFlat += 1;
							continue;
						}
						skillReg.registerWithPriority(skill, priority, sp);
					}
					if (skippedNonFlat > 0) {
						log.debug("Agent skills skipped (non-flat path)", { dir, skippedNonFlat });
					}
				};

				const watchTier = (dir: string, priority: number) => {
					const cleanup = discovery.watchDirectory(dir, (event) => {
						if (!isAllowedSkillManifestPath(dir, event.filePath)) return;
						if (event.type === "removed") {
							skillReg.unregisterBySourcePath(event.filePath);
						} else if (event.manifest) {
							skillReg.registerWithPriority(event.manifest, priority, event.filePath);
						}
					});
					skillWatcherCleanups.push(cleanup);
				};

				// Tier 1: skills-core (project-local + builtin) — priority 4
				for (const root of [projectPath, chitraguptaRoot]) {
					const dir = path.resolve(root, "skills-core");
					await loadTier(dir, 4);
					watchTier(dir, 4);
				}
				// Tier 2: ecosystem/skills (approved, vetted) — priority 3
				{
					const dir = path.resolve(ecosystemRoot, "skills");
					await loadTier(dir, 3);
					watchTier(dir, 3);
				}
				// Tier 3: ecosystem/skill-lab (experimental) — priority 2
				{
					const dir = path.resolve(ecosystemRoot, "skill-lab");
					await loadTier(dir, 2);
					watchTier(dir, 2);
				}
				// Tier 4: ecosystem/skill-community (disabled by default) — priority 1
				if (process.env.VAAYU_SKILL_COMMUNITY_ENABLED === "true") {
					const dir = path.resolve(ecosystemRoot, "skill-community");
					await loadTier(dir, 1);
					watchTier(dir, 1);
				}
			} catch (e) { log.debug("Agent skill loading failed", { error: String(e) }); }

			let scanner: InstanceType<typeof SurakshaScanner> | undefined;
			let shiksha: InstanceType<typeof ShikshaController> | undefined;
			try {
				scanner = new SurakshaScanner();
				const sandbox = new SkillSandbox();
				const staging = new PratikshaManager();
				const pipeline = new SkillPipeline({ scanner, sandbox, staging, registry: skillReg });
				shiksha = new ShikshaController({ registry: skillReg, pipeline, scanner });
			} catch (e) { log.debug("Suraksha/Shiksha pipeline unavailable", { error: String(e) }); }

			const stateDir = path.join(projectPath, ".chitragupta");
			servVidyaOrchestrator = new VidyaOrchestrator(
				{ registry: skillReg, bridge, scanner: scanner as any, shiksha: shiksha as any },
				{ persistPath: stateDir + "/vidya-state.json", enableAutoComposition: true },
			);
			await (servVidyaOrchestrator as { initialize: () => Promise<void> }).initialize();
		} catch (e) { log.debug("VidyaOrchestrator unavailable", { error: String(e) }); }

		// ── Resolve provider & create server agent (lazy init) ──────
		// Without an agent, POST /api/chat and WebSocket chat return 503.
		// Resolve the provider (same priority as TUI mode) and create a
		// fully-wired Agent so the HTTP API can handle chat requests.
		// Cleanup references hoisted for shutdown handler scope
		let servKaalaRef: { dispose(): void } | undefined;
		let servActorShutdownRef: (() => void) | undefined;
		let servCommHubDestroyRef: (() => void) | undefined;

		const servResolved = resolvePreferredProvider(args.provider, settings, registry);
		if (servResolved) {
			const { providerId: servProviderId, provider: servProvider } = servResolved;
			const servModelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;
			const servTools = getAllTools();

			// Build minimal system prompt for the server agent
			const servContextFiles = loadContextFiles(projectPath);
			const servMemory = loadProjectMemory(projectPath);
			const servSystemPrompt = buildSystemPrompt({
				profile,
				project,
				contextFiles: servContextFiles,
				memoryContext: servMemory ?? undefined,
				tools: servTools,
			});

			// Create KaalaBrahma for serve-mode lifecycle tracking
			let servKaala: import("@chitragupta/anina").KaalaLifecycle | undefined;
			try {
				servKaala = new KaalaBrahma({
					heartbeatInterval: 5000,
					staleThreshold: 30000,
					maxAgentDepth: 5,
					maxSubAgents: 8,
				}) as unknown as import("@chitragupta/anina").KaalaLifecycle;
			} catch { /* best-effort */ }

			// Create ActorSystem for serve-mode P2P mesh
			let servActorSystem: import("@chitragupta/anina").MeshActorSystem | undefined;
			let servActorSystemShutdown: (() => void) | undefined;
			try {
				const { ActorSystem } = await import("@chitragupta/sutra");
				const sys = new ActorSystem({ maxMailboxSize: 5_000 });
				sys.start();
				servActorSystem = sys as unknown as import("@chitragupta/anina").MeshActorSystem;
				servActorSystemShutdown = () => sys.shutdown();
			} catch { /* best-effort */ }

			// Create CommHub for serve-mode IPC
			let servCommHub: import("@chitragupta/sutra").CommHub | undefined;
			let servCommHubDestroy: (() => void) | undefined;
			try {
				const { CommHub } = await import("@chitragupta/sutra");
				servCommHub = new CommHub({ enableLogging: false });
				servCommHubDestroy = () => servCommHub!.destroy();
			} catch { /* best-effort */ }

			// Create policy engine for serve-mode security
			let servPolicyEngine: import("@chitragupta/anina").AgentConfig["policyEngine"] | undefined;
			try {
				const { PolicyEngine, STANDARD_PRESET } = await import("@chitragupta/dharma");
				const preset = STANDARD_PRESET;
				const engine = new PolicyEngine(preset.config);
				for (const ps of preset.policySets) engine.addPolicySet(ps);

				servPolicyEngine = {
					check(toolName: string, toolArgs: Record<string, unknown>) {
						const actionType = getActionType(toolName);
						const action = {
							type: actionType, tool: toolName, args: toolArgs,
							filePath: (toolArgs.path ?? toolArgs.file_path ?? toolArgs.filePath) as string | undefined,
							command: (toolArgs.command ?? toolArgs.cmd) as string | undefined,
							content: (toolArgs.content ?? toolArgs.text) as string | undefined,
							url: (toolArgs.url ?? toolArgs.uri) as string | undefined,
						};
						const context = {
							sessionId: "coding-serve", agentId: "kartru", agentDepth: 0, projectPath,
							totalCostSoFar: 0, costBudget: preset.config.costBudget,
							filesModified: [] as string[], commandsRun: [] as string[], timestamp: Date.now(),
						};
						try {
							for (const ps of preset.policySets) {
								for (const rule of ps.rules) {
									const verdict = rule.evaluate(action, context);
									if (verdict && typeof verdict === "object" && "status" in verdict && !("then" in verdict)) {
										const v = verdict as { status: string; reason: string };
										if (v.status === "deny") return { allowed: false, reason: v.reason };
									}
								}
							}
						} catch { /* allow */ }
						return { allowed: true };
					},
				};
			} catch { /* dharma is optional */ }

			const servAgentConfig: AgentConfig = {
				profile,
				providerId: servProviderId,
				model: servModelId,
				tools: servTools,
				systemPrompt: servSystemPrompt,
				thinkingLevel: profile.preferredThinking ?? settings.thinkingLevel ?? "medium",
				workingDirectory: projectPath,
				policyEngine: servPolicyEngine,
				commHub: servCommHub,
				actorSystem: servActorSystem,
				samiti: servSamiti as unknown as import("@chitragupta/anina").MeshSamiti | undefined,
				lokapala: servLokapala as unknown as import("@chitragupta/anina").LokapalaGuardians | undefined,
				kaala: servKaala,
				enableLearning: true,
				enableAutonomy: true,
				enableMemory: true,
				project: projectPath,
			};

			const sAgent = new Agent(servAgentConfig);
			sAgent.setProvider(servProvider);
			serverAgent = sAgent;

			// Register with KaalaBrahma
			if (servKaala) {
				try {
					servKaala.registerAgent({
						agentId: sAgent.id,
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
				} catch { /* best-effort */ }
			}

			// Start KaalaBrahma monitoring in serve mode
			if (servKaala) {
				try {
					(servKaala as unknown as { startMonitoring(): void }).startMonitoring();
					if (servSamiti) {
						(servKaala as unknown as { onStatusChange(cb: (agentId: string, oldS: string, newS: string) => void): () => void })
							.onStatusChange((agentId, oldS, newS) => {
								try {
									(servSamiti as unknown as import("@chitragupta/anina").MeshSamiti).broadcast("#alerts", {
										sender: "kaala-brahma",
										severity: newS === "error" ? "warning" : "info",
										category: "lifecycle",
										content: `Agent ${agentId}: ${oldS} → ${newS}`,
									});
								} catch { /* best-effort */ }
							});
					}
				} catch { /* best-effort */ }
			}

			// Wire deep-sleep handler for serve-mode NidraDaemon
			if (servNidraDaemon) {
				try {
					(servNidraDaemon as { onDeepSleep(cb: () => Promise<void>): void }).onDeepSleep(async () => {
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

			// Expose cleanup refs to outer scope for shutdown handler
			if (servKaala) servKaalaRef = servKaala as unknown as { dispose(): void };
			if (servActorSystemShutdown) servActorShutdownRef = servActorSystemShutdown;
			if (servCommHubDestroy) servCommHubDestroyRef = servCommHubDestroy;

			log.info("Server agent created", { providerId: servProviderId, model: servModelId });
		} else {
			log.warn("No provider available — HTTP chat endpoints will return 503");
		}

		const server = createChitraguptaAPI({
			getAgent: () => serverAgent,
			getSession: () => serverSession,
			listSessions: () => {
				try { return listSessions(projectPath); }
				catch { return []; }
			},
			listProviders: () => registry.getAll().map((p) => ({ id: p.id, name: p.name })),
			listTools: () => getAllTools().map((t) => ({
				name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
				description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
			})),
			prompt: serverAgent ? async (message: string) => {
				const agent = serverAgent as Agent;
				const result = await agent.prompt(message);
				return result.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("");
			} : undefined,
			// Phase 1: Self-Evolution
			getVasanaEngine: () => vasanaEngine,
			getNidraDaemon: () => servNidraDaemon,
			getVidhiEngine: () => vidhiEngine,
			// Phase 2: Intelligence Layer
			getTuriyaRouter: () => turiyaRouter,
			getTriguna: () => servTriguna,
			getRtaEngine: () => servRtaEngine,
			getBuddhi: () => servBuddhi,
			getDatabase: () => servDatabase,
			// Phase 3: Collaboration
			getSamiti: () => servSamiti,
			getSabhaEngine: () => servSabhaEngine,
			getLokapala: () => servLokapala,
			getAkasha: () => servAkasha,
			// Phase 4: Autonomy
			getKartavyaEngine: () => servKartavyaEngine,
			getKalaChakra: () => servKalaChakra,
			// Vidya Skills
			getVidyaOrchestrator: () => servVidyaOrchestrator,
			getProjectPath: () => projectPath,
		}, serverConfig);

		const actualPort = await server.start();
		process.stdout.write(
			`\n  \u2605 Chitragupta HTTP API listening on http://${host}:${actualPort}\n` +
			`  Health: http://${host}:${actualPort}/api/health\n` +
			(authToken || apiKeys?.length ? `  Auth: enabled\n` : `  Auth: disabled (set CHITRAGUPTA_AUTH_TOKEN to enable)\n`) +
			`\n  Press Ctrl+C to stop.\n\n`,
		);

		// Block until SIGINT
		await new Promise<void>((resolve) => {
			process.on("SIGINT", () => {
				process.stdout.write(`\n  Shutting down server...\n`);
				const cleanup = async () => {
					// Stop skill watchers
					for (const fn of skillWatcherCleanups) { try { fn(); } catch { /* best-effort */ } }
					if (servNidraDaemon) {
						try { await (servNidraDaemon as { stop: () => Promise<void> }).stop(); } catch { /* best-effort */ }
					}
					// Dispose server agent
					if (serverAgent && typeof (serverAgent as Agent).dispose === "function") {
						try { (serverAgent as Agent).dispose(); } catch { /* best-effort */ }
					}
					// Stop KartavyaDispatcher
					if (servKartavyaDispatcher) { try { servKartavyaDispatcher.stop(); } catch { /* best-effort */ } }
					// Clean up serve-mode infrastructure
					if (servCommHubDestroyRef) { try { servCommHubDestroyRef(); } catch { /* best-effort */ } }
					if (servActorShutdownRef) { try { servActorShutdownRef(); } catch { /* best-effort */ } }
					if (servKaalaRef) { try { servKaalaRef.dispose(); } catch { /* best-effort */ } }
					await server.stop();
				};
				cleanup().then(resolve).catch(resolve);
			});
		});
		return;
	}

	// Determine provider (walk priority list) and model
	const resolved = resolvePreferredProvider(args.provider, settings, registry);
	if (!resolved) {
		process.stderr.write(
			`\nError: No provider available.\n` +
			`Registered: ${registry.getAll().map((p) => p.id).join(", ") || "none"}\n` +
			`Priority: ${(settings.providerPriority ?? []).join(" → ") || "default"}\n` +
			`\nInstall a CLI (claude, codex, gemini), start Ollama, or set an API key.\n` +
			`Run: chitragupta provider add anthropic\n\n`,
		);
		process.exit(1);
	}
	const { providerId, provider } = resolved;
	const modelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;

	log.info("Provider selected", { providerId, modelId, source: args.provider ? "explicit" : "priority" });

	// ─── 6. Load context files and memory ───────────────────────────────
	const contextFiles = loadContextFiles(projectPath);

	let memoryContext: string | undefined;
	let memoryBridge: MemoryBridge | undefined;
	if (!args.noMemory) {
		memoryContext = loadProjectMemory(projectPath);

		// Create MemoryBridge with Smaran (explicit memory) + IdentityContext
		try {
			const embeddingProvider = await createEmbeddingProviderInstance();
			memoryBridge = new MemoryBridge({
				enabled: true,
				project: projectPath,
				enableSmaran: true,
				identityPath: projectPath,
				enableGraphRAG: true,
				enableHybridSearch: true,
				embeddingProvider,
			});
		} catch {
			// MemoryBridge creation is best-effort — fall back to basic memory
		}
	}

	// ─── 7. Get built-in tools ──────────────────────────────────────────
	const tools = getBuiltinTools();

	// ─── 7a. Load MCP tools (if configured) ─────────────────────────────
	let mcpShutdown: (() => Promise<void>) | undefined;
	try {
		const { loadMCPConfig, startMCPServers, importMCPTools, shutdownMCPServers } =
			await import("./mcp-loader.js");

		const mcpConfigs = loadMCPConfig();
		if (mcpConfigs.length > 0) {
			const registry = await startMCPServers(mcpConfigs);
			const mcpTools = importMCPTools(registry);

			// MCP tools via tantra return ChitraguptaToolHandler, which is structurally
			// compatible with core's ToolHandler (same interface shape).
			for (const mcpTool of mcpTools) {
				tools.push(mcpTool as unknown as ToolHandler);
			}

			mcpShutdown = shutdownMCPServers;
		}
	} catch {
		// Silently skip: MCP loading is optional — @chitragupta/tantra may not be installed
	}

	// ─── 7b. Wire vidhya-skills via VidyaOrchestrator ───────────────────
	let skillContext: string | undefined;
	let shikshaController: { detectGap(q: string, m: Array<{ score: number }>): boolean; learn(q: string): Promise<{ success: boolean; executed: boolean; executionOutput?: string; skill?: { manifest: { name: string } }; autoApproved: boolean; quarantineId?: string; durationMs: number; error?: string }>; } | undefined;
	let vidyaOrchestrator: import("@chitragupta/vidhya-skills").VidyaOrchestrator | undefined;
	const mcpSkillWatcherCleanups: Array<() => void> = [];
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

		const skillRegistry = new SkillRegistry();
		const bridge = new VidyaBridge(skillRegistry);

		// Register all tools (built-in + MCP) as skills
		const toolDefs = tools.map((t) => ({
			name: t.definition.name,
			description: t.definition.description,
			inputSchema: t.definition.inputSchema as Record<string, unknown>,
		}));
		bridge.registerToolsAsSkills(toolDefs);

		// Load Agent Skills with candidate-set priorities + live-reload watchers
		// Priority: skills-core=4, ecosystem/skills=3, skill-lab=2, skill-community=1
		// Canonical structure per tier:
		//   core/stable/community: <tier>/<skill-name>/SKILL.md
		//   skill-lab lanes: <tier>/{auto|incubator}/<skill-name>/SKILL.md
		try {
			const { SkillDiscovery: SD } = await import("@chitragupta/vidhya-skills");
			const chitraguptaRoot = path.resolve(
				path.dirname(new URL(import.meta.url).pathname),
				"..", "..", "..",
			);
			const ecosystemRoot = path.resolve(chitraguptaRoot, "..", "ecosystem");
			const discovery = new SD();

			const isAllowedSkillManifestPath = (tierDir: string, filePath: string): boolean => {
				const rel = path.relative(tierDir, filePath);
				if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
				const parts = rel.split(path.sep).filter(Boolean);
				if (parts.length === 2 && parts[1].toLowerCase() === "skill.md") {
					return true;
				}
				if (
					path.basename(tierDir) === "skill-lab" &&
					parts.length === 3 &&
					(parts[0] === "auto" || parts[0] === "incubator") &&
					parts[2].toLowerCase() === "skill.md"
				) {
					return true;
				}
				return false;
			};

			const loadTier = async (dir: string, priority: number) => {
				const discovered = await discovery.discoverFromDirectory(dir);
				for (const skill of discovered) {
					const sp = skill.source?.type === "manual" ? (skill.source as { filePath?: string }).filePath : undefined;
					if (!sp || !isAllowedSkillManifestPath(dir, sp)) continue;
					skillRegistry.registerWithPriority(skill, priority, sp);
				}
			};

			const watchTier = (dir: string, priority: number) => {
				const cleanup = discovery.watchDirectory(dir, (event) => {
					if (!isAllowedSkillManifestPath(dir, event.filePath)) return;
					if (event.type === "removed") {
						skillRegistry.unregisterBySourcePath(event.filePath);
					} else if (event.manifest) {
						skillRegistry.registerWithPriority(event.manifest, priority, event.filePath);
					}
				});
				mcpSkillWatcherCleanups.push(cleanup);
			};

			// Tier 1: skills-core (project-local + builtin) — priority 4
			for (const root of [projectPath, chitraguptaRoot]) {
				const dir = path.resolve(root, "skills-core");
				await loadTier(dir, 4);
				watchTier(dir, 4);
			}
			// Tier 2: ecosystem/skills (approved, vetted) — priority 3
			{
				const dir = path.resolve(ecosystemRoot, "skills");
				await loadTier(dir, 3);
				watchTier(dir, 3);
			}
			// Tier 3: ecosystem/skill-lab (experimental) — priority 2
			{
				const dir = path.resolve(ecosystemRoot, "skill-lab");
				await loadTier(dir, 2);
				watchTier(dir, 2);
			}
			// Tier 4: ecosystem/skill-community (disabled by default) — priority 1
			if (process.env.VAAYU_SKILL_COMMUNITY_ENABLED === "true") {
				const dir = path.resolve(ecosystemRoot, "skill-community");
				await loadTier(dir, 1);
				watchTier(dir, 1);
			}
		} catch {
			// Agent skill loading is best-effort
		}

		// Wire Suraksha + Shiksha for injection into orchestrator
		let scanner: InstanceType<typeof SurakshaScanner> | undefined;
		try {
			scanner = new SurakshaScanner();
			const sandbox = new SkillSandbox();
			const staging = new PratikshaManager();
			const pipeline = new SkillPipeline({
				scanner,
				sandbox,
				staging,
				registry: skillRegistry,
			});

			shikshaController = new ShikshaController(
				{ registry: skillRegistry, pipeline, scanner },
			);
		} catch {
			// Pipeline wiring is best-effort
		}

		// Create the unified orchestrator
		const stateDir = projectPath
			? (await import("node:path")).join(projectPath, ".chitragupta")
			: undefined;

		// VidyaOrchestrator constructor expects duck-typed ScannerLike and ShikshaLike
		// interfaces (defined in vidya-orchestrator.ts lines 136-149). The actual
		// SurakshaScanner and ShikshaController classes are structurally compatible
		// at runtime. Using `as any` here because the full type signatures have nested
		// interfaces (SurakshaScanResult, SkillManifest) that would require importing
		// many vidhya-skills types into this file.
		vidyaOrchestrator = new VidyaOrchestrator(
			{
				registry: skillRegistry,
				bridge,
				scanner: scanner as any,
				shiksha: shikshaController as any,
			},
			{
				persistPath: stateDir ? stateDir + "/vidya-state.json" : undefined,
				enableAutoComposition: true,
			},
		);
		await vidyaOrchestrator.initialize();

		// Build skill context for the system prompt
		if (skillRegistry.size > 0) {
			const skillLines: string[] = [];
			skillLines.push("## Skill Discovery");
			skillLines.push("");
			skillLines.push(
				`${skillRegistry.size} skills registered via Trait Vector Matching (TVM).`,
			);
			skillLines.push(
				"Skills are auto-matched to tasks by semantic fingerprinting — " +
				"no need to memorize exact tool names.",
			);

			const allSkills = skillRegistry.getAll();
			const tagCounts = new Map<string, number>();
			for (const skill of allSkills) {
				for (const tag of skill.tags) {
					tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				}
			}

			const topTags = [...tagCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([tag, count]) => `${tag} (${count})`);

			if (topTags.length > 0) {
				skillLines.push("");
				skillLines.push(`Skill domains: ${topTags.join(", ")}`);
			}

			skillContext = skillLines.join("\n");
		}
	} catch (e) {
		log.debug("vidhya-skills unavailable", { error: String(e) });
	}

	// ─── 7c. Wire dharma policy engine ──────────────────────────────────
	let policyAdapter: AgentConfig["policyEngine"];
	try {
		const preset = STANDARD_PRESET;
		const dharmaEngine = new PolicyEngine(preset.config);
		for (const ps of preset.policySets) {
			dharmaEngine.addPolicySet(ps);
		}

		// Synchronous adapter: builds a PolicyAction from tool name + args
		// and evaluates rules synchronously (all built-in rules are sync).
		//
		// CRITICAL: getActionType() maps tool names to the correct PolicyAction
		// type (shell_exec, file_read, file_write, file_delete, network_request)
		// so that dharma security rules actually match and fire. Without this,
		// all actions arrive as "tool_call" and every security rule is bypassed.
		policyAdapter = {
			check(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string } {
				const actionType = getActionType(toolName);
				const action: PolicyAction = {
					type: actionType,
					tool: toolName,
					args,
					filePath: (args.path ?? args.file_path ?? args.filePath) as string | undefined,
					command: (args.command ?? args.cmd) as string | undefined,
					content: (args.content ?? args.text) as string | undefined,
					url: (args.url ?? args.uri) as string | undefined,
				};
				const context: PolicyContext = {
					sessionId: "cli",
					agentId: "root",
					agentDepth: 0,
					projectPath,
					totalCostSoFar: 0,
					costBudget: preset.config.costBudget,
					filesModified: [],
					commandsRun: [],
					timestamp: Date.now(),
				};

				// Fire-and-forget async enforce; use synchronous rule evaluation as fallback
				// Since all built-in dharma rules return sync PolicyVerdict, we can call
				// evaluate() and handle the results synchronously via the returned value.
				let blocked = false;
				let reason: string | undefined;
				try {
					// Synchronously iterate rules — evaluate() may return a Promise,
					// but built-in rules return plain PolicyVerdict objects.
					const verdicts: Array<{ status: string; reason: string }> = [];
					for (const ps of preset.policySets) {
						for (const rule of ps.rules) {
							const result = rule.evaluate(action, context);
							// If the result is a plain object (not a Promise), use it directly
							if (result && typeof result === "object" && "status" in result && !("then" in result)) {
								verdicts.push(result as { status: string; reason: string });
							}
						}
					}
					const deny = verdicts.find((v) => v.status === "deny");
					if (deny) {
						blocked = true;
						reason = deny.reason;
					}
				} catch {
					// Rule evaluation failed — allow by default to avoid blocking the agent
				}
				return blocked ? { allowed: false, reason } : { allowed: true };
			},
		};
	} catch (e) {
		log.debug("Dharma policy engine unavailable", { error: String(e) });
	}

	// ─── 7c-ii. Wire RtaEngine (invariant safety layer) ─────────────────
	let rtaEngine: import("@chitragupta/dharma").RtaEngine | undefined;
	try {
		const { RtaEngine } = await import("@chitragupta/dharma");
		rtaEngine = new RtaEngine();
	} catch { /* best-effort */ }

	// ─── 7d. Wire sutra CommHub (IPC for sub-agent communication) ────────
	let commHub: CommHub | undefined;
	let commHubDestroy: (() => void) | undefined;
	try {
		commHub = new CommHub({ enableLogging: false });
		commHubDestroy = () => commHub!.destroy();
	} catch (e) {
		log.debug("CommHub unavailable", { error: String(e) });
	}

	// ─── 7d-i. Wire ActorSystem (P2P mesh for agent-to-agent communication) ─
	let actorSystem: import("@chitragupta/anina").MeshActorSystem | undefined;
	let actorSystemShutdown: (() => void) | undefined;
	try {
		const { ActorSystem } = await import("@chitragupta/sutra");
		const system = new ActorSystem({
			maxMailboxSize: 5_000,
			gossipIntervalMs: 5_000,
			defaultAskTimeout: 5_000,
		});
		system.start();
		actorSystem = system as unknown as import("@chitragupta/anina").MeshActorSystem;
		actorSystemShutdown = () => system.shutdown();
	} catch (e) {
		log.debug("ActorSystem unavailable", { error: String(e) });
	}

	// ─── 7d-ii. Wire Samiti (ambient channel broadcasts) ─────────────
	let samiti: import("@chitragupta/anina").MeshSamiti | undefined;
	try {
		const { Samiti } = await import("@chitragupta/sutra");
		samiti = new Samiti() as unknown as import("@chitragupta/anina").MeshSamiti;
	} catch (e) {
		log.debug("Samiti unavailable", { error: String(e) });
	}

	// ─── 7d-ii. Wire Lokapala (Guardian Tool Scanning) ──────────────
	let lokapala: import("@chitragupta/anina").LokapalaGuardians | undefined;
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		lokapala = new LokapalaController() as unknown as import("@chitragupta/anina").LokapalaGuardians;
	} catch (e) {
		log.debug("Lokapala unavailable", { error: String(e) });
	}

	// ─── 7d-iii. Wire SandeshaRouter (Input Routing for sub-agents) ─────
	let sandeshaRouter: InstanceType<typeof import("@chitragupta/sutra").SandeshaRouter> | undefined;
	try {
		const { SandeshaRouter } = await import("@chitragupta/sutra");
		sandeshaRouter = new SandeshaRouter({
			defaultTimeoutMs: 30_000,
			maxPendingRequests: 10,
			commHub,
		});
	} catch (e) {
		log.debug("SandeshaRouter unavailable", { error: String(e) });
	}

	// ─── 7e. Wire KaalaBrahma (Agent Tree Lifecycle) ─────────────────
	let kaala: InstanceType<typeof KaalaBrahma> | undefined;
	try {
		kaala = new KaalaBrahma({
			heartbeatInterval: 5000,
			staleThreshold: 30000,
			maxAgentDepth: 5,
			maxSubAgents: 8,
		});

		// Start monitoring — runs healTree() every heartbeatInterval
		kaala.startMonitoring();

		// Wire status change → Samiti #alerts broadcast
		if (samiti) {
			kaala.onStatusChange((agentId, oldStatus, newStatus) => {
				try {
					samiti.broadcast("#alerts", {
						sender: "kaala-brahma",
						severity: newStatus === "error" ? "warning" : "info",
						category: "lifecycle",
						content: `Agent ${agentId}: ${oldStatus} → ${newStatus}`,
					});
				} catch { /* best-effort */ }
			});
		}
	} catch (e) {
		log.debug("KaalaBrahma unavailable", { error: String(e) });
	}

	// ─── 7e-i. Wire TrigunaActuator (health → actuation bridge) ─────
	let trigunaActuator: import("@chitragupta/anina").TrigunaActuator | undefined;
	try {
		const { TrigunaActuator } = await import("@chitragupta/anina");
		trigunaActuator = new TrigunaActuator(
			kaala as unknown as import("@chitragupta/anina").KaalaLifecycle | null ?? null,
			samiti ?? null,
		);
	} catch { /* best-effort */ }

	// ─── 7e-ii. Wire NidraDaemon (Background Sleep Cycle) ──────────
	let nidraDaemon: InstanceType<typeof import("@chitragupta/anina").NidraDaemon> | undefined;
	try {
		const { NidraDaemon: NidraCls } = await import("@chitragupta/anina");
		nidraDaemon = new NidraCls({
			idleTimeoutMs: 300_000,      // 5min idle → dreaming
			dreamDurationMs: 600_000,    // 10min dream → deep sleep
			deepSleepDurationMs: 1_800_000, // 30min deep sleep → wake
			project: projectPath,
		});

		// Hook Svapna consolidation into the dream phase
		nidraDaemon.onDream(async (progress) => {
			try {
				const { ConsolidationEngine } = await import("@chitragupta/smriti");
				progress("REPLAY", 0.1);
				const consolidator = new ConsolidationEngine();
				consolidator.load();
				progress("RECOMBINE", 0.3);

				const recentMetas = listSessions(projectPath).slice(0, 5);
				const recentSessions: Session[] = [];
				for (const meta of recentMetas) {
					try {
						const s = loadSession(meta.id, projectPath);
						if (s) recentSessions.push(s);
					} catch { /* Skip unloadable */ }
				}

				if (recentSessions.length > 0) {
					progress("CRYSTALLIZE", 0.5);
					consolidator.consolidate(recentSessions);
					progress("PROCEDURALIZE", 0.7);
					consolidator.decayRules();
					consolidator.pruneRules();
					progress("COMPRESS", 0.9);
					consolidator.save();
				}
				progress("COMPRESS", 1.0);
			} catch {
				// Dream consolidation is best-effort
			}
		});

		// Deep sleep: comprehensive SQLite maintenance
		nidraDaemon.onDeepSleep(async () => {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const dbm = DatabaseManager.instance();

				// WAL checkpoint + VACUUM all 3 databases
				for (const dbName of ["agent", "graph", "vectors"] as const) {
					try {
						const db = dbm.get(dbName);
						db.pragma("wal_checkpoint(TRUNCATE)");
						db.exec("VACUUM");
					} catch { /* best-effort per db */ }
				}

				// FTS5 optimize (merge b-tree segments)
				try {
					const agentDb = dbm.get("agent");
					agentDb.exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`);
				} catch { /* FTS5 may not exist yet */ }

				// Prune old consolidation_log entries (keep last 100)
				try {
					const agentDb = dbm.get("agent");
					agentDb.exec(`
						DELETE FROM consolidation_log WHERE rowid NOT IN (
							SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100
						)
					`);
				} catch { /* table may not exist */ }

				// Persist Rta audit log if available
				try {
					if (rtaEngine) {
						const { RtaEngine } = await import("@chitragupta/dharma");
						if (rtaEngine instanceof RtaEngine) {
							rtaEngine.persistAuditLog(dbm.get("agent"));
						}
					}
				} catch { /* best-effort */ }

				log.debug("Deep sleep maintenance complete");
			} catch {
				// Deep sleep maintenance is best-effort
			}
		});
	} catch (e) {
		log.debug("NidraDaemon unavailable", { error: String(e) });
	}

	// ─── 7f. Wire SoulManager (Agent Identity) ──────────────────────
	let soulManager: InstanceType<typeof SoulManager> | undefined;
	let soulPrompt: string | undefined;
	try {
		soulManager = new SoulManager();
		const archetypeMap: Record<string, string> = {
			kartru: "meticulous-craftsman",
			parikshaka: "vigilant-guardian",
			anveshi: "curious-scholar",
			shodhaka: "curious-scholar",
			parikartru: "meticulous-craftsman",
			lekhaka: "creative-explorer",
		};
		soulManager.create({
			id: "root",
			name: profile.name ?? "Chitragupta",
			archetype: archetypeMap[profile.id] ?? "wise-mediator",
			purpose: profile.personality ?? "AI agent orchestration platform",
		});
		soulPrompt = soulManager.buildSoulPrompt("root");
	} catch (e) {
		log.debug("SoulManager unavailable", { error: String(e) });
	}

	// ─── 7f-ii. Wire AgentReflector (post-turn self-evaluation) ──────
	let reflector: InstanceType<typeof AgentReflector> | undefined;
	try {
		reflector = new AgentReflector();
	} catch (e) {
		log.debug("AgentReflector unavailable", { error: String(e) });
	}

	// ─── 7g. Wire KarmaTracker (Trust Tracking) ─────────────────────
	let karmaTracker: InstanceType<typeof KarmaTracker> | undefined;
	try {
		karmaTracker = new KarmaTracker();
	} catch (e) {
		log.debug("KarmaTracker unavailable", { error: String(e) });
	}

	// ─── 7h. Wire MessageBus (Sandesh) ──────────────────────────────
	let messageBus: InstanceType<typeof MessageBus> | undefined;
	try {
		messageBus = new MessageBus();
	} catch (e) {
		log.debug("MessageBus unavailable", { error: String(e) });
	}

	// ─── 7i. Wire CheckpointManager (Sthiti) ────────────────────────
	let checkpointManager: InstanceType<typeof CheckpointManager> | undefined;
	try {
		const checkpointDir = path.join(getChitraguptaHome(), "checkpoints");
		if (!fs.existsSync(checkpointDir)) {
			fs.mkdirSync(checkpointDir, { recursive: true });
		}
		checkpointManager = new CheckpointManager({ checkpointDir });
	} catch (e) {
		log.debug("CheckpointManager unavailable", { error: String(e) });
	}

	// ─── 7j. Wire ApprovalGate (Dvaara) into policy adapter ────────
	let approvalGate: InstanceType<typeof ApprovalGate> | undefined;
	try {
		approvalGate = new ApprovalGate({
			defaultTimeout: 30000,
		});
	} catch (e) {
		log.debug("ApprovalGate unavailable", { error: String(e) });
	}

	// ─── 8. Build system prompt ─────────────────────────────────────────
	// Load identity context from MemoryBridge (SOUL.md, IDENTITY.md, etc.)
	let identityContextStr: string | undefined;
	if (memoryBridge) {
		try {
			const identityCtx = memoryBridge.getIdentityContext();
			if (identityCtx) {
				identityContextStr = identityCtx.load();
			}
		} catch {
			// Identity context loading is best-effort
		}
	}

	// Merge memory + skill + soul contexts
	let enrichedContext = memoryContext
		? (skillContext ? memoryContext + "\n\n" + skillContext : memoryContext)
		: skillContext;
	if (soulPrompt) {
		enrichedContext = enrichedContext
			? enrichedContext + "\n\n" + soulPrompt
			: soulPrompt;
	}

	const systemPrompt = buildSystemPrompt({
		profile,
		project,
		contextFiles,
		memoryContext: enrichedContext,
		identityContext: identityContextStr,
		tools,
	});

	// ─── 9. Resolve thinking level ──────────────────────────────────────
	const thinkingLevel: ThinkingLevel =
		profile.preferredThinking ?? settings.thinkingLevel ?? "medium";

	// ─── 10. Create the agent ───────────────────────────────────────────
	const agentConfig: AgentConfig = {
		profile,
		providerId,
		model: modelId,
		tools,
		systemPrompt,
		thinkingLevel,
		workingDirectory: projectPath,
		policyEngine: policyAdapter,
		commHub,
		actorSystem,
		samiti,
		lokapala,
		kaala: kaala as unknown as import("@chitragupta/anina").KaalaLifecycle | undefined,
		enableLearning: true,
		enableAutonomy: true,
		enableMemory: true,
		project: projectPath,
		chetanaConfig: {
			triguna: { enabled: true },
		},
		// Wire TrigunaActuator to agent's Triguna events via onEvent callback
		onEvent: trigunaActuator
			? (event, data) => {
				if (event.startsWith("triguna:")) {
					trigunaActuator!.handleEvent(event, data);
				}
			}
			: undefined,
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// ─── 10a. Load plugins and register plugin tools ────────────────────
	let pluginRegistry: PluginRegistry | undefined;
	try {
		pluginRegistry = await loadPlugins();

		// Register each plugin tool with the agent
		for (const pluginTool of pluginRegistry.tools) {
			agent.registerTool(pluginTool);
		}
	} catch {
		// Silently skip: plugin loading is best-effort
	}

	// ─── 10a-ii. Register coding_agent tool ─────────────────────────────
	// Allows the TUI agent to autonomously delegate coding tasks to the
	// CodingOrchestrator (Sanyojaka) — full Plan → Branch → Execute →
	// Validate → Review → Commit pipeline as a single tool call.
	agent.registerTool({
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to the CodingOrchestrator (Kartru). " +
				"Runs a full autonomous pipeline: Plan → Branch → Execute → Validate → Review → Commit. " +
				"Use this for substantial coding tasks that benefit from structured execution, " +
				"git safety nets, validation, and self-review. Returns a detailed result with " +
				"files modified, validation status, review issues, and usage stats.",
			inputSchema: {
				type: "object",
				properties: {
					task: { type: "string", description: "The coding task to accomplish." },
					mode: { type: "string", enum: ["full", "execute", "plan-only"], description: "Execution mode. Default: full" },
					createBranch: { type: "boolean", description: "Create a git feature branch. Default: true" },
					autoCommit: { type: "boolean", description: "Auto-commit on success. Default: true" },
					selfReview: { type: "boolean", description: "Run self-review after coding. Default: true" },
				},
				required: ["task"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<import("@chitragupta/core").ToolResult> {
			const task = String(args.task ?? "");
			if (!task) return { content: "Error: task is required", isError: true };

			try {
				const { setupFromAgent, createCodingOrchestrator } = await import("./coding-setup.js");

				const setup = await setupFromAgent(agent, projectPath);
				if (!setup) return { content: "Error: No provider available", isError: true };

				const orchestrator = await createCodingOrchestrator({
					setup,
					projectPath,
					mode: (args.mode as "full" | "execute" | "plan-only") ?? "full",
					modelId: agent.getState().model,
					createBranch: args.createBranch != null ? Boolean(args.createBranch) : undefined,
					autoCommit: args.autoCommit != null ? Boolean(args.autoCommit) : undefined,
					selfReview: args.selfReview != null ? Boolean(args.selfReview) : undefined,
				});

				const result = await orchestrator.run(task);

				const { formatOrchestratorResult } = await import("./modes/mcp-server.js");
				return { content: formatOrchestratorResult(result) };
			} catch (err) {
				return { content: `coding_agent failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
			}
		},
	});

	// ─── 10b. Register agent with KaalaBrahma lifecycle manager ──────
	if (kaala) {
		try {
			kaala.registerAgent({
				agentId: agent.id,
				lastBeat: Date.now(),
				startedAt: Date.now(),
				turnCount: 0,
				tokenUsage: 0,
				status: "alive",
				parentId: null,
				depth: 0,
				purpose: "root CLI agent",
				tokenBudget: 200_000,
			});
			kaala.recordHeartbeat(agent.id);
		} catch {
			// Silently skip: lifecycle registration is best-effort
		}
	}

	// ─── 11. Handle session continuation ────────────────────────────────
	let session: Session | undefined;

	if (args.continue) {
		// Continue the most recent session
		const sessions = listSessions(projectPath);
		if (sessions.length > 0) {
			const lastMeta = sessions[0]; // Already sorted by most recent
			try {
				session = loadSession(lastMeta.id, projectPath);
				// Replay session turns into agent state
				replaySessionIntoAgent(agent, session);
			} catch {
				process.stderr.write(
					`\nWarning: Could not load last session. Starting fresh.\n\n`,
				);
			}
		}
	} else if (args.resume) {
		// Show session picker
		const sessions = listSessions(projectPath);
		if (sessions.length === 0) {
			process.stderr.write(
				`\nNo sessions found. Starting a new session.\n\n`,
			);
		} else {
			// For now, pick the most recent session
			// A full TUI picker would go here in a more complete implementation
			process.stdout.write(`\nRecent sessions:\n\n`);
			const showCount = Math.min(sessions.length, 10);
			for (let i = 0; i < showCount; i++) {
				const s = sessions[i];
				process.stdout.write(`  ${i + 1}. ${s.title} (${s.id}) — ${s.updated}\n`);
			}
			process.stdout.write(`\nContinuing most recent session: ${sessions[0].title}\n\n`);

			try {
				session = loadSession(sessions[0].id, projectPath);
				replaySessionIntoAgent(agent, session);
			} catch {
				process.stderr.write(
					`\nWarning: Could not load session. Starting fresh.\n\n`,
				);
			}
		}
	}

	if (!session) {
		// Create a new session
		session = createSession({
			project: projectPath,
			agent: profile.id,
			model: modelId,
			title: args.prompt ? args.prompt.slice(0, 60) : "New Session",
		});
	}

	// ─── 11a. Pratyabhijna recognition on session start ──────────────
	try {
		const { Pratyabhijna: PratyabhijnaCls } = await import("@chitragupta/anina");
		const { DatabaseManager } = await import("@chitragupta/smriti");

		const pratyabhijna = new PratyabhijnaCls();
		const agentAny = agent as unknown as Record<string, (...a: unknown[]) => unknown>;
		const chetana = typeof agentAny.getChetana === "function" ? agentAny.getChetana() : undefined;
		const db = DatabaseManager.instance();
		const ctx = pratyabhijna.recognize(
			session.meta.id,
			projectPath,
			db,
			chetana as Parameters<typeof pratyabhijna.recognize>[3],
		);

		log.info(`Pratyabhijna: recognized self in ${ctx.warmupMs.toFixed(1)}ms`, {
			globalVasanas: ctx.globalVasanas.length,
			projectVasanas: ctx.projectVasanas.length,
			samskaras: ctx.activeSamskaras.length,
		});
	} catch {
		// Silently skip: Pratyabhijna recognition is best-effort
	}

	// ─── 11b. Start Nidra daemon ──────────────────────────────────────
	if (nidraDaemon) {
		try {
			nidraDaemon.start();
			log.info("Nidra daemon started");
		} catch {
			// Silently skip: Nidra start is best-effort
		}
	}

	// ─── 12. Register cleanup on exit ────────────────────────────────
	const shutdownAll = async () => {
		// Stop skill watchers
		for (const fn of mcpSkillWatcherCleanups) { try { fn(); } catch { /* best-effort */ } }
		if (nidraDaemon) {
			try { await nidraDaemon.stop(); } catch { /* best-effort */ }
		}
		// Persist Rta audit log before shutdown
		if (rtaEngine) {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				rtaEngine.persistAuditLog(DatabaseManager.instance().get("agent"));
			} catch { /* best-effort */ }
		}
		// Dispose the root agent (releases internal resources, nulls infrastructure refs)
		try { agent.dispose(); } catch { /* best-effort */ }
		sandeshaRouter?.destroy();
		commHubDestroy?.();
		actorSystemShutdown?.();
		kaala?.dispose();
		messageBus?.destroy();
		if (mcpShutdown) await mcpShutdown();
	};

	process.on("beforeExit", () => { shutdownAll().catch((e) => { log.debug("shutdown failed on beforeExit", { error: String(e) }); }); });
	process.on("SIGINT", () => {
		shutdownAll().catch((e) => { log.debug("shutdown failed on SIGINT", { error: String(e) }); }).finally(() => process.exit(0));
	});

	// ─── 13. Launch the appropriate mode ────────────────────────────────
	if (args.print) {
		const prompt = args.prompt;
		if (!prompt) {
			process.stderr.write(
				`\nError: Print mode requires a prompt.\n` +
				`Usage: chitragupta -p "your prompt"\n\n`,
			);
			process.exit(1);
		}

		// Smaran: inject recalled memories for print-mode prompt
		let printPrompt = prompt;
		if (memoryBridge) {
			try {
				const memResponse = memoryBridge.handleMemoryCommand(prompt, session.meta.id);
				if (memResponse !== null) {
					process.stdout.write(memResponse + "\n");
					await shutdownAll();
					process.exit(0);
				}
				const recallContext = memoryBridge.recallForQuery(prompt);
				if (recallContext) {
					printPrompt = `[Recalled memories]\n${recallContext}\n\n[User message]\n${prompt}`;
				}
			} catch {
				// Memory operations in print mode are best-effort
			}
		}

		const exitCode = await runPrintMode({ agent, prompt: printPrompt });

		// Save print-mode result to session
		try {
			await addTurn(session.meta.id, projectPath, {
				turnNumber: 0, // turnNumber auto-assigned by smriti
				role: "user",
				content: prompt,
				agent: profile.id,
				model: modelId,
			});
			const lastMsg = agent.getMessages().at(-1);
			if (lastMsg) {
				const text = lastMsg.content
					.filter((p: { type: string }): p is { type: "text"; text: string } => p.type === "text")
					.map((p: { type: "text"; text: string }) => p.text)
					.join("");
				const contentParts = lastMsg.role === "assistant"
					? lastMsg.content as unknown as Array<Record<string, unknown>>
					: undefined;
				await addTurn(session.meta.id, projectPath, {
					turnNumber: 0,
					role: "assistant",
					content: text,
					contentParts,
					agent: profile.id,
					model: modelId,
				});
			}
		} catch {
			// Silently skip: session save is best-effort
		}

		await shutdownAll();
		process.exit(exitCode);
	} else {
		// Interactive mode
		await runInteractiveMode({
			agent,
			profile,
			project,
			initialPrompt: args.prompt,
			budgetConfig: settings.budget,
			session: { id: session.meta.id, project: projectPath },
			margaPipeline,
			turiyaRouter: turiyaRouter as any,
			manas,
			soulManager,
			reflector,
			providerRegistry: registry,
			userExplicitModel: Boolean(args.model),
			shiksha: shikshaController,
			memoryBridge,
			kaala: kaala ? {
				getTree: () => {
					try {
						const health = kaala!.getTreeHealth();
						return health.agents.map((a) => ({
							agentId: a.id,
							status: a.status,
							depth: a.depth,
							parentId: a.parentId,
							purpose: a.purpose,
							lastBeatAge: a.lastBeatAge,
							tokenUsage: a.tokenUsage,
							tokenBudget: a.tokenBudget,
						}));
					} catch {
						return [];
					}
				},
			} : undefined,
			// VidyaOrchestrator is duck-typed in interactive.ts (lines 155-159) to avoid
			// hard dependency on vidhya-skills. The actual VidyaOrchestrator is structurally
			// compatible with the expected interface. Using `as any` to avoid repeating
			// the full interface signature here.
			vidyaOrchestrator: vidyaOrchestrator as any,
			nidraDaemon: nidraDaemon ? {
				snapshot: () => nidraDaemon!.snapshot(),
				wake: () => nidraDaemon!.wake(),
			} : undefined,
			onTurnComplete: (userMsg, assistantMsg) => {
				// Touch Nidra daemon on user activity to reset idle timer
				if (nidraDaemon) {
					try { nidraDaemon.touch(); } catch { /* best-effort */ }
				}
				try {
					addTurn(session!.meta.id, projectPath, {
						turnNumber: 0,
						role: "user",
						content: userMsg,
						agent: profile.id,
						model: modelId,
					}).catch((e) => { log.debug("user turn save failed", { error: String(e) }); });
					// Capture full content parts from the agent's last message for faithful replay
					const lastMsg = agent.getMessages().at(-1);
					const contentParts = lastMsg?.role === "assistant"
						? lastMsg.content as unknown as Array<Record<string, unknown>>
						: undefined;
					addTurn(session!.meta.id, projectPath, {
						turnNumber: 0,
						role: "assistant",
						content: assistantMsg,
						contentParts,
						agent: profile.id,
						model: modelId,
					}).catch((e) => { log.debug("assistant turn save failed", { error: String(e) }); });
				} catch {
					// Silently skip: session save is best-effort
				}
				// Auto-checkpoint
				if (checkpointManager && session) {
					try {
						checkpointManager.save(session.meta.id, {
							version: 1,
							sessionId: session.meta.id,
							turns: [...agent.getMessages()],
							metadata: {
								model: modelId,
								profile: profile.id,
							},
							timestamp: Date.now(),
						}).catch((e) => { log.debug("checkpoint save failed", { error: String(e) }); });
					} catch {
						// Silently skip: checkpoint is best-effort
					}
				}
			},
		});

		// ─── Post-session: Persist Turiya learned state ──────────────────
		if (turiyaRouter) {
			try {
				const turiyaStatePath = path.join(getChitraguptaHome(), "turiya-state.json");
				fs.writeFileSync(turiyaStatePath, JSON.stringify(turiyaRouter.serialize()), "utf8");
				const stats = turiyaRouter.getStats();
				if (stats.totalRequests > 0) {
					log.info("Turiya state saved", {
						requests: stats.totalRequests,
						savings: `${stats.savingsPercent.toFixed(1)}%`,
					});
				}
			} catch {
				// Turiya persistence is best-effort
			}
		}

		// ─── Post-session: Memory Consolidation (Samskaara) ────────────────
		// Run consolidation with a 5-second timeout so it never hangs the exit.
		const CONSOLIDATION_TIMEOUT_MS = 5_000;

		try {
			const consolidationWork = async () => {
				const { ConsolidationEngine } = await import("@chitragupta/smriti");

				const consolidator = new ConsolidationEngine();
				consolidator.load();

				// Consolidate the last 5 sessions (including current)
				const recentMetas = listSessions(projectPath).slice(0, 5);
				const recentSessions: Session[] = [];
				for (const meta of recentMetas) {
					try {
						const s = loadSession(meta.id, projectPath);
						if (s) recentSessions.push(s);
					} catch {
						// Skip unloadable sessions
					}
				}

				if (recentSessions.length > 0) {
					const result = consolidator.consolidate(recentSessions);
					consolidator.decayRules();
					consolidator.pruneRules();
					consolidator.save();

					if (result.newRules.length > 0) {
						process.stderr.write(
							`\n  \u2726 Samskaara: Learned ${result.newRules.length} new rule${result.newRules.length > 1 ? "s" : ""} from this session.\n`,
						);
					}
				}
			};

			await Promise.race([
				consolidationWork(),
				new Promise<void>((resolve) => setTimeout(resolve, CONSOLIDATION_TIMEOUT_MS)),
			]);
		} catch {
			// Silently skip: consolidation is best-effort
		}

		// ─── Clean shutdown ─────────────────────────────────────────────────
		await shutdownAll();
		process.exit(0);
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Replay session turns into the agent's state to resume a conversation.
 *
 * Converts each session turn into an AgentMessage and pushes it into
 * the agent's internal message history.
 */
function replaySessionIntoAgent(agent: Agent, session: Session): void {
	for (const turn of session.turns) {
		const role = turn.role === "user" ? "user" : "assistant";
		// Prefer full content parts when available, fall back to text-only
		const content = turn.contentParts?.length
			? turn.contentParts
			: [{ type: "text" as const, text: turn.content }];

		agent.pushMessage({
			id: crypto.randomUUID(),
			role: role as "user" | "assistant",
			content: content as unknown as AgentMessage["content"],
			timestamp: Date.now(),
			agentId: turn.agent,
			model: turn.model,
		});
	}
}
