/** @chitragupta/cli — MCP Server Mode. Collect tools → apply tiers → create server → start. */

import type { McpToolHandler, ChitraguptaToolHandler } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";
import { McpServer, ToolRegistry, chitraguptaToolToMcp } from "@chitragupta/tantra";

import fs from "fs";
import os from "os";
import path from "path";
import { getBuiltinTools } from "../bootstrap.js";
import { createToolNotFoundResolver } from "../shared-factories.js";
import { CLI_PACKAGE_VERSION } from "../version.js";
import { startHeartbeat } from "./mcp-telemetry.js";
import { applyToolTiers, isCompactMode, getTierStats } from "./mcp-tool-tiers.js";
import { wireExtensionsToMcp } from "./mcp-extension-bridge.js";

import { resetMcpStartedAt, writeChitraguptaState, clearChitraguptaState } from "./mcp-state.js";
import {
	createMemorySearchTool,
	createSessionListTool,
	createSessionShowTool,
	createMargaDecideTool,
	createAgentPromptTool,
	createPromptStatusTool,
} from "./mcp-tools-core.js";
import {
	createSamitiChannelsTool,
	createSamitiBroadcastTool,
	createSabhaDeliberateTool,
	createAkashaTracesTool,
	createAkashaDepositTool,
} from "./mcp-tools-collective.js";
import {
	createVasanaTendenciesTool,
	createHealthStatusTool,
	createAtmanReportTool,
} from "./mcp-tools-introspection.js";
import { createCodingAgentTool } from "./mcp-tools-coding.js";
import {
	createHandoverTool,
	createDayShowTool,
	createDayListTool,
	createDaySearchTool,
	createContextTool,
} from "./mcp-tools-memory.js";
import { createHandoverSinceTool, createMemoryChangesSinceTool } from "./mcp-tools-delta.js";
import {
	createSyncStatusTool,
	createSyncExportTool,
	createSyncImportTool,
	createRecallTool,
	createVidhisTool,
	createConsolidateTool,
} from "./mcp-tools-sync.js";
import {
	createMeshStatusTool,
	createMeshSpawnTool,
	createMeshSendTool,
	createMeshAskTool,
	createMeshFindCapabilityTool,
	createMeshPeersTool,
	createMeshGossipTool,
	createMeshTopologyTool,
} from "./mcp-tools-mesh.js";
import {
	createSkillsFindTool,
	createSkillsListTool,
	createSkillsHealthTool,
	createSkillsLearnTool,
	createSkillsScanTool,
	createSkillsEcosystemTool,
	createSkillsRecommendTool,
} from "./mcp-tools-skills.js";
import { createCompletionTool } from "./mcp-tools-completion.js";
import { createRepoMapTool, createSemanticGraphQueryTool } from "./mcp-tools-netra.js";
import { createAstQueryTool } from "./mcp-tools-ast.js";
import { createEpisodicRecallTool, createEpisodicRecordTool } from "./mcp-tools-episodic.js";
import { createUIExtensionsTool, createWidgetDataTool } from "./mcp-tools-plugins.js";
import { CerebralExpansion, createCerebralExpansionTool, createCerebralHandler } from "./cerebral-expansion.js";
import {
	createMemoryResource,
	createSavePrompt,
	createLastSessionPrompt,
	createRecallPrompt,
	createStatusPrompt,
	createHandoverPrompt,
	createReviewPrompt,
	createDebugPrompt,
	createResearchPrompt,
	createRefactorPrompt,
	createMemorySearchPrompt,
	createSessionPrompt,
} from "./mcp-prompts.js";
import {
	createSystemMetricsResource,
	createPluginEcosystemResource,
	createSystemConfigResource,
	createRecentToolCallsResource,
} from "./mcp-resources.js";
import { McpSessionRecorder } from "./mcp-session.js";
import { triggerSwapnaConsolidation } from "../main-session.js";

// ─── Re-exports (backward compatibility) ─────────────────────────────────────

export { formatOrchestratorResult } from "./mcp-tools-introspection.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface McpServerModeOptions {
	/** Transport: "stdio" for process spawning, "sse" for HTTP. Default: "stdio" */
	transport?: "stdio" | "sse";
	/** Port for SSE transport. Default: 3001 */
	port?: number;
	/** Project path for memory/session context. Default: process.cwd() */
	projectPath?: string;
	/** Server name shown to MCP clients. Default: "chitragupta" */
	name?: string;
	/** Whether to expose the agent prompt tool (requires provider config). Default: false */
	enableAgent?: boolean;
}

