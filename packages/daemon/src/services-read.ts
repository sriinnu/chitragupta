/**
 * @chitragupta/daemon — Read-through, write, and daemon introspection services.
 *
 * Extracted from services.ts to keep each file under 450 LOC.
 * Registers memory recall, file search, day files, context loading,
 * fact extraction, and daemon health/status methods.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getChitraguptaHome } from "@chitragupta/core";
import type { RpcRouter } from "./rpc-router.js";
import {
	parseLimit,
	normalizeParams,
	normalizeProjectPath,
	resolveProjectKey,
} from "./services-helpers.js";
import { computeLucyLiveContext, type SharedRegressionSignal } from "./lucy-live-state.js";

const SHARED_SIGNAL_WINDOW_MS = 15 * 60 * 1000;

type DaemonMemoryScope =
	| { type: "global" }
	| { type: "project"; path: string }
	| { type: "agent"; agentId: string };

function hashProject(projectPath: string): string {
	return crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

export function resolveMemoryScope(scope: DaemonMemoryScope): string {
	switch (scope.type) {
		case "global":
			return "global";
		case "project":
			return `project:${scope.path}`;
		case "agent":
			return `agent:${scope.agentId}`;
	}
}

function resolveMemoryPath(scope: DaemonMemoryScope): string {
	const root = path.join(getChitraguptaHome(), "memory");
	switch (scope.type) {
		case "global":
			return path.join(root, "global.md");
		case "project":
			return path.join(root, "projects", hashProject(scope.path), "project.md");
		case "agent":
			return path.join(root, "agents", `${scope.agentId}.md`);
	}
}

export function parseMemoryScope(params: Record<string, unknown>): DaemonMemoryScope {
	const rawScope = typeof params.scope === "string" ? params.scope.trim() : "";
	if (rawScope) {
		if (rawScope === "global") return { type: "global" };
		if (rawScope.startsWith("project:")) {
			const project = normalizeProjectPath(rawScope.slice("project:".length));
			if (!project) throw new Error("Missing project scope path");
			return { type: "project", path: project };
		}
		if (rawScope.startsWith("agent:")) {
			const agentId = rawScope.slice("agent:".length).trim();
			if (!agentId) throw new Error("Missing agent scope identifier");
			return { type: "agent", agentId };
		}
		if (rawScope.startsWith("session:")) {
			throw new Error("Session-scoped memory is accessed via the session API");
		}
	}

	const scopeType = String(params.scopeType ?? params.type ?? "").trim();
	switch (scopeType) {
		case "global":
			return { type: "global" };
		case "project": {
			const project = normalizeProjectPath(String(params.scopePath ?? params.path ?? params.project ?? "").trim());
			if (!project) throw new Error("Missing scopePath for project memory");
			return { type: "project", path: project };
		}
		case "agent": {
			const agentId = String(params.agentId ?? params.scopePath ?? "").trim();
			if (!agentId) throw new Error("Missing agentId for agent memory");
			return { type: "agent", agentId };
		}
		case "session":
			throw new Error("Session-scoped memory is accessed via the session API");
		default:
			throw new Error("Invalid memory scope");
	}
}

function extractTraceProject(metadata: Record<string, unknown>): string {
	if (typeof metadata.project === "string") {
		return normalizeProjectPath(metadata.project);
	}
	if (typeof metadata.projectPath === "string") {
		return normalizeProjectPath(metadata.projectPath);
	}
	if (metadata.scopeType === "project" && typeof metadata.scopePath === "string") {
		return normalizeProjectPath(metadata.scopePath);
	}
	if (typeof metadata.scope === "string" && metadata.scope.startsWith("project:")) {
		return normalizeProjectPath(metadata.scope.slice("project:".length));
	}
	return "";
}

function traceSignalKey(topic: string, project?: string): string {
	return `${project ? `project:${project}` : "global"}::${topic}`;
}

async function buildPackedLiveContextBlock(
	title: string,
	lines: string[],
	intro?: string,
): Promise<string> {
	if (lines.length === 0) return "";
	const rawBody = [
		intro?.trim() ? intro.trim() : "",
		...lines,
	].filter(Boolean).join("\n");
	try {
		const { packLiveContextText } = await import("@chitragupta/smriti");
		const packed = await packLiveContextText(rawBody);
		if (packed) {
			return [
				`## ${title}`,
				`[packed via ${packed.runtime}, saved ${Math.max(0, Math.round(packed.savings * 100))}%]`,
				packed.packedText,
			].join("\n");
		}
	} catch {
		// Best-effort: fall back to the raw block when packing is unavailable.
	}
	return [
		`## ${title}`,
		rawBody,
	].join("\n");
}

async function buildLucyGuidanceBlock(live: {
	hit: { content: string } | null;
	predictions: Array<{ entity: string; confidence: number; source: string }>;
	liveSignals: SharedRegressionSignal[];
}): Promise<string> {
	const lines: string[] = [];
	if (live.hit?.content) {
		lines.push(`- Relevant live context: ${live.hit.content}`);
	}
	for (const prediction of live.predictions.slice(0, 3)) {
		lines.push(
			`- Predicted entity: ${prediction.entity} `
			+ `(${(prediction.confidence * 100).toFixed(0)}%, ${prediction.source})`,
		);
	}
	for (const signal of live.liveSignals.slice(0, 2)) {
		const signature = signal.errorSignature || "system";
		const summary = signal.description || "active regression signal";
		lines.push(`- Scarlett signal: ${signature} [${signal.severity}] -> ${summary}`);
	}
	return buildPackedLiveContextBlock("Lucy live guidance", lines);
}

async function buildLucyPredictionsBlock(
	predictions: Array<{ entity: string; confidence: number; source: string }>,
): Promise<string> {
	if (predictions.length === 0) return "";
	const lines = predictions.slice(0, 5).map((prediction) =>
		`- ${prediction.entity} (confidence: ${(prediction.confidence * 100).toFixed(0)}%, source: ${prediction.source})`,
	);
	return buildPackedLiveContextBlock(
		"Predicted Context (Transcendence pre-cache)",
		lines,
		"These entities are likely relevant to upcoming work:",
	);
}

async function loadScarlettRegressionSignals(
	options: { limit?: number; project?: string } = {},
): Promise<SharedRegressionSignal[]> {
	const limit = options.limit ?? 12;
	const requestedProject = normalizeProjectPath(options.project ?? "");
	const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
	const db = DatabaseManager.instance().get("agent");
	const rows = db.prepare(
		`SELECT topic, content, trace_type, metadata, created_at
		 FROM akasha_traces
		 WHERE agent_id = ?
		   AND created_at >= ?
		 ORDER BY created_at DESC
		 LIMIT ?`,
	).all("scarlett-internal", Date.now() - SHARED_SIGNAL_WINDOW_MS, limit * 4) as Array<Record<string, unknown>>;

	const healedAtByTopic = new Map<string, number>();
	const warnings: SharedRegressionSignal[] = [];
	for (const row of rows) {
		let metadata: Record<string, unknown> = {};
		try {
			metadata = row.metadata ? JSON.parse(String(row.metadata)) as Record<string, unknown> : {};
		} catch {
			metadata = {};
		}
		const createdAt = Number(row.created_at ?? Date.now());
		const topic = String(row.topic ?? "scarlett");
		const traceProject = extractTraceProject(metadata);
		if (requestedProject && traceProject && traceProject !== requestedProject) {
			continue;
		}
		const traceType = String(row.trace_type ?? "");
		const cleared = metadata.cleared === true || metadata.outcome === "success";
		if (traceType === "correction" && cleared) {
			const correctionKey = traceSignalKey(topic, traceProject || undefined);
			healedAtByTopic.set(correctionKey, Math.max(healedAtByTopic.get(correctionKey) ?? 0, createdAt));
			continue;
		}
		if (traceType !== "warning") continue;
		const severityValue = String(metadata.severity ?? "warning").toLowerCase();
		const severity = severityValue === "critical" ? "critical" : severityValue === "info" ? "info" : "warning";
		warnings.push({
			errorSignature: topic,
			description: String(row.content ?? ""),
			currentOccurrences: severity === "critical" ? 5 : severity === "warning" ? 3 : 1,
			previousOccurrences: 0,
			severity,
			lastSeenBefore: new Date(Math.max(0, createdAt - 60_000)).toISOString(),
			detectedAt: new Date(createdAt).toISOString(),
			scope: traceProject ? "project" : "global",
			project: traceProject || undefined,
		});
	}

	return warnings
		.filter((signal) => (
			healedAtByTopic.get(traceSignalKey(signal.errorSignature, signal.project)) ?? 0
		) < (Date.parse(signal.detectedAt) || 0))
		.slice(0, limit);
}

// ─── Project Resolution Helpers ─────────────────────────────────────────────

/** Extract known project paths from the session store. */
export function knownProjectsFromStore(
	store: typeof import("@chitragupta/smriti/session-store"),
): string[] {
	return store
		.listSessionProjects()
		.map((p) => (typeof p.project === "string" ? p.project : ""))
		.filter((p) => p.length > 0);
}

