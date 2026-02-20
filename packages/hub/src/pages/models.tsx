/**
 * Model catalog page for the Chitragupta Hub.
 *
 * Displays a table/grid of available models fetched from the API.
 * Supports selecting two models for side-by-side comparison and
 * shows the TuriyaRouter state for intelligent routing insights.
 * @module pages/models
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Model entry normalized for the frontend. */
interface ModelEntry {
	id: string;
	name: string;
	provider: string;
	inputPrice: number;
	outputPrice: number;
	capabilities: string[];
	contextWindow?: number;
}

/** Raw model entry as returned by the backend. */
interface RawModelEntry {
	id: string;
	provider: string;
	displayName: string;
	capabilities: string[];
	pricing: { inputPer1k: number; outputPer1k: number };
	contextWindow?: number;
}

/** Wrapped models response from the API. */
interface ModelsResponse {
	models: RawModelEntry[];
	count: number;
}

/** Wrapped router response from the API. */
interface RouterResponse {
	router: RouterState;
}

/** Router state from the Turiya endpoint. */
interface RouterState {
	defaultModel: string;
	routingStrategy: string;
	recentSelections: Array<{ model: string; reason: string }>;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Model catalog page.
 *
 * Fetches models from `/api/models` and optionally the router state
 * from `/api/models/router`. Models are shown in a table with pricing,
 * and two can be selected for comparison.
 */
export function Models(): preact.JSX.Element {
	const [models, setModels] = useState<ModelEntry[]>([]);
	const [router, setRouter] = useState<RouterState | null>(null);
	const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void apiGet<ModelsResponse>("/api/models")
			.then((data) => {
				const mapped = (data.models ?? []).map((m) => ({
					id: m.id,
					name: m.displayName,
					provider: m.provider,
					inputPrice: m.pricing.inputPer1k,
					outputPrice: m.pricing.outputPer1k,
					capabilities: m.capabilities,
					contextWindow: m.contextWindow,
				}));
				setModels(mapped);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
		void apiGet<RouterResponse>("/api/models/router")
			.then((data) => setRouter(data.router))
			.catch(() => {});
	}, []);

	const toggleCompare = useCallback((id: string) => {
		setCompareIds((prev) => {
			if (prev[0] === id) return [null, prev[1]];
			if (prev[1] === id) return [prev[0], null];
			if (prev[0] === null) return [id, prev[1]];
			if (prev[1] === null) return [prev[0], id];
			return [id, null];
		});
	}, []);

	const compareA = models.find((m) => m.id === compareIds[0]);
	const compareB = models.find((m) => m.id === compareIds[1]);

	return (
		<div>
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "16px" }}>
				Model Catalog
			</h1>

			{loading && <div style={{ color: "#8888a0" }}>Loading models...</div>}

