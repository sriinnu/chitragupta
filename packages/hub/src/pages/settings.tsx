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

// ── Types ─────────────────────────────────────────────────────────

/** Application settings shape from the API. */
interface AppSettings {
	defaultProvider: string;
	defaultModel: string;
	providerPriority: string[];
	maxSessionCost: number;
	maxDailyCost: number;
	warningThreshold: number;
	memoryAutoSave: boolean;
	memorySearchDepth: number;
	theme: string;
}

/** Available providers for the dropdown. */
interface ProviderOption {
	id: string;
	name: string;
}

// ── Constants ─────────────────────────────────────────────────────

const THEMES = ["dark", "light", "system"];

const DEFAULT_SETTINGS: AppSettings = {
	defaultProvider: "",
	defaultModel: "",
	providerPriority: [],
	maxSessionCost: 1.0,
	maxDailyCost: 10.0,
	warningThreshold: 0.8,
	memoryAutoSave: true,
	memorySearchDepth: 5,
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
	const [providers, setProviders] = useState<ProviderOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		void Promise.all([
			apiGet<AppSettings>("/api/settings").catch(() => DEFAULT_SETTINGS),
			apiGet<ProviderOption[]>("/api/providers").catch(() => []),
		]).then(([s, p]) => {
			setSettings(s);
			setProviders(p);
			setLoading(false);
		});
	}, []);

	const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
		setSaved(false);
		setSettings((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			await apiPut("/api/settings", settings);
			setSaved(true);
		} catch {
			// Save error
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
				<Label text="Provider Priority (comma-separated)">
					<input
						type="text"
						value={settings.providerPriority.join(", ")}
						onInput={(e) =>
							update(
								"providerPriority",
								(e.target as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean),
							)
						}
						placeholder="anthropic, openai, ollama"
						style={inputStyle}
					/>
				</Label>
			</Section>

			{/* Budget section */}
			<Section title="Budget">
				<Label text={`Max Session Cost: $${settings.maxSessionCost.toFixed(2)}`}>
					<input
						type="range"
						min="0.1"
						max="20"
						step="0.1"
						value={settings.maxSessionCost}
						onInput={(e) => update("maxSessionCost", parseFloat((e.target as HTMLInputElement).value))}
						style={{ width: "100%" }}
					/>
				</Label>
				<Label text={`Max Daily Cost: $${settings.maxDailyCost.toFixed(2)}`}>
					<input
						type="range"
						min="1"
						max="100"
						step="1"
						value={settings.maxDailyCost}
						onInput={(e) => update("maxDailyCost", parseFloat((e.target as HTMLInputElement).value))}
						style={{ width: "100%" }}
					/>
				</Label>
				<Label text={`Warning Threshold: ${Math.round(settings.warningThreshold * 100)}%`}>
					<input
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						value={settings.warningThreshold}
						onInput={(e) => update("warningThreshold", parseFloat((e.target as HTMLInputElement).value))}
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
							checked={settings.memoryAutoSave}
							onChange={(e) => update("memoryAutoSave", (e.target as HTMLInputElement).checked)}
						/>
						<span style={{ color: "#8888a0", fontSize: "13px" }}>
							{settings.memoryAutoSave ? "Enabled" : "Disabled"}
						</span>
					</div>
				</Label>
				<Label text={`Search Depth: ${settings.memorySearchDepth}`}>
					<input
						type="range"
						min="1"
						max="20"
						step="1"
						value={settings.memorySearchDepth}
						onInput={(e) => update("memorySearchDepth", parseInt((e.target as HTMLInputElement).value, 10))}
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
