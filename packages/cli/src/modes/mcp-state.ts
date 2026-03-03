/**
 * MCP State File Management.
 *
 * Writes and reads a lightweight state file at ~/.chitragupta/mcp-state.json
 * so external consumers (e.g. Claude Code status-line scripts) can inspect
 * whether the MCP server is running, which session is active, etc.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getHeartbeatPath } from "./mcp-telemetry.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Shape of the MCP state file persisted on disk. */
export interface McpState {
	active: boolean;
	pid: number;
	startedAt: string;
	sessionId?: string;
	project?: string;
	turnCount?: number;
	filesModified?: string[];
	lastTool?: string;
	lastUpdate: string;
}

/** Patch type for state writes. Use `null` to clear optional fields. */
export type McpStatePatch = Omit<
	Partial<McpState>,
	"sessionId" | "project" | "turnCount" | "filesModified" | "lastTool"
> & {
	sessionId?: string | null;
	project?: string | null;
	turnCount?: number | null;
	filesModified?: string[] | null;
	lastTool?: string | null;
};

// ─── Internal State ─────────────────────────────────────────────────────────

let _mcpStartedAt = new Date().toISOString();

/** Reset the internal "started at" timestamp (called at server boot). */
export function resetMcpStartedAt(): void {
	_mcpStartedAt = new Date().toISOString();
}

/** Return the current "started at" ISO timestamp. */
export function getMcpStartedAt(): string {
	return _mcpStartedAt;
}

/** Absolute path to the MCP state file. */
export function getStatePath(): string {
	return path.join(os.homedir(), ".chitragupta", "mcp-state.json");
}

/** Mirror session/turn state into this process heartbeat file (best-effort). */
function syncHeartbeatState(state: McpState): void {
	try {
		const heartbeatPath = getHeartbeatPath(state.pid);
		if (!fs.existsSync(heartbeatPath)) return;
		const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf-8")) as Record<string, unknown>;
		heartbeat.sessionId = state.sessionId ?? null;
		heartbeat.turnCount = typeof state.turnCount === "number" ? state.turnCount : 0;
		const tmpPath = heartbeatPath + "." + Date.now().toString(36) + ".tmp";
		fs.writeFileSync(tmpPath, JSON.stringify(heartbeat, null, 2));
		fs.renameSync(tmpPath, heartbeatPath);
	} catch {
		/* best-effort heartbeat sync */
	}
}

/**
 * Merge `partial` into the state file (atomic write via temp + rename).
 * Best-effort — never throws.
 */
export function writeChitraguptaState(partial: McpStatePatch): void {
	try {
		const statePath = getStatePath();
		const dir = path.dirname(statePath);
		fs.mkdirSync(dir, { recursive: true });

		let existing: Partial<McpState> = {};
		try {
			existing = JSON.parse(fs.readFileSync(statePath, "utf-8")) as McpState;
		} catch {
			/* first write */
		}

		const now = new Date().toISOString();
		const normalized: Partial<McpState> = {};
		for (const [key, value] of Object.entries(partial)) {
			if (value === null) continue;
			(normalized as Record<string, unknown>)[key] = value;
		}

		const mergedBase: Partial<McpState> = { ...existing, ...normalized };
			const merged: McpState = {
				active: mergedBase.active ?? true,
				pid: process.pid,
				startedAt: _mcpStartedAt,
			lastUpdate: now,
			sessionId: mergedBase.sessionId,
			project: mergedBase.project,
			turnCount: mergedBase.turnCount,
				filesModified: mergedBase.filesModified,
				lastTool: mergedBase.lastTool,
			};
			const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
			fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
			fs.renameSync(tmpPath, statePath);
			syncHeartbeatState(merged);
		} catch {
			// Best-effort state persistence — never block MCP operations
		}
}

/**
 * Mark the state file as inactive (called during graceful shutdown).
 * Best-effort — never throws.
 */
export function clearChitraguptaState(): void {
	try {
		const statePath = getStatePath();
		if (fs.existsSync(statePath)) {
			const existing = JSON.parse(fs.readFileSync(statePath, "utf-8")) as McpState;
			if (typeof existing.pid === "number" && existing.pid !== process.pid) {
				return;
			}
			existing.active = false;
			existing.lastUpdate = new Date().toISOString();
			const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
			fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
			fs.renameSync(tmpPath, statePath);
		}
	} catch {
		/* best-effort cleanup */
	}
}
