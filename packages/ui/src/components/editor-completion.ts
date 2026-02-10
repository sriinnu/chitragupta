/**
 * @chitragupta/ui — Editor tab completion support.
 *
 * Extracted from editor.ts to keep file sizes manageable.
 * Provides completion provider registration, triggering, cycling,
 * accepting, dismissing, and rendering the completion menu overlay.
 */

import { dim, reset } from "../ansi.js";
import type { Theme } from "../theme.js";
import { hexToAnsi } from "../theme.js";
import type { CompletionItem, CompletionProvider, Position } from "./editor.js";

// ─── Completion State ───────────────────────────────────────────────────────

/**
 * Manages tab-completion state: providers, items, selection index, and
 * active/inactive status.
 */
export class CompletionManager {
	private providers: CompletionProvider[] = [];
	private items: CompletionItem[] = [];
	private index = -1;
	private active = false;

	/** Register a completion provider */
	registerProvider(provider: CompletionProvider): void {
		this.providers.push(provider);
	}

	/** Remove a completion provider */
	unregisterProvider(provider: CompletionProvider): void {
		const idx = this.providers.indexOf(provider);
		if (idx !== -1) {
			this.providers.splice(idx, 1);
		}
	}

	/** Whether the completion menu is currently shown */
	get isActive(): boolean {
		return this.active;
	}

	/** Currently visible completion items */
	get currentItems(): CompletionItem[] {
		return this.active ? [...this.items] : [];
	}

	/** Current selection index */
	get selectedIndex(): number {
		return this.index;
	}

	/** Cycle forward through completions */
	cycleForward(): void {
		if (!this.active || this.items.length === 0) return;
		this.index = (this.index + 1) % this.items.length;
	}

	/** Cycle backward through completions */
	cycleBackward(): void {
		if (!this.active || this.items.length === 0) return;
		this.index = this.index <= 0
			? this.items.length - 1
			: this.index - 1;
	}

	/**
	 * Trigger completion from all providers.
	 * @returns true if completions were found, false if none (caller should insert tab)
	 */
	trigger(text: string, cursor: Position): boolean {
		const collected: CompletionItem[] = [];
		for (const provider of this.providers) {
			const result = provider.provide(text, { ...cursor });
			collected.push(...result);
		}

		if (collected.length === 0) {
			return false;
		}

		this.items = collected;
		this.index = 0;
		this.active = true;
		return true;
	}

	/**
	 * Accept the currently selected completion.
	 * @returns The selected item, or null if nothing to accept.
	 */
	accept(): CompletionItem | null {
		if (!this.active || this.index < 0) return null;
		const item = this.items[this.index] ?? null;
		this.dismiss();
		return item;
	}

	/** Dismiss the completion menu */
	dismiss(): void {
		this.active = false;
		this.items = [];
		this.index = -1;
	}
}

// ─── Completion Menu Rendering ──────────────────────────────────────────────

/**
 * Render the completion menu into the output lines array.
 *
 * @param output - The mutable output array to append lines to.
 * @param items - The completion items to render.
 * @param selectedIndex - The currently selected index.
 * @param theme - The active theme.
 */
export function renderCompletionMenu(
	output: string[],
	items: CompletionItem[],
	selectedIndex: number,
	theme: Theme,
): void {
	const maxVisible = 8;
	const start = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
	const end = Math.min(items.length, start + maxVisible);
	const mutedColor = hexToAnsi(theme.colors.muted);
	const primaryColor = hexToAnsi(theme.colors.primary);

	output.push(dim("  \u250C\u2500 completions \u2500\u2510"));
	for (let i = start; i < end; i++) {
		const item = items[i];
		const isSelected = i === selectedIndex;
		const prefix = isSelected ? `${primaryColor}\u276F` : " ";
		const label = isSelected ? `\x1b[1m${item.label}\x1b[22m` : item.label;
		const desc = item.description ? ` ${mutedColor}${item.description}${reset}` : "";
		output.push(`  ${dim("\u2502")} ${prefix} ${label}${desc}${reset} ${dim("\u2502")}`);
	}
	output.push(dim("  \u2514\u2500 Tab: cycle | Enter: accept | Esc: dismiss \u2500\u2518"));
}

/**
 * Apply a completion item by replacing the word at cursor.
 *
 * @returns The new cursor column position after insertion.
 */
export function applyCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: CompletionItem,
): { newLine: string; newCol: number } {
	const line = lines[cursorLine] ?? "";
	let wordStart = cursorCol;
	while (wordStart > 0 && /\S/.test(line[wordStart - 1])) {
		wordStart--;
	}

	const newLine = line.slice(0, wordStart) + item.insertText + line.slice(cursorCol);
	const newCol = wordStart + item.insertText.length;
	return { newLine, newCol };
}
