/**
 * @chitragupta/cli — Programmatic API.
 *
 * Clean API for consuming Chitragupta as a library.
 * No TUI, no terminal dependencies. Just pure API.
 *
 * Usage:
 *   import { createChitragupta } from "@chitragupta/cli/api";
 *
 *   const chitragupta = await createChitragupta({ provider: "anthropic" });
 *   const response = await chitragupta.prompt("Explain monads");
 *   console.log(response);
 *   await chitragupta.destroy();
 *
 * Implementation is split across:
 *   - api-wiring.ts   — infrastructure wiring (policy, skills, KaalaBrahma, etc.)
 *   - api-instance.ts — ChitraguptaInstance builder (prompt, stream, etc.)
 */

import crypto from "crypto";

import {
	loadGlobalSettings,
	loadProjectConfig,
	createConfig,
	cascadeConfigs,
	resolveProfile,
	BUILT_IN_PROFILES,
	DEFAULT_FALLBACK_MODEL,
} from "@chitragupta/core";
import type { AgentProfile, ThinkingLevel } from "@chitragupta/core";

import { createProviderRegistry } from "@chitragupta/swara/provider-registry";

import { Agent } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage, ToolHandler } from "@chitragupta/anina";

import {
	createSession,
	loadSession,
} from "@chitragupta/smriti/session-store";

import { detectProject } from "./project-detector.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";

import {
	loadCustomProfiles,
	loadCredentials,
	registerBuiltinProviders,
	registerCLIProviders,
	resolvePreferredProvider,
	getBuiltinTools,
} from "./bootstrap.js";

import { wireApiInfrastructure } from "./api-wiring.js";
import { buildInstance } from "./api-instance.js";

// ─── Re-export public types from sub-modules ────────────────────────────────

export type {
	ChitraguptaInstance,
	StreamChunk,
	MemorySearchResult,
	SessionInfo,
	SessionStats,
} from "./api-instance.js";

// ─── Public Types ───────────────────────────────────────────────────────────

