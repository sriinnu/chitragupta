/**
 * @chitragupta/ui — Session tree visualization component.
 *
 * Displays session branching trees with collapsible branches,
 * arrow key navigation, status indicators, and truncation support.
 */

import { bold, dim, gray, reset, stripAnsi, visibleLength } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionTreeNode {
	id: string;
	title: string;
	date?: string;
	turnCount?: number;
	active?: boolean;
	children?: SessionTreeNode[];
}

interface FlatNode {
	node: SessionTreeNode;
	depth: number;
	isLast: boolean;
	prefixParts: Array<"pipe" | "space">;
	collapsed: boolean;
	hasChildren: boolean;
}

type SelectHandler = (node: SessionTreeNode) => void;

// ─── SessionTree ────────────────────────────────────────────────────────────

export class SessionTree {
	private root: SessionTreeNode[];
	private flatNodes: FlatNode[] = [];
	private collapsedIds: Set<string> = new Set();
	private selectedIndex = 0;
	private scrollOffset = 0;
	private theme: Theme;
	private title: string;
	private selectHandlers: SelectHandler[] = [];

	constructor(nodes: SessionTreeNode[], opts?: { theme?: Theme; title?: string }) {
		this.root = nodes;
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.title = opts?.title ?? "Session Tree";
		this.rebuildFlat();
	}

	/** Get the currently selected node */
	get selected(): SessionTreeNode | undefined {
		return this.flatNodes[this.selectedIndex]?.node;
	}

	/** Register a selection handler (called on Enter) */
	onSelect(handler: SelectHandler): void {
		this.selectHandlers.push(handler);
	}

	/** Update the tree data */
	setNodes(nodes: SessionTreeNode[]): void {
		this.root = nodes;
		this.rebuildFlat();
	}