/** Resolve a requested project path against known projects. */
function resolveProjectAgainstKnown(project: string, knownProjects: readonly string[]): string {
	const normalized = normalizeProjectPath(project);
	if (!normalized) return "";
	return resolveProjectKey(normalized, knownProjects);
}

// ─── Read-Through Methods ───────────────────────────────────────────────────

/** Read-through methods for memory files, day files, recall, and context. */
export function registerReadMethods(router: RpcRouter): void {
	router.register("lucy.live_context", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const query = typeof params.query === "string" && params.query.trim() ? params.query.trim() : undefined;
		const limit = parseLimit(params.limit, 5, 20);
		const requestedProject = typeof params.project === "string"
			? params.project
			: typeof params.projectPath === "string"
				? params.projectPath
				: undefined;
		let project: string | undefined;
		if (requestedProject) {
			const store = await import("@chitragupta/smriti/session-store");
			project = resolveProjectAgainstKnown(requestedProject, knownProjectsFromStore(store));
		}
		const live = computeLucyLiveContext(
			query,
			limit,
			await loadScarlettRegressionSignals({ limit, project }),
			project ? { project } : undefined,
		);
		const guidanceBlock = query ? await buildLucyGuidanceBlock(live) : "";
		const predictionsBlock = await buildLucyPredictionsBlock(live.predictions);
		return {
			predictions: live.predictions,
			hit: live.hit,
			liveSignals: live.liveSignals,
			guidanceBlock,
			predictionsBlock,
		};
	}, "Shared live Lucy/Scarlett intuition context from the daemon");

	router.register("memory.unified_recall", async (params) => {
		const query = String(params.query ?? "");
		const limit = parseLimit(params.limit, 5);
		if (!query) throw new Error("Missing query");
		let project: string | undefined;
		if (typeof params.project === "string") {
			const store = await import("@chitragupta/smriti/session-store");
			project = resolveProjectAgainstKnown(params.project, knownProjectsFromStore(store));
		}
		const { recall } = await import("@chitragupta/smriti/unified-recall");
		const results = await recall(query, { limit, project });
		return { results };
	}, "Unified recall across all memory layers");

	router.register("memory.file_search", async (params) => {
		const query = String(params.query ?? "");
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		if (!query) throw new Error("Missing query");
		const { searchMemory } = await import("@chitragupta/smriti/search");
		const allResults = searchMemory(query);

		if (!projectInput) {
			return { results: allResults };
		}

		const store = await import("@chitragupta/smriti/session-store");
		const project = resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store));
		const filtered = allResults.filter((result) => {
			const scope = result.scope as Record<string, unknown>;
			const scopeType = String(scope.type ?? "");
			if (scopeType === "global") return true;
			if (scopeType !== "project") return false;
			return normalizeProjectPath(String(scope.path ?? "")) === project;
		});
		return { results: filtered };
	}, "Search memory markdown files");

	router.register("memory.get", async (params) => {
		const scope = parseMemoryScope(params);
		const { getMemory } = await import("@chitragupta/smriti/memory-store");
		const content = getMemory(scope);
		const filePath = resolveMemoryPath(scope);
		let exists = false;
		let lastModified: string | undefined;
		try {
			if (fs.existsSync(filePath)) {
				exists = true;
				lastModified = fs.statSync(filePath).mtime.toISOString();
			}
		} catch {
			/* best-effort stat */
		}
			return {
				scope: resolveMemoryScope(scope),
				content,
				exists,
				lastModified,
		};
	}, "Read memory content for a global, project, or agent scope");

	router.register("memory.scopes", async () => {
		const { listMemoryScopes } = await import("@chitragupta/smriti/memory-store");
		return { scopes: listMemoryScopes() };
	}, "List available memory scopes");

	router.register("day.show", async (params) => {
		const date = String(params.date ?? "");
		if (!date) throw new Error("Missing date");
		const { readDayFile } = await import("@chitragupta/smriti/day-consolidation");
		const content = readDayFile(date);
		return { date, content: content ?? null };
	}, "Read a consolidated day file");

	router.register("day.list", async () => {
		const { listDayFiles } = await import("@chitragupta/smriti/day-consolidation");
		return { dates: listDayFiles() };
	}, "List available day files");

	router.register("day.search", async (params) => {
		const query = String(params.query ?? "");
		const limit = parseLimit(params.limit);
		if (!query) throw new Error("Missing query");
		const { searchDayFiles } = await import("@chitragupta/smriti/day-consolidation");
		const results = searchDayFiles(query, { limit });
		return { results };
	}, "Search across day files");

	router.register("context.load", async (params) => {
		const projectInput = String(params.project ?? "");
		const store = await import("@chitragupta/smriti/session-store");
		const project = resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store));
		if (!project) throw new Error("Missing project");

		// Extract optional adaptive-budget params forwarded from CLI/MCP side.
		const providerContextWindow =
			typeof params.providerContextWindow === "number" && params.providerContextWindow > 0
				? params.providerContextWindow
				: undefined;
		const deviceId =
			typeof params.deviceId === "string" && params.deviceId.trim()
				? params.deviceId.trim()
				: undefined;

		const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
		const ctx = await loadProviderContext(project, { providerContextWindow, deviceId });
		return { assembled: ctx.assembled, itemCount: ctx.itemCount };
	}, "Load provider context for a project — accepts providerContextWindow and deviceId");
}
