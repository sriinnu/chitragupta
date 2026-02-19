/**
 * Dashboard overview page for the Chitragupta Hub.
 *
 * Displays a grid of metric cards (session cost, daily cost, monthly
 * cost, active sessions), a cost trend sparkline, a health status
 * section, and a list of recent sessions.
 * @module pages/overview
 */

import { useEffect, useState } from "preact/hooks";
import { StatCard } from "../components/stat-card.js";
import { BarChart } from "../components/chart.js";
import { apiGet } from "../api.js";
import {
	budgetStatus,
	budgetHistory,
	fetchBudgetStatus,
	fetchBudgetHistory,
} from "../signals/budget.js";
import { Welcome } from "../components/welcome.js";

// ── Types ─────────────────────────────────────────────────────────

/** Health check result for a single check from /api/health/deep. */
interface HealthCheckResult {
	status: "UP" | "DOWN" | "DEGRADED";
	message?: string;
	duration?: number;
}

/** Deep health response from the API (HealthReport shape). */
interface DeepHealth {
	status: string;
	timestamp: string;
	version: string;
	uptime: number;
	checks: Record<string, HealthCheckResult>;
}

/** Wrapped sessions list response from the API. */
interface SessionsResponse {
	sessions: SessionSummary[];
}

/** Session summary returned by the sessions list endpoint. */
interface SessionSummary {
	id: string;
	title: string;
	provider: string;
	model: string;
	cost: number;
	turnCount: number;
	createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Health status to colour mapping (matches HealthStatus enum from core). */
const HEALTH_COLORS: Record<string, string> = {
	UP: "#22c55e",
	DEGRADED: "#eab308",
	DOWN: "#ef4444",
};

/** Format a date string to a short local representation. */
function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Dashboard home page.
 *
 * Fetches budget status, budget history, health, and recent sessions
 * on mount. Renders a responsive grid of StatCards, a bar chart of
 * daily costs, a health section, and a recent sessions table.
 */
export function Overview(): preact.JSX.Element {
	const [health, setHealth] = useState<DeepHealth | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);

	useEffect(() => {
		void fetchBudgetStatus();
		void fetchBudgetHistory();
		void apiGet<DeepHealth>("/api/health/deep").then(setHealth).catch(() => {});
		void apiGet<SessionsResponse>("/api/sessions?limit=5")
			.then((data) => setSessions(data.sessions ?? []))
			.catch(() => {});
	}, []);

	const budget = budgetStatus.value;
	const history = budgetHistory.value;
	const costData = history.map((d) => d.cost);

	return (
		<div>
			<Welcome />
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "20px" }}>
				Overview
			</h1>

			{/* ── Metric cards ──────────────────────────────────── */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
					gap: "16px",
					marginBottom: "28px",
				}}
			>
				<StatCard
					title="Session Cost"
					value={`$${(budget?.sessionCost ?? 0).toFixed(4)}`}
					trend={budget && budget.sessionCost > 0 ? "up" : "flat"}
					sparklineData={costData}
				/>
				<StatCard
					title="Daily Cost"
					value={`$${(budget?.dailyCost ?? 0).toFixed(4)}`}
					subtitle={budget ? `Limit: $${budget.dailyLimit.toFixed(2)}` : undefined}
					trend="flat"
					sparklineData={costData.slice(-7)}
				/>
				<StatCard
					title="Session Warning"
					value={budget?.sessionWarning ? "Warning" : "OK"}
					trend={budget?.sessionWarning ? "up" : "flat"}
				/>
				<StatCard
					title="Can Proceed"
					value={budget?.canProceed?.allowed ? "Yes" : "No"}
					trend={budget?.canProceed?.allowed === false ? "up" : "flat"}
				/>
			</div>

			{/* ── Cost history bar chart ────────────────────────── */}
			{history.length > 0 && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						padding: "16px",
						marginBottom: "28px",
					}}
				>
					<h3 style={{ fontSize: "14px", color: "#8888a0", marginBottom: "12px" }}>
						Daily Cost Trend
					</h3>
					<BarChart
						data={history.slice(-14).map((d) => ({
							label: d.date.slice(5),
							value: d.cost,
						}))}
						width={600}
						height={120}
					/>
				</div>
			)}

			{/* ── Health status ──────────────────────────────────── */}
			{health && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						padding: "16px",
						marginBottom: "28px",
					}}
				>
					<h3 style={{ fontSize: "14px", color: "#8888a0", marginBottom: "12px" }}>
						System Health
					</h3>
					<div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
						{Object.entries(health.checks).map(([name, c]) => (
							<div
								key={name}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "6px",
									fontSize: "13px",
								}}
							>
								<span
									style={{
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										background: HEALTH_COLORS[c.status] ?? "#8888a0",
										display: "inline-block",
									}}
								/>
								<span style={{ color: "#e8e8ed" }}>{name}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* ── Recent sessions ────────────────────────────────── */}
			<div
				style={{
					background: "#16161e",
					borderRadius: "8px",
					border: "1px solid #2a2a3a",
					padding: "16px",
				}}
			>
				<h3 style={{ fontSize: "14px", color: "#8888a0", marginBottom: "12px" }}>
					Recent Sessions
				</h3>
				{sessions.length === 0 ? (
					<div style={{ color: "#8888a0", fontSize: "13px" }}>No sessions yet.</div>
				) : (
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid #2a2a3a" }}>
								{["Title", "Provider", "Model", "Cost", "Date"].map((h) => (
									<th
										key={h}
										style={{
											textAlign: "left",
											padding: "6px 8px",
											fontSize: "11px",
											color: "#8888a0",
											fontWeight: 500,
										}}
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sessions.map((s) => (
								<tr key={s.id} style={{ borderBottom: "1px solid #1e1e2a" }}>
									<td style={{ padding: "8px", color: "#e8e8ed", fontSize: "13px" }}>
										{s.title || s.id.slice(0, 8)}
									</td>
									<td style={{ padding: "8px", color: "#8888a0", fontSize: "13px" }}>
										{s.provider}
									</td>
									<td style={{ padding: "8px", color: "#8888a0", fontSize: "13px" }}>
										{s.model}
									</td>
									<td style={{ padding: "8px", color: "#e8e8ed", fontSize: "13px" }}>
										${s.cost.toFixed(4)}
									</td>
									<td style={{ padding: "8px", color: "#8888a0", fontSize: "13px" }}>
										{formatDate(s.createdAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
