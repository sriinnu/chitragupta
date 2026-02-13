/**
 * @chitragupta/cli — MCP Server Mode.
 *
 * Runs Chitragupta as an MCP (Model Context Protocol) server, exposing
 * its tools, memory, and agent capabilities to MCP clients like
 * Claude Code, Codex, Gemini CLI, or any MCP-compatible host.
 *
 * Supports two transports:
 *   - stdio: For direct process spawning (Claude Code's preferred mode)
 *   - sse:   For HTTP-based connections
 */

import type {
	McpToolHandler,
	McpToolResult,
	McpResourceHandler,
	McpContent,
	McpPromptHandler,
} from "@chitragupta/tantra";
import { McpServer, chitraguptaToolToMcp } from "@chitragupta/tantra";
import type { ChitraguptaToolHandler } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";

import fs from "fs";
import path from "path";
import os from "os";
import { getBuiltinTools, loadProjectMemory } from "../bootstrap.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface McpServerModeOptions {
	/** Transport: "stdio" for process spawning, "sse" for HTTP. Default: "stdio" */
	transport?: "stdio" | "sse";
	/** Port for SSE transport. Default: 3001 */
	port?: number;
	/** Project path for memory/session context. Default: process.cwd() */
	projectPath?: string;
	/** Server name shown to MCP clients. Default: "chitragupta" */
	name?: string;
	/** Whether to expose the agent prompt tool (requires provider config). Default: false */
	enableAgent?: boolean;
}

// ─── Additional MCP Tools ───────────────────────────────────────────────────

/**
 * Create the `chitragupta_memory_search` tool — searches project memory.
 */
function createMemorySearchTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_memory_search",
			description:
				"Search Chitragupta's project memory (GraphRAG-backed). " +
				"Returns relevant memory entries, past decisions, patterns, and conventions " +
				"learned from previous sessions.",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The search query. Be specific for better results.",
					},
					limit: {
						type: "number",
						description: "Maximum results to return. Default: 10",
					},
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 10) || 10));

			if (!query) {
				return {
					content: [{ type: "text", text: "Error: query is required" }],
					isError: true,
				};
			}

			try {
				const { searchMemory } = await import("@chitragupta/smriti/search");
				const results = searchMemory(query);
				const limited = results.slice(0, limit);

				if (limited.length === 0) {
					return {
						content: [{ type: "text", text: "No memory entries found for this query." }],
					};
				}

				const formatted = limited.map((r, i) => {
					const source = r.scope.type === "project"
						? `project:${r.scope.path}`
						: r.scope.type === "global"
							? "global"
							: r.scope.type === "agent"
								? `agent:${r.scope.agentId}`
								: `session:${r.scope.sessionId}`;
					return `[${i + 1}] (score: ${(r.relevance ?? 0).toFixed(2)}, source: ${source})\n${r.content}`;
				}).join("\n\n---\n\n");

				return {
					content: [{ type: "text", text: formatted }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `chitragupta_session_list` tool — lists recent sessions.
 */
function createSessionListTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_session_list",
			description:
				"List recent Chitragupta sessions for this project. " +
				"Shows session IDs, titles, timestamps, and turn counts.",
			inputSchema: {
				type: "object",
				properties: {
					limit: {
						type: "number",
						description: "Maximum sessions to return. Default: 20",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

			try {
				const { listSessions } = await import("@chitragupta/smriti/session-store");
				const sessions = listSessions(projectPath);
				const limited = sessions.slice(0, limit);

				if (limited.length === 0) {
					return {
						content: [{ type: "text", text: "No sessions found for this project." }],
					};
				}

				const lines = limited.map((s) =>
					`- ${s.id} | "${s.title}" | ${s.agent}/${s.model} | ${s.created}`,
				);

				return {
					content: [{ type: "text", text: `Sessions (${limited.length}):\n\n${lines.join("\n")}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `chitragupta_session_show` tool — shows a specific session.
 */
function createSessionShowTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_session_show",
			description:
				"Show the contents of a specific Chitragupta session by ID. " +
				"Returns the full conversation including user and assistant turns.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The session ID to load.",
					},
					turnLimit: {
						type: "number",
						description: "Maximum turns to include. Default: all",
					},
				},
				required: ["sessionId"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const sessionId = String(args.sessionId ?? "");
			const turnLimit = args.turnLimit != null ? (Number(args.turnLimit) || undefined) : undefined;

			if (!sessionId) {
				return {
					content: [{ type: "text", text: "Error: sessionId is required" }],
					isError: true,
				};
			}

			try {
				const { loadSession } = await import("@chitragupta/smriti/session-store");
				const session = loadSession(sessionId, projectPath);

				const turns = turnLimit ? session.turns.slice(0, turnLimit) : session.turns;
				const formatted = turns.map((t) =>
					`## Turn ${t.turnNumber} - ${t.role}${t.agent ? ` (${t.agent})` : ""}\n\n${t.content}`,
				).join("\n\n---\n\n");

				const header = [
					`Session: ${session.meta.id}`,
					`Title: ${session.meta.title}`,
					`Agent: ${session.meta.agent}`,
					`Model: ${session.meta.model}`,
					`Created: ${session.meta.created}`,
					`Turns: ${session.turns.length}`,
				].join("\n");

				return {
					content: [{ type: "text", text: `${header}\n\n${"=".repeat(60)}\n\n${formatted}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to load session: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `chitragupta_prompt` tool — delegates a task to Chitragupta's agent.
 */
function createAgentPromptTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_prompt",
			description:
				"Delegate a task to Chitragupta's AI agent. The agent has its own " +
				"memory, tools, and configuration. Use this for complex tasks that " +
				"benefit from Chitragupta's project context and memory.",
			inputSchema: {
				type: "object",
				properties: {
					message: {
						type: "string",
						description: "The prompt/task to send to Chitragupta's agent.",
					},
					provider: {
						type: "string",
						description: "AI provider to use. Default: from config (usually 'anthropic')",
					},
					model: {
						type: "string",
						description: "Model to use. Default: from config",
					},
				},
				required: ["message"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const message = String(args.message ?? "");
			if (!message) {
				return {
					content: [{ type: "text", text: "Error: message is required" }],
					isError: true,
				};
			}

			try {
				const { createChitragupta } = await import("../api.js");
				const options: Record<string, unknown> = {};
				if (args.provider) options.provider = String(args.provider);
				if (args.model) options.model = String(args.model);

				const chitragupta = await createChitragupta(options);
				try {
					const response = await chitragupta.prompt(message);
					return {
						content: [{ type: "text", text: response }],
					};
				} finally {
					await chitragupta.destroy();
				}
			} catch (err) {
				return {
					content: [{ type: "text", text: `Agent prompt failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Phase 5.3 — Multi-Agent & Collective Intelligence MCP Tools ────────────

// Duck-typed interfaces for collective intelligence subsystems.
// We avoid importing heavy classes directly — these are resolved via
// dynamic import at call time, matching the existing pattern.

/** Duck-typed Samiti (ambient channels). */
interface SamitiLike {
	listChannels(): Array<{
		name: string;
		description: string;
		messages: Array<{ id: string; sender: string; severity: string; content: string; timestamp: number }>;
		subscribers: Set<string>;
	}>;
	listen(channel: string, opts?: { limit?: number }): Array<{
		id: string; sender: string; severity: string; category: string;
		content: string; timestamp: number;
	}>;
	broadcast(
		channel: string,
		message: { sender: string; severity: "info" | "warning" | "critical"; category: string; content: string },
	): { id: string };
}

/** Duck-typed SabhaEngine (multi-agent deliberation). */
interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): { id: string };
	propose(sabhaId: string, proposerId: string, syllogism: {
		pratijna: string; hetu: string; udaharana: string; upanaya: string; nigamana: string;
	}): unknown;
	vote(sabhaId: string, participantId: string, position: "support" | "oppose" | "abstain", reasoning: string): unknown;
	conclude(sabhaId: string): { finalVerdict: string | null; topic: string };
	explain(sabhaId: string): string;
}

/** Duck-typed AkashaField (shared knowledge traces). */
interface AkashaFieldLike {
	query(topic: string, opts?: { type?: string; limit?: number }): Array<{
		id: string; agentId: string; traceType: string; topic: string;
		content: string; strength: number; reinforcements: number;
	}>;
	leave(
		agentId: string,
		type: string,
		topic: string,
		content: string,
	): { id: string };
}

/** Duck-typed VasanaEngine (behavioral tendencies). */
interface VasanaEngineLike {
	getVasanas(project: string, topK?: number): Array<{
		id: string; tendency: string; description: string;
		strength: number; stability: number; valence: string;
		reinforcementCount: number; predictiveAccuracy: number;
	}>;
}

/** Duck-typed Triguna (system health). */
interface TrigunaLike {
	getState(): { sattva: number; rajas: number; tamas: number };
	getDominant(): string;
	getTrend(): { sattva: string; rajas: string; tamas: string };
	getHistory(limit?: number): Array<{
		state: { sattva: number; rajas: number; tamas: number };
		timestamp: number;
		dominant: string;
	}>;
}

/** Duck-typed ChetanaController (consciousness layer). */
interface ChetanaControllerLike {
	getCognitiveReport(): {
		affect: { valence: number; arousal: number; confidence: number; frustration: number };
		topConcepts: Array<{ concept: string; weight: number }>;
		topTools: Array<{ tool: string; weight: number }>;
		selfSummary: {
			calibration: number;
			learningVelocity: number;
			topTools: Array<{ tool: string; mastery: { successRate: number } }>;
			limitations: string[];
			style: Map<string, unknown>;
		};
		intentions: unknown[];
	};
}

/** Duck-typed SoulManager (agent identity). */
interface SoulManagerLike {
	getAll(): Array<{
		id: string; name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string; learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	}>;
	get(agentId: string): {
		id: string; name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string; learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	} | undefined;
}

/**
 * Singleton holders for subsystem instances within the MCP server process.
 * Lazily created on first tool invocation. These are lightweight — the real
 * heavy lifting is done by the underlying subsystems.
 */
let _samiti: SamitiLike | undefined;
let _sabha: SabhaEngineLike | undefined;
let _akasha: AkashaFieldLike | undefined;
let _vasana: VasanaEngineLike | undefined;
let _triguna: TrigunaLike | undefined;
let _chetana: ChetanaControllerLike | undefined;
let _soulManager: SoulManagerLike | undefined;

async function getSamiti(): Promise<SamitiLike> {
	if (!_samiti) {
		const { Samiti } = await import("@chitragupta/sutra");
		_samiti = new Samiti() as unknown as SamitiLike;
	}
	return _samiti;
}

async function getSabha(): Promise<SabhaEngineLike> {
	if (!_sabha) {
		const { SabhaEngine } = await import("@chitragupta/sutra");
		_sabha = new SabhaEngine() as unknown as SabhaEngineLike;
	}
	return _sabha;
}

async function getAkasha(): Promise<AkashaFieldLike> {
	if (!_akasha) {
		const { AkashaField } = await import("@chitragupta/smriti");
		_akasha = new AkashaField() as unknown as AkashaFieldLike;
	}
	return _akasha;
}

async function getVasana(): Promise<VasanaEngineLike> {
	if (!_vasana) {
		const { VasanaEngine } = await import("@chitragupta/smriti");
		_vasana = new VasanaEngine() as unknown as VasanaEngineLike;
	}
	return _vasana;
}

async function getTriguna(): Promise<TrigunaLike> {
	if (!_triguna) {
		const { Triguna } = await import("@chitragupta/anina");
		_triguna = new Triguna() as unknown as TrigunaLike;
	}
	return _triguna;
}

async function getChetana(): Promise<ChetanaControllerLike> {
	if (!_chetana) {
		const { ChetanaController } = await import("@chitragupta/anina");
		_chetana = new ChetanaController() as unknown as ChetanaControllerLike;
	}
	return _chetana;
}

async function getSoulManager(): Promise<SoulManagerLike> {
	if (!_soulManager) {
		const { SoulManager } = await import("@chitragupta/anina");
		_soulManager = new SoulManager() as unknown as SoulManagerLike;
	}
	return _soulManager;
}

/**
 * Create the `samiti_channels` tool — list ambient channels and recent messages.
 */
function createSamitiChannelsTool(): McpToolHandler {
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
					channel: {
						type: "string",
						description: "Channel name (e.g., '#security'). Omit to list all channels.",
					},
					limit: {
						type: "number",
						description: "Maximum messages to return when querying a specific channel. Default: 20.",
					},
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
						return {
							content: [{ type: "text", text: `No messages in channel "${channel}".` }],
						};
					}

					const formatted = messages.map((m) =>
						`[${new Date(m.timestamp).toISOString()}] (${m.severity}) ${m.sender}: ${m.content}`,
					).join("\n");

					return {
						content: [{ type: "text", text: `Messages in ${channel} (${messages.length}):\n\n${formatted}` }],
					};
				}

				// List all channels
				const channels = samiti.listChannels();
				if (channels.length === 0) {
					return {
						content: [{ type: "text", text: "No ambient channels active." }],
					};
				}

				const lines = channels.map((ch) =>
					`- ${ch.name}: ${ch.description} (${ch.messages.length} msgs, ${ch.subscribers.size} subs)`,
				);

				return {
					content: [{ type: "text", text: `Ambient Channels (${channels.length}):\n\n${lines.join("\n")}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `samiti_channels failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `samiti_broadcast` tool — broadcast a message to a channel.
 */
function createSamitiBroadcastTool(): McpToolHandler {
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
					channel: {
						type: "string",
						description: "Target channel name (e.g., '#security').",
					},
					content: {
						type: "string",
						description: "Message content to broadcast.",
					},
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
			const severity = VALID_SEVERITIES.includes(rawSeverity as any) ? rawSeverity as typeof VALID_SEVERITIES[number] : "info";

			if (!channel) {
				return {
					content: [{ type: "text", text: "Error: channel is required" }],
					isError: true,
				};
			}
			if (!content) {
				return {
					content: [{ type: "text", text: "Error: content is required" }],
					isError: true,
				};
			}

			try {
				const samiti = await getSamiti();
				const msg = samiti.broadcast(channel, {
					sender: "mcp-client",
					severity,
					category: "mcp-broadcast",
					content,
				});

				return {
					content: [{ type: "text", text: `Broadcast sent. Message ID: ${msg.id}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `samiti_broadcast failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `sabha_deliberate` tool — start a multi-agent deliberation.
 *
 * This is a high-level convenience that convenes a Sabha, submits a proposal
 * derived from the input, auto-votes with the participant agents, and
 * concludes — all in one shot. For fine-grained control, use the Sabha API
 * directly via the agent prompt tool.
 */
function createSabhaDeliberateTool(): McpToolHandler {
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
					proposal: {
						type: "string",
						description: "The proposition to deliberate on (e.g., 'Should we refactor the auth module?').",
					},
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
				return {
					content: [{ type: "text", text: "Error: proposal is required" }],
					isError: true,
				};
			}

			const agentIds = Array.isArray(args.agents)
				? (args.agents as string[]).map(String)
				: ["kartru", "parikshaka", "anveshi"];

			try {
				const sabha = await getSabha();

				// Build participants from agent IDs with reasonable defaults
				const participants = agentIds.map((id, i) => ({
					id,
					role: i === 0 ? "proposer" : "challenger",
					expertise: 0.8 - i * 0.05,
					credibility: 0.85 - i * 0.05,
				}));

				// Convene the assembly
				const session = sabha.convene(proposal, "mcp-client", participants);

				// Auto-generate a syllogism from the proposal
				sabha.propose(session.id, agentIds[0], {
					pratijna: proposal,
					hetu: `Because the current analysis suggests this is the optimal course of action.`,
					udaharana: `Wherever similar conditions exist, this approach has yielded positive outcomes, as in comparable projects.`,
					upanaya: `The current project exhibits these conditions.`,
					nigamana: `Therefore, ${proposal.toLowerCase().replace(/\?$/, "")}.`,
				});

				// Each agent votes based on their role
				for (const participant of participants) {
					const position = participant.role === "proposer" ? "support" as const
						: participant.role === "challenger" ? "oppose" as const
						: "abstain" as const;
					sabha.vote(
						session.id,
						participant.id,
						position,
						`${participant.role} perspective on: ${proposal}`,
					);
				}

				// Conclude and explain
				const result = sabha.conclude(session.id);
				const explanation = sabha.explain(session.id);

				return {
					content: [{
						type: "text",
						text: `Deliberation complete.\n\nVerdict: ${result.finalVerdict}\n\n${explanation}`,
					}],
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

/**
 * Create the `akasha_traces` tool — query shared knowledge traces.
 */
function createAkashaTracesTool(): McpToolHandler {
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
					query: {
						type: "string",
						description: "Search query to match against trace topics and content.",
					},
					type: {
						type: "string",
						description: "Filter by trace type: 'solution', 'warning', 'shortcut', 'pattern', 'correction', 'preference'.",
						enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"],
					},
					limit: {
						type: "number",
						description: "Maximum traces to return. Default: 10.",
					},
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			if (!query) {
				return {
					content: [{ type: "text", text: "Error: query is required" }],
					isError: true,
				};
			}

			const VALID_TRACE_TYPES = ["solution", "warning", "shortcut", "pattern", "correction", "preference"] as const;
			const rawType = args.type != null ? String(args.type) : undefined;
			const traceType = rawType && VALID_TRACE_TYPES.includes(rawType as any) ? rawType as typeof VALID_TRACE_TYPES[number] : undefined;
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 10) || 10));

			try {
				const akasha = await getAkasha();
				const traces = akasha.query(query, {
					type: traceType,
					limit,
				});

				if (traces.length === 0) {
					return {
						content: [{ type: "text", text: "No matching traces found in the Akasha field." }],
					};
				}

				const formatted = traces.map((t, i) =>
					`[${i + 1}] (${t.traceType}, strength: ${t.strength.toFixed(3)}, reinforcements: ${t.reinforcements})\n` +
					`  Topic: ${t.topic}\n` +
					`  Agent: ${t.agentId}\n` +
					`  ${t.content}`,
				).join("\n\n");

				return {
					content: [{ type: "text", text: `Akasha Traces (${traces.length}):\n\n${formatted}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `akasha_traces failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `akasha_deposit` tool — deposit a knowledge trace.
 */
function createAkashaDepositTool(): McpToolHandler {
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
					content: {
						type: "string",
						description: "The knowledge, solution, or observation to deposit.",
					},
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
			const depositType = VALID_TRACE_TYPES.includes(rawType as any) ? rawType as typeof VALID_TRACE_TYPES[number] : "solution";
			const topics = Array.isArray(args.topics)
				? (args.topics as string[]).map(String)
				: [];

			if (!content) {
				return {
					content: [{ type: "text", text: "Error: content is required" }],
					isError: true,
				};
			}
			if (!rawType || !VALID_TRACE_TYPES.includes(rawType as any)) {
				return {
					content: [{ type: "text", text: `Error: type must be one of: ${VALID_TRACE_TYPES.join(", ")}` }],
					isError: true,
				};
			}
			if (topics.length === 0) {
				return {
					content: [{ type: "text", text: "Error: at least one topic is required" }],
					isError: true,
				};
			}

			try {
				const akasha = await getAkasha();
				const topic = topics.join(" ");
				const trace = akasha.leave(
					"mcp-client",
					depositType,
					topic,
					content,
				);

				return {
					content: [{ type: "text", text: `Trace deposited. ID: ${trace.id}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `akasha_deposit failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `vasana_tendencies` tool — get crystallized behavioral tendencies.
 */
function createVasanaTendenciesTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "vasana_tendencies",
			description:
				"Get crystallized behavioral tendencies (vasanas). Vasanas are stable " +
				"behavioral patterns detected via Bayesian Online Change-Point Detection, " +
				"validated by holdout prediction, and ranked by strength.",
			inputSchema: {
				type: "object",
				properties: {
					limit: {
						type: "number",
						description: "Maximum tendencies to return. Default: 20.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

			try {
				const vasana = await getVasana();
				const tendencies = vasana.getVasanas(projectPath, limit);

				if (tendencies.length === 0) {
					return {
						content: [{ type: "text", text: "No crystallized vasanas found. Tendencies emerge after repeated behavioral patterns are detected." }],
					};
				}

				const formatted = tendencies.map((v, i) =>
					`[${i + 1}] ${v.tendency} (${v.valence})\n` +
					`  Strength: ${v.strength.toFixed(3)} | Stability: ${v.stability.toFixed(3)} | Accuracy: ${v.predictiveAccuracy.toFixed(3)}\n` +
					`  Reinforcements: ${v.reinforcementCount}\n` +
					`  ${v.description}`,
				).join("\n\n");

				return {
					content: [{ type: "text", text: `Vasanas (${tendencies.length}):\n\n${formatted}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `vasana_tendencies failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `health_status` tool — get Triguna system health.
 */
function createHealthStatusTool(): McpToolHandler {
	return {
		definition: {
			name: "health_status",
			description:
				"Get the Triguna system health status. Tracks three fundamental qualities " +
				"on the 2-simplex: Sattva (harmony/clarity), Rajas (activity/restlessness), " +
				"Tamas (inertia/degradation). Uses a Simplex-Constrained Kalman Filter with " +
				"Isometric Log-Ratio (ILR) coordinates.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const triguna = await getTriguna();
				const state = triguna.getState();
				const dominant = triguna.getDominant();
				const trend = triguna.getTrend();
				const history = triguna.getHistory(5);

				const alerts: string[] = [];
				if (state.sattva > 0.7) alerts.push("System healthy — clarity and balance prevail");
				if (state.rajas > 0.5) alerts.push("System hyperactive — consider reducing parallelism");
				if (state.tamas > 0.4) alerts.push("System degraded — suggest recovery actions");

				const historyLines = history.map((h) =>
					`  ${new Date(h.timestamp).toISOString()}: S=${h.state.sattva.toFixed(3)} R=${h.state.rajas.toFixed(3)} T=${h.state.tamas.toFixed(3)} (${h.dominant})`,
				).join("\n");

				const text = [
					`Triguna Health Status`,
					``,
					`Current State:`,
					`  Sattva (harmony):    ${state.sattva.toFixed(4)} ${trendArrow(trend.sattva)}`,
					`  Rajas (activity):    ${state.rajas.toFixed(4)} ${trendArrow(trend.rajas)}`,
					`  Tamas (inertia):     ${state.tamas.toFixed(4)} ${trendArrow(trend.tamas)}`,
					``,
					`Dominant Guna: ${dominant}`,
					``,
					alerts.length > 0 ? `Alerts:\n${alerts.map((a) => `  - ${a}`).join("\n")}` : "Alerts: none",
					``,
					`Recent History:`,
					historyLines || "  (no history yet)",
				].join("\n");

				return {
					content: [{ type: "text", text }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `health_status failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/** Map trend direction to an arrow indicator. */
function trendArrow(direction: string): string {
	if (direction === "rising") return "[rising]";
	if (direction === "falling") return "[falling]";
	return "[stable]";
}

/**
 * Create the `atman_report` tool — get comprehensive self-report.
 *
 * Assembles data from the ChetanaController (consciousness layer),
 * SoulManager (agent identity), and Triguna (health) into a single
 * comprehensive report.
 */
function createAtmanReportTool(): McpToolHandler {
	return {
		definition: {
			name: "atman_report",
			description:
				"Get a comprehensive self-report (Atman report) covering the agent's " +
				"consciousness state, identity, tool mastery, behavioral tendencies, " +
				"active intentions, and health status. Combines data from Chetana " +
				"(consciousness), Soul (identity), and Triguna (health).",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const sections: string[] = [];

				// ── Consciousness (Chetana) ─────────────────────────────
				try {
					const chetana = await getChetana();
					const report = chetana.getCognitiveReport();

					sections.push("## Consciousness (Chetana)");
					sections.push("");
					sections.push("### Affect (Bhava)");
					sections.push(`  Valence:     ${report.affect.valence.toFixed(3)}`);
					sections.push(`  Arousal:     ${report.affect.arousal.toFixed(3)}`);
					sections.push(`  Confidence:  ${report.affect.confidence.toFixed(3)}`);
					sections.push(`  Frustration: ${report.affect.frustration.toFixed(3)}`);

					if (report.topConcepts.length > 0) {
						sections.push("");
						sections.push("### Attention (Dhyana) — Top Concepts");
						for (const c of report.topConcepts.slice(0, 5)) {
							sections.push(`  - ${c.concept}: ${c.weight.toFixed(3)}`);
						}
					}

					if (report.topTools.length > 0) {
						sections.push("");
						sections.push("### Tool Attention");
						for (const t of report.topTools.slice(0, 5)) {
							sections.push(`  - ${t.tool}: ${t.weight.toFixed(3)}`);
						}
					}

					sections.push("");
					sections.push("### Self-Model (Atma-Darshana)");
					sections.push(`  Calibration:       ${report.selfSummary.calibration.toFixed(3)}`);
					sections.push(`  Learning Velocity: ${report.selfSummary.learningVelocity.toFixed(3)}`);

					if (report.selfSummary.topTools.length > 0) {
						sections.push("  Top Tool Mastery:");
						for (const t of report.selfSummary.topTools.slice(0, 5)) {
							sections.push(`    - ${t.tool}: ${t.mastery.successRate.toFixed(3)} success rate`);
						}
					}

					if (report.selfSummary.limitations.length > 0) {
						sections.push(`  Known Limitations: ${report.selfSummary.limitations.join(", ")}`);
					}

					if (report.intentions.length > 0) {
						sections.push("");
						sections.push(`### Active Intentions (Sankalpa): ${report.intentions.length}`);
					}
				} catch {
					sections.push("## Consciousness (Chetana): not available");
				}

				// ── Health (Triguna) ────────────────────────────────────
				try {
					const triguna = await getTriguna();
					const state = triguna.getState();
					const dominant = triguna.getDominant();

					sections.push("");
					sections.push("## Health (Triguna)");
					sections.push(`  Sattva: ${state.sattva.toFixed(4)} | Rajas: ${state.rajas.toFixed(4)} | Tamas: ${state.tamas.toFixed(4)}`);
					sections.push(`  Dominant: ${dominant}`);
				} catch {
					sections.push("");
					sections.push("## Health (Triguna): not available");
				}

				// ── Identity (Atman/Soul) ──────────────────────────────
				try {
					const soulMgr = await getSoulManager();
					const souls = soulMgr.getAll();

					if (souls.length > 0) {
						sections.push("");
						sections.push("## Identity (Atman)");
						for (const soul of souls.slice(0, 3)) {
							sections.push(`  Agent: ${soul.name} (${soul.archetype.name})`);
							sections.push(`  Purpose: ${soul.purpose}`);
							sections.push(`  Traits: ${[...soul.archetype.traits, ...soul.learnedTraits].join(", ")}`);
							sections.push(`  Strengths: ${soul.archetype.strengths.join(", ")}`);
							if (soul.values.length > 0) {
								sections.push(`  Values: ${soul.values.join(", ")}`);
							}
							const confident = [...soul.confidenceModel.entries()]
								.filter(([, v]) => v > 0.7)
								.map(([k]) => k);
							if (confident.length > 0) {
								sections.push(`  High confidence in: ${confident.join(", ")}`);
							}
							sections.push("");
						}
					} else {
						sections.push("");
						sections.push("## Identity (Atman): no souls registered");
					}
				} catch {
					sections.push("");
					sections.push("## Identity (Atman): not available");
				}

				return {
					content: [{ type: "text", text: `# Atman Report\n\n${sections.join("\n")}` }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `atman_report failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Coding Agent MCP Tool ───────────────────────────────────────────────────

/**
 * Format an OrchestratorResult into a readable text summary.
 * Exported for testing.
 */
export function formatOrchestratorResult(result: {
	success: boolean;
	plan: { task: string; steps: { index: number; description: string; completed: boolean }[]; complexity: string } | null;
	codingResults: { filesModified: string[]; filesCreated: string[] }[];
	git: { featureBranch: string | null; commits: string[] };
	reviewIssues: { severity: string; file: string; line?: number; message: string }[];
	validationPassed: boolean;
	filesModified: string[];
	filesCreated: string[];
	summary: string;
	elapsedMs: number;
	diffPreview?: string;
	phaseTimings?: Array<{ phase: string; startMs: number; endMs: number; durationMs: number }>;
	diffStats?: { filesChanged: number; insertions: number; deletions: number };
	errors?: Array<{ phase: string; message: string; recoverable: boolean }>;
	stats?: {
		totalCost: number; currency: string;
		inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number;
		toolCalls: Record<string, number>; totalToolCalls: number; turns: number;
	};
}): string {
	const lines: string[] = [];
	const status = result.success ? "Success" : "Failed";
	const complexity = result.plan?.complexity ?? "unknown";

	lines.push("═══ Coding Agent ═══════════════════════");
	lines.push(`Task: ${result.plan?.task ?? "(unknown)"}`);
	lines.push(`Mode: ${result.plan ? "planned" : "direct"} | Complexity: ${complexity}`);
	lines.push(`Status: ${result.success ? "✓" : "✗"} ${status}`);

	// Plan
	if (result.plan && result.plan.steps.length > 0) {
		lines.push("");
		lines.push("── Plan ──");
		for (const step of result.plan.steps) {
			const mark = step.completed ? "✓" : "○";
			lines.push(`${step.index}. [${mark}] ${step.description}`);
		}
	}

	// Files
	if (result.filesModified.length > 0 || result.filesCreated.length > 0) {
		lines.push("");
		lines.push("── Files ──");
		if (result.filesModified.length > 0) {
			lines.push(`Modified: ${result.filesModified.join(", ")}`);
		}
		if (result.filesCreated.length > 0) {
			lines.push(`Created: ${result.filesCreated.join(", ")}`);
		}
	}

	// Git
	if (result.git.featureBranch || result.git.commits.length > 0) {
		lines.push("");
		lines.push("── Git ──");
		if (result.git.featureBranch) lines.push(`Branch: ${result.git.featureBranch}`);
		if (result.git.commits.length > 0) lines.push(`Commits: ${result.git.commits.join(", ")}`);
	}

	// Validation
	lines.push("");
	lines.push("── Validation ──");
	lines.push(`Result: ${result.validationPassed ? "✓ passed" : "✗ failed"}`);

	// Review
	if (result.reviewIssues.length > 0) {
		lines.push("");
		lines.push("── Review ──");
		lines.push(`${result.reviewIssues.length} issue(s) found`);
		for (const issue of result.reviewIssues.slice(0, 10)) {
			lines.push(`  ${issue.severity} ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
		}
	} else {
		lines.push("");
		lines.push("── Review ──");
		lines.push("0 issues found");
	}

	// Diff preview
	if (result.diffPreview) {
		lines.push("");
		lines.push("── Diff Preview ──");
		const diffLines = result.diffPreview.split("\n");
		if (diffLines.length > 60) {
			lines.push(...diffLines.slice(0, 60));
			lines.push(`... (${diffLines.length - 60} more lines)`);
		} else {
			lines.push(...diffLines);
		}
	}

	// Stats
	if (result.stats && (result.stats.totalToolCalls > 0 || result.stats.totalCost > 0)) {
		lines.push("");
		lines.push("── Usage ──");
		if (result.stats.totalToolCalls > 0) {
			const sorted = Object.entries(result.stats.toolCalls).sort((a, b) => b[1] - a[1]);
			for (const [name, count] of sorted) {
				const pct = ((count / result.stats.totalToolCalls) * 100).toFixed(1);
				lines.push(`  ${name}: ${count} calls (${pct}%)`);
			}
			lines.push(`  Total: ${result.stats.totalToolCalls} calls | ${result.stats.turns} turns`);
		}
		if (result.stats.totalCost > 0) {
			lines.push(`  Cost: $${result.stats.totalCost.toFixed(4)} ${result.stats.currency}`);
		}
	}

	// Phase timings
	if (result.phaseTimings && result.phaseTimings.length > 0) {
		lines.push("");
		lines.push("── Timing ──");
		for (const pt of result.phaseTimings) {
			const dur = pt.durationMs < 1000 ? `${pt.durationMs}ms` : `${(pt.durationMs / 1000).toFixed(1)}s`;
			lines.push(`  ${pt.phase}: ${dur}`);
		}
	}

	// Diff stats
	if (result.diffStats) {
		lines.push(`  Diff: +${result.diffStats.insertions}/-${result.diffStats.deletions} in ${result.diffStats.filesChanged} file(s)`);
	}

	// Errors
	if (result.errors && result.errors.length > 0) {
		lines.push("");
		lines.push("── Errors ──");
		for (const err of result.errors) {
			lines.push(`  [${err.phase}] ${err.message}${err.recoverable ? " (recovered)" : ""}`);
		}
	}

	// Total timing
	lines.push("");
	lines.push(`⏱ ${(result.elapsedMs / 1000).toFixed(1)}s`);

	return lines.join("\n");
}

/**
 * Create the `coding_agent` tool — delegate a coding task to
 * Chitragupta's CodingOrchestrator (Sanyojaka).
 *
 * Plans, codes, validates, reviews, and commits autonomously.
 */
function createCodingAgentTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "coding_agent",
			description:
				"Delegate a coding task to Chitragupta's coding agent (Kartru). " +
				"Plans, codes, validates, reviews, and commits autonomously.",
			inputSchema: {
				type: "object",
				properties: {
					task: {
						type: "string",
						description: "The coding task to accomplish.",
					},
					mode: {
						type: "string",
						enum: ["full", "execute", "plan-only"],
						description: "Execution mode. Default: full",
					},
					provider: {
						type: "string",
						description: "AI provider ID. Default: from config",
					},
					model: {
						type: "string",
						description: "Model ID. Default: from config",
					},
					createBranch: {
						type: "boolean",
						description: "Create a git feature branch. Default: true",
					},
					autoCommit: {
						type: "boolean",
						description: "Auto-commit on success. Default: true",
					},
					selfReview: {
						type: "boolean",
						description: "Run self-review after coding. Default: true",
					},
				},
				required: ["task"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const task = String(args.task ?? "");
			if (!task) {
				return {
					content: [{ type: "text", text: "Error: task is required" }],
					isError: true,
				};
			}

			try {
				const { setupCodingEnvironment, createCodingOrchestrator } = await import("../coding-setup.js");

				const setup = await setupCodingEnvironment({
					projectPath,
					explicitProvider: args.provider ? String(args.provider) : undefined,
					sessionId: "coding-mcp",
				});
				if (!setup) {
					return {
						content: [{ type: "text", text: "Error: No AI provider available. Set an API key or install a CLI (claude, codex, gemini)." }],
						isError: true,
					};
				}

				// Progress tracking
				const progressMessages: string[] = [];
				const onProgress = (progress: { phase: string; message: string }) => {
					progressMessages.push(`[${progress.phase}] ${progress.message}`);
				};

				const orchestrator = await createCodingOrchestrator({
					setup,
					projectPath,
					mode: (args.mode as "full" | "execute" | "plan-only") ?? "full",
					modelId: args.model ? String(args.model) : undefined,
					createBranch: args.createBranch != null ? Boolean(args.createBranch) : undefined,
					autoCommit: args.autoCommit != null ? Boolean(args.autoCommit) : undefined,
					selfReview: args.selfReview != null ? Boolean(args.selfReview) : undefined,
					onProgress,
				});

				const result = await orchestrator.run(task);
				const text = formatOrchestratorResult(result);

				const progressSuffix = progressMessages.length > 0
					? `\n\n── Progress Log ──\n${progressMessages.join("\n")}`
					: "";

				return {
					content: [{ type: "text", text: text + progressSuffix }],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `coding_agent failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── MCP State File ─────────────────────────────────────────────────────────

/**
 * Lightweight state file written by the MCP server for external consumers
 * (e.g., the Claude Code status line script). Located at ~/.chitragupta/mcp-state.json.
 */
interface McpState {
	active: boolean;
	pid: number;
	startedAt: string;
	sessionId?: string;
	project?: string;
	turnCount?: number;
	filesModified?: string[];
	lastTool?: string;
	lastUpdate: string;
}

let _mcpStartedAt = new Date().toISOString();

function getStatePath(): string {
	return path.join(os.homedir(), ".chitragupta", "mcp-state.json");
}

function writeChitraguptaState(partial: Partial<McpState>): void {
	try {
		const statePath = getStatePath();
		const dir = path.dirname(statePath);
		fs.mkdirSync(dir, { recursive: true });

		let existing: Partial<McpState> = {};
		try {
			existing = JSON.parse(fs.readFileSync(statePath, "utf-8")) as McpState;
		} catch { /* first write */ }

		const merged: McpState = {
			active: true,
			pid: process.pid,
			startedAt: _mcpStartedAt,
			lastUpdate: new Date().toISOString(),
			...existing,
			...partial,
		};
		// Atomic write: write to temp file then rename to avoid TOCTOU races
		const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
		fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
		fs.renameSync(tmpPath, statePath);
	} catch {
		// Best-effort state persistence — never block MCP operations
	}
}

function clearChitraguptaState(): void {
	try {
		const statePath = getStatePath();
		if (fs.existsSync(statePath)) {
			const existing = JSON.parse(fs.readFileSync(statePath, "utf-8")) as McpState;
			existing.active = false;
			existing.lastUpdate = new Date().toISOString();
			// Atomic write: write to temp file then rename
			const tmpPath = statePath + "." + Date.now().toString(36) + ".tmp";
			fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
			fs.renameSync(tmpPath, statePath);
		}
	} catch { /* best-effort cleanup */ }
}

// ─── Handover Tool ──────────────────────────────────────────────────────────

/**
 * Patterns that indicate a key decision or action statement.
 * Used by the handover tool to extract decisions from assistant turns.
 */
const HANDOVER_DECISION_PATTERNS = [
	"i'll", "i will", "let's", "the fix is", "the issue is", "the problem is",
	"we need to", "we should", "the solution is", "i've decided", "i have",
	"decision:", "plan:", "approach:", "strategy:", "conclusion:",
	"the root cause", "this means", "therefore",
];

/**
 * Create the `chitragupta_handover` tool — structured work-state summary
 * for context continuity across compaction boundaries.
 *
 * Unlike Pratyabhijna (identity: "who am I?"), this is about work state:
 * "what was I doing, where did I leave off, what's next?"
 */
function createHandoverTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_handover",
			description:
				"Generate a structured work-state handover summary for context continuity. " +
				"Call this when approaching context limits to preserve work state across " +
				"compaction boundaries. Returns: original request, files modified/read, " +
				"decisions made, errors encountered, commands run, and recent context. " +
				"This is NOT identity (use atman_report for that) — this is work state.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "Session ID to summarize. Default: most recent session.",
					},
					turnWindow: {
						type: "number",
						description: "Focus on the last N turns only. Default: all turns.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { loadSession, listSessions } = await import("@chitragupta/smriti/session-store");

				// Resolve session ID
				let sessionId = args.sessionId ? String(args.sessionId) : undefined;
				if (!sessionId) {
					const sessions = listSessions(projectPath);
					if (sessions.length === 0) {
						return {
							content: [{ type: "text", text: "No sessions found. Nothing to hand over." }],
						};
					}
					sessionId = sessions[0].id;
				}

				const session = loadSession(sessionId, projectPath);
				const allTurns = session.turns;
				const turnWindow = args.turnWindow ? (Number(args.turnWindow) || 0) : 0;
				const turns = turnWindow > 0
					? allTurns.slice(-turnWindow)
					: allTurns;

				// ── Extract structured work state ─────────────────────────
				const filesRead = new Set<string>();
				const filesModified = new Set<string>();
				const commands: string[] = [];
				const errors: string[] = [];
				const decisions: string[] = [];
				const otherTools = new Map<string, number>();

				for (const turn of turns) {
					// Extract from structured tool calls
					if (turn.toolCalls) {
						for (const tc of turn.toolCalls) {
							const name = tc.name.toLowerCase();
							let input: Record<string, unknown> = {};
							try { input = JSON.parse(tc.input) as Record<string, unknown>; } catch { /* skip */ }

							if (name.includes("read") || name.includes("glob") || name.includes("grep")) {
								const target = String(input.file_path ?? input.path ?? input.pattern ?? "");
								if (target) filesRead.add(target);
							} else if (name.includes("write") || name.includes("edit")) {
								const target = String(input.file_path ?? input.path ?? "");
								if (target) filesModified.add(target);
							} else if (name.includes("bash") || name.includes("exec") || name.includes("command")) {
								const cmd = String(input.command ?? "");
								if (cmd) commands.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
							} else {
								otherTools.set(tc.name, (otherTools.get(tc.name) ?? 0) + 1);
							}

							// Capture errors
							if (tc.isError && tc.result) {
								const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
								errors.push(`${tc.name}: ${resultStr.slice(0, 200)}`);
							}
						}
					}

					// Extract decisions from assistant text
					if (turn.role === "assistant" && turn.content) {
						for (const line of turn.content.split("\n")) {
							const lower = line.trim().toLowerCase();
							if (lower.length > 10 && HANDOVER_DECISION_PATTERNS.some((p) => lower.startsWith(p))) {
								const trimmed = line.trim();
								if (trimmed.length <= 200) {
									decisions.push(trimmed);
								} else {
									decisions.push(trimmed.slice(0, 200) + "...");
								}
							}
						}
					}
				}

				// Deduplicate decisions (similar lines from repeated patterns)
				const uniqueDecisions = [...new Set(decisions)].slice(0, 15);

				// Original request: first user turn in the session
				const firstUserTurn = allTurns.find((t) => t.role === "user");
				const userRequest = firstUserTurn?.content
					? firstUserTurn.content.length > 500
						? firstUserTurn.content.slice(0, 500) + "..."
						: firstUserTurn.content
					: "(unknown)";

				// ── Build handover summary ─────────────────────────────────
				const sections: string[] = [];

				sections.push("चि Handover Summary");
				sections.push("━".repeat(40));
				sections.push(`Session: ${session.meta.id}`);
				sections.push(`Title: ${session.meta.title}`);
				sections.push(`Turns: ${allTurns.length} | Model: ${session.meta.model}`);
				sections.push(`Created: ${session.meta.created}`);
				sections.push("");

				sections.push("## Original Request");
				sections.push(userRequest);
				sections.push("");

				if (filesModified.size > 0) {
					sections.push("## Files Modified");
					for (const f of filesModified) sections.push(`  - ${f}`);
					sections.push("");
				}

				if (filesRead.size > 0) {
					sections.push("## Files Read");
					for (const f of [...filesRead].slice(0, 30)) sections.push(`  - ${f}`);
					if (filesRead.size > 30) sections.push(`  ... and ${filesRead.size - 30} more`);
					sections.push("");
				}

				if (uniqueDecisions.length > 0) {
					sections.push("## Key Decisions");
					for (const d of uniqueDecisions) sections.push(`  - ${d}`);
					sections.push("");
				}

				if (errors.length > 0) {
					sections.push("## Errors Encountered");
					for (const e of errors.slice(0, 10)) sections.push(`  - ${e}`);
					sections.push("");
				}

				if (commands.length > 0) {
					sections.push("## Commands Run");
					for (const c of commands.slice(0, 10)) sections.push(`  $ ${c}`);
					if (commands.length > 10) sections.push(`  ... and ${commands.length - 10} more`);
					sections.push("");
				}

				if (otherTools.size > 0) {
					const entries = [...otherTools.entries()].map(([n, c]) => `${n}(x${c})`);
					sections.push("## Other Tools Used");
					sections.push(`  ${entries.join(", ")}`);
					sections.push("");
				}

				// Last 3 assistant messages for recent context
				const recentAssistant = turns
					.filter((t) => t.role === "assistant")
					.slice(-3);
				if (recentAssistant.length > 0) {
					sections.push("## Recent Context (last 3 responses)");
					for (const t of recentAssistant) {
						const preview = t.content
							.slice(0, 300)
							.replace(/\n/g, " ")
							.trim();
						sections.push(
							`  [Turn ${t.turnNumber}] ${preview}${t.content.length > 300 ? "..." : ""}`,
						);
					}
					sections.push("");
				}

				// Write state file as side effect
				writeChitraguptaState({
					sessionId: session.meta.id,
					project: projectPath,
					turnCount: allTurns.length,
					filesModified: [...filesModified],
					lastTool: "chitragupta_handover",
				});

				return {
					content: [{ type: "text", text: sections.join("\n") }],
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Handover failed: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}

// ─── MCP Resources ──────────────────────────────────────────────────────────

/**
 * Create an MCP resource for project memory.
 */
function createMemoryResource(projectPath: string): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://memory/project",
			name: "Project Memory",
			description: "Chitragupta's project memory file (MEMORY.md) containing learned patterns, conventions, and decisions.",
			mimeType: "text/markdown",
		},
		async read(_uri: string): Promise<McpContent[]> {
			const content = loadProjectMemory(projectPath);
			return [{ type: "text", text: content ?? "No project memory found." }];
		},
	};
}

// ─── MCP Prompts ────────────────────────────────────────────────────────────
// Each prompt = a slash-command shortcut in Claude Code / Codex.
// Keep them concise — the agent knows how to use the tools.

function prompt(name: string, description: string, args: { name: string; description: string; required: boolean }[], getText: (a: Record<string, string>) => string): McpPromptHandler {
	return {
		definition: { name, description, arguments: args },
		async get(a: Record<string, string>): Promise<McpContent[]> {
			return [{ type: "text", text: getText(a) }];
		},
	};
}

const createSavePrompt = () => prompt(
	"save", "Save decisions, patterns, or solutions to memory.", [
		{ name: "what", description: "What to remember", required: false },
		{ name: "type", description: "solution | pattern | warning | shortcut | correction | preference", required: false },
	],
	(a) => {
		const what = a.what || "";
		const t = a.type || "solution";
		return what
			? `Save to memory: "${what}"\nCall akasha_deposit with type="${t}" and relevant topic tags. Confirm what was saved.`
			: "Review this conversation for key decisions, solutions, patterns, and warnings. Save each one via akasha_deposit with the appropriate type. Summarize what was saved.";
	},
);

const createLastSessionPrompt = () => prompt(
	"last_session", "Recall the last session — what was worked on, decisions, and unfinished tasks.", [],
	() => "Call chitragupta_session_list (limit 1), then chitragupta_session_show to load it. Summarize: what was worked on, key decisions, files modified, unfinished work.",
);

const createReviewPrompt = () => prompt(
	"code_review", "Review code for issues, security, and quality.", [
		{ name: "file", description: "File path to review", required: true },
		{ name: "focus", description: "security | performance | style | all", required: false },
	],
	(a) => `Review "${a.file || ""}" (focus: ${a.focus || "all"}). Report: critical issues, suggestions, and good patterns found.`,
);

const createMemorySearchPrompt = () => prompt(
	"memory_search", "Search project memory for past decisions and context.", [
		{ name: "query", description: "What to search for", required: true },
	],
	(a) => `Call chitragupta_memory_search for "${a.query || ""}". Also check chitragupta_session_list for related sessions. Summarize what was found.`,
);

const createSessionPrompt = () => prompt(
	"session", "Browse or restore past sessions.", [
		{ name: "session_id", description: "Session ID to load (omit to list recent)", required: false },
	],
	(a) => a.session_id
		? `Load session ${a.session_id} via chitragupta_session_show. Summarize: what was worked on, decisions, unfinished work.`
		: "Call chitragupta_session_list. Present the list with dates and titles.",
);

const createHandoverPrompt = () => prompt(
	"handover", "Save work state before session ends — files, decisions, errors, next steps.", [
		{ name: "summary", description: "Brief summary of current work (optional)", required: false },
	],
	(a) => (a.summary ? `Context: ${a.summary}\n` : "") + "Call chitragupta_handover to generate a structured work-state summary. Save key outcomes via akasha_deposit.",
);

const createDebugPrompt = () => prompt(
	"debug", "Investigate an error — reproduce, trace, isolate, fix.", [
		{ name: "issue", description: "The error or unexpected behavior", required: true },
		{ name: "file", description: "Suspected file (optional)", required: false },
	],
	(a) => `Debug: "${a.issue || ""}"${a.file ? ` in ${a.file}` : ""}. Check chitragupta memory first. Then: reproduce → hypothesize → trace → isolate → fix & verify.`,
);

const createResearchPrompt = () => prompt(
	"research", "Deep-dive into codebase architecture — read-only analysis.", [
		{ name: "topic", description: "What to research", required: true },
	],
	(a) => `Research: "${a.topic || ""}". Search memory for prior analysis. Find relevant files, read them, trace data flow. Output: architecture overview, key files, patterns, dependencies. Read-only — do not modify files.`,
);

const createRefactorPrompt = () => prompt(
	"refactor", "Plan-then-execute refactoring with validation.", [
		{ name: "target", description: "What to refactor (file, module, pattern)", required: true },
		{ name: "goal", description: "Desired outcome", required: false },
	],
	(a) => `Refactor: "${a.target || ""}"${a.goal ? ` — goal: ${a.goal}` : ""}. Analyze → present plan before changes → execute incrementally → validate after each step → deposit pattern in Akasha.`,
);

const createStatusPrompt = () => prompt(
	"status", "Chitragupta system health — memory, sessions, knowledge traces.", [],
	() => "Call health_status for Triguna state. Call chitragupta_session_list (limit 5) for recent activity. Call akasha_traces with query 'recent' for knowledge state. Present a concise dashboard.",
);

const createRecallPrompt = () => prompt(
	"recall", "Remember what we decided about a topic.", [
		{ name: "topic", description: "What to recall (e.g. 'auth', 'database', 'deployment')", required: true },
	],
	(a) => `Recall everything about "${a.topic || ""}": call chitragupta_memory_search, akasha_traces, and check recent sessions. Present a timeline of decisions and current state.`,
);

// ─── Day File Tools ─────────────────────────────────────────────────────────

/**
 * Create the `chitragupta_day_show` tool — shows a consolidated day file.
 */
function createDayShowTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_show",
			description:
				"Show the consolidated day file (diary) for a specific date. " +
				"Day files contain all projects, sessions, tool usage, and files modified for that day.",
			inputSchema: {
				type: "object" as const,
				properties: {
					date: {
						type: "string",
						description: "Date in YYYY-MM-DD format. Omit for today.",
					},
				},
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const date = args.date
				? String(args.date)
				: new Date().toISOString().slice(0, 10);

			try {
				const { readDayFile } = await import("@chitragupta/smriti/day-consolidation");
				const content = readDayFile(date);

				if (!content) {
					return {
						content: [{ type: "text", text: `No day file for ${date}. Run consolidation first, or the daemon will create it automatically.` }],
						_metadata: { action: "day_show", date },
					};
				}

				return {
					content: [{ type: "text", text: content }],
					_metadata: { action: "day_show", date },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `chitragupta_day_list` tool — lists available day files.
 */
function createDayListTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_list",
			description:
				"List all consolidated day files (diaries). " +
				"Returns dates in YYYY-MM-DD format, most recent first.",
			inputSchema: {
				type: "object" as const,
				properties: {
					limit: {
						type: "number",
						description: "Maximum dates to return. Default: 30.",
					},
				},
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 30) || 30));

			try {
				const { listDayFiles } = await import("@chitragupta/smriti/day-consolidation");
				const dates = listDayFiles().slice(0, limit);

				if (dates.length === 0) {
					return {
						content: [{ type: "text", text: "No consolidated day files found. The daemon will create them automatically." }],
						_metadata: { action: "day_list" },
					};
				}

				const output = `Day files (${dates.length}):\n\n${dates.map((d: string) => `- ${d}`).join("\n")}`;
				return {
					content: [{ type: "text", text: output }],
					_metadata: { action: "day_list" },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

/**
 * Create the `chitragupta_day_search` tool — searches across day files.
 */
function createDaySearchTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_day_search",
			description:
				"Search across all consolidated day files (diaries) for a query. " +
				"Finds matching content across any date or project.",
			inputSchema: {
				type: "object" as const,
				properties: {
					query: {
						type: "string",
						description: "Search query (case-insensitive substring match).",
					},
					limit: {
						type: "number",
						description: "Maximum day files to return. Default: 10.",
					},
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10) || 10));

			if (!query) {
				return {
					content: [{ type: "text", text: "Error: 'query' is required for search." }],
					isError: true,
				};
			}

			try {
				const { searchDayFiles } = await import("@chitragupta/smriti/day-consolidation");
				const results = searchDayFiles(query, { limit });

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: `No matches found for: ${query}` }],
						_metadata: { action: "day_search", query },
					};
				}

				const lines: string[] = [`Found matches in ${results.length} day(s):\n`];
				for (const r of results) {
					lines.push(`## ${r.date}`);
					for (const m of r.matches) {
						lines.push(`  L${m.line}: ${m.text}`);
					}
					lines.push("");
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					_metadata: { action: "day_search", query },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Unified Recall Tool ─────────────────────────────────────────────────────

/**
 * Create the `chitragupta_recall` tool — unified search across ALL memory layers.
 */
function createRecallTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_recall",
			description:
				"Unified recall — searches ALL of Chitragupta's memory layers " +
				"(sessions, memory, knowledge graph, day files) to answer natural language " +
				"questions. Use this to recall past conversations, decisions, facts, or " +
				"anything that happened across any provider, project, or date.",
			inputSchema: {
				type: "object" as const,
				properties: {
					query: {
						type: "string",
						description:
							"Natural language question. E.g. 'how did I fix the yaxis interval in charts?' " +
							"or 'what do we know about the auth system?'",
					},
					project: {
						type: "string",
						description: "Optional: filter to specific project path.",
					},
					limit: {
						type: "number",
						description: "Max results. Default: 5.",
					},
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			const project = args.project != null ? String(args.project) : undefined;
			const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5) || 5));

			if (!query) {
				return {
					content: [{ type: "text", text: "Error: 'query' is required." }],
					isError: true,
				};
			}

			try {
				const { recall } = await import("@chitragupta/smriti/unified-recall");
				const results = await recall(query, { limit, project });

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: `No recall results for: ${query}` }],
						_metadata: { action: "recall", query },
					};
				}

				const lines: string[] = [`Recall results for "${query}":\n`];
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					lines.push(`**[${i + 1}]** (${(r.score * 100).toFixed(0)}% match, via ${r.primarySource})`);
					lines.push(r.answer);
					if (r.sessionId) lines.push(`  Session: ${r.sessionId}`);
					if (r.date) lines.push(`  Date: ${r.date}`);
					lines.push("");
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					_metadata: { action: "recall", query, resultCount: results.length },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Provider Context Tool ───────────────────────────────────────────────────

/**
 * Create the `chitragupta_context` tool — load memory context for a new session.
 *
 * Returns global facts, project memory, and recent session summaries.
 * Call this at session start to bootstrap persistent memory into any provider.
 */
function createContextTool(projectPath: string): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_context",
			description:
				"Load memory context for a new session. Returns global facts, project memory, " +
				"and recent session summaries. Call this at the start of every session to get " +
				"persistent memory.",
			inputSchema: {
				type: "object" as const,
				properties: {
					project: {
						type: "string",
						description: "Project path for project-specific memory. Defaults to current project.",
					},
				},
				required: [],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const project = args.project != null ? String(args.project) : projectPath;

			try {
				const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
				const ctx = await loadProviderContext(project);

				if (ctx.itemCount === 0) {
					return {
						content: [{ type: "text", text: "No memory context found. This appears to be a fresh start." }],
						_metadata: { action: "context", itemCount: 0 },
					};
				}

				return {
					content: [{ type: "text", text: ctx.assembled }],
					_metadata: { action: "context", itemCount: ctx.itemCount },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Server Entry Point ─────────────────────────────────────────────────────

/**
 * Run Chitragupta as an MCP server.
 *
 * Exposes all built-in tools, memory search, session management,
 * and optionally the agent prompt tool over the MCP protocol.
 *
 * @param options - Server configuration.
 */
export async function runMcpServerMode(options: McpServerModeOptions = {}): Promise<void> {
	const {
		transport = "stdio",
		port = 3001,
		projectPath = process.cwd(),
		name = "chitragupta",
		enableAgent = false,
	} = options;

	// ─── 1. Collect all tools ────────────────────────────────────────
	const mcpTools: McpToolHandler[] = [];

	// Convert yantra built-in tools to MCP format
	const builtinTools: ToolHandler[] = getBuiltinTools();
	for (const tool of builtinTools) {
		mcpTools.push(chitraguptaToolToMcp(tool as unknown as ChitraguptaToolHandler));
	}

	// Add Chitragupta-specific MCP tools
	mcpTools.push(createMemorySearchTool(projectPath));
	mcpTools.push(createSessionListTool(projectPath));
	mcpTools.push(createSessionShowTool(projectPath));

	// Optionally add agent prompt tool
	if (enableAgent) {
		mcpTools.push(createAgentPromptTool());
	}

	// Add handover tool (context continuity across compaction)
	mcpTools.push(createHandoverTool(projectPath));

	// Add coding agent tool (CodingOrchestrator / Sanyojaka)
	mcpTools.push(createCodingAgentTool(projectPath));

	// Add multi-agent & collective intelligence tools (Phase 5.3)
	mcpTools.push(createSamitiChannelsTool());
	mcpTools.push(createSamitiBroadcastTool());
	mcpTools.push(createSabhaDeliberateTool());
	mcpTools.push(createAkashaTracesTool());
	mcpTools.push(createAkashaDepositTool());
	mcpTools.push(createVasanaTendenciesTool(projectPath));
	mcpTools.push(createHealthStatusTool());
	mcpTools.push(createAtmanReportTool());

	// Add day file query tools (consolidated daily diaries)
	mcpTools.push(createDayShowTool());
	mcpTools.push(createDayListTool());
	mcpTools.push(createDaySearchTool());

	// Add unified recall tool (searches ALL memory layers)
	mcpTools.push(createRecallTool());

	// Add provider context tool (memory injection on session start)
	mcpTools.push(createContextTool(projectPath));

	// ─── 2. Session recording ───────────────────────────────────────
	// Lazy-init: create a session on the first tool call, record every
	// tool invocation as a turn. This gives /last_session and /recall
	// something to work with.
	let mcpSessionId: string | null = null;
	let turnCounter = 0;

	const ensureSession = async () => {
		if (mcpSessionId) return mcpSessionId;
		try {
			const { createSession } = await import("@chitragupta/smriti/session-store");
			const session = createSession({
				project: projectPath,
				agent: "mcp",
				model: "mcp-client",
				title: `MCP session`,
			});
			mcpSessionId = session.meta.id;
		} catch (err) {
			// Session recording is best-effort — don't break MCP if smriti fails
			process.stderr.write(`[chitragupta] session init failed: ${err}\n`);
		}
		return mcpSessionId;
	};

	/** Extract user-facing text from tool arguments for fact extraction. */
	function extractUserText(args: Record<string, unknown>): string | null {
		// Direct content fields
		for (const key of ["content", "text", "query", "message", "task", "proposal"]) {
			const val = args[key];
			if (typeof val === "string" && val.length > 5 && val.length < 5000) {
				return val;
			}
		}
		return null;
	}

	const recordToolCall = async (info: { tool: string; args: Record<string, unknown>; result: import("@chitragupta/tantra").McpToolResult; elapsedMs: number }) => {
		const sid = await ensureSession();
		if (!sid) return;

		try {
			const { addTurn } = await import("@chitragupta/smriti/session-store");

			// Record tool call as a user turn (the request) — no truncation
			const argSummary = Object.keys(info.args).length > 0
				? JSON.stringify(info.args, null, 2)
				: "(no args)";
			await addTurn(sid, projectPath, {
				turnNumber: 0,
				role: "user",
				content: `[tool:${info.tool}] ${argSummary}`,
				agent: "mcp-client",
				model: "mcp",
			});

			// Record tool result as an assistant turn (the response) — no truncation
			const resultText = info.result.content
				?.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n") ?? "(no output)";
			await addTurn(sid, projectPath, {
				turnNumber: 0,
				role: "assistant",
				content: `[${info.tool} → ${info.elapsedMs.toFixed(0)}ms] ${resultText}`,
				agent: "mcp",
				model: "mcp",
			});

			turnCounter += 2;

			// Real-time fact extraction on all user-facing content
			try {
				const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
				const extractor = getFactExtractor();
				// Extract from the arguments (which contain user input)
				const userText = extractUserText(info.args);
				if (userText) {
					await extractor.extractAndSave(
						userText,
						{ type: "global" },
						{ type: "project", path: projectPath },
					);
				}
			} catch {
				// Best-effort — never break recording
			}

			// Auto-extract key events for memory persistence
			try {
				await autoExtractEvents(info, projectPath);
			} catch {
				// Best-effort — don't break recording if extraction fails
			}

			// Update state file with session info
			writeChitraguptaState({
				sessionId: sid,
				project: projectPath,
				turnCount: turnCounter,
				lastTool: info.tool,
			});
		} catch (err) {
			process.stderr.write(`[chitragupta] record failed: ${err}\n`);
		}
	};

	/**
	 * Auto-extract significant events from tool calls and persist to project memory.
	 * Fires for: coding_agent results, file modifications, deliberation outcomes.
	 */
	const autoExtractEvents = async (
		info: { tool: string; args: Record<string, unknown>; result: import("@chitragupta/tantra").McpToolResult; elapsedMs: number },
		project: string,
	) => {
		const resultText = info.result.content
			?.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n") ?? "";

		const projectScope = { type: "project" as const, path: project };

		// coding_agent — record plan, files changed, and outcome
		if (info.tool === "coding_agent") {
			const { appendMemory } = await import("@chitragupta/smriti/memory-store");
			const task = String(info.args.task ?? "").slice(0, 500);
			const success = !info.result.isError && resultText.includes("✓");
			const filesMatch = resultText.match(/(?:Modified|Created): (.+)/g);
			const files = filesMatch ? filesMatch.join("; ") : "none";
			const elapsed = (info.elapsedMs / 1000).toFixed(1);
			const summary = [
				`## Coding Agent: ${success ? "Success" : "Failed"}`,
				`**Task**: ${task}`,
				`**Files**: ${files}`,
				`**Duration**: ${elapsed}s`,
			].join("\n");
			await appendMemory(projectScope, summary);
		}

		// sabha_deliberate — record deliberation outcomes
		if (info.tool === "sabha_deliberate") {
			const { appendMemory } = await import("@chitragupta/smriti/memory-store");
			const proposal = String(info.args.proposal ?? "").slice(0, 300);
			const verdict = resultText.match(/verdict[:\s]*(\w+)/i)?.[1] ?? "unknown";
			const summary = `## Deliberation: ${verdict}\n**Proposal**: ${proposal}`;
			await appendMemory(projectScope, summary);
		}

		// write/edit tools — record file modifications
		if (info.tool === "write" || info.tool === "edit") {
			const filePath = String(info.args.path ?? "");
			if (filePath && !info.result.isError) {
				const { appendMemory } = await import("@chitragupta/smriti/memory-store");
				await appendMemory(
					projectScope,
					`File ${info.tool === "write" ? "created" : "edited"}: ${filePath}`,
				);
			}
		}

		// Real-time fact extraction from user turns (provider-agnostic)
		// Intercepts ANY user message and extracts personal facts immediately
		if (info.tool === "record" || resultText.includes("[tool:")) {
			// Skip — these are tool calls, not user statements
		} else {
			// Check if the args contain user-like content
			const userContent = String(info.args.content ?? info.args.text ?? info.args.query ?? "");
			if (userContent.length > 5 && userContent.length < 2000) {
				try {
					const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
					const extractor = getFactExtractor();
					const factProjectScope = { type: "project" as const, path: project };
					await extractor.extractAndSave(userContent, { type: "global" }, factProjectScope);
				} catch {
					// Best-effort — never break recording
				}
			}
		}
	};

	// ─── 3. Create MCP server ────────────────────────────────────────
	const server = new McpServer({
		name,
		version: "0.1.0",
		transport,
		ssePort: port,
		tools: mcpTools,
		resources: [createMemoryResource(projectPath)],
		prompts: [
			createSavePrompt(),
			createLastSessionPrompt(),
			createRecallPrompt(),
			createStatusPrompt(),
			createHandoverPrompt(),
			createReviewPrompt(),
			createDebugPrompt(),
			createResearchPrompt(),
			createRefactorPrompt(),
			createMemorySearchPrompt(),
			createSessionPrompt(),
		],
		onToolCall: recordToolCall,
	});

	// ─── 4. State file + graceful shutdown ───────────────────────────
	_mcpStartedAt = new Date().toISOString();
	writeChitraguptaState({
		active: true,
		project: projectPath,
		lastTool: "(startup)",
	});

	const shutdown = async () => {
		clearChitraguptaState();
		await server.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// ─── 4. Start server ─────────────────────────────────────────────
	if (transport === "stdio") {
		// In stdio mode, log to stderr so stdout stays clean for JSON-RPC
		process.stderr.write(
			`Chitragupta MCP server starting (stdio)...\n` +
			`  Tools: ${mcpTools.length}\n` +
			`  Project: ${projectPath}\n` +
			`  Agent: ${enableAgent ? "enabled" : "disabled"}\n`,
		);
	} else {
		process.stderr.write(
			`Chitragupta MCP server starting (SSE on port ${port})...\n` +
			`  Tools: ${mcpTools.length}\n` +
			`  Project: ${projectPath}\n` +
			`  Agent: ${enableAgent ? "enabled" : "disabled"}\n`,
		);
	}

	await server.start();

	// For stdio, the process stays alive reading stdin.
	// For SSE, the HTTP server keeps the process alive.
	// In either case, we return and let the event loop run.
}
