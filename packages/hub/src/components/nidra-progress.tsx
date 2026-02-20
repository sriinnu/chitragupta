/**
 * Nidra (sleep/consolidation) progress visualizer.
 *
 * Shows the current Nidra state badge, active consolidation phase
 * with a pulsing indicator, a progress bar, and uptime display.
 * @module components/nidra-progress
 */

import type { NidraData } from "../signals/cognitive.js";
import { Badge } from "./badge.js";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the {@link NidraProgress} component. */
export interface NidraProgressProps {
	/** Nidra status data from the cognitive signal. */
	data: NidraData;
}

// ── Constants ─────────────────────────────────────────────────────

// ── Component ─────────────────────────────────────────────────────

/**
 * Nidra consolidation progress display.
 *
 * Shows current state badge, consolidation phase (if active),
 * a progress bar, and timestamps for last consolidation and uptime.
 */
export function NidraProgress({ data }: NidraProgressProps): preact.JSX.Element {
	const progress = Math.min(Math.max(data.consolidationProgress, 0), 100);
	const isConsolidating = progress > 0 && progress < 100;
	const phaseName = data.consolidationPhase ?? "idle";

	return (
		<div>
			{/* State badge + last consolidation */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-lg)" }}>
				<Badge
					label={data.state}
					variant={data.state === "DREAMING" ? "accent" : "muted"}
				/>
				{data.lastConsolidationEnd != null && (
					<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
						Last: {formatEpoch(data.lastConsolidationEnd)}
					</span>
				)}
			</div>

			{/* Active phase label (shown during consolidation) */}
			{isConsolidating && (
				<div style={{
					display: "flex",
					alignItems: "center",
					gap: "var(--space-sm)",
					marginBottom: "var(--space-md)",
				}}>
					<span
						class="hub-nidra-pulse"
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "50%",
							background: "var(--color-accent)",
							display: "inline-block",
							flexShrink: 0,
						}}
					/>
					<span style={{ fontSize: "var(--font-size-md)", color: "var(--color-text)" }}>
						{phaseName}
					</span>
					<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginLeft: "auto" }}>
						{progress.toFixed(0)}%
					</span>
				</div>
			)}

			{/* Progress bar */}
			<div
				style={{
					height: "4px",
					background: "var(--color-border)",
					borderRadius: "2px",
					overflow: "hidden",
					marginBottom: "var(--space-md)",
				}}
			>
				<div
					style={{
						height: "100%",
						width: `${progress}%`,
						background: "var(--color-accent)",
						borderRadius: "2px",
						transition: "width var(--transition-normal)",
					}}
				/>
			</div>

			{/* Uptime */}
			<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
				Uptime: {formatDuration(data.uptime)}
			</div>

			<style>{`
				.hub-nidra-pulse { animation: hub-nidra-glow 1.5s ease-in-out infinite; }
				@keyframes hub-nidra-glow {
					0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
					50% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); }
				}
			`}</style>
		</div>
	);
}

// ── Helpers ───────────────────────────────────────────────────────

/** Format an epoch timestamp (ms or s) to a short local time string. */
function formatEpoch(epoch: number): string {
	try {
		// If epoch looks like seconds (< 1e12), convert to ms
		const ms = epoch < 1e12 ? epoch * 1000 : epoch;
		return new Date(ms).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return String(epoch);
	}
}

/** Format a duration in milliseconds to a human-readable string. */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}