function normalizeMcpProjectPath(input: string): string {
	const resolved = path.resolve(input);
	try {
		const real = fs.realpathSync.native(resolved);
		return path.normalize(real);
	} catch {
		return path.normalize(resolved);
	}
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Start the Chitragupta MCP server.
 *
 * Collects tools from built-in + extracted modules, creates the MCP server,
 * sets up session recording, state persistence, graceful shutdown, and
 * auto-starts the daemon for consolidation + skill sync.
 */
export async function runMcpServerMode(options: McpServerModeOptions = {}): Promise<void> {
	const {
		transport = "stdio",
		port = 3001,
		projectPath: rawProjectPath = process.cwd(),
		name = "chitragupta",
		enableAgent = false,
	} = options;
	const projectPath = normalizeMcpProjectPath(rawProjectPath);

	const t0 = performance.now();

	// ─── 1. Collect all tools (fast: object construction only) ───────

	const mcpTools: McpToolHandler[] = [];

	// Convert yantra built-in tools to MCP format
	const builtinTools: ToolHandler[] = getBuiltinTools();
	for (const tool of builtinTools) {
		mcpTools.push(chitraguptaToolToMcp(tool as unknown as ChitraguptaToolHandler));
	}

	// Core tools (memory search, session list/show, routing)
	mcpTools.push(createMemorySearchTool(projectPath));
	mcpTools.push(createSessionListTool(projectPath));
	mcpTools.push(createSessionShowTool(projectPath));
	mcpTools.push(createMargaDecideTool());
	if (enableAgent) {
		mcpTools.push(createAgentPromptTool());
		mcpTools.push(createPromptStatusTool());
	}

	// Memory, handover & day files
	mcpTools.push(createHandoverTool(projectPath));
	mcpTools.push(createHandoverSinceTool(projectPath));
	mcpTools.push(createMemoryChangesSinceTool(projectPath));
	mcpTools.push(createDayShowTool());
	mcpTools.push(createDayListTool());
	mcpTools.push(createDaySearchTool());
	mcpTools.push(createContextTool(projectPath));

	// Coding agent
	mcpTools.push(createCodingAgentTool(projectPath));

	// Collective intelligence (Samiti, Sabha, Akasha)
	mcpTools.push(createSamitiChannelsTool());
	mcpTools.push(createSamitiBroadcastTool());
	mcpTools.push(createSabhaDeliberateTool());
	mcpTools.push(createAkashaTracesTool());
	mcpTools.push(createAkashaDepositTool());

	// Introspection (Vasana, Triguna health, Atman report)
	mcpTools.push(createVasanaTendenciesTool(projectPath));
	mcpTools.push(createHealthStatusTool());
	mcpTools.push(createAtmanReportTool());

	// Sync, recall & consolidation
	mcpTools.push(createSyncStatusTool());
	mcpTools.push(createSyncExportTool(projectPath));
	mcpTools.push(createSyncImportTool());
	mcpTools.push(createRecallTool());
	mcpTools.push(createVidhisTool(projectPath));
	mcpTools.push(createConsolidateTool(projectPath));

	// P2P Actor Mesh (Sutra)
	mcpTools.push(createMeshStatusTool());
	mcpTools.push(createMeshSpawnTool());
	mcpTools.push(createMeshSendTool());
	mcpTools.push(createMeshAskTool());
	mcpTools.push(createMeshFindCapabilityTool());
	mcpTools.push(createMeshPeersTool());
	mcpTools.push(createMeshGossipTool());
	mcpTools.push(createMeshTopologyTool());

	// Vidhya-Skills Pipeline
	mcpTools.push(createSkillsFindTool());
	mcpTools.push(createSkillsListTool());
	mcpTools.push(createSkillsHealthTool());
	mcpTools.push(createSkillsLearnTool());
	mcpTools.push(createSkillsScanTool());
	mcpTools.push(createSkillsEcosystemTool());
	mcpTools.push(createSkillsRecommendTool());

	// Completion Router (provider-agnostic LLM calls)
	mcpTools.push(createCompletionTool());

	// UI Extension Registry (TUI consumer queries)
	mcpTools.push(createUIExtensionsTool());
	mcpTools.push(createWidgetDataTool());

	// Netra — Repo Map + Semantic Graph + AST Query
	mcpTools.push(createRepoMapTool(projectPath));
	mcpTools.push(createSemanticGraphQueryTool(projectPath));
	mcpTools.push(createAstQueryTool(projectPath));

	// Episodic Developer Memory
	mcpTools.push(createEpisodicRecallTool(projectPath));
	mcpTools.push(createEpisodicRecordTool(projectPath));

	// Cerebral Expansion (Wire 2 diagnostic tool)
	const cerebralDiag = new CerebralExpansion();
	mcpTools.push(createCerebralExpansionTool(
		cerebralDiag,
		() => import("./mcp-subsystems.js").then((m) => m.getAkasha()),
		() => import("./mcp-subsystems.js").then((m) => m.getSkillRegistry()),
	));

	// ─── 2. Session recording ───────────────────────────────────────

	const recorder = new McpSessionRecorder(projectPath);
	mcpTools.push(recorder.createRecordConversationTool());

	// ─── 3. Apply tool tiers + Create + START server IMMEDIATELY ────
	//
	// The transport MUST be ready before any file I/O or dynamic imports.
	// MCP clients send `initialize` immediately on spawn — if the stdin
	// listener isn't set up yet, the client times out waiting for a response.

	const finalTools = applyToolTiers(mcpTools);
	const heartbeat = startHeartbeat({ workspace: projectPath, transport });
	heartbeat.update({ model: "mcp" });
	let toolCallCount = 0;

	// ─── 2b. Wire 2 (Cerebral Expansion) + Wire 4 (Learning Persist) ───
	// Basic resolver runs first; if it fails, CerebralExpansion searches
	// Akasha cache + local skill registry (TVM) + Suraksha security scan.

	const learningPersistPath = path.join(os.homedir(), ".chitragupta", "learning", "session-state.json");
	const learningDir = path.dirname(learningPersistPath);
	fs.mkdirSync(learningDir, { recursive: true });

	const cerebralExpansion = new CerebralExpansion();
	const cerebralHandler = createCerebralHandler(
		cerebralExpansion,
		() => import("./mcp-subsystems.js").then((m) => m.getAkasha()),
		() => import("./mcp-subsystems.js").then((m) => m.getSkillRegistry()),
	);

	const toolNotFoundResolver = createToolNotFoundResolver({
		tools: builtinTools,
		onGap: (toolName) => {
			process.stderr.write(`[skill-gap] ${toolName}\n`);
			// Append to learning persist file for cross-session gap tracking
			try {
				const entry = JSON.stringify({ type: "skill-gap", tool: toolName, ts: Date.now() }) + "\n";
				fs.appendFileSync(learningPersistPath, entry);
			} catch { /* best-effort persistence */ }
		},
	});

	const server = new McpServer({
		name,
		version: CLI_PACKAGE_VERSION,
		transport,
		ssePort: port,
		tools: finalTools,
		resources: [createMemoryResource(projectPath)],
		prompts: [
			createSavePrompt(),
			createLastSessionPrompt(),
			createRecallPrompt(),
			createStatusPrompt(),
			createHandoverPrompt(),
			createReviewPrompt(),
			createDebugPrompt(),
			createResearchPrompt(),
			createRefactorPrompt(),
			createMemorySearchPrompt(),
			createSessionPrompt(),
		],
		onToolNotFound: async (toolName, _args) => {
			// Phase 1: Try basic fuzzy/Vidya resolution
			const resolved = await toolNotFoundResolver(toolName);
			if (resolved) {
				return chitraguptaToolToMcp(resolved as unknown as ChitraguptaToolHandler);
			}

			// Phase 2: Cerebral Expansion — autonomous skill discovery + learning
			try {
				const expansion = await cerebralHandler(toolName);
				if (expansion.resolved && expansion.skillName) {
					process.stderr.write(
						`[cerebral] Learned ${toolName} → ${expansion.skillName} ` +
						`(${expansion.source}, confidence=${expansion.confidence.toFixed(3)}). ` +
						`Will be available next session.\n`,
					);
				} else {
					process.stderr.write(
						`[cerebral] No match for "${toolName}" (${expansion.rejectionReason ?? "unknown"})\n`,
					);
				}
			} catch (err) {
				process.stderr.write(
					`[cerebral] Expansion failed for ${toolName}: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			}

			return undefined;
		},
		/**
		 * CPH4 Catalyst — tool_calls persistence fix
		 * Named after the synthetic molecule in Lucy (2014) that triggers
		 * neural expansion. This fix catalyzes downstream learning by ensuring
		 * tool usage data reaches the Swapna consolidation pipeline.
		 *
		 * Previously returned void (fire-and-forget), causing tool_calls
		 * to be lost when the recording promise was orphaned.
		 */
		onToolCall: async (info) => {
			await recorder.recordToolCall(info);
			heartbeat.update({ toolCallCount: ++toolCallCount, lastToolCallAt: Date.now(), state: "busy" });
		},
	});

	await server.start();

	const startupMs = performance.now() - t0;
	const tierInfo = isCompactMode() ? ` ${JSON.stringify(getTierStats(mcpTools))}` : "";
	const sseInfo = transport === "sse" ? ` on port ${port}` : "";
	process.stderr.write(
		`Chitragupta MCP server ready (${transport}${sseInfo}) in ${startupMs.toFixed(0)}ms\n` +
		`  Tools: ${finalTools.length}${tierInfo}  Project: ${projectPath}\n` +
		`  Agent: ${enableAgent ? "enabled" : "disabled"}  Telemetry: pid=${process.pid}\n`,
	);

	// ─── 4. Post-start initialization (non-critical, after transport ready) ───

	// 4a. Register OS integration surface resources
	server.registerResource(createSystemMetricsResource(() => ({ toolCount: mcpTools.length })));
	server.registerResource(createPluginEcosystemResource());
	server.registerResource(createSystemConfigResource(projectPath, transport));
	server.registerResource(createRecentToolCallsResource(() => server.getRecentCalls()));

	// 4b. State file + daemon warm-up (deferred, non-blocking)
	resetMcpStartedAt();
	setImmediate(() => writeChitraguptaState({
		active: true, project: projectPath, lastTool: "(startup)",
		sessionId: null, turnCount: null, filesModified: null,
	}));
	setImmediate(() => void import("./daemon-bridge.js").then(async (m) => {
		await m.getDaemonClient({ autoStart: true });
		process.stderr.write("[daemon] RPC bridge warm\n");
	}).catch((err: unknown) => {
		process.stderr.write(`[daemon] RPC warm-up skipped: ${err instanceof Error ? err.message : String(err)}\n`);
	}));

	// 4c. Dynamic ToolRegistry (runtime tool registration via plugins)
	const registry = new ToolRegistry({ strictNamespaces: true, validateSchemas: true });
	server.attachRegistry(registry);
	(server as unknown as Record<string, unknown>)._toolRegistry = registry;

	// 4c.1 Wire extension system into MCP (tools, hooks, hot-reload)
	wireExtensionsToMcp({ projectPath, toolRegistry: registry, onToolCall: () => {
		heartbeat.update({ lastToolCallAt: Date.now(), state: "busy" });
	} }).then((bridge) => {
		// 4c.2 Wire bash spawn hook using the extension bridge's HookRegistry
		try {
			import("@chitragupta/yantra").then((yan) => {
				yan.setBashSpawnHook((ctx) => bridge.hookRegistry.dispatchBashSpawn(ctx));
			}).catch(() => { /* yantra import optional */ });
		} catch { /* Hook wiring is optional */ }
	}).catch((err: unknown) => {
		process.stderr.write(`[extensions] Wire failed: ${err instanceof Error ? err.message : String(err)}\n`);
	});

	// 4d. EventBridge + MCP notification sink
	try {
		const { EventBridge, McpNotificationSink } = await import("@chitragupta/sutra");
		const eb = new EventBridge();
		eb.addSink(new McpNotificationSink((n) => server.sendNotification(n)));
		(server as unknown as Record<string, unknown>)._eventBridge = eb;
	} catch {
	}

	// 4e. Graceful shutdown — trigger Swapna dream-cycle before exit
	const shutdown = async () => {
		heartbeat.update({ state: "shutting_down" });
		heartbeat.stop();
		triggerSwapnaConsolidation(projectPath);
		clearChitraguptaState();
		try { const { disconnectDaemon } = await import("./daemon-bridge.js"); disconnectDaemon(); } catch { /* best-effort */ }
		await server.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// ─── 5. Auto-start daemon (self-healing, skill sync) ─────────────
	try {
		const { wireDaemon } = await import("./mcp-daemon-wiring.js");
		await wireDaemon({ projectPath, recorder, heartbeat, server, previousShutdown: shutdown });
	} catch (err) {
		process.stderr.write(`[daemon] Auto-start skipped: ${err instanceof Error ? err.message : String(err)}\n`);
	}

	// ─── 6. Wire 5: Bootstrap mesh actors + default soul ─────────────
	try {
		const { bootstrapMeshAndSoul } = await import("./mesh-bootstrap.js");
		await bootstrapMeshAndSoul(server);
		process.stderr.write("[mesh] Actors and soul bootstrapped\n");
	} catch (err) {
		process.stderr.write(`[mesh] Bootstrap skipped: ${err instanceof Error ? err.message : String(err)}\n`);
	}

	// 7. Transcendence: Warm predictive context cache (best-effort)
	setImmediate(() => void import("./mcp-subsystems.js").then(async (m) => {
		const r = await m.runTranscendencePrefetch() as { predictions: unknown[]; cacheSize: number; durationMs: number } | null;
		if (r) process.stderr.write(`[transcendence] ${r.predictions.length} predictions, cache=${r.cacheSize}, ${r.durationMs}ms\n`);
	}).catch(() => { /* best-effort */ }));
}
