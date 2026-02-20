/**
 * Collaboration page for the Chitragupta Hub.
 *
 * Four-tab layout: Samiti Channels, Sabha Deliberations, Lokapala
 * Guardians, and Akasha Traces. Surfaces multi-agent collaboration
 * and collective knowledge systems.
 * @module pages/collaboration
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";
import { Tabs, createTabSignal, type TabDef } from "../components/tabs.js";

// ── Types ─────────────────────────────────────────────────────────

/** Samiti channel summary returned by GET /api/samiti/channels. */
interface SamitiChannel {
	name: string;
	description: string;
	maxHistory: number;
	subscribers: string[];
	messageCount: number;
	createdAt: number;
}

/** Sabha deliberation summary returned by GET /api/sabha/deliberations. */
interface SabhaDeliberation {
	id: string;
	topic: string;
	status: "active" | "concluded" | "deadlocked";
	convener: string;
	participantCount: number;
	roundCount: number;
	finalVerdict: string | null;
	createdAt: number;
	concludedAt: number | null;
}

/** Single round within a full Sabha session (GET /api/sabha/deliberations/:id). */
interface SabhaRound {
	roundNumber: number;
	proposal: Record<string, string>;
	challenges: unknown[];
	votes: unknown[];
	verdict: string | null;
}

/** Full Sabha detail returned by GET /api/sabha/deliberations/:id (spreads SabhaLike + explanation). */
interface SabhaDetail {
	id: string; topic: string; status: string; convener: string;
	participants: Array<{ id: string; role: string; expertise: number; credibility: number }>;
	rounds: SabhaRound[];
	finalVerdict: string | null;
	createdAt: number; concludedAt: number | null;
	explanation?: string;
}

/** Lokapala guardian stats returned by GET /api/lokapala/guardians. */
interface LokapalaGuardian {
	domain: string;
	scansCompleted: number;
	findingsTotal: number;
	findingsBySeverity: Record<string, number>;
	autoFixesApplied: number;
	lastScanAt: number;
	avgScanDurationMs: number;
}

/** Finding returned by GET /api/lokapala/violations (full FindingLike). */
interface LokapalaViolation {
	id: string;
	guardianId: string;
	domain: string;
	severity: string;
	title: string;
	description: string;
	location?: string;
	suggestion?: string;
	confidence: number;
	autoFixable: boolean;
	timestamp: number;
}

/** Stigmergic trace returned by GET /api/akasha/traces. */
interface AkashaTrace {
	id: string;
	agentId: string;
	traceType: string;
	topic: string;
	content: string;
	strength: number;
	reinforcements: number;
	metadata: Record<string, unknown>;
	createdAt: number;
	lastReinforcedAt: number;
}

/** Stats returned by GET /api/akasha/stats. */
interface AkashaStats {
	totalTraces: number;
	activeTraces: number;
	byType: Record<string, number>;
	avgStrength: number;
	strongestTopic: string | null;
	totalReinforcements: number;
}

// ── Constants ─────────────────────────────────────────────────────

const TABS: TabDef[] = [
	{ key: "samiti", label: "Samiti Channels" },
	{ key: "sabha", label: "Sabha Deliberations" },
	{ key: "lokapala", label: "Lokapala Guardians" },
	{ key: "akasha", label: "Akasha Traces" },
];

const activeTab = createTabSignal("samiti");

const STATUS_BADGE: Record<string, BadgeVariant> = {
	active: "accent",
	concluded: "success",
	deadlocked: "warning",
};

const SEVERITY_BADGE: Record<string, BadgeVariant> = {
	critical: "error",
	high: "warning",
	medium: "accent",
	low: "muted",
};

const DOMAIN_ICONS: Record<string, string> = {
	security: "\uD83D\uDD12",
	performance: "\u26A1",
	correctness: "\u2713",
};

// ── Component ─────────────────────────────────────────────────────

/** Collaboration page with four tabbed sub-views. */
export function Collaboration(): preact.JSX.Element {
	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Collaboration
			</h1>
			<Tabs tabs={TABS} activeKey={activeTab}>
				{activeTab.value === "samiti" && <SamitiTab />}
				{activeTab.value === "sabha" && <SabhaTab />}
				{activeTab.value === "lokapala" && <LokapalaTab />}
				{activeTab.value === "akasha" && <AkashaTab />}
			</Tabs>
		</div>
	);
}

// ── Samiti Tab ────────────────────────────────────────────────────

function SamitiTab(): preact.JSX.Element {
	const [channels, setChannels] = useState<SamitiChannel[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void apiGet<{ channels: SamitiChannel[] }>("/api/samiti/channels")
			.then((d) => setChannels(d.channels ?? []))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	if (loading) return <LoadingSpinner />;
	if (channels.length === 0) return <EmptyState icon="\uD83D\uDCE2" title="No channels" description="Samiti channels appear when agents establish communication." />;

	return (
		<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-lg)" }}>
			{channels.map((ch) => (
				<div key={ch.name} style={{
					background: "var(--color-surface)",
					border: "1px solid var(--color-border)",
					borderRadius: "var(--radius-lg)",
					padding: "var(--space-lg)",
				}}>
					<div style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600, marginBottom: "var(--space-sm)" }}>
						{ch.name}
					</div>
					<div style={{ display: "flex", gap: "var(--space-xl)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
						<span>{ch.subscribers.length} subscribers</span>
						<span>{ch.messageCount} messages</span>
					</div>
				</div>
			))}
		</div>
	);
}

