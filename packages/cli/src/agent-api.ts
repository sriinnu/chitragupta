/**
 * Agent Tree HTTP API — serialization helpers and route handlers.
 *
 * Provides pure functions for converting Agent tree structures into
 * JSON-serializable objects for the Dvaara HTTP API. These helpers
 * work through the Agent's public API only — no private field access,
 * no imports from internal anina modules.
 */

import type { Agent } from "@chitragupta/anina";

// ─── Serializable Types ──────────────────────────────────────────────────────

/** Flat representation of an agent for API responses. */
export interface AgentInfo {
	id: string;
	status: string;
	depth: number;
	purpose: string;
	profile: string;
	model: string;
	childCount: number;
	parentId: string | null;
}

/** Extended agent info with relational data. */
export interface AgentDetail extends AgentInfo {
	childIds: string[];
	ancestry: string[];
}

/** Recursive tree node for subtree responses. */
export interface AgentTreeNode {
	id: string;
	status: string;
	depth: number;
	purpose: string;
	profile: string;
	model: string;
	children: AgentTreeNode[];
}

/** Aggregate statistics across the agent tree. */
export interface AgentStats {
	total: number;
	running: number;
	idle: number;
	completed: number;
	aborted: number;
	error: number;
	maxDepth: number;
	avgDepth: number;
}

// ─── Serialization Functions ─────────────────────────────────────────────────

/**
 * Extract a flat, serializable snapshot from an Agent instance.
 * Pure function — no side effects.
 */
export function serializeAgent(agent: Agent): AgentInfo {
	return {
		id: agent.id,
		status: agent.getStatus(),
		depth: agent.depth,
		purpose: agent.purpose,
		profile: agent.getProfileId(),
		model: agent.getModel(),
		childCount: agent.getChildren().length,
		parentId: agent.getParent()?.id ?? null,
	};
}

/**
 * Extract detailed agent info including child IDs and ancestry chain.
 * Uses Agent.getAncestors() which returns [parent, grandparent, ..., root].
 */
export function serializeAgentDetail(agent: Agent): AgentDetail {
	const ancestors = agent.getAncestors();
	return {
		...serializeAgent(agent),
		childIds: [...agent.getChildren()].map((c) => c.id),
		ancestry: ancestors.map((a) => a.id),
	};
}

/**
 * Recursively serialize an agent and all its descendants into a tree structure.
 */
export function serializeTree(agent: Agent): AgentTreeNode {
	return {
		id: agent.id,
		status: agent.getStatus(),
		depth: agent.depth,
		purpose: agent.purpose,
		profile: agent.getProfileId(),
		model: agent.getModel(),
		children: [...agent.getChildren()].map((child) => serializeTree(child as Agent)),
	};
}

/**
 * Produce a flat list of all agents in the tree rooted at the given agent.
 * Includes the root itself and all descendants via Agent.getDescendants().
 */
export function listAllAgents(rootAgent: Agent): AgentInfo[] {
	const root = rootAgent.getRoot();
	const agents: AgentInfo[] = [serializeAgent(root)];
	const descendants = root.getDescendants();
	for (const desc of descendants) {
		agents.push(serializeAgent(desc as Agent));
	}
	return agents;
}

/**
 * Find an agent by ID in the tree. Delegates to Agent.findAgent().
 * Returns null if not found.
 */
export function findAgentById(rootAgent: Agent, id: string): Agent | null {
	return rootAgent.findAgent(id);
}

/**
 * Count the number of descendants that would be aborted along with the target.
 * Uses depth-first traversal via getChildren().
 */
export function countDescendants(agent: Agent): number {
	let count = 0;
	const stack: Agent[] = [...agent.getChildren() as unknown as Agent[]];
	while (stack.length > 0) {
		const current = stack.pop()!;
		count++;
		stack.push(...current.getChildren() as unknown as Agent[]);
	}
	return count;
}

/**
 * Compute aggregate statistics for the full agent tree.
 */
export function computeAgentStats(rootAgent: Agent): AgentStats {
	const allAgents = listAllAgents(rootAgent);
	const stats: AgentStats = {
		total: allAgents.length,
		running: 0,
		idle: 0,
		completed: 0,
		aborted: 0,
		error: 0,
		maxDepth: 0,
		avgDepth: 0,
	};

	let depthSum = 0;
	for (const info of allAgents) {
		depthSum += info.depth;
		if (info.depth > stats.maxDepth) stats.maxDepth = info.depth;

		switch (info.status) {
			case "running": stats.running++; break;
			case "idle": stats.idle++; break;
			case "completed": stats.completed++; break;
			case "aborted": stats.aborted++; break;
			case "error": stats.error++; break;
		}
	}

	stats.avgDepth = allAgents.length > 0
		? Math.round((depthSum / allAgents.length) * 100) / 100
		: 0;

	return stats;
}
