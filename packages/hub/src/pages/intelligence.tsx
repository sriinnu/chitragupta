/**
 * Intelligence page — Turiya Routing, Rta Audit, Buddhi Decisions.
 * @module pages/intelligence
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";
import { Tabs, createTabSignal, type TabDef } from "../components/tabs.js";
import {
	turiyaBudgetState,
	turiyaPreference,
	fetchTuriyaBudgetState,
	setTuriyaPreference,
	type TuriyaBudgetState,
} from "../signals/cognitive.js";

// ── Types ─────────────────────────────────────────────────────────

interface TuriyaTier {
	tier: string;
	calls: number;
	callPercent: number;
	totalCost: number;
	averageReward: number;
}

interface TuriyaRouting {
	totalRequests: number;
	tiers: TuriyaTier[];
	costSummary: { totalCost: number; opusBaseline: number; savings: number; savingsPercent: number };
}

interface RtaRule {
	id: string;
	name: string;
	description: string;
	severity: "critical" | "high" | "medium" | "low";
	status: string;
	violationCount: number;
	checkCount: number;
}

interface RtaAuditEntry {
	toolName: string;
	allowed: boolean;
	ruleId: string;
	timestamp: number;
	reason?: string;
	sessionId?: string;
}

interface BuddhiDecision {
	id: string;
	category: string;
	description: string;
	confidence: number;
}

interface NyayaReasoning {
	pratijña: string;
	hetu: string;
	udaharana: string;
	upanaya: string;
	nigamana: string;
}

// ── Constants ─────────────────────────────────────────────────────

const TABS: TabDef[] = [
	{ key: "turiya", label: "Turiya Routing" },
	{ key: "rta", label: "Rta Audit" },
	{ key: "buddhi", label: "Buddhi Decisions" },
];

const activeTab = createTabSignal("turiya");

const SEVERITY_BADGE: Record<string, BadgeVariant> = {
	critical: "error", high: "warning", medium: "accent", low: "muted",
};

// ── Component ─────────────────────────────────────────────────────

export function Intelligence(): preact.JSX.Element {
	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Intelligence
			</h1>
			<Tabs tabs={TABS} activeKey={activeTab}>
				{activeTab.value === "turiya" && <TuriyaTab />}
				{activeTab.value === "rta" && <RtaTab />}
				{activeTab.value === "buddhi" && <BuddhiTab />}
			</Tabs>
		</div>
	);
}

// ── Turiya Tab ────────────────────────────────────────────────────

function TuriyaTab(): preact.JSX.Element {
	const [data, setData] = useState<TuriyaRouting | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void Promise.all([
			apiGet<TuriyaRouting>("/api/turiya/routing").then(setData).catch(() => {}),
			fetchTuriyaBudgetState(),
		]).finally(() => setLoading(false));
	}, []);

	if (loading) return <LoadingSpinner />;
	if (!data || !data.tiers?.length) return <EmptyState icon="\uD83C\uDFAF" title="No routing data" description="Turiya routing data will appear once the router is active." />;

	const cs = data.costSummary;
	const budget = turiyaBudgetState.value;
	return (
		<div>
			{/* Summary cards */}
			<div style={{ display: "flex", gap: "var(--space-xl)", marginBottom: "var(--space-xl)", flexWrap: "wrap" }}>
				<SummaryCard label="Total Calls" value={String(data.totalRequests)} />
				<SummaryCard label="Cost Saved" value={`$${cs.savings.toFixed(2)}`} color="var(--color-success)" />
				<SummaryCard label="Savings" value={`${cs.savingsPercent.toFixed(1)}%`} color="var(--color-success)" />
				{budget && <BudgetLambdaCard budget={budget} />}
			</div>

			{/* Preference slider */}
			<PreferenceSlider />

			{/* Tier table */}
			<div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
				<table style={{ width: "100%", borderCollapse: "collapse" }}>
					<thead>
						<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
							{["Tier", "Calls", "Call %", "Avg Reward", "Cost"].map((h) => (
								<th key={h} style={thStyle}>{h}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{data.tiers.map((tier) => (
							<tr key={tier.tier} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
								<td style={{ ...tdStyle, color: "var(--color-text)", fontWeight: 500 }}>{tier.tier}</td>
								<td style={tdStyle}>{tier.calls}</td>
								<td style={tdStyle}>{tier.callPercent.toFixed(1)}%</td>
								<td style={tdStyle}>{tier.averageReward.toFixed(3)}</td>
								<td style={tdStyle}>${tier.totalCost.toFixed(4)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** Budget lambda indicator card. Shows budget pressure level. */
function BudgetLambdaCard({ budget }: { budget: TuriyaBudgetState }): preact.JSX.Element {
	const pressure = budget.budgetLambda;
	const level = pressure < 0.01 ? "low" : pressure < 0.1 ? "moderate" : "high";
	const color = level === "low" ? "var(--color-success)" : level === "moderate" ? "var(--color-warning)" : "var(--color-error)";
	return (
		<div style={{
			background: "var(--color-surface)", border: "1px solid var(--color-border)",
			borderRadius: "var(--radius-lg)", padding: "var(--space-lg)", minWidth: "140px",
		}}>
			<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginBottom: "var(--space-xs)" }}>
				Budget Pressure
			</div>
			<div style={{ fontSize: "var(--font-size-xl)", fontWeight: "bold", color }}>
				{level}
			</div>
			<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: "2px" }}>
				{"\u03BB"} = {pressure.toFixed(4)} | ${budget.dailySpend.toFixed(2)} spent
			</div>
		</div>
	);
}

/** Cost/quality preference slider. */
function PreferenceSlider(): preact.JSX.Element {
	const pref = turiyaPreference.value;
	return (
		<div style={{
			background: "var(--color-surface)", border: "1px solid var(--color-border)",
			borderRadius: "var(--radius-lg)", padding: "var(--space-lg)", marginBottom: "var(--space-xl)",
		}}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
				<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text)", fontWeight: 500 }}>
					Cost / Quality Preference
				</span>
				<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
					{pref < 0.3 ? "Quality-first" : pref > 0.7 ? "Cost-first" : "Balanced"}
				</span>
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
				<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Quality</span>
				<input
					type="range" min="0" max="1" step="0.05"
					value={pref}
					onInput={(e) => {
						const val = parseFloat((e.target as HTMLInputElement).value);
						void setTuriyaPreference(val);
					}}
					style={{ flex: 1, accentColor: "var(--color-accent)" }}
				/>
				<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Cost</span>
			</div>
		</div>
	);
}

// ── Rta Tab ───────────────────────────────────────────────────────

function RtaTab(): preact.JSX.Element {
	const [rules, setRules] = useState<RtaRule[]>([]);
	const [audit, setAudit] = useState<RtaAuditEntry[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void Promise.all([
			apiGet<{ rules: RtaRule[] }>("/api/rta/rules").then((d) => setRules(d.rules ?? [])).catch(() => {}),
			apiGet<{ entries: RtaAuditEntry[] }>("/api/rta/audit").then((d) => setAudit(d.entries ?? [])).catch(() => {}),
		]).finally(() => setLoading(false));
	}, []);

	if (loading) return <LoadingSpinner />;
	if (rules.length === 0 && audit.length === 0) return <EmptyState icon="\uD83D\uDCDC" title="No rules or audit data" description="Rta rules and audit entries appear once the rule engine is active." />;

	return (
		<div>
			{rules.length > 0 && (
				<div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: "var(--space-xl)" }}>
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
								{["Rule", "Severity", "Violations"].map((h) => (
									<th key={h} style={thStyle}>{h}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rules.map((r) => (
								<tr key={r.name} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
									<td style={{ ...tdStyle, color: "var(--color-text)" }}>{r.name}</td>
									<td style={tdStyle}><Badge label={r.severity} variant={SEVERITY_BADGE[r.severity] ?? "muted"} /></td>
									<td style={tdStyle}>{r.violationCount}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{audit.length > 0 && (
				<div>
					<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)", marginBottom: "var(--space-md)" }}>Audit Log</h3>
					<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
						{audit.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20).map((entry, i) => (
							<div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-sm) var(--space-lg)", background: "var(--color-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
								<Badge label={entry.allowed ? "allowed" : "blocked"} variant={entry.allowed ? "success" : "error"} />
								<span style={{ color: "var(--color-text)", fontSize: "var(--font-size-md)", fontFamily: "monospace" }}>{entry.toolName}</span>
								<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)", flex: 1 }}>{entry.ruleId}</span>
								<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)", whiteSpace: "nowrap" }}>{formatEpoch(entry.timestamp)}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Buddhi Tab ────────────────────────────────────────────────────

function BuddhiTab(): preact.JSX.Element {
	const [decisions, setDecisions] = useState<BuddhiDecision[]>([]);
	const [loading, setLoading] = useState(true);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [reasoning, setReasoning] = useState<NyayaReasoning | null>(null);

	useEffect(() => {
		void apiGet<{ decisions: BuddhiDecision[] }>("/api/decisions")
			.then((d) => setDecisions(d.decisions ?? []))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const handleExpand = useCallback(async (id: string) => {
		if (expandedId === id) { setExpandedId(null); setReasoning(null); return; }
		setExpandedId(id);
		setReasoning(null);
		try {
			const data = await apiGet<{ reasoning: NyayaReasoning }>(`/api/decisions/${id}/reasoning`);
			setReasoning(data.reasoning);
		} catch { /* best-effort */ }
	}, [expandedId]);

	if (loading) return <LoadingSpinner />;
	if (decisions.length === 0) return <EmptyState icon="\uD83E\uDDE0" title="No decisions recorded" description="Buddhi decisions appear once the reasoning engine makes choices." />;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
			{decisions.map((d) => (
				<div key={d.id}>
					<div onClick={() => void handleExpand(d.id)} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-md) var(--space-lg)", cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
						<Badge label={d.category} variant="accent" />
						<span style={{ flex: 1, color: "var(--color-text)", fontSize: "var(--font-size-md)" }}>{d.description}</span>
						<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>{(d.confidence * 100).toFixed(0)}%</span>
						<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>{expandedId === d.id ? "\u25B2" : "\u25BC"}</span>
					</div>
					{expandedId === d.id && reasoning && <NyayaPanel reasoning={reasoning} />}
				</div>
			))}
		</div>
	);
}

function NyayaPanel({ reasoning }: { reasoning: NyayaReasoning }): preact.JSX.Element {
	const limbs: Array<{ label: string; key: keyof NyayaReasoning }> = [
		{ label: "Pratijna (Thesis)", key: "pratijña" },
		{ label: "Hetu (Reason)", key: "hetu" },
		{ label: "Udaharana (Example)", key: "udaharana" },
		{ label: "Upanaya (Application)", key: "upanaya" },
		{ label: "Nigamana (Conclusion)", key: "nigamana" },
	];
	return (
		<div style={{ background: "var(--color-surface-alt)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", border: "1px solid var(--color-border)", borderTop: "none", padding: "var(--space-lg)" }}>
			{limbs.map((limb) => (
				<div key={limb.key} style={{ marginBottom: "var(--space-md)" }}>
					<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-accent)", fontWeight: 600, marginBottom: "2px" }}>{limb.label}</div>
					<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-text)", lineHeight: 1.5 }}>{reasoning[limb.key]}</div>
				</div>
			))}
		</div>
	);
}

// ── Shared helpers ────────────────────────────────────────────────

function LoadingSpinner(): preact.JSX.Element {
	return <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}><Spinner size="lg" /></div>;
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

function formatEpoch(ts: number): string {
	try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
	catch { return String(ts); }
}
