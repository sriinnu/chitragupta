/**
 * @chitragupta/cli — Direct smriti fallback for degraded mode.
 *
 * When the daemon is unreachable, read operations fall back to direct
 * smriti access. Write operations always throw — better to fail than
 * corrupt the single-writer invariant.
 *
 * @module
 */

import { DaemonUnavailableError } from "@chitragupta/daemon";

/**
 * Methods that have a working direct smriti fallback.
 * Only methods with an implemented switch case below are listed.
 * Every entry MUST have a corresponding case — no silent `{}` returns.
 */
export const FALLBACK_METHODS = new Set([
	"session.list", "session.show", "session.dates", "session.projects",
	"session.modified_since",
	"turn.list", "turn.since", "turn.max_number",
	"memory.file_search", "memory.scopes", "memory.unified_recall",
	"day.show", "day.list", "day.search",
	"context.load",
	"vidhi.list", "vidhi.match",
	"daemon.ping", "daemon.health",
]);

/**
 * Direct smriti fallback for when daemon is unreachable.
 *
 * Only read operations with a concrete implementation are allowed.
 * Writes and unimplemented reads throw to prevent silent data loss.
 */
export async function directFallback<T>(
	method: string,
	params?: Record<string, unknown>,
): Promise<T> {
	if (!FALLBACK_METHODS.has(method)) {
		throw new DaemonUnavailableError(
			`Operation '${method}' requires daemon — ` +
			"start daemon or reset circuit breaker",
		);
	}

	// Lazy-import smriti only when needed
	const smriti = await import("@chitragupta/smriti");

	switch (method) {
		case "session.list": {
			const sessions = smriti.listSessions(
				params?.project as string | undefined,
			);
			return { sessions } as T;
		}
		case "session.show": {
			const session = smriti.loadSession(
				params?.id as string, params?.project as string,
			);
			return session as T;
		}
		case "session.dates": {
			const dates = smriti.listSessionDates(
				typeof params?.project === "string" ? params.project : undefined,
			);
			return { dates } as T;
		}
		case "session.projects": {
			const projects = smriti.listSessionProjects();
			return { projects } as T;
		}
		case "turn.list": {
			const turns = smriti.listTurnsWithTimestamps(
				params?.sessionId as string,
				params?.project as string,
			);
			return { turns } as T;
		}
		case "memory.file_search": {
			const search = await import("@chitragupta/smriti/search");
			return { results: search.searchMemory(params?.query as string) } as T;
		}
		case "memory.scopes": {
			const memStore = await import("@chitragupta/smriti/memory-store");
			return { scopes: memStore.listMemoryScopes() } as T;
		}
		case "day.show": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { date: params?.date, content: dayCon.readDayFile(params?.date as string) ?? null } as T;
		}
		case "day.list": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { dates: dayCon.listDayFiles() } as T;
		}
		case "day.search": {
			const dayCon = await import("@chitragupta/smriti/day-consolidation");
			return { results: dayCon.searchDayFiles(params?.query as string, { limit: Number(params?.limit ?? 10) }) } as T;
		}
		case "context.load": {
			const provider = await import("@chitragupta/smriti/provider-bridge");
			const ctx = await provider.loadProviderContext(params?.project as string);
			return { assembled: ctx.assembled, itemCount: ctx.itemCount } as T;
		}
		case "memory.unified_recall": {
			const { recall } = await import("@chitragupta/smriti/unified-recall");
			const recallResults = await recall(
				params?.query as string,
				{ limit: Number(params?.limit ?? 5), project: params?.project as string | undefined },
			);
			return { results: recallResults } as T;
		}
		case "turn.since": {
			const turns = smriti.getTurnsSince(
				params?.sessionId as string, Number(params?.sinceTurnNumber ?? 0),
			);
			return { turns } as T;
		}
		case "turn.max_number": {
			const maxTurn = smriti.getMaxTurnNumber(params?.sessionId as string);
			return { maxTurn } as T;
		}
		case "session.modified_since": {
			const modified = smriti.getSessionsModifiedSince(
				params?.project as string, Number(params?.sinceMs ?? 0),
			);
			return { sessions: modified } as T;
		}
		case "vidhi.list": {
			const { VidhiEngine } = await import("@chitragupta/smriti");
			const engine = new VidhiEngine({ project: params?.project as string });
			return { vidhis: engine.getVidhis(params?.project as string, Number(params?.limit ?? 10)) } as T;
		}
		case "vidhi.match": {
			const { VidhiEngine: VE } = await import("@chitragupta/smriti");
			const ve = new VE({ project: params?.project as string });
			return { match: ve.match(params?.query as string) ?? null } as T;
		}
		case "daemon.ping":
			return { pong: false, mode: "direct-fallback" } as T;
		case "daemon.health":
			return { status: "degraded", mode: "direct-fallback" } as T;
		default:
			// Unreachable — FALLBACK_METHODS gate ensures only implemented methods reach here.
			throw new DaemonUnavailableError(`No fallback for '${method}'`);
	}
}
