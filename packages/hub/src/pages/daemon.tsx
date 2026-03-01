/**
 * Daemon monitoring page for the Chitragupta Hub.
 *
 * Read-only dashboard showing daemon health, nidra state,
 * memory pipeline DB counts, triguna gauge, and circuit
 * breaker state. Auto-refreshes every 5 seconds.
 *
 * Consumes `GET /api/daemon/status` — the same endpoint
 * used by the macOS menubar app.
 * @module pages/daemon
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { StatCard } from "../components/stat-card.js";
import { Badge, type BadgeVariant } from "../components/badge.js";
import type { TrigunaData } from "../signals/cognitive.js";
import { TrigunaChart } from "../components/triguna-chart.js";

// ── Types ─────────────────────────────────────────────────────────

interface DaemonInfo {
	alive: boolean;
	pid: number | null;
	uptime: number | null;
	memory: number | null;
	connections: number | null;
	methods: number | null;
}

interface NidraInfo {
	state: string;
	consolidationProgress?: number;
	lastConsolidationEnd?: number;
}

interface DbCounts {
	turns: number;
	sessions: number;
	rules: number;
	vidhis: number;
	samskaras: number;
	vasanas: number;
	akashaTraces: number;
}

interface CircuitInfo {
	state: string;
	consecutiveFailures: number;
	mode: string;
}

interface DaemonStatus {
	daemon: DaemonInfo;
	nidra: NidraInfo | null;
	db: DbCounts | null;
	circuit: CircuitInfo | null;
	triguna: TrigunaData | null;
	timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────

const POLL_MS = 5_000;

// ── Component ─────────────────────────────────────────────────────

/** Daemon monitoring page — read-only, auto-refreshing. */
export function Daemon(): preact.JSX.Element {
	const [status, setStatus] = useState<DaemonStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = async (): Promise<void> => {
		try {
			const res = await apiGet<{ data: DaemonStatus }>("/api/daemon/status");
			setStatus(res.data);
			setError(null);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void fetchData();
		timer.current = setInterval(() => { void fetchData(); }, POLL_MS);
		return () => { if (timer.current) clearInterval(timer.current); };
	}, []);

	if (loading) return <Spinner size="lg" />;

	if (error && !status) {
		return (
			<div style={{ padding: "var(--space-xl)", color: "var(--color-error)" }}>
				Failed to load daemon status: {error}
			</div>
		);
	}

	if (!status) return <div style={{ padding: "var(--space-xl)" }}>No data</div>;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
			<PageHeader alive={status.daemon.alive} />
			<StatCardsGrid daemon={status.daemon} circuit={status.circuit} />
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-lg)" }}>
				<NidraSection nidra={status.nidra} />
				<CircuitSection circuit={status.circuit} />
			</div>
			<PipelineSection db={status.db} />
			{status.triguna && <TrigunaSection triguna={status.triguna} />}
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────

function PageHeader({ alive }: { alive: boolean }): preact.JSX.Element {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
			<h1 style={{ fontSize: "var(--font-size-xl)", margin: 0 }}>Daemon Monitor</h1>
			<Badge label={alive ? "Online" : "Offline"} variant={alive ? "success" : "error"} />
			<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginLeft: "auto" }}>
				Auto-refreshes every 5s
			</span>
		</div>
	);
}

function StatCardsGrid({ daemon, circuit }: {
	daemon: DaemonInfo;
	circuit: CircuitInfo | null;
}): preact.JSX.Element {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--space-md)" }}>
			<StatCard title="PID" value={daemon.pid ?? "—"} />
			<StatCard title="Uptime" value={daemon.uptime != null ? formatUptime(daemon.uptime) : "—"} />
			<StatCard title="Memory" value={daemon.memory != null ? formatBytes(daemon.memory) : "—"} />
			<StatCard title="Connections" value={daemon.connections ?? "—"} />
			<StatCard title="Methods" value={daemon.methods ?? "—"} />
			<StatCard title="Circuit" value={circuit?.state ?? "HEALTHY"} />
		</div>
	);
}

function NidraSection({ nidra }: { nidra: NidraInfo | null }): preact.JSX.Element {
	return (
		<Card title="Nidra (Consolidation)">
			{nidra ? (
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
						<Badge label={nidra.state} variant={nidraVariant(nidra.state)} />
					</div>
					{nidra.consolidationProgress != null && (
						<div>
							<div style={{
								height: "6px", borderRadius: "3px",
								background: "var(--color-border)", overflow: "hidden",
							}}>
								<div style={{
									height: "100%", borderRadius: "3px",
									background: "var(--color-accent)",
									width: `${Math.min(100, nidra.consolidationProgress)}%`,
									transition: "width 0.3s ease",
								}} />
							</div>
							<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
								{nidra.consolidationProgress.toFixed(0)}%
							</span>
						</div>
					)}
					<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
						Last: {formatRelativeTime(nidra.lastConsolidationEnd)}
					</span>
				</div>
			) : (
				<span style={{ color: "var(--color-muted)" }}>Unavailable</span>
			)}
		</Card>
	);
}

