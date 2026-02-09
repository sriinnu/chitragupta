/**
 * @chitragupta/ui — Bottom status bar component.
 *
 * Displays model info, cost, token usage, context percentage,
 * thinking level, git branch, provider health, and animated
 * streaming/thinking indicators in a sectioned layout.
 */

import { bold, dim, reset, visibleLength } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi, hexToBgAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatusBarData {
	model?: string;
	provider?: string;
	cost?: number;
	inputTokens?: number;
	outputTokens?: number;
	contextPercent?: number;
	thinkingLevel?: string;
	message?: string;
}

export type StatusBarSection = "left" | "center" | "right";

export interface StatusBarItem {
	id: string;
	content: string;
	section: StatusBarSection;
	priority?: number;
	clickable?: boolean;
}

export type ProviderHealth = "healthy" | "degraded" | "down" | "unknown";

// ─── Streaming Indicator Frames ─────────────────────────────────────────────

const STREAMING_FRAMES = ["\u2022  ", " \u2022 ", "  \u2022", " \u2022 "];
const THINKING_FRAMES = ["\u25C6", "\u25C7", "\u25C6", "\u25C7"];

// ─── StatusBar ──────────────────────────────────────────────────────────────

export class StatusBar {
	private data: StatusBarData = {};
	private theme: Theme;

	// Sections system
	private customItems: StatusBarItem[] = [];

	// Provider health
	private providerHealthState: ProviderHealth = "unknown";

	// Git branch
	private gitBranchName = "";

	// Animated indicators
	private streaming = false;
	private thinking = false;
	private animationFrame = 0;

	constructor(opts?: { theme?: Theme }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
	}

	/** Update status bar data */
	update(data: StatusBarData): void {
		this.data = { ...this.data, ...data };
	}

	/** Clear all status bar data */
	clear(): void {
		this.data = {};
	}

	// ─── Sections ───────────────────────────────────────────────────────

	/** Add or update a custom item in a section */
	setItem(item: StatusBarItem): void {
		const existing = this.customItems.findIndex((i) => i.id === item.id);
		if (existing >= 0) {
			this.customItems[existing] = item;
		} else {
			this.customItems.push(item);
		}
		// Sort by priority (higher first)
		this.customItems.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	}

	/** Remove a custom item by ID */
	removeItem(id: string): void {
		this.customItems = this.customItems.filter((i) => i.id !== id);
	}

	/** Clear all custom items */
	clearItems(): void {
		this.customItems = [];
	}

	/** Get items for a specific section */
	getItems(section: StatusBarSection): StatusBarItem[] {
		return this.customItems.filter((i) => i.section === section);
	}

	// ─── Provider Health ─────────────────────────────────────────────────

	/** Set the provider health indicator */
	setProviderHealth(health: ProviderHealth): void {
		this.providerHealthState = health;
	}

	/** Get the current provider health */
	get providerHealth(): ProviderHealth {
		return this.providerHealthState;
	}

	// ─── Git Branch ─────────────────────────────────────────────────────

	/** Set the git branch name to display */
	setGitBranch(branch: string): void {
		this.gitBranchName = branch;
	}

	/** Get the current git branch name */
	get gitBranch(): string {
		return this.gitBranchName;
	}

	// ─── Animated Indicators ─────────────────────────────────────────────

	/** Set whether the streaming indicator is active */
	setStreaming(active: boolean): void {
		this.streaming = active;
	}

	/** Set whether the thinking indicator is active */
	setThinking(active: boolean): void {
		this.thinking = active;
	}

	/** Advance animation frame (call periodically for smooth animation) */
	tick(): void {
		this.animationFrame++;
	}

	// ─── Render ─────────────────────────────────────────────────────────

