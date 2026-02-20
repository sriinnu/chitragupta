/**
 * Consciousness dashboard page for the Chitragupta Hub.
 *
 * Two-column layout displaying the five pillars of the cognitive
 * system: Triguna health simplex, Turiya cost savings, Nidra sleep
 * state, Vasana tendencies, and Vidhi procedures.
 *
 * Real-time: re-fetches Triguna on `chat:done`, Vasanas on
 * `tool:done`, polls Nidra every 30 seconds.
 * @module pages/consciousness
 */

import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import { TrigunaChart } from "../components/triguna-chart.js";
import { NidraProgress } from "../components/nidra-progress.js";
import {
	trigunaData,
	vasanas,
	nidraData,
	vidhis,
	turiyaStats,
	cognitiveLoading,
	fetchAllCognitive,
	fetchTriguna,
	fetchVasanas,
	fetchNidra,
} from "../signals/cognitive.js";
import { lastEvent } from "../signals/realtime.js";

// ── Constants ─────────────────────────────────────────────────────

const NIDRA_POLL_MS = 30_000;

const VALENCE_COLORS: Record<string, string> = {
	positive: "var(--color-success)",
	negative: "var(--color-error)",
	neutral: "var(--color-muted)",
};

// ── Component ─────────────────────────────────────────────────────

/**
 * Consciousness page — crown jewel of the Hub.
 *
 * Fetches all cognitive data on mount and sets up real-time
 * re-fetch effects and polling intervals.
 */
export function Consciousness(): preact.JSX.Element {
	const nidraTimer = useRef<ReturnType<typeof setInterval> | null>(null);

	// Initial fetch
	useEffect(() => {
		void fetchAllCognitive();
	}, []);

	// Re-fetch Triguna on chat:done, Vasanas on tool:done
	useEffect(() => {
		const dispose = effect(() => {
			const ev = lastEvent.value;
			if (ev?.type === "chat:done") void fetchTriguna();
			if (ev?.type === "tool:done") void fetchVasanas();
		});
		return dispose;
	}, []);

	// Poll Nidra every 30s
	useEffect(() => {
		nidraTimer.current = setInterval(() => {
			void fetchNidra();
		}, NIDRA_POLL_MS);
		return () => {
			if (nidraTimer.current) clearInterval(nidraTimer.current);
		};
	}, []);

	const loading = cognitiveLoading.value;
	const triguna = trigunaData.value;
	const nidra = nidraData.value;
	const vasanaList = vasanas.value;
	const vidhiList = vidhis.value;
	const turiya = turiyaStats.value;

	if (loading && !triguna && !nidra) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
				<Spinner size="lg" />
			</div>
		);
	}

	// When daemon is not running, all signals are null/empty
	const hasData = triguna !== null || nidra !== null || vasanaList.length > 0 || vidhiList.length > 0;
	if (!hasData) {
		return (
			<EmptyState
				icon="\uD83E\uDDD8"
				title="Consciousness modules offline"
				description="The cognitive system is not active. Start the Chitragupta daemon to see real-time consciousness data."
			/>
		);
	}

	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Consciousness
			</h1>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-xl)", alignItems: "start" }}>
				{/* ── Left column ───────────────────────────────── */}
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
					{/* Triguna chart */}
					{triguna && (
						<Card title="Triguna Health">
							<TrigunaChart data={triguna} />
						</Card>
					)}

					{/* Turiya cost savings */}
					{turiya && (
						<Card title="Turiya Routing">
							<div style={{ display: "flex", gap: "var(--space-xl)", marginBottom: "var(--space-lg)" }}>
								<div>
									<div style={{ fontSize: "var(--font-size-2xl)", fontWeight: "bold", color: "var(--color-success)" }}>
										${turiya.costSavings.toFixed(2)}
									</div>
									<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
										saved ({turiya.savingsPercent.toFixed(1)}%)
									</div>
								</div>
								<div>
									<div style={{ fontSize: "var(--font-size-2xl)", fontWeight: "bold", color: "var(--color-text)" }}>
										{turiya.totalRequests}
									</div>
									<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
										total requests
									</div>
								</div>
							</div>
						</Card>
					)}
				</div>

				{/* ── Right column ──────────────────────────────── */}
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
					{/* Nidra progress */}
					{nidra && (
						<Card title="Nidra Consolidation">
							<NidraProgress data={nidra} />
						</Card>
					)}

					{/* Vasana tendencies — top 10 */}
					{vasanaList.length > 0 && (
						<Card title="Top Vasana Tendencies">
							<VasanaList entries={vasanaList.slice(0, 10)} />
						</Card>
					)}

					{/* Vidhi procedures — top 10 */}
					{vidhiList.length > 0 && (
						<Card title="Top Vidhi Procedures">
							<VidhiTable entries={vidhiList.slice(0, 10)} />
						</Card>
					)}
				</div>
			</div>

			{/* Responsive: stack columns on narrow viewports */}
			<style>{`
				@media (max-width: 900px) {
					div[style*="grid-template-columns: 1fr 1fr"] {
						grid-template-columns: 1fr !important;
					}
				}
			`}</style>
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────

