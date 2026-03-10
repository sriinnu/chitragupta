/**
 * @chitragupta/cli — Daemon bridge RPC wrappers for sessions, memory, context, and day files.
 */

import { daemonCall } from "./daemon-bridge-core.js";
import type { LoadContextOptions } from "./daemon-bridge-types.js";
import type { PackedLiveContextResult } from "@chitragupta/smriti";

export type { LoadContextOptions } from "./daemon-bridge-types.js";

export type DaemonMemoryScope =
	| { type: "global" }
	| { type: "project"; path: string }
	| { type: "agent"; agentId: string };

type DaemonMemorySearchResult = {
	scope: DaemonMemoryScope;
	content: string;
	relevance?: number;
};

function deriveMcpClientKey(): string | undefined {
	for (const key of ["CHITRAGUPTA_CLIENT_KEY", "CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) {
		const value = process.env[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	const head = (process.env.PATH ?? "").split(":")[0] ?? "";
	const match = head.match(/\/tmp\/arg0\/([^/:]+)$/);
	return match?.[1];
}

export async function listSessions(project?: string): Promise<Array<Record<string, unknown>>> {
	const result = await daemonCall<{ sessions: Array<Record<string, unknown>> }>(
		"session.list", project ? { project } : {},
	);
	return result.sessions;
}

export async function showSession(id: string, project: string): Promise<Record<string, unknown>> {
	return daemonCall("session.show", { id, project });
}

export async function openSession(
	opts: Record<string, unknown>,
): Promise<{ session: Record<string, unknown>; created: boolean }> {
	return daemonCall("session.open", opts);
}

export async function openSharedSession(
	opts: Record<string, unknown>,
): Promise<{ session: Record<string, unknown>; created: boolean; lineageKey: string; sessionReusePolicy: string }> {
	return daemonCall("session.collaborate", opts);
}

export async function createSession(opts: Record<string, unknown>): Promise<{ id: string }> {
	const next = { ...opts };
	if (next.agent === "mcp") {
		const metadata =
			(typeof next.metadata === "object" && next.metadata !== null && !Array.isArray(next.metadata))
				? { ...(next.metadata as Record<string, unknown>) }
				: {};
		if (typeof metadata.clientKey !== "string" || !metadata.clientKey.trim()) {
			const key = deriveMcpClientKey();
			if (key) metadata.clientKey = key;
		}
		if (typeof metadata.sessionLineageKey !== "string" || !metadata.sessionLineageKey.trim()) {
			const key = typeof metadata.clientKey === "string" && metadata.clientKey.trim()
				? metadata.clientKey.trim()
				: deriveMcpClientKey();
			if (key) metadata.sessionLineageKey = key;
		}
		if (typeof metadata.sessionReusePolicy !== "string" || !metadata.sessionReusePolicy.trim()) {
			metadata.sessionReusePolicy = typeof metadata.sessionLineageKey === "string" && metadata.sessionLineageKey.trim()
				? "same_day"
				: "isolated";
		}
		if (typeof metadata.surface !== "string" || !metadata.surface.trim()) metadata.surface = "mcp";
		if (typeof metadata.channel !== "string" || !metadata.channel.trim()) metadata.channel = "mcp";
		if (typeof next.clientKey !== "string" && typeof metadata.clientKey === "string") next.clientKey = metadata.clientKey;
		if (typeof next.sessionLineageKey !== "string" && typeof metadata.sessionLineageKey === "string") {
			next.sessionLineageKey = metadata.sessionLineageKey;
		}
		if (typeof next.sessionReusePolicy !== "string" && typeof metadata.sessionReusePolicy === "string") {
			next.sessionReusePolicy = metadata.sessionReusePolicy;
		}
		if (typeof next.surface !== "string" && typeof metadata.surface === "string") next.surface = metadata.surface;
		if (typeof next.channel !== "string" && typeof metadata.channel === "string") next.channel = metadata.channel;
		if (Object.keys(metadata).length > 0) next.metadata = metadata;
	}
	return daemonCall("session.create", next);
}

export async function addTurn(
	sessionId: string,
	project: string,
	turn: Record<string, unknown>,
): Promise<void> {
	await daemonCall("turn.add", { sessionId, project, turn });
}

export async function listTurns(
	sessionId: string,
	project?: string,
): Promise<Array<Record<string, unknown>>> {
	const params: Record<string, unknown> = { sessionId };
	if (project) params.project = project;
	return (await daemonCall<{ turns: Array<Record<string, unknown>> }>("turn.list", params)).turns;
}

export async function memorySearch(
	query: string,
	limit = 10,
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ results: Array<Record<string, unknown>> }>("memory.search", { query, limit })).results;
}

export async function memoryRecall(
	query: string,
	project?: string,
	limit = 5,
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ results: Array<Record<string, unknown>> }>("memory.recall", { query, project, limit })).results;
}

