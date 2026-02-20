/**
 * Animated SVG loading spinner component.
 *
 * Renders a rotating ring with a gap, available in three sizes.
 * Replaces all "Loading..." text strings across the Hub.
 * @module components/spinner
 */

// ── Types ─────────────────────────────────────────────────────────

/** Available spinner sizes. */
type SpinnerSize = "sm" | "md" | "lg";

/** Props for the {@link Spinner} component. */
export interface SpinnerProps {
	/** Spinner diameter. Default: "md". */
	size?: SpinnerSize;
	/** Override stroke colour. Default: var(--color-accent). */
	color?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const SIZE_MAP: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 40 };

// ── Component ─────────────────────────────────────────────────────

/**
 * SVG animated spinner with configurable size and colour.
 *
 * Uses a CSS `@keyframes` rotation applied via an inline `<style>` tag
 * scoped to the spinner element class.
 */
export function Spinner({ size = "md", color }: SpinnerProps): preact.JSX.Element {
	const px = SIZE_MAP[size];
	const stroke = color ?? "var(--color-accent)";

	return (
		<div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
			<svg
				width={px}
				height={px}
				viewBox="0 0 24 24"
				fill="none"
				class="hub-spinner"
			>
				<circle
					cx="12" cy="12" r="10"
					stroke="var(--color-border)"
					strokeWidth="2.5"
				/>
				<circle
					cx="12" cy="12" r="10"
					stroke={stroke}
					strokeWidth="2.5"
					strokeDasharray="31.4 31.4"
					strokeLinecap="round"
				/>
			</svg>
			<style>{`
				.hub-spinner { animation: hub-spin 0.8s linear infinite; }
				@keyframes hub-spin { to { transform: rotate(360deg); } }
			`}</style>
		</div>
	);
}
