/**
 * Skill registry page for the Chitragupta Hub.
 *
 * Displays the list of registered skills with their categories,
 * status, and versions. Includes a quarantine section for skills
 * awaiting approval and a detail panel on click.
 * @module pages/skills
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet, apiPost } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Skill entry from the registry API. */
interface SkillEntry {
	id: string;
	name: string;
	category: string;
	status: "active" | "quarantined" | "disabled";
	version: string;
	description?: string;
	tags?: string[];
	usageCount?: number;
}

/** Wrapped skills response from the API. */
interface SkillsResponse {
	skills: SkillEntry[];
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
	active: { bg: "rgba(34,197,94,0.15)", color: "#22c55e" },
	quarantined: { bg: "rgba(234,179,8,0.15)", color: "#eab308" },
	disabled: { bg: "rgba(136,136,160,0.15)", color: "#8888a0" },
};

// ── Component ─────────────────────────────────────────────────────

/**
 * Skill registry page.
 *
 * Fetches skills from `/api/skills` and renders them in a table.
 * Skills in quarantine are shown in a separate section with
 * Approve/Reject buttons.
 */
export function Skills(): preact.JSX.Element {
	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const data = await apiGet<SkillsResponse>("/api/skills");
			setSkills(data.skills ?? []);
		} catch {
			// best-effort
		}
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
	}, [refresh]);

	const handleApprove = useCallback(async (id: string) => {
		try {
			await apiPost(`/api/skills/${id}/approve`);
			await refresh();
		} catch {
			// best-effort
		}
	}, [refresh]);

	const handleReject = useCallback(async (id: string) => {
		try {
			await apiPost(`/api/skills/${id}/reject`);
			await refresh();
		} catch {
			// best-effort
		}
	}, [refresh]);

	const activeSkills = skills.filter((s) => s.status !== "quarantined");
	const quarantined = skills.filter((s) => s.status === "quarantined");
	const selected = skills.find((s) => s.id === selectedId);

	return (
		<div>
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "16px" }}>
				Skill Registry
			</h1>

			{loading && <div style={{ color: "#8888a0" }}>Loading skills...</div>}

			{/* Quarantine section */}
			{quarantined.length > 0 && (
				<div
					style={{
						background: "rgba(234,179,8,0.05)",
						border: "1px solid rgba(234,179,8,0.2)",
						borderRadius: "8px",
						padding: "14px 16px",
						marginBottom: "20px",
					}}
				>
					<h3 style={{ fontSize: "13px", color: "#eab308", marginBottom: "10px" }}>
						Quarantined Skills ({quarantined.length})
					</h3>
					{quarantined.map((s) => (
						<div
							key={s.id}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "8px 0",
								borderBottom: "1px solid rgba(234,179,8,0.1)",
							}}
						>
							<div>
								<span style={{ color: "#e8e8ed", fontSize: "13px" }}>{s.name}</span>
								<span style={{ color: "#8888a0", fontSize: "12px", marginLeft: "8px" }}>
									v{s.version}
								</span>
							</div>
							<div style={{ display: "flex", gap: "6px" }}>
								<button
									onClick={() => void handleApprove(s.id)}
									style={{
										padding: "4px 10px",
										background: "rgba(34,197,94,0.15)",
										color: "#22c55e",
										border: "none",
										borderRadius: "4px",
										fontSize: "12px",
										cursor: "pointer",
									}}
								>
									Approve
								</button>
								<button
									onClick={() => void handleReject(s.id)}
									style={{
										padding: "4px 10px",
										background: "rgba(239,68,68,0.15)",
										color: "#ef4444",
										border: "none",
										borderRadius: "4px",
										fontSize: "12px",
										cursor: "pointer",
									}}
								>
									Reject
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Skills table */}
			{!loading && activeSkills.length > 0 && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						overflow: "hidden",
						marginBottom: "16px",
					}}
				>
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid #2a2a3a" }}>
								{["Name", "Category", "Status", "Version", "Usage"].map((h) => (
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
							{activeSkills.map((s) => {
								const statusStyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.disabled;
								return (
									<tr
										key={s.id}
										onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
										style={{
											borderBottom: "1px solid #1e1e2a",
											cursor: "pointer",
											background: selectedId === s.id ? "rgba(99,102,241,0.08)" : "transparent",
										}}
									>
										<td style={{ padding: "8px 10px", color: "#e8e8ed", fontSize: "13px" }}>
											{s.name}
										</td>
										<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>
											{s.category}
										</td>
										<td style={{ padding: "8px 10px" }}>
											<span style={{ ...statusStyle, padding: "2px 8px", borderRadius: "4px", fontSize: "11px" }}>
												{s.status}
											</span>
										</td>
										<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>
											v{s.version}
										</td>
										<td style={{ padding: "8px 10px", color: "#8888a0", fontSize: "13px" }}>
											{s.usageCount ?? 0}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* Detail panel */}
			{selected && (
				<div
					style={{
						background: "#16161e",
						border: "1px solid #2a2a3a",
						borderRadius: "8px",
						padding: "16px",
					}}
				>
					<h3 style={{ fontSize: "14px", color: "#e8e8ed", marginBottom: "8px" }}>
						{selected.name} <span style={{ color: "#8888a0", fontWeight: "normal" }}>v{selected.version}</span>
					</h3>
					{selected.description && (
						<p style={{ color: "#8888a0", fontSize: "13px", marginBottom: "8px" }}>
							{selected.description}
						</p>
					)}
					{selected.tags && selected.tags.length > 0 && (
						<div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
							{selected.tags.map((tag) => (
								<span
									key={tag}
									style={{
										padding: "2px 8px",
										background: "#2a2a3a",
										borderRadius: "4px",
										fontSize: "11px",
										color: "#e8e8ed",
									}}
								>
									{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
