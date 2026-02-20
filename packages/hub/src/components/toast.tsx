/**
 * Signal-driven toast notification system.
 *
 * Provides a {@link showToast} function to push notifications and a
 * {@link ToastContainer} component to render them. Toasts auto-dismiss
 * after 4 seconds and stack in the bottom-right corner.
 * @module components/toast
 */

import { signal } from "@preact/signals";

// ── Types ─────────────────────────────────────────────────────────

/** Toast severity level. */
export type ToastType = "success" | "error" | "info";

/** Internal toast entry with unique id. */
interface ToastEntry {
	id: number;
	message: string;
	type: ToastType;
}

// ── State ─────────────────────────────────────────────────────────

const toasts = signal<ToastEntry[]>([]);
let nextId = 0;

/** Auto-dismiss delay in milliseconds. */
const DISMISS_MS = 4000;

// ── Public API ────────────────────────────────────────────────────

/**
 * Push a new toast notification.
 *
 * @param message - Display text.
 * @param type    - Severity: "success", "error", or "info". Default: "info".
 */
export function showToast(message: string, type: ToastType = "info"): void {
	const id = nextId++;
	toasts.value = [...toasts.value, { id, message, type }];

	setTimeout(() => {
		toasts.value = toasts.value.filter((t) => t.id !== id);
	}, DISMISS_MS);
}

/** Remove a toast by id (for manual dismiss). */
function dismiss(id: number): void {
	toasts.value = toasts.value.filter((t) => t.id !== id);
}

// ── Constants ─────────────────────────────────────────────────────

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; color: string }> = {
	success: {
		bg: "var(--color-surface)",
		border: "var(--color-success)",
		color: "var(--color-success)",
	},
	error: {
		bg: "var(--color-surface)",
		border: "var(--color-error)",
		color: "var(--color-error)",
	},
	info: {
		bg: "var(--color-surface)",
		border: "var(--color-accent)",
		color: "var(--color-accent)",
	},
};

const TYPE_ICONS: Record<ToastType, string> = {
	success: "\u2713",
	error: "\u2717",
	info: "\u2139",
};

// ── Component ─────────────────────────────────────────────────────

/**
 * Renders the global toast stack in the bottom-right corner.
 *
 * Mount once in the root layout. Reads from the `toasts` signal
 * reactively, so new toasts appear without prop drilling.
 */
export function ToastContainer(): preact.JSX.Element {
	const items = toasts.value;
	if (items.length === 0) return <></>;

	return (
		<div
			style={{
				position: "fixed",
				bottom: "var(--space-xl)",
				right: "var(--space-xl)",
				display: "flex",
				flexDirection: "column",
				gap: "var(--space-sm)",
				zIndex: 100,
				maxWidth: "380px",
			}}
		>
			{items.map((toast) => {
				const style = TYPE_STYLES[toast.type];
				return (
					<div
						key={toast.id}
						style={{
							display: "flex",
							alignItems: "flex-start",
							gap: "var(--space-sm)",
							padding: "var(--space-md) var(--space-lg)",
							background: style.bg,
							borderLeft: `3px solid ${style.border}`,
							borderRadius: "var(--radius-md)",
							boxShadow: "var(--shadow-md)",
							animation: "hub-toast-in 0.2s ease-out",
						}}
					>
						<span style={{ color: style.color, fontWeight: 700, fontSize: "var(--font-size-base)" }}>
							{TYPE_ICONS[toast.type]}
						</span>
						<span style={{ flex: 1, fontSize: "var(--font-size-md)", color: "var(--color-text)", lineHeight: 1.4 }}>
							{toast.message}
						</span>
						<button
							onClick={() => dismiss(toast.id)}
							style={{
								background: "none",
								border: "none",
								color: "var(--color-muted)",
								cursor: "pointer",
								fontSize: "var(--font-size-base)",
								padding: 0,
								lineHeight: 1,
							}}
						>
							\u00D7
						</button>
					</div>
				);
			})}
			<style>{`
				@keyframes hub-toast-in {
					from { opacity: 0; transform: translateX(20px); }
					to { opacity: 1; transform: translateX(0); }
				}
			`}</style>
		</div>
	);
}
