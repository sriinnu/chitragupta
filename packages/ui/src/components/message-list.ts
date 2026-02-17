/**
 * @chitragupta/ui — Scrollable message display component.
 *
 * Renders a conversation as a scrollable list of messages with role
 * indicators, markdown formatting for assistant messages, and
 * collapsible tool call output.
 */

import { bold, dim, italic, reset, stripAnsi, visibleLength } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";
import { renderMarkdown } from "./markdown.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MessageMeta {
	agent?: string;
	model?: string;
	timestamp?: number;
	toolName?: string;
	toolOutput?: string;
	collapsed?: boolean;
}

interface Message {
	role: string;
	content: string;
	meta: MessageMeta;
	renderedLines?: string[];
	toolCollapsed: boolean;
}

// ─── MessageList ────────────────────────────────────────────────────────────

export class MessageList {
	private messages: Message[] = [];
	private scrollOffset = 0;
	private totalRenderedLines = 0;
	private theme: Theme;
	private lastWidth = 0;
	private needsRerender = true;

	constructor(opts?: { theme?: Theme }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
	}

	/** Add a message to the list */
	addMessage(role: string, content: string, meta?: MessageMeta): void {
		this.messages.push({
			role,
			content,
			meta: meta ?? {},
			toolCollapsed: true,
		});
		this.needsRerender = true;
		// Auto-scroll to bottom
		this.scrollToBottom();
	}

	/** Update the last message's content (for streaming) */
	updateLastMessage(content: string): void {
		if (this.messages.length > 0) {
			this.messages[this.messages.length - 1].content = content;
			this.messages[this.messages.length - 1].renderedLines = undefined;
			this.needsRerender = true;
		}
	}

	/** Get the total number of messages */
	get messageCount(): number {
		return this.messages.length;
	}

	/** Handle key events for scrolling and interaction */
	handleKey(key: KeyEvent): void {
		if (key.name === "pageup") {
			this.scrollUp(10);
		} else if (key.name === "pagedown") {
			this.scrollDown(10);
		} else if (key.name === "up" && key.shift) {
			this.scrollUp(3);
		} else if (key.name === "down" && key.shift) {
			this.scrollDown(3);
		} else if (key.name === "home" && key.ctrl) {
			this.scrollOffset = 0;
		} else if (key.name === "end" && key.ctrl) {
			this.scrollToBottom();
		} else if (key.name === "tab") {
			// Toggle tool output collapse on nearest tool message
			this.toggleNearestToolCollapse();
		}
	}

	/** Render visible portion of the message list */
	render(width: number, height: number): string[] {
		// Re-render message lines if needed
		if (this.needsRerender || width !== this.lastWidth) {
			this.renderAllMessages(width);
			this.lastWidth = width;
			this.needsRerender = false;
		}

		// Collect all rendered lines
		const allLines: string[] = [];
		for (const msg of this.messages) {
			if (msg.renderedLines) {
				allLines.push(...msg.renderedLines);
			}
		}

		this.totalRenderedLines = allLines.length;

		// Apply scroll offset
		const maxScroll = Math.max(0, allLines.length - height);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		this.scrollOffset = Math.max(0, this.scrollOffset);

		const visibleLines = allLines.slice(this.scrollOffset, this.scrollOffset + height);

		// Pad to fill height
		while (visibleLines.length < height) {
			visibleLines.push("");
		}

		return visibleLines;
	}

	/** Scroll to the bottom of the message list */
	scrollToBottom(): void {
		this.scrollOffset = Number.MAX_SAFE_INTEGER; // Will be clamped in render()
	}

	/** Clear all messages */
	clear(): void {
		this.messages = [];
		this.scrollOffset = 0;
		this.totalRenderedLines = 0;
		this.needsRerender = true;
	}

	// ─── Internal Rendering ─────────────────────────────────────────────

	private renderAllMessages(width: number): void {
		for (let i = 0; i < this.messages.length; i++) {
			const msg = this.messages[i];
			if (msg.renderedLines && width === this.lastWidth) continue;
			msg.renderedLines = this.renderMessage(msg, width, i);
		}
	}

