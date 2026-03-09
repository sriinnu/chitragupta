import type { DurableAkashaRef } from "./mcp-subsystems-lucy-types.js";

export async function getAgentDbBestEffort(): Promise<unknown | null> {
	try {
		const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
		return DatabaseManager.instance().get("agent");
	} catch {
		return null;
	}
}

export async function refreshAkashaFromDb(
	akasha: DurableAkashaRef,
	lastRefreshAt: number,
	refreshIntervalMs: number,
	force = false,
): Promise<number> {
	if (!force && Date.now() - lastRefreshAt < refreshIntervalMs) return lastRefreshAt;
	const db = await getAgentDbBestEffort();
	if (!db) return lastRefreshAt;
	try {
		akasha.restore(db);
		return Date.now();
	} catch {
		return lastRefreshAt;
	}
}
