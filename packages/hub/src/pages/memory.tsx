/**
 * Memory explorer page for the Chitragupta Hub.
 *
 * Provides a search interface for GraphRAG-backed project memory.
 * Results are shown in a list with relevance scores and can be
 * filtered by category (global, project, agent) matching backend
 * scope types.
 * @module pages/memory
 */

import { useState, useCallback } from "preact/hooks";
import { apiPost } from "../api.js";
import { Spinner } from "../components/spinner.js";
import { EmptyState } from "../components/empty-state.js";
import { Badge } from "../components/badge.js";
import type { BadgeVariant } from "../components/badge.js";
import { Tabs, createTabSignal, type TabDef } from "../components/tabs.js";

// ── Types ─────────────────────────────────────────────────────────

/** Memory entry returned by the search API. */
interface MemoryEntry {
	content: string;
	score: number;
	/** Backend returns scope.type: "global" | "project" | "agent". */
	source: string;
}

/** Wrapped memory search response from the API. */
interface MemorySearchResponse {
	results: MemoryEntry[];
}

// ── Constants ─────────────────────────────────────────────────────

/** Tab definitions matching actual backend scope types. */
const CATEGORY_TABS: TabDef[] = [
	{ key: "all", label: "All" },
	{ key: "global", label: "Global" },
	{ key: "project", label: "Project" },
	{ key: "agent", label: "Agent" },
];

/** Map source values to badge variants for visual distinction. */
const SOURCE_BADGE_MAP: Record<string, BadgeVariant> = {
	global: "accent",
	project: "success",
	agent: "warning",
};

// ── State ─────────────────────────────────────────────────────────

const activeTab = createTabSignal("all");

// ── Component ─────────────────────────────────────────────────────

/**
 * Memory explorer page.
 *
 * Features a search input, category filter tabs (matching backend
 * scope types: global/project/agent), and a results list showing
 * memory entries with relevance scores.
 */
export function Memory(): preact.JSX.Element {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<MemoryEntry[]>([]);
	const [searching, setSearching] = useState(false);
	const [searched, setSearched] = useState(false);

	const handleSearch = useCallback(async () => {
		if (!query.trim()) return;
		setSearching(true);
		setSearched(true);
		try {
			const data = await apiPost<MemorySearchResponse>("/api/memory/search", {
				query: query.trim(),
			});
			setResults(data.results ?? []);
		} catch {
			setResults([]);
		} finally {
			setSearching(false);
		}
	}, [query]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter") void handleSearch();
		},
		[handleSearch],
	);

	const category = activeTab.value;
	const filtered = category === "all"
		? results
		: results.filter((r) => r.source === category);

	return (
		<div>
			<h1 style={{ fontSize: "var(--font-size-xl)", color: "var(--color-text)", marginBottom: "var(--space-lg)" }}>
				Memory Explorer
			</h1>

			{/* Search bar */}
			<div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
				<input
					type="text"
					value={query}
					onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
					placeholder="Search project memory..."
					style={{
						flex: 1,
						padding: "10px 14px",
						background: "var(--color-surface)",
						border: "1px solid var(--color-border)",
						borderRadius: "var(--radius-md)",
						color: "var(--color-text)",
						fontSize: "var(--font-size-base)",
						outline: "none",
					}}
				/>
				<button
					onClick={() => void handleSearch()}
					disabled={searching || !query.trim()}
					style={{
						padding: "10px 20px",
						background: "var(--color-accent)",
						color: "var(--color-white)",
						border: "none",
						borderRadius: "var(--radius-md)",
						fontSize: "var(--font-size-base)",
						cursor: searching || !query.trim() ? "default" : "pointer",
					}}
				>
					{searching ? "Searching..." : "Search"}
				</button>
			</div>

			{/* Category filter tabs */}
			<Tabs tabs={CATEGORY_TABS} activeKey={activeTab}>
				{/* Loading state */}
				{searching && (
					<div style={{ display: "flex", justifyContent: "center", padding: "var(--space-2xl)" }}>
						<Spinner size="lg" />
					</div>
				)}

				{/* Empty state */}
				{searched && !searching && filtered.length === 0 && (
					<EmptyState
						icon="\uD83D\uDD0D"
						title="No results found"
						description={`No memory entries match "${query}"${category !== "all" ? ` in ${category} scope` : ""}.`}
					/>
				)}

				{/* Results list */}
				{!searching && (
					<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
						{filtered.map((entry, idx) => (
							<MemoryCard key={idx} entry={entry} />
						))}
					</div>
				)}
			</Tabs>
		</div>
	);
}

// ── Memory card component ────────────────────────────────────────

/** Props for a single memory result card. */
interface MemoryCardProps {
	entry: MemoryEntry;
}

/**
 * Renders a single memory entry with score, category badge,
 * and content preview.
 */
function MemoryCard({ entry }: MemoryCardProps): preact.JSX.Element {
	const scorePercent = Math.round(entry.score * 100);
	const scoreColor =
		scorePercent >= 80 ? "var(--color-success)" : scorePercent >= 50 ? "var(--color-warning)" : "var(--color-muted)";

	return (
		<div
			style={{
				background: "var(--color-surface)",
				border: "1px solid var(--color-border)",
				borderRadius: "var(--radius-lg)",
				padding: "14px 16px",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
				<Badge label={entry.source} variant={SOURCE_BADGE_MAP[entry.source] ?? "muted"} />
				<span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: scoreColor }}>
					{scorePercent}%
				</span>
			</div>
			<div
				style={{
					fontSize: "var(--font-size-md)",
					color: "var(--color-text)",
					lineHeight: 1.5,
					whiteSpace: "pre-wrap",
					maxHeight: "100px",
					overflow: "hidden",
				}}
			>
				{entry.content}
			</div>
		</div>
	);
}
