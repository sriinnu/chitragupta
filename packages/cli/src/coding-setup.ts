/**
 * @chitragupta/cli — Shared coding agent setup.
 *
 * Extracts the duplicated provider / policy engine / tools / context setup
 * used by all four coding agent surfaces:
 *   - MCP tool (mcp-server.ts)
 *   - TUI tool (main.ts)
 *   - TUI slash command (interactive-commands.ts)
 *   - Standalone CLI (code.ts)
 *
 * Centralizes the setup so changes propagate to all surfaces.
 */

import type { ToolHandler, ToolResult } from "@chitragupta/core";
import type { ProviderDefinition } from "@chitragupta/swara";
import type { CodingOrchestratorConfig, CodingAgentEvent, OrchestratorResult, OrchestratorProgress } from "@chitragupta/anina";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Policy engine adapter expected by the orchestrator. */
export interface CodingPolicyEngine {
	check(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string };
}

/** Everything needed to create a CodingOrchestrator. */
export interface CodingSetup {
	providerId: string;
	provider: ProviderDefinition;
	tools: ToolHandler[];
	additionalContext?: string;
	policyEngine?: CodingPolicyEngine;
	/** Samiti for ambient channel broadcasts. Threaded to all sub-agents. */
	samiti?: import("@chitragupta/anina").MeshSamiti;
	/** Lokapala guardians for tool call scanning. Threaded to all sub-agents. */
	lokapala?: import("@chitragupta/anina").LokapalaGuardians;
	/** ActorSystem for P2P mesh communication. Threaded to all sub-agents. */
	actorSystem?: import("@chitragupta/anina").MeshActorSystem;
	/** KaalaBrahma lifecycle manager. Threaded to all sub-agents. */
	kaala?: import("@chitragupta/anina").KaalaLifecycle;
	/** Coding defaults from settings.json. */
	codingDefaults?: {
		mode?: "full" | "execute" | "plan-only";
		createBranch?: boolean;
		autoCommit?: boolean;
		selfReview?: boolean;
		timeout?: number;
		branchPrefix?: string;
		provider?: string;
		model?: string;
	};
}

/** Options for setupCodingEnvironment(). */
export interface CodingSetupOptions {
	/** Project root directory. */
	projectPath: string;
	/** Explicit provider override. */
	explicitProvider?: string;
	/** Session ID for policy context (e.g. "coding-mcp", "coding-tui"). */
	sessionId?: string;
	/** External Samiti instance to inject (avoids creating a new one). */
	samiti?: import("@chitragupta/anina").MeshSamiti;
}

/** Options for creating a CodingOrchestrator from a setup. */
export interface CreateOrchestratorOptions {
	setup: CodingSetup;
	projectPath: string;
	mode?: "full" | "execute" | "plan-only";
	modelId?: string;
	createBranch?: boolean;
	autoCommit?: boolean;
	selfReview?: boolean;
	timeoutMs?: number;
	onProgress?: (progress: OrchestratorProgress) => void;
	/** Coding agent event callback for streaming tool calls, thinking, etc. */
	onCodingEvent?: (event: CodingAgentEvent) => void;
}

// ─── Provider Setup ─────────────────────────────────────────────────────────

/**
 * Set up provider, tools, context, and policy engine for a coding agent run.
 * Call this once per invocation. Returns null if no provider is available.
 */
export async function setupCodingEnvironment(
	options: CodingSetupOptions,
): Promise<CodingSetup | null> {
	const { projectPath, explicitProvider, sessionId = "coding-agent" } = options;

	// ── Provider ──────────────────────────────────────────────────
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const { createProviderRegistry } = await import("@chitragupta/swara/provider-registry");
	const {
		loadCredentials,
		registerBuiltinProviders,
		registerCLIProviders,
		resolvePreferredProvider,
		getBuiltinTools,
		loadProjectMemory,
	} = await import("./bootstrap.js");

	loadCredentials();
	const settings = loadGlobalSettings();
	const registry = createProviderRegistry();
	await registerCLIProviders(registry);
	registerBuiltinProviders(registry, settings);

	const resolved = resolvePreferredProvider(explicitProvider, settings, registry);
	if (!resolved) return null;

	// ── Tools ────────────────────────────────────────────────────
	const tools = getBuiltinTools();

	// ── Project context & memory ─────────────────────────────────
	const contextParts: string[] = [];

	try {
		const { loadContextFiles, buildContextString } = await import("./context-files.js");
		const contextFiles = loadContextFiles(projectPath);
		const contextString = buildContextString(contextFiles);
		if (contextString) contextParts.push(contextString);
	} catch { /* context files are optional */ }

	const memory = loadProjectMemory(projectPath);
	if (memory) contextParts.push(`--- Project Memory ---\n${memory}`);

	const additionalContext = contextParts.length > 0 ? contextParts.join("\n\n") : undefined;

	// ── Policy engine (dharma) ───────────────────────────────────
	const { createPolicyAdapter, createMeshInfrastructure } = await import("./shared-factories.js");

	const policyEngine = await createPolicyAdapter({
		sessionId,
		agentId: "kartru",
		projectPath,
	});

	// ── Mesh infrastructure (Samiti, Lokapala, ActorSystem, KaalaBrahma) ──
	const mesh = await createMeshInfrastructure({ samiti: options.samiti });

	return {
		providerId: resolved.providerId,
		provider: resolved.provider,
		tools,
		additionalContext,
		policyEngine,
		samiti: mesh.samiti,
		lokapala: mesh.lokapala,
		actorSystem: mesh.actorSystem,
		kaala: mesh.kaala,
		codingDefaults: settings.coding,
	};
}

