/** @chitragupta/cli — MCP Server Mode. Collect tools → apply tiers → create server → start. */

import type { McpToolHandler, ChitraguptaToolHandler } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";
import { McpServer, ToolRegistry, chitraguptaToolToMcp } from "@chitragupta/tantra";

import fs from "fs";
import os from "os";
import path from "path";
import { createToolNotFoundResolver } from "../shared-factories.js";
import { resolveLearningPersistPath } from "../nervous-system-wiring.js";
import { CLI_PACKAGE_VERSION } from "../version.js";
import { startHeartbeat } from "./mcp-telemetry.js";
import { applyToolTiers, isCompactMode, getTierStats } from "./mcp-tool-tiers.js";
import { wireExtensionsToMcp } from "./mcp-extension-bridge.js";
import { createMcpSseAuthConfig, createMcpStreamableHttpAuthConfig } from "./mcp-server-auth.js";
import {
	MCP_HANDLER_REF,
	type ResolverTool,
	buildResolverTools,
	collectMcpTools,
	normalizeMcpProjectPath,
} from "./mcp-server-tooling.js";

import { resetMcpStartedAt, writeChitraguptaState, clearChitraguptaState } from "./mcp-state.js";
import { createCerebralHandler } from "./cerebral-expansion.js";
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
import { triggerSwapnaConsolidation } from "../main-session.js";
import {
	wrapMcpToolWithNervousSystem,
	updateMcpTriguna,
	wrapMcpToolsWithNervousSystem,
} from "./mcp-tool-guidance.js";

// ─── Re-exports (backward compatibility) ─────────────────────────────────────

