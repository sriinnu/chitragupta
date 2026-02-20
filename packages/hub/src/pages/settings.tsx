/**
 * Settings editor page for the Chitragupta Hub.
 *
 * Fetches application settings from the API and renders them in
 * organized form sections: Provider, Budget, Memory, and Theme.
 * Changes are saved via PUT to `/api/settings`.
 * @module pages/settings
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet, apiPut } from "../api.js";
import { showToast } from "../components/toast.js";

// ── Types ─────────────────────────────────────────────────────────

/**
 * Application settings shape matching the backend ChitraguptaSettings.
 * Budget and memory settings are nested objects on the backend.
 */
interface AppSettings {
	defaultProvider: string;
	defaultModel: string;
	budget: {
		maxSessionCost: number;
		maxDailyCost: number;
		warningThreshold: number;
	};
	memory: {
		autoSave: boolean;
		searchDepth: number;
	};
	theme: string;
}

/** Wrapped settings response from the API. */
interface SettingsResponse {
	settings: AppSettings;
}

/** Raw provider entry from the providers list endpoint. */
interface RawProviderEntry {
	id: string;
	type: string;
	apiKey: string;
	endpoint: string;
	models: string[];
}

/** Wrapped providers list response from the API. */
interface ProvidersListResponse {
	providers: RawProviderEntry[];
}

// ── Constants ─────────────────────────────────────────────────────

const THEMES = ["dark", "light", "system"];

const DEFAULT_SETTINGS: AppSettings = {
	defaultProvider: "",
	defaultModel: "",
	budget: {
		maxSessionCost: 1.0,
		maxDailyCost: 10.0,
		warningThreshold: 0.8,
	},
	memory: {
		autoSave: true,
		searchDepth: 5,
	},
	theme: "dark",
};

// ── Component ─────────────────────────────────────────────────────

/**
 * Settings editor page.
 *
 * Loads settings from GET `/api/settings` and provider options from
 * GET `/api/providers`. Renders form sections for each category
 * with a save button that PUTs the updated settings.
 */