// ─── Orchestrator Factory ───────────────────────────────────────────────────

/**
 * Create a fully-wired CodingOrchestrator from a setup.
 * Handles provider injection and all config wiring.
 */
export async function createCodingOrchestrator(
	options: CreateOrchestratorOptions,
): Promise<import("@chitragupta/anina").CodingOrchestrator> {
	const { CodingOrchestrator } = await import("@chitragupta/anina");

	// Merge: explicit options → settings.coding → hardcoded defaults
	const cd = options.setup.codingDefaults ?? {};

	const orchestrator = new CodingOrchestrator({
		workingDirectory: options.projectPath,
		mode: options.mode ?? cd.mode ?? "full",
		providerId: options.setup.providerId,
		modelId: options.modelId ?? cd.model,
		tools: options.setup.tools,
		provider: options.setup.provider,
		policyEngine: options.setup.policyEngine,
		actorSystem: options.setup.actorSystem,
		samiti: options.setup.samiti,
		lokapala: options.setup.lokapala,
		kaala: options.setup.kaala,
		additionalContext: options.setup.additionalContext,
		timeoutMs: options.timeoutMs ?? (cd.timeout ? cd.timeout * 1000 : 5 * 60 * 1000),
		onProgress: options.onProgress,
		onCodingEvent: options.onCodingEvent,
		createBranch: options.createBranch ?? cd.createBranch,
		autoCommit: options.autoCommit ?? cd.autoCommit,
		selfReview: options.selfReview ?? cd.selfReview,
		branchPrefix: cd.branchPrefix,
	});

	return orchestrator;
}

// ─── Shortcut: Setup from existing agent ────────────────────────────────────

/**
 * Create a CodingSetup by borrowing the provider from an existing Agent.
 * Used by the TUI tool and /code slash command where a live agent is available.
 */
export async function setupFromAgent(
	agent: { getProvider(): ProviderDefinition | null; getState(): { providerId: string; model: string } },
	projectPath: string,
): Promise<CodingSetup | null> {
	const provider = agent.getProvider();
	if (!provider) return null;

	const { getBuiltinTools, loadProjectMemory } = await import("./bootstrap.js");
	const tools = getBuiltinTools();

	// Project context
	const contextParts: string[] = [];
	try {
		const { loadContextFiles, buildContextString } = await import("./context-files.js");
		const contextFiles = loadContextFiles(projectPath);
		const contextString = buildContextString(contextFiles);
		if (contextString) contextParts.push(contextString);
	} catch { /* optional */ }

	const memory = loadProjectMemory(projectPath);
	if (memory) contextParts.push(`--- Project Memory ---\n${memory}`);

	// Policy engine
	const { createPolicyAdapter, createMeshInfrastructure } = await import("./shared-factories.js");

	const policyEngine = await createPolicyAdapter({
		sessionId: "coding-tui",
		agentId: "kartru",
		projectPath,
	});

	// Mesh infrastructure (Samiti, Lokapala, ActorSystem, KaalaBrahma)
	const mesh = await createMeshInfrastructure();

	// Load coding defaults from settings
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();

	return {
		providerId: agent.getState().providerId,
		provider,
		tools,
		additionalContext: contextParts.length > 0 ? contextParts.join("\n\n") : undefined,
		policyEngine,
		samiti: mesh.samiti,
		lokapala: mesh.lokapala,
		actorSystem: mesh.actorSystem,
		kaala: mesh.kaala,
		codingDefaults: settings.coding,
	};
}
