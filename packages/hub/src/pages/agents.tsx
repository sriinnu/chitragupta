/**
 * Agent tree visualisation page for the Chitragupta Hub.
 *
 * Displays an SVG tree of active agents using a simplified
 * Reingold-Tilford layout. Click a node to see agent detail.
 * Polls agent stats every 5 seconds for live counts.
 * @module pages/agents
 */

import { useEffect, useState, useCallback, useRef } from "preact/hooks";
import { apiGet } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";

// ── Types ─────────────────────────────────────────────────────────

/** Agent tree node from the backend (matches AgentTreeNode in agent-api.ts). */
interface AgentNode {
	id: string;
	purpose: string;
	status: "running" | "idle" | "completed" | "aborted" | "error";
	profile: string;
	model: string;
	depth: number;
	children: AgentNode[];
}

/** Agent detail from the backend (matches AgentDetail in agent-api.ts). */
interface AgentDetail {
	id: string;
	purpose: string;
	status: string;
	profile: string;
	model: string;
	depth: number;
	childCount: number;
	parentId: string | null;
	childIds: string[];
	ancestry: string[];
}

/** Agent stats summary (matches AgentStats in agent-api.ts). */
interface AgentStats {
	total: number;
	running: number;
	idle: number;
	completed: number;
	aborted: number;
	error: number;
	maxDepth: number;
	avgDepth: number;
}

/** Positioned node for rendering. */
interface PositionedNode {
	id: string;
	purpose: string;
	status: string;
	x: number;
	y: number;
	children: PositionedNode[];
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, BadgeVariant> = {
	running: "success",
	idle: "muted",
	completed: "accent",
	aborted: "warning",
	error: "error",
};

const STATS_POLL_MS = 5000;
const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const LEVEL_GAP = 80;
const SIBLING_GAP = 140;

// ── Component ─────────────────────────────────────────────────────

/** Agent tree page with SVG visualisation and detail panel. */
export function Agents(): preact.JSX.Element {
	const [tree, setTree] = useState<AgentNode | null>(null);
	const [stats, setStats] = useState<AgentStats | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<AgentDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		void Promise.all([
			apiGet<{ tree: AgentNode }>("/api/agents/tree").then((d) => setTree(d.tree)).catch(() => {}),
			apiGet<AgentStats>("/api/agents/stats").then(setStats).catch(() => {}),
		]).finally(() => setLoading(false));

		pollRef.current = setInterval(() => {
			void apiGet<AgentStats>("/api/agents/stats").then(setStats).catch(() => {});
		}, STATS_POLL_MS);

		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, []);

	const handleNodeClick = useCallback(async (id: string) => {
		if (selectedId === id) {
			setSelectedId(null);
			setDetail(null);
			return;
		}
		setSelectedId(id);
		setDetail(null);
		try {
			const data = await apiGet<AgentDetail>(`/api/agents/${id}`);
			setDetail(data);
		} catch {
			// best-effort
		}
	}, [selectedId]);

	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
				<Spinner size="lg" />
			</div>
		);
	}

	if (!tree) {
		return (
			<EmptyState
				icon="\uD83D\uDC65"
				title="No agent tree"
				description="Agent tree data appears when agents are spawned."
			/>
		);
	}

	const positioned = layoutTree(tree);
	const { width, height } = getTreeBounds(positioned);

	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-xl)" }}>
				Agents
			</h1>

			{/* Stats bar */}
			{stats && (
				<div style={{ display: "flex", gap: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
					<StatChip label="Total" value={stats.total} />
					<StatChip label="Running" value={stats.running} color="var(--color-success)" />
					<StatChip label="Idle" value={stats.idle} />
					<StatChip label="Completed" value={stats.completed} color="var(--color-accent)" />
				</div>
			)}

			{/* SVG tree */}
			<div style={{
				background: "var(--color-surface)",
				border: "1px solid var(--color-border)",
				borderRadius: "var(--radius-lg)",
				padding: "var(--space-lg)",
				overflowX: "auto",
			}}>
				<svg width={width + 40} height={height + 40} viewBox={`0 0 ${width + 40} ${height + 40}`}>
					<g transform="translate(20, 20)">
						{renderEdges(positioned)}
						{renderNodes(positioned, selectedId, handleNodeClick)}
					</g>
				</svg>
			</div>

			{/* Detail panel */}
			{selectedId && detail && (
				<div style={{
					background: "var(--color-surface)",
					border: "1px solid var(--color-border)",
					borderRadius: "var(--radius-lg)",
					padding: "var(--space-lg)",
					marginTop: "var(--space-lg)",
				}}>
					<h3 style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", marginBottom: "var(--space-md)" }}>
						{detail.purpose}
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", fontSize: "var(--font-size-md)" }}>
						<DetailRow label="Status" value={detail.status} />
						<DetailRow label="Profile" value={detail.profile} />
						<DetailRow label="Model" value={detail.model} />
						<DetailRow label="Depth" value={String(detail.depth)} />
						<DetailRow label="Children" value={String(detail.childCount)} />
						<DetailRow label="Parent" value={detail.parentId ?? "root"} />
					</div>
				</div>
			)}
		</div>
	);
}

