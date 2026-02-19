/**
 * Lightweight SVG chart components for the Hub dashboard.
 *
 * Provides a {@link SparklineChart} (line/area) and a {@link BarChart}
 * (vertical bars with labels). Both auto-scale to their data range.
 * @module components/chart
 */

// ── Types ─────────────────────────────────────────────────────────

/** Props for the sparkline/area chart. */
export interface SparklineProps {
	/** Data points to plot. */
	data: number[];
	/** SVG viewport width in pixels. Default: 120. */
	width?: number;
	/** SVG viewport height in pixels. Default: 32. */
	height?: number;
	/** Stroke colour. Default: #6366f1. */
	color?: string;
	/** Fill opacity beneath the line (0-1). Default: 0.15. */
	fillOpacity?: number;
}

/** A single bar entry. */
export interface BarEntry {
	label: string;
	value: number;
}

/** Props for the vertical bar chart. */
export interface BarChartProps {
	/** Data entries to render as bars. */
	data: BarEntry[];
	/** SVG viewport width. Default: 200. */
	width?: number;
	/** SVG viewport height. Default: 100. */
	height?: number;
	/** Bar fill colour. Default: #6366f1. */
	color?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Convert an array of values into SVG polyline points.
 * Maps each value to an (x, y) coordinate within the given viewport.
 */
function toPolylinePoints(
	data: number[],
	width: number,
	height: number,
	padding: number,
): string {
	if (data.length === 0) return "";
	const min = Math.min(...data);
	const max = Math.max(...data);
	const range = max - min || 1;
	const usableH = height - padding * 2;
	const step = data.length > 1 ? width / (data.length - 1) : 0;

	return data
		.map((val, i) => {
			const x = i * step;
			const y = padding + usableH - ((val - min) / range) * usableH;
			return `${x},${y}`;
		})
		.join(" ");
}

// ── Components ────────────────────────────────────────────────────

/**
 * Sparkline / area chart rendered as inline SVG.
 *
 * Draws a polyline with an optional translucent fill area beneath it.
 * Auto-scales to the min/max of the provided data array.
 */
export function SparklineChart({
	data,
	width = 120,
	height = 32,
	color = "#6366f1",
	fillOpacity = 0.15,
}: SparklineProps): preact.JSX.Element {
	if (data.length < 2) {
		return <svg width={width} height={height} />;
	}

	const padding = 2;
	const points = toPolylinePoints(data, width, height, padding);

	// Build the closed polygon for the fill area
	const firstX = 0;
	const lastX = (data.length - 1) * (width / (data.length - 1));
	const fillPoints = `${firstX},${height} ${points} ${lastX},${height}`;

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			style={{ display: "block" }}
		>
			{fillOpacity > 0 && (
				<polygon points={fillPoints} fill={color} opacity={fillOpacity} />
			)}
			<polyline
				points={points}
				fill="none"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/**
 * Simple vertical bar chart with labels rendered as inline SVG.
 *
 * Bars are auto-scaled so the tallest bar fills the available height.
 * Labels are rendered below each bar.
 */
export function BarChart({
	data,
	width = 200,
	height = 100,
	color = "#6366f1",
}: BarChartProps): preact.JSX.Element {
	if (data.length === 0) {
		return <svg width={width} height={height} />;
	}

	const labelHeight = 16;
	const barAreaHeight = height - labelHeight;
	const maxValue = Math.max(...data.map((d) => d.value), 1);
	const barWidth = width / data.length;
	const barPadding = Math.max(barWidth * 0.2, 2);

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			style={{ display: "block" }}
		>
			{data.map((entry, i) => {
				const barH = (entry.value / maxValue) * barAreaHeight;
				const x = i * barWidth + barPadding / 2;
				const y = barAreaHeight - barH;
				const w = barWidth - barPadding;

				return (
					<g key={i}>
						<rect
							x={x}
							y={y}
							width={w}
							height={barH}
							fill={color}
							rx="2"
						/>
						<text
							x={x + w / 2}
							y={height - 2}
							fill="#8888a0"
							fontSize="9"
							textAnchor="middle"
						>
							{entry.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
