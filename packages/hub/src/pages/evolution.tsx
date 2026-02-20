/**
 * Evolution page for the Chitragupta Hub.
 *
 * Three sections: Vasana deep dive, Vidhi procedures, and
 * consolidation calendar (GitHub-style activity grid). Shows how
 * the system learns and evolves over time.
 * @module pages/evolution
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";

// ── Types ─────────────────────────────────────────────────────────

/** Full Vasana entry — mirrors backend VasanaLike shape. */
interface VasanaEntry {
	id: string;
	tendency: string;
	description: string;
	strength: number;
	stability: number;
	valence: string;
	sourceSamskaras: string[];
	reinforcementCount: number;
	lastActivated: number;
	predictiveAccuracy: number;
	project: string;
	createdAt: number;
	updatedAt: number;
}

/** Full Vidhi entry — mirrors backend VidhiLike shape. */
interface VidhiEntry {
	id: string;
	project: string;
	name: string;
	learnedFrom: string[];
	confidence: number;
	steps: Array<{ index: number; toolName: string; description: string }>;
	triggers: string[];
	successRate: number;
	successCount: number;
	failureCount: number;
	parameterSchema: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

/** Backend response for GET /api/consolidation/days. */
interface ConsolidationDaysResponse {
	dates: string[];
	count: number;
	total: number;
}

/** Backend response for GET /api/consolidation/days/:date. */
interface ConsolidationDayDetail {
	date: string;
	markdown: string;
}

// ── Constants ─────────────────────────────────────────────────────

const VALENCE_BADGE: Record<string, BadgeVariant> = {
	positive: "success",
	negative: "error",
	neutral: "muted",
};

// ── Component ─────────────────────────────────────────────────────

/** Evolution page — Vasana, Vidhi, and Consolidation Calendar. */
export function Evolution(): preact.JSX.Element {
	const [vasanas, setVasanas] = useState<VasanaEntry[]>([]);
	const [vidhis, setVidhis] = useState<VidhiEntry[]>([]);
	const [calendar, setCalendar] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void Promise.all([
			apiGet<{ vasanas: VasanaEntry[] }>("/api/vasanas").then((d) => setVasanas(d.vasanas ?? [])).catch(() => {}),
			apiGet<{ vidhis: VidhiEntry[] }>("/api/vidhi").then((d) => setVidhis(d.vidhis ?? [])).catch(() => {}),
			apiGet<ConsolidationDaysResponse>("/api/consolidation/days").then((d) => setCalendar(d.dates ?? [])).catch(() => {}),
		]).finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
				<Spinner size="lg" />
			</div>
		);
	}

	const hasData = vasanas.length > 0 || vidhis.length > 0 || calendar.length > 0;
	if (!hasData) {
		return (
			<EmptyState
				icon="\uD83C\uDF31"
				title="No evolution data"
				description="Vasana tendencies, Vidhi procedures, and consolidation data appear as the system learns."
			/>
		);
	}

	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Evolution
			</h1>

			{/* Consolidation Calendar */}
			{calendar.length > 0 && (
				<Section title="Consolidation Calendar">
					<ConsolidationCalendar dates={calendar} />
				</Section>
			)}

			{/* Vasana Deep Dive */}
			{vasanas.length > 0 && (
				<Section title="Vasana Tendencies">
					<VasanaTable entries={vasanas} />
				</Section>
			)}

			{/* Vidhi Procedures */}
			{vidhis.length > 0 && (
				<Section title="Vidhi Procedures">
					<VidhiList entries={vidhis} />
				</Section>
			)}
		</div>
	);
}

// ── Section wrapper ───────────────────────────────────────────────

function Section({ title, children }: { title: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<div style={{
			background: "var(--color-surface)",
			border: "1px solid var(--color-border)",
			borderRadius: "var(--radius-lg)",
			padding: "var(--space-lg)",
			marginBottom: "var(--space-xl)",
		}}>
			<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)", marginBottom: "var(--space-lg)", fontWeight: 500 }}>
				{title}
			</h3>
			{children}
		</div>
	);
}

// ── Vasana Table ──────────────────────────────────────────────────