	/** Render the status bar as a single styled line */
	render(width: number): string {
		const bgColor = hexToBgAnsi(this.theme.colors.border);
		const fgColor = hexToAnsi(this.theme.colors.foreground);
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const successColor = hexToAnsi(this.theme.colors.success);
		const warningColor = hexToAnsi(this.theme.colors.warning);
		const errorColor = hexToAnsi(this.theme.colors.error);
		const mutedColor = hexToAnsi(this.theme.colors.muted);

		// Build left section segments
		const leftSegments: string[] = [];

		// Provider health dot
		if (this.providerHealthState !== "unknown") {
			let dotColor = mutedColor;
			switch (this.providerHealthState) {
				case "healthy": dotColor = successColor; break;
				case "degraded": dotColor = warningColor; break;
				case "down": dotColor = errorColor; break;
			}
			leftSegments.push(`${dotColor}\u25CF${fgColor}`);
		}

		// Model + Provider
		if (this.data.model || this.data.provider) {
			const model = this.data.model ?? "unknown";
			const provider = this.data.provider ? ` (${this.data.provider})` : "";
			leftSegments.push(`${primaryColor}${bold(model)}${fgColor}${dim(provider)}`);
		}

		// Thinking level
		if (this.data.thinkingLevel) {
			const level = this.data.thinkingLevel;
			let levelColor = mutedColor;
			if (level === "high") levelColor = warningColor;
			else if (level === "medium") levelColor = primaryColor;
			else if (level === "low") levelColor = successColor;
			leftSegments.push(`${levelColor}\u25C6 ${level}${fgColor}`);
		}

		// Custom left items
		for (const item of this.getItems("left")) {
			leftSegments.push(item.content);
		}

		// Build center section segments
		const centerSegments: string[] = [];

		// Streaming indicator
		if (this.streaming) {
			const frame = STREAMING_FRAMES[this.animationFrame % STREAMING_FRAMES.length];
			centerSegments.push(`${primaryColor}${frame} streaming${fgColor}`);
		}

		// Thinking indicator
		if (this.thinking) {
			const frame = THINKING_FRAMES[this.animationFrame % THINKING_FRAMES.length];
			centerSegments.push(`${warningColor}${frame} thinking${fgColor}`);
		}

		// Custom center items
		for (const item of this.getItems("center")) {
			centerSegments.push(item.content);
		}

		// Build right section segments
		const rightSegments: string[] = [];

		// Custom right items
		for (const item of this.getItems("right")) {
			rightSegments.push(item.content);
		}

		// Cost
		if (this.data.cost !== undefined) {
			const cost = this.data.cost;
			const formatted = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
			rightSegments.push(`${successColor}${formatted}${fgColor}`);
		}

		// Tokens
		if (this.data.inputTokens !== undefined || this.data.outputTokens !== undefined) {
			const input = this.data.inputTokens ?? 0;
			const output = this.data.outputTokens ?? 0;
			const total = input + output;
			const formatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
			rightSegments.push(`${mutedColor}${formatted} tok${fgColor}`);
		}

		// Context usage
		if (this.data.contextPercent !== undefined) {
			const pct = this.data.contextPercent;
			let pctColor = successColor;
			if (pct > 80) pctColor = errorColor;
			else if (pct > 50) pctColor = warningColor;

			const bar = this.renderMiniBar(pct, 10);
			rightSegments.push(`${pctColor}ctx ${pct}% ${bar}${fgColor}`);
		}

		// Git branch
		if (this.gitBranchName) {
			rightSegments.push(`${mutedColor}\u2387 ${this.gitBranchName}${fgColor}`);
		}

		// Message
		if (this.data.message) {
			rightSegments.push(this.data.message);
		}

		// Join segments with separator
		const separator = ` ${mutedColor}\u2502${fgColor} `;

		const leftContent = leftSegments.join(separator);
		const centerContent = centerSegments.join(separator);
		const rightContent = rightSegments.join(separator);

		const leftVisible = visibleLength(leftContent);
		const centerVisible = visibleLength(centerContent);
		const rightVisible = visibleLength(rightContent);

		// Layout: left ... center ... right
		if (centerVisible > 0) {
			const totalUsed = leftVisible + centerVisible + rightVisible;
			const totalPad = Math.max(0, width - totalUsed);
			const leftPad = Math.floor(totalPad / 2);
			const rightPad = totalPad - leftPad;

			return `${bgColor}${fgColor}${leftContent}${" ".repeat(leftPad)}${centerContent}${" ".repeat(rightPad)}${rightContent}${reset}`;
		}

		// No center content: left-aligned + right-aligned
		const padding = Math.max(0, width - leftVisible - rightVisible);
		return `${bgColor}${fgColor}${leftContent}${" ".repeat(padding)}${rightContent}${reset}`;
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private renderMiniBar(percent: number, barWidth: number): string {
		const filled = Math.round((percent / 100) * barWidth);
		const empty = barWidth - filled;
		return "\u2588".repeat(filled) + "\u2591".repeat(empty);
	}
}
