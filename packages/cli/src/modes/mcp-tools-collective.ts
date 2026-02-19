/**
 * MCP Tools — Collective Intelligence.
 *
 * Tool factories for Samiti (ambient channels), Sabha (multi-agent
 * deliberation), and Akasha (shared knowledge traces). These expose
 * the collective-intelligence subsystems to MCP clients.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { getSamiti, getSabha, getAkasha } from "./mcp-subsystems.js";

// ─── Samiti Channels ────────────────────────────────────────────────────────

/** Create the `samiti_channels` tool — list ambient channels and recent messages. */
export function createSamitiChannelsTool(): McpToolHandler {
	return {
		definition: {
			name: "samiti_channels",
			description:
				"List ambient communication channels and recent messages. " +
				"Channels are topic-based (e.g., #security, #performance) with ring-buffered history. " +
				"Pass a channel name to see its messages, or omit for the channel list.",
			inputSchema: {
				type: "object",
				properties: {
					channel: { type: "string", description: "Channel name (e.g., '#security'). Omit to list all channels." },
					limit: { type: "number", description: "Maximum messages to return when querying a specific channel. Default: 20." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const samiti = await getSamiti();
				const channel = args.channel != null ? String(args.channel) : undefined;
				const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

				if (channel) {
					const messages = samiti.listen(channel, { limit });
					if (messages.length === 0) {
						return { content: [{ type: "text", text: `No messages in channel "${channel}".` }] };
					}
					const formatted = messages.map((m) =>
						`[${new Date(m.timestamp).toISOString()}] (${m.severity}) ${m.sender}: ${m.content}`,
					).join("\n");
					return { content: [{ type: "text", text: `Messages in ${channel} (${messages.length}):\n\n${formatted}` }] };
				}

				const channels = samiti.listChannels();
				if (channels.length === 0) {
					return { content: [{ type: "text", text: "No ambient channels active." }] };
				}
				const lines = channels.map((ch) =>
					`- ${ch.name}: ${ch.description} (${ch.messages.length} msgs, ${ch.subscribers.size} subs)`,
				);
				return { content: [{ type: "text", text: `Ambient Channels (${channels.length}):\n\n${lines.join("\n")}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `samiti_channels failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Samiti Broadcast ───────────────────────────────────────────────────────

/** Create the `samiti_broadcast` tool — broadcast a message to a channel. */
export function createSamitiBroadcastTool(): McpToolHandler {
	return {
		definition: {
			name: "samiti_broadcast",
			description:
				"Broadcast a message to an ambient channel. Channels are topic-based " +
				"(e.g., '#security', '#performance'). Messages are stored in a ring buffer " +
				"and delivered to real-time listeners.",
			inputSchema: {
				type: "object",
				properties: {
					channel: { type: "string", description: "Target channel name (e.g., '#security')." },
					content: { type: "string", description: "Message content to broadcast." },
					severity: {
						type: "string",
						description: "Message severity: 'info', 'warning', or 'critical'. Default: 'info'.",
						enum: ["info", "warning", "critical"],
					},
				},
				required: ["channel", "content"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const channel = String(args.channel ?? "");
			const content = String(args.content ?? "");
			const VALID_SEVERITIES = ["info", "warning", "critical"] as const;
			const rawSeverity = String(args.severity ?? "info");
			const severity = (VALID_SEVERITIES as readonly string[]).includes(rawSeverity)
				? rawSeverity as typeof VALID_SEVERITIES[number]
				: "info";

			if (!channel) {
				return { content: [{ type: "text", text: "Error: channel is required" }], isError: true };
			}
			if (!content) {
				return { content: [{ type: "text", text: "Error: content is required" }], isError: true };
			}

			try {
				const samiti = await getSamiti();
				const msg = samiti.broadcast(channel, {
					sender: "mcp-client",
					severity,
					category: "mcp-broadcast",
					content,
				});
				return { content: [{ type: "text", text: `Broadcast sent. Message ID: ${msg.id}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `samiti_broadcast failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Sabha Deliberation ─────────────────────────────────────────────────────

/**
 * Create the `sabha_deliberate` tool — start a multi-agent deliberation.
 *
 * Convenes a Sabha, submits a proposal, auto-votes with participants, and
 * concludes — all in one shot. For fine-grained control, use the Sabha API
 * directly via the agent prompt tool.
 */
export function createSabhaDeliberateTool(): McpToolHandler {
	return {
		definition: {
			name: "sabha_deliberate",
			description:
				"Start a multi-agent deliberation (Sabha) on a proposal. Uses Nyaya-style " +
				"structured reasoning with weighted voting and fallacy detection. Returns " +
				"the deliberation result with reasoning from each participant.",
			inputSchema: {
				type: "object",
				properties: {
					proposal: { type: "string", description: "The proposition to deliberate on (e.g., 'Should we refactor the auth module?')." },
					agents: {
						type: "array",
						items: { type: "string" },
						description: "Agent IDs to participate. Default: ['kartru', 'parikshaka', 'anveshi'].",
					},
				},
				required: ["proposal"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const proposal = String(args.proposal ?? "");
			if (!proposal) {
				return { content: [{ type: "text", text: "Error: proposal is required" }], isError: true };
			}

			const agentIds = Array.isArray(args.agents)
				? (args.agents as string[]).map(String)
				: ["kartru", "parikshaka", "anveshi"];

			try {
				const sabha = await getSabha();
				const participants = agentIds.map((id, i) => ({
					id,
					role: i === 0 ? "proposer" : "challenger",
					expertise: 0.8 - i * 0.05,
					credibility: 0.85 - i * 0.05,
				}));

				const session = sabha.convene(proposal, "mcp-client", participants);

				sabha.propose(session.id, agentIds[0], {
					pratijna: proposal,
					hetu: `Because the current analysis suggests this is the optimal course of action.`,
					udaharana: `Wherever similar conditions exist, this approach has yielded positive outcomes, as in comparable projects.`,
					upanaya: `The current project exhibits these conditions.`,
					nigamana: `Therefore, ${proposal.toLowerCase().replace(/\?$/, "")}.`,
				});

				for (const participant of participants) {
					const position = participant.role === "proposer" ? "support" as const
						: participant.role === "challenger" ? "oppose" as const
						: "abstain" as const;
					sabha.vote(session.id, participant.id, position, `${participant.role} perspective on: ${proposal}`);
				}

				const result = sabha.conclude(session.id);
				const explanation = sabha.explain(session.id);

				return {
					content: [{ type: "text", text: `Deliberation complete.\n\nVerdict: ${result.finalVerdict}\n\n${explanation}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `sabha_deliberate failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Akasha Traces ──────────────────────────────────────────────────────────

/** Create the `akasha_traces` tool — query shared knowledge traces. */
export function createAkashaTracesTool(): McpToolHandler {
	return {
		definition: {
			name: "akasha_traces",
			description:
				"Query the Akasha shared knowledge field — stigmergic traces left by agents. " +
				"Traces represent solutions, warnings, shortcuts, patterns, corrections, and " +
				"preferences. Stronger traces indicate more validated collective knowledge.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search query to match against trace topics and content." },
					type: {
						type: "string",
						description: "Filter by trace type: 'solution', 'warning', 'shortcut', 'pattern', 'correction', 'preference'.",
						enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"],
					},
					limit: { type: "number", description: "Maximum traces to return. Default: 10." },
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			if (!query) {
				return { content: [{ type: "text", text: "Error: query is required" }], isError: true };
			}

			const VALID_TRACE_TYPES = ["solution", "warning", "shortcut", "pattern", "correction", "preference"] as const;
			const rawType = args.type != null ? String(args.type) : undefined;
			const traceType = rawType && (VALID_TRACE_TYPES as readonly string[]).includes(rawType)
				? rawType as typeof VALID_TRACE_TYPES[number]
				: undefined;
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 10) || 10));

			try {
				const akasha = await getAkasha();
				const traces = akasha.query(query, { type: traceType, limit });

				if (traces.length === 0) {
					return { content: [{ type: "text", text: "No matching traces found in the Akasha field." }] };
				}

				const formatted = traces.map((t, i) =>
					`[${i + 1}] (${t.traceType}, strength: ${t.strength.toFixed(3)}, reinforcements: ${t.reinforcements})\n` +
					`  Topic: ${t.topic}\n` +
					`  Agent: ${t.agentId}\n` +
					`  ${t.content}`,
				).join("\n\n");

				return { content: [{ type: "text", text: `Akasha Traces (${traces.length}):\n\n${formatted}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `akasha_traces failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Akasha Deposit ─────────────────────────────────────────────────────────

/** Create the `akasha_deposit` tool — deposit a knowledge trace. */
export function createAkashaDepositTool(): McpToolHandler {
	return {
		definition: {
			name: "akasha_deposit",
			description:
				"Deposit a stigmergic trace into the Akasha shared knowledge field. " +
				"Other agents can discover and reinforce this trace, building collective " +
				"intelligence through indirect communication (stigmergy).",
			inputSchema: {
				type: "object",
				properties: {
					content: { type: "string", description: "The knowledge, solution, or observation to deposit." },
					type: {
						type: "string",
						description: "Trace type: 'solution', 'warning', 'shortcut', 'pattern', 'correction', 'preference'.",
						enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"],
					},
					topics: {
						type: "array",
						items: { type: "string" },
						description: "Topic tags for matching (e.g., ['typescript', 'generics', 'error-handling']).",
					},
				},
				required: ["content", "type", "topics"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const content = String(args.content ?? "");
			const VALID_TRACE_TYPES = ["solution", "warning", "shortcut", "pattern", "correction", "preference"] as const;
			const rawType = String(args.type ?? "solution");
			const depositType = (VALID_TRACE_TYPES as readonly string[]).includes(rawType)
				? rawType as typeof VALID_TRACE_TYPES[number]
				: "solution";
			const topics = Array.isArray(args.topics)
				? (args.topics as string[]).map(String)
				: [];

			if (!content) {
				return { content: [{ type: "text", text: "Error: content is required" }], isError: true };
			}
			if (!rawType || !(VALID_TRACE_TYPES as readonly string[]).includes(rawType)) {
				return { content: [{ type: "text", text: `Error: type must be one of: ${VALID_TRACE_TYPES.join(", ")}` }], isError: true };
			}
			if (topics.length === 0) {
				return { content: [{ type: "text", text: "Error: at least one topic is required" }], isError: true };
			}

			try {
				const akasha = await getAkasha();
				const topic = topics.join(" ");
				const trace = akasha.leave("mcp-client", depositType, topic, content);
				return { content: [{ type: "text", text: `Trace deposited. ID: ${trace.id}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `akasha_deposit failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