	private renderMessage(msg: Message, width: number, _index: number): string[] {
		const lines: string[] = [];
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const successColor = hexToAnsi(this.theme.colors.success);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const infoColor = hexToAnsi(this.theme.colors.info);
		const warningColor = hexToAnsi(this.theme.colors.warning);

		switch (msg.role) {
			case "user": {
				// User message with prompt symbol
				const symbol = this.theme.symbols.prompt;
				const header = `${primaryColor}${bold(`${symbol} You`)}${reset}`;
				lines.push("");
				lines.push(header);

				const contentLines = msg.content.split("\n");
				for (const line of contentLines) {
					// Word wrap long lines
					const wrapped = this.wordWrap(line, width - 4);
					for (const wl of wrapped) {
						lines.push(`  ${wl}`);
					}
				}
				break;
			}

			case "assistant": {
				// Assistant message with markdown rendering
				const agentName = msg.meta.agent ?? "Chitragupta";
				const modelInfo = msg.meta.model ? dim(` (${msg.meta.model})`) : "";
				const symbol = this.theme.symbols.thinking;
				const header = `${successColor}${bold(`${symbol} ${agentName}`)}${reset}${modelInfo}`;
				lines.push("");
				lines.push(header);

				// Use markdown renderer
				const rendered = renderMarkdown(msg.content, width - 2);
				const mdLines = rendered.split("\n");
				for (const line of mdLines) {
					lines.push(`${line}`);
				}
				break;
			}

			case "tool": {
				// Tool call with collapsible output
				const toolName = msg.meta.toolName ?? "tool";
				const symbol = "\u2699"; // gear
				const header = `${infoColor}  ${symbol} ${bold(toolName)}${reset}`;
				lines.push(header);

				if (msg.meta.toolOutput) {
					if (msg.toolCollapsed) {
						const preview = msg.meta.toolOutput.split("\n")[0] ?? "";
						const truncated =
							stripAnsi(preview).length > width - 10
								? preview.slice(0, width - 13) + "..."
								: preview;
						lines.push(`${mutedColor}    ${dim("\u25B6")} ${truncated}${reset}`);
						lines.push(dim("    (Tab to expand)"));
					} else {
						lines.push(`${mutedColor}    ${dim("\u25BC")} Output:${reset}`);
						const outputLines = msg.meta.toolOutput.split("\n");
						for (const line of outputLines) {
							const wrapped = this.wordWrap(line, width - 8);
							for (const wl of wrapped) {
								lines.push(`${mutedColor}    ${wl}${reset}`);
							}
						}
						lines.push(dim("    (Tab to collapse)"));
					}
				} else {
					// Tool call with just content (input description)
					const contentLines = msg.content.split("\n");
					for (const line of contentLines) {
						const wrapped = this.wordWrap(line, width - 8);
						for (const wl of wrapped) {
							lines.push(`    ${dim(wl)}`);
						}
					}
				}
				break;
			}

			case "system": {
				// System messages in muted style
				lines.push("");
				const contentLines = msg.content.split("\n");
				for (const line of contentLines) {
					lines.push(`${mutedColor}${italic(line)}${reset}`);
				}
				break;
			}

			case "error": {
				// Error messages
				const errorColor = hexToAnsi(this.theme.colors.error);
				const symbol = this.theme.symbols.error;
				lines.push("");
				lines.push(`${errorColor}${bold(`${symbol} Error`)}${reset}`);
				const contentLines = msg.content.split("\n");
				for (const line of contentLines) {
					lines.push(`${errorColor}  ${line}${reset}`);
				}
				break;
			}

			default: {
				// Generic message
				lines.push("");
				lines.push(dim(`[${msg.role}]`));
				const contentLines = msg.content.split("\n");
				for (const line of contentLines) {
					lines.push(`  ${line}`);
				}
			}
		}

		return lines;
	}

	private scrollUp(amount: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - amount);
	}

	private scrollDown(amount: number): void {
		this.scrollOffset += amount;
		// Will be clamped in render()
	}

	private toggleNearestToolCollapse(): void {
		// Find the last tool message and toggle it
		for (let i = this.messages.length - 1; i >= 0; i--) {
			if (this.messages[i].role === "tool" && this.messages[i].meta.toolOutput) {
				this.messages[i].toolCollapsed = !this.messages[i].toolCollapsed;
				this.messages[i].renderedLines = undefined;
				this.needsRerender = true;
				break;
			}
		}
	}

	private wordWrap(text: string, maxWidth: number): string[] {
		if (maxWidth <= 0) return [text];
		const visLen = visibleLength(text);
		if (visLen <= maxWidth) return [text];

		const lines: string[] = [];
		let current = "";
		let currentLen = 0;
		const words = text.split(/(\s+)/);

		for (const word of words) {
			const wordLen = visibleLength(word);
			if (currentLen + wordLen > maxWidth && current.length > 0) {
				lines.push(current);
				current = "";
				currentLen = 0;
				if (word.trim().length === 0) continue;
			}
			current += word;
			currentLen += wordLen;
		}

		if (current.length > 0) {
			lines.push(current);
		}

		return lines.length > 0 ? lines : [""];
	}
}

