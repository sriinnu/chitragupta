/**
 * @chitragupta/smriti — GraphRAG graph building and incremental indexing.
 *
 * Functions for constructing the knowledge graph from sessions and memories,
 * incremental session/memory indexing, and concept extraction.
 */

import type {
  Session,
  MemoryResult,
  MemoryScope,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
} from "./types.js";
import { semanticChunk } from "./graphrag-extraction.js";
import type { ExtractedEntity } from "./graphrag-extraction.js";
import { createEdge } from "./bitemporal.js";

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Convert a MemoryScope to a unique string ID for graph node identification.
 */
export function scopeToId(scope: MemoryScope): string {
  switch (scope.type) {
    case "global":
      return "memory-global";
    case "project":
      return `memory-project-${scope.path}`;
    case "agent":
      return `memory-agent-${scope.agentId}`;
    case "session":
      return `memory-session-${scope.sessionId}`;
  }
}

/**
 * Convert a MemoryScope to a human-readable label.
 */
export function scopeToLabel(scope: MemoryScope): string {
  switch (scope.type) {
    case "global":
      return "Global Memory";
    case "project":
      return `Project Memory: ${scope.path}`;
    case "agent":
      return `Agent Memory: ${scope.agentId}`;
    case "session":
      return `Session Memory: ${scope.sessionId}`;
  }
}

// ─── Engine Context Interface ───────────────────────────────────────────────

/**
 * Abstraction over the GraphRAGEngine methods needed by builder functions.
 * Avoids circular dependency on the full engine class.
 */
export interface GraphRAGContext {
  getEmbedding(text: string): Promise<number[]>;
  extractEntities(text: string): Promise<ExtractedEntity[]>;
}

// ─── Session Node Creation ──────────────────────────────────────────────────

/**
 * Create a graph node for a session.
 */
export async function createSessionNode(
  ctx: GraphRAGContext,
  session: Session,
): Promise<GraphNode> {
  const summaryText = `${session.meta.title} - ${session.meta.tags.join(", ")}`;
  return {
    id: session.meta.id,
    type: "session",
    label: session.meta.title,
    content: summaryText,
    embedding: await ctx.getEmbedding(summaryText),
    metadata: {
      agent: session.meta.agent,
      model: session.meta.model,
      project: session.meta.project,
      created: session.meta.created,
      turnCount: session.turns.length,
    },
  };
}

// ─── Concept Extraction ─────────────────────────────────────────────────────

/**
 * Extract concepts from all content nodes using LLM entity extraction
 * (or keyword fallback), and create concept nodes + edges.
 */
export async function extractConceptsFromNodes(
  ctx: GraphRAGContext,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  const entityIndex = new Map<string, { entity: ExtractedEntity; sourceIds: string[] }>();

  for (const node of nodes) {
    if (!node.content || node.type === "concept") continue;

    const entities = await ctx.extractEntities(node.content);

    for (const entity of entities) {
      const key = entity.name.toLowerCase();
      const existing = entityIndex.get(key);
      if (existing) {
        existing.sourceIds.push(node.id);
        if (entity.description.length > existing.entity.description.length) {
          existing.entity = entity;
        }
      } else {
        entityIndex.set(key, { entity, sourceIds: [node.id] });
      }
    }
  }

  for (const [key, data] of entityIndex) {
    if (data.sourceIds.length < 2) continue;

    const conceptId = `concept-${key.replace(/\s+/g, "-")}`;
    if (nodes.some((n) => n.id === conceptId)) continue;

    const conceptNode: GraphNode = {
      id: conceptId,
      type: "concept",
      label: data.entity.name,
      content: data.entity.description || data.entity.name,
      metadata: {
        entityType: data.entity.type,
        sourceCount: data.sourceIds.length,
      },
    };
    nodes.push(conceptNode);

    for (const sourceId of data.sourceIds) {
      edges.push(createEdge(sourceId, conceptId, "mentions_concept", 0.5));
    }
  }
}

// ─── Session Turn Indexing ───────────────────────────────────────────────────

/**
 * Index session turns into nodes and edges arrays. Creates chunk nodes for
 * turn content (via semantic chunking) and tool call nodes.
 */
export async function indexSessionTurns(
  ctx: GraphRAGContext,
  session: Session,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  for (const turn of session.turns) {
    const chunks = semanticChunk(turn.content);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const chunkId = `${session.meta.id}-turn-${turn.turnNumber}-chunk-${chunkIdx}`;
      const chunkNode: GraphNode = {
        id: chunkId,
        type: "session",
        label: `Turn ${turn.turnNumber} (${turn.role}) chunk ${chunkIdx + 1}/${chunks.length}`,
        content: chunk.text,
        embedding: await ctx.getEmbedding(chunk.text),
        metadata: {
          sessionId: session.meta.id,
          turnNumber: turn.turnNumber,
          role: turn.role,
          chunkIndex: chunkIdx,
          totalChunks: chunks.length,
          startSentence: chunk.startSentence,
          endSentence: chunk.endSentence,
        },
      };
      nodes.push(chunkNode);

      edges.push(createEdge(session.meta.id, chunkId, "contains_chunk", 1.0));

      if (chunkIdx > 0) {
        const prevChunkId = `${session.meta.id}-turn-${turn.turnNumber}-chunk-${chunkIdx - 1}`;
        edges.push(createEdge(prevChunkId, chunkId, "followed_by", 0.7));
      }
    }

    if (turn.toolCalls) {
      for (let i = 0; i < turn.toolCalls.length; i++) {
        const tc = turn.toolCalls[i];
        const toolNodeId = `${session.meta.id}-turn-${turn.turnNumber}-tool-${i}`;
        const toolNode: GraphNode = {
          id: toolNodeId,
          type: "file",
          label: `Tool: ${tc.name}`,
          content: tc.input.slice(0, 500),
          metadata: {
            toolName: tc.name,
            isError: tc.isError ?? false,
          },
        };
        nodes.push(toolNode);

        const firstChunkId = `${session.meta.id}-turn-${turn.turnNumber}-chunk-0`;
        const linkTarget = nodes.some((n) => n.id === firstChunkId)
          ? firstChunkId
          : session.meta.id;
        edges.push(createEdge(linkTarget, toolNodeId, "uses_tool", 0.8));
      }
    }
  }

  if (session.meta.parent) {
    edges.push(createEdge(session.meta.parent, session.meta.id, "branched_to", 0.9));
  }
}