			{/* Models table */}
			{!loading && models.length > 0 && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						overflow: "hidden",
						marginBottom: "24px",
					}}
				>
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid #2a2a3a" }}>
								<th style={thStyle}>Compare</th>
								<th style={thStyle}>Model</th>
								<th style={thStyle}>Provider</th>
								<th style={thStyle}>Input $/M</th>
								<th style={thStyle}>Output $/M</th>
								<th style={thStyle}>Capabilities</th>
							</tr>
						</thead>
						<tbody>
							{models.map((m) => {
								const isCompared = compareIds.includes(m.id);
								return (
									<tr
										key={m.id}
										style={{
											borderBottom: "1px solid #1e1e2a",
											background: isCompared ? "rgba(99,102,241,0.08)" : "transparent",
										}}
									>
										<td style={tdStyle}>
											<input
												type="checkbox"
												checked={isCompared}
												onChange={() => toggleCompare(m.id)}
											/>
										</td>
										<td style={{ ...tdStyle, color: "#e8e8ed" }}>{m.name}</td>
										<td style={tdStyle}>{m.provider}</td>
										<td style={tdStyle}>${m.inputPrice.toFixed(2)}</td>
										<td style={tdStyle}>${m.outputPrice.toFixed(2)}</td>
										<td style={tdStyle}>
											{m.capabilities.map((c) => (
												<span
													key={c}
													style={{
														display: "inline-block",
														padding: "2px 6px",
														background: "#2a2a3a",
														borderRadius: "4px",
														fontSize: "11px",
														marginRight: "4px",
														color: "#e8e8ed",
													}}
												>
													{c}
												</span>
											))}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* Comparison panel */}
			{compareA && compareB && (
				<ComparisonPanel modelA={compareA} modelB={compareB} />
			)}

			{/* Router insights */}
			{router && (
				<div
					style={{
						background: "#16161e",
						borderRadius: "8px",
						border: "1px solid #2a2a3a",
						padding: "16px",
					}}
				>
					<h3 style={{ fontSize: "14px", color: "#8888a0", marginBottom: "12px" }}>
						TuriyaRouter Insights
					</h3>
					<div style={{ fontSize: "13px", color: "#e8e8ed", marginBottom: "8px" }}>
						Default: <strong>{router.defaultModel}</strong> | Strategy: {router.routingStrategy}
					</div>
					{router.recentSelections.length > 0 && (
						<div style={{ fontSize: "12px", color: "#8888a0" }}>
							<div style={{ marginBottom: "4px" }}>Recent selections:</div>
							{router.recentSelections.slice(0, 5).map((s, i) => (
								<div key={i} style={{ marginLeft: "8px" }}>
									{s.model} - {s.reason}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Styles ────────────────────────────────────────────────────────

const thStyle: preact.JSX.CSSProperties = {
	textAlign: "left",
	padding: "8px 10px",
	fontSize: "11px",
	color: "#8888a0",
	fontWeight: 500,
};

const tdStyle: preact.JSX.CSSProperties = {
	padding: "8px 10px",
	color: "#8888a0",
	fontSize: "13px",
};

// ── Comparison panel ──────────────────────────────────────────────

/** Props for the side-by-side comparison. */
interface ComparisonProps {
	modelA: ModelEntry;
	modelB: ModelEntry;
}

/** Side-by-side model comparison component. */
function ComparisonPanel({ modelA, modelB }: ComparisonProps): preact.JSX.Element {
	const rows: Array<{ label: string; a: string; b: string }> = [
		{ label: "Provider", a: modelA.provider, b: modelB.provider },
		{ label: "Input $/M tokens", a: `$${modelA.inputPrice.toFixed(2)}`, b: `$${modelB.inputPrice.toFixed(2)}` },
		{ label: "Output $/M tokens", a: `$${modelA.outputPrice.toFixed(2)}`, b: `$${modelB.outputPrice.toFixed(2)}` },
		{ label: "Context Window", a: modelA.contextWindow?.toLocaleString() ?? "N/A", b: modelB.contextWindow?.toLocaleString() ?? "N/A" },
		{ label: "Capabilities", a: modelA.capabilities.join(", "), b: modelB.capabilities.join(", ") },
	];

	return (
		<div
			style={{
				background: "#16161e",
				borderRadius: "8px",
				border: "1px solid #6366f1",
				padding: "16px",
				marginBottom: "24px",
			}}
		>
			<h3 style={{ fontSize: "14px", color: "#e8e8ed", marginBottom: "12px" }}>
				Comparison: {modelA.name} vs {modelB.name}
			</h3>
			<table style={{ width: "100%", borderCollapse: "collapse" }}>
				<thead>
					<tr style={{ borderBottom: "1px solid #2a2a3a" }}>
						<th style={{ ...thStyle, width: "30%" }}>Metric</th>
						<th style={thStyle}>{modelA.name}</th>
						<th style={thStyle}>{modelB.name}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.label} style={{ borderBottom: "1px solid #1e1e2a" }}>
							<td style={{ ...tdStyle, color: "#8888a0" }}>{row.label}</td>
							<td style={{ ...tdStyle, color: "#e8e8ed" }}>{row.a}</td>
							<td style={{ ...tdStyle, color: "#e8e8ed" }}>{row.b}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