// ── Tree layout ───────────────────────────────────────────────────

/** Simple Reingold-Tilford-style layout: depth-first x assignment. */
function layoutTree(node: AgentNode, depth = 0, offset = { x: 0 }): PositionedNode {
	if (node.children.length === 0) {
		const positioned: PositionedNode = {
			id: node.id,
			purpose: node.purpose,
			status: node.status,
			x: offset.x,
			y: depth * LEVEL_GAP,
			children: [],
		};
		offset.x += SIBLING_GAP;
		return positioned;
	}

	const children = node.children.map((c) => layoutTree(c, depth + 1, offset));
	const firstX = children[0].x;
	const lastX = children[children.length - 1].x;

	return {
		id: node.id,
		purpose: node.purpose,
		status: node.status,
		x: (firstX + lastX) / 2,
		y: depth * LEVEL_GAP,
		children,
	};
}

function getTreeBounds(node: PositionedNode): { width: number; height: number } {
	let maxX = node.x + NODE_WIDTH;
	let maxY = node.y + NODE_HEIGHT;
	for (const child of node.children) {
		const childBounds = getTreeBounds(child);
		if (childBounds.width > maxX) maxX = childBounds.width;
		if (childBounds.height > maxY) maxY = childBounds.height;
	}
	return { width: maxX, height: maxY };
}

function renderEdges(node: PositionedNode): preact.JSX.Element {
	return (
		<>
			{node.children.map((child) => (
				<g key={`${node.id}-${child.id}`}>
					<line
						x1={node.x + NODE_WIDTH / 2}
						y1={node.y + NODE_HEIGHT}
						x2={child.x + NODE_WIDTH / 2}
						y2={child.y}
						stroke="var(--color-border)"
						strokeWidth="1.5"
					/>
					{renderEdges(child)}
				</g>
			))}
		</>
	);
}

function renderNodes(
	node: PositionedNode,
	selectedId: string | null,
	onClick: (id: string) => void,
): preact.JSX.Element {
	const isSelected = node.id === selectedId;
	const statusColor = node.status === "running" ? "var(--color-success)"
		: node.status === "error" ? "var(--color-error)"
		: "var(--color-muted)";

	return (
		<>
			<g
				onClick={() => onClick(node.id)}
				style={{ cursor: "pointer" }}
			>
				<rect
					x={node.x}
					y={node.y}
					width={NODE_WIDTH}
					height={NODE_HEIGHT}
					rx={6}
					fill={isSelected ? "var(--color-accent-muted)" : "var(--color-surface)"}
					stroke={isSelected ? "var(--color-accent)" : "var(--color-border)"}
					strokeWidth={isSelected ? 2 : 1}
				/>
				{/* Status dot */}
				<circle
					cx={node.x + 12}
					cy={node.y + NODE_HEIGHT / 2}
					r={4}
					fill={statusColor}
				/>
				{/* Name */}
				<text
					x={node.x + 22}
					y={node.y + NODE_HEIGHT / 2 + 4}
					fill="var(--color-text)"
					fontSize="11"
					fontWeight="500"
				>
					{node.purpose.length > 12 ? `${node.purpose.slice(0, 12)}...` : node.purpose}
				</text>
			</g>
			{node.children.map((child) => renderNodes(child, selectedId, onClick))}
		</>
	);
}

// ── Helpers ───────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color?: string }): preact.JSX.Element {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
			<span style={{ fontSize: "var(--font-size-lg)", fontWeight: "bold", color: color ?? "var(--color-text)" }}>{value}</span>
			<span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>{label}</span>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }): preact.JSX.Element {
	return (
		<div>
			<span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-xs)" }}>{label}: </span>
			<span style={{ color: "var(--color-text)" }}>{value}</span>
		</div>
	);
}

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	} catch { return iso; }
}
