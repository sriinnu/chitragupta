/**
 * Triguna simplex chart — equilateral triangle with barycentric dot.
 *
 * Renders an SVG equilateral triangle with three vertices labelled
 * Sattva (green), Rajas (amber), Tamas (red). The (s, r, t) triplet
 * maps to a unique point inside the triangle via barycentric coordinates.
 * @module components/triguna-chart
 */

import type { TrigunaData } from "../signals/cognitive.js";
import { Badge } from "./badge.js";
import type { BadgeVariant } from "./badge.js";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the {@link TrigunaChart} component. */
export interface TrigunaChartProps {
	/** Triguna data with sattva, rajas, tamas values (0–1 each, sum to ~1). */
	data: TrigunaData;
	/** SVG width/height in pixels. Default: 260. */
	size?: number;
}

// ── Constants ─────────────────────────────────────────────────────

const GUNA_COLORS = {
	sattva: "var(--color-success)",
	rajas: "var(--color-warning)",
	tamas: "var(--color-error)",
};

const TREND_ARROWS: Record<string, string> = {
	rising: "\u2191",
	falling: "\u2193",
	stable: "\u2192",
};

const GUNA_BADGES: Record<string, BadgeVariant> = {
	sattva: "success",
	rajas: "warning",
	tamas: "error",
};

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Convert barycentric coordinates (s, r, t) to Cartesian (x, y)
 * within an equilateral triangle.
 *
 * Vertices: top = Sattva, bottom-left = Rajas, bottom-right = Tamas.
 */
function barycentricToCartesian(
	s: number, r: number, t: number,
	ax: number, ay: number,
	bx: number, by: number,
	cx: number, cy: number,
): { x: number; y: number } {
	const total = s + r + t || 1;
	const ns = s / total;
	const nr = r / total;
	const nt = t / total;
	return {
		x: ns * ax + nr * bx + nt * cx,
		y: ns * ay + nr * by + nt * cy,
	};
}

// ── Component ─────────────────────────────────────────────────────

/**
 * SVG equilateral triangle with a positioned dot representing
 * the current Triguna balance.
 *
 * Includes vertex labels, the barycentric dot, and a dominant guna
 * badge with trend arrows below.
 */
export function TrigunaChart({ data, size = 260 }: TrigunaChartProps): preact.JSX.Element {
	const pad = 30;
	const w = size;
	const h = size;

	// Triangle vertices (equilateral, point up)
	const ax = w / 2;
	const ay = pad;
	const bx = pad;
	const by = h - pad;
	const cx = w - pad;
	const cy = h - pad;

	const dot = barycentricToCartesian(data.state.sattva, data.state.rajas, data.state.tamas, ax, ay, bx, by, cx, cy);

	return (
		<div>
			<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
				{/* Triangle fill */}
				<polygon
					points={`${ax},${ay} ${bx},${by} ${cx},${cy}`}
					fill="var(--color-surface)"
					stroke="var(--color-border)"
					strokeWidth="1"
				/>

				{/* Triangle edges with gradient hints */}
				<line x1={ax} y1={ay} x2={bx} y2={by} stroke={GUNA_COLORS.sattva} strokeWidth="1" opacity="0.4" />
				<line x1={bx} y1={by} x2={cx} y2={cy} stroke={GUNA_COLORS.rajas} strokeWidth="1" opacity="0.4" />
				<line x1={cx} y1={cy} x2={ax} y2={ay} stroke={GUNA_COLORS.tamas} strokeWidth="1" opacity="0.4" />

				{/* Vertex labels */}
				<text x={ax} y={ay - 10} textAnchor="middle" fill={GUNA_COLORS.sattva} fontSize="11" fontWeight="600">
					Sattva
				</text>
				<text x={bx - 4} y={by + 16} textAnchor="middle" fill={GUNA_COLORS.rajas} fontSize="11" fontWeight="600">
					Rajas
				</text>
				<text x={cx + 4} y={cy + 16} textAnchor="middle" fill={GUNA_COLORS.tamas} fontSize="11" fontWeight="600">
					Tamas
				</text>

				{/* Dot glow */}
				<circle cx={dot.x} cy={dot.y} r="10" fill={GUNA_COLORS[data.dominant]} opacity="0.2" />

				{/* Position dot */}
				<circle
					cx={dot.x}
					cy={dot.y}
					r="5"
					fill={GUNA_COLORS[data.dominant]}
					stroke="var(--color-bg)"
					strokeWidth="2"
				/>
			</svg>

			{/* Dominant badge + trends */}
			<div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
				<Badge label={`${data.dominant} dominant`} variant={GUNA_BADGES[data.dominant] ?? "muted"} />
				<div style={{ display: "flex", gap: "var(--space-sm)", fontSize: "var(--font-size-xs)" }}>
					{(["sattva", "rajas", "tamas"] as const).map((g) => (
						<span key={g} style={{ color: GUNA_COLORS[g] }}>
							{g.charAt(0).toUpperCase()}{TREND_ARROWS[data.trend[g]] ?? ""}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}