// ─── Memory Indexing ────────────────────────────────────────────────────────

/**
 * Build memory nodes and edges from a single memory result.
 * Uses semantic chunking for large memory content.
 */
export async function buildMemoryNodes(
  ctx: GraphRAGContext,
  memory: MemoryResult,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  const memoryId = scopeToId(memory.scope);
  const chunks = semanticChunk(memory.content);

  if (chunks.length <= 1) {
    const memoryNode: GraphNode = {
      id: memoryId,
      type: "memory",
      label: scopeToLabel(memory.scope),
      content: memory.content,
      embedding: await ctx.getEmbedding(memory.content),
      metadata: { scope: memory.scope },
    };
    nodes.push(memoryNode);
  } else {
    const memoryNode: GraphNode = {
      id: memoryId,
      type: "memory",
      label: scopeToLabel(memory.scope),
      content: chunks[0].text,
      embedding: await ctx.getEmbedding(memory.content.slice(0, 500)),
      metadata: { scope: memory.scope, totalChunks: chunks.length },
    };
    nodes.push(memoryNode);

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${memoryId}-chunk-${i}`;
      const chunkNode: GraphNode = {
        id: chunkId,
        type: "memory",
        label: `${scopeToLabel(memory.scope)} chunk ${i + 1}/${chunks.length}`,
        content: chunks[i].text,
        embedding: await ctx.getEmbedding(chunks[i].text),
        metadata: {
          scope: memory.scope,
          chunkIndex: i,
          totalChunks: chunks.length,
          startSentence: chunks[i].startSentence,
          endSentence: chunks[i].endSentence,
        },
      };
      nodes.push(chunkNode);

      edges.push(createEdge(memoryId, chunkId, "contains_chunk", 1.0));
    }
  }
}

/**
 * Build memory nodes for indexMemory (scope + raw content, not MemoryResult).
 */
export async function buildMemoryNodesFromContent(
  ctx: GraphRAGContext,
  scope: MemoryScope,
  content: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  const memoryId = scopeToId(scope);
  const chunks = semanticChunk(content);

  if (chunks.length <= 1) {
    const memoryNode: GraphNode = {
      id: memoryId,
      type: "memory",
      label: scopeToLabel(scope),
      content,
      embedding: await ctx.getEmbedding(content),
      metadata: { scope },
    };
    nodes.push(memoryNode);
  } else {
    const memoryNode: GraphNode = {
      id: memoryId,
      type: "memory",
      label: scopeToLabel(scope),
      content: chunks[0].text,
      embedding: await ctx.getEmbedding(content.slice(0, 500)),
      metadata: { scope, totalChunks: chunks.length },
    };
    nodes.push(memoryNode);

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${memoryId}-chunk-${i}`;
      const chunkNode: GraphNode = {
        id: chunkId,
        type: "memory",
        label: `${scopeToLabel(scope)} chunk ${i + 1}/${chunks.length}`,
        content: chunks[i].text,
        embedding: await ctx.getEmbedding(chunks[i].text),
        metadata: {
          scope,
          chunkIndex: i,
          totalChunks: chunks.length,
          startSentence: chunks[i].startSentence,
          endSentence: chunks[i].endSentence,
        },
      };
      nodes.push(chunkNode);

      edges.push(createEdge(memoryId, chunkId, "contains_chunk", 1.0));
    }
  }
}

// ─── Graph Cleanup ──────────────────────────────────────────────────────────

/**
 * Remove all nodes and edges related to a session from the graph.
 */
export function removeSessionFromGraph(graph: KnowledgeGraph, sessionId: string): void {
  const nodeIdsToRemove = new Set<string>();

  for (const node of graph.nodes) {
    if (node.id === sessionId || node.id.startsWith(`${sessionId}-turn-`)) {
      nodeIdsToRemove.add(node.id);
    }
  }

  graph.nodes = graph.nodes.filter((n) => !nodeIdsToRemove.has(n.id));
  graph.edges = graph.edges.filter(
    (e) => !nodeIdsToRemove.has(e.source) && !nodeIdsToRemove.has(e.target)
  );
}

/**
 * Remove all nodes and edges related to a memory scope from the graph.
 */
export function removeMemoryFromGraph(graph: KnowledgeGraph, scope: MemoryScope): void {
  const memoryId = scopeToId(scope);

  graph.nodes = graph.nodes.filter(
    (n) => n.id !== memoryId && !n.id.startsWith(`${memoryId}-chunk-`)
  );
  graph.edges = graph.edges.filter(
    (e) =>
      e.source !== memoryId &&
      e.target !== memoryId &&
      !e.source.startsWith(`${memoryId}-chunk-`) &&
      !e.target.startsWith(`${memoryId}-chunk-`)
  );
}
