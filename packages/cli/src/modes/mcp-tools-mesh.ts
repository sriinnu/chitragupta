/**
 * MCP Tools — P2P Actor Mesh (Sutra).
 *
 * Tool factories for the distributed actor mesh: spawning actors, sending
 * messages, capability-based routing, peer discovery, gossip health, and
 * topology inspection. Exposes @chitragupta/sutra's P2P capabilities.
 *
 * @module
 */
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { formatMeshPeersSnapshot } from "../mesh-observability.js";
import {
	askMeshWithFallback,
	findMeshCapabilityWithFallback,
	getMeshGossipWithFallback,
	getMeshPeersWithFallback,
	getMeshStatusWithFallback,
	getMeshTopologyWithFallback,
	sendMeshMessageWithFallback,
	spawnMeshActorWithFallback,
} from "./mcp-tools-mesh-runtime.js";

/** Create the `mesh_status` tool — get mesh system status. */
export function createMeshStatusTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_status",
			description:
				"Get the P2P actor mesh system status. Shows actor count, peer count, " +
				"connectivity, running state, and whether P2P networking is bootstrapped.",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(): Promise<McpToolResult> {
			try {
				const status = await getMeshStatusWithFallback();
				return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_status failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_spawn ──────────────────────────────────────────────────────────────

/** Create the `mesh_spawn` tool — spawn an actor with optional capabilities. */
export function createMeshSpawnTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_spawn",
			description:
				"Spawn a new actor in the P2P mesh with optional capabilities and expertise. " +
				"The actor will be discoverable by other peers via gossip propagation.",
			inputSchema: {
				type: "object",
				properties: {
					actorId: { type: "string", description: "Unique ID for the actor." },
					capabilities: {
						type: "array", items: { type: "string" },
						description: "Capabilities this actor provides (e.g., ['code-review', 'typescript']).",
					},
					expertise: {
						type: "array", items: { type: "string" },
						description: "Expertise tags for gossip discovery.",
					},
				},
				required: ["actorId"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const actorId = String(args.actorId ?? "");
			if (!actorId) {
				return { content: [{ type: "text", text: "Error: actorId is required" }], isError: true };
			}

			const capabilities = Array.isArray(args.capabilities)
				? (args.capabilities as string[]).map(String)
				: undefined;
			const expertise = Array.isArray(args.expertise)
				? (args.expertise as string[]).map(String)
				: undefined;

			try {
				await spawnMeshActorWithFallback({ actorId, capabilities, expertise });

				return {
					content: [{ type: "text", text:
						`Actor "${actorId}" spawned.` +
						(capabilities?.length ? ` Capabilities: [${capabilities.join(", ")}]` : "") +
						(expertise?.length ? ` Expertise: [${expertise.join(", ")}]` : ""),
					}],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_spawn failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_send ───────────────────────────────────────────────────────────────

/** Create the `mesh_send` tool — fire-and-forget message to an actor. */
export function createMeshSendTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_send",
			description:
				"Send a fire-and-forget message to an actor in the mesh. " +
				"Supports capability routing via 'capability:X' prefix in the target.",
			inputSchema: {
				type: "object",
				properties: {
					from: { type: "string", description: "Sender actor ID." },
					to: { type: "string", description: "Target actor ID or 'capability:X' for capability routing." },
					payload: { description: "Message payload (any JSON value)." },
					priority: { type: "number", enum: [0, 1, 2, 3], description: "Priority: 0=low, 1=normal, 2=high, 3=critical. Default: 1." },
				},
				required: ["from", "to", "payload"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const from = String(args.from ?? "");
			const to = String(args.to ?? "");
			if (!from || !to) {
				return { content: [{ type: "text", text: "Error: from and to are required" }], isError: true };
			}

			try {
				await sendMeshMessageWithFallback({
					from,
					to,
					payload: args.payload,
					priority: args.priority != null ? Number(args.priority) : undefined,
				});
				return { content: [{ type: "text", text: `Message sent from "${from}" to "${to}".` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_send failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_ask ────────────────────────────────────────────────────────────────

/** Create the `mesh_ask` tool — request-reply message to an actor. */
export function createMeshAskTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_ask",
			description:
				"Send a request-reply message to an actor and await the response. " +
				"Returns the reply payload. Times out after the configured default (30s).",
			inputSchema: {
				type: "object",
				properties: {
					from: { type: "string", description: "Sender actor ID." },
					to: { type: "string", description: "Target actor ID or 'capability:X' for capability routing." },
					payload: { description: "Message payload (any JSON value)." },
					timeout: { type: "number", description: "Timeout in ms. Default: 30000." },
				},
				required: ["from", "to", "payload"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const from = String(args.from ?? "");
			const to = String(args.to ?? "");
			if (!from || !to) {
				return { content: [{ type: "text", text: "Error: from and to are required" }], isError: true };
			}

			try {
				const reply = await askMeshWithFallback({
					from,
					to,
					payload: args.payload,
					timeout: args.timeout != null ? Number(args.timeout) : undefined,
				});
				return { content: [{ type: "text", text: JSON.stringify(reply, null, 2) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_ask failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_find_capability ────────────────────────────────────────────────────

/** Create the `mesh_find_capability` tool — find peers by capability. */
export function createMeshFindCapabilityTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_find_capability",
			description:
				"Find peers in the mesh that declare specific capabilities. Uses the " +
				"new CapabilityRouter with multi-factor scoring (capability × reliability " +
				"× recency × load). Supports three strategies: best, weighted-random, round-robin.",
			inputSchema: {
				type: "object",
				properties: {
					capabilities: {
						type: "array", items: { type: "string" },
						description: "Required capabilities — find peers with ALL of these.",
					},
					strategy: {
						type: "string", enum: ["best", "weighted-random", "round-robin"],
						description: "Selection strategy. Default: 'best'.",
					},
					listAll: { type: "boolean", description: "If true, list all matching peers instead of selecting one. Default: false." },
				},
				required: ["capabilities"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const capabilities = Array.isArray(args.capabilities)
				? (args.capabilities as string[]).map(String) : [];
			if (capabilities.length === 0) {
				return { content: [{ type: "text", text: "Error: at least one capability is required" }], isError: true };
			}

			try {
				const formatPeer = (p: { actorId: string; status: string; capabilities?: string[]; originNodeId?: string }) =>
					`- ${p.actorId} (${p.status}) caps=[${(p.capabilities ?? []).join(",")}] node=${p.originNodeId ?? "local"}`;
				const strategy = String(args.strategy ?? "best");
				const result = await findMeshCapabilityWithFallback({
					capabilities,
					strategy,
					listAll: args.listAll === true,
				});
				const peers = (result.peers ?? []) as Array<{
					actorId: string;
					status: string;
					capabilities?: string[];
					originNodeId?: string;
				}>;
				if (args.listAll) {
					return { content: [{ type: "text", text: peers.length
						? `Matching peers (${peers.length}):\n${peers.map(formatPeer).join("\n")}`
						: `No peers with all capabilities: [${capabilities.join(", ")}]`,
					}] };
				}
				const best = result.selected as {
					actorId: string;
					status: string;
					capabilities?: string[];
					originNodeId?: string;
				} | null;
				if (!best) return { content: [{ type: "text", text: `No peer for: [${capabilities.join(", ")}]` }] };
				return { content: [{ type: "text", text:
					`Best: ${best.actorId} (${best.status}) caps=[${(best.capabilities ?? []).join(",")}] ` +
					`node=${best.originNodeId ?? "local"} strategy=${result.strategy ?? strategy}`,
				}] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_find_capability failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_peers ──────────────────────────────────────────────────────────────

/** Create the `mesh_peers` tool — list connected peers with health info. */
export function createMeshPeersTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_peers",
			description:
				"List all peers in the mesh with connection state and health info. " +
				"Shows gossip-detected peers (alive/suspect/dead) and P2P connections.",
			inputSchema: {
				type: "object",
				properties: {
					status: { type: "string", enum: ["alive", "suspect", "dead", "all"], description: "Filter by gossip status. Default: 'all'." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const statusFilter = String(args.status ?? "all");
				const status = await getMeshPeersWithFallback();
				return { content: [{ type: "text", text: formatMeshPeersSnapshot(status, statusFilter) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_peers failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_gossip ─────────────────────────────────────────────────────────────

/** Create the `mesh_gossip` tool — gossip protocol state snapshot. */
export function createMeshGossipTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_gossip",
			description:
				"Get the gossip protocol state — all known peers with their liveness " +
				"status (alive/suspect/dead), generation counters, and capabilities.",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(): Promise<McpToolResult> {
			try {
				const summary = await getMeshGossipWithFallback();
				return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_gossip failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── mesh_topology ───────────────────────────────────────────────────────────

/** Create the `mesh_topology` tool — full mesh topology map. */
export function createMeshTopologyTool(): McpToolHandler {
	return {
		definition: {
			name: "mesh_topology",
			description:
				"Get a comprehensive topology view of the mesh: actors, their locations, " +
				"capabilities, peer connections, and actor distribution across nodes.",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(): Promise<McpToolResult> {
			try {
				const topology = await getMeshTopologyWithFallback();
				return { content: [{ type: "text", text: JSON.stringify(topology, null, 2) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `mesh_topology failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
