/**
 * Provider management page for the Chitragupta Hub.
 *
 * Lists configured AI providers with status indicators, supports
 * adding/editing/deleting providers, and testing connections.
 * @module pages/providers
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet, apiPost, apiPut, apiDelete } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Provider entry from the API. */
interface ProviderEntry {
	id: string;
	type: string;
	endpoint: string;
	models: string[];
	status: "active" | "inactive" | "error";
	lastTestedAt?: string;
	latency?: number;
}

/** Form data for creating or editing a provider. */
interface ProviderForm {
	id: string;
	type: string;
	apiKey: string;
	endpoint: string;
	models: string;
}

/** Test connection result. */
interface TestResult {
	success: boolean;
	latency: number;
	message?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const PROVIDER_TYPES = ["anthropic", "openai", "google", "ollama", "openrouter", "custom"];

const STATUS_COLORS: Record<string, string> = {
	active: "#22c55e",
	inactive: "#8888a0",
	error: "#ef4444",
};

const EMPTY_FORM: ProviderForm = { id: "", type: "anthropic", apiKey: "", endpoint: "", models: "" };

// ── Component ─────────────────────────────────────────────────────

/**
 * Provider CRUD page.
 *
 * Fetches providers from `/api/providers`, shows them in a list with
 * status indicators, and provides forms for add/edit/delete operations.
 * Each provider can be individually tested for connectivity.
 */
export function Providers(): preact.JSX.Element {
	const [providers, setProviders] = useState<ProviderEntry[]>([]);
	const [showForm, setShowForm] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
	const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const data = await apiGet<ProviderEntry[]>("/api/providers");
			setProviders(data);
		} catch {
			// best-effort
		}
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
	}, [refresh]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			const payload = {
				type: form.type,
				apiKey: form.apiKey,
				endpoint: form.endpoint,
				models: form.models.split(",").map((m) => m.trim()).filter(Boolean),
			};
			if (editing) {
				await apiPut(`/api/providers/${editing}`, payload);
			} else {
				await apiPost("/api/providers", { id: form.id, ...payload });
			}
			setShowForm(false);
			setEditing(null);
			setForm(EMPTY_FORM);
			await refresh();
		} catch {
			// error handling
		} finally {
			setSaving(false);
		}
	}, [form, editing, refresh]);

	const handleDelete = useCallback(async (id: string) => {
		if (!confirm(`Delete provider "${id}"?`)) return;
		try {
			await apiDelete(`/api/providers/${id}`);
			await refresh();
		} catch {
			// best-effort
		}
	}, [refresh]);

	const handleTest = useCallback(async (id: string) => {
		try {
			const result = await apiPost<TestResult>(`/api/providers/${id}/test`);
			setTestResults((prev) => ({ ...prev, [id]: result }));
		} catch {
			setTestResults((prev) => ({
				...prev,
				[id]: { success: false, latency: 0, message: "Test failed" },
			}));
		}
	}, []);

	const startEdit = useCallback((p: ProviderEntry) => {
		setForm({
			id: p.id,
			type: p.type,
			apiKey: "",
			endpoint: p.endpoint,
			models: p.models.join(", "),
		});
		setEditing(p.id);
		setShowForm(true);
	}, []);

	return (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
				<h1 style={{ fontSize: "20px", color: "#e8e8ed" }}>Providers</h1>
				<button
					onClick={() => { setForm(EMPTY_FORM); setEditing(null); setShowForm(true); }}
					style={btnAccent}
				>
					+ Add Provider
				</button>
			</div>

			{loading && <div style={{ color: "#8888a0" }}>Loading...</div>}

			{/* Provider list */}
			{providers.map((p) => (
				<div
					key={p.id}
					style={{
						background: "#16161e",
						border: "1px solid #2a2a3a",
						borderRadius: "8px",
						padding: "14px 16px",
						marginBottom: "10px",
						display: "flex",
						alignItems: "center",
						gap: "12px",
					}}
				>
					<span
						style={{
							width: "10px",
							height: "10px",
							borderRadius: "50%",
							background: STATUS_COLORS[p.status] ?? "#8888a0",
							flexShrink: 0,
						}}
					/>
					<div style={{ flex: 1 }}>
						<div style={{ color: "#e8e8ed", fontSize: "14px", fontWeight: 600 }}>{p.id}</div>
						<div style={{ color: "#8888a0", fontSize: "12px" }}>
							{p.type} | {p.models.join(", ") || "no models"}
							{p.latency !== undefined && ` | ${p.latency}ms`}
						</div>
					</div>
					<div style={{ display: "flex", gap: "6px" }}>
						<button onClick={() => void handleTest(p.id)} style={btnSmall}>Test</button>
						<button onClick={() => startEdit(p)} style={btnSmall}>Edit</button>
						<button onClick={() => void handleDelete(p.id)} style={{ ...btnSmall, color: "#ef4444" }}>Delete</button>
					</div>
					{testResults[p.id] && (
						<div style={{ fontSize: "11px", color: testResults[p.id].success ? "#22c55e" : "#ef4444" }}>
							{testResults[p.id].success ? `OK ${testResults[p.id].latency}ms` : testResults[p.id].message}
						</div>
					)}
				</div>
			))}

			{/* Add/Edit form */}
			{showForm && (
				<ProviderFormPanel
					form={form}
					setForm={setForm}
					editing={editing}
					saving={saving}
					onSave={() => void handleSave()}
					onCancel={() => { setShowForm(false); setEditing(null); }}
				/>
			)}
		</div>
	);
}