// ── Sabha Tab ─────────────────────────────────────────────────────

function SabhaTab(): preact.JSX.Element {
	const [deliberations, setDeliberations] = useState<SabhaDeliberation[]>([]);
	const [loading, setLoading] = useState(true);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [rounds, setRounds] = useState<SabhaRound[]>([]);

	useEffect(() => {
		void apiGet<{ deliberations: SabhaDeliberation[] }>("/api/sabha/deliberations")
			.then((d) => setDeliberations(d.deliberations ?? []))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const handleExpand = useCallback(async (id: string) => {
		if (expandedId === id) {
			setExpandedId(null);
			setRounds([]);
			return;
		}
		setExpandedId(id);
		try {
			const data = await apiGet<SabhaDetail>(`/api/sabha/deliberations/${id}`);
			setRounds(data.rounds ?? []);
		} catch {
			setRounds([]);
		}
	}, [expandedId]);

	if (loading) return <LoadingSpinner />;
	if (deliberations.length === 0) return <EmptyState icon="\uD83D\uDDE3" title="No deliberations" description="Sabha deliberations appear when agents engage in group reasoning." />;

	return (
		<div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
			<table style={{ width: "100%", borderCollapse: "collapse" }}>
				<thead>
					<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
						{["Topic", "Rounds", "Status", "Verdict"].map((h) => (
							<th key={h} style={thStyle}>{h}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{deliberations.map((d) => (
						<>
							<tr
								key={d.id}
								onClick={() => void handleExpand(d.id)}
								style={{ borderBottom: "1px solid var(--color-border-subtle)", cursor: "pointer" }}
							>
								<td style={{ ...tdStyle, color: "var(--color-text)" }}>{d.topic}</td>
								<td style={tdStyle}>{d.roundCount}</td>
								<td style={tdStyle}><Badge label={d.status} variant={STATUS_BADGE[d.status] ?? "muted"} /></td>
								<td style={tdStyle}>{d.finalVerdict ?? "-"}</td>
							</tr>
							{expandedId === d.id && rounds.length > 0 && (
								<tr key={`${d.id}-exp`}>
									<td colSpan={4} style={{ padding: 0 }}>
										<div style={{ background: "var(--color-surface-alt)", padding: "var(--space-lg)" }}>
											{rounds.map((r) => (
												<div key={r.roundNumber} style={{ marginBottom: "var(--space-sm)", fontSize: "var(--font-size-md)" }}>
													<span style={{ color: "var(--color-accent)", fontWeight: 600 }}>R{r.roundNumber}</span>
													{Object.entries(r.proposal).map(([speaker, argument]) => (
														<div key={speaker} style={{ marginLeft: "var(--space-lg)", marginTop: "var(--space-xs)" }}>
															<span style={{ color: "var(--color-muted)", fontWeight: 500 }}>{speaker}:</span>
															<span style={{ color: "var(--color-text)", marginLeft: "var(--space-sm)" }}>{argument}</span>
														</div>
													))}
													{r.verdict && <div style={{ color: "var(--color-success)", marginLeft: "var(--space-lg)", marginTop: "var(--space-xs)" }}>Verdict: {r.verdict}</div>}
												</div>
											))}
										</div>
									</td>
								</tr>
							)}
						</>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ── Lokapala Tab ──────────────────────────────────────────────────

function LokapalaTab(): preact.JSX.Element {
	const [guardians, setGuardians] = useState<LokapalaGuardian[]>([]);
	const [violations, setViolations] = useState<LokapalaViolation[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void Promise.all([
			apiGet<{ guardians: LokapalaGuardian[] }>("/api/lokapala/guardians").then((d) => setGuardians(d.guardians ?? [])).catch(() => {}),
			apiGet<{ violations: LokapalaViolation[] }>("/api/lokapala/violations").then((d) => setViolations(d.violations ?? [])).catch(() => {}),
		]).finally(() => setLoading(false));
	}, []);

	if (loading) return <LoadingSpinner />;
	if (guardians.length === 0 && violations.length === 0) return <EmptyState icon="\uD83D\uDEE1" title="No guardian data" description="Lokapala guardians appear when domain watchdogs are active." />;

	return (
		<div>
			{/* Domain cards */}
			{guardians.length > 0 && (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
					{guardians.map((g) => (
						<div key={g.domain} style={{
							background: "var(--color-surface)",
							border: "1px solid var(--color-border)",
							borderRadius: "var(--radius-lg)",
							padding: "var(--space-lg)",
						}}>
							<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
								<span style={{ fontSize: "20px" }}>{DOMAIN_ICONS[g.domain] ?? "\uD83D\uDEE1"}</span>
								<span style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600, textTransform: "capitalize" }}>{g.domain}</span>
							</div>
							<div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
								{(g.findingsBySeverity["critical"] ?? 0) > 0 && <Badge label={`${g.findingsBySeverity["critical"]} critical`} variant="error" />}
								{(g.findingsBySeverity["high"] ?? 0) > 0 && <Badge label={`${g.findingsBySeverity["high"]} high`} variant="warning" />}
								{(g.findingsBySeverity["medium"] ?? 0) > 0 && <Badge label={`${g.findingsBySeverity["medium"]} medium`} variant="accent" />}
								{(g.findingsBySeverity["low"] ?? 0) > 0 && <Badge label={`${g.findingsBySeverity["low"]} low`} variant="muted" />}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Violations log */}
			{violations.length > 0 && (
				<div>
					<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)", marginBottom: "var(--space-md)" }}>
						Recent Violations
					</h3>
					<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
						{violations.slice(0, 20).map((v) => (
							<div key={v.id} style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-md)",
								padding: "var(--space-sm) var(--space-lg)",
								background: "var(--color-surface)",
								borderRadius: "var(--radius-md)",
								border: "1px solid var(--color-border)",
							}}>
								<Badge label={v.severity} variant={SEVERITY_BADGE[v.severity] ?? "muted"} />
								<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)", textTransform: "capitalize" }}>{v.domain}</span>
								<span style={{ flex: 1, color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>{v.title}{v.title && v.description ? " \u2014 " : ""}{v.description}</span>
								<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)", whiteSpace: "nowrap" }}>{formatTimestamp(v.timestamp)}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Akasha Tab ────────────────────────────────────────────────────

function AkashaTab(): preact.JSX.Element {
	const [traces, setTraces] = useState<AkashaTrace[]>([]);
	const [stats, setStats] = useState<AkashaStats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void Promise.all([
			apiGet<{ traces: AkashaTrace[] }>("/api/akasha/traces").then((d) => setTraces(d.traces ?? [])).catch(() => {}),
			apiGet<AkashaStats>("/api/akasha/stats").then(setStats).catch(() => {}),
		]).finally(() => setLoading(false));
	}, []);

	if (loading) return <LoadingSpinner />;
	if (traces.length === 0) return <EmptyState icon="\u2728" title="No traces" description="Akasha traces appear when collective knowledge accumulates." />;

	return (
		<div>
			{/* Stats summary */}
			{stats && (
				<div style={{ display: "flex", gap: "var(--space-xl)", marginBottom: "var(--space-xl)", flexWrap: "wrap" }}>
					<SummaryCard label="Total Traces" value={String(stats.totalTraces)} />
					<SummaryCard label="Active" value={String(stats.activeTraces)} color="var(--color-success)" />
					<SummaryCard label="Avg Strength" value={`${Math.round(stats.avgStrength * 100)}%`} />
					{stats.strongestTopic && <SummaryCard label="Strongest Topic" value={stats.strongestTopic} color="var(--color-accent)" />}
				</div>
			)}

			{/* Trace list */}
			<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
				{traces.map((t) => {
					const strengthPct = Math.round(t.strength * 100);
					return (
						<div key={t.id} style={{
							background: "var(--color-surface)",
							border: "1px solid var(--color-border)",
							borderRadius: "var(--radius-lg)",
							padding: "var(--space-md) var(--space-lg)",
						}}>
							<div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginBottom: "var(--space-sm)" }}>
								<Badge label={t.traceType} variant="accent" />
								<span style={{ flex: 1, color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>{t.topic}</span>
								<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)" }}>{formatTimestamp(t.createdAt)}</span>
							</div>
							{/* Strength decay bar */}
							<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
								<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", width: "32px" }}>{strengthPct}%</span>
								<div style={{ flex: 1, height: "4px", background: "var(--color-border)", borderRadius: "2px", overflow: "hidden" }}>
									<div style={{
										height: "100%",
										width: `${strengthPct}%`,
										background: strengthPct > 70 ? "var(--color-success)" : strengthPct > 30 ? "var(--color-warning)" : "var(--color-error)",
										borderRadius: "2px",
									}} />
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Shared helpers ────────────────────────────────────────────────

function LoadingSpinner(): preact.JSX.Element {
	return (
		<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
			<Spinner size="lg" />
		</div>
	);
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }): preact.JSX.Element {
	return (
		<div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-lg)", minWidth: "120px" }}>
			<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginBottom: "var(--space-xs)" }}>{label}</div>
			<div style={{ fontSize: "var(--font-size-xl)", fontWeight: "bold", color: color ?? "var(--color-text)" }}>{value}</div>
		</div>
	);
}

const thStyle: preact.JSX.CSSProperties = { textAlign: "left", padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-xs)", color: "var(--color-muted)", fontWeight: 500 };
const tdStyle: preact.JSX.CSSProperties = { padding: "var(--space-sm) var(--space-md)", color: "var(--color-muted)", fontSize: "var(--font-size-md)" };

/** Format an epoch-ms timestamp into a short locale string. */
function formatTimestamp(epochMs: number): string {
	try {
		return new Date(epochMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	} catch { return String(epochMs); }
}
