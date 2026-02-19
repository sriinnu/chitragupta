/**
 * @chitragupta/anina — Agent loop execution.
 *
 * Standalone functions extracted from the Agent class for the core
 * agent loop, LLM streaming, and tool execution with full support
 * for policy, autonomy, learning, chetana, and lokapala hooks.
 */

import { AbortError } from "@chitragupta/core";
import type { CostBreakdown, StopReason } from "@chitragupta/core";
import type {
	ContentPart,
	Context,
	ProviderDefinition,
	StreamOptions,
	ToolCallContent,
	ToolResultContent,
} from "@chitragupta/swara";

import type { AutonomousAgent } from "./agent-autonomy.js";
import type { ChetanaController } from "./chetana/controller.js";
import type { ContextManager } from "./context-manager.js";
import type { LearningLoop } from "./learning-loop.js";
import type { SteeringManager } from "./steering.js";
import type { ToolExecutor } from "./tool-executor.js";
import { findLastAssistantMessage, mergeTextParts } from "./agent-subagent.js";
import type {
	AgentConfig,
	AgentEventType,
	AgentMessage,
	AgentState,
	KaalaLifecycle,
	LokapalaGuardians,
	MeshSamiti,
	ToolContext,
} from "./types.js";

// ─── Loop Dependencies ───────────────────────────────────────────────────────

/** Dependencies required by the agent loop functions. */
export interface AgentLoopDeps {
	readonly agentId: string;
	readonly purpose: string;
	state: AgentState;
	config: AgentConfig;
	provider: ProviderDefinition;
	abortController: AbortController | null;
	maxTurns: number;
	workingDirectory: string;
	toolExecutor: ToolExecutor;
	contextManager: ContextManager;
	steeringManager: SteeringManager;
	learningLoop: LearningLoop | null;
	autonomousAgent: AutonomousAgent | null;
	chetana: ChetanaController | null;
	lokapala: LokapalaGuardians | null;
	kaala: KaalaLifecycle | null;
	samiti: MeshSamiti | null;
	emit: (event: AgentEventType, data: unknown) => void;
	createMessage: (
		role: AgentMessage["role"],
		content: ContentPart[],
		extra?: { model?: string; cost?: CostBreakdown },
	) => AgentMessage;
}

// ─── Stream Options ──────────────────────────────────────────────────────────

/** Build LLM streaming options from agent state and config. */
export function buildStreamOptions(deps: AgentLoopDeps): StreamOptions {
	const options: StreamOptions = { signal: deps.abortController?.signal };
	if (deps.state.thinkingLevel !== "none") {
		const defaults = { low: 2048, medium: 8192, high: 32768 };
		const budgets = { ...defaults, ...deps.config.thinkingBudgets };
		options.thinking = {
			enabled: true,
			budgetTokens: budgets[deps.state.thinkingLevel] ?? 8192,
		};
	}
	return options;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

/**
 * Run the core agent loop: LLM → tool execution → repeat.
 * Continues until the LLM stops calling tools or maxTurns is reached.
 */
export async function runAgentLoop(deps: AgentLoopDeps): Promise<AgentMessage> {
	deps.state.isStreaming = true;
	let turn = 0;

	while (turn < deps.maxTurns) {
		turn++;
		deps.emit("turn:start", { turn, maxTurns: deps.maxTurns });

		if (deps.kaala) {
			try { deps.kaala.recordHeartbeat(deps.agentId, { turnCount: turn }); } catch { /* best-effort */ }
		}

		const steering = deps.steeringManager.getSteeringInstruction();
		if (steering) {
			deps.state.messages.push(
				deps.createMessage("system", [{ type: "text", text: steering }]),
			);
		}

		const userMsg = deps.state.messages.filter((m) => m.role === "user").pop();
		const userText = userMsg?.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { text: string }).text)
			.join("") ?? undefined;
		const chetanaCtx = deps.chetana?.beforeTurn(userText);
		if (chetanaCtx && chetanaCtx.steeringSuggestions.length > 0) {
			deps.steeringManager.steer(chetanaCtx.steeringSuggestions.join(". "));
		}

		const context = deps.contextManager.buildContext(deps.state);
		const streamOptions = buildStreamOptions(deps);
		const result = await streamLLMResponse(deps, context, streamOptions);

		if (deps.kaala && result.cost) {
			try {
				const tokenUsage = (result.cost.input ?? 0) + (result.cost.output ?? 0);
				deps.kaala.recordHeartbeat(deps.agentId, { turnCount: turn, tokenUsage });
			} catch { /* best-effort */ }
		}

		const assistantMessage = deps.createMessage("assistant", result.content, {
			model: deps.state.model, cost: result.cost,
		});
		deps.state.messages.push(assistantMessage);

		const toolCalls = result.content.filter(
			(part): part is ToolCallContent => part.type === "tool_call",
		);

		if (toolCalls.length === 0 || result.stopReason !== "tool_use") {
			deps.emit("turn:done", { turn, reason: result.stopReason });
			deps.chetana?.afterTurn();
			return assistantMessage;
		}

		await executeToolCalls(deps, toolCalls);
		deps.emit("turn:done", { turn, reason: "tool_use" });
		deps.chetana?.afterTurn();

		if (deps.abortController?.signal.aborted) {
			throw new AbortError("Agent loop aborted");
		}
	}

	const lastAssistant = findLastAssistantMessage(deps.state.messages);
	if (lastAssistant) return lastAssistant;

	const fallback = deps.createMessage("assistant", [
		{ type: "text", text: "[Max turns reached without a response]" },
	]);
	deps.state.messages.push(fallback);
	return fallback;
}

