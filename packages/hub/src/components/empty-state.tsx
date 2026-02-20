/**
 * Empty state placeholder component.
 *
 * Displays a centred icon, title, description, and optional action
 * button when a page or section has no data to show.
 * @module components/empty-state
 */

import type { ComponentChildren } from "preact";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the {@link EmptyState} component. */
export interface EmptyStateProps {
	/** Large emoji/icon displayed above the title. */
	icon?: string;
	/** Primary heading text. */
	title: string;
	/** Supporting description text. */
	description?: string;
	/** Optional action slot (e.g. a button). */
	children?: ComponentChildren;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Centred empty-state card with icon, title, description, and action slot.
 *
 * Used across pages when API returns zero results or when a module
 * is not active (e.g. 503 responses from the daemon).
 */
export function EmptyState({ icon, title, description, children }: EmptyStateProps): preact.JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "var(--space-2xl) var(--space-lg)",
				textAlign: "center",
				minHeight: "200px",
			}}
		>
			{icon && (
				<div style={{ fontSize: "40px", marginBottom: "var(--space-lg)", opacity: 0.6 }}>
					{icon}
				</div>
			)}
			<div style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600, marginBottom: "var(--space-sm)" }}>
				{title}
			</div>
			{description && (
				<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-muted)", maxWidth: "360px", lineHeight: 1.5 }}>
					{description}
				</div>
			)}
			{children && (
				<div style={{ marginTop: "var(--space-lg)" }}>
					{children}
				</div>
			)}
		</div>
	);
}
