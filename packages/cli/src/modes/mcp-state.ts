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

/**
 * Merge `partial` into the state file (atomic write via temp + rename).
 * Best-effort — never throws.
 */
export function writeChitraguptaState(partial: Partial<McpState>): void {
	try {
		const statePath = getStatePath();
		const dir = path.dirname(statePath);
		fs.mkdirSync(dir, { recursive: true });

		let existing: Partial<McpState> = {};
		try {
			existing = JSON.parse(fs.readFileSync(statePath, "utf-8")) as McpState;
		} catch { /* first write */ }

		const merged: McpState = {
			active: true,
			pid: process.pid,
			startedAt: _mcpStartedAt,
			lastUpdate: new Date().toISOString(),
			...existing,
			...partial,
		};
		const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
		fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
		fs.renameSync(tmpPath, statePath);
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
			existing.active = false;
			existing.lastUpdate = new Date().toISOString();
			const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
			fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
			fs.renameSync(tmpPath, statePath);
		}
	} catch { /* best-effort cleanup */ }
}
