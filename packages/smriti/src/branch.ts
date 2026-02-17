/**
 * @chitragupta/smriti — Session branching.
 *
 * Create branches of sessions (forking from a specific turn)
 * and build trees of session lineage.
 */

import { SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionTree, SessionTreeNode } from "./types.js";
import { loadSession, createSession, saveSession, listSessions } from "./session-store.js";

/**
 * Branch a session, creating a new session that is a deep copy of the original
 * up to the specified turn number.
 *
 * The branched session inherits the original's agent, model, and tags (plus a
 * `branch:<name>` tag). Cost and token data are carried over proportionally.
 *
 * @param sessionId - The source session ID to branch from.
 * @param project - The project path.
 * @param branchName - A human-readable label for the branch.
 * @param fromTurn - The turn number to branch from (inclusive). If omitted, copies all turns.
 * @returns The new branched {@link Session}.
 * @throws {SessionError} If the source session does not exist, or if `fromTurn` is
 *   before all existing turns.
 *
 * @example
 * ```ts
 * const branch = branchSession("s-abc", "/project", "refactor-attempt", 5);
 * ```
 */
export function branchSession(
	sessionId: string,
	project: string,
	branchName: string,
	fromTurn?: number,
): Session {
	// Load the original session
	const original = loadSession(sessionId, project);

	// Determine which turns to copy
	let turnsToKeep = original.turns;
	if (fromTurn !== undefined) {
		turnsToKeep = original.turns.filter((t) => t.turnNumber <= fromTurn);
		if (turnsToKeep.length === 0 && original.turns.length > 0) {
			throw new SessionError(
				`No turns found at or before turn ${fromTurn} in session ${sessionId}`
			);
		}
	}

	// Create a new session with branch metadata
	const branched = createSession({
		title: `${original.meta.title} [branch: ${branchName}]`,
		project,
		agent: original.meta.agent,
		model: original.meta.model,
		branch: branchName,
		parentSessionId: sessionId,
		tags: [...original.meta.tags, `branch:${branchName}`],
	});

	// Copy the turns (deep clone to avoid reference sharing)
	branched.turns = turnsToKeep.map((turn) => ({
		turnNumber: turn.turnNumber,
		role: turn.role,
		content: turn.content,
		agent: turn.agent,
		model: turn.model,
		toolCalls: turn.toolCalls
			? turn.toolCalls.map((tc) => ({
					name: tc.name,
					input: tc.input,
					result: tc.result,
					isError: tc.isError,
				}))
			: undefined,
	}));

	// Carry over cost/token data proportionally
	if (original.turns.length > 0) {
		const ratio = turnsToKeep.length / original.turns.length;
		branched.meta.totalCost = original.meta.totalCost * ratio;
		branched.meta.totalTokens = Math.round(original.meta.totalTokens * ratio);
	}

	// Save the branched session
	saveSession(branched);

	return branched;
}

/**
 * Build a tree of sessions for a project, showing parent-child branching relationships.
 *
 * Sessions with no parent are root sessions. If there is exactly one root, it becomes
 * the tree root directly. Multiple roots are wrapped under a synthetic `__root__` node.
 * An empty project returns a tree with an empty synthetic root.
 *
 * @param project - The project path to build the tree for.
 * @returns A {@link SessionTree} with the root node and its recursive children.
 */
export function getSessionTree(project: string): SessionTree {
	const allMetas = listSessions(project);

	if (allMetas.length === 0) {
		return {
			root: {
				session: createSyntheticRoot(project),
				children: [],
			},
		};
	}

	// Build a map of session ID -> meta
	const metaMap = new Map<string, SessionMeta>();
	for (const meta of allMetas) {
		metaMap.set(meta.id, meta);
	}

	// Build a map of parent ID -> children
	const childrenMap = new Map<string, SessionMeta[]>();
	const roots: SessionMeta[] = [];

	for (const meta of allMetas) {
		if (meta.parent && metaMap.has(meta.parent)) {
			const siblings = childrenMap.get(meta.parent) ?? [];
			siblings.push(meta);
			childrenMap.set(meta.parent, siblings);
		} else {
			roots.push(meta);
		}
	}

	/**
	 * Recursively build a tree node from a SessionMeta.
	 */
	function buildNode(meta: SessionMeta): SessionTreeNode {
		const children = childrenMap.get(meta.id) ?? [];
		return {
			session: meta,
			children: children
				.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())
				.map(buildNode),
		};
	}

	// Build tree nodes for all roots
	const rootNodes = roots
		.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())
		.map(buildNode);

	// If there's exactly one root, use it directly
	if (rootNodes.length === 1) {
		return { root: rootNodes[0] };
	}

	// Multiple roots: wrap under a synthetic root
	return {
		root: {
			session: createSyntheticRoot(project),
			children: rootNodes,
		},
	};
}

/**
 * Create a synthetic root meta for wrapping multiple root sessions.
 */
function createSyntheticRoot(project: string): SessionMeta {
	return {
		id: "__root__",
		title: "Session Tree Root",
		created: new Date(0).toISOString(),
		updated: new Date(0).toISOString(),
		agent: "system",
		model: "none",
		project,
		parent: null,
		branch: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
	};
}
