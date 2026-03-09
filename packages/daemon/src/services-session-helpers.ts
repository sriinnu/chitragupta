import { normalizeProjectPath, resolveProjectKey } from "./services-helpers.js";

export function knownProjectsFromDb(
	agentDb: { prepare: (sql: string) => { all: () => Array<Record<string, unknown>> } },
): string[] {
	try {
		const rows = agentDb
			.prepare("SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL AND project != ''")
			.all();
		return rows
			.map((row) => (typeof row.project === "string" ? row.project : ""))
			.filter((project) => project.length > 0);
	} catch {
		return [];
	}
}

export function resolveProjectAgainstKnown(project: string, knownProjects: readonly string[]): string {
	const normalized = normalizeProjectPath(project);
	if (!normalized) return "";
	return resolveProjectKey(normalized, knownProjects);
}

export function normalizeSessionMetadata(params: Record<string, unknown>): Record<string, unknown> | undefined {
	const metadata =
		typeof params.metadata === "object" && params.metadata !== null && !Array.isArray(params.metadata)
			? { ...(params.metadata as Record<string, unknown>) }
			: {};
	for (const [paramKey, metadataKey] of [
		["clientKey", "clientKey"],
		["sessionLineageKey", "sessionLineageKey"],
		["sessionReusePolicy", "sessionReusePolicy"],
		["consumer", "consumer"],
		["surface", "surface"],
		["channel", "channel"],
		["actorId", "actorId"],
	] as const) {
		const value = params[paramKey];
		if (typeof value === "string" && value.trim() && metadata[metadataKey] === undefined) {
			metadata[metadataKey] = value.trim();
		}
	}
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function resolveLineageKey(
	params: Record<string, unknown>,
	metadata?: Record<string, unknown>,
): string {
	if (typeof params.sessionLineageKey === "string" && params.sessionLineageKey.trim()) {
		return params.sessionLineageKey.trim();
	}
	if (typeof params.lineageKey === "string" && params.lineageKey.trim()) {
		return params.lineageKey.trim();
	}
	if (typeof metadata?.sessionLineageKey === "string" && metadata.sessionLineageKey.trim()) {
		return metadata.sessionLineageKey.trim();
	}
	return "";
}

export function localDatePrefix(now = new Date()): string {
	const year = now.getFullYear().toString();
	const month = (now.getMonth() + 1).toString().padStart(2, "0");
	const day = now.getDate().toString().padStart(2, "0");
	return `session-${year}-${month}-${day}-`;
}

export function findReusableSessionId(
	store: typeof import("@chitragupta/smriti/session-store"),
	project: string,
	lineageKey: string,
): string | null {
	if (!lineageKey) return null;
	const todayPrefix = localDatePrefix();
	for (const session of store.listSessions(project)) {
		if (!session.id.startsWith(todayPrefix)) continue;
		const metadata =
			typeof session.metadata === "object" && session.metadata !== null
				? (session.metadata as Record<string, unknown>)
				: {};
		const candidate = typeof metadata.sessionLineageKey === "string" ? metadata.sessionLineageKey.trim() : "";
		if (candidate === lineageKey) {
			return session.id;
		}
	}
	return null;
}
