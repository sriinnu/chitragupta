/**
 * MCP Daemon Wiring -- auto-start daemon with skill sync in MCP server mode.
 *
 * Extracted from mcp-server.ts to keep the main file under 450 LOC.
 * Handles daemon lifecycle, Samiti wiring, event logging, and graceful shutdown.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import type { McpSessionRecorder } from "./mcp-session.js";
import { clearChitraguptaState } from "./mcp-state.js";
import { triggerSwapnaConsolidation } from "../main-session.js";

/** Dependencies injected from the MCP server startup. */
export interface DaemonWiringDeps {
	/** Absolute project path. */
	projectPath: string;
	/** Session recorder instance to wire daemon touch into. */
	recorder: McpSessionRecorder;
	/** Heartbeat controller for shutdown state updates. */
	heartbeat: { update(data: Record<string, unknown>): void; stop(): void };
	/** MCP server instance for shutdown. */
	server: { stop(): Promise<void> };
	/** Previous shutdown handler to replace on SIGINT/SIGTERM. */
	previousShutdown: () => Promise<void>;
}

/**
 * Auto-start the daemon with skill sync and wire into the MCP server lifecycle.
 *
 * Sets up:
 * - Skill directory scanning
 * - Samiti health/skill notifications
 * - Daemon event logging
 * - Enhanced shutdown handler that stops daemon before exit
 *
 * @param deps - Injected dependencies from the MCP server startup.
 */
export async function wireDaemon(deps: DaemonWiringDeps): Promise<void> {
	const { projectPath, recorder, heartbeat, server, previousShutdown } = deps;

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
		try { if (fs.existsSync(dir)) skillPaths.push(dir); } catch { /* skip */ }
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
	} catch { /* Samiti is optional */ }

	// Log daemon events
	daemonManager.on("health", (event: { from: string; to: string; reason: string }) => {
		process.stderr.write(`[daemon] ${event.from} \u2192 ${event.to}: ${event.reason}\n`);
	});
	daemonManager.on("skill-sync", (event: { type: string; detail: string }) => {
		if (event.type !== "scan-start") {
			process.stderr.write(`[daemon:skills] ${event.type}: ${event.detail}\n`);
		}
	});
	daemonManager.on("error", () => { /* Suppress unhandled error throw */ });

	// Start daemon in background (don't block MCP server)
	daemonManager.start().catch((err: unknown) => {
		process.stderr.write(`[daemon] auto-start failed: ${err}\n`);
	});

	// Wire daemon touch into session recording
	recorder.daemonManager = daemonManager;

	// Replace shutdown handler with one that stops daemon first
	const shutdownWithDaemon = async () => {
		heartbeat.update({ state: "shutting_down" });
		heartbeat.stop();
		triggerSwapnaConsolidation(projectPath);
		try { await daemonManager.stop(); } catch { /* best-effort */ }
		clearChitraguptaState();
		await server.stop();
		process.exit(0);
	};
	process.removeListener("SIGINT", previousShutdown);
	process.removeListener("SIGTERM", previousShutdown);
	process.on("SIGINT", shutdownWithDaemon);
	process.on("SIGTERM", shutdownWithDaemon);

	process.stderr.write(`[daemon] Auto-started (skills: ${skillPaths.length} paths)\n`);
}
