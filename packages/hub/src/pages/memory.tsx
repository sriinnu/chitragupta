/**
 * Memory explorer page for the Chitragupta Hub.
 *
 * Provides a search interface for GraphRAG-backed project memory.
 * Results are shown in a list with relevance scores and can be
 * filtered by category (rules, patterns, sessions).
 * @module pages/memory
 */

import { useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Memory entry returned by the search API. */
interface MemoryEntry {
	id: string;
	content: string;
	category: string;
	score: number;
	source: string;
	timestamp?: string;
}

/** Available filter categories. */
type CategoryFilter = "all" | "rules" | "patterns" | "sessions";

// ── Constants ─────────────────────────────────────────────────────

const CATEGORIES: Array<{ id: CategoryFilter; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "rules", label: "Rules" },
	{ id: "patterns", label: "Patterns" },
	{ id: "sessions", label: "Sessions" },
];

// ── Component ─────────────────────────────────────────────────────

/**
 * Memory explorer page.
 *
 * Features a search input at the top, category filter tabs, and a
 * results list showing memory entries with relevance scores. Uses
 * the `/api/memory/search` endpoint.
 */
export function Memory(): preact.JSX.Element {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<MemoryEntry[]>([]);
	const [category, setCategory] = useState<CategoryFilter>("all");
	const [searching, setSearching] = useState(false);
	const [searched, setSearched] = useState(false);

	const handleSearch = useCallback(async () => {
		if (!query.trim()) return;
		setSearching(true);
		setSearched(true);
		try {
			const params = new URLSearchParams({ q: query.trim() });
			if (category !== "all") {
				params.set("category", category);
			}
			const data = await apiGet<MemoryEntry[]>(`/api/memory/search?${params.toString()}`);
			setResults(data);
		} catch {
			setResults([]);
		} finally {
			setSearching(false);
		}
	}, [query, category]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter") void handleSearch();
		},
		[handleSearch],
	);

	const filtered = category === "all"
		? results
		: results.filter((r) => r.category === category);

	return (
		<div>
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "16px" }}>
				Memory Explorer
			</h1>

			{/* Search bar */}
			<div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
				<input
					type="text"
					value={query}
					onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
					placeholder="Search project memory..."
					style={{
						flex: 1,
						padding: "10px 14px",
						background: "#16161e",
						border: "1px solid #2a2a3a",
						borderRadius: "6px",
						color: "#e8e8ed",
						fontSize: "14px",
						outline: "none",
					}}
				/>
				<button
					onClick={() => void handleSearch()}
					disabled={searching || !query.trim()}
					style={{
						padding: "10px 20px",
						background: "#6366f1",
						color: "#fff",
						border: "none",
						borderRadius: "6px",
						fontSize: "14px",
						cursor: "pointer",
					}}
				>
					{searching ? "Searching..." : "Search"}
				</button>
			</div>

			{/* Category filter tabs */}
			<div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
				{CATEGORIES.map((cat) => (
					<button
						key={cat.id}
						onClick={() => setCategory(cat.id)}
						style={{
							padding: "6px 14px",
							background: category === cat.id ? "#6366f1" : "#16161e",
							color: category === cat.id ? "#fff" : "#8888a0",
							border: "1px solid",
							borderColor: category === cat.id ? "#6366f1" : "#2a2a3a",
							borderRadius: "6px",
							fontSize: "12px",
							cursor: "pointer",
						}}
					>
						{cat.label}
					</button>
				))}
			</div>

			{/* Results */}
			{searched && !searching && filtered.length === 0 && (
				<div style={{ color: "#8888a0", fontSize: "13px" }}>
					No results found for "{query}".
				</div>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
				{filtered.map((entry) => (
					<MemoryCard key={entry.id} entry={entry} />
				))}
			</div>
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
 * content preview, and source/timestamp metadata.
 */
function MemoryCard({ entry }: MemoryCardProps): preact.JSX.Element {
	const scorePercent = Math.round(entry.score * 100);
	const scoreColor =
		scorePercent >= 80 ? "#22c55e" : scorePercent >= 50 ? "#eab308" : "#8888a0";

	return (
		<div
			style={{
				background: "#16161e",
				border: "1px solid #2a2a3a",
				borderRadius: "8px",
				padding: "14px 16px",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
				<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
					<span
						style={{
							padding: "2px 8px",
							background: "#2a2a3a",
							borderRadius: "4px",
							fontSize: "11px",
							color: "#e8e8ed",
						}}
					>
						{entry.category}
					</span>
					<span style={{ fontSize: "11px", color: "#8888a0" }}>
						{entry.source}
					</span>
				</div>
				<span style={{ fontSize: "12px", fontWeight: 600, color: scoreColor }}>
					{scorePercent}%
				</span>
			</div>
			<div
				style={{
					fontSize: "13px",
					color: "#e8e8ed",
					lineHeight: 1.5,
					whiteSpace: "pre-wrap",
					maxHeight: "100px",
					overflow: "hidden",
				}}
			>
				{entry.content}
			</div>
			{entry.timestamp && (
				<div style={{ fontSize: "11px", color: "#8888a0", marginTop: "6px" }}>
					{new Date(entry.timestamp).toLocaleString()}
				</div>
			)}
		</div>
	);
}