export interface ChitraguptaOptions {
	/** AI provider to use. Default: "anthropic" */
	provider?: string;
	/** Model ID. Default: provider's default */
	model?: string;
	/** Agent profile name or custom profile object. Default: "chitragupta" */
	profile?: string | AgentProfile;
	/** Working directory. Default: process.cwd() */
	workingDir?: string;
	/** Session ID to resume. Creates new if omitted. */
	sessionId?: string;
	/** Event handler for streaming events */
	onEvent?: (event: string, data: unknown) => void;
	/** Max cost per session in USD. Abort if exceeded. */
	maxSessionCost?: number;
	/** Thinking level. Default: from settings or "medium" */
	thinkingLevel?: ThinkingLevel;
	/** Disable memory loading entirely */
	noMemory?: boolean;
	/** Skip CLI detection (claude, gemini, codex, aider) — avoids 10-20s probing in MCP subprocess mode. */
	skipCLIDetection?: boolean;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new Chitragupta instance.
 *
 * This is the main entry point for programmatic use. It mirrors the
 * CLI's initialization flow (see main.ts) but WITHOUT any terminal,
 * TUI, or process.stdin/stdout dependencies.
 *
 * @param options - Configuration for the instance.
 * @returns A fully-wired ChitraguptaInstance ready for use.
 *
 * @example
 * ```ts
 * import { createChitragupta } from "@chitragupta/cli/api";
 *
 * const chitragupta = await createChitragupta({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-5-20250929",
 *   workingDir: "/path/to/project",
 * });
 *
 * const answer = await chitragupta.prompt("What does this codebase do?");
 * console.log(answer);
 *
 * for await (const chunk of chitragupta.stream("Explain the architecture")) {
 *   if (chunk.type === "text") process.stdout.write(chunk.data as string);
 * }
 *
 * await chitragupta.destroy();
 * ```
 */
export async function createChitragupta(
	options: ChitraguptaOptions = {},
): Promise<import("./api-instance.js").ChitraguptaInstance> {
	// ─── 1. Load settings and credentials ─────────────────────────────
	loadCredentials();
	const settings = loadGlobalSettings();

	// ─── 2. Detect project ────────────────────────────────────────────
	const projectPath = options.workingDir ?? process.cwd();
	const project = detectProject(projectPath);

	// ─── 3. Load and cascade config ───────────────────────────────────
	let projectConfig: Record<string, unknown> = {};
	try { projectConfig = loadProjectConfig(projectPath); } catch { /* defaults */ }

	const globalConfig = createConfig("global", settings as unknown as Record<string, unknown>);
	const projConfig = createConfig("project", projectConfig);
	cascadeConfigs(globalConfig, projConfig);

	// ─── 4. Resolve agent profile ─────────────────────────────────────
	let profile: AgentProfile;
	if (typeof options.profile === "object" && options.profile !== null) {
		profile = options.profile;
	} else {
		const profileId = (options.profile as string | undefined) ?? settings.agentProfile ?? "chitragupta";
		const customProfiles = loadCustomProfiles();
		profile = resolveProfile(profileId, customProfiles) ?? BUILT_IN_PROFILES["chitragupta"];
	}

	// ─── 5. Initialize provider registry ──────────────────────────────
	const registry = createProviderRegistry();
	if (!options.skipCLIDetection) {
		await registerCLIProviders(registry);
	}
	registerBuiltinProviders(registry, settings);

	const resolved = resolvePreferredProvider(options.provider, settings, registry);
	if (!resolved) {
		const available = registry.getAll().map((p) => p.id).join(", ");
		throw new Error(
			`No provider available. Registered: ${available || "none"}. ` +
			`Install a CLI (claude, codex, gemini), start Ollama, or set an API key.`,
		);
	}
	const { providerId, provider } = resolved;
	const modelId = options.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;

	// ─── 6. Load tools ────────────────────────────────────────────────
	const tools: ToolHandler[] = getBuiltinTools();

	// ─── 7. Create session ────────────────────────────────────────────
	let session;
	if (options.sessionId) {
		try { session = loadSession(options.sessionId, projectPath); }
		catch { session = createSession({ project: projectPath, agent: profile.id, model: modelId, title: "API Session" }); }
	} else {
		session = createSession({ project: projectPath, agent: profile.id, model: modelId, title: "API Session" });
	}

	// ─── 8. Wire infrastructure ───────────────────────────────────────
	const wiring = await wireApiInfrastructure({
		projectPath, tools, sessionId: session.meta.id, noMemory: options.noMemory,
	});

	// ─── 9. Resolve thinking level ────────────────────────────────────
	const thinkingLevel: ThinkingLevel =
		options.thinkingLevel ?? profile.preferredThinking ?? settings.thinkingLevel ?? "medium";

	// ─── 10. Build enriched context ───────────────────────────────────
	const enrichedMemoryContext = wiring.memoryContext
		? (wiring.skillContext ? `${wiring.memoryContext}\n\n${wiring.skillContext}` : wiring.memoryContext)
		: wiring.skillContext;

	const contextFiles = loadContextFiles(projectPath);
	const systemPrompt = buildSystemPrompt({
		profile, project, contextFiles,
		memoryContext: enrichedMemoryContext,
		identityContext: wiring.identityContext,
		tools,
	});

	// ─── 11. Create the agent ─────────────────────────────────────────
	const agentConfig: AgentConfig = {
		profile, providerId, model: modelId, tools, systemPrompt, thinkingLevel,
		workingDirectory: projectPath, policyEngine: wiring.policyAdapter,
		embeddingProvider: wiring.embeddingProvider,
		enableMemory: !options.noMemory, project: projectPath,
		commHub: wiring.commHub, samiti: wiring.samiti,
		lokapala: wiring.lokapala, kaala: wiring.kaala,
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	// Replay turns if resuming a session
	if (options.sessionId && session.turns.length > 0) {
		for (const turn of session.turns) {
			const role = turn.role === "user" ? "user" : "assistant";
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

	// ─── 12. MCP tools (optional) ─────────────────────────────────────
	let mcpShutdown: (() => Promise<void>) | undefined;
	try {
		const { loadMCPConfig, startMCPServers, importMCPTools, shutdownMCPServers } =
			await import("./mcp-loader.js");
		const mcpConfigs = loadMCPConfig();
		if (mcpConfigs.length > 0) {
			const mcpRegistry = await startMCPServers(mcpConfigs);
			const mcpTools = importMCPTools(mcpRegistry);
			for (const mcpTool of mcpTools) {
				agent.registerTool(mcpTool as unknown as ToolHandler);
			}
			mcpShutdown = shutdownMCPServers;
		}
	} catch { /* MCP is optional */ }

	// ─── 13. Build and return the instance ────────────────────────────
	return buildInstance({
		agent, session, profile, providerId, modelId, projectPath,
		maxSessionCost: options.maxSessionCost,
		onEvent: options.onEvent,
		wiring, mcpShutdown,
	});
}

// ─── Re-exports for convenience ─────────────────────────────────────────────

export type { AgentProfile, ThinkingLevel, CostBreakdown } from "@chitragupta/core";
export type { Agent, AgentConfig, AgentMessage, AgentEventType } from "@chitragupta/anina";
