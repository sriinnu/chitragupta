/**
 * @chitragupta/cli -- Multi-turn agent loop engine.
 *
 * Extracted from run.ts to keep both files under 450 LOC.
 * Handles streaming a single turn, detecting stop conditions,
 * and integrating with SteeringManager for multi-turn flow.
 */

import type { StreamChunk } from "../api-instance.js";
import type { SteeringInstruction } from "@chitragupta/anina";

import {
	bold,
	dim,
	cyan,
	yellow,
} from "@chitragupta/ui/ansi";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of streaming a single turn. */
export interface TurnResult {
	/** Accumulated text output from the assistant. */
	text: string;
	/** Whether the response ended due to a tool call. */
	hasToolCalls: boolean;
	/** Cost incurred for this turn (USD). */
	cost: number;
	/** Whether the stream was aborted. */
	aborted: boolean;
}

/** Stop reason from the done chunk. */
interface DoneData {
	stopReason?: string;
	cost?: { total?: number };
}

/** Tool start data from stream. */
interface ToolStartData {
	name: string;
}

/** Usage data from stream. */
interface UsageData {
	cost?: { total?: number };
}

// ─── Single Turn Streamer ───────────────────────────────────────────────────

/**
 * Stream a single turn from the Chitragupta instance.
 *
 * Processes all chunks, accumulates text, detects tool calls,
 * and renders output to stdout. Returns a structured TurnResult.
 *
 * @param streamIterable - The async iterable from `instance.stream()`.
 * @param signal - AbortSignal for graceful shutdown.
 * @returns Turn result with text, cost, and tool call detection.
 */
export async function streamSingleTurn(
	streamIterable: AsyncIterable<StreamChunk>,
	signal: AbortSignal,
): Promise<TurnResult> {
	let currentText = "";
	let turnCost = 0;
	let hasToolCalls = false;
	let aborted = false;

	for await (const chunk of streamIterable) {
		if (signal.aborted) {
			aborted = true;
			break;
		}

		switch (chunk.type) {
			case "text": {
				const text = chunk.data as string;
				currentText += text;
				process.stdout.write(text);
				break;
			}
			case "tool_start": {
				const toolData = chunk.data as ToolStartData;
				hasToolCalls = true;
				process.stdout.write(
					"\n" + dim(`  [tool: ${toolData.name}]`) + "\n",
				);
				break;
			}
			case "usage": {
				const usage = chunk.data as UsageData;
				if (usage.cost?.total) {
					turnCost += usage.cost.total;
				}
				break;
			}
			case "done": {
				const done = chunk.data as DoneData;
				if (done.cost?.total) {
					turnCost += done.cost.total;
				}
				break;
			}
			default:
				// tool_done, tool_error, thinking — pass through
				break;
		}
	}

	return { text: currentText, hasToolCalls, cost: turnCost, aborted };
}

// ─── Turn Display ───────────────────────────────────────────────────────────

/**
 * Render the turn header showing progress.
 *
 * @param turn - Current turn number (1-based).
 * @param maxTurns - Maximum allowed turns.
 */
export function renderTurnHeader(turn: number, maxTurns: number): void {
	process.stdout.write(
		"\n" + bold(cyan(`  [Turn ${turn}/${maxTurns}]`)) + "\n\n",
	);
}

/**
 * Render a steering injection notice.
 *
 * @param instruction - The steering instruction being injected.
 */
export function renderSteeringNotice(
	instruction: SteeringInstruction,
): void {
	const label = instruction.priority === "interrupt"
		? yellow("INTERRUPT")
		: dim("follow-up");
	process.stdout.write(
		"\n" + dim(`  [steering: ${label}]`) + "\n",
	);
}

// ─── Turn Continuation Logic ────────────────────────────────────────────────

/**
 * Determine whether the loop should continue after a turn.
 *
 * The loop continues if:
 *   1. The turn is not aborted
 *   2. There is a steering instruction pending, OR
 *   3. There is a follow-up pending
 *
 * If none of those are true, the assistant gave a final answer.
 *
 * @param turnResult - Result of the completed turn.
 * @param steeringNext - Next steering instruction (or null).
 * @returns True if the loop should continue with another turn.
 */
export function shouldContinue(
	turnResult: TurnResult,
	steeringNext: SteeringInstruction | null,
): boolean {
	if (turnResult.aborted) return false;
	if (steeringNext !== null) return true;
	return false;
}

/**
 * Build the next user message for the loop.
 *
 * Steering instructions are formatted with their priority label.
 * Returns the message string to send as the next user turn.
 *
 * @param instruction - The steering instruction to convert.
 * @returns Formatted user message string.
 */
export function buildNextMessage(
	instruction: SteeringInstruction,
): string {
	if (instruction.priority === "interrupt") {
		return `[STEERING INTERRUPT] ${instruction.message}`;
	}
	return instruction.message;
}
