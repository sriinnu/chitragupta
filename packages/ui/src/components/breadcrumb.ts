/**
 * @chitragupta/ui — Navigation breadcrumb component.
 *
 * Renders a breadcrumb trail for navigation context with
 * selection support and truncation for long paths.
 */

import { bold, dim, reset, stripAnsi, visibleLength } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
	label: string;
	value?: string;
}

type NavigateHandler = (item: BreadcrumbItem, index: number) => void;

// ─── Breadcrumb ─────────────────────────────────────────────────────────────

export class Breadcrumb {
	private items: BreadcrumbItem[] = [];
	private selectedIndex: number;
	private theme: Theme;
	private separator: string;
	private navigateHandlers: NavigateHandler[] = [];
	private interactive: boolean;

	constructor(opts?: {
		items?: BreadcrumbItem[];
		theme?: Theme;
		separator?: string;
		interactive?: boolean;
	}) {
		this.items = opts?.items ?? [];
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.separator = opts?.separator ?? " \u203A ";
		this.interactive = opts?.interactive ?? true;
		this.selectedIndex = Math.max(0, this.items.length - 1);
	}

	/** Set the breadcrumb items */
	setItems(items: BreadcrumbItem[]): void {
		this.items = items;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, items.length - 1));
	}

	/** Push a new item onto the breadcrumb */
	push(item: BreadcrumbItem): void {
		this.items.push(item);
		this.selectedIndex = this.items.length - 1;
	}

	/** Pop the last item from the breadcrumb */
	pop(): BreadcrumbItem | undefined {
		const item = this.items.pop();
		this.selectedIndex = Math.max(0, this.items.length - 1);
		return item;
	}

	/** Get the currently selected item */
	get selected(): BreadcrumbItem | undefined {
		return this.items[this.selectedIndex];
	}

	/** Get all items */
	get path(): BreadcrumbItem[] {
		return [...this.items];
	}

	/** Register a navigation handler */
	onNavigate(handler: NavigateHandler): void {
		this.navigateHandlers.push(handler);
	}

	/** Process a key event */
	handleKey(key: KeyEvent): void {
		if (!this.interactive) return;

		if (key.name === "left" && !key.ctrl && !key.meta) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
			}
			return;
		}

		if (key.name === "right" && !key.ctrl && !key.meta) {
			if (this.selectedIndex < this.items.length - 1) {
				this.selectedIndex++;
			}
			return;
		}

		if (key.name === "return" && !key.ctrl && !key.meta) {
			const item = this.items[this.selectedIndex];
			if (item) {
				for (const handler of this.navigateHandlers) {
					handler(item, this.selectedIndex);
				}
			}
			return;
		}

		if (key.name === "home") {
			this.selectedIndex = 0;
			return;
		}

		if (key.name === "end") {
			this.selectedIndex = Math.max(0, this.items.length - 1);
			return;
		}
	}

	/** Render the breadcrumb as a single line */
	render(width: number): string {
		if (this.items.length === 0) {
			return "";
		}

		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const sep = `${mutedColor}${this.separator}${reset}`;
		const sepVisible = stripAnsi(this.separator).length;

		// First attempt: render all items
		const renderedItems = this.items.map((item, idx) => {
			const isSelected = this.interactive && idx === this.selectedIndex;
			const isLast = idx === this.items.length - 1;

			if (isSelected) {
				return `${primaryColor}${bold(item.label)}${reset}`;
			}
			if (isLast) {
				return item.label;
			}
			return `${mutedColor}${item.label}${reset}`;
		});

		const fullText = renderedItems.join(sep);
		const fullVisLen = this.items.reduce((sum, item) => sum + item.label.length, 0)
			+ (this.items.length - 1) * sepVisible;

		if (fullVisLen <= width) {
			return fullText;
		}

		// Truncation: show ellipsis for early items
		if (this.items.length <= 2) {
			// Just truncate labels
			return this.renderTruncated(width, sep, sepVisible);
		}

		// Keep first and last items, truncate middle
		const firstItem = this.items[0];
		const lastItem = this.items[this.items.length - 1];
		const ellipsis = `${mutedColor}\u2026${reset}`;

		const firstLabel = this.formatItem(firstItem, 0);
		const lastLabel = this.formatItem(lastItem, this.items.length - 1);

		const firstLen = firstItem.label.length;
		const lastLen = lastItem.label.length;
		const overhead = firstLen + lastLen + sepVisible * 2 + 1; // 1 for ellipsis

		if (overhead >= width) {
			// Even with truncation, doesn't fit — show last item only with ellipsis
			const maxLen = width - 2; // 2 for "..."
			const label = lastItem.label;
			const truncatedLabel = label.length > maxLen ? label.slice(0, maxLen - 1) + "\u2026" : label;
			const isSelected = this.interactive && this.items.length - 1 === this.selectedIndex;
			return `${ellipsis}${sep}${isSelected ? `${primaryColor}${bold(truncatedLabel)}${reset}` : truncatedLabel}`;
		}

		// Fit middle items that are visible near the selected index
		const middleWidth = width - overhead;
		const middleItems: string[] = [];
		let middleLen = 0;

		// Prioritize items near the selected index
		const middleIndices: number[] = [];
		for (let i = 1; i < this.items.length - 1; i++) {
			middleIndices.push(i);
		}
		middleIndices.sort((a, b) => Math.abs(a - this.selectedIndex) - Math.abs(b - this.selectedIndex));

		const includedMiddle = new Set<number>();
		for (const idx of middleIndices) {
			const itemLen = this.items[idx].label.length + sepVisible;
			if (middleLen + itemLen <= middleWidth) {
				includedMiddle.add(idx);
				middleLen += itemLen;
			}
		}

		// Build middle in order
		let hasEllipsis = false;
		for (let i = 1; i < this.items.length - 1; i++) {
			if (includedMiddle.has(i)) {
				middleItems.push(this.formatItem(this.items[i], i));
			} else if (!hasEllipsis) {
				middleItems.push(ellipsis);
				hasEllipsis = true;
			}
		}

		const parts = [firstLabel, ...middleItems, lastLabel];
		return parts.join(sep);
	}

	/** Render as lines (for multi-line display) */
	renderLines(width: number): string[] {
		return [this.render(width)];
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private formatItem(item: BreadcrumbItem, index: number): string {
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const isSelected = this.interactive && index === this.selectedIndex;
		const isLast = index === this.items.length - 1;

		if (isSelected) {
			return `${primaryColor}${bold(item.label)}${reset}`;
		}
		if (isLast) {
			return item.label;
		}
		return `${mutedColor}${item.label}${reset}`;
	}

	private renderTruncated(width: number, sep: string, sepVisible: number): string {
		const parts: string[] = [];
		let totalLen = 0;

		for (let i = this.items.length - 1; i >= 0; i--) {
			const item = this.items[i];
			const addedLen = item.label.length + (i < this.items.length - 1 ? sepVisible : 0);

			if (totalLen + addedLen > width && parts.length > 0) {
				// Add ellipsis for remaining
				parts.unshift(`${hexToAnsi(this.theme.colors.muted)}\u2026${reset}`);
				break;
			}

			parts.unshift(this.formatItem(item, i));
			totalLen += addedLen;
		}

		return parts.join(sep);
	}
}