function CircuitSection({ circuit }: { circuit: CircuitInfo | null }): preact.JSX.Element {
	return (
		<Card title="Circuit Breaker">
			{circuit ? (
				<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
						<Badge
							label={circuit.state}
							variant={circuit.state === "CLOSED" ? "success" : "error"}
						/>
						<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
							{circuit.consecutiveFailures} failures
						</span>
					</div>
					<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
						Mode: {circuit.mode}
					</span>
				</div>
			) : (
				<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
					<Badge label="HEALTHY" variant="success" />
					<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
						0 failures
					</span>
				</div>
			)}
		</Card>
	);
}

function PipelineSection({ db }: { db: DbCounts | null }): preact.JSX.Element {
	if (!db) {
		return (
			<Card title="Memory Pipeline">
				<span style={{ color: "var(--color-muted)" }}>No data available</span>
			</Card>
		);
	}

	const counts = [
		{ label: "Turns", value: db.turns },
		{ label: "Sessions", value: db.sessions },
		{ label: "Rules", value: db.rules },
		{ label: "Vidhis", value: db.vidhis },
		{ label: "Samskaras", value: db.samskaras },
		{ label: "Vasanas", value: db.vasanas },
		{ label: "Akasha Traces", value: db.akashaTraces },
	];

	const hasIssue = db.turns === 0 || db.rules === 0;

	return (
		<Card title="Memory Pipeline">
			<div style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
				gap: "var(--space-md)",
			}}>
				{counts.map((c) => (
					<div
						key={c.label}
						style={{
							padding: "var(--space-sm) var(--space-md)",
							borderRadius: "6px",
							background: c.value === 0 ? "rgba(239,68,68,0.1)" : "var(--color-sidebar)",
							border: `1px solid ${c.value === 0 ? "var(--color-error)" : "var(--color-border)"}`,
							textAlign: "center",
						}}
					>
						<div style={{
							fontSize: "var(--font-size-xl)",
							fontWeight: 600,
							fontFamily: "var(--font-mono)",
							color: c.value === 0 ? "var(--color-error)" : "var(--color-text)",
						}}>
							{c.value}
						</div>
						<div style={{
							fontSize: "var(--font-size-xs)",
							color: "var(--color-muted)",
							marginTop: "2px",
						}}>
							{c.label}
						</div>
					</div>
				))}
			</div>
			{hasIssue && (
				<div style={{
					marginTop: "var(--space-md)",
					padding: "var(--space-sm) var(--space-md)",
					borderRadius: "6px",
					background: "rgba(234,179,8,0.1)",
					border: "1px solid var(--color-warning)",
					fontSize: "var(--font-size-sm)",
					color: "var(--color-warning)",
				}}>
					Pipeline needs attention — turns or rules are at zero
				</div>
			)}
		</Card>
	);
}

function TrigunaSection({ triguna }: { triguna: TrigunaData }): preact.JSX.Element {
	return (
		<Card title="Triguna Health">
			<div style={{ display: "flex", justifyContent: "center" }}>
				<TrigunaChart data={triguna} size={220} />
			</div>
		</Card>
	);
}

// ── Shared card wrapper ───────────────────────────────────────────

function Card({ title, children }: {
	title: string;
	children: preact.ComponentChildren;
}): preact.JSX.Element {
	return (
		<div style={{
			background: "#16161e",
			borderRadius: "8px",
			border: "1px solid #2a2a3a",
			padding: "var(--space-lg)",
		}}>
			<h3 style={{
				fontSize: "var(--font-size-sm)",
				color: "var(--color-muted)",
				textTransform: "uppercase",
				letterSpacing: "0.5px",
				margin: "0 0 var(--space-md) 0",
				fontWeight: 600,
			}}>
				{title}
			</h3>
			{children}
		</div>
	);
}

// ── Formatters ────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	return `${mins}m`;
}

function formatBytes(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
	return `${mb.toFixed(0)}MB`;
}

function formatRelativeTime(epochMs?: number): string {
	if (!epochMs) return "Never";
	const elapsed = (Date.now() - epochMs) / 1000;
	if (elapsed < 60) return "Just now";
	if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
	if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
	return `${Math.floor(elapsed / 86400)}d ago`;
}

function nidraVariant(state: string): "success" | "accent" | "warning" | "error" | "muted" {
	switch (state.toLowerCase()) {
		case "awake": return "success";
		case "dreaming":
		case "consolidating": return "accent";
		case "sleeping": return "muted";
		default: return "warning";
	}
}
