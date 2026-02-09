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
} from "@chitragupta/core";
import type { ThinkingLevel } from "@chitragupta/core";
import { createProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { MargaPipeline as MargaPipelineType } from "@chitragupta/swara";
import { Agent, MemoryBridge } from "@chitragupta/anina";
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
import { SoulManager, ARCHETYPES } from "@chitragupta/anina";
import { AgentReflector } from "@chitragupta/anina";
import { ApprovalGate } from "@chitragupta/dharma";
import { KarmaTracker } from "@chitragupta/dharma";
import { CheckpointManager } from "@chitragupta/smriti";
import { MessageBus } from "@chitragupta/sutra";
import { AgentRegistry as SutraAgentRegistry } from "@chitragupta/sutra";
import { AutonomousOrchestrator } from "@chitragupta/niyanta";

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
	} catch {
		// Silently skip: no project config found or file not parseable — use defaults
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
	registerBuiltinProviders(registry, settings);

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
	} catch {
		// Silently skip: MargaPipeline is optional
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

		// Create the API server with dependency stubs.
		// Agent and session are lazily initialized — the server exposes
		// health, providers, and tools immediately; chat requires a running agent.
		let serverAgent: unknown = null;
		let serverSession: unknown = null;

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
				server.stop().then(resolve).catch(resolve);
			});
		});
		return;
	}

	// Determine provider and model
	const providerId = args.provider ?? settings.defaultProvider ?? "anthropic";
	const modelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? "claude-sonnet-4-5-20250929";

	const provider = registry.get(providerId);
	if (!provider) {
		process.stderr.write(
			`\nError: Provider "${providerId}" not found.\n` +
			`Available providers: ${registry.getAll().map((p) => p.id).join(", ")}\n` +
			`Run \`chitragupta provider list\` to see all providers.\n\n`,
		);
		process.exit(1);
	}

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
	} catch {
		// Silently skip: vidhya-skills is optional
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
	} catch {
		// Silently skip: dharma is optional — @chitragupta/dharma may not be installed
	}

	// ─── 7d. Wire sutra CommHub (IPC for sub-agent communication) ────────
	let commHub: CommHub | undefined;
	let commHubDestroy: (() => void) | undefined;
	try {
		commHub = new CommHub({ enableLogging: false });
		commHubDestroy = () => commHub!.destroy();
	} catch {
		// Silently skip: sutra is optional — @chitragupta/sutra may not be installed
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
	} catch {
		// Silently skip: SandeshaRouter is optional — @chitragupta/sutra may not export it yet
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
	} catch {
		// Silently skip: KaalaBrahma is optional
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
	} catch {
		// Silently skip: NidraDaemon is optional
	}

	// ─── 7f. Wire SoulManager (Agent Identity) ──────────────────────
	let soulManager: InstanceType<typeof SoulManager> | undefined;
	try {
		soulManager = new SoulManager();
	} catch {
		// Silently skip: SoulManager is optional
	}

	// ─── 7g. Wire KarmaTracker (Trust Tracking) ─────────────────────
	let karmaTracker: InstanceType<typeof KarmaTracker> | undefined;
	try {
		karmaTracker = new KarmaTracker();
	} catch {
		// Silently skip: KarmaTracker is optional
	}

	// ─── 7h. Wire MessageBus (Sandesh) ──────────────────────────────
	let messageBus: InstanceType<typeof MessageBus> | undefined;
	try {
		messageBus = new MessageBus();
	} catch {
		// Silently skip: MessageBus is optional
	}

	// ─── 7i. Wire CheckpointManager (Sthiti) ────────────────────────
	let checkpointManager: InstanceType<typeof CheckpointManager> | undefined;
	try {
		const checkpointDir = path.join(getChitraguptaHome(), "checkpoints");
		if (!fs.existsSync(checkpointDir)) {
			fs.mkdirSync(checkpointDir, { recursive: true });
		}
		checkpointManager = new CheckpointManager({ checkpointDir });
	} catch {
		// Silently skip: CheckpointManager is optional
	}

	// ─── 7j. Wire ApprovalGate (Dvaara) into policy adapter ────────
	let approvalGate: InstanceType<typeof ApprovalGate> | undefined;
	try {
		approvalGate = new ApprovalGate({
			defaultTimeout: 30000,
		});
	} catch {
		// Silently skip: ApprovalGate is optional
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

	const systemPrompt = buildSystemPrompt({
		profile,
		project,
		contextFiles,
		memoryContext: memoryContext
			? (skillContext ? memoryContext + "\n\n" + skillContext : memoryContext)
			: skillContext,
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
				turnNumber: 0,
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
