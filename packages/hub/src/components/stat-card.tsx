/**
 * Metric display card for dashboard statistics.
 *
 * Shows a title, large value, optional trend indicator, and an optional
 * sparkline in the bottom-right corner. Styled for the dark theme.
 * @module components/stat-card
 */

import { SparklineChart } from "./chart.js";

// ── Types ─────────────────────────────────────────────────────────

/** Trend direction for the metric. */
export type TrendDirection = "up" | "down" | "flat";

/** Props for the {@link StatCard} component. */
export interface StatCardProps {
	/** Small muted label above the value. */
	title: string;
	/** Primary metric value displayed in large text. */
	value: string | number;
	/** Optional subtitle/description below the value. */
	subtitle?: string;
	/** Trend arrow direction and colour. */
	trend?: TrendDirection;
	/** Data points for an inline sparkline chart. */
	sparklineData?: number[];
	/** Override colour for the sparkline. */
	color?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Map trend direction to a symbol and colour. */
function trendIndicator(trend: TrendDirection): { symbol: string; color: string } {
	switch (trend) {
		case "up":
			return { symbol: "\u25B2", color: "#22c55e" };
		case "down":
			return { symbol: "\u25BC", color: "#ef4444" };
		case "flat":
			return { symbol: "\u2192", color: "#8888a0" };
	}
}

// ── Component ─────────────────────────────────────────────────────

/**
 * A metric card with value, optional trend arrow, and inline sparkline.
 *
 * Designed for the dashboard overview grid. Uses the dark card theme
 * (#16161e background) with rounded corners and subtle border.
 */
export function StatCard({
	title,
	value,
	subtitle,
	trend,
	sparklineData,
	color,
}: StatCardProps): preact.JSX.Element {
	const trendInfo = trend ? trendIndicator(trend) : null;

	return (
		<div
			style={{
				backgroundColor: "#16161e",
				borderRadius: "8px",
				border: "1px solid #2a2a3a",
				padding: "16px",
				position: "relative",
				overflow: "hidden",
				minWidth: "180px",
			}}
		>
			<div style={{ fontSize: "12px", color: "#8888a0", marginBottom: "4px" }}>
				{title}
			</div>
			<div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
				<span style={{ fontSize: "24px", fontWeight: "bold", color: "#e8e8ed" }}>
					{value}
				</span>
				{trendInfo && (
					<span style={{ fontSize: "14px", color: trendInfo.color }}>
						{trendInfo.symbol}
					</span>
				)}
			</div>
			{subtitle && (
				<div style={{ fontSize: "11px", color: "#8888a0", marginTop: "4px" }}>
					{subtitle}
				</div>
			)}
			{sparklineData && sparklineData.length > 1 && (
				<div style={{ position: "absolute", bottom: "8px", right: "8px", opacity: 0.6 }}>
					<SparklineChart
						data={sparklineData}
						width={80}
						height={24}
						color={color ?? "#6366f1"}
					/>
				</div>
			)}
		</div>
	);
}