/** Reusable card wrapper with title. */
function Card({ title, children }: { title: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<div style={{
			background: "var(--color-surface)",
			border: "1px solid var(--color-border)",
			borderRadius: "var(--radius-lg)",
			padding: "var(--space-lg)",
		}}>
			<h3 style={{
				fontSize: "var(--font-size-base)",
				color: "var(--color-muted)",
				marginBottom: "var(--space-lg)",
				fontWeight: 500,
			}}>
				{title}
			</h3>
			{children}
		</div>
	);
}

/** Horizontal bar list for Vasana tendencies. */
function VasanaList({ entries }: { entries: typeof vasanas.value }): preact.JSX.Element {
	const maxStrength = Math.max(...entries.map((e) => e.strength), 1);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
			{entries.map((v) => (
				<div key={v.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
					<span style={{
						fontSize: "var(--font-size-md)",
						color: "var(--color-text)",
						width: "140px",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flexShrink: 0,
					}}>
						{v.tendency}
					</span>
					<div style={{ flex: 1, height: "6px", background: "var(--color-border)", borderRadius: "3px", overflow: "hidden" }}>
						<div style={{
							height: "100%",
							width: `${(v.strength / maxStrength) * 100}%`,
							background: VALENCE_COLORS[v.valence] ?? "var(--color-muted)",
							borderRadius: "3px",
						}} />
					</div>
					<Badge
						label={v.valence}
						variant={v.valence === "positive" ? "success" : v.valence === "negative" ? "error" : "muted"}
					/>
				</div>
			))}
		</div>
	);
}

/** Table for Vidhi procedures. */
function VidhiTable({ entries }: { entries: typeof vidhis.value }): preact.JSX.Element {
	return (
		<table style={{ width: "100%", borderCollapse: "collapse" }}>
			<thead>
				<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
					{["Name", "Steps", "Success", "Total"].map((h) => (
						<th key={h} style={{
							textAlign: "left",
							padding: "var(--space-sm)",
							fontSize: "var(--font-size-xs)",
							color: "var(--color-muted)",
							fontWeight: 500,
						}}>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{entries.map((v) => {
					const rateColor = v.successRate >= 0.8 ? "var(--color-success)"
						: v.successRate >= 0.5 ? "var(--color-warning)"
						: "var(--color-error)";
					return (
						<tr key={v.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
							<td style={{ padding: "var(--space-sm)", color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>
								{v.name}
							</td>
							<td style={{ padding: "var(--space-sm)", color: "var(--color-muted)", fontSize: "var(--font-size-md)" }}>
								{v.steps.length}
							</td>
							<td style={{ padding: "var(--space-sm)", color: rateColor, fontSize: "var(--font-size-md)", fontWeight: 600 }}>
								{(v.successRate * 100).toFixed(0)}%
							</td>
							<td style={{ padding: "var(--space-sm)", color: "var(--color-muted)", fontSize: "var(--font-size-md)" }}>
								{v.successCount + v.failureCount}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
