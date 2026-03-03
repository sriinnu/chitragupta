/**
 * @chitragupta/cli — MCP Telemetry Heartbeat Writer.
 *
 * Writes periodic heartbeat files to ~/.chitragupta/telemetry/instances/<pid>.json
 * so external tools (menubar, tray, CLI) can discover running MCP sessions.
 *
 * Uses atomic writes (write to .tmp-<pid> then rename) for crash safety.
 * Inspired by pi-telemetry's file-based discovery pattern.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getChitraguptaHome } from "@chitragupta/core";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Heartbeat file schema — matches what consumers expect. */
export interface HeartbeatData {
	/** Process ID of the MCP server. */
	pid: number;
	/** ISO timestamp when the MCP server started. */
	startedAt: string;
	/** Uptime in seconds since MCP server start. */
	uptime: number;
	/** Monotonically increasing heartbeat sequence number. */
	heartbeatSeq: number;
	/** Current session ID (null if no session started). */
	sessionId: string | null;
	/** Model name in use (if known). */
	model: string | null;
	/** Workspace/project path. */
	workspace: string;
	/** Context pressure: 0.0 (fresh) to 1.0 (near limit). */
	contextPressure: number;
	/** Current state of the MCP server. */
	state: "idle" | "busy" | "shutting_down";
	/** Hostname for multi-machine awareness. */
	hostname: string;
	/** Username for multi-user machines. */
	username: string;
	/** Number of tool calls processed in this session. */
	toolCallCount: number;
	/** Number of turns recorded. */
	turnCount: number;
	/** Timestamp of last tool call (epoch ms). */
	lastToolCallAt: number | null;
	/** Transport type. */
	transport: "stdio" | "sse";
	/** Mesh WebSocket port (for P2P auto-discovery). Null if mesh not active. */
	meshPort: number | null;
	/** Best-effort provider name for the hosting CLI. */
	provider: "codex" | "claude" | "gemini" | "copilot" | "unknown";
	/** Provider-native session/thread identifier when available. */
	providerSessionId: string | null;
	/** Stable per-client key (tab/window/thread) when available. */
	clientKey: string | null;
	/** Optional subagent nickname from the hosting provider. */
	agentNickname: string | null;
	/** Optional subagent role from the hosting provider. */
	agentRole: string | null;
	/** Optional parent thread/session ID (for subagent lineage). */
	parentThreadId: string | null;
}

/** Options for the heartbeat writer. */
export interface HeartbeatOptions {
	/** Heartbeat interval in milliseconds. Default: 2000 (2s). */
	intervalMs?: number;
	/** Workspace/project path. */
	workspace: string;
	/** Transport type. */
	transport: "stdio" | "sse";
}

/** Handle to a running heartbeat writer. */
export interface HeartbeatHandle {
	/** Stop the heartbeat writer and delete the heartbeat file. */
	stop(): void;
	/** Update mutable state fields. */
	update(fields: Partial<MutableHeartbeatFields>): void;
	/** Get the current heartbeat data. */
	snapshot(): HeartbeatData;
}

/** Fields that can be updated after start. */
type MutableHeartbeatFields = Pick<
	HeartbeatData,
	| "sessionId"
	| "model"
	| "contextPressure"
	| "state"
	| "toolCallCount"
	| "turnCount"
	| "lastToolCallAt"
	| "meshPort"
	| "provider"
	| "providerSessionId"
	| "clientKey"
	| "agentNickname"
	| "agentRole"
	| "parentThreadId"
>;

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 2000;

type ProviderName = HeartbeatData["provider"];

