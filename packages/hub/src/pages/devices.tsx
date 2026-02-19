/**
 * Device management page for the Chitragupta Hub.
 *
 * Lists all paired devices and allows revoking access. Also provides
 * a button to generate a new pairing challenge for additional devices.
 * @module pages/devices
 */

import { useEffect, useState, useCallback } from "preact/hooks";
import { apiGet, apiDelete, apiPost } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Paired device entry normalized for the frontend. */
interface DeviceEntry {
	id: string;
	name: string;
	browser: string;
	pairedAt: string;
	lastSeen: string;
}

/** Raw device entry as returned by the backend (timestamps are Unix ms). */
interface RawDeviceEntry {
	id: string;
	name: string;
	browser: string;
	pairedAt: number;
	lastSeen: number;
}

/** Wrapped devices response from the API. */
interface DevicesResponse {
	devices: RawDeviceEntry[];
}

/** Convert a raw device entry (Unix ms timestamps) to a normalized entry (ISO strings). */
function normalizeDevice(raw: RawDeviceEntry): DeviceEntry {
	return {
		id: raw.id,
		name: raw.name,
		browser: raw.browser,
		pairedAt: new Date(raw.pairedAt).toISOString(),
		lastSeen: new Date(raw.lastSeen).toISOString(),
	};
}

// ── Helpers ───────────────────────────────────────────────────────

/** Format ISO string to short readable date. */
function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Device management page.
 *
 * Fetches paired devices from GET `/api/pair/devices` and displays
 * them in a list. Each device shows its name, browser, pairing date,
 * and last seen timestamp, with a Revoke button for access removal.
 */
export function Devices(): preact.JSX.Element {
	const [devices, setDevices] = useState<DeviceEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [challengeUrl, setChallengeUrl] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const data = await apiGet<DevicesResponse>("/api/pair/devices");
			setDevices((data.devices ?? []).map(normalizeDevice));
		} catch {
			// best-effort
		}
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
	}, [refresh]);

	const handleRevoke = useCallback(async (id: string, name: string) => {
		if (!confirm(`Revoke access for "${name}"? This device will need to pair again.`)) return;
		try {
			await apiDelete(`/api/pair/devices/${id}`);
			await refresh();
		} catch {
			// best-effort
		}
	}, [refresh]);

	const handleNewChallenge = useCallback(async () => {
		setGenerating(true);
		setChallengeUrl(null);
		try {
			const result = await apiPost<{ url: string }>("/api/pair/challenge");
			setChallengeUrl(result.url);
		} catch {
			// best-effort
		} finally {
			setGenerating(false);
		}
	}, []);

	return (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
				<h1 style={{ fontSize: "20px", color: "#e8e8ed" }}>Devices</h1>
				<button
					onClick={() => void handleNewChallenge()}
					disabled={generating}
					style={{
						padding: "8px 16px",
						background: "#6366f1",
						color: "#fff",
						border: "none",
						borderRadius: "6px",
						fontSize: "13px",
						cursor: generating ? "default" : "pointer",
					}}
				>
					{generating ? "Generating..." : "New Pairing Challenge"}
				</button>
			</div>

			{/* Challenge URL display */}
			{challengeUrl && (
				<div
					style={{
						background: "rgba(99,102,241,0.1)",
						border: "1px solid rgba(99,102,241,0.3)",
						borderRadius: "8px",
						padding: "12px 16px",
						marginBottom: "16px",
					}}
				>
					<div style={{ fontSize: "12px", color: "#8888a0", marginBottom: "4px" }}>
						Share this URL with the new device:
					</div>
					<code
						style={{
							fontSize: "13px",
							color: "#6366f1",
							wordBreak: "break-all",
						}}
					>
						{challengeUrl}
					</code>
				</div>
			)}

			{loading && <div style={{ color: "#8888a0" }}>Loading devices...</div>}

			{!loading && devices.length === 0 && (
				<div style={{ color: "#8888a0", fontSize: "13px" }}>
					No paired devices found.
				</div>
			)}

			{/* Device list */}
			{devices.map((device) => (
				<div
					key={device.id}
					style={{
						background: "#16161e",
						border: "1px solid #2a2a3a",
						borderRadius: "8px",
						padding: "14px 16px",
						marginBottom: "10px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<div>
						<div style={{ color: "#e8e8ed", fontSize: "14px", fontWeight: 600, marginBottom: "2px" }}>
							{device.name}
						</div>
						<div style={{ color: "#8888a0", fontSize: "12px" }}>
							{device.browser} | Paired: {formatDate(device.pairedAt)} | Last seen: {formatDate(device.lastSeen)}
						</div>
					</div>
					<button
						onClick={() => void handleRevoke(device.id, device.name)}
						style={{
							padding: "6px 12px",
							background: "rgba(239,68,68,0.1)",
							color: "#ef4444",
							border: "1px solid rgba(239,68,68,0.3)",
							borderRadius: "4px",
							fontSize: "12px",
							cursor: "pointer",
						}}
					>
						Revoke
					</button>
				</div>
			))}
		</div>
	);
}
