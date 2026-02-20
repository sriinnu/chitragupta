/**
 * Pill badge component with semantic colour variants.
 *
 * Used for status indicators, category labels, and severity tags
 * throughout the Hub dashboard.
 * @module components/badge
 */

// ── Types ─────────────────────────────────────────────────────────

/** Available badge colour variants. */
export type BadgeVariant = "success" | "warning" | "error" | "muted" | "accent";

/** Props for the {@link Badge} component. */
export interface BadgeProps {
	/** Text content of the badge. */
	label: string;
	/** Colour variant. Default: "muted". */
	variant?: BadgeVariant;
}

// ── Constants ─────────────────────────────────────────────────────

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
	success: { bg: "var(--color-success-muted)", color: "var(--color-success)" },
	warning: { bg: "var(--color-warning-muted)", color: "var(--color-warning)" },
	error: { bg: "var(--color-error-muted)", color: "var(--color-error)" },
	muted: { bg: "var(--color-border)", color: "var(--color-text)" },
	accent: { bg: "var(--color-accent-muted)", color: "var(--color-accent)" },
};

// ── Component ─────────────────────────────────────────────────────

/**
 * Inline pill badge with background and text coloured by variant.
 *
 * Renders as an inline-block `<span>` with rounded corners.
 */
export function Badge({ label, variant = "muted" }: BadgeProps): preact.JSX.Element {
	const styles = VARIANT_STYLES[variant];

	return (
		<span
			style={{
				display: "inline-block",
				padding: "2px 8px",
				borderRadius: "var(--radius-sm)",
				fontSize: "var(--font-size-xs)",
				fontWeight: 500,
				backgroundColor: styles.bg,
				color: styles.color,
				lineHeight: 1.5,
			}}
		>
			{label}
		</span>
	);
}
