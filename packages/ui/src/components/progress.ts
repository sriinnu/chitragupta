/**
 * @chitragupta/ui — Progress indicator components.
 *
 * ProgressBar: renders a single progress bar with percentage and label.
 * MultiProgress: manages multiple concurrent progress bars.
 * Supports determinate and indeterminate (animated) modes.
 */

import { bold, dim, gray, reset, stripAnsi, visibleLength } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProgressBarOptions {
	theme?: Theme;
	total?: number;
	label?: string;
	width?: number;
	indeterminate?: boolean;
}

// ─── ProgressBar ────────────────────────────────────────────────────────────

export class ProgressBar {
	private current = 0;
	private total: number;
	private label: string;
	private barWidth: number;
	private theme: Theme;
	private indeterminate: boolean;
	private startTime: number;
	private animationFrame = 0;
	private lastUpdateTime: number;
	private rateHistory: number[] = [];
	private complete = false;

	constructor(opts?: ProgressBarOptions) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.total = opts?.total ?? 100;
		this.label = opts?.label ?? "";
		this.barWidth = opts?.width ?? 30;
		this.indeterminate = opts?.indeterminate ?? false;
		this.startTime = Date.now();
		this.lastUpdateTime = this.startTime;
	}

	/** Update progress value */
	update(value: number, label?: string): void {
		const now = Date.now();
		const elapsed = now - this.lastUpdateTime;
		if (elapsed > 0 && !this.indeterminate) {
			const rate = (value - this.current) / (elapsed / 1000);
			this.rateHistory.push(rate);
			if (this.rateHistory.length > 10) {
				this.rateHistory.shift();
			}
		}
		this.current = Math.min(value, this.total);
		this.lastUpdateTime = now;
		if (label !== undefined) {
			this.label = label;
		}
	}

	/** Increment progress by a given amount */
	increment(amount = 1): void {
		this.update(this.current + amount);
	}

	/** Set total value */
	setTotal(total: number): void {
		this.total = total;
	}

	/** Mark as complete */
	finish(label?: string): void {
		this.current = this.total;
		this.complete = true;
		if (label !== undefined) {
			this.label = label;
		}
	}

	/** Whether the progress bar has completed */
	get isComplete(): boolean {
		return this.complete || this.current >= this.total;
	}

	/** Get the current percentage (0-100) */
	get percentage(): number {
		if (this.total <= 0) return 0;
		return Math.round((this.current / this.total) * 100);
	}

	/** Get estimated time remaining in seconds */
	get eta(): number | null {
		if (this.indeterminate || this.rateHistory.length === 0 || this.current === 0) return null;
		const avgRate = this.rateHistory.reduce((a, b) => a + b, 0) / this.rateHistory.length;
		if (avgRate <= 0) return null;
		const remaining = this.total - this.current;
		return remaining / avgRate;
	}

	/** Advance animation frame (for indeterminate mode) */
	tick(): void {
		this.animationFrame++;
	}

	/** Render the progress bar as a single styled line */
	render(width?: number): string {
		const effectiveWidth = width ?? this.barWidth;
		const pct = this.percentage;
		const successColor = hexToAnsi(this.theme.colors.success);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		const warningColor = hexToAnsi(this.theme.colors.warning);

		// Choose bar color based on progress
		let barColor = primaryColor;
		if (pct >= 100 || this.complete) barColor = successColor;
		else if (pct > 80) barColor = warningColor;

		let bar: string;

		if (this.indeterminate) {
			// Animated fill pattern
			const cycle = this.animationFrame % (effectiveWidth * 2);
			const pos = cycle < effectiveWidth ? cycle : effectiveWidth * 2 - cycle;
			const barChars: string[] = [];
			for (let i = 0; i < effectiveWidth; i++) {
				const dist = Math.abs(i - pos);
				if (dist <= 2) {
					barChars.push(`${primaryColor}\u2588${reset}`);
				} else if (dist <= 4) {
					barChars.push(`${mutedColor}\u2593${reset}`);
				} else {
					barChars.push(`${mutedColor}\u2591${reset}`);
				}
			}
			bar = `[${barChars.join("")}]`;
		} else {
			// Determinate bar
			const filled = Math.round((pct / 100) * effectiveWidth);
			const empty = effectiveWidth - filled;
			bar = `[${barColor}${"\u2588".repeat(filled)}${mutedColor}${"\u2591".repeat(empty)}${reset}]`;
		}

		// Percentage display
		const pctStr = this.indeterminate ? "..." : `${pct}%`;

		// ETA display
		let etaStr = "";
		if (!this.indeterminate && !this.isComplete) {
			const etaVal = this.eta;
			if (etaVal !== null && etaVal > 0) {
				if (etaVal < 60) {
					etaStr = ` ETA ${Math.ceil(etaVal)}s`;
				} else {
					const mins = Math.floor(etaVal / 60);
					const secs = Math.ceil(etaVal % 60);
					etaStr = ` ETA ${mins}m${secs}s`;
				}
			}
		}

		// Complete marker
		const marker = this.isComplete ? ` ${successColor}${this.theme.symbols.success}${reset}` : "";

		// Label
		const labelStr = this.label ? ` ${dim("\u2014")} ${this.label}` : "";

		return `${bar} ${pctStr}${marker}${labelStr}${dim(etaStr)}`;
	}

	/** Render the progress bar as an array of lines (for multi-line display) */
	renderLines(width?: number): string[] {
		return [this.render(width)];
	}
}

// ─── MultiProgress ──────────────────────────────────────────────────────────

export class MultiProgress {
	private bars: Map<string, ProgressBar> = new Map();
	private order: string[] = [];
	private theme: Theme;
	private barWidth: number;

	constructor(opts?: { theme?: Theme; barWidth?: number }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.barWidth = opts?.barWidth ?? 25;
	}

	/** Add a new progress bar with a unique key */
	add(key: string, opts?: { total?: number; label?: string; indeterminate?: boolean }): ProgressBar {
		const bar = new ProgressBar({
			theme: this.theme,
			width: this.barWidth,
			total: opts?.total ?? 100,
			label: opts?.label ?? key,
			indeterminate: opts?.indeterminate ?? false,
		});
		this.bars.set(key, bar);
		if (!this.order.includes(key)) {
			this.order.push(key);
		}
		return bar;
	}

	/** Get a progress bar by key */
	get(key: string): ProgressBar | undefined {
		return this.bars.get(key);
	}

	/** Remove a progress bar by key */
	remove(key: string): void {
		this.bars.delete(key);
		const idx = this.order.indexOf(key);
		if (idx !== -1) {
			this.order.splice(idx, 1);
		}
	}

	/** Remove all completed bars */
	pruneComplete(): void {
		for (const [key, bar] of this.bars) {
			if (bar.isComplete) {
				this.remove(key);
			}
		}
	}

	/** Check if all bars are complete */
	get allComplete(): boolean {
		for (const bar of this.bars.values()) {
			if (!bar.isComplete) return false;
		}
		return true;
	}

	/** Get the number of active progress bars */
	get count(): number {
		return this.bars.size;
	}

	/** Advance animation frames for all indeterminate bars */
	tick(): void {
		for (const bar of this.bars.values()) {
			bar.tick();
		}
	}

	/** Render all progress bars */
	render(width?: number): string[] {
		const output: string[] = [];
		const effectiveWidth = width ?? this.barWidth;

		for (const key of this.order) {
			const bar = this.bars.get(key);
			if (bar) {
				output.push(bar.render(effectiveWidth));
			}
		}

		if (output.length === 0) {
			output.push(dim("  No active tasks"));
		}

		return output;
	}
}
