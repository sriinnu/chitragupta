/**
 * @chitragupta/ui — Scrollable select list component.
 *
 * Provides a keyboard-navigable list with search/filter capability,
 * arrow-key selection, and scrolling for long lists.
 */

import { bold, dim, gray, reset, stripAnsi } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SelectItem<T> {
	label: string;
	value: T;
	description?: string;
}

type SelectHandler<T> = (item: SelectItem<T>) => void;
type CancelHandler = () => void;

// ─── SelectList ─────────────────────────────────────────────────────────────

export class SelectList<T> {
	items: SelectItem<T>[];
	selectedIndex = 0;
	private scrollOffset = 0;
	private filter = "";
	private filteredItems: SelectItem<T>[];
	private selectHandlers: SelectHandler<T>[] = [];
	private cancelHandlers: CancelHandler[] = [];
	private theme: Theme;
	private title: string;

	constructor(items: SelectItem<T>[], opts?: { theme?: Theme; title?: string }) {
		this.items = items;
		this.filteredItems = [...items];
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.title = opts?.title ?? "";
	}

	/** Currently selected item (from filtered list) */
	get selected(): SelectItem<T> | undefined {
		return this.filteredItems[this.selectedIndex];
	}

	/** Current filter/search string */
	get searchQuery(): string {
		return this.filter;
	}

	/** Register a selection handler */
	onSelect(handler: SelectHandler<T>): void {
		this.selectHandlers.push(handler);
	}

	/** Register a cancel handler */
	onCancel(handler: CancelHandler): void {
		this.cancelHandlers.push(handler);
	}

	/** Process a key event */
	handleKey(key: KeyEvent): void {
		// Navigation
		if (key.name === "up" && !key.ctrl && !key.meta) {
			this.moveUp();
			return;
		}

		if (key.name === "down" && !key.ctrl && !key.meta) {
			this.moveDown();
			return;
		}

		// Page navigation
		if (key.name === "pageup") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 10);
			this.adjustScroll(10);
			return;
		}

		if (key.name === "pagedown") {
			this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + 10);
			this.adjustScroll(10);
			return;
		}

		// Home / End
		if (key.name === "home") {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			return;
		}

		if (key.name === "end") {
			this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
			return;
		}

		// Select
		if (key.name === "return" && !key.ctrl && !key.meta) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				for (const handler of this.selectHandlers) {
					handler(item);
				}
			}
			return;
		}

		// Cancel
		if (key.name === "escape" || (key.name === "c" && key.ctrl)) {
			for (const handler of this.cancelHandlers) {
				handler();
			}
			return;
		}

		// Tab to clear filter
		if (key.name === "tab") {
			this.filter = "";
			this.applyFilter();
			return;
		}

		// Backspace in filter
		if (key.name === "backspace") {
			if (this.filter.length > 0) {
				this.filter = this.filter.slice(0, -1);
				this.applyFilter();
			}
			return;
		}

		// Type to search/filter
		if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32) {
			this.filter += key.sequence;
			this.applyFilter();
		}
	}

	/** Render the select list */
	render(width: number, maxHeight: number): string[] {
		const output: string[] = [];
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const infoColor = hexToAnsi(this.theme.colors.info);

		// Title
		if (this.title) {
			output.push(bold(this.title));
		}

		// Search filter display
		if (this.filter) {
			output.push(`${infoColor}Search:${reset} ${this.filter}${dim("_")}`);
			output.push("");
		}

		const headerLines = output.length;
		const availableHeight = maxHeight - headerLines - 1; // -1 for footer

		if (this.filteredItems.length === 0) {
			output.push(dim("  No matching items"));
			return output;
		}

		// Adjust scroll offset
		this.adjustScroll(availableHeight);

		// Render visible items
		const visibleEnd = Math.min(this.scrollOffset + availableHeight, this.filteredItems.length);

		// Scroll indicator (top)
		if (this.scrollOffset > 0) {
			output.push(dim(`  ${this.theme.symbols.branchLine} ${this.scrollOffset} more above...`));
		}

		for (let i = this.scrollOffset; i < visibleEnd; i++) {
			const item = this.filteredItems[i];
			const isSelected = i === this.selectedIndex;
			const maxLabelWidth = width - 6;

			let label = item.label;
			if (stripAnsi(label).length > maxLabelWidth) {
				label = label.slice(0, maxLabelWidth - 1) + "\u2026";
			}

			if (isSelected) {
				const pointer = `${primaryColor}\u276F${reset}`;
				let line = ` ${pointer} ${bold(label)}`;
				if (item.description) {
					line += ` ${dim(item.description)}`;
				}
				output.push(line);
			} else {
				let line = `   ${label}`;
				if (item.description) {
					line += ` ${mutedColor}${item.description}${reset}`;
				}
				output.push(line);
			}
		}

		// Scroll indicator (bottom)
		const remaining = this.filteredItems.length - visibleEnd;
		if (remaining > 0) {
			output.push(dim(`  ${this.theme.symbols.branchLine} ${remaining} more below...`));
		}

		// Footer with count
		const countText = this.filter
			? `${this.filteredItems.length}/${this.items.length} items`
			: `${this.items.length} items`;
		output.push(gray(`  ${countText}`));

		return output;
	}

	/** Update the items list */
	setItems(items: SelectItem<T>[]): void {
		this.items = items;
		this.applyFilter();
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private moveUp(): void {
		if (this.selectedIndex > 0) {
			this.selectedIndex--;
		} else {
			// Wrap to bottom
			this.selectedIndex = this.filteredItems.length - 1;
		}
	}

	private moveDown(): void {
		if (this.selectedIndex < this.filteredItems.length - 1) {
			this.selectedIndex++;
		} else {
			// Wrap to top
			this.selectedIndex = 0;
		}
	}

	private applyFilter(): void {
		if (this.filter === "") {
			this.filteredItems = [...this.items];
		} else {
			const query = this.filter.toLowerCase();
			this.filteredItems = this.items.filter((item) => {
				const label = item.label.toLowerCase();
				const desc = (item.description ?? "").toLowerCase();
				return label.includes(query) || desc.includes(query);
			});
		}

		// Reset selection to stay in bounds
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.scrollOffset = 0;
	}

	private adjustScroll(viewHeight: number): void {
		if (viewHeight <= 0) return;

		// Ensure selected index is visible
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + viewHeight) {
			this.scrollOffset = this.selectedIndex - viewHeight + 1;
		}

		// Clamp
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, this.filteredItems.length - viewHeight)));
	}
}
