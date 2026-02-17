/**
 * @chitragupta/ui — Notification toast system.
 *
 * Transient notifications that appear and auto-dismiss.
 * Supports success, error, warning, and info types with themed
 * icons/colors. Toasts stack vertically and auto-dismiss after
 * a configurable timeout.
 */

import { bold, dim, reset, stripAnsi, visibleLength } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastOptions {
	type?: ToastType;
	timeout?: number;
	theme?: Theme;
}

interface ToastEntry {
	id: number;
	type: ToastType;
	message: string;
	createdAt: number;
	timeout: number;
	dismissing: boolean;
}

// ─── Icons & Colors ─────────────────────────────────────────────────────────

function getToastIcon(type: ToastType, theme: Theme): string {
	switch (type) {
		case "success": return theme.symbols.success;
		case "error": return theme.symbols.error;
		case "warning": return theme.symbols.warning;
		case "info": return theme.symbols.info;
	}
}

function getToastColor(type: ToastType, theme: Theme): string {
	switch (type) {
		case "success": return hexToAnsi(theme.colors.success);
		case "error": return hexToAnsi(theme.colors.error);
		case "warning": return hexToAnsi(theme.colors.warning);
		case "info": return hexToAnsi(theme.colors.info);
	}
}

// ─── ToastManager ───────────────────────────────────────────────────────────

export class ToastManager {
	private toasts: ToastEntry[] = [];
	private nextId = 0;
	private theme: Theme;
	private defaultTimeout: number;
	private maxToasts: number;

	constructor(opts?: { theme?: Theme; defaultTimeout?: number; maxToasts?: number }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.defaultTimeout = opts?.defaultTimeout ?? 3000;
		this.maxToasts = opts?.maxToasts ?? 5;
	}

	/** Show a toast notification. Returns a toast ID for manual dismissal. */
	show(message: string, opts?: ToastOptions): number {
		const id = this.nextId++;
		const type = opts?.type ?? "info";
		const timeout = opts?.timeout ?? this.defaultTimeout;

		const entry: ToastEntry = {
			id,
			type,
			message,
			createdAt: Date.now(),
			timeout,
			dismissing: false,
		};

		this.toasts.push(entry);

		// Limit stack size
		while (this.toasts.length > this.maxToasts) {
			this.toasts.shift();
		}

		return id;
	}

	/** Show a success toast */
	success(message: string, timeout?: number): number {
		return this.show(message, { type: "success", timeout });
	}

	/** Show an error toast */
	error(message: string, timeout?: number): number {
		return this.show(message, { type: "error", timeout });
	}

	/** Show a warning toast */
	warning(message: string, timeout?: number): number {
		return this.show(message, { type: "warning", timeout });
	}

	/** Show an info toast */
	info(message: string, timeout?: number): number {
		return this.show(message, { type: "info", timeout });
	}

	/** Manually dismiss a toast by ID */
	dismiss(id: number): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	/** Dismiss all toasts */
	dismissAll(): void {
		this.toasts = [];
	}

	/** Get the count of active toasts */
	get count(): number {
		return this.toasts.length;
	}

	/**
	 * Render toasts positioned at the top-right of the given screen dimensions.
	 * Returns an array of { y, line } objects for overlay rendering.
	 * Also prunes expired toasts.
	 */
	render(screenWidth: number, _screenHeight: number): Array<{ y: number; line: string }> {
		this.pruneExpired();

		const output: Array<{ y: number; line: string }> = [];
		const toastWidth = Math.min(50, Math.max(30, Math.floor(screenWidth * 0.3)));

		for (let i = 0; i < this.toasts.length; i++) {
			const toast = this.toasts[i];
			const color = getToastColor(toast.type, this.theme);
			const icon = getToastIcon(toast.type, this.theme);
			const borderColor = hexToAnsi(this.theme.colors.border);

			// Calculate fade progress (last 500ms of lifetime)
			const elapsed = Date.now() - toast.createdAt;
			const remaining = toast.timeout - elapsed;
			const fading = remaining < 500;

			// Truncate message to fit
			const innerWidth = toastWidth - 6; // borders + padding + icon
			let msg = toast.message;
			if (stripAnsi(msg).length > innerWidth) {
				msg = msg.slice(0, innerWidth - 1) + "\u2026";
			}

			const paddedMsg = msg + " ".repeat(Math.max(0, innerWidth - visibleLength(stripAnsi(msg))));

			const topBorder = `${borderColor}\u256D${"\u2500".repeat(toastWidth - 2)}\u256E${reset}`;
			const content = `${borderColor}\u2502${reset} ${color}${icon}${reset} ${fading ? dim(paddedMsg) : paddedMsg} ${borderColor}\u2502${reset}`;
			const bottomBorder = `${borderColor}\u2570${"\u2500".repeat(toastWidth - 2)}\u256F${reset}`;

			const xOffset = screenWidth - toastWidth - 1;
			const yOffset = 1 + i * 3;
			const pad = " ".repeat(Math.max(0, xOffset));

			output.push({ y: yOffset, line: `${pad}${topBorder}` });
			output.push({ y: yOffset + 1, line: `${pad}${content}` });
			output.push({ y: yOffset + 2, line: `${pad}${bottomBorder}` });
		}

		return output;
	}

	/**
	 * Render toasts as simple lines (for cases where overlay positioning
	 * is handled by the caller).
	 */
	renderLines(width: number): string[] {
		this.pruneExpired();

		const output: string[] = [];
		const toastWidth = Math.min(50, Math.max(30, width));

		for (const toast of this.toasts) {
			const color = getToastColor(toast.type, this.theme);
			const icon = getToastIcon(toast.type, this.theme);
			const borderColor = hexToAnsi(this.theme.colors.border);

			const innerWidth = toastWidth - 6;
			let msg = toast.message;
			if (stripAnsi(msg).length > innerWidth) {
				msg = msg.slice(0, innerWidth - 1) + "\u2026";
			}

			const paddedMsg = msg + " ".repeat(Math.max(0, innerWidth - visibleLength(stripAnsi(msg))));

			output.push(`${borderColor}\u256D${"\u2500".repeat(toastWidth - 2)}\u256E${reset}`);
			output.push(`${borderColor}\u2502${reset} ${color}${bold(icon)}${reset} ${paddedMsg} ${borderColor}\u2502${reset}`);
			output.push(`${borderColor}\u2570${"\u2500".repeat(toastWidth - 2)}\u256F${reset}`);
		}

		return output;
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private pruneExpired(): void {
		const now = Date.now();
		this.toasts = this.toasts.filter((t) => now - t.createdAt < t.timeout);
	}
}