function deriveClientKey(): string | null {
	for (const key of ["CHITRAGUPTA_CLIENT_KEY", "CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) {
		const value = process.env[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	const pathHead = (process.env.PATH ?? "").split(":")[0] ?? "";
	const match = pathHead.match(/\/tmp\/arg0\/([^/:]+)$/);
	return match?.[1] ?? null;
}

function deriveProviderName(): ProviderName {
	if (typeof process.env.CODEX_THREAD_ID === "string" && process.env.CODEX_THREAD_ID.trim()) return "codex";
	if (
		(typeof process.env.CLAUDE_CODE_SESSION_ID === "string" && process.env.CLAUDE_CODE_SESSION_ID.trim())
		|| (typeof process.env.CLAUDE_SESSION_ID === "string" && process.env.CLAUDE_SESSION_ID.trim())
	) return "claude";
	if (typeof process.env.GEMINI_SESSION_ID === "string" && process.env.GEMINI_SESSION_ID.trim()) return "gemini";
	if (typeof process.env.COPILOT_SESSION_ID === "string" && process.env.COPILOT_SESSION_ID.trim()) return "copilot";

	const pathLower = (process.env.PATH ?? "").toLowerCase();
	if (pathLower.includes("/.gemini/")) return "gemini";
	if (pathLower.includes("/.copilot/")) return "copilot";
	if (pathLower.includes("/.claude/")) return "claude";
	if (pathLower.includes("/.codex/")) return "codex";
	return "unknown";
}

function deriveProviderSessionId(provider: ProviderName, clientKey: string | null): string | null {
	switch (provider) {
		case "codex":
			return process.env.CODEX_THREAD_ID?.trim() || clientKey;
		case "claude":
			return process.env.CLAUDE_CODE_SESSION_ID?.trim() || process.env.CLAUDE_SESSION_ID?.trim() || clientKey;
		case "gemini":
			return process.env.GEMINI_SESSION_ID?.trim() || clientKey;
		case "copilot":
			return process.env.COPILOT_SESSION_ID?.trim() || clientKey;
		default:
			return clientKey;
	}
}

// ─── Path helpers ───────────────────────────────────────────────────────────

/** Get the telemetry instances directory path. */
export function getTelemetryDir(): string {
	return path.join(getChitraguptaHome(), "telemetry", "instances");
}

/** Get the heartbeat file path for a given PID. */
export function getHeartbeatPath(pid: number): string {
	return path.join(getTelemetryDir(), `${pid}.json`);
}

// ─── Heartbeat Writer ───────────────────────────────────────────────────────

/**
 * Start the telemetry heartbeat writer.
 *
 * Writes heartbeat JSON to ~/.chitragupta/telemetry/instances/<pid>.json
 * every `intervalMs` milliseconds using atomic writes (write .tmp then rename).
 * Cleans up the file on stop() or process exit.
 */
export function startHeartbeat(options: HeartbeatOptions): HeartbeatHandle {
	const { intervalMs = DEFAULT_INTERVAL_MS, workspace, transport } = options;
	const pid = process.pid;
	const startedAt = new Date().toISOString();
	const t0 = Date.now();

	const dir = getTelemetryDir();
	fs.mkdirSync(dir, { recursive: true });

	const filePath = getHeartbeatPath(pid);
	const tmpPath = path.join(dir, `.tmp-${pid}`);

	let seq = 0;
	let stopped = false;
	const provider = deriveProviderName();
	const clientKey = deriveClientKey();

	const mutable: MutableHeartbeatFields = {
		sessionId: null,
		model: null,
		contextPressure: 0,
		state: "idle",
		toolCallCount: 0,
		turnCount: 0,
		lastToolCallAt: null,
		meshPort: null,
		provider,
		providerSessionId: deriveProviderSessionId(provider, clientKey),
		clientKey,
		agentNickname: (
			process.env.CODEX_AGENT_NICKNAME
			|| process.env.CLAUDE_AGENT_NICKNAME
			|| process.env.AGENT_NICKNAME
			|| ""
		).trim() || null,
		agentRole: (
			process.env.CODEX_AGENT_ROLE
			|| process.env.CLAUDE_AGENT_ROLE
			|| process.env.AGENT_ROLE
			|| ""
		).trim() || null,
		parentThreadId: (
			process.env.CODEX_PARENT_THREAD_ID
			|| process.env.CLAUDE_PARENT_SESSION_ID
			|| process.env.PARENT_THREAD_ID
			|| ""
		).trim() || null,
	};

	function buildSnapshot(): HeartbeatData {
		return {
			pid,
			startedAt,
			uptime: (Date.now() - t0) / 1000,
			heartbeatSeq: seq,
			sessionId: mutable.sessionId,
			model: mutable.model,
			workspace,
			contextPressure: mutable.contextPressure,
			state: mutable.state,
			hostname: os.hostname(),
			username: os.userInfo().username,
			toolCallCount: mutable.toolCallCount,
			turnCount: mutable.turnCount,
			lastToolCallAt: mutable.lastToolCallAt,
			transport,
			meshPort: mutable.meshPort,
			provider: mutable.provider,
			providerSessionId: mutable.providerSessionId,
			clientKey: mutable.clientKey,
			agentNickname: mutable.agentNickname,
			agentRole: mutable.agentRole,
			parentThreadId: mutable.parentThreadId,
		};
	}

	function writeHeartbeat(): void {
		if (stopped) return;
		seq++;
		const data = buildSnapshot();
		try {
			fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
			fs.renameSync(tmpPath, filePath);
		} catch {
			// Best-effort — don't crash the MCP server for telemetry
		}
	}

	function cleanup(): void {
		stopped = true;
		try { fs.unlinkSync(filePath); } catch { /* already gone */ }
		try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
	}

	// Write initial heartbeat immediately
	writeHeartbeat();

	// Periodic writer — unref so it doesn't prevent process exit
	const timer = setInterval(writeHeartbeat, intervalMs);
	timer.unref();

	// Clean up on process exit
	const exitHandler = (): void => { cleanup(); };
	process.on("exit", exitHandler);
	process.on("SIGINT", exitHandler);
	process.on("SIGTERM", exitHandler);

	return {
		stop() {
			clearInterval(timer);
			process.removeListener("exit", exitHandler);
			process.removeListener("SIGINT", exitHandler);
			process.removeListener("SIGTERM", exitHandler);
			cleanup();
		},
		update(fields) {
			Object.assign(mutable, fields);
		},
		snapshot: buildSnapshot,
	};
}

// ─── Scanner ────────────────────────────────────────────────────────────────

/**
 * Scan all heartbeat files and return live instances.
 *
 * @param staleThresholdMs - Max age of heartbeat file to be considered alive. Default: 10000 (10s).
 * @returns Array of live heartbeat data, sorted by uptime descending.
 */
export function scanHeartbeats(staleThresholdMs = 10_000): HeartbeatData[] {
	const dir = getTelemetryDir();
	if (!fs.existsSync(dir)) return [];

	const now = Date.now();
	const results: HeartbeatData[] = [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) continue;
		const fp = path.join(dir, entry.name);
		try {
			const stat = fs.statSync(fp);
			if (now - stat.mtimeMs > staleThresholdMs) continue;

			const raw = fs.readFileSync(fp, "utf-8");
			const data = JSON.parse(raw) as HeartbeatData;
			results.push(data);
		} catch {
			// Skip unreadable/corrupt files
		}
	}

	return results.sort((a, b) => b.uptime - a.uptime);
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

/**
 * Compute a fingerprint hash of the current telemetry state.
 * Used for long-polling: only return data when state changes.
 *
 * @param instances - Array of heartbeat data to fingerprint.
 * @returns 8-character hex hash string (FNV-1a 32-bit).
 */
export function computeFingerprint(instances: HeartbeatData[]): string {
	const parts = instances.map(i => `${i.pid}:${i.heartbeatSeq}:${i.state}`).join("|");
	// FNV-1a 32-bit hash
	let hash = 0x811c9dc5;
	for (let i = 0; i < parts.length; i++) {
		hash ^= parts.charCodeAt(i);
		hash = (Math.imul(hash, 0x01000193)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