// ─── LLM Streaming ──────────────────────────────────────────────────────────

/** Stream an LLM response and collect content parts. */
export async function streamLLMResponse(
	deps: AgentLoopDeps,
	context: Context,
	options: StreamOptions,
): Promise<{ content: ContentPart[]; stopReason: StopReason; cost?: CostBreakdown }> {
	const content: ContentPart[] = [];
	let stopReason: StopReason = "end_turn";
	let cost: CostBreakdown | undefined;

	deps.emit("stream:start", {});
	const signal = deps.abortController?.signal;
	if (signal?.aborted) return { content: mergeTextParts(content), stopReason, cost };

	const stream = deps.provider.stream(deps.state.model, context, options);

	for await (const event of stream) {
		if (signal?.aborted) throw new AbortError("Stream aborted");

		switch (event.type) {
			case "start":
				deps.emit("stream:start", { messageId: event.messageId });
				break;
			case "text":
				content.push({ type: "text", text: event.text });
				deps.emit("stream:text", { text: event.text });
				break;
			case "thinking":
				content.push({ type: "thinking", text: event.text });
				deps.emit("stream:thinking", { text: event.text });
				break;
			case "tool_call":
				content.push({ type: "tool_call", id: event.id, name: event.name, arguments: event.arguments });
				deps.emit("stream:tool_call", { id: event.id, name: event.name, arguments: event.arguments });
				break;
			case "usage":
				deps.emit("stream:usage", { usage: event.usage });
				break;
			case "done":
				stopReason = event.stopReason;
				cost = event.cost;
				deps.emit("stream:done", { stopReason: event.stopReason, usage: event.usage, cost: event.cost });
				break;
			case "error":
				deps.emit("stream:error", { error: event.error });
				throw event.error;
		}
	}

	return { content: mergeTextParts(content), stopReason, cost };
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

/** Execute tool calls with policy, autonomy, learning, chetana, and lokapala hooks. */
export async function executeToolCalls(
	deps: AgentLoopDeps,
	toolCalls: ToolCallContent[],
): Promise<void> {
	const context: ToolContext = {
		sessionId: deps.state.sessionId,
		workingDirectory: deps.workingDirectory,
		signal: deps.abortController?.signal,
	};

	for (const call of toolCalls) {
		if (deps.abortController?.signal.aborted) throw new AbortError("Tool execution aborted");
		deps.emit("tool:start", { name: call.name, id: call.id });

		let args: Record<string, unknown>;
		try {
			args = JSON.parse(call.arguments);
		} catch {
			deps.emit("stream:error", {
				error: `Malformed JSON in tool call args for "${call.name}": ${call.arguments.slice(0, 100)}`,
			});
			deps.state.messages.push(deps.createMessage("tool_result", [{
				type: "tool_result", toolCallId: call.id,
				content: `Error: Failed to parse tool arguments as JSON for "${call.name}"`,
				isError: true,
			}]));
			continue;
		}

		if (shouldBlockByPolicy(deps, call, args)) continue;
		if (shouldBlockByAutonomy(deps, call)) continue;

		deps.learningLoop?.markToolStart(call.name);
		deps.autonomousAgent?.onToolStart(call.name);
		const toolStartTime = Date.now();

		try {
			const result = await deps.toolExecutor.execute(call.name, args, context);
			deps.emit("tool:done", { name: call.name, id: call.id, result });
			deps.learningLoop?.recordToolUsage(call.name, args, result);
			deps.autonomousAgent?.onToolUsed(call.name, args, result);
			deps.chetana?.afterToolExecution(call.name, true, Date.now() - toolStartTime, result.content);
			scanLokapala(deps, call.name, args, result.content, toolStartTime);

			deps.state.messages.push(deps.createMessage("tool_result", [{
				type: "tool_result", toolCallId: call.id,
				content: result.content, isError: result.isError,
			}]));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.emit("tool:error", { name: call.name, id: call.id, error: message });

			const errorResult = { content: message, isError: true as const };
			deps.learningLoop?.recordToolUsage(call.name, args, errorResult);
			deps.autonomousAgent?.onToolUsed(call.name, args, errorResult);
			deps.chetana?.afterToolExecution(
				call.name, false, Date.now() - toolStartTime, message, false,
			);

			deps.state.messages.push(deps.createMessage("tool_result", [{
				type: "tool_result", toolCallId: call.id,
				content: `Error: ${message}`, isError: true,
			}]));
		}
	}
}

// ─── Tool Call Helpers ───────────────────────────────────────────────────────

/** Check policy engine and push error result if blocked. Returns true if blocked. */
function shouldBlockByPolicy(
	deps: AgentLoopDeps,
	call: ToolCallContent,
	args: Record<string, unknown>,
): boolean {
	if (!deps.config.policyEngine) return false;
	try {
		const verdict = deps.config.policyEngine.check(call.name, args);
		if (!verdict.allowed) {
			const reason = verdict.reason ?? "Blocked by policy engine";
			deps.emit("tool:error", { name: call.name, id: call.id, error: reason });
			deps.state.messages.push(deps.createMessage("tool_result", [{
				type: "tool_result", toolCallId: call.id,
				content: `Policy denied: ${reason}`, isError: true,
			}]));
			return true;
		}
	} catch (policyErr) {
		const errMsg = policyErr instanceof Error ? policyErr.message : String(policyErr);
		deps.emit("tool:error", { name: call.name, id: call.id, error: `Policy engine error: ${errMsg}` });
		deps.state.messages.push(deps.createMessage("tool_result", [{
			type: "tool_result", toolCallId: call.id,
			content: `Policy engine error: ${errMsg}`, isError: true,
		}]));
		return true;
	}
	return false;
}

/** Check autonomy layer and push error result if tool is disabled. Returns true if blocked. */
function shouldBlockByAutonomy(deps: AgentLoopDeps, call: ToolCallContent): boolean {
	if (!deps.autonomousAgent?.isToolDisabled(call.name)) return false;
	const msg = `Tool "${call.name}" is temporarily disabled due to repeated failures`;
	deps.emit("tool:error", { name: call.name, id: call.id, error: msg });
	deps.state.messages.push(deps.createMessage("tool_result", [{
		type: "tool_result", toolCallId: call.id,
		content: `Error: ${msg}`, isError: true,
	}]));
	return true;
}

/** Run Lokapala guardian scans after tool execution. */
function scanLokapala(
	deps: AgentLoopDeps,
	toolName: string,
	args: Record<string, unknown>,
	resultContent: string,
	toolStartTime: number,
): void {
	if (!deps.lokapala) return;
	try {
		const findings = deps.lokapala.afterToolExecution(
			toolName, args, resultContent, Date.now() - toolStartTime,
		);
		for (const finding of findings) {
			if (finding.severity === "critical" && deps.samiti) {
				deps.samiti.broadcast(`#${finding.domain}`, {
					sender: deps.agentId, severity: "critical",
					category: `guardian-${finding.guardianId}`,
					content: finding.title, data: finding,
				});
			}
		}
	} catch { /* Guardian scanning is best-effort */ }
}
