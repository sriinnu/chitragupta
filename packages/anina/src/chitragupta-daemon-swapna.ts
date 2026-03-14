import type { ConsolidationEvent } from "./chitragupta-daemon-support.js";

export interface SwapnaProjectScope {
	project: string;
	sessionIds?: string[];
}

type ConsolidationEmitter = (eventName: "consolidation", event: ConsolidationEvent) => boolean;

/** Resolve project ownership for a set of pending session ids. */
export async function resolveSessionProjects(
	sessionIds: readonly string[],
): Promise<Array<{ id: string; project: string; sessionLineageKey: string | null }>> {
	try {
		const { DatabaseManager } = await import("@chitragupta/smriti");
		const db = DatabaseManager.instance().get("agent");
		const placeholders = sessionIds.map(() => "?").join(",");
		if (!placeholders) return [];
		return db.prepare(
			`SELECT id, project, json_extract(metadata, '$.sessionLineageKey') AS sessionLineageKey
			 FROM sessions
			 WHERE id IN (${placeholders})
			 ORDER BY updated_at DESC`,
		).all(...sessionIds) as Array<{ id: string; project: string; sessionLineageKey: string | null }>;
	} catch {
		const { listSessions } = await import("@chitragupta/smriti/session-store");
		const wanted = new Set(sessionIds);
		return listSessions()
			.filter((session) => wanted.has(session.id))
			.map((session) => ({
				id: session.id,
				project: session.project,
				sessionLineageKey:
					typeof session.metadata?.sessionLineageKey === "string"
						? session.metadata.sessionLineageKey
						: null,
			}));
	}
}

/**
 * Run Swapna consolidation across a set of project scopes and return the
 * session ids that were successfully processed.
 */
export async function runSwapnaForProjects(
	projects: Iterable<SwapnaProjectScope>,
	date: string,
	phasePrefix: string,
	emit: ConsolidationEmitter,
): Promise<string[]> {
	const { SwapnaConsolidation } = await import("@chitragupta/smriti");
	const processedSessionIds: string[] = [];

	for (const scope of projects) {
		const { project, sessionIds } = scope;
		try {
			const swapnaConfig = {
				project,
				sessionIds,
				maxSessionsPerCycle: 50,
				surpriseThreshold: 0.7,
				minPatternFrequency: 3,
				minSequenceLength: 2,
				minSuccessRate: 0.8,
			} as ConstructorParameters<typeof SwapnaConsolidation>[0] & { sessionIds?: string[] };
			const swapna = new SwapnaConsolidation(swapnaConfig);
			await swapna.run((phase: string, progress: number) => {
				emit("consolidation", {
					type: "progress",
					date,
					phase: `${phasePrefix}:${phase}`,
					detail: `${project} (${(progress * 100).toFixed(0)}%)`,
				});
			});
			if (sessionIds?.length) processedSessionIds.push(...sessionIds);
		} catch (err) {
			emit("consolidation", {
				type: "error",
				date,
				phase: phasePrefix,
				detail: `${project}: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	return [...new Set(processedSessionIds)];
}