export { formatOrchestratorResult } from "./mcp-tools-introspection.js";
export { createMcpSseAuthConfig, createMcpStreamableHttpAuthConfig } from "./mcp-server-auth.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface McpServerModeOptions {
	/** Transport: "stdio" for process spawning, "sse" for legacy HTTP+SSE, "streamable-http" for the newer MCP HTTP mode. Default: "stdio" */
	transport?: "stdio" | "sse" | "streamable-http";
	/** Port for HTTP transports. Default: 3001 */
	port?: number;
	/** Project path for memory/session context. Default: process.cwd() */
	projectPath?: string;
	/** Server name shown to MCP clients. Default: "chitragupta" */
	name?: string;
	/** Whether to expose the agent prompt tool (requires provider config). Default: false */
	enableAgent?: boolean;
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
	const { builtinTools, mcpTools, cerebralExpansion, recorder, buddhiRecorder } = collectMcpTools(
		projectPath,
		enableAgent,
	);

	// ─── 3. Apply tool tiers + Create + START server IMMEDIATELY ────
	//
	// The transport MUST be ready before any file I/O or dynamic imports.
	// MCP clients send `initialize` immediately on spawn — if the stdin
	// listener isn't set up yet, the client times out waiting for a response.

	const finalTools = wrapMcpToolsWithNervousSystem(
		applyToolTiers(mcpTools),
		{
			projectPath,
			sessionIdResolver: () => recorder.activeSessionId ?? undefined,
		},
	);
	const heartbeat = startHeartbeat({ workspace: projectPath, transport });
	heartbeat.update({ model: "mcp" });
	let toolCallCount = 0;

	// ─── 2b. Wire 2 (Cerebral Expansion) + Wire 4 (Learning Persist) ───
	// Basic resolver runs first; if it fails, CerebralExpansion searches
	// Akasha cache + local skill registry (TVM) + Suraksha security scan.

	const learningPersistPaths = [
		resolveLearningPersistPath(projectPath),
		path.join(os.homedir(), ".chitragupta", "learning", "session-state.json"),
	];
	for (const persistPath of learningPersistPaths) {
		fs.mkdirSync(path.dirname(persistPath), { recursive: true });
	}

	const resolverTools = buildResolverTools(builtinTools, finalTools);

	const cerebralHandler = createCerebralHandler(
		cerebralExpansion,
		() => import("./mcp-subsystems.js").then((m) => m.getAkasha()),
		() => import("./mcp-subsystems.js").then((m) => m.getSkillRegistry()),
	);

	const toolNotFoundResolver = createToolNotFoundResolver({
		tools: resolverTools,
		onGap: (toolName) => {
			process.stderr.write(`[skill-gap] ${toolName}\n`);
			const entry = JSON.stringify({ type: "skill-gap", tool: toolName, ts: Date.now() }) + "\n";
			for (const persistPath of learningPersistPaths) {
				try {
					fs.appendFileSync(persistPath, entry);
				} catch {
					/* best-effort persistence */
				}
			}
		},
	});

	const server = new McpServer({
		name,
		version: CLI_PACKAGE_VERSION,
		transport,
		ssePort: port,
		streamableHttpPort: port,
		auth: transport === "sse"
			? createMcpSseAuthConfig()
			: transport === "streamable-http"
				? createMcpStreamableHttpAuthConfig()
				: undefined,
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
				const wrapped = (resolved as ResolverTool)[MCP_HANDLER_REF];
				if (wrapped) {
					return wrapMcpToolWithNervousSystem(wrapped, {
						projectPath,
						sessionIdResolver: () => recorder.activeSessionId ?? undefined,
					});
				}
				return wrapMcpToolWithNervousSystem(
					chitraguptaToolToMcp(resolved as unknown as ChitraguptaToolHandler),
					{
						projectPath,
						sessionIdResolver: () => recorder.activeSessionId ?? undefined,
					},
				);
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
			buddhiRecorder?.("tool:done", {
				name: info.tool,
				result: { isError: info.result.isError === true },
				durationMs: info.elapsedMs,
			});
			await updateMcpTriguna(info);
			heartbeat.update({ toolCallCount: ++toolCallCount, lastToolCallAt: Date.now(), state: "busy" });
		},
	});

	await server.start();

	const startupMs = performance.now() - t0;
	const tierInfo = isCompactMode() ? ` ${JSON.stringify(getTierStats(mcpTools))}` : "";
	const sseInfo = transport === "sse"
		? ` legacy-http+sse on port ${port}`
		: transport === "streamable-http"
			? ` streamable-http on port ${port}`
			: "";
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
	setImmediate(() => void import("./daemon-bridge.js").then((m) =>
		m.getDaemonClient({ autoStart: true }).then(() => process.stderr.write("[daemon] RPC bridge warm\n")),
	).catch(() => { /* daemon warm-up optional */ }));

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
	let meshNetworkShutdown: (() => Promise<void>) | undefined;
	const shutdown = async () => {
		heartbeat.update({ state: "shutting_down" });
		heartbeat.stop();
		triggerSwapnaConsolidation(projectPath);
		clearChitraguptaState();
		try { const { disconnectDaemon } = await import("./daemon-bridge.js"); disconnectDaemon(); } catch { /* best-effort */ }
		try { await meshNetworkShutdown?.(); } catch { /* best-effort */ }
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

	try {
		const { getActorSystem } = await import("./mcp-subsystems.js");
		const { bootstrapMeshNetwork, resolveMeshConfig } = await import("../mesh-bootstrap.js");
		const { loadGlobalSettings } = await import("@chitragupta/core");
			const meshConfig = resolveMeshConfig(loadGlobalSettings() as unknown as Record<string, unknown>);
		if (meshConfig) {
			const meshSystem = await getActorSystem();
			const meshResult = await bootstrapMeshNetwork(meshSystem, meshConfig);
			meshNetworkShutdown = meshResult.shutdown;
			process.stderr.write(
				`[mesh] P2P bootstrapped on ${meshResult.meshPort} (${meshResult.nodeId.slice(0, 8)})\n`,
			);
		}
	} catch (err) {
		process.stderr.write(`[mesh] P2P bootstrap skipped: ${err instanceof Error ? err.message : String(err)}\n`);
	}

	// 7. Transcendence: Warm cache + periodic refresh (5 min cycle matches TTL)
	const runPrefetch = () => void import("./mcp-subsystems.js").then(async (m) => {
		const r = await m.runTranscendencePrefetch() as { predictions: unknown[]; cacheSize: number; durationMs: number } | null;
		if (r) process.stderr.write(`[transcendence] ${r.predictions.length} predictions, cache=${r.cacheSize}, ${r.durationMs}ms\n`);
	}).catch(() => { /* best-effort */ });
	setImmediate(runPrefetch);
	const prefetchTimer = setInterval(runPrefetch, 300_000);
	prefetchTimer.unref(); // Don't block process exit
}
