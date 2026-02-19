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
import { writeChitraguptaState } from "./mcp-state.js";

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
		if (!this.sessionId) {
			try {
				const { createSession } = await import("@chitragupta/smriti/session-store");
				const session = createSession({
					project: this.projectPath,
					agent: "mcp",
					model: "mcp-client",
					title: `MCP session`,
				});
				this.sessionId = session.meta.id;
			} catch (err) {
				process.stderr.write(`[chitragupta] session init failed: ${err}\n`);
			}
		}

		if (!this.contextInjected && this.sessionId) {
			try {
				const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
				const ctx = await loadProviderContext(this.projectPath);
				if (ctx.assembled.trim()) {
					const { addTurn } = await import("@chitragupta/smriti/session-store");
					await addTurn(this.sessionId, this.projectPath, {
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
	}

	/** Extract user-facing text from tool arguments for fact extraction. */
	extractUserText(args: Record<string, unknown>): string | null {
		for (const key of ["content", "text", "query", "message", "task", "proposal"]) {
			const val = args[key];
			if (typeof val === "string" && val.length > 5 && val.length < 5000) return val;
		}
		return null;
	}

	/** Record a tool call (request + response) into the session. */
	async recordToolCall(info: {
		tool: string;
		args: Record<string, unknown>;
		result: McpToolResult;
		elapsedMs: number;
	}): Promise<void> {
		try { this._daemonManager?.touch(); } catch { /* best-effort */ }

		const sid = await this.ensureSession();
		if (!sid) return;

		try {
			const { addTurn } = await import("@chitragupta/smriti/session-store");

			const argSummary = Object.keys(info.args).length > 0
				? JSON.stringify(info.args, null, 2)
				: "(no args)";
			await addTurn(sid, this.projectPath, {
				turnNumber: 0,
				role: "user",
				content: `[tool:${info.tool}] ${argSummary}`,
				agent: "mcp-client",
				model: "mcp",
			});

			const resultText = info.result.content
				?.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n") ?? "(no output)";
			await addTurn(sid, this.projectPath, {
				turnNumber: 0,
				role: "assistant",
				content: `[${info.tool} → ${info.elapsedMs.toFixed(0)}ms] ${resultText}`,
				agent: "mcp",
				model: "mcp",
			});

			this.turnCounter += 2;

			try {
				const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
				const extractor = getFactExtractor();
				const userText = this.extractUserText(info.args);
				if (userText) {
					await extractor.extractAndSave(
						userText,
						{ type: "global" },
						{ type: "project", path: this.projectPath },
					);
				}
			} catch { /* best-effort */ }

			try {
				await this.autoExtractEvents(info);
			} catch { /* best-effort */ }

			writeChitraguptaState({
				sessionId: sid,
				project: this.projectPath,
				turnCount: this.turnCounter,
				lastTool: info.tool,
			});
		} catch (err) {
			process.stderr.write(`[chitragupta] record failed: ${err}\n`);
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
		const resultText = info.result.content
			?.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n") ?? "";

		const projectScope = { type: "project" as const, path: this.projectPath };

		if (info.tool === "coding_agent") {
			const { appendMemory } = await import("@chitragupta/smriti/memory-store");
			const task = String(info.args.task ?? "").slice(0, 500);
			const success = !info.result.isError && resultText.includes("✓");
			const filesMatch = resultText.match(/(?:Modified|Created): (.+)/g);
			const files = filesMatch ? filesMatch.join("; ") : "none";
			const elapsed = (info.elapsedMs / 1000).toFixed(1);
			await appendMemory(projectScope, [
				`## Coding Agent: ${success ? "Success" : "Failed"}`,
				`**Task**: ${task}`, `**Files**: ${files}`, `**Duration**: ${elapsed}s`,
			].join("\n"));
		}

		if (info.tool === "sabha_deliberate") {
			const { appendMemory } = await import("@chitragupta/smriti/memory-store");
			const proposal = String(info.args.proposal ?? "").slice(0, 300);
			const verdict = resultText.match(/verdict[:\s]*(\w+)/i)?.[1] ?? "unknown";
			await appendMemory(projectScope, `## Deliberation: ${verdict}\n**Proposal**: ${proposal}`);
		}

		if (info.tool === "write" || info.tool === "edit") {
			const filePath = String(info.args.path ?? "");
			if (filePath && !info.result.isError) {
				const { appendMemory } = await import("@chitragupta/smriti/memory-store");
				await appendMemory(projectScope, `File ${info.tool === "write" ? "created" : "edited"}: ${filePath}`);
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

					const { addTurn } = await import("@chitragupta/smriti/session-store");
					let recorded = 0;

					for (const turn of capped) {
						const role = (turn as Record<string, unknown>).role;
						const content = (turn as Record<string, unknown>).content;
						if ((role !== "user" && role !== "assistant") || typeof content !== "string" || content.length === 0) continue;

						const truncated = content.length > 100_000 ? content.slice(0, 100_000) + "\n...[truncated]" : content;
						await addTurn(sid, this.projectPath, {
							turnNumber: 0,
							role,
							content: `[conversation] ${truncated}`,
							agent: role === "user" ? "mcp-client" : "mcp-host",
							model: "mcp",
						});
						recorded++;
					}

					this.turnCounter += recorded;

					try {
						const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
						const extractor = getFactExtractor();
						for (const turn of capped) {
							const t = turn as Record<string, unknown>;
							if (t.role === "user" && typeof t.content === "string" &&
								t.content.length > 5 && t.content.length < 5000) {
								await extractor.extractAndSave(
									t.content,
									{ type: "global" },
									{ type: "project", path: this.projectPath },
								);
							}
						}
					} catch { /* best-effort */ }

					try { this._daemonManager?.touch(); } catch { /* best-effort */ }

					return { content: [{ type: "text", text: `Recorded ${recorded} conversation turn(s).` }] };
				} catch (err) {
					return {
						content: [{ type: "text", text: `Failed to record: ${err instanceof Error ? err.message : String(err)}` }],
						isError: true,
					};
				}
			},
		};
	}
}
