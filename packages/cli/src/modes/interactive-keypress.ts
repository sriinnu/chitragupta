/**
 * @chitragupta/cli — Interactive mode keypress handling.
 *
 * Processes raw terminal keypresses: Ctrl+C quit, Ctrl+L model info,
 * Shift+Tab thinking level toggle, Tab completion, Enter to send,
 * cursor navigation, and character input.
 * Extracted from the main interactive module to stay under 450 LOC.
 */

import type { Agent } from "@chitragupta/anina";
import type { InputRequest, ThinkingLevel } from "@chitragupta/core";
import { bold, dim } from "@chitragupta/ui/ansi";
import { parseKeypress, matchKey } from "@chitragupta/ui/keys";
import {
	THINKING_LEVELS,
	completeSlashCommand,
} from "./interactive-commands.js";
import type { ExitReason } from "./interactive-types.js";

/** Mutable keypress state shared with the main interactive loop. */
export interface KeypressState {
	inputBuffer: string;
	cursorPos: number;
	isStreaming: boolean;
	ctrlCCount: number;
	ctrlCTimer: ReturnType<typeof setTimeout> | null;
	currentThinking: ThinkingLevel;
	currentModel: string;
	pendingInputRequests: InputRequest[];
}

/** Callbacks invoked by the keypress handler. */
export interface KeypressCallbacks {
	renderPrompt(): void;
	sendMessage(message: string): void;
	cleanup(): void;
	resolveSession(reason: ExitReason): void;
	agent: Agent;
	stdout: NodeJS.WriteStream;
}

/**
 * Handle a single keypress from the terminal.
 *
 * @param data - Raw terminal input buffer.
 * @param state - Mutable keypress state.
 * @param cb - Callbacks into the main interactive loop.
 */
export function handleKeypress(
	data: Buffer,
	state: KeypressState,
	cb: KeypressCallbacks,
): void {
	const key = parseKeypress(data);
	const { stdout, agent } = cb;

	// Ctrl+C: clear or quit
	if (matchKey(key, "ctrl+c")) {
		if (state.isStreaming) {
			agent.abort();
			return;
		}

		if (state.inputBuffer.length > 0) {
			state.inputBuffer = "";
			state.cursorPos = 0;
			state.ctrlCCount = 0;
			cb.renderPrompt();
			return;
		}

		state.ctrlCCount++;
		if (state.ctrlCCount >= 2) {
			stdout.write(dim("\n\n  Goodbye.\n\n"));
			cb.cleanup();
			cb.resolveSession("quit");
			return;
		}

		stdout.write(dim("\n  Press Ctrl+C again to quit.\n"));
		cb.renderPrompt();

		if (state.ctrlCTimer) clearTimeout(state.ctrlCTimer);
		state.ctrlCTimer = setTimeout(() => {
			state.ctrlCCount = 0;
		}, 2000);

		return;
	}

	// Reset Ctrl+C counter on any other key
	state.ctrlCCount = 0;

	if (matchKey(key, "escape")) {
		if (state.isStreaming) {
			agent.abort();
		}
		return;
	}

	if (matchKey(key, "ctrl+l")) {
		stdout.write(dim(`\n  Current model: ${state.currentModel}\n`));
		stdout.write(dim("  Use /model <id> to switch.\n\n"));
		cb.renderPrompt();
		return;
	}

	if (matchKey(key, "shift+tab")) {
		const currentIdx = THINKING_LEVELS.indexOf(state.currentThinking);
		const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
		state.currentThinking = THINKING_LEVELS[nextIdx];
		agent.setThinkingLevel(state.currentThinking);

		stdout.write(dim(`  Thinking: ${bold(state.currentThinking)}\n`));
		cb.renderPrompt();
		return;
	}

	if (matchKey(key, "tab")) {
		if (state.inputBuffer.startsWith("/")) {
			const result = completeSlashCommand(state.inputBuffer, stdout, cb.renderPrompt);
			if (result) {
				state.inputBuffer = result.newBuffer;
				state.cursorPos = result.newCursorPos;
				cb.renderPrompt();
			}
		}
		return;
	}

	if (matchKey(key, "return")) {
		if (state.isStreaming) return;

		const message = state.inputBuffer.trim();
		state.inputBuffer = "";
		state.cursorPos = 0;

		// Sandesha: if there are pending input requests, resolve the oldest one
		if (message && state.pendingInputRequests.length > 0) {
			const pendingReq = state.pendingInputRequests.shift()!;
			stdout.write("\n");
			stdout.write(dim(`  [responding to ${pendingReq.agentId.slice(0, 8)}] `) + message + "\n");

			const targetAgent = agent.findAgent(pendingReq.agentId);
			if (targetAgent) {
				targetAgent.resolveInput(pendingReq.requestId, message);
			} else {
				agent.resolveInput(pendingReq.requestId, message);
			}

			if (state.pendingInputRequests.length > 0) {
				stdout.write(dim(`  [${state.pendingInputRequests.length} more pending input request(s)]\n`));
			}

			cb.renderPrompt();
			return;
		}

		if (message) {
			stdout.write("\n");
			cb.sendMessage(message);
		} else {
			cb.renderPrompt();
		}
		return;
	}

	if (matchKey(key, "backspace")) {
		if (state.cursorPos > 0) {
			state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos - 1) + state.inputBuffer.slice(state.cursorPos);
			state.cursorPos--;
			cb.renderPrompt();
		}
		return;
	}

	if (key.name === "delete") {
		if (state.cursorPos < state.inputBuffer.length) {
			state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + state.inputBuffer.slice(state.cursorPos + 1);
			cb.renderPrompt();
		}
		return;
	}

	if (key.name === "left") {
		if (state.cursorPos > 0) state.cursorPos--;
		return;
	}
	if (key.name === "right") {
		if (state.cursorPos < state.inputBuffer.length) state.cursorPos++;
		return;
	}
	if (key.name === "home") {
		state.cursorPos = 0;
		return;
	}
	if (key.name === "end") {
		state.cursorPos = state.inputBuffer.length;
		return;
	}

	if (matchKey(key, "ctrl+a")) {
		state.cursorPos = 0;
		return;
	}

	if (matchKey(key, "ctrl+e")) {
		state.cursorPos = state.inputBuffer.length;
		return;
	}

	if (matchKey(key, "ctrl+u")) {
		state.inputBuffer = "";
		state.cursorPos = 0;
		cb.renderPrompt();
		return;
	}

	if (matchKey(key, "ctrl+w")) {
		if (state.cursorPos > 0) {
			const before = state.inputBuffer.slice(0, state.cursorPos);
			const after = state.inputBuffer.slice(state.cursorPos);
			const trimmed = before.replace(/\S+\s*$/, "");
			state.inputBuffer = trimmed + after;
			state.cursorPos = trimmed.length;
			cb.renderPrompt();
		}
		return;
	}

	if (key.sequence && !key.ctrl && !key.meta && key.sequence.length > 0 && key.name !== "unknown") {
		const ch = key.sequence;
		const code = ch.charCodeAt(0);
		if (code >= 32 || code >= 128) {
			state.inputBuffer = state.inputBuffer.slice(0, state.cursorPos) + ch + state.inputBuffer.slice(state.cursorPos);
			state.cursorPos += ch.length;
			cb.renderPrompt();
		}
	}
}