function VasanaTable({ entries }: { entries: VasanaEntry[] }): preact.JSX.Element {
	const maxStrength = Math.max(...entries.map((e) => e.strength), 1);
	const maxStability = Math.max(...entries.map((e) => e.stability), 1);

	return (
		<table style={{ width: "100%", borderCollapse: "collapse" }}>
			<thead>
				<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
					{["Tendency", "Strength", "Stability", "Valence", "Reinforcements", "Last Active"].map((h) => (
						<th key={h} style={thStyle}>{h}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{entries.map((v) => (
					<tr key={v.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
						<td style={{ ...tdStyle, color: "var(--color-text)", fontWeight: 500 }}>{v.tendency}</td>
						<td style={tdStyle}>
							<MiniBar value={v.strength} max={maxStrength} color="var(--color-accent)" />
						</td>
						<td style={tdStyle}>
							<MiniBar value={v.stability} max={maxStability} color="var(--color-success)" />
						</td>
						<td style={tdStyle}>
							<Badge label={v.valence} variant={VALENCE_BADGE[v.valence] ?? "muted"} />
						</td>
						<td style={tdStyle}>{v.reinforcementCount}</td>
						<td style={{ ...tdStyle, fontSize: "var(--font-size-xs)" }}>{formatEpoch(v.lastActivated)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

// ── Vidhi List ────────────────────────────────────────────────────

function VidhiList({ entries }: { entries: VidhiEntry[] }): preact.JSX.Element {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const toggle = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id));
	}, []);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
			{entries.map((v) => {
				const totalCalls = v.successCount + v.failureCount;
				const rateColor = v.successRate >= 0.8 ? "var(--color-success)"
					: v.successRate >= 0.5 ? "var(--color-warning)"
					: "var(--color-error)";
				const stepDescriptions = v.steps.map((s) => s.description);
				return (
					<div key={v.id}>
						<div
							onClick={() => toggle(v.id)}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-md)",
								padding: "var(--space-md) var(--space-lg)",
								background: expandedId === v.id ? "var(--color-surface-hover)" : "transparent",
								borderRadius: "var(--radius-md)",
								cursor: "pointer",
								border: "1px solid var(--color-border-subtle)",
							}}
						>
							<span style={{ flex: 1, color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>{v.name}</span>
							<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)" }}>{v.steps.length} steps</span>
							<span style={{ color: rateColor, fontSize: "var(--font-size-md)", fontWeight: 600 }}>{(v.successRate * 100).toFixed(0)}%</span>
							<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)" }}>{totalCalls} calls</span>
							<span style={{ color: "var(--color-muted)" }}>{expandedId === v.id ? "\u25B2" : "\u25BC"}</span>
						</div>
						{expandedId === v.id && stepDescriptions.length > 0 && (
							<div style={{ padding: "var(--space-md) var(--space-lg) var(--space-md) var(--space-2xl)" }}>
								{stepDescriptions.map((desc, i) => (
									<div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)", marginBottom: "var(--space-xs)" }}>
										<span style={{ color: "var(--color-accent)", fontSize: "var(--font-size-xs)", fontWeight: 600, minWidth: "20px" }}>{i + 1}.</span>
										<span style={{ color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>{desc}</span>
									</div>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ── Consolidation Calendar ────────────────────────────────────────

/** Consolidation calendar — each date in the array renders as one cell. */
function ConsolidationCalendar({ dates }: { dates: string[] }): preact.JSX.Element {
	const [selectedDay, setSelectedDay] = useState<string | null>(null);
	const [dayDetail, setDayDetail] = useState<ConsolidationDayDetail | null>(null);

	const handleDayClick = useCallback(async (date: string) => {
		if (selectedDay === date) {
			setSelectedDay(null);
			setDayDetail(null);
			return;
		}
		setSelectedDay(date);
		try {
			const data = await apiGet<ConsolidationDayDetail>(`/api/consolidation/days/${date}`);
			setDayDetail(data);
		} catch {
			setDayDetail(null);
		}
	}, [selectedDay]);

	return (
		<div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "var(--space-lg)" }}>
				{dates.map((date) => (
					<div
						key={date}
						onClick={() => void handleDayClick(date)}
						title={date}
						style={{
							width: "14px",
							height: "14px",
							borderRadius: "2px",
							background: "var(--color-accent)",
							cursor: "pointer",
							border: selectedDay === date ? "1px solid var(--color-text)" : "1px solid transparent",
						}}
					/>
				))}
			</div>

			{/* Day detail — rendered as raw markdown text */}
			{selectedDay && dayDetail && (
				<div style={{
					background: "var(--color-surface-alt)",
					borderRadius: "var(--radius-md)",
					padding: "var(--space-lg)",
					border: "1px solid var(--color-border)",
				}}>
					<div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-accent)", fontWeight: 600, marginBottom: "var(--space-md)" }}>
						{selectedDay}
					</div>
					<pre style={{ fontSize: "var(--font-size-md)", color: "var(--color-text)", whiteSpace: "pre-wrap", margin: 0 }}>
						{dayDetail.markdown}
					</pre>
				</div>
			)}
		</div>
	);
}

// ── Shared helpers ────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }): preact.JSX.Element {
	const pct = max > 0 ? (value / max) * 100 : 0;
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
			<div style={{ width: "60px", height: "6px", background: "var(--color-border)", borderRadius: "3px", overflow: "hidden" }}>
				<div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "3px" }} />
			</div>
			<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>{value.toFixed(2)}</span>
		</div>
	);
}

const thStyle: preact.JSX.CSSProperties = {
	textAlign: "left",
	padding: "var(--space-sm) var(--space-md)",
	fontSize: "var(--font-size-xs)",
	color: "var(--color-muted)",
	fontWeight: 500,
};

const tdStyle: preact.JSX.CSSProperties = {
	padding: "var(--space-sm) var(--space-md)",
	color: "var(--color-muted)",
	fontSize: "var(--font-size-md)",
};

/** Format an epoch-ms timestamp into a short locale string. */
function formatEpoch(epochMs: number): string {
	try {
		return new Date(epochMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	} catch { return String(epochMs); }
}
