/**
 * Pairing flow orchestrator for device authentication.
 *
 * Fetches a pairing challenge from the server, presents four method
 * tabs (Passphrase, QR Code, Visual Match, Number Code), and handles
 * verification. On success, stores the JWT and redirects to overview.
 * @module auth/pairing
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import { apiPost, apiGet } from "../api.js";
import { setToken, deviceId } from "../signals/auth.js";
import { PassphraseEntry } from "./passphrase-entry.js";
import { VisualMatch } from "./visual-match.js";
import { QrScanner } from "./qr-scanner.js";

// ── Types ─────────────────────────────────────────────────────────

/** Pairing methods available for verification. */
type PairingMethod = "passphrase" | "qr" | "visual" | "number";

/** Challenge data returned by the server. */
interface PairingChallenge {
	challengeId: string;
	methods: string[];
	expiresAt: string;
	locked?: boolean;
	lockExpiresAt?: string;
}

/** Verification response from the server. */
interface VerifyResponse {
	token: string;
}

/** Tab definition for method selection. */
interface MethodTab {
	id: PairingMethod;
	label: string;
}

// ── Constants ─────────────────────────────────────────────────────

const TABS: MethodTab[] = [
	{ id: "passphrase", label: "Passphrase" },
	{ id: "qr", label: "QR Code" },
	{ id: "visual", label: "Visual Match" },
	{ id: "number", label: "Number Code" },
];

// ── Component ─────────────────────────────────────────────────────

/**
 * Pairing flow orchestrator.
 *
 * Fetches a challenge from `/api/pair/challenge`, presents method tabs,
 * and handles verification. Shows a "locked" state with countdown if
 * too many attempts have failed.
 */
