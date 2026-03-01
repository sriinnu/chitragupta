/**
 * MCP Session Recording.
 *
 * Encapsulates session lifecycle, tool-call recording, conversation
 * recording, auto-context injection, and fact extraction for the MCP
 * server. Instances are created once per {@link runMcpServerMode} call.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { DaemonUnavailableError } from "@chitragupta/daemon";
import { writeChitraguptaState } from "./mcp-state.js";

// ─── ANSI & Semantic Helpers ────────────────────────────────────────────────

/** Strip ANSI escape sequences from text. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");
}

/** Tools whose args carry meaningful user intent (queries, tasks, proposals). */
const SEMANTIC_TOOLS = new Set([
	"chitragupta_recall", "chitragupta_memory_search", "chitragupta_prompt",
	"chitragupta_record_conversation", "coding_agent", "sabha_deliberate",
	"akasha_deposit", "akasha_traces",
]);

/** Tools that return status/summary — store one-line summary, not full output. */
const SUMMARY_TOOLS = new Set([
	"chitragupta_session_list", "chitragupta_session_show", "chitragupta_context",
	"chitragupta_day_show", "chitragupta_day_search", "chitragupta_vidhis",
	"mesh_status", "mesh_spawn", "health_status", "atman_report",
	"vasana_tendencies", "chitragupta_consolidate",
]);

/** Filesystem/shell tools — store action + path, not full content. */
const FILE_TOOLS = new Set([
	"read", "write", "edit", "grep", "find", "ls", "bash", "diff", "watch",
	"project_analysis",
]);

/** Extract user intent string from tool args. */
function extractIntent(args: Record<string, unknown>): string {
	for (const key of ["query", "message", "task", "proposal", "prompt", "content", "text"]) {
		const val = args[key];
		if (typeof val === "string" && val.length > 3 && val.length < 2000) {
			return val.slice(0, 500);
		}
	}
	return "";
}

/** Extract meaningful content from a tool call. Returns `[userContent, assistantContent]`. */
function extractSemanticContent(
	tool: string,
	args: Record<string, unknown>,
	resultText: string,
	elapsedMs: number,
): [string, string] {
	const cleanResult = stripAnsi(resultText);

	if (SEMANTIC_TOOLS.has(tool)) {
		const intent = extractIntent(args);
		const summary = cleanResult.slice(0, 500);
		return [intent || `Used ${tool}`, `${tool}: ${summary}`];
	}

	if (FILE_TOOLS.has(tool)) {
		const filePath = String(args.path ?? args.file_path ?? args.pattern ?? "");
		const action = tool === "read" ? "Read" : tool === "write" ? "Wrote"
			: tool === "edit" ? "Edited" : tool === "grep" ? "Searched"
			: tool === "bash" ? "Ran" : `Used ${tool} on`;
		return [
			`${action} ${filePath}`.trim(),
			`${action} ${filePath} (${elapsedMs.toFixed(0)}ms)`.trim(),
		];
	}

	if (SUMMARY_TOOLS.has(tool)) {
		const summary = cleanResult.split("\n")[0]?.slice(0, 200) ?? "";
		return [`Checked ${tool}`, `${tool}: ${summary}`];
	}

	const intent = extractIntent(args);
	return [
		intent || `Used ${tool}`,
		`${tool}: ${cleanResult.slice(0, 300)}`,
	];
}

/** Check if error indicates daemon is unreachable (socket errors, unavailable). */
function isDaemonError(err: unknown): boolean {
	if (err instanceof DaemonUnavailableError) return true;
	const code = (err as NodeJS.ErrnoException).code;
	return typeof code === "string" && ["ECONNREFUSED", "ENOENT", "EPIPE", "ECONNRESET"].includes(code);
}

// ─── Session Recorder ───────────────────────────────────────────────────────

/**
 * Manages a single MCP session's lifecycle: creation, turn recording,
 * context injection, and fact extraction. Mutable state is encapsulated
 * so the server entry-point remains stateless.
 */
export class McpSessionRecorder {
	private sessionId: string | null = null;
	private turnCounter = 0;
	private contextInjected = false;
	private ensureSessionPromise: Promise<string | null> | null = null;
	private _daemonManager: { touch(): void } | null = null;

	constructor(private readonly projectPath: string) {}

	/** Wire the daemon manager for activity signalling. */
	set daemonManager(dm: { touch(): void } | null) {
		this._daemonManager = dm;
	}

	/** Current turn count for this session. */
	get turns(): number {
		return this.turnCounter;
	}

