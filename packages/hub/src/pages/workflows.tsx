/**
 * Workflow runner page for the Chitragupta Hub.
 *
 * Displays a catalog of available workflows with step counts and
 * "Run" buttons. Shows execution history with status and results.
 * @module pages/workflows
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet, apiPost } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";
import { showToast } from "../components/toast.js";

// ── Types ─────────────────────────────────────────────────────────

/** Workflow definition from the catalog. */
interface WorkflowDef {
	id: string;
	name: string;
	description: string;
	stepCount: number;
	source: "built-in" | "custom";
}

/** Workflow execution record. */
interface WorkflowExecution {
	executionId: string;
	workflowId: string;
	status: "running" | "completed" | "failed";
	startTime: number;
	endTime?: number;
	stepCount: number;
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, BadgeVariant> = {
	running: "accent",
	completed: "success",
	failed: "error",
};

// ── Component ─────────────────────────────────────────────────────

/** Workflow runner page with catalog and execution history. */
export function Workflows(): preact.JSX.Element {
	const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
	const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
	const [loading, setLoading] = useState(true);
	const [runningName, setRunningName] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		await Promise.all([
			apiGet<{ workflows: WorkflowDef[] }>("/api/workflows")
				.then((d) => setWorkflows(d.workflows ?? []))
				.catch(() => {}),
			apiGet<{ executions: WorkflowExecution[] }>("/api/workflows/executions")
				.then((d) => setExecutions(d.executions ?? []))
				.catch(() => {}),
		]);
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
	}, [refresh]);

	const handleRun = useCallback(async (name: string) => {
		setRunningName(name);
		try {
			await apiPost(`/api/workflows/${encodeURIComponent(name)}/run`);
			showToast(`Workflow "${name}" started`, "success");
			await refresh();
		} catch {
			showToast(`Failed to run "${name}"`, "error");
		} finally {
			setRunningName(null);
		}
	}, [refresh]);

	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
				<Spinner size="lg" />
			</div>
		);
	}

	if (workflows.length === 0 && executions.length === 0) {
		return (
			<EmptyState
				icon="\uD83D\uDD04"
				title="No workflows"
				description="Workflows will appear here once they are registered with the system."
			/>
		);
	}

	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Workflows
			</h1>

			{/* Workflow catalog */}
			{workflows.length > 0 && (
				<div style={{ marginBottom: "var(--space-xl)" }}>
					<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)", marginBottom: "var(--space-lg)" }}>
						Catalog
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--space-lg)" }}>
						{workflows.map((wf) => (
							<WorkflowCard
								key={wf.name}
								workflow={wf}
								running={runningName === wf.name}
								onRun={() => void handleRun(wf.name)}
							/>
						))}
					</div>
				</div>
			)}

			{/* Execution history */}
			{executions.length > 0 && (
				<div>
					<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)", marginBottom: "var(--space-lg)" }}>
						Execution History
					</h3>
					<div style={{
						background: "var(--color-surface)",
						border: "1px solid var(--color-border)",
						borderRadius: "var(--radius-lg)",
						overflow: "hidden",
					}}>
						<table style={{ width: "100%", borderCollapse: "collapse" }}>
							<thead>
								<tr style={{ borderBottom: "1px solid var(--color-border)" }}>
									{["Workflow", "Status", "Started", "Completed", "Steps"].map((h) => (
										<th key={h} style={thStyle}>{h}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{executions
									.sort((a, b) => b.startTime - a.startTime)
									.map((ex) => (
										<tr key={ex.executionId} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
											<td style={{ ...tdStyle, color: "var(--color-text)" }}>{ex.workflowId}</td>
											<td style={tdStyle}>
												<Badge label={ex.status} variant={STATUS_BADGE[ex.status] ?? "muted"} />
											</td>
											<td style={tdStyle}>{formatEpoch(ex.startTime)}</td>
											<td style={tdStyle}>{ex.endTime ? formatEpoch(ex.endTime) : "-"}</td>
											<td style={tdStyle}>{ex.stepCount}</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Workflow card ─────────────────────────────────────────────────

interface WorkflowCardProps {
	workflow: WorkflowDef;
	running: boolean;
	onRun: () => void;
}

function WorkflowCard({ workflow, running, onRun }: WorkflowCardProps): preact.JSX.Element {
	return (
		<div style={{
			background: "var(--color-surface)",
			border: "1px solid var(--color-border)",
			borderRadius: "var(--radius-lg)",
			padding: "var(--space-lg)",
			display: "flex",
			flexDirection: "column",
			gap: "var(--space-md)",
		}}>
			<div>
				<div style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600, marginBottom: "var(--space-xs)" }}>
					{workflow.name}
				</div>
				<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-muted)", lineHeight: 1.4 }}>
					{workflow.description}
				</div>
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
					{workflow.stepCount} steps | {workflow.source}
				</span>
				<button
					onClick={onRun}
					disabled={running}
					style={{
						padding: "var(--space-xs) var(--space-lg)",
						background: running ? "var(--color-border)" : "var(--color-accent)",
						color: "var(--color-white)",
						border: "none",
						borderRadius: "var(--radius-md)",
						fontSize: "var(--font-size-sm)",
						cursor: running ? "default" : "pointer",
					}}
				>
					{running ? "Running..." : "Run"}
				</button>
			</div>
		</div>
	);
}

// ── Helpers ───────────────────────────────────────────────────────

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
function formatEpoch(ts: number): string {
	try {
		return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	} catch { return String(ts); }
}