export function Pairing(): preact.JSX.Element {
	const [challenge, setChallenge] = useState<PairingChallenge | null>(null);
	const [activeTab, setActiveTab] = useState<PairingMethod>("passphrase");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [lockCountdown, setLockCountdown] = useState<number | null>(null);

	// Fetch the challenge on mount
	useEffect(() => {
		let mounted = true;
		async function fetchChallenge(): Promise<void> {
			try {
				const data = await apiGet<PairingChallenge>("/api/pair/challenge");
				if (mounted) setChallenge(data);
			} catch {
				if (mounted) setError("Could not fetch pairing challenge. Is the server running?");
			}
		}
		void fetchChallenge();
		return () => { mounted = false; };
	}, []);

	// Lock countdown timer
	useEffect(() => {
		if (!challenge?.locked || !challenge.lockExpiresAt) {
			setLockCountdown(null);
			return;
		}
		const updateCountdown = (): void => {
			const remaining = Math.max(0, new Date(challenge.lockExpiresAt!).getTime() - Date.now());
			setLockCountdown(Math.ceil(remaining / 1000));
		};
		updateCountdown();
		const interval = setInterval(updateCountdown, 1000);
		return () => clearInterval(interval);
	}, [challenge?.locked, challenge?.lockExpiresAt]);

	const handleVerify = useCallback(async (method: PairingMethod, proof: unknown) => {
		if (!challenge) return;
		setError(null);
		setLoading(true);
		try {
			const response = await apiPost<VerifyResponse>("/api/pair/verify", {
				challengeId: challenge.challengeId,
				method,
				proof,
				deviceId: deviceId.value,
			});
			setToken(response.token);
			window.location.hash = "#/";
		} catch (err) {
			const message = err instanceof Error ? err.message : "Verification failed";
			setError(message);
		} finally {
			setLoading(false);
		}
	}, [challenge]);

	// ── Render locked state ────────────────────────────────────

	if (challenge?.locked && lockCountdown !== null && lockCountdown > 0) {
		return (
			<div style={{ maxWidth: "440px", margin: "40px auto", textAlign: "center" }}>
				<div style={{ fontSize: "48px", marginBottom: "16px" }}>{"\uD83D\uDD12"}</div>
				<h2 style={{ color: "#e8e8ed", marginBottom: "8px" }}>Pairing Locked</h2>
				<p style={{ color: "#8888a0", marginBottom: "16px" }}>
					Too many failed attempts. Try again in:
				</p>
				<div style={{ fontSize: "32px", fontWeight: "bold", color: "#ef4444" }}>
					{lockCountdown}s
				</div>
			</div>
		);
	}

	// ── Render pairing UI ──────────────────────────────────────

	return (
		<div style={{ maxWidth: "440px", margin: "40px auto" }}>
			<h2 style={{ color: "#e8e8ed", marginBottom: "4px", fontSize: "20px" }}>
				Pair This Device
			</h2>
			<p style={{ color: "#8888a0", fontSize: "13px", marginBottom: "24px" }}>
				Verify your identity to connect this browser to Chitragupta.
			</p>

			{error && (
				<div
					style={{
						background: "rgba(239, 68, 68, 0.1)",
						border: "1px solid rgba(239, 68, 68, 0.3)",
						borderRadius: "6px",
						padding: "10px 14px",
						color: "#ef4444",
						fontSize: "13px",
						marginBottom: "16px",
					}}
				>
					{error}
				</div>
			)}

			{/* Method tabs */}
			<div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
				{TABS.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						style={{
							flex: 1,
							padding: "8px 4px",
							background: activeTab === tab.id ? "#6366f1" : "#16161e",
							color: activeTab === tab.id ? "#fff" : "#8888a0",
							border: "1px solid",
							borderColor: activeTab === tab.id ? "#6366f1" : "#2a2a3a",
							borderRadius: "6px",
							fontSize: "12px",
							cursor: "pointer",
						}}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Tab content */}
			{activeTab === "passphrase" && (
				<PassphraseEntry
					loading={loading}
					onSubmit={(words) => void handleVerify("passphrase", { words })}
				/>
			)}

			{activeTab === "qr" && (
				<QrScanner
					loading={loading}
					onSubmit={(token) => void handleVerify("qr", { token })}
				/>
			)}

			{activeTab === "visual" && (
				<VisualMatch
					loading={loading}
					onSubmit={(selection) => void handleVerify("visual", { selection })}
				/>
			)}

			{activeTab === "number" && (
				<NumberCodeEntry
					loading={loading}
					onSubmit={(code) => void handleVerify("number", { code })}
				/>
			)}
		</div>
	);
}

// ── Inline number code component (simple) ────────────────────────

/** Props for the number code entry. */
interface NumberCodeProps {
	onSubmit: (code: string) => void;
	loading?: boolean;
}

/**
 * Simple 6-digit number code entry for pairing.
 * The code is displayed in the terminal and typed into this field.
 */
function NumberCodeEntry({ onSubmit, loading }: NumberCodeProps): preact.JSX.Element {
	const [code, setCode] = useState("");
	const isValid = /^\d{6}$/.test(code);

	return (
		<div>
			<p style={{ color: "#8888a0", fontSize: "13px", marginBottom: "12px" }}>
				Enter the 6-digit code shown in your terminal.
			</p>
			<input
				type="text"
				value={code}
				maxLength={6}
				onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
				placeholder="000000"
				style={{
					width: "100%",
					padding: "14px",
					background: "#16161e",
					border: "1px solid #2a2a3a",
					borderRadius: "6px",
					color: "#e8e8ed",
					fontSize: "24px",
					textAlign: "center",
					letterSpacing: "8px",
					outline: "none",
					marginBottom: "12px",
				}}
			/>
			<button
				disabled={!isValid || loading}
				onClick={() => onSubmit(code)}
				style={{
					padding: "10px 24px",
					background: isValid && !loading ? "#6366f1" : "#2a2a3a",
					color: isValid && !loading ? "#fff" : "#8888a0",
					border: "none",
					borderRadius: "6px",
					fontSize: "14px",
					cursor: isValid && !loading ? "pointer" : "default",
					width: "100%",
				}}
			>
				{loading ? "Verifying..." : "Submit Code"}
			</button>
		</div>
	);
}
