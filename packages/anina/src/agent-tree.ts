/**
 * Agent tree traversal utilities.
 *
 * Provides tree-walking operations for the Agent hierarchy:
 * getParent, getRoot, getAncestors, getChildren, getDescendants,
 * getSiblings, findAgent, isDescendantOf, isAncestorOf, getTree, renderTree.
 *
 * These are implemented as methods on the Agent class. This module exports
 * a mixin-style function that adds the tree methods to an Agent prototype.
 */

import type { AgentTree, AgentTreeNode } from "./types.js";

// ─── Agent Tree Node Info ───────────────────────────────────────────────────

/**
 * Minimal interface for tree-traversal operations.
 * The real Agent class satisfies this interface.
 */
export interface TreeAgent {
  readonly id: string;
  readonly purpose: string;
  readonly depth: number;
  getParent(): TreeAgent | null;
  getChildren(): readonly TreeAgent[];
  getAgentStatus(): "idle" | "running" | "completed" | "aborted" | "error";
  getProfileId(): string;
  getModel(): string;
}

// ─── Tree Traversal Functions ───────────────────────────────────────────────

/**
 * Get the root agent by walking up the tree.
 */
export function getRoot(agent: TreeAgent): TreeAgent {
  let current: TreeAgent = agent;
  while (current.getParent() !== null) {
    current = current.getParent()!;
  }
  return current;
}

/**
 * Get all ancestors from this agent to the root (inclusive of root, exclusive of self).
 * Returns [parent, grandparent, ..., root].
 */
export function getAncestors(agent: TreeAgent): TreeAgent[] {
  const ancestors: TreeAgent[] = [];
  let current = agent.getParent();
  while (current !== null) {
    ancestors.push(current);
    current = current.getParent();
  }
  return ancestors;
}

/**
 * Get the full lineage path from root to this agent.
 * Returns [root, ..., grandparent, parent, self].
 */
export function getLineage(agent: TreeAgent): TreeAgent[] {
  const lineage = getAncestors(agent).reverse();
  lineage.push(agent);
  return lineage;
}

/**
 * Get the lineage as a readable path string.
 * Example: "root > code-reviewer > test-runner"
 */
export function getLineagePath(agent: TreeAgent): string {
  return getLineage(agent).map((a) => a.purpose).join(" > ");
}

/**
 * Get all descendants (children, grandchildren, etc.) using depth-first traversal.
 */
export function getDescendants(agent: TreeAgent): TreeAgent[] {
  const descendants: TreeAgent[] = [];
  const stack: TreeAgent[] = [...agent.getChildren()];

  while (stack.length > 0) {
    const current = stack.pop()!;
    descendants.push(current);
    stack.push(...current.getChildren());
  }

  return descendants;
}

/**
 * Get siblings (other children of the same parent). Empty for root.
 */
export function getSiblings(agent: TreeAgent): TreeAgent[] {
  const parent = agent.getParent();
  if (!parent) return [];
  return [...parent.getChildren()].filter((c) => c.id !== agent.id);
}

/**
 * Find a specific agent in the tree by ID.
 * Searches the full tree starting from root.
 */
export function findAgent(agent: TreeAgent, agentId: string): TreeAgent | null {
  const root = getRoot(agent);
  if (root.id === agentId) return root;

  const stack: TreeAgent[] = [...root.getChildren()];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id === agentId) return current;
    stack.push(...current.getChildren());
  }

  return null;
}

/**
 * Check if a given agent is an ancestor of this one.
 */
export function isDescendantOf(agent: TreeAgent, ancestorId: string): boolean {
  let current = agent.getParent();
  while (current !== null) {
    if (current.id === ancestorId) return true;
    current = current.getParent();
  }
  return false;
}

/**
 * Check if a given agent is a descendant of this one.
 */
export function isAncestorOf(agent: TreeAgent, descendantId: string): boolean {
  const stack: TreeAgent[] = [...agent.getChildren()];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id === descendantId) return true;
    stack.push(...current.getChildren());
  }
  return false;
}

/**
 * Build a snapshot of the full agent tree rooted at this agent.
 * Useful for serialization, logging, and UI rendering.
 */
export function getTree(agent: TreeAgent): AgentTree {
  const buildNode = (a: TreeAgent): AgentTreeNode => ({
    id: a.id,
    purpose: a.purpose,
    profileId: a.getProfileId(),
    model: a.getModel(),
    depth: a.depth,
    status: a.getAgentStatus(),
    children: [...a.getChildren()].map(buildNode),
  });

  const root = buildNode(agent);

  let totalAgents = 0;
  let maxDepth = 0;
  const stack: AgentTreeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    totalAgents++;
    if (node.depth > maxDepth) maxDepth = node.depth;
    stack.push(...node.children);
  }

  return { root, totalAgents, maxDepth };
}

/**
 * Render the tree as an ASCII string for debugging / TUI display.
 *
 * Example output:
 * root [chitragupta] (completed)
 * +-- code-reviewer [chitragupta] (completed)
 * |   +-- test-runner [minimal] (running)
 * +-- doc-writer [friendly] (idle)
 */
export function renderTree(agent: TreeAgent): string {
  const lines: string[] = [];

  const render = (a: TreeAgent, prefix: string, isLast: boolean, isRoot: boolean) => {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const statusTag = `(${a.getAgentStatus()})`;
    const line = `${prefix}${connector}${a.purpose} [${a.getProfileId()}] ${statusTag}`;
    lines.push(line);

    const children = [...a.getChildren()];
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < children.length; i++) {
      render(children[i], childPrefix, i === children.length - 1, false);
    }
  };

  render(agent, "", true, true);
  return lines.join("\n");
}