	/** Lazily create a session and inject provider context on first call. */
	async ensureSession(): Promise<string | null> {
		if (this.sessionId && this.contextInjected) return this.sessionId;
		if (this.ensureSessionPromise) return this.ensureSessionPromise;

		this.ensureSessionPromise = (async () => {
			if (!this.sessionId) {
				try {
					const bridge = await import("./daemon-bridge.js");
					const result = await bridge.createSession({
						project: this.projectPath,
						agent: "mcp",
						model: "mcp-client",
						title: `MCP session`,
					});
					this.sessionId = result.id;
				} catch (err) {
					process.stderr.write(`[chitragupta] session init failed: ${err}\n`);
				}
			}

			if (!this.contextInjected && this.sessionId) {
				try {
					const ctxBridge = await import("./daemon-bridge.js");
					const ctx = await ctxBridge.loadContextViaDaemon(this.projectPath);
					if (ctx.assembled.trim()) {
						const bridge = await import("./daemon-bridge.js");
						await bridge.addTurn(this.sessionId, this.projectPath, {
							turnNumber: 0,
							role: "assistant",
							content: `[system:context] ${ctx.assembled}`,
							agent: "mcp",
							model: "mcp",
						});
						this.turnCounter++;
					}
					this.contextInjected = true;
				} catch {
					// Best-effort — context injection is optional
				}
			}

			return this.sessionId;
		})();

		try {
			return await this.ensureSessionPromise;
		} finally {
			this.ensureSessionPromise = null;
		}
	}

	/** Extract user-facing text from tool arguments for fact extraction. */
	extractUserText(args: Record<string, unknown>): string | null {
		for (const key of ["content", "text", "query", "message", "task", "proposal"]) {
			const val = args[key];
			if (typeof val === "string" && val.length > 5 && val.length < 5000) return val;
		}
		return null;
	}