export async function searchMemoryFiles(
	query: string,
	project?: string,
): Promise<DaemonMemorySearchResult[]> {
	return (await daemonCall<{ results: DaemonMemorySearchResult[] }>(
		"memory.file_search", project ? { query, project } : { query },
	)).results;
}

export async function listMemoryScopesViaDaemon(): Promise<DaemonMemoryScope[]> {
	return (await daemonCall<{ scopes: DaemonMemoryScope[] }>("memory.scopes")).scopes;
}

export async function getMemoryEntryViaDaemon(scope: DaemonMemoryScope): Promise<Record<string, unknown>> {
	return daemonCall("memory.get", {
		scopeType: scope.type,
		scopePath: scope.type === "project" ? scope.path : undefined,
		agentId: scope.type === "agent" ? scope.agentId : undefined,
	});
}

export async function updateMemoryViaDaemon(
	scope: DaemonMemoryScope,
	content: string,
): Promise<Record<string, unknown>> {
	return daemonCall("memory.update", {
		scopeType: scope.type,
		scopePath: scope.type === "project" ? scope.path : undefined,
		agentId: scope.type === "agent" ? scope.agentId : undefined,
		content,
	});
}

export async function deleteMemoryViaDaemon(
	scope: DaemonMemoryScope,
): Promise<Record<string, unknown>> {
	return daemonCall("memory.delete", {
		scopeType: scope.type,
		scopePath: scope.type === "project" ? scope.path : undefined,
		agentId: scope.type === "agent" ? scope.agentId : undefined,
	});
}

export async function readDayFileViaDaemon(date: string): Promise<string | null> {
	return (await daemonCall<{ content: string | null }>("day.show", { date })).content;
}

export async function listDayFilesViaDaemon(): Promise<string[]> {
	return (await daemonCall<{ dates: string[] }>("day.list")).dates;
}

export async function searchDayFilesViaDaemon(
	query: string,
	opts?: { limit?: number },
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"day.search", { query, limit: opts?.limit ?? 10 },
	)).results;
}

export async function loadContextViaDaemon(
	project: string,
	opts?: LoadContextOptions,
): Promise<{ assembled: string; itemCount: number }> {
	const params: Record<string, unknown> = { project };
	if (opts?.providerContextWindow != null) params.providerContextWindow = opts.providerContextWindow;
	if (opts?.deviceId != null) params.deviceId = opts.deviceId;
	return daemonCall("context.load", params);
}

export async function unifiedRecall(query: string, opts?: { project?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ results: Array<Record<string, unknown>> }>(
		"memory.unified_recall",
		{ query, project: opts?.project, limit: opts?.limit ?? 5 },
	)).results;
}

export async function getLucyLiveContextViaDaemon(
	query?: string,
	opts?: { limit?: number; project?: string },
): Promise<{
	predictions: Array<{ entity: string; confidence: number; source: string }>;
	hit: { entity: string; content: string; source: string } | null;
	liveSignals: Array<Record<string, unknown>>;
	guidanceBlock?: string;
	predictionsBlock?: string;
}> {
	return daemonCall("lucy.live_context", {
		query,
		limit: opts?.limit ?? 5,
		project: opts?.project,
	});
}

export async function getTurnsSinceViaDaemon(sessionId: string, sinceTurn: number): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ turns: Array<Record<string, unknown>> }>(
		"turn.since", { sessionId, sinceTurnNumber: sinceTurn },
	)).turns;
}

export async function getMaxTurnNumberViaDaemon(sessionId: string): Promise<number> {
	return (await daemonCall<{ maxTurn: number }>("turn.max_number", { sessionId })).maxTurn;
}

export async function getSessionsModifiedSinceViaDaemon(project: string, sinceMs: number): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ sessions: Array<Record<string, unknown>> }>(
		"session.modified_since", { project, sinceMs },
	)).sessions;
}

export async function extractFacts(
	text: string,
	projectPath?: string,
): Promise<{ extracted: number }> {
	return daemonCall("fact.extract", { text, projectPath });
}

export async function packContextViaDaemon(
	text: string,
): Promise<PackedLiveContextResult | { packed: false }> {
	return daemonCall("compression.pack_context", { text });
}

export async function autoProcessContextViaDaemon(
	text: string,
): Promise<Record<string, unknown>> {
	return daemonCall("compression.auto", { text });
}

export async function appendMemoryViaDaemon(
	scopeType: "global" | "project" | "agent",
	entry: string,
	scopeRef?: string,
): Promise<void> {
	await daemonCall("memory.append", {
		scopeType,
		entry,
		scopePath: scopeType === "project" ? scopeRef : undefined,
		agentId: scopeType === "agent" ? scopeRef : undefined,
	});
}