	/** Process a key event */
	handleKey(key: KeyEvent): void {
		if (key.name === "up" && !key.ctrl && !key.meta) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
			}
			return;
		}

		if (key.name === "down" && !key.ctrl && !key.meta) {
			if (this.selectedIndex < this.flatNodes.length - 1) {
				this.selectedIndex++;
			}
			return;
		}

		// Toggle collapse on Enter
		if (key.name === "return" && !key.ctrl && !key.meta) {
			const flat = this.flatNodes[this.selectedIndex];
			if (!flat) return;

			if (flat.hasChildren) {
				// Toggle collapse
				if (this.collapsedIds.has(flat.node.id)) {
					this.collapsedIds.delete(flat.node.id);
				} else {
					this.collapsedIds.add(flat.node.id);
				}
				this.rebuildFlat();
			} else {
				// Select leaf node
				for (const handler of this.selectHandlers) {
					handler(flat.node);
				}
			}
			return;
		}

		// Space to select without toggling
		if (key.name === " " || key.sequence === " ") {
			const flat = this.flatNodes[this.selectedIndex];
			if (flat) {
				for (const handler of this.selectHandlers) {
					handler(flat.node);
				}
			}
			return;
		}

		// Left arrow to collapse current node or move to parent
		if (key.name === "left" && !key.ctrl && !key.meta) {
			const flat = this.flatNodes[this.selectedIndex];
			if (!flat) return;

			if (flat.hasChildren && !this.collapsedIds.has(flat.node.id)) {
				this.collapsedIds.add(flat.node.id);
				this.rebuildFlat();
			} else if (flat.depth > 0) {
				// Move to parent
				for (let i = this.selectedIndex - 1; i >= 0; i--) {
					if (this.flatNodes[i].depth < flat.depth) {
						this.selectedIndex = i;
						break;
					}
				}
			}
			return;
		}

		// Right arrow to expand
		if (key.name === "right" && !key.ctrl && !key.meta) {
			const flat = this.flatNodes[this.selectedIndex];
			if (!flat) return;

			if (flat.hasChildren && this.collapsedIds.has(flat.node.id)) {
				this.collapsedIds.delete(flat.node.id);
				this.rebuildFlat();
			}
			return;
		}

		// Home / End
		if (key.name === "home") {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			return;
		}

		if (key.name === "end") {
			this.selectedIndex = Math.max(0, this.flatNodes.length - 1);
			return;
		}
	}

	/** Render the session tree */
	render(width: number, height: number): string[] {
		const output: string[] = [];
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const successColor = hexToAnsi(this.theme.colors.success);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const infoColor = hexToAnsi(this.theme.colors.info);

		// Title
		output.push(bold(`\u{1F4CB} ${this.title}`));
		output.push("");

		if (this.flatNodes.length === 0) {
			output.push(dim("  No sessions"));
			return output;
		}

		const headerLines = output.length;
		const availableHeight = height - headerLines - 1;

		// Adjust scroll
		this.adjustScroll(availableHeight);

		const visibleEnd = Math.min(this.scrollOffset + availableHeight, this.flatNodes.length);

		// Scroll indicator top
		if (this.scrollOffset > 0) {
			output.push(dim(`  ${this.theme.symbols.branchLine} ${this.scrollOffset} more above...`));
		}

		for (let i = this.scrollOffset; i < visibleEnd; i++) {
			const flat = this.flatNodes[i];
			const node = flat.node;
			const isSelected = i === this.selectedIndex;

			// Build tree prefix
			let prefix = "";
			for (const part of flat.prefixParts) {
				if (part === "pipe") {
					prefix += `${mutedColor}${this.theme.symbols.branchLine}${reset}   `;
				} else {
					prefix += "    ";
				}
			}

			// Connector
			const connector = flat.isLast
				? `${mutedColor}${this.theme.symbols.branchEnd}\u2500\u2500${reset}`
				: `${mutedColor}${this.theme.symbols.branch}\u2500\u2500${reset}`;

			// Collapse indicator
			let collapseIcon = "";
			if (flat.hasChildren) {
				collapseIcon = flat.collapsed ? `${dim("\u25B6")} ` : `${dim("\u25BC")} `;
			}

			// Session ID
			const idDisplay = `${mutedColor}[${node.id}]${reset}`;

			// Title (truncated)
			const maxTitleWidth = width - visibleLength(stripAnsi(`${prefix}${connector} ${collapseIcon}${idDisplay} "" `)) - 20;
			let titleText = node.title;
			if (titleText.length > maxTitleWidth && maxTitleWidth > 3) {
				titleText = titleText.slice(0, maxTitleWidth - 1) + "\u2026";
			}
			const titleDisplay = `"${titleText}"`;

			// Metadata
			const meta: string[] = [];
			if (node.date) meta.push(node.date);
			if (node.turnCount !== undefined) meta.push(`${node.turnCount} turns`);
			const metaDisplay = meta.length > 0 ? ` ${dim(`(${meta.join(", ")})`)}` : "";

			// Active indicator
			const activeIndicator = node.active ? ` ${successColor}\u25CF${reset}` : "";

			// Selection highlight
			const pointer = isSelected ? `${primaryColor}\u276F${reset} ` : "  ";

			const line = `${pointer}${prefix}${connector} ${collapseIcon}${idDisplay} ${isSelected ? bold(titleDisplay) : titleDisplay}${metaDisplay}${activeIndicator}`;
			output.push(line);
		}

		// Scroll indicator bottom
		const remaining = this.flatNodes.length - visibleEnd;
		if (remaining > 0) {
			output.push(dim(`  ${this.theme.symbols.branchLine} ${remaining} more below...`));
		}

		// Footer
		output.push("");
		output.push(gray("  Enter: toggle/select | Arrows: navigate"));

		return output;
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private rebuildFlat(): void {
		this.flatNodes = [];
		this.flattenNodes(this.root, 0, []);
		// Clamp selected index
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatNodes.length - 1));
	}

	private flattenNodes(
		nodes: SessionTreeNode[],
		depth: number,
		prefixParts: Array<"pipe" | "space">,
	): void {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const isLast = i === nodes.length - 1;
			const hasChildren = node.children !== undefined && node.children.length > 0;
			const collapsed = this.collapsedIds.has(node.id);

			this.flatNodes.push({
				node,
				depth,
				isLast,
				prefixParts: [...prefixParts],
				collapsed,
				hasChildren,
			});

			if (hasChildren && !collapsed) {
				const childPrefix: Array<"pipe" | "space"> = [...prefixParts, isLast ? "space" : "pipe"];
				this.flattenNodes(node.children!, depth + 1, childPrefix);
			}
		}
	}

	private adjustScroll(viewHeight: number): void {
		if (viewHeight <= 0) return;

		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + viewHeight) {
			this.scrollOffset = this.selectedIndex - viewHeight + 1;
		}

		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, this.flatNodes.length - viewHeight)));
	}
}