	/** Decide if text is worth fact extraction (filters chatter and commands). */
	private shouldExtractFact(tool: string, text: string): boolean {
		const normalized = text.trim();
		const lower = normalized.toLowerCase();
		if (normalized.length < 8 || normalized.length > 5000) return false;
		if (/^\/[a-z0-9_-]+/i.test(lower)) return false;
		if (/^(hi|hii|hello|hey|yo|thanks|thank you|ok|okay|cool|fine)\b/.test(lower) && normalized.length < 48) {
			return false;
		}
		const hasMemorySignal =
			/\b(remember|don't forget|note this|save this|from now on|always|call me|my name is|i am|i'm|i live|i work|i prefer|we use|our stack)\b/i.test(
				lower,
			);
		const hasFirstPerson = /\b(i|i'm|i am|my|we|our)\b/i.test(lower);
		const isQuestion = /\?\s*$/.test(lower);
		if (isQuestion && !hasMemorySignal) return false;
		if (!hasMemorySignal && !hasFirstPerson) return false;
		if (tool === "chitragupta_record_conversation") return true;
		// Semantic tools always carry user intent worth extracting
		if (SEMANTIC_TOOLS.has(tool)) return true;
		return hasMemorySignal;
	}

	/** Record a tool call (request + response) into the session. */
	async recordToolCall(info: {
		tool: string;
		args: Record<string, unknown>;
		result: McpToolResult;
		elapsedMs: number;
	}): Promise<void> {
		try {
			this._daemonManager?.touch();
		} catch {
			/* best-effort */
		}

		const sid = await this.ensureSession();
		if (!sid) return;

		try {
			const bridge = await import("./daemon-bridge.js");

			// chitragupta_record_conversation: execute handler already records
			// each turn individually via bridge.addTurn(). Skip the meta-turn
			// to avoid polluting the turns table with noise.
			if (info.tool === "chitragupta_record_conversation") {
				writeChitraguptaState({
					sessionId: sid,
					project: this.projectPath,
					turnCount: this.turnCounter,
					lastTool: info.tool,
				});
				return;
			}

			const resultText =
				info.result.content
					?.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n") ?? "(no output)";

			const [userContent, assistantContent] = extractSemanticContent(
				info.tool, info.args, resultText, info.elapsedMs,
			);

			await bridge.addTurn(sid, this.projectPath, {
				turnNumber: 0,
				role: "user",
				content: userContent,
				agent: "mcp-client",
				model: "mcp",
			});
			this.turnCounter++;

			await bridge.addTurn(sid, this.projectPath, {
				turnNumber: 0,
				role: "assistant",
				content: assistantContent,
				agent: "mcp",
				model: "mcp",
			});
			this.turnCounter++;

			try {
				const userText = this.extractUserText(info.args);
				if (userText && this.shouldExtractFact(info.tool, userText)) {
					await bridge.extractFacts(userText, this.projectPath);
				}
			} catch {
				/* best-effort */
			}

			try {
				await this.autoExtractEvents(info);
			} catch {
				/* best-effort */
			}

			writeChitraguptaState({
				sessionId: sid,
				project: this.projectPath,
				turnCount: this.turnCounter,
				lastTool: info.tool,
			});
		} catch (err) {
			process.stderr.write(`[chitragupta] record failed: ${err}\n`);
			// Invalidate cached session on daemon restart / connection loss
			// so the next call creates a fresh session via the new daemon.
			if (err instanceof DaemonUnavailableError || isDaemonError(err)) {
				this.sessionId = null;
				this.contextInjected = false;
			}
		}
	}

	/**
	 * Auto-extract significant events from tool calls and persist to project memory.
	 * Fires for: coding_agent results, file modifications, deliberation outcomes.
	 */
	private async autoExtractEvents(info: {
		tool: string;
		args: Record<string, unknown>;
		result: McpToolResult;
		elapsedMs: number;
	}): Promise<void> {
		const bridge = await import("./daemon-bridge.js");
		const resultText =
			info.result.content
				?.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n") ?? "";

		if (info.tool === "coding_agent") {
			const task = String(info.args.task ?? "").slice(0, 500);
			const ok = !info.result.isError && resultText.includes("✓");
			const files = resultText.match(/(?:Modified|Created): (.+)/g)?.join("; ") ?? "none";
			await bridge.appendMemoryViaDaemon("project",
				`## Coding Agent: ${ok ? "Success" : "Failed"}\n**Task**: ${task}\n**Files**: ${files}\n**Duration**: ${(info.elapsedMs / 1000).toFixed(1)}s`,
				this.projectPath);
		} else if (info.tool === "sabha_deliberate") {
			const proposal = String(info.args.proposal ?? "").slice(0, 300);
			const verdict = resultText.match(/verdict[:\s]*(\w+)/i)?.[1] ?? "unknown";
			await bridge.appendMemoryViaDaemon("project",
				`## Deliberation: ${verdict}\n**Proposal**: ${proposal}`,
				this.projectPath);
		} else if ((info.tool === "write" || info.tool === "edit") && !info.result.isError) {
			const filePath = String(info.args.path ?? "");
			if (filePath) {
				await bridge.appendMemoryViaDaemon("project",
					`File ${info.tool === "write" ? "created" : "edited"}: ${filePath}`,
					this.projectPath);
			}
		}
	}

	/** Create the `chitragupta_record_conversation` tool handler. */
	createRecordConversationTool(): McpToolHandler {
		return {
			definition: {
				name: "chitragupta_record_conversation",
				description:
					"Record conversation turns (user messages and assistant responses) " +
					"into the current Chitragupta session. Call this periodically to capture " +
					"conversation context between tool calls.",
				inputSchema: {
					type: "object" as const,
					properties: {
						turns: {
							type: "array",
							description: "Conversation turns to record, in chronological order.",
							items: {
								type: "object",
								properties: {
									role: { type: "string", enum: ["user", "assistant"], description: "Who said this turn." },
									content: { type: "string", description: "The text content of the turn." },
								},
								required: ["role", "content"],
							},
						},
					},
					required: ["turns"],
				},
			},
			execute: async (args: Record<string, unknown>): Promise<McpToolResult> => {
				const turns = args.turns;
				if (!Array.isArray(turns) || turns.length === 0) {
					return { content: [{ type: "text", text: "No turns provided." }], isError: true };
				}

				const capped = turns.slice(0, 50);

				try {
					const sid = await this.ensureSession();
					if (!sid) {
						return { content: [{ type: "text", text: "Session not available." }], isError: true };
					}

					const bridge = await import("./daemon-bridge.js");
					let recorded = 0;
					for (const turn of capped) {
						const role = (turn as Record<string, unknown>).role;
						const content = (turn as Record<string, unknown>).content;
						if ((role !== "user" && role !== "assistant") || typeof content !== "string" || content.length === 0)
							continue;

						const truncated = content.length > 100_000 ? content.slice(0, 100_000) + "\n...[truncated]" : content;
						await bridge.addTurn(sid, this.projectPath, {
							turnNumber: 0,
							role,
							content: truncated,
							agent: role === "user" ? "mcp-client" : "mcp-host",
							model: "mcp",
						});
						recorded++;
						this.turnCounter++;
					}

					try {
						for (const turn of capped) {
							const t = turn as Record<string, unknown>;
							if (
								t.role === "user" &&
								typeof t.content === "string" &&
								t.content.length > 5 &&
								t.content.length < 5000 &&
								this.shouldExtractFact("chitragupta_record_conversation", t.content)
							) {
								await bridge.extractFacts(t.content, this.projectPath);
							}
						}
					} catch {
						/* best-effort */
					}

					try {
						this._daemonManager?.touch();
					} catch {
						/* best-effort */
					}
					writeChitraguptaState({
						sessionId: sid,
						project: this.projectPath,
						turnCount: this.turnCounter,
						lastTool: "chitragupta_record_conversation",
					});

					return { content: [{ type: "text", text: `Recorded ${recorded} conversation turn(s).` }] };
				} catch (err) {
					// Invalidate session on daemon disconnection so next call reconnects
					if (isDaemonError(err)) {
						this.sessionId = null;
						this.contextInjected = false;
					}
					return {
						content: [{ type: "text", text: `Failed to record: ${err instanceof Error ? err.message : String(err)}` }],
						isError: true,
					};
				}
			},
		};
	}
}
