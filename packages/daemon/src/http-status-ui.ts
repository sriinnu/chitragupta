/**
 * @chitragupta/daemon — status dashboard renderer.
 *
 * Outputs a self-contained Preact + Signals SPA loaded from esm.sh CDN.
 * Server injects the initial payload as `window.__STATUS__`; the client
 * takes over with reactive updates via long-poll + JSON fetch.
 *
 * No build step required — everything is inline HTML/CSS/JS.
 */

/** Build the status dashboard SPA shell. Signature unchanged from v1. */
export function renderStatusDashboard(payload: Record<string, unknown>): string {
	// Escape </script> in payload to prevent injection.
	const safePayload = JSON.stringify(payload)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chitragupta Status</title>
<style>
${CSS_BLOCK}
</style>
</head>
<body>
<div id="app"><div class="container" style="padding-top:80px;text-align:center;color:#95b5cb;">Loading dashboard…</div></div>
<script>window.__STATUS__=${safePayload};</script>
<script type="module">
${JS_MODULE}
</script>
</body>
</html>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────

const CSS_BLOCK = `
:root {
	--bg: #08131d;
	--bg-soft: #102230;
	--card: #142a3a;
	--text: #e7f5ff;
	--muted: #95b5cb;
	--line: #2d4a5f;
	--accent: #22d3ee;
	--green: #22c55e;
	--amber: #f59e0b;
	--coral: #f43f5e;
	--purple: #a78bfa;
	--blue: #60a5fa;
}
* { box-sizing: border-box; margin: 0; }
body {
	font-family: "SF Pro Display", "Inter", -apple-system, sans-serif;
	background:
		radial-gradient(1400px 700px at 10% -20%, #17374c, transparent 62%),
		radial-gradient(1200px 500px at 90% -25%, #1b2f4f, transparent 55%),
		var(--bg);
	color: var(--text);
	-webkit-font-smoothing: antialiased;
}

/* Layout */
.container { max-width: 1360px; margin: 0 auto; padding: 22px; }

/* Topbar */
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 12px; }
.logo { width: 36px; height: 36px; flex: 0 0 36px; }
h1 { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 0.85rem; margin-top: 2px; }
.controls { display: flex; gap: 8px; align-items: center; }

/* Buttons */
button, .btn {
	border: 1px solid var(--line);
	background: rgba(18, 40, 56, 0.8);
	backdrop-filter: blur(8px);
	color: var(--text);
	border-radius: 8px;
	padding: 7px 14px;
	font: inherit;
	font-size: 0.82rem;
	cursor: pointer;
	transition: all 0.2s ease;
}
button:hover, .btn:hover {
	background: rgba(27, 51, 69, 0.9);
	border-color: var(--accent);
	transform: translateY(-1px);
}

/* Links bar */
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.link {
	display: inline-flex; align-items: center;
	border: 1px solid var(--line);
	background: rgba(16, 36, 53, 0.7);
	backdrop-filter: blur(4px);
	color: var(--text);
	text-decoration: none;
	padding: 6px 12px;
	border-radius: 8px;
	font-size: 0.8rem;
	transition: all 0.2s ease;
}
.link:hover { background: rgba(23, 49, 69, 0.9); border-color: var(--accent); }

/* Monitor grid */
.monitor {
	margin-top: 16px;
	display: grid;
	grid-template-columns: minmax(300px, 480px) 1fr;
	gap: 14px;
}
.panel {
	background: linear-gradient(165deg, rgba(20, 42, 58, 0.9), rgba(16, 34, 48, 0.9));
	backdrop-filter: blur(12px);
	border: 1px solid var(--line);
	border-radius: 16px;
	padding: 16px;
	transition: border-color 0.3s ease;
}
.panel:hover { border-color: rgba(34, 211, 238, 0.3); }

/* ECG canvas */
.ecg-wrap { position: relative; width: 100%; }
.ecg-canvas { width: 100%; height: 140px; display: block; border-radius: 10px; }
.ecg-overlay {
	position: absolute; top: 0; left: 0; right: 0; bottom: 0;
	display: flex; flex-direction: column; justify-content: space-between;
	padding: 14px 16px; pointer-events: none;
}
.ecg-state { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
.ecg-value { font-size: 1.3rem; font-weight: 700; }
.ecg-activity { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.ecg-activity-val { font-size: 1rem; font-weight: 600; }

/* Progress ring */
.ring-wrap { display: flex; align-items: center; justify-content: center; }
.ring-circle-bg { fill: none; stroke: #29465c; stroke-width: 10; }
.ring-circle-fg { fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.8s ease-in-out, stroke 0.4s ease; }
.ring-text { fill: var(--text); font-size: 16px; font-weight: 700; }
.ring-label { fill: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; }

/* Nidra meta */
.nidra-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.k { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; }
.v { margin-top: 4px; font-size: 1rem; font-weight: 700; transition: all 0.4s ease; }

/* Stats grid */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 14px; }
.card {
	background: linear-gradient(160deg, rgba(25, 49, 69, 0.8), rgba(19, 39, 54, 0.8));
	backdrop-filter: blur(8px);
	border: 1px solid var(--line);
	border-radius: 12px;
	padding: 14px;
	transition: all 0.3s ease;
}
.card:hover { border-color: rgba(34, 211, 238, 0.25); transform: translateY(-2px); }
.card .v { font-size: 1.25rem; }

/* Pills */
.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.pill {
	border: 1px solid var(--line);
	border-radius: 999px;
	padding: 5px 12px;
	font-size: 0.78rem;
	background: rgba(17, 36, 51, 0.7);
	backdrop-filter: blur(4px);
	transition: all 0.3s ease;
}
.pill:hover { border-color: var(--accent); }

/* Badges */
.badge {
	display: inline-flex; align-items: center; gap: 4px;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 0.72rem;
	font-weight: 600;
	border: 1px solid transparent;
	transition: all 0.3s ease;
}
.tone-good { background: rgba(22, 61, 43, 0.8); border-color: #256844; color: #93e7b6; }
.tone-warn { background: rgba(61, 44, 21, 0.8); border-color: #83602a; color: #fbd38d; }
.tone-calm { background: rgba(27, 48, 70, 0.8); border-color: #325d87; color: #93c5fd; }
.tone-bad  { background: rgba(65, 31, 37, 0.8); border-color: #934354; color: #fdb0bf; }
.tone-muted { background: rgba(31, 47, 61, 0.8); border-color: #3a5569; color: #b6c9d8; }
.tone-purple { background: rgba(55, 35, 85, 0.8); border-color: #6d4ba0; color: #c4b5fd; }

/* Notices */
.notice {
	margin-top: 12px; padding: 12px 14px;
	border-radius: 12px; border: 1px solid var(--line);
	font-size: 0.84rem;
	animation: slideDown 0.3s ease-out;
}
.notice.warn { background: rgba(59, 43, 19, 0.8); border-color: #876028; color: #ffe2ae; }
.notice.error { background: rgba(61, 31, 36, 0.8); border-color: #8d3c4d; color: #ffc0cb; }
@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

/* Table */
table {
	width: 100%; border-collapse: collapse; margin-top: 16px;
	background: rgba(15, 31, 42, 0.8);
	backdrop-filter: blur(8px);
	border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
}
th, td { padding: 10px 12px; border-bottom: 1px solid rgba(35, 66, 86, 0.6); text-align: left; font-size: 0.82rem; vertical-align: top; }
th {
	font-size: 0.7rem; color: var(--muted); text-transform: uppercase;
	letter-spacing: 0.06em; background: rgba(21, 43, 58, 0.9);
	cursor: pointer; user-select: none;
	transition: color 0.2s ease;
}
th:hover { color: var(--accent); }
th .arrow { font-size: 0.55rem; margin-left: 3px; opacity: 0.5; }
th .arrow.active { opacity: 1; color: var(--accent); }
tr { transition: background-color 0.3s ease; }
tr:hover td { background: rgba(19, 40, 56, 0.6); }
td.path { max-width: 340px; word-break: break-all; color: #cde0ed; }
code { background: #1f3546; border: 1px solid #355b77; border-radius: 6px; padding: 1px 5px; font-size: 0.78rem; }
.missing {
	display: inline-block; font-size: 0.72rem;
	padding: 2px 7px; border-radius: 999px;
	border: 1px solid rgba(131, 96, 40, 0.6); background: rgba(59, 43, 19, 0.5); color: #ffdca6;
}

/* Row change flash */
@keyframes rowFlash { 0% { background-color: rgba(34, 211, 238, 0.12); } 100% { background-color: transparent; } }
tr.changed td { animation: rowFlash 1.5s ease-out; }

/* Footer */
.footer {
	margin-top: 14px; color: var(--muted); font-size: 0.78rem;
	display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
}

/* Orb pulse for progress ring */
@keyframes orbPulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.35; } }
.orb { animation: orbPulse 2.4s ease-in-out infinite; }

/* Connection dot */
.conn-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; transition: background-color 0.4s ease; }
.conn-dot.ok { background: var(--green); box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
.conn-dot.err { background: var(--coral); box-shadow: 0 0 6px rgba(244, 63, 94, 0.4); }

/* Responsive */
@media (max-width: 980px) { .monitor { grid-template-columns: 1fr; } }
@media (max-width: 820px) {
	th:nth-child(8), td:nth-child(8), th:nth-child(12), td:nth-child(12), th:nth-child(13), td:nth-child(13) { display: none; }
}
`;

// ─── Client-Side SPA ──────────────────────────────────────────────────

const JS_MODULE = `
import { h, render } from "https://esm.sh/preact@10.25.4";
import { useState, useEffect, useRef, useCallback, useMemo } from "https://esm.sh/preact@10.25.4/hooks";
import { signal, computed, effect } from "https://esm.sh/@preact/signals@1.3.1";
import htm from "https://esm.sh/htm@3.1.1";
const html = htm.bind(h);

// ── Signals ───────────────────────────────────────────────────────────
const statusData = signal(window.__STATUS__);
const autoRefresh = signal(localStorage.getItem("cg.autoRefresh") !== "off");
const connError = signal(null);
const sortCol = signal("toolCallCount");
const sortAsc = signal(false);

const daemon  = computed(() => statusData.value?.daemon ?? {});
const nidra   = computed(() => statusData.value?.nidra ?? {});
const active  = computed(() => statusData.value?.active ?? {});
const dbData  = computed(() => statusData.value?.db ?? {});
const links   = computed(() => statusData.value?.links ?? {});

// ── Helpers ───────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtEpoch(ms) {
	if (!ms || !Number.isFinite(ms)) return "n/a";
	const d = Math.max(0, Math.round((Date.now() - ms) / 1000));
	if (d < 60) return d + "s ago";
	const m = Math.round(d / 60);
	if (m < 60) return m + "m ago";
	const hr = Math.round(m / 60);
	if (hr < 24) return hr + "h ago";
	return new Date(ms).toLocaleDateString();
}

function fmtUptime(s) {
	if (typeof s !== "number" || !Number.isFinite(s)) return "n/a";
	if (s < 60) return Math.round(s) + "s";
	if (s < 3600) return Math.round(s / 60) + "m";
	return (s / 3600).toFixed(1) + "h";
}

function fmtBytes(b) {
	if (typeof b !== "number") return "n/a";
	const mb = b / (1024 * 1024);
	if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
	return Math.round(mb) + " MB";
}

function nidraColor(state) {
	const s = (state || "").toUpperCase();
	if (s === "LISTENING" || s === "IDLE") return "var(--green)";
	if (s === "DREAMING" || s === "CONSOLIDATING") return "var(--amber)";
	if (s === "DEEP_SLEEP" || s === "SLEEPING") return "var(--purple)";
	if (s === "ERROR") return "var(--coral)";
	return "var(--blue)";
}

function nidraTone(state) {
	const s = (state || "").toUpperCase();
	if (s === "LISTENING" || s === "IDLE") return "good";
	if (s === "DREAMING" || s === "CONSOLIDATING") return "warn";
	if (s === "DEEP_SLEEP" || s === "SLEEPING") return "purple";
	if (s === "ERROR") return "bad";
	return "calm";
}

// ── Data Fetching ─────────────────────────────────────────────────────
async function fetchFresh() {
	const res = await fetch("/status?format=json", { cache: "no-store" });
	statusData.value = await res.json();
}

async function watchLoop() {
	while (true) {
		if (!autoRefresh.value) { await sleep(1000); continue; }
		try {
			const fp = statusData.value?.active?.fingerprint ?? "";
			const res = await fetch("/telemetry/watch?fingerprint=" + encodeURIComponent(fp) + "&timeout=25000", { cache: "no-store" });
			const data = await res.json();
			connError.value = null;
			if (data.changed) await fetchFresh();
			await sleep(50);
		} catch (err) {
			connError.value = err.message;
			await sleep(2500);
		}
	}
}

// Periodic full refresh for non-telemetry stats (DB/Nidra).
setInterval(() => { if (autoRefresh.value) fetchFresh().catch(() => {}); }, 30000);

// ── Prāṇa: Live ECG Canvas ───────────────────────────────────────────
//
// The ECG is the daemon's prāṇa (life breath). It feeds on real metrics:
// - heartbeatSeq from instances (actual heartbeat rate)
// - connection count (baseline vitality)
// - nidra heartbeat delta (consolidation pulse)
// - tool call / request activity (excitation spikes)
//
// Each state has fundamentally different organic character:
// LISTENING/IDLE: calm resting heartbeat, gentle, regular, alive but at peace
// ACTIVE/BUSY: elevated HR, sharp QRS peaks, occasional extra beats from tool calls
// DREAMING: theta-wave rhythm, slow rolling waves with dream spikes (REM bursts)
// DEEP_SLEEP: deep slow delta waves, barely there, like watching breath rise and fall
// ERROR: arrhythmic, irregular intervals, missed beats, tremor

// Vitals buffer — real metrics pushed from data fetches.
const vitals = {
	heartbeatSeq: 0,
	prevHeartbeatSeq: 0,
	connections: 0,
	requestRate: 0,       // requests/sec across all instances
	lastToolCallAge: 999, // seconds since last tool call
	nidraHeartbeatAge: 0, // seconds since nidra last heartbeat
	consolidationProg: 0,
	prevTimestamp: Date.now(),
};

// Update vitals from signal changes.
effect(() => {
	const s = statusData.value;
	if (!s) return;
	const instances = s.active?.instances ?? [];
	const totalReqs = instances.reduce((sum, i) => sum + (i.toolCallCount ?? 0), 0);
	const now = Date.now();
	const dt = Math.max(0.1, (now - vitals.prevTimestamp) / 1000);

	vitals.prevHeartbeatSeq = vitals.heartbeatSeq;
	vitals.heartbeatSeq = instances.reduce((sum, i) => sum + (i.heartbeatSeq ?? 0), 0) || (s.daemon?.connections ?? 0) * 10;
	vitals.connections = s.daemon?.connections ?? 0;
	vitals.requestRate = Math.abs(totalReqs - vitals.requestRate) / dt;
	vitals.consolidationProg = s.nidra?.consolidationProgress ?? 0;
	vitals.prevTimestamp = now;

	// Nidra heartbeat age.
	if (s.nidra?.lastHeartbeat) {
		vitals.nidraHeartbeatAge = (now - s.nidra.lastHeartbeat) / 1000;
	}
	// Last tool call age.
	const lastTool = Math.max(...instances.map(i => i.lastToolCallAt ?? 0), 0);
	vitals.lastToolCallAge = lastTool > 0 ? (now - lastTool) / 1000 : 999;
});

function useEcg(canvasRef) {
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		const dpr = window.devicePixelRatio || 1;
		let frameId;
		let t = 0;         // continuous time counter
		let phase = 0;     // organic phase (not locked to clock)

		// Perlin-ish noise for organic variation.
		const noise = (() => {
			const p = Array.from({length: 256}, () => Math.random());
			return (x) => {
				const i = Math.floor(x) & 255;
				const f = x - Math.floor(x);
				const u = f * f * (3 - 2 * f); // smoothstep
				return p[i] * (1 - u) + p[(i + 1) & 255] * u;
			};
		})();

		function resize() {
			const r = canvas.getBoundingClientRect();
			canvas.width = r.width * dpr;
			canvas.height = r.height * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		resize();

		// ── Waveform generators per state ──────────────────────

		// Medical-grade QRS complex with organic variation.
		function qrs(x, period, amp, jitter) {
			const c = (x + noise(x * 0.01) * jitter) % period;
			const n = c / period;
			// P wave — atrial depolarization
			if (n < 0.06) return -amp * 0.12 * Math.sin(n / 0.06 * Math.PI);
			// PR segment — brief flat
			if (n < 0.12) return 0;
			// Q dip
			if (n > 0.12 && n < 0.14) return -amp * 0.08;
			// R peak — ventricular depolarization (sharp spike)
			if (n > 0.14 && n < 0.18) {
				const rn = (n - 0.14) / 0.04;
				return amp * (1 - Math.abs(rn * 2 - 1)) * (1 + noise(x * 0.03) * 0.15);
			}
			// S dip — rebound
			if (n > 0.18 && n < 0.22) return -amp * 0.35 * (1 - (n - 0.18) / 0.04);
			// ST segment
			if (n < 0.32) return amp * 0.02 * noise(x * 0.05);
			// T wave — ventricular repolarization
			if (n > 0.32 && n < 0.48) return amp * 0.18 * Math.sin((n - 0.32) / 0.16 * Math.PI);
			// Baseline with micro-noise (living tissue is never truly flat)
			return amp * 0.015 * (noise(x * 0.1) - 0.5);
		}

		// Listening: calm, alert, regular. Like a resting monk — present, aware.
		function waveListening(x) {
			const hr = 72;  // BPM equivalent
			const period = 120 * (60 / hr);  // px per heartbeat
			const amp = 28 + noise(t * 0.002) * 4;  // subtle breathing modulation
			return qrs(x, period, amp, 2);
		}

		// Active: elevated HR, stronger peaks, occasional extra systoles from tool calls.
		function waveActive(x) {
			const baseHr = 95 + vitals.connections * 2;  // more connections = higher HR
			const period = 120 * (60 / Math.min(130, baseHr));
			const amp = 36 + noise(t * 0.003) * 6;
			let y = qrs(x, period, amp, 1.5);
			// Tool call excitation: recent tool calls add premature ventricular contractions.
			if (vitals.lastToolCallAge < 30) {
				const extraPeriod = period * 0.6;
				const intensity = Math.max(0, 1 - vitals.lastToolCallAge / 30) * 0.4;
				y += qrs(x + period * 0.3, extraPeriod, amp * intensity, 3);
			}
			return y;
		}

		// Dreaming: REM-like theta waves with intermittent dream bursts.
		// Not regular QRS — rolling waves with sudden spiky clusters.
		function waveDreaming(x) {
			// Base theta rhythm (4-8 Hz equivalent, here ~6 cycles per screen width).
			const theta = 10 * Math.sin(x * 0.045 + noise(t * 0.001) * 2);
			// Slow delta undertone.
			const delta = 6 * Math.sin(x * 0.015 + t * 0.0003);
			// REM burst: clusters of rapid sharp waves, appearing pseudo-randomly.
			const burstPhase = noise(x * 0.005 + t * 0.0008);
			let rem = 0;
			if (burstPhase > 0.65) {
				const intensity = (burstPhase - 0.65) / 0.35;
				rem = intensity * 22 * Math.sin(x * 0.18 + t * 0.004) * noise(x * 0.03);
			}
			// Consolidation progress modulates overall amplitude.
			const progBoost = 1 + vitals.consolidationProg * 0.5;
			return (theta + delta + rem) * progBoost;
		}

		// Deep Sleep (Suṣupti): deep, slow delta waves. The breath of unconsciousness.
		// Almost nothing happening — just the deepest rhythm of being.
		function waveDeepSleep(x) {
			// Delta waves: 0.5-4 Hz, here very slow rolling.
			const delta = 12 * Math.sin(x * 0.012 + t * 0.00015);
			// Even slower respiratory modulation.
			const breath = 4 * Math.sin(x * 0.005 + t * 0.0001);
			// Micro-arousals: very faint, very rare flickers.
			const flicker = noise(x * 0.02 + t * 0.0005) > 0.85
				? 5 * Math.sin(x * 0.12) * (noise(x * 0.02 + t * 0.0005) - 0.85) / 0.15
				: 0;
			return delta + breath + flicker;
		}

		// Error: arrhythmic, chaotic. Irregular R-R intervals, dropped beats, tremor.
		function waveError(x) {
			// Irregular heartbeat — period varies chaotically.
			const basePeriod = 80 + noise(x * 0.008) * 60;  // 80-140px, very irregular
			const amp = 25 + noise(x * 0.015 + t * 0.005) * 20;  // amplitude instability
			let y = qrs(x, basePeriod, amp, 15);  // high jitter
			// Baseline wander (electrode drift / DC offset instability).
			y += 8 * Math.sin(x * 0.008 + t * 0.003);
			// Fine tremor.
			y += 3 * (noise(x * 0.2 + t * 0.01) - 0.5);
			return y;
		}

		function getWave(x) {
			const s = (nidra.value?.state || "").toUpperCase();
			switch (s) {
				case "LISTENING": case "IDLE": return waveListening(x);
				case "ACTIVE": case "BUSY": return waveActive(x);
				case "DREAMING": case "CONSOLIDATING": return waveDreaming(x);
				case "DEEP_SLEEP": case "SLEEPING": case "SUSHUPTA": return waveDeepSleep(x);
				case "ERROR": return waveError(x);
				default: return waveListening(x);
			}
		}

		function getSpeed() {
			const s = (nidra.value?.state || "").toUpperCase();
			switch (s) {
				case "ACTIVE": case "BUSY": return 2.0;
				case "DREAMING": case "CONSOLIDATING": return 1.2;
				case "DEEP_SLEEP": case "SLEEPING": case "SUSHUPTA": return 0.4;
				case "ERROR": return 2.5;
				default: return 1.0;  // listening/idle
			}
		}

		function getColors() {
			const s = (nidra.value?.state || "").toUpperCase();
			switch (s) {
				case "LISTENING": case "IDLE":
					return { trace: ["#22c55e", "#34d399"], glow: "rgba(34, 197, 94, 0.12)", grid: "rgba(34, 197, 94, 0.08)" };
				case "ACTIVE": case "BUSY":
					return { trace: ["#22d3ee", "#06b6d4"], glow: "rgba(34, 211, 238, 0.15)", grid: "rgba(34, 211, 238, 0.08)" };
				case "DREAMING": case "CONSOLIDATING":
					return { trace: ["#f59e0b", "#f97316"], glow: "rgba(245, 158, 11, 0.12)", grid: "rgba(245, 158, 11, 0.06)" };
				case "DEEP_SLEEP": case "SLEEPING": case "SUSHUPTA":
					return { trace: ["#a78bfa", "#818cf8"], glow: "rgba(167, 139, 250, 0.08)", grid: "rgba(139, 92, 246, 0.05)" };
				case "ERROR":
					return { trace: ["#f43f5e", "#ef4444"], glow: "rgba(244, 63, 94, 0.15)", grid: "rgba(239, 68, 68, 0.08)" };
				default:
					return { trace: ["#22d3ee", "#60a5fa"], glow: "rgba(34, 211, 238, 0.1)", grid: "rgba(34, 211, 238, 0.06)" };
			}
		}

		function draw() {
			const w = canvas.getBoundingClientRect().width;
			const ht = canvas.getBoundingClientRect().height;
			const mid = ht * 0.52;
			const colors = getColors();
			ctx.clearRect(0, 0, w, ht);

			// ── Grid: subtle, state-colored ──
			ctx.strokeStyle = colors.grid;
			ctx.lineWidth = 0.5;
			for (let y = 0; y < ht; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
			for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ht); ctx.stroke(); }

			// ── Baseline reference ──
			ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 8]);
			ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
			ctx.setLineDash([]);

			// ── Trace gradient ──
			const [c1, c2] = colors.trace;
			const grad = ctx.createLinearGradient(0, 0, w, 0);
			grad.addColorStop(0, c1); grad.addColorStop(1, c2);

			// Build the waveform path once.
			const points = [];
			for (let x = 0; x < w; x += 1) {
				points.push({ x, y: mid - getWave(x + phase) });
			}

			// ── Glow pass (wide, translucent) ──
			ctx.save();
			ctx.strokeStyle = colors.glow;
			ctx.lineWidth = 12;
			ctx.globalAlpha = 0.3;
			ctx.lineJoin = "round"; ctx.lineCap = "round";
			ctx.beginPath();
			points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
			ctx.stroke();
			ctx.restore();

			// ── Medium glow ──
			ctx.save();
			ctx.strokeStyle = grad;
			ctx.lineWidth = 5;
			ctx.globalAlpha = 0.2;
			ctx.lineJoin = "round"; ctx.lineCap = "round";
			ctx.beginPath();
			points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
			ctx.stroke();
			ctx.restore();

			// ── Sharp trace ──
			ctx.strokeStyle = grad;
			ctx.lineWidth = 2;
			ctx.lineJoin = "round"; ctx.lineCap = "round";
			ctx.beginPath();
			points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
			ctx.stroke();

			// ── Leading dot (the "now" point) ──
			const lastPt = points[points.length - 1];
			if (lastPt) {
				ctx.beginPath();
				ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2);
				ctx.fillStyle = c2;
				ctx.fill();
				// Dot glow.
				ctx.beginPath();
				ctx.arc(lastPt.x, lastPt.y, 7, 0, Math.PI * 2);
				ctx.fillStyle = colors.glow;
				ctx.fill();
			}

			t++;
			phase += getSpeed();
			frameId = requestAnimationFrame(draw);
		}

		draw();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);
		return () => { cancelAnimationFrame(frameId); ro.disconnect(); };
	}, []);
}

// ── Components ────────────────────────────────────────────────────────

function Logo() {
	return html\`<svg class="logo" viewBox="0 0 64 64" role="img">
		<defs><linearGradient id="cg-g" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#34d399"/>
		</linearGradient></defs>
		<rect x="5" y="5" width="54" height="54" rx="14" fill="#0f2231" stroke="#2d4a5f" stroke-width="2"/>
		<path d="M14 34h11l5-10 6 18 5-11h9" stroke="url(#cg-g)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
		<circle cx="44" cy="22" r="4" fill="#9de8ff"/>
	</svg>\`;
}

function Header() {
	const d = daemon.value;
	const n = nidra.value;
	const toggleAuto = () => {
		autoRefresh.value = !autoRefresh.value;
		localStorage.setItem("cg.autoRefresh", autoRefresh.value ? "on" : "off");
	};
	return html\`
		<div class="topbar">
			<div class="brand">
				<\${Logo} />
				<div>
					<h1>Chitragupta Runtime Monitor</h1>
					<div class="sub">
						<span class="conn-dot \${connError.value ? 'err' : 'ok'}"></span>
						pid \${d.pid ?? "n/a"} · nidra \${(n.state || "unknown").toUpperCase()} · \${(n.activity || "idle").toLowerCase()}
						\${d.memory ? " · " + fmtBytes(typeof d.memory === "number" ? d.memory : d.memory?.rss ?? 0) : ""}
					</div>
				</div>
			</div>
			<div class="controls">
				<span class="sub">\${autoRefresh.value ? "Live" : "Paused"}</span>
				<button onClick=\${toggleAuto}>\${autoRefresh.value ? "Pause" : "Resume"}</button>
				<button onClick=\${() => fetchFresh()}>Refresh</button>
			</div>
		</div>
		<div class="links">
			<a class="link" href="/status/ui">Status UI</a>
			<a class="link" href="/status?format=json">JSON</a>
			<a class="link" href="/telemetry/instances">Instances</a>
			<a class="link" href="/telemetry/watch">Watch</a>
			<a class="link" href="/telemetry/timeline?limit=100">Timeline</a>
		</div>
	\`;
}

function ProgressRing({ progress, state }) {
	const pct = Math.round(Math.min(1, Math.max(0, progress || 0)) * 100);
	const dash = Math.round(283 * Math.min(1, progress || 0));
	const color = nidraColor(state);
	return html\`
		<svg viewBox="0 0 120 120" width="120" height="120">
			<circle class="orb" cx="60" cy="60" r="28" fill=\${color} opacity="0.12"/>
			<circle class="ring-circle-bg" cx="60" cy="60" r="45"/>
			<circle class="ring-circle-fg" cx="60" cy="60" r="45"
				stroke=\${color} stroke-dasharray="\${dash} 283" transform="rotate(-90 60 60)"/>
			<text class="ring-text" x="60" y="62" text-anchor="middle" dominant-baseline="middle">\${pct}%</text>
			<text class="ring-label" x="60" y="78" text-anchor="middle">progress</text>
		</svg>
	\`;
}

function NidraMonitor() {
	const canvasRef = useRef(null);
	useEcg(canvasRef);
	const n = nidra.value;
	const state = (n.state || "unknown").toUpperCase();
	const activity = (n.activity || "idle").toUpperCase();
	return html\`
		<div style="display: flex; gap: 16px; align-items: center;">
			<\${ProgressRing} progress=\${n.consolidationProgress || 0} state=\${n.state} />
			<div style="flex: 1; min-width: 0;">
				<div class="ecg-wrap">
					<canvas ref=\${canvasRef} class="ecg-canvas"></canvas>
					<div class="ecg-overlay">
						<div>
							<div class="ecg-state">Nidra State</div>
							<div class="ecg-value" style="color: \${nidraColor(n.state)}">\${state}</div>
						</div>
						<div>
							<div class="ecg-activity">Activity</div>
							<div class="ecg-activity-val">\${activity}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	\`;
}

function NidraDetails() {
	const n = nidra.value;
	const tone = nidraTone(n.state);
	const items = [
		["State", html\`<span class="badge tone-\${tone}">\${(n.state || "unknown").toUpperCase()}</span>\`],
		["Phase", n.consolidationPhase || "none"],
		["Progress", Math.round((n.consolidationProgress || 0) * 100) + "%"],
		["Last Heartbeat", fmtEpoch(n.lastHeartbeat)],
		["State Changed", fmtEpoch(n.lastStateChange)],
		["Last Consolidated", n.lastConsolidationDate || "none"],
		["Last Backfill", n.lastBackfillDate ? new Date(n.lastBackfillDate).toLocaleDateString() : "none"],
		["Dates Consolidated", n.consolidatedDatesCount ?? 0],
	];
	return html\`
		<div>
			<div class="nidra-meta" style="margin-top: 4px;">
				\${items.map(([k, v]) => html\`<div><div class="k">\${k}</div><div class="v">\${v}</div></div>\`)}
			</div>
			\${n.attention ? html\`<div class="notice warn" style="margin-top: 10px;">Nidra: \${n.attention}</div>\` : null}
		</div>
	\`;
}

function StatCard({ label, value }) {
	return html\`<div class="card"><div class="k">\${label}</div><div class="v">\${value}</div></div>\`;
}

function StatsGrid() {
	const a = active.value;
	const d = dbData.value;
	const cleanup = a.cleanup ?? {};
	const instances = a.instances ?? [];
	const missSess = instances.filter(i => !i.sessionId && !i.providerSessionId).length;
	const missModel = instances.filter(i => !i.model).length;
	return html\`
		<div class="grid">
			<\${StatCard} label="Live Instances" value=\${a.instanceCount ?? 0} />
			<\${StatCard} label="Open Sessions" value=\${a.openSessionCount ?? 0} />
			<\${StatCard} label="Active Now" value=\${a.activeNowCount ?? a.activeConversationCount ?? 0} />
			<\${StatCard} label="Needs Attention" value=\${a.attentionCount ?? 0} />
			<\${StatCard} label="Users" value=\${(a.users ?? []).length} />
			<\${StatCard} label="Rules (Niyama)" value=\${(d.rules ?? 0).toLocaleString()} />
			<\${StatCard} label="Vidhi / Saṁskāra / Vāsanā / Ākāśa" value=\${[d.vidhis, d.samskaras, d.vasanas, d.akashaTraces].map(v => v ?? 0).join(" / ")} />
			<\${StatCard} label="Turns / Sessions" value=\${[d.turns, d.sessions].map(v => (v ?? 0).toLocaleString()).join(" / ")} />
			<\${StatCard} label="Missing Fields" value=\${missSess + " session / " + missModel + " model"} />
			<\${StatCard} label="Cleanup (stale/corrupt/orphan)" value=\${[cleanup.removedStale, cleanup.removedCorrupt, cleanup.removedOrphan].map(v => v ?? 0).join(" / ")} />
		</div>
	\`;
}

function Pills() {
	const a = active.value;
	const providers = Object.entries(a.byProvider ?? {});
	const workspaces = Object.entries(a.byWorkspace ?? {});
	return html\`
		<div class="pills">
			\${providers.map(([k, v]) => html\`<span class="pill">provider \${k}: \${v}</span>\`)}
			\${providers.length === 0 ? html\`<span class="pill" style="opacity:0.5">No provider data</span>\` : null}
		</div>
		<div class="pills">
			\${workspaces.map(([k, v]) => html\`<span class="pill">\${k.split("/").pop()}: \${v}</span>\`)}
		</div>
	\`;
}

function AttentionNotice() {
	const list = active.value?.attention ?? [];
	if (!list.length) return null;
	return html\`<div class="notice warn">
		Attention: \${list.slice(0, 6).map(a =>
			"PID " + (a.pid ?? "n/a") + " (" + (a.provider ?? "unknown") + ") → " + (a.reasons ?? []).join(", ")
		).join(" | ")}
	</div>\`;
}

function InstanceTable() {
	const instances = active.value?.instances ?? [];
	const col = sortCol.value;
	const asc = sortAsc.value;

	const sorted = useMemo(() => {
		return [...instances].sort((a, b) => {
			let av = a[col], bv = b[col];
			if (typeof av === "string") av = av.toLowerCase();
			if (typeof bv === "string") bv = bv.toLowerCase();
			if (av == null) av = "";
			if (bv == null) bv = "";
			if (av < bv) return asc ? -1 : 1;
			if (av > bv) return asc ? 1 : -1;
			return 0;
		});
	}, [instances, col, asc]);

	const toggleSort = (c) => {
		if (sortCol.value === c) sortAsc.value = !sortAsc.value;
		else { sortCol.value = c; sortAsc.value = false; }
	};

	const Th = ({ field, label }) => html\`
		<th onClick=\${() => toggleSort(field)}>
			\${label}
			<span class="arrow \${col === field ? 'active' : ''}">\${col === field ? (asc ? "▲" : "▼") : "▽"}</span>
		</th>
	\`;

	if (!sorted.length) return html\`<table><tbody><tr><td colspan="12" style="color: var(--muted); text-align: center; padding: 20px;">No live instances.</td></tr></tbody></table>\`;

	return html\`<table>
		<thead><tr>
			<\${Th} field="pid" label="PID" />
			<\${Th} field="provider" label="Provider" />
			<\${Th} field="state" label="State" />
			<th>Status</th>
			<\${Th} field="model" label="Model" />
			<\${Th} field="toolCallCount" label="Tools" />
			<\${Th} field="turnCount" label="Turns" />
			<\${Th} field="uptime" label="Uptime" />
			<th>Workspace</th>
			<\${Th} field="transport" label="Transport" />
		</tr></thead>
		<tbody>
			\${sorted.map(i => {
				const actor = [i.username, i.hostname].filter(Boolean).join("@") || "unknown";
				const subagent = [i.agentNickname, i.agentRole].filter(Boolean).join(" · ");
				return html\`<tr key=\${i.pid}>
					<td>\${i.pid}</td>
					<td>\${i.provider || html\`<span class="missing">unknown</span>\`}</td>
					<td>\${i.state || "unknown"}</td>
					<td>
						\${i.isActive ? html\`<span class="badge tone-good">active</span>\` : html\`<span class="badge tone-muted">idle</span>\`}
						\${i.needsAttention ? html\`<span class="badge tone-bad">attention</span>\` : null}
						\${subagent ? html\`<div style="font-size:0.7rem;color:var(--muted);margin-top:2px">\${subagent}</div>\` : null}
						\${i.attentionReasons?.length ? html\`<div style="font-size:0.68rem;color:var(--muted);margin-top:2px">\${i.attentionReasons.join(", ")}</div>\` : null}
					</td>
					<td>\${i.model || html\`<span class="missing">missing</span>\`}</td>
					<td>\${i.toolCallCount ?? 0}</td>
					<td>\${i.turnCount ?? 0}</td>
					<td>\${fmtUptime(i.uptime)}</td>
					<td class="path">\${i.workspace || html\`<span class="missing">missing</span>\`}</td>
					<td>\${i.transport || "n/a"}</td>
				</tr>\`;
			})}
		</tbody>
	</table>\`;
}

function Footer() {
	const ts = statusData.value?.timestamp;
	const date = ts ? new Date(ts).toLocaleString() : "n/a";
	return html\`<div class="footer">
		<div>Tip: use <a class="link" href="/status?format=json">JSON</a> and <a class="link" href="/telemetry/timeline?limit=100">Timeline</a> for automation.</div>
		<div>Updated \${date}</div>
		<div>© \${new Date().getFullYear()} Chitragupta for Srinivas Pendela</div>
	</div>\`;
}

// ── App ───────────────────────────────────────────────────────────────
function App() {
	useEffect(() => { watchLoop(); }, []);
	return html\`
		<div class="container">
			<\${Header} />
			<div class="monitor">
				<div class="panel"><\${NidraMonitor} /></div>
				<div class="panel"><\${NidraDetails} /></div>
			</div>
			\${connError.value ? html\`<div class="notice error">Connection error: \${connError.value}</div>\` : null}
			<\${StatsGrid} />
			<\${Pills} />
			<\${AttentionNotice} />
			<\${InstanceTable} />
			<\${Footer} />
		</div>
	\`;
}

render(html\`<\${App} />\`, document.getElementById("app"));
`;
