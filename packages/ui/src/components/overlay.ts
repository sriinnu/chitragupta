/**
 * @chitragupta/ui -- Stack-based overlay system for modal UI components.
 *
 * Manages a stack of OverlayPanel instances that render on top of the main TUI.
 * Includes concrete implementations: SelectListOverlay (model selector, session
 * picker, etc.) and HelpOverlay (scrollable help content).
 */

import { bold, dim, reset, stripAnsi, visibleLength } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Legacy Component Interface (preserved for backward compatibility) ────

export interface Component {
	render(width: number, height: number): string[];
	handleKey?(key: KeyEvent): void;
}

// ─── OverlayPanel Interface ──────────────────────────────────────────────

/**
 * A single overlay panel that can be pushed onto the overlay stack.
 * Each panel owns its own render and key handling logic.
 */
export interface OverlayPanel {
	/** Unique identifier for this overlay instance */
	id: string;
	/** Display title rendered in the top border */
	title: string;
	/** Render the panel content as an array of lines */
	render(width: number, height: number): string[];
	/**
	 * Handle a key event.
	 * @returns "close" to pop this overlay, "handled" if consumed, "pass" to let
	 *          the overlay stack try the next panel or fall through.
	 */
	handleKey(key: KeyEvent): "close" | "handled" | "pass";
}

// ─── Overlay (Stack Manager) ─────────────────────────────────────────────

/**
 * Stack-based overlay manager. Overlays are rendered in LIFO order --
 * only the topmost panel is visible and receives key events.
 */
export class Overlay {
	private stack: OverlayPanel[] = [];
	private theme: Theme;

	constructor(opts?: { theme?: Theme }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
	}

	/** Push an overlay panel onto the stack */
	push(overlay: OverlayPanel): void {
		this.stack.push(overlay);
	}

	/** Pop the topmost overlay panel and return it */
	pop(): OverlayPanel | undefined {
		return this.stack.pop();
	}

	/** Whether any overlay is currently visible */
	isActive(): boolean {
		return this.stack.length > 0;
	}

	/** Number of overlays on the stack */
	get depth(): number {
		return this.stack.length;
	}

	/** The topmost overlay panel, or undefined if the stack is empty */
	get top(): OverlayPanel | undefined {
		return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
	}

	/**
	 * Render the topmost overlay as lines within a bordered frame.
	 * Returns an empty array if no overlay is active.
	 */
	render(width: number, height: number): string[] {
		if (this.stack.length === 0) return [];

		const panel = this.stack[this.stack.length - 1];
		return this.renderPanel(panel, width, height);
	}

	/**
	 * Route a key event to the topmost overlay.
	 * @returns true if the key was consumed (either handled or caused a close).
	 */
	handleKey(key: KeyEvent): boolean {
		if (this.stack.length === 0) return false;

		const panel = this.stack[this.stack.length - 1];
		const result = panel.handleKey(key);

		if (result === "close") {
			this.stack.pop();
			return true;
		}

		return result === "handled";
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private renderPanel(panel: OverlayPanel, screenWidth: number, screenHeight: number): string[] {
		const borderColor = hexToAnsi(this.theme.colors.border);
		const titleColor = hexToAnsi(this.theme.colors.primary);

		// Overlay dimensions: 80% of screen, clamped
		const overlayWidth = Math.min(
			Math.max(Math.floor(screenWidth * 0.8), 40),
			Math.min(screenWidth - 4, 100),
		);
		const overlayHeight = Math.min(
			Math.max(Math.floor(screenHeight * 0.7), 10),
			screenHeight - 4,
		);
		const innerWidth = overlayWidth - 4; // 2 border chars + 2 padding spaces
		const innerHeight = overlayHeight - 4; // 2 border rows + title row + footer row

		// Get content from the panel
		const content = panel.render(innerWidth, innerHeight);

		// Only show the lines that fit
		const visibleContent = content.slice(0, innerHeight);

		const output: string[] = [];

		// Centering
		const leftPad = Math.max(0, Math.floor((screenWidth - overlayWidth) / 2));
		const topPad = Math.max(0, Math.floor((screenHeight - overlayHeight) / 2));
		const pad = " ".repeat(leftPad);

		// Top padding
		for (let i = 0; i < topPad; i++) {
			output.push("");
		}

		// Top border with title
		const titleText = panel.title ? ` ${panel.title} ` : "";
		const titleVisLen = stripAnsi(titleText).length;
		const topBorderLen = Math.max(0, overlayWidth - 2 - titleVisLen);
		const topLeft = Math.floor(topBorderLen / 2);
		const topRight = topBorderLen - topLeft;
		output.push(
			`${pad}${borderColor}\u250C${"\u2500".repeat(topLeft)}${reset}${titleColor}${bold(titleText)}${reset}${borderColor}${"\u2500".repeat(topRight)}\u2510${reset}`,
		);

		// Empty line after title
		output.push(
			`${pad}${borderColor}\u2502${reset}${" ".repeat(overlayWidth - 2)}${borderColor}\u2502${reset}`,
		);

		// Content lines
		for (let i = 0; i < innerHeight; i++) {
			const line = i < visibleContent.length ? visibleContent[i] : "";
			const lineVisLen = visibleLength(line);
			const rightPadding = Math.max(0, innerWidth - lineVisLen);
			output.push(
				`${pad}${borderColor}\u2502${reset} ${line}${" ".repeat(rightPadding)} ${borderColor}\u2502${reset}`,
			);
		}

		// Empty line before footer
		output.push(
			`${pad}${borderColor}\u2502${reset}${" ".repeat(overlayWidth - 2)}${borderColor}\u2502${reset}`,
		);

		// Bottom border with Esc hint
		const escHint = dim(" Esc to close ");
		const escHintVisLen = visibleLength(escHint);
		const bottomBorderLen = Math.max(0, overlayWidth - 2 - escHintVisLen);
		const bottomLeft = Math.floor(bottomBorderLen / 2);
		const bottomRight = bottomBorderLen - bottomLeft;
		output.push(
			`${pad}${borderColor}\u2514${"\u2500".repeat(bottomLeft)}${reset}${escHint}${borderColor}${"\u2500".repeat(bottomRight)}\u2518${reset}`,
		);

		return output;
	}
}

// ─── SelectListOverlay ───────────────────────────────────────────────────

export interface SelectListItem {
	label: string;
	value: string;
	description?: string;
}

/**
 * A select-list overlay for picking from a set of labeled items.
 * Arrow keys to navigate, Enter to select, Escape to close.
 */
export class SelectListOverlay implements OverlayPanel {
	readonly id: string;
	readonly title: string;
	private items: SelectListItem[];
	private onSelect: (value: string) => void;
	private selectedIndex = 0;
	private scrollOffset = 0;

