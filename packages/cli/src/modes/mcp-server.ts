/**
 * @chitragupta/cli — MCP Server Mode.
 *
 * Runs Chitragupta as an MCP (Model Context Protocol) server, exposing
 * its tools, memory, and agent capabilities to MCP clients like
 * Claude Code, Codex, Gemini CLI, or any MCP-compatible host.
 *
 * Supports two transports:
 *   - stdio: For direct process spawning (Claude Code's preferred mode)
 *   - sse:   For HTTP-based connections
 *
 * All tool definitions are extracted into dedicated modules (mcp-tools-*.ts).
 * This file is the thin orchestration layer: collect tools → create server → start.
 *
 * @module
 */

import type { McpToolHandler } from "@chitragupta/tantra";
import type { ChitraguptaToolHandler } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";
import { McpServer, chitraguptaToolToMcp } from "@chitragupta/tantra";

import fs from "fs";
import path from "path";
import { getBuiltinTools } from "../bootstrap.js";

// ─── Extracted modules ───────────────────────────────────────────────────────

import { resetMcpStartedAt, writeChitraguptaState, clearChitraguptaState } from "./mcp-state.js";
import {
	createMemorySearchTool, createSessionListTool, createSessionShowTool,
	createMargaDecideTool, createAgentPromptTool,
} from "./mcp-tools-core.js";
import {
	createSamitiChannelsTool, createSamitiBroadcastTool,
	createSabhaDeliberateTool, createAkashaTracesTool, createAkashaDepositTool,
} from "./mcp-tools-collective.js";
import {
	createVasanaTendenciesTool, createHealthStatusTool, createAtmanReportTool,
} from "./mcp-tools-introspection.js";
import { createCodingAgentTool } from "./mcp-tools-coding.js";
import {
	createHandoverTool, createDayShowTool, createDayListTool,
	createDaySearchTool, createContextTool,
} from "./mcp-tools-memory.js";
import {
	createSyncStatusTool, createSyncExportTool, createSyncImportTool,
	createRecallTool, createVidhisTool, createConsolidateTool,
} from "./mcp-tools-sync.js";
import {
	createMemoryResource, createSavePrompt, createLastSessionPrompt,
	createRecallPrompt, createStatusPrompt, createHandoverPrompt,
	createReviewPrompt, createDebugPrompt, createResearchPrompt,
	createRefactorPrompt, createMemorySearchPrompt, createSessionPrompt,
} from "./mcp-prompts.js";
import { McpSessionRecorder } from "./mcp-session.js";

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
		projectPath = process.cwd(),
		name = "chitragupta",
		enableAgent = false,
	} = options;

	// ─── 1. Collect all tools ────────────────────────────────────────

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
	if (enableAgent) mcpTools.push(createAgentPromptTool());

	// Memory, handover & day files
	mcpTools.push(createHandoverTool(projectPath));
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

	// ─── 2. Session recording ───────────────────────────────────────

	const recorder = new McpSessionRecorder(projectPath);
	mcpTools.push(recorder.createRecordConversationTool());

	// ─── 3. Create MCP server ────────────────────────────────────────

	const server = new McpServer({
		name,
		version: "0.1.0",
		transport,
		ssePort: port,
		tools: mcpTools,
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
		onToolCall: (info) => recorder.recordToolCall(info),
	});

	// ─── 4. State file + graceful shutdown ───────────────────────────

	resetMcpStartedAt();
	writeChitraguptaState({ active: true, project: projectPath, lastTool: "(startup)" });

	const shutdown = async () => {
		clearChitraguptaState();
		await server.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// ─── 5. Start server ─────────────────────────────────────────────

	process.stderr.write(
		`Chitragupta MCP server starting (${transport}${transport === "sse" ? ` on port ${port}` : ""})...\n` +
		`  Tools: ${mcpTools.length}\n` +
		`  Project: ${projectPath}\n` +
		`  Agent: ${enableAgent ? "enabled" : "disabled"}\n`,
	);

	await server.start();

	// ─── 6. Auto-start daemon (self-healing, skill sync) ─────────────

	try {
		const { DaemonManager } = await import("@chitragupta/anina");
		const { getChitraguptaHome } = await import("@chitragupta/core");

		const home = getChitraguptaHome();
		const skillPaths: string[] = [];
		const autoApproveSafe = new Set(["1", "true", "yes", "on"]).has(
			(process.env.CHITRAGUPTA_DAEMON_AUTO_APPROVE_SAFE ?? "").trim().toLowerCase(),
		);

		// Scan skill directories if they exist
		const potentialSkillDirs = [
			path.join(home, "skills"),
			path.join(projectPath, "skills"),
			path.join(projectPath, "skills-core"),
		];
		for (const dir of potentialSkillDirs) {
			try {
				if (fs.existsSync(dir)) skillPaths.push(dir);
			} catch { /* skip */ }
		}

		const daemonManager = new DaemonManager({
			daemon: { consolidateOnIdle: true, backfillOnStartup: true },
			skillScanPaths: skillPaths,
			enableSkillSync: skillPaths.length > 0,
			skillScanIntervalMs: 300_000,
			autoApproveSafe,
		});

		// Wire Samiti for health/skill notifications
		try {
			const { Samiti } = await import("@chitragupta/sutra");
			const samiti = new Samiti();
			type SetSamitiParam = Parameters<typeof daemonManager.setSamiti>[0];
			daemonManager.setSamiti(samiti as unknown as SetSamitiParam);
		} catch {
			// Samiti is optional — daemon works without it
		}

		// Log daemon events
		daemonManager.on("health", (event: { from: string; to: string; reason: string }) => {
			process.stderr.write(`[daemon] ${event.from} → ${event.to}: ${event.reason}\n`);
		});
		daemonManager.on("skill-sync", (event: { type: string; detail: string }) => {
			if (event.type !== "scan-start") {
				process.stderr.write(`[daemon:skills] ${event.type}: ${event.detail}\n`);
			}
		});
		daemonManager.on("error", () => {
			// Suppress unhandled error throw — errors are tracked in the manager
		});

		// Start daemon in background (don't block MCP server)
		daemonManager.start().catch((err: unknown) => {
			process.stderr.write(`[daemon] auto-start failed: ${err}\n`);
		});

		// Wire daemon touch into session recording
		recorder.daemonManager = daemonManager;

		// Add daemon to shutdown sequence
		const shutdownWithDaemon = async () => {
			try { await daemonManager.stop(); } catch { /* best-effort */ }
			clearChitraguptaState();
			await server.stop();
			process.exit(0);
		};
		process.removeListener("SIGINT", shutdown);
		process.removeListener("SIGTERM", shutdown);
		process.on("SIGINT", shutdownWithDaemon);
		process.on("SIGTERM", shutdownWithDaemon);

		process.stderr.write(`[daemon] Auto-started (skills: ${skillPaths.length} paths)\n`);
	} catch (err) {
		// Daemon auto-start is best-effort — MCP server works without it
		process.stderr.write(`[daemon] Auto-start skipped: ${err instanceof Error ? err.message : String(err)}\n`);
	}
}