export function Settings(): preact.JSX.Element {
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
	const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		void Promise.all([
			apiGet<SettingsResponse>("/api/settings")
				.then((data) => data.settings)
				.catch(() => DEFAULT_SETTINGS),
			apiGet<ProvidersListResponse>("/api/providers")
				.then((data) => (data.providers ?? []).map((p) => ({ id: p.id, name: p.id })))
				.catch((): Array<{ id: string; name: string }> => []),
		]).then(([s, p]) => {
			setSettings(s);
			setProviders(p);
			setLoading(false);
		});
	}, []);

	/** Update a top-level settings field. */
	const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
		setSaved(false);
		setSettings((prev) => ({ ...prev, [key]: value }));
	}, []);

	/** Update a nested budget field. */
	const updateBudget = useCallback(<K extends keyof AppSettings["budget"]>(key: K, value: AppSettings["budget"][K]) => {
		setSaved(false);
		setSettings((prev) => ({ ...prev, budget: { ...prev.budget, [key]: value } }));
	}, []);

	/** Update a nested memory field. */
	const updateMemory = useCallback(<K extends keyof AppSettings["memory"]>(key: K, value: AppSettings["memory"][K]) => {
		setSaved(false);
		setSettings((prev) => ({ ...prev, memory: { ...prev.memory, [key]: value } }));
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			const data = await apiPut<SettingsResponse>("/api/settings", settings);
			setSettings(data.settings);
			setSaved(true);
			showToast("Settings saved", "success");
		} catch {
			showToast("Failed to save settings", "error");
		} finally {
			setSaving(false);
		}
	}, [settings]);

	if (loading) {
		return <div style={{ color: "#8888a0" }}>Loading settings...</div>;
	}

	return (
		<div style={{ maxWidth: "600px" }}>
			<h1 style={{ fontSize: "20px", color: "#e8e8ed", marginBottom: "20px" }}>
				Settings
			</h1>

			{/* Provider section */}
			<Section title="Provider">
				<Label text="Default Provider">
					<select
						value={settings.defaultProvider}
						onChange={(e) => update("defaultProvider", (e.target as HTMLSelectElement).value)}
						style={inputStyle}
					>
						<option value="">Auto-detect</option>
						{providers.map((p) => (
							<option key={p.id} value={p.id}>{p.name ?? p.id}</option>
						))}
					</select>
				</Label>
				<Label text="Default Model">
					<input
						type="text"
						value={settings.defaultModel}
						onInput={(e) => update("defaultModel", (e.target as HTMLInputElement).value)}
						placeholder="e.g. claude-sonnet-4-5-20250929"
						style={inputStyle}
					/>
				</Label>
			</Section>

			{/* Budget section */}
			<Section title="Budget">
				<Label text={`Max Session Cost: $${settings.budget.maxSessionCost.toFixed(2)}`}>
					<input
						type="range"
						min="0.1"
						max="20"
						step="0.1"
						value={settings.budget.maxSessionCost}
						onInput={(e) => updateBudget("maxSessionCost", parseFloat((e.target as HTMLInputElement).value))}
						style={{ width: "100%" }}
					/>
				</Label>
				<Label text={`Max Daily Cost: $${settings.budget.maxDailyCost.toFixed(2)}`}>
					<input
						type="range"
						min="1"
						max="100"
						step="1"
						value={settings.budget.maxDailyCost}
						onInput={(e) => updateBudget("maxDailyCost", parseFloat((e.target as HTMLInputElement).value))}
						style={{ width: "100%" }}
					/>
				</Label>
				<Label text={`Warning Threshold: ${Math.round(settings.budget.warningThreshold * 100)}%`}>
					<input
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						value={settings.budget.warningThreshold}
						onInput={(e) => updateBudget("warningThreshold", parseFloat((e.target as HTMLInputElement).value))}
						style={{ width: "100%" }}
					/>
				</Label>
			</Section>

			{/* Memory section */}
			<Section title="Memory">
				<Label text="Auto-save sessions">
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<input
							type="checkbox"
							checked={settings.memory.autoSave}
							onChange={(e) => updateMemory("autoSave", (e.target as HTMLInputElement).checked)}
						/>
						<span style={{ color: "#8888a0", fontSize: "13px" }}>
							{settings.memory.autoSave ? "Enabled" : "Disabled"}
						</span>
					</div>
				</Label>
				<Label text={`Search Depth: ${settings.memory.searchDepth}`}>
					<input
						type="range"
						min="1"
						max="20"
						step="1"
						value={settings.memory.searchDepth}
						onInput={(e) => updateMemory("searchDepth", parseInt((e.target as HTMLInputElement).value, 10))}
						style={{ width: "100%" }}
					/>
				</Label>
			</Section>

			{/* Theme section */}
			<Section title="Theme">
				<div style={{ display: "flex", gap: "8px" }}>
					{THEMES.map((t) => (
						<button
							key={t}
							onClick={() => update("theme", t)}
							style={{
								padding: "8px 16px",
								background: settings.theme === t ? "#6366f1" : "#16161e",
								color: settings.theme === t ? "#fff" : "#8888a0",
								border: "1px solid",
								borderColor: settings.theme === t ? "#6366f1" : "#2a2a3a",
								borderRadius: "6px",
								fontSize: "13px",
								cursor: "pointer",
								textTransform: "capitalize",
							}}
						>
							{t}
						</button>
					))}
				</div>
			</Section>

			{/* Save button */}
			<div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "20px" }}>
				<button
					onClick={() => void handleSave()}
					disabled={saving}
					style={{
						padding: "10px 24px",
						background: "#6366f1",
						color: "#fff",
						border: "none",
						borderRadius: "6px",
						fontSize: "14px",
						cursor: saving ? "default" : "pointer",
					}}
				>
					{saving ? "Saving..." : "Save Settings"}
				</button>
				{saved && (
					<span style={{ color: "#22c55e", fontSize: "13px" }}>
						Settings saved successfully.
					</span>
				)}
			</div>
		</div>
	);
}

// ── Helpers ───────────────────────────────────────────────────────

/** Section wrapper with a title. */
function Section({ title, children }: { title: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<div
			style={{
				background: "#16161e",
				border: "1px solid #2a2a3a",
				borderRadius: "8px",
				padding: "16px",
				marginBottom: "16px",
			}}
		>
			<h3 style={{ fontSize: "13px", color: "#8888a0", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
				{title}
			</h3>
			<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
				{children}
			</div>
		</div>
	);
}

/** Labelled form field. */
function Label({ text, children }: { text: string; children: preact.ComponentChildren }): preact.JSX.Element {
	return (
		<div>
			<div style={{ fontSize: "12px", color: "#8888a0", marginBottom: "4px" }}>{text}</div>
			{children}
		</div>
	);
}

const inputStyle: preact.JSX.CSSProperties = {
	width: "100%",
	padding: "8px 10px",
	background: "#0a0a0f",
	border: "1px solid #2a2a3a",
	borderRadius: "6px",
	color: "#e8e8ed",
	fontSize: "13px",
	outline: "none",
};
