/**
 * Session management page for the Chitragupta Hub.
 *
 * Lists all sessions with sortable columns, supports search/filter,
 * and allows expanding a session to view turn-by-turn conversation
 * details including token counts and per-turn costs.
 * @module pages/sessions
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";

// ── Types ─────────────────────────────────────────────────────────

/** Session summary from the list endpoint. */
interface SessionSummary {
	id: string;
	title: string;
	provider: string;
	model: string;
	cost: number;
	turnCount: number;
	duration: number;
	createdAt: string;
}

/** A single turn in a session detail. */
interface Turn {
	turnNumber: number;
	role: "user" | "assistant";
	content: string;
	model?: string;
	cost?: number;
	inputTokens?: number;
	outputTokens?: number;
}

/** Full session detail with turns. */
interface SessionDetail {
	id: string;
	title: string;
	provider: string;
	model: string;
	cost: number;
	turns: Turn[];
	createdAt: string;
}

/** Wrapped sessions list response from the API. */
interface SessionsListResponse {
	sessions: SessionSummary[];
}

/** Wrapped session detail response from the API. */
interface SessionDetailResponse {
	session: SessionDetail;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Format milliseconds as a human-readable duration. */
function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

/** Format ISO date to short local format. */
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
 * Session browser page.
 *
 * Fetches the full session list on mount and renders a filterable
 * table. Clicking a row fetches and displays the session detail
 * with its turn-by-turn conversation.
 */
export function Sessions(): preact.JSX.Element {
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [filter, setFilter] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<SessionDetail | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void apiGet<SessionsListResponse>("/api/sessions")
			.then((data) => setSessions(data.sessions ?? []))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const handleSelect = useCallback(async (id: string) => {
		if (selectedId === id) {
			setSelectedId(null);
			setDetail(null);
			return;
		}
		setSelectedId(id);
		setDetail(null);
		try {
			const resp = await apiGet<SessionDetailResponse>(`/api/sessions/${id}`);
			setDetail(resp.session);
		} catch {
			// Failed to load detail
		}
	}, [selectedId]);

	const filtered = filter.trim()
		? sessions.filter(
			(s) =>
				s.title.toLowerCase().includes(filter.toLowerCase()) ||
				s.id.includes(filter) ||
				s.model.toLowerCase().includes(filter.toLowerCase()),
		)
		: sessions;

	return (
		<div>
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "16px" }}>
				Sessions
			</h1>

			{/* Search bar */}
			<input
				type="text"
				value={filter}
				onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
				placeholder="Search sessions..."
				style={{
					width: "100%",
					maxWidth: "400px",
					padding: "8px 12px",
					background: "#16161e",
					border: "1px solid #2a2a3a",
					borderRadius: "6px",
					color: "#e8e8ed",
					fontSize: "13px",
					outline: "none",
					marginBottom: "16px",
				}}
			/>

			{loading && (
				<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
					<Spinner size="lg" />
				</div>
			)}

			{!loading && filtered.length === 0 && (
				<EmptyState
					icon="\uD83D\uDDC2"
					title="No sessions found"
					description={filter.trim() ? `No sessions match "${filter}".` : "Sessions will appear here once you start using Chitragupta."}
				/>
			)}

			{/* Session list */}
			{!loading && filtered.length > 0 && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						overflow: "hidden",
					}}
				>
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid #2a2a3a" }}>
								{["ID", "Title", "Provider", "Model", "Cost", "Turns", "Duration", "Date"].map((h) => (
									<th
										key={h}
										style={{
											textAlign: "left",
											padding: "8px 10px",
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
							{filtered.map((s) => (
								<tr
									key={s.id}
									onClick={() => void handleSelect(s.id)}
									style={{
										borderBottom: "1px solid #1e1e2a",
										cursor: "pointer",
										backgroundColor: selectedId === s.id ? "rgba(99,102,241,0.08)" : "transparent",
									}}
								>
									<td style={{ padding: "8px 10px", color: "#6366f1", fontSize: "12px", fontFamily: "monospace" }}>
										{s.id.slice(0, 8)}
									</td>
									<td style={{ padding: "8px 10px", color: "#e8e8ed", fontSize: "13px" }}>
										{s.title || "Untitled"}
									</td>
									<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>{s.provider}</td>
									<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>{s.model}</td>
									<td style={{ padding: "8px 10px", color: "#e8e8ed", fontSize: "13px" }}>${s.cost.toFixed(4)}</td>
									<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>{s.turnCount}</td>
									<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>{formatDuration(s.duration)}</td>
									<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>{formatDate(s.createdAt)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Session detail panel */}
			{selectedId && detail && (
				<SessionDetailPanel detail={detail} />
			)}
		</div>
	);
}

// ── Detail panel (separate for clarity) ──────────────────────────

/** Props for the session detail panel. */
interface DetailPanelProps {
	detail: SessionDetail;
}

/**
 * Renders the turn-by-turn conversation for a selected session.
 * Shows role, content preview, token counts, and per-turn cost.
 */
function SessionDetailPanel({ detail }: DetailPanelProps): preact.JSX.Element {
	return (
		<div
			style={{
				background: "#16161e",
				borderRadius: "8px",
				border: "1px solid #2a2a3a",
				padding: "16px",
				marginTop: "16px",
			}}
		>
			<h3 style={{ fontSize: "14px", color: "#e8e8ed", marginBottom: "12px" }}>
				{detail.title || detail.id.slice(0, 8)} - Conversation
			</h3>
			<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
				{detail.turns.map((turn) => (
					<div
						key={turn.turnNumber}
						style={{
							padding: "10px 12px",
							background: turn.role === "user" ? "#1a1a26" : "#12121c",
							borderRadius: "6px",
							borderLeft: `3px solid ${turn.role === "user" ? "#6366f1" : "#22c55e"}`,
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								marginBottom: "4px",
							}}
						>
							<span style={{ fontSize: "11px", color: "#8888a0", fontWeight: 600 }}>
								{turn.role === "user" ? "User" : "Assistant"}
							</span>
							<span style={{ fontSize: "11px", color: "#8888a0" }}>
								{turn.cost !== undefined && `$${turn.cost.toFixed(5)}`}
								{turn.inputTokens !== undefined && ` | in:${turn.inputTokens}`}
								{turn.outputTokens !== undefined && ` out:${turn.outputTokens}`}
							</span>
						</div>
						<div
							style={{
								fontSize: "13px",
								color: "#e8e8ed",
								whiteSpace: "pre-wrap",
								maxHeight: "120px",
								overflow: "hidden",
							}}
						>
							{turn.content.length > 300 ? `${turn.content.slice(0, 300)}...` : turn.content}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