// ── Form panel ───────────────────────────────────────────────────

/** Props for the provider form. */
interface FormPanelProps {
	form: ProviderForm;
	setForm: (fn: (prev: ProviderForm) => ProviderForm) => void;
	editing: string | null;
	saving: boolean;
	onSave: () => void;
	onCancel: () => void;
}

/** Provider add/edit form. */
function ProviderFormPanel({ form, setForm, editing, saving, onSave, onCancel }: FormPanelProps): preact.JSX.Element {
	const update = (field: keyof ProviderForm, value: string): void => {
		setForm((prev) => ({ ...prev, [field]: value }));
	};

	return (
		<div style={{ background: "#16161e", border: "1px solid #2a2a3a", borderRadius: "8px", padding: "16px", marginTop: "16px" }}>
			<h3 style={{ fontSize: "14px", color: "#e8e8ed", marginBottom: "12px" }}>
				{editing ? `Edit ${editing}` : "Add Provider"}
			</h3>
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
				{!editing && (
					<input placeholder="ID (e.g. my-openai)" value={form.id} onInput={(e) => update("id", (e.target as HTMLInputElement).value)} style={inputStyle} />
				)}
				<select value={form.type} onChange={(e) => update("type", (e.target as HTMLSelectElement).value)} style={inputStyle}>
					{PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
				</select>
				<input placeholder="API Key" type="password" value={form.apiKey} onInput={(e) => update("apiKey", (e.target as HTMLInputElement).value)} style={inputStyle} />
				<input placeholder="Endpoint URL" value={form.endpoint} onInput={(e) => update("endpoint", (e.target as HTMLInputElement).value)} style={inputStyle} />
			</div>
			<input placeholder="Models (comma-separated)" value={form.models} onInput={(e) => update("models", (e.target as HTMLInputElement).value)} style={{ ...inputStyle, width: "100%", marginBottom: "12px" }} />
			<div style={{ display: "flex", gap: "8px" }}>
				<button onClick={onSave} disabled={saving} style={btnAccent}>
					{saving ? "Saving..." : "Save"}
				</button>
				<button onClick={onCancel} style={btnSmall}>Cancel</button>
			</div>
		</div>
	);
}

// ── Shared styles ────────────────────────────────────────────────

const inputStyle: preact.JSX.CSSProperties = {
	padding: "8px 10px",
	background: "#0a0a0f",
	border: "1px solid #2a2a3a",
	borderRadius: "6px",
	color: "#e8e8ed",
	fontSize: "13px",
	outline: "none",
};

const btnAccent: preact.JSX.CSSProperties = {
	padding: "8px 16px",
	background: "#6366f1",
	color: "#fff",
	border: "none",
	borderRadius: "6px",
	fontSize: "13px",
	cursor: "pointer",
};

const btnSmall: preact.JSX.CSSProperties = {
	padding: "6px 12px",
	background: "#2a2a3a",
	color: "#e8e8ed",
	border: "none",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
};
