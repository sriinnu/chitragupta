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
		try {
			const { KartavyaEngine } = await import("@chitragupta/niyanta");
			servKartavyaEngine = new KartavyaEngine();
		} catch (e) { log.debug("KartavyaEngine unavailable", { error: String(e) }); }
		try {
			const { KalaChakra } = await import("@chitragupta/smriti");
			servKalaChakra = new KalaChakra();
		} catch (e) { log.debug("KalaChakra unavailable", { error: String(e) }); }

		// ── Vidya Orchestrator (Skill ecosystem) ───────────────────────
		let servVidyaOrchestrator: unknown;
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

			// Load curated Agent Skills from SKILL.md files
			try {
				const { loadAgentSkills } = await import("@chitragupta/vidhya-skills");
				const builtinSkillsDir = path.resolve(
					path.dirname(new URL(import.meta.url).pathname),
					"..", "..", "..", "skills", ".curated",
				);
				for (const dir of [path.resolve(projectPath, "skills", ".curated"), builtinSkillsDir]) {
					const loaded = loadAgentSkills(dir);
					for (const skill of loaded.skills) {
						skillReg.register(skill);
					}
				}
			} catch (e) { log.debug("Curated skill loading failed", { error: String(e) }); }

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
					if (servNidraDaemon) {
						try { await (servNidraDaemon as { stop: () => Promise<void> }).stop(); } catch { /* best-effort */ }
					}
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

		// Load curated Agent Skills from SKILL.md files
		try {
			const { loadAgentSkills } = await import("@chitragupta/vidhya-skills");
			const curatedDir = path.resolve(projectPath, "skills", ".curated");
			// Also check the chitragupta package root for skills shipped with the CLI
			const builtinSkillsDir = path.resolve(
				path.dirname(new URL(import.meta.url).pathname),
				"..", "..", "..", "skills", ".curated",
			);
			for (const dir of [curatedDir, builtinSkillsDir]) {
				const loaded = loadAgentSkills(dir);
				for (const skill of loaded.skills) {
					skillRegistry.register(skill);
				}
				if (loaded.skipped.length > 0) {
					log.debug("Agent skills skipped", { dir, skipped: loaded.skipped });
				}
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

	// ─── 7d. Wire sutra CommHub (IPC for sub-agent communication) ────────
	let commHub: CommHub | undefined;
	let commHubDestroy: (() => void) | undefined;
	try {
		commHub = new CommHub({ enableLogging: false });
		commHubDestroy = () => commHub!.destroy();
	} catch (e) {
		log.debug("CommHub unavailable", { error: String(e) });
	}

	// ─── 7d-ii. Wire SandeshaRouter (Input Routing for sub-agents) ──────
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
	} catch (e) {
		log.debug("KaalaBrahma unavailable", { error: String(e) });
	}

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

		// Deep sleep: run SQLite maintenance
		nidraDaemon.onDeepSleep(async () => {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const db = DatabaseManager.instance().get("agent");
				db.pragma("wal_checkpoint(TRUNCATE)");
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
		enableLearning: true,
		enableAutonomy: true,
		enableMemory: true,
		project: projectPath,
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
				const { CodingOrchestrator } = await import("@chitragupta/anina");

				const parentProvider = agent.getProvider();
				if (!parentProvider) return { content: "Error: No provider available", isError: true };

				const agentState = agent.getState();

				// Get tools from yantra
				const codeTools = getBuiltinTools();

				// Project context
				const ctxParts: string[] = [];
				try {
					const { loadContextFiles, buildContextString } = await import("./context-files.js");
					const ctxFiles = loadContextFiles(projectPath);
					const ctxString = buildContextString(ctxFiles);
					if (ctxString) ctxParts.push(ctxString);
				} catch { /* optional */ }

				const mem = loadProjectMemory(projectPath);
				if (mem) ctxParts.push(`--- Project Memory ---\n${mem}`);

				const orchestrator = new CodingOrchestrator({
					workingDirectory: projectPath,
					mode: (args.mode as "full" | "execute" | "plan-only") ?? "full",
					providerId: agentState.providerId,
					modelId: agentState.model,
					tools: codeTools,
					provider: parentProvider,
					additionalContext: ctxParts.length > 0 ? ctxParts.join("\n\n") : undefined,
					timeoutMs: 5 * 60 * 1000,
					createBranch: args.createBranch != null ? Boolean(args.createBranch) : undefined,
					autoCommit: args.autoCommit != null ? Boolean(args.autoCommit) : undefined,
					selfReview: args.selfReview != null ? Boolean(args.selfReview) : undefined,
				});

				const result = await orchestrator.run(task);

				// Format result as structured text
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
		if (nidraDaemon) {
			try { await nidraDaemon.stop(); } catch { /* best-effort */ }
		}
		sandeshaRouter?.destroy();
		commHubDestroy?.();
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
