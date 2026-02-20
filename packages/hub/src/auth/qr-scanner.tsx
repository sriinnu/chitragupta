/**
 * QR code scanning UI for device pairing.
 *
 * Provides a camera preview for scanning QR codes, plus a manual
 * token entry fallback. Parses `chitragupta://pair?token=...` URLs.
 * Actual QR decoding is deferred (frame capture only for now).
 * @module auth/qr-scanner
 */

import { useState, useRef, useCallback, useEffect } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the QR scanner component. */
export interface QrScannerProps {
	/** Callback invoked with the extracted pairing token. */
	onSubmit: (token: string) => void;
	/** Whether submission is in progress. */
	loading?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Extract the token from a `chitragupta://pair?token=...` URL.
 * Returns `null` if the URL does not match the expected format.
 */
function parsePairingUrl(input: string): string | null {
	const trimmed = input.trim();
	// Accept both chitragupta:// and plain token strings
	if (trimmed.startsWith("chitragupta://pair")) {
		try {
			// Replace custom scheme with https for URL parsing
			const url = new URL(trimmed.replace("chitragupta://", "https://placeholder/"));
			return url.searchParams.get("token");
		} catch {
			return null;
		}
	}
	// Accept raw tokens (hex or base64-ish)
	if (/^[a-zA-Z0-9_-]{16,}$/.test(trimmed)) {
		return trimmed;
	}
	return null;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * QR scanning UI with camera preview and manual token entry fallback.
 *
 * The "Open Camera" button requests media access and shows a video
 * preview. Frame capture is implemented but actual QR decoding is a
 * TODO. A manual text field accepts pasted `chitragupta://pair?token=`
 * URLs or raw tokens.
 */
export function QrScanner({ onSubmit, loading }: QrScannerProps): preact.JSX.Element {
	const [cameraActive, setCameraActive] = useState(false);
	const [cameraError, setCameraError] = useState<string | null>(null);
	const [manualToken, setManualToken] = useState("");
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);

	const startCamera = useCallback(async () => {
		setCameraError(null);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "environment" },
			});
			streamRef.current = stream;
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				await videoRef.current.play();
			}
			setCameraActive(true);
		} catch {
			setCameraError("Could not access camera. Please grant permission or use manual entry.");
		}
	}, []);

	const stopCamera = useCallback(() => {
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		setCameraActive(false);
	}, []);

	// Clean up camera on unmount
	useEffect(() => {
		return () => stopCamera();
	}, [stopCamera]);

	const handleManualSubmit = useCallback(() => {
		const token = parsePairingUrl(manualToken);
		if (token) {
			onSubmit(token);
		}
	}, [manualToken, onSubmit]);

	const manualTokenValid = parsePairingUrl(manualToken) !== null;

	return (
		<div>
			{/* Camera section */}
			<div style={{ marginBottom: "20px" }}>
				{!cameraActive ? (
					<button
						onClick={startCamera}
						style={{
							padding: "10px 24px",
							background: "#6366f1",
							color: "#fff",
							border: "none",
							borderRadius: "6px",
							fontSize: "14px",
							cursor: "pointer",
							width: "100%",
							marginBottom: "8px",
						}}
					>
						Open Camera
					</button>
				) : (
					<button
						onClick={stopCamera}
						style={{
							padding: "8px 16px",
							background: "#2a2a3a",
							color: "#e8e8ed",
							border: "none",
							borderRadius: "6px",
							fontSize: "13px",
							cursor: "pointer",
							marginBottom: "8px",
						}}
					>
						Close Camera
					</button>
				)}

				{cameraError && (
					<div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "8px" }}>
						{cameraError}
					</div>
				)}

				{cameraActive && (
					<div>
						<video
							ref={videoRef}
							style={{
								width: "100%",
								maxWidth: "320px",
								borderRadius: "8px",
								border: "1px solid #2a2a3a",
								background: "#000",
							}}
							playsInline
							muted
						/>
						<div style={{ color: "#8888a0", fontSize: "12px", marginTop: "8px" }}>
							Point your camera at the QR code in your terminal.
							QR decoding coming soon - use manual entry below for now.
						</div>
					</div>
				)}
			</div>

			{/* Divider */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "12px",
					margin: "16px 0",
					color: "#8888a0",
					fontSize: "12px",
				}}
			>
				<div style={{ flex: 1, height: "1px", background: "#2a2a3a" }} />
				<span>or enter token manually</span>
				<div style={{ flex: 1, height: "1px", background: "#2a2a3a" }} />
			</div>

			{/* Manual entry */}
			<div>
				<input
					type="text"
					value={manualToken}
					onInput={(e) => setManualToken((e.target as HTMLInputElement).value)}
					placeholder="chitragupta://pair?token=... or paste token"
					style={{
						width: "100%",
						padding: "10px 12px",
						background: "#16161e",
						border: "1px solid #2a2a3a",
						borderRadius: "6px",
						color: "#e8e8ed",
						fontSize: "13px",
						outline: "none",
						marginBottom: "8px",
					}}
				/>
				<button
					disabled={!manualTokenValid || loading}
					onClick={handleManualSubmit}
					style={{
						padding: "10px 24px",
						background: manualTokenValid && !loading ? "#6366f1" : "#2a2a3a",
						color: manualTokenValid && !loading ? "#fff" : "#8888a0",
						border: "none",
						borderRadius: "6px",
						fontSize: "14px",
						cursor: manualTokenValid && !loading ? "pointer" : "default",
						width: "100%",
					}}
				>
					{loading ? "Verifying..." : "Submit Token"}
				</button>
			</div>
		</div>
	);
}