	constructor(
		id: string,
		title: string,
		items: SelectListItem[],
		onSelect: (value: string) => void,
	) {
		this.id = id;
		this.title = title;
		this.items = items;
		this.onSelect = onSelect;
	}

	/** Currently highlighted index */
	get currentIndex(): number {
		return this.selectedIndex;
	}

	render(width: number, height: number): string[] {
		const output: string[] = [];

		if (this.items.length === 0) {
			output.push(dim("  No items"));
			return output;
		}

		// Adjust scroll so selected is always visible
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + height) {
			this.scrollOffset = this.selectedIndex - height + 1;
		}

		const visibleEnd = Math.min(this.scrollOffset + height, this.items.length);

		for (let i = this.scrollOffset; i < visibleEnd; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;
			const maxLabelWidth = width - 6;

			let label = item.label;
			if (stripAnsi(label).length > maxLabelWidth) {
				label = label.slice(0, maxLabelWidth - 1) + "\u2026";
			}

			if (isSelected) {
				let line = ` \u276F ${bold(label)}`;
				if (item.description) {
					line += ` ${dim(item.description)}`;
				}
				output.push(line);
			} else {
				let line = `   ${label}`;
				if (item.description) {
					line += ` ${dim(item.description)}`;
				}
				output.push(line);
			}
		}

		// Scroll indicators
		if (this.scrollOffset > 0) {
			output.unshift(dim(`  \u2191 ${this.scrollOffset} more above`));
		}
		const remaining = this.items.length - visibleEnd;
		if (remaining > 0) {
			output.push(dim(`  \u2193 ${remaining} more below`));
		}

		return output;
	}

	handleKey(key: KeyEvent): "close" | "handled" | "pass" {
		if (key.name === "escape") return "close";

		if (key.name === "up" && !key.ctrl && !key.meta) {
			this.selectedIndex = this.selectedIndex > 0
				? this.selectedIndex - 1
				: this.items.length - 1;
			return "handled";
		}

		if (key.name === "down" && !key.ctrl && !key.meta) {
			this.selectedIndex = this.selectedIndex < this.items.length - 1
				? this.selectedIndex + 1
				: 0;
			return "handled";
		}

		if (key.name === "return" && !key.ctrl && !key.meta && !key.shift) {
			const item = this.items[this.selectedIndex];
			if (item) {
				this.onSelect(item.value);
			}
			return "close";
		}

		return "pass";
	}
}

// ─── HelpOverlay ─────────────────────────────────────────────────────────

/**
 * A scrollable help panel that displays multi-line text content.
 * Up/Down/PageUp/PageDown to scroll, Escape to close.
 */
export class HelpOverlay implements OverlayPanel {
	readonly id = "help";
	readonly title = "Help";
	private contentLines: string[];
	private scrollOffset = 0;

	constructor(content: string) {
		this.contentLines = content.split("\n");
	}

	render(width: number, height: number): string[] {
		// Wrap lines that exceed the available width
		const wrapped = this.wrapLines(this.contentLines, width);

		// Clamp scroll offset
		const maxScroll = Math.max(0, wrapped.length - height);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);

		const visible = wrapped.slice(this.scrollOffset, this.scrollOffset + height);

		// Pad to full height so the box doesn't shrink
		const output = [...visible];
		while (output.length < height) {
			output.push("");
		}

		return output;
	}

	handleKey(key: KeyEvent): "close" | "handled" | "pass" {
		if (key.name === "escape") return "close";

		if (key.name === "up") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			return "handled";
		}

		if (key.name === "down") {
			this.scrollOffset += 1;
			return "handled";
		}

		if (key.name === "pageup") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 10);
			return "handled";
		}

		if (key.name === "pagedown") {
			this.scrollOffset += 10;
			return "handled";
		}

		return "pass";
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private wrapLines(lines: string[], maxWidth: number): string[] {
		if (maxWidth <= 0) return lines;
		const result: string[] = [];
		for (const line of lines) {
			if (visibleLength(line) <= maxWidth) {
				result.push(line);
			} else {
				// Simple char-level wrap preserving ANSI
				let pos = 0;
				const stripped = stripAnsi(line);
				while (pos < stripped.length) {
					result.push(stripped.slice(pos, pos + maxWidth));
					pos += maxWidth;
				}
			}
		}
		return result;
	}
}
