/**
 * @chitragupta/anina — Kaala Brahma health utilities.
 *
 * Tree traversal, orphan handling, and health reporting functions extracted
 * from KaalaBrahma class. All operate on passed-in agent maps rather than
 * accessing class state directly.
 */

import type {
	AgentHeartbeat, AgentLifecycleStatus, AgentHealthSnapshot,
	TreeHealthReport, HealReport, KaalaConfig,
} from "./agent-kaala.js";

// ─── Tree Traversal ─────────────────────────────────────────────────────────

/** Walk up the parent chain to verify ancestry. */
export function isAncestor(
	agents: Map<string, AgentHeartbeat>,
	ancestorId: string,
	descendantId: string,
): boolean {
	let cur: string | null = agents.get(descendantId)?.parentId ?? null;
	while (cur !== null) {
		if (cur === ancestorId) return true;
		cur = agents.get(cur)?.parentId ?? null;
	}
	return false;
}

/** Get all descendant IDs via iterative DFS. */
export function getDescendantIds(
	agents: Map<string, AgentHeartbeat>,
	agentId: string,
): string[] {
	const out: string[] = [];
	const stack = [...getDirectChildIds(agents, agentId)];
	while (stack.length > 0) {
		const id = stack.pop()!;
		out.push(id);
		stack.push(...getDirectChildIds(agents, id));
	}
	return out;
}

/** Get direct child IDs by scanning parentId references. */
export function getDirectChildIds(
	agents: Map<string, AgentHeartbeat>,
	agentId: string,
): string[] {
	const ids: string[] = [];
	for (const a of agents.values()) if (a.parentId === agentId) ids.push(a.agentId);
	return ids;
}

/** Count agents with a given status. */
export function countByStatus(
	agents: Map<string, AgentHeartbeat>,
	s: AgentLifecycleStatus,
): number {
	let n = 0;
	for (const a of agents.values()) if (a.status === s) n++;
	return n;
}

// ─── Orphan Handling ────────────────────────────────────────────────────────

/** Handle orphans (agents whose parent no longer exists). Returns count handled. */
export function handleOrphans(
	agents: Map<string, AgentHeartbeat>,
	config: KaalaConfig,
	now: number,
): number {
	const orphans = [...agents.values()].filter((a) => a.parentId !== null && !agents.has(a.parentId));
	if (orphans.length === 0) return 0;
	let handled = 0;

	switch (config.orphanPolicy) {
		case "cascade":
			for (const o of orphans) {
				for (const id of [...getDescendantIds(agents, o.agentId), o.agentId]) {
					const a = agents.get(id);
					if (a && a.status !== "killed" && a.status !== "completed") {
						a.status = "killed"; a.lastBeat = now; handled++;
					}
				}
			}
			break;

		case "reparent":
			for (const o of orphans) { o.parentId = null; o.depth = 0; handled++; }
			break;

		case "promote": {
			const groups = new Map<string, AgentHeartbeat[]>();
			for (const o of orphans) {
				const k = o.parentId!;
				if (!groups.has(k)) groups.set(k, []);
				groups.get(k)!.push(o);
			}
			for (const siblings of groups.values()) {
				siblings.sort((a, b) => a.startedAt - b.startedAt);
				const lead = siblings[0];
				lead.parentId = null;
				lead.depth = Math.max(0, lead.depth - 1);
				handled++;
				for (let i = 1; i < siblings.length; i++) { siblings[i].parentId = lead.agentId; handled++; }
			}
			break;
		}
	}
	return handled;
}

// ─── Health Reporting ───────────────────────────────────────────────────────

/** Build a health snapshot for a single agent. */
export function buildAgentHealthSnapshot(
	agents: Map<string, AgentHeartbeat>,
	hb: AgentHeartbeat,
	now: number,
): AgentHealthSnapshot {
	return {
		id: hb.agentId, purpose: hb.purpose, depth: hb.depth,
		parentId: hb.parentId, status: hb.status,
		age: now - hb.startedAt, lastBeatAge: now - hb.lastBeat,
		turnCount: hb.turnCount, tokenUsage: hb.tokenUsage, tokenBudget: hb.tokenBudget,
		childCount: getDirectChildIds(agents, hb.agentId).length,
		descendantCount: getDescendantIds(agents, hb.agentId).length,
	};
}

/** Build a full health report for the entire agent tree. */
export function buildTreeHealthReport(
	agents: Map<string, AgentHeartbeat>,
	now: number,
): TreeHealthReport {
	const agentSnaps: AgentHealthSnapshot[] = [];
	let alive = 0, stale = 0, dead = 0, maxD = 0;
	let oldest: { id: string; age: number } | null = null;
	let topTokens: { id: string; tokens: number } | null = null;

	for (const hb of agents.values()) {
		const age = now - hb.startedAt;
		agentSnaps.push(buildAgentHealthSnapshot(agents, hb, now));
		if (hb.depth > maxD) maxD = hb.depth;
		if (hb.status === "alive") { alive++; if (!oldest || age > oldest.age) oldest = { id: hb.agentId, age }; }
		if (hb.status === "stale") stale++;
		if (hb.status === "dead") dead++;
		if (!topTokens || hb.tokenUsage > topTokens.tokens) topTokens = { id: hb.agentId, tokens: hb.tokenUsage };
	}
	if (topTokens?.tokens === 0) topTokens = null;

	return {
		totalAgents: agents.size, aliveAgents: alive, staleAgents: stale,
		deadAgents: dead, maxDepth: maxD, oldestAgent: oldest,
		highestTokenUsage: topTokens, agents: agentSnaps,
	};
}
