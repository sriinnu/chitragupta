/**
 * @chitragupta/cli — Interactive mode agent event handling.
 *
 * Handles streaming events from the Agent (text, thinking, tool calls,
 * usage, completion) and Sandesha input request unwrapping.
 * Extracted from the main interactive module to stay under 450 LOC.
 */

import type { AgentEventType } from "@chitragupta/anina";
import type { InputRequest, CostBreakdown, TokenUsage } from "@chitragupta/core";
import { dim, reset } from "@chitragupta/ui/ansi";
import type { SessionStats } from "./interactive-render.js";
import {
	THEME,
	printAssistantLabel,
	printThinkingStart,
	printThinkingEnd,
	printToolStart,
	printToolEnd,
	printError,
	printInputRequest,
	printBudgetWarning,
} from "./interactive-render.js";
import { BudgetTracker } from "../budget-tracker.js";

// ─── Sandesha Input Routing ──────────────────────────────────────────────────

/**
 * Unwrap an InputRequest from potentially nested subagent:event wrappers.
 *
 * When a sub-agent emits `agent:input_request`, each parent wraps it in a
 * `subagent:event` envelope. This function recursively unwraps to find the
 * original InputRequest payload.
 *
 * @param event - The event type string.
 * @param data - The event payload.
 * @returns The InputRequest if found, or null.
 */
export function unwrapInputRequest(event: string, data: unknown): InputRequest | null {
	if (event === "agent:input_request") {
		return data as InputRequest;
	}

	if (event === "subagent:event") {
		const envelope = data as Record<string, unknown>;
		const innerEvent = envelope.originalEvent as string | undefined;
		const innerData = envelope.data;
		if (innerEvent) {
			return unwrapInputRequest(innerEvent, innerData);
		}
	}

	return null;
}

// ─── Agent Event Handler State ───────────────────────────────────────────────

/** Mutable state passed to the event handler. */
export interface EventHandlerState {
	spinner: { start(): void; stop(): void; setLabel(label: string): void };
	stats: SessionStats;
	budgetTracker: BudgetTracker;
	stdout: NodeJS.WriteStream;
	profileName: string;
	pendingInputRequests: InputRequest[];
	/** Updated by the event handler when budget is exceeded. */
	budgetBlocked: boolean;
	/** Current streaming text accumulator. */
	streamingText: string;
	/** Whether we are inside a thinking block. */
	inThinking: boolean;
	/** Timestamp when a tool call started. */
	toolStartTime: number;
}

/**
 * Create the agent event handler function.
 *
 * This factory returns a handler that can be passed to agent.setOnEvent().
 * It mutates the shared state object for cross-event coordination.
 *
 * @param state - Mutable event handler state shared with the main loop.
 * @returns The event handler function.
 */
export function createAgentEventHandler(
	state: EventHandlerState,
): (event: AgentEventType, data: unknown) => void {
	const { stdout } = state;

	return (event: AgentEventType, data: unknown) => {
		const eventData = data as Record<string, unknown>;

		switch (event) {
			case "stream:start":
				state.spinner.start();
				break;

			case "stream:text": {
				const text = eventData.text as string;
				state.spinner.stop();
				if (!state.streamingText && !state.inThinking) {
					printAssistantLabel(stdout, state.profileName);
				}
				if (state.inThinking) {
					printThinkingEnd(stdout);
					state.inThinking = false;
				}
				stdout.write(text);
				state.streamingText += text;
				break;
			}

			case "stream:thinking": {
				const text = eventData.text as string;
				state.spinner.stop();
				if (!state.inThinking) {
					if (!state.streamingText) {
						printAssistantLabel(stdout, state.profileName);
					}
					printThinkingStart(stdout);
					state.inThinking = true;
				}
				stdout.write(`${THEME.thinking}\u2502${reset} ${dim(text)}`);
				break;
			}

			case "stream:tool_call": {
				const name = eventData.name as string;
				const args = eventData.input as string | undefined;
				if (state.inThinking) {
					stdout.write("\n");
					printThinkingEnd(stdout);
					state.inThinking = false;
				}
				state.toolStartTime = Date.now();
				printToolStart(stdout, name, args);
				break;
			}

			case "tool:start": {
				const name = eventData.name as string;
				state.spinner.setLabel(`Running ${name}...`);
				break;
			}

			case "tool:done": {
				const duration = state.toolStartTime > 0 ? Date.now() - state.toolStartTime : undefined;
				printToolEnd(stdout, "done", duration);
				state.toolStartTime = 0;
				break;
			}

			case "tool:error": {
				const errorMsg = eventData.error as string;
				const duration = state.toolStartTime > 0 ? Date.now() - state.toolStartTime : undefined;
				printToolEnd(stdout, "error", duration);
				printError(stdout, errorMsg);
				state.toolStartTime = 0;
				break;
			}

			case "stream:usage": {
				const usage = eventData.usage as TokenUsage;
				if (usage) {
					state.stats.totalInputTokens += usage.inputTokens;
					state.stats.totalOutputTokens += usage.outputTokens;
				}
				break;
			}

			case "stream:done": {
				state.spinner.stop();
				if (state.inThinking) {
					stdout.write("\n");
					printThinkingEnd(stdout);
					state.inThinking = false;
				}

				const cost = eventData.cost as CostBreakdown | undefined;
				if (cost) {
					state.stats.totalCost += cost.total;
					const budgetStatus = state.budgetTracker.recordCost(cost.total);
					if (budgetStatus.sessionWarning || budgetStatus.sessionExceeded ||
						budgetStatus.dailyWarning || budgetStatus.dailyExceeded) {
						printBudgetWarning(stdout, budgetStatus);
					}
					const proceed = state.budgetTracker.canProceed();
					if (!proceed.allowed) {
						state.budgetBlocked = true;
					}
				}

				const usage = eventData.usage as TokenUsage | undefined;
				if (usage) {
					const totalTokens = state.stats.totalInputTokens + state.stats.totalOutputTokens;
					state.stats.contextPercent = Math.min(100, (totalTokens / 200000) * 100);
				}

				break;
			}

			// ─── Sandesha: direct input request from agent ────────────────
			case "agent:input_request": {
				const request = eventData as unknown as InputRequest;
				state.spinner.stop();
				printInputRequest(stdout, request);
				state.pendingInputRequests.push(request);
				break;
			}

			// ─── Sandesha: unwrap nested subagent events for input requests ─
			case "subagent:event": {
				const inputReq = unwrapInputRequest(event, data);
				if (inputReq) {
					state.spinner.stop();
					printInputRequest(stdout, inputReq);
					state.pendingInputRequests.push(inputReq);
				}
				break;
			}
		}
	};
}
