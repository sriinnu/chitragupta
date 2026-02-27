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
 *
 * Implementation is split across:
 *   - main-subcommands.ts — daemon/swapna subcommand handlers
 *   - main-serve-mode.ts  — serve command (HTTP API server)
 *   - main-tui-wiring.ts  — TUI mode infrastructure wiring
 *   - main-session.ts     — session handling, mode launch, post-session hooks
 */

import fs from "fs";
import path from "path";

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
import { Agent, Manas } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage } from "@chitragupta/anina";

import type { ParsedArgs } from "./args.js";
import { detectProject } from "./project-detector.js";
import { buildSystemPrompt } from "./personality.js";
import { loadContextFiles } from "./context-files.js";
import { isFirstRun, runOnboarding } from "./onboarding.js";
import { loadPlugins } from "./plugin-loader.js";
import type { PluginRegistry } from "./plugin-loader.js";

import {
	loadCustomProfiles,
	loadCredentials,
	registerBuiltinProviders,
	registerCLIProviders,
	formatProviderSummary,
	resolvePreferredProvider,
} from "./bootstrap.js";
import { guideProviderSetup } from "./provider-setup.js";

import { handleDaemonCommand, handleSwapnaCommand } from "./main-subcommands.js";
import { handleServeCommand } from "./main-serve-mode.js";
import { wireTuiInfrastructure } from "./main-tui-wiring.js";
import {
	resolveSession,
	runPratyabhijna,
	launchInteractiveMode,
	launchPrintMode,
	runPostSessionHooks,
	buildShutdownFn,
} from "./main-session.js";

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

	const globalConfig = createConfig("global", settings as unknown as Record<string, unknown>);
	const projConfig = createConfig("project", projectConfig);
	const config = cascadeConfigs(globalConfig, projConfig);

	// ─── 4. Resolve agent profile ───────────────────────────────────────
	const profileId = args.profile ?? settings.agentProfile ?? "chitragupta";
	const customProfiles = loadCustomProfiles();
	const profile = resolveProfile(profileId, customProfiles) ?? BUILT_IN_PROFILES["chitragupta"];

	// ─── 5. Initialize provider registry ────────────────────────────────
	const registry = createProviderRegistry();
	const cliResults = await registerCLIProviders(registry);
	const detectedCLIs = cliResults.filter((c) => c.available);
	registerBuiltinProviders(registry, settings);

	// Check Ollama availability
	let hasOllama = false;
	try {
		const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
		const probe = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
		hasOllama = probe.ok;
	} catch { /* Ollama not running */ }

	const activeApiKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"]
		.filter((k) => !!process.env[k]);

	const totalProviders = detectedCLIs.length + (hasOllama ? 1 : 0) + activeApiKeys.length;
	if (totalProviders === 0) {
		// No providers found — guide the user through setup
		const setupResult = await guideProviderSetup(registry, cliResults, hasOllama);
		if (!setupResult.configured) {
			process.stderr.write(
				`\nError: No provider available.\n` +
				`Install a CLI (claude, codex, gemini), start Ollama, or set an API key.\n` +
				`Run: chitragupta provider add anthropic\n\n`,
			);
			process.exit(1);
		}
		log.info("Provider configured via setup guide", { providerId: setupResult.providerId });
	} else if (detectedCLIs.length > 0) {
		log.info("CLI providers detected", {
			clis: detectedCLIs.map((c) => `${c.command}${c.version ? ` (${c.version})` : ""}`).join(", "),
		});
	}

	// ─── 5a. Wire MargaPipeline ─────────────────────────────────────────
	let margaPipeline: MargaPipelineType | undefined;
	try {
		const { MargaPipeline, HYBRID_BINDINGS } = await import("@chitragupta/swara");
		margaPipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS, autoEscalate: true, maxEscalations: 2 });
	} catch (e) { log.debug("MargaPipeline unavailable", { error: String(e) }); }

	// ─── 5a-ii. Wire TuriyaRouter ───────────────────────────────────────
	let turiyaRouter: TuriyaRouter | undefined;
	try {
		turiyaRouter = new TuriyaRouter({ linucbAlpha: 0.5 });
		const turiyaStatePath = path.join(getChitraguptaHome(), "turiya-state.json");
		if (fs.existsSync(turiyaStatePath)) {
			turiyaRouter.deserialize(JSON.parse(fs.readFileSync(turiyaStatePath, "utf8")));
			log.info("Turiya state restored", { plays: turiyaRouter.getStats().totalRequests });
		}
	} catch (e) { log.debug("TuriyaRouter unavailable", { error: String(e) }); }

	// ─── 5a-iii. Wire Manas ─────────────────────────────────────────────
	let manas: Manas | undefined;
	try { manas = new Manas(); } catch (e) { log.debug("Manas unavailable", { error: String(e) }); }

	// ─── 5b. Handle subcommands ─────────────────────────────────────────
	if (args.command === "daemon") {
		await handleDaemonCommand(args.subcommand);
	}

	if (args.command === "swapna") {
		await handleSwapnaCommand(projectPath, args.subcommand);
	}

	if (args.command === "serve") {
		await handleServeCommand({
			args: { port: args.port, host: args.host, noTls: args.noTls, provider: args.provider, model: args.model },
			settings, profile, registry, project, projectPath, turiyaRouter,
		});
		return;
	}

	// ─── 6. Determine provider and model ────────────────────────────────
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

	// ─── 7. Wire TUI infrastructure ─────────────────────────────────────
	const wiring = await wireTuiInfrastructure(projectPath, profile, args.noMemory);

	// ─── 8. Build system prompt ─────────────────────────────────────────
	let enrichedContext = wiring.memoryContext
		? (wiring.skillContext ? wiring.memoryContext + "\n\n" + wiring.skillContext : wiring.memoryContext)
		: wiring.skillContext;
	if (wiring.soulPrompt) {
		enrichedContext = enrichedContext ? enrichedContext + "\n\n" + wiring.soulPrompt : wiring.soulPrompt;
	}

	const systemPrompt = buildSystemPrompt({
		profile, project, contextFiles: loadContextFiles(projectPath),
		memoryContext: enrichedContext, identityContext: wiring.identityContext,
		tools: wiring.tools,
	});

	// ─── 9. Resolve thinking level ──────────────────────────────────────
	const thinkingLevel: ThinkingLevel = profile.preferredThinking ?? settings.thinkingLevel ?? "medium";

	// ─── 10. Create the agent ───────────────────────────────────────────
	const agentConfig: AgentConfig = {
		profile, providerId, model: modelId, tools: wiring.tools,
		systemPrompt, thinkingLevel, workingDirectory: projectPath,
		policyEngine: wiring.policyAdapter, commHub: wiring.commHub,
		actorSystem: wiring.actorSystem, samiti: wiring.samiti,
		lokapala: wiring.lokapala,
		kaala: wiring.kaala as unknown as import("@chitragupta/anina").KaalaLifecycle | undefined,
		enableLearning: true, enableAutonomy: true, enableMemory: true,
		project: projectPath,
		chetanaConfig: { triguna: { enabled: true } },
		onEvent: wiring.trigunaActuator
			? (event, data) => { if (event.startsWith("triguna:")) { wiring.trigunaActuator!.handleEvent(event, data); } }
			: undefined,
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// ─── 10a. Load plugins ──────────────────────────────────────────────
	try {
		const pluginRegistry = await loadPlugins();
		for (const pluginTool of pluginRegistry.tools) { agent.registerTool(pluginTool); }
	} catch { /* best-effort */ }

	// ─── 10a-ii. Register coding_agent tool ─────────────────────────────
	agent.registerTool({
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to the CodingOrchestrator (Kartru). " +
				"Runs a full autonomous pipeline: Plan → Branch → Execute → Validate → Review → Commit.",
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
		async execute(execArgs: Record<string, unknown>): Promise<import("@chitragupta/core").ToolResult> {
			const task = String(execArgs.task ?? "");
			if (!task) return { content: "Error: task is required", isError: true };
			try {
				const { setupFromAgent, createCodingOrchestrator } = await import("./coding-setup.js");
				const setup = await setupFromAgent(agent, projectPath);
				if (!setup) return { content: "Error: No provider available", isError: true };
				const orchestrator = await createCodingOrchestrator({
					setup, projectPath, mode: (execArgs.mode as "full" | "execute" | "plan-only") ?? "full",
					modelId: agent.getState().model,
					createBranch: execArgs.createBranch != null ? Boolean(execArgs.createBranch) : undefined,
					autoCommit: execArgs.autoCommit != null ? Boolean(execArgs.autoCommit) : undefined,
					selfReview: execArgs.selfReview != null ? Boolean(execArgs.selfReview) : undefined,
				});
				const result = await orchestrator.run(task);
				const { formatOrchestratorResult } = await import("./modes/mcp-server.js");
				return { content: formatOrchestratorResult(result) };
			} catch (err) {
				return { content: `coding_agent failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
			}
		},
	});

	// ─── 10b. Register agent with KaalaBrahma ───────────────────────────
	if (wiring.kaala) {
		try {
			wiring.kaala.registerAgent({
				agentId: agent.id, lastBeat: Date.now(), startedAt: Date.now(),
				turnCount: 0, tokenUsage: 0, status: "alive", parentId: null,
				depth: 0, purpose: "root CLI agent", tokenBudget: 200_000,
			});
			wiring.kaala.recordHeartbeat(agent.id);
		} catch { /* best-effort */ }
	}

	// ─── 11. Handle session ─────────────────────────────────────────────
	const session = resolveSession({ projectPath, profile, modelId, agent, args });

	await runPratyabhijna(agent, session.meta.id, projectPath);

	if (wiring.nidraDaemon) { try { wiring.nidraDaemon.start(); log.info("Nidra daemon started"); } catch { /* best-effort */ } }

	// ─── 12. Register cleanup ───────────────────────────────────────────
	const shutdownAll = buildShutdownFn(agent, wiring);

	process.on("beforeExit", () => { shutdownAll().catch((e) => { log.debug("shutdown failed on beforeExit", { error: String(e) }); }); });
	process.on("SIGINT", () => {
		shutdownAll().catch((e) => { log.debug("shutdown failed on SIGINT", { error: String(e) }); }).finally(() => process.exit(0));
	});

	// ─── 13. Launch mode ────────────────────────────────────────────────
	if (args.print) {
		if (!args.prompt) {
			process.stderr.write(`\nError: Print mode requires a prompt.\nUsage: chitragupta -p "your prompt"\n\n`);
			process.exit(1);
		}
		await launchPrintMode({ agent, profile, session, modelId, projectPath, prompt: args.prompt, wiring, shutdownAll });
	} else {
		await launchInteractiveMode({
			agent, profile, project, session, modelId, projectPath,
			args: { prompt: args.prompt, model: args.model },
			wiring, margaPipeline, turiyaRouter, manas, registry, settings,
		});

		await runPostSessionHooks(turiyaRouter, projectPath);
		await shutdownAll();
		process.exit(0);
	}
}
