/** @chitragupta/daemon — status dashboard HTML renderer. */
import { renderNidraMonitorSvg } from "./http-status-ui-nidra.js";

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\"", "&quot;")
		.replaceAll("'", "&#39;");
}

type StatusInstance = {
	pid: number | null;
	agent: string | null;
	state: string | null;
	sessionId: string | null;
	providerSessionId: string | null;
	provider: string | null;
	clientKey: string | null;
	agentNickname: string | null;
	agentRole: string | null;
	parentThreadId: string | null;
	workspace: string | null;
	username: string | null;
	hostname: string | null;
	toolCallCount: number;
	turnCount: number;
	uptime: number | null;
	transport: string | null;
	model: string | null;
	lastToolCallAt: number | null;
	isActive?: boolean;
	needsAttention?: boolean;
	attentionReasons?: string[];
};

type Nidra = {
	state?: string;
	activity?: string;
	attention?: string | null;
	lastStateChange?: number | null;
	lastHeartbeat?: number | null;
	lastConsolidationStart?: number | null;
	lastConsolidationEnd?: number | null;
	consolidationPhase?: string | null;
	consolidationProgress?: number;
	lastConsolidationDate?: string | null;
	lastBackfillDate?: string | null;
	consolidatedDatesCount?: number;
};

function renderMaybeText(value: string | null | undefined, missingLabel = "missing"): string {
	if (typeof value === "string" && value.trim().length > 0) return escapeHtml(value);
	return `<span class="missing">${escapeHtml(missingLabel)}</span>`;
}

function formatEpoch(ms: number | null | undefined): string {
	if (!ms || !Number.isFinite(ms)) return "n/a";
	const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
	if (deltaSec < 60) return `${deltaSec}s ago`;
	const deltaMin = Math.round(deltaSec / 60);
	if (deltaMin < 60) return `${deltaMin}m ago`;
	const deltaHr = Math.round(deltaMin / 60);
	if (deltaHr < 24) return `${deltaHr}h ago`;
	return new Date(ms).toLocaleString();
}

function formatUptime(seconds: number | null): string {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "n/a";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${(seconds / 3600).toFixed(1)}h`;
}

function toneForNidraState(state: string): "good" | "warn" | "calm" {
	if (state === "LISTENING") return "good";
	if (state === "DREAMING") return "warn";
	return "calm";
}

function renderBadge(label: string, tone: "good" | "warn" | "calm" | "bad" | "muted" = "muted"): string {
	return `<span class="badge tone-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function normalizeProgress(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(1, raw));
}

/** Build a high-signal status dashboard for browsers. */
export function renderStatusDashboard(payload: Record<string, unknown>): string {
	const daemon = (payload.daemon ?? {}) as Record<string, unknown>;
	const db = (payload.db ?? {}) as Record<string, unknown>;
	const nidra = (payload.nidra ?? {}) as Nidra;
	const active = (payload.active ?? {}) as Record<string, unknown>;
	const cleanup = (active.cleanup ?? {}) as Record<string, unknown>;
	const links = (payload.links ?? {}) as Record<string, unknown>;
	const year = new Date().getFullYear();

	const instances = Array.isArray(active.instances) ? active.instances as StatusInstance[] : [];
	const users = Array.isArray(active.users) ? active.users.map((u) => String(u)) : [];
	const workspaceEntries = Object.entries((active.byWorkspace ?? {}) as Record<string, unknown>);
	const providerEntries = Object.entries((active.byProvider ?? {}) as Record<string, unknown>);
	const attentionList = Array.isArray(active.attention) ? active.attention as Array<Record<string, unknown>> : [];

	const fingerprint = String(active.fingerprint ?? "");
	const statusJsonUrl = String(links.statusJson ?? "/status?format=json");
	const statusUiUrl = String(links.statusUi ?? "/status/ui");
	const telemetryInstancesUrl = String(links.telemetryInstances ?? "/telemetry/instances");
	const telemetryWatchUrl = String(links.telemetryWatch ?? "/telemetry/watch");
	const telemetryTimelineUrl = String(links.telemetryTimeline ?? "/telemetry/timeline?limit=100");

	const missingSessionCount = instances.filter((i) => !i.sessionId && !i.providerSessionId).length;
	const missingModelCount = instances.filter((i) => !i.model).length;

	const nidraState = String(nidra.state ?? "unknown").toUpperCase();
	const nidraActivity = String(nidra.activity ?? "unknown").replaceAll("_", " ");
	const nidraProgress = normalizeProgress(nidra.consolidationProgress ?? 0);
	const nidraTone = toneForNidraState(nidraState);

	const rows = instances
		.sort((a, b) => {
			const aAttention = a.needsAttention ? 1 : 0;
			const bAttention = b.needsAttention ? 1 : 0;
			if (bAttention !== aAttention) return bAttention - aAttention;
			const aActive = a.isActive ? 1 : 0;
			const bActive = b.isActive ? 1 : 0;
			if (bActive !== aActive) return bActive - aActive;
			return Number(b.toolCallCount ?? 0) - Number(a.toolCallCount ?? 0);
		})
		.map((i) => {
			const actor = [i.username, i.hostname].filter(Boolean).join("@") || "unknown";
			const session = i.sessionId ? `<code>${escapeHtml(i.sessionId)}</code>` : "<span class=\"muted\">none</span>";
			const providerSession = i.providerSessionId ? `<code>${escapeHtml(i.providerSessionId)}</code>` : "<span class=\"muted\">none</span>";
			const subagent = [i.agentNickname, i.agentRole].filter(Boolean).join(" · ");
			const statusBits = [
				i.isActive ? renderBadge("active", "good") : renderBadge("idle", "muted"),
				i.needsAttention ? renderBadge("attention", "bad") : renderBadge("ok", "calm"),
			].join(" ");
			const reasons = Array.isArray(i.attentionReasons) && i.attentionReasons.length > 0
				? `<div class="mini muted">${escapeHtml(i.attentionReasons.join(", "))}</div>`
				: "";
			return `<tr>
				<td>${escapeHtml(i.pid)}</td>
				<td>${renderMaybeText(i.provider, "unknown")}</td>
				<td>${subagent ? escapeHtml(subagent) : "<span class=\"muted\">root</span>"}</td>
				<td>${renderMaybeText(actor, "unknown")}</td>
				<td>${renderMaybeText(i.state, "unknown")}</td>
				<td>${statusBits}${reasons}</td>
				<td>${session}</td>
				<td>${providerSession}</td>
				<td>${renderMaybeText(i.model, "missing")}</td>
				<td>${escapeHtml(i.toolCallCount)}</td>
				<td>${escapeHtml(i.turnCount)}</td>
				<td>${escapeHtml(formatEpoch(i.lastToolCallAt))}</td>
				<td>${escapeHtml(formatUptime(i.uptime))}</td>
				<td class="path">${renderMaybeText(i.workspace, "missing")}</td>
				<td>${renderMaybeText(i.transport, "missing")}</td>
			</tr>`;
		})
		.join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chitragupta Status</title>
<style>
	:root {
		--bg: #08131d;
		--bg-soft: #102230;
		--card: #142a3a;
		--text: #e7f5ff;
		--muted: #95b5cb;
		--line: #2d4a5f;
		--accent: #22d3ee;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0;
		font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
		background:
			radial-gradient(1400px 700px at 10% -20%, #17374c, transparent 62%),
			radial-gradient(1200px 500px at 90% -25%, #1b2f4f, transparent 55%),
			var(--bg);
		color: var(--text);
	}
	.container { max-width: 1360px; margin: 0 auto; padding: 22px; }
	.topbar { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
	.brand { display: flex; align-items: center; gap: 12px; }
	.logo { width: 36px; height: 36px; flex: 0 0 36px; }
	h1 { margin: 0; font-size: 1.45rem; letter-spacing: 0.02em; }
	.sub { color: var(--muted); font-size: 0.9rem; }
	.controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	button {
		border: 1px solid var(--line);
		background: #122838;
		color: var(--text);
		border-radius: 8px;
		padding: 6px 10px;
		font: inherit;
		cursor: pointer;
	}
	button:hover { background: #1b3345; }
	.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.link {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--line);
		background: #102435;
		color: var(--text);
		text-decoration: none;
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 0.82rem;
	}
	.link:hover { background: #173145; }
	.monitor {
		margin-top: 14px;
		display: grid;
		grid-template-columns: minmax(280px, 440px) 1fr;
		gap: 12px;
	}
	.panel {
		background: linear-gradient(165deg, var(--card), var(--bg-soft));
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 14px;
	}
	.nidra-svg { width: 100%; height: auto; display: block; }
	.orb { animation: orbPulse 2.4s ease-in-out infinite; }
	.trace { stroke-dasharray: 7 7; animation: traceFlow 2.8s linear infinite; }
	@keyframes traceFlow { from { stroke-dashoffset: 84; } to { stroke-dashoffset: 0; } }
	@keyframes orbPulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.45; } }
	.nidra-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
	.k { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
	.v { margin-top: 4px; font-size: 1.02rem; font-weight: 700; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-top: 12px; }
	.card { background: linear-gradient(160deg, #193145, #132736); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
	.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
	.pill { border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; font-size: 0.8rem; background: #112433; }
	.badge { display: inline-flex; border-radius: 999px; padding: 2px 7px; font-size: 0.72rem; border: 1px solid transparent; margin-right: 4px; }
	.tone-good { background: #163d2b; border-color: #256844; color: #93e7b6; }
	.tone-warn { background: #3d2c15; border-color: #83602a; color: #fbd38d; }
	.tone-calm { background: #1b3046; border-color: #325d87; color: #93c5fd; }
	.tone-bad { background: #411f25; border-color: #934354; color: #fdb0bf; }
	.tone-muted { background: #1f2f3d; border-color: #3a5569; color: #b6c9d8; }
	.notice { margin-top: 12px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); font-size: 0.84rem; }
	.notice.warn { background: #3b2b13; border-color: #876028; color: #ffe2ae; }
	.notice.error { background: #3d1f24; border-color: #8d3c4d; color: #ffc0cb; }
	.hidden { display: none; }
	.missing { display: inline-block; font-size: 0.74rem; padding: 2px 6px; border-radius: 999px; border: 1px solid #836028; background: #3b2b13; color: #ffdca6; }
	.muted { color: var(--muted); }
	.mini { font-size: 0.72rem; margin-top: 3px; }
	table { width: 100%; border-collapse: collapse; margin-top: 16px; background: #0f1f2a; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
	th, td { padding: 9px 10px; border-bottom: 1px solid #234256; text-align: left; font-size: 0.82rem; vertical-align: top; }
	th { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; background: #152b3a; }
	tr:hover td { background: #132838; }
	td.path { max-width: 360px; word-break: break-all; color: #cde0ed; }
	code { background: #1f3546; border: 1px solid #355b77; border-radius: 6px; padding: 1px 5px; font-size: 0.78rem; }
	.footer { margin-top: 10px; color: var(--muted); font-size: 0.8rem; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
	@media (max-width: 980px) { .monitor { grid-template-columns: 1fr; } }
	@media (max-width: 820px) {
		th:nth-child(8), td:nth-child(8), th:nth-child(12), td:nth-child(12), th:nth-child(13), td:nth-child(13) { display: none; }
	}
</style>
</head>
<body data-fingerprint="${escapeHtml(fingerprint)}">
	<div class="container">
		<div class="topbar">
			<div class="brand">
				<svg class="logo" viewBox="0 0 64 64" role="img" aria-label="Chitragupta logo">
					<defs>
						<linearGradient id="cg-g" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0%" stop-color="#22d3ee" />
							<stop offset="100%" stop-color="#34d399" />
						</linearGradient>
					</defs>
					<rect x="5" y="5" width="54" height="54" rx="14" fill="#0f2231" stroke="#2d4a5f" stroke-width="2"/>
					<path d="M14 34h11l5-10 6 18 5-11h9" stroke="url(#cg-g)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
					<circle cx="44" cy="22" r="4" fill="#9de8ff" />
				</svg>
				<h1>Chitragupta Runtime Monitor</h1>
			</div>
			<div class="controls">
				<span id="auto-state" class="sub">Auto: ON</span>
				<button id="auto-toggle" type="button">Pause Auto Refresh</button>
				<button id="refresh-now" type="button">Refresh Now</button>
			</div>
		</div>
		<div class="sub">daemon pid ${escapeHtml(daemon.pid ?? "n/a")} · nidra ${escapeHtml(nidraState)} · activity ${escapeHtml(nidraActivity)}</div>
		<div class="links">
			<a class="link" href="${escapeHtml(statusUiUrl)}">Status UI</a>
			<a class="link" href="${escapeHtml(statusJsonUrl)}">Status JSON</a>
			<a class="link" href="${escapeHtml(telemetryInstancesUrl)}">Telemetry Instances</a>
			<a class="link" href="${escapeHtml(telemetryWatchUrl)}">Telemetry Watch</a>
			<a class="link" href="${escapeHtml(telemetryTimelineUrl)}">Telemetry Timeline</a>
		</div>

		<div class="monitor">
			<div class="panel">
				${renderNidraMonitorSvg(nidraState, nidraActivity.toUpperCase(), nidraProgress)}
			</div>
			<div class="panel">
				<div>${renderBadge(nidraState, nidraTone)} ${renderBadge(nidraActivity, nidraTone)}</div>
				<div class="nidra-meta" style="margin-top:10px;">
					<div><div class="k">Consolidation Phase</div><div class="v">${renderMaybeText(nidra.consolidationPhase ?? null, "none")}</div></div>
					<div><div class="k">Progress</div><div class="v">${escapeHtml(`${Math.round(nidraProgress * 100)}%`)}</div></div>
					<div><div class="k">Last Heartbeat</div><div class="v">${escapeHtml(formatEpoch(nidra.lastHeartbeat ?? null))}</div></div>
					<div><div class="k">Last State Change</div><div class="v">${escapeHtml(formatEpoch(nidra.lastStateChange ?? null))}</div></div>
					<div><div class="k">Last Consolidated Date</div><div class="v">${renderMaybeText(nidra.lastConsolidationDate ?? null, "none")}</div></div>
					<div><div class="k">Last Backfill</div><div class="v">${renderMaybeText(nidra.lastBackfillDate ?? null, "none")}</div></div>
				</div>
				${nidra.attention ? `<div class="notice warn" style="margin-top:10px;">Nidra attention: ${escapeHtml(String(nidra.attention))}</div>` : ""}
			</div>
		</div>

		<div id="format-help" class="notice warn hidden"></div>
		<div id="json-notice" class="notice error hidden"></div>

		<div class="grid">
			<div class="card"><div class="k">Live Instances</div><div class="v">${escapeHtml(active.instanceCount ?? 0)}</div></div>
			<div class="card"><div class="k">Open Sessions</div><div class="v">${escapeHtml(active.openSessionCount ?? 0)}</div></div>
			<div class="card"><div class="k">Active Now</div><div class="v">${escapeHtml(active.activeNowCount ?? active.activeConversationCount ?? 0)}</div></div>
			<div class="card"><div class="k">Needs Attention</div><div class="v">${escapeHtml(active.attentionCount ?? 0)}</div></div>
			<div class="card"><div class="k">Users</div><div class="v">${escapeHtml(users.length)}</div></div>
			<div class="card"><div class="k">Rules</div><div class="v">${escapeHtml(db.rules ?? 0)}</div></div>
			<div class="card"><div class="k">Missing JSON Fields</div><div class="v">${escapeHtml(missingSessionCount)} session / ${escapeHtml(missingModelCount)} model</div></div>
			<div class="card"><div class="k">Vidhis / Samskaras / Vasanas / Akasha</div><div class="v">${escapeHtml(db.vidhis ?? 0)} / ${escapeHtml(db.samskaras ?? 0)} / ${escapeHtml(db.vasanas ?? 0)} / ${escapeHtml(db.akashaTraces ?? 0)}</div></div>
			<div class="card"><div class="k">Nidra Consolidated Dates</div><div class="v">${escapeHtml(nidra.consolidatedDatesCount ?? 0)}</div></div>
			<div class="card"><div class="k">Telemetry Cleanup (request)</div><div class="v">${escapeHtml(cleanup.removedStale ?? 0)} / ${escapeHtml(cleanup.removedCorrupt ?? 0)} / ${escapeHtml(cleanup.removedOrphan ?? 0)}</div></div>
		</div>

		<div class="pills">
			${providerEntries.map(([k, v]) => `<span class="pill">provider ${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join("") || "<span class=\"pill muted\">No provider data</span>"}
		</div>
		<div class="pills">
			${workspaceEntries.map(([k, v]) => `<span class="pill">${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join("") || "<span class=\"pill muted\">No workspace heartbeat data</span>"}
		</div>

		${attentionList.length > 0 ? `<div class="notice warn">Attention: ${attentionList.slice(0, 6).map((a) => {
			const pid = a.pid ?? "n/a";
			const provider = a.provider ?? "unknown";
			const reasons = Array.isArray(a.reasons) ? a.reasons.join(", ") : "unknown";
			return `PID ${pid} (${provider}) -> ${reasons}`;
		}).join(" | ")}</div>` : ""}

		<table>
			<thead>
				<tr>
					<th>PID</th><th>Provider</th><th>Subagent</th><th>Opened By</th><th>State</th><th>Status</th><th>Session</th><th>Provider Session</th><th>Model</th><th>Tools</th><th>Turns</th><th>Last Tool</th><th>Uptime</th><th>Workspace</th><th>Transport</th>
				</tr>
			</thead>
			<tbody>${rows || "<tr><td colspan=\"15\" class=\"muted\">No live instances.</td></tr>"}</tbody>
		</table>
		<div class="footer">
			<div>Tip: use <a class="link" href="${escapeHtml(statusJsonUrl)}">status json</a> and <a class="link" href="${escapeHtml(telemetryTimelineUrl)}">timeline</a> for automation.</div>
			<div>Updated ${escapeHtml(new Date(Number(payload.timestamp ?? Date.now())).toLocaleString())}</div>
			<div>&copy; ${escapeHtml(year)} Chitragupta for Srinivas Pendela</div>
		</div>
	</div>

	<script>
	(() => {
		const key = "chitragupta.status.autoRefresh";
		const stateEl = document.getElementById("auto-state");
		const toggle = document.getElementById("auto-toggle");
		const refresh = document.getElementById("refresh-now");
		const formatHelp = document.getElementById("format-help");
		const jsonNotice = document.getElementById("json-notice");
		let fingerprint = document.body.dataset.fingerprint || "";
		let auto = localStorage.getItem(key) !== "off";

		const showNotice = (el, msg) => {
			if (!el) return;
			el.textContent = msg;
			el.classList.remove("hidden");
		};
		const hideNotice = (el) => {
			if (!el) return;
			el.textContent = "";
			el.classList.add("hidden");
		};
		const maybeShowFormatHelp = () => {
			const format = (new URL(window.location.href)).searchParams.get("format");
			if (!format || format === "html" || format === "json") {
				hideNotice(formatHelp);
				return;
			}
			showNotice(formatHelp, "Unknown format query param '" + format + "'. Use format=html or format=json.");
		};
		const sync = () => {
			if (!stateEl || !toggle) return;
			stateEl.textContent = auto ? "Auto: ON (event-driven)" : "Auto: OFF";
			toggle.textContent = auto ? "Pause Auto Refresh" : "Resume Auto Refresh";
		};
		maybeShowFormatHelp();
		sync();
		toggle?.addEventListener("click", () => {
			auto = !auto;
			localStorage.setItem(key, auto ? "on" : "off");
			sync();
		});
		refresh?.addEventListener("click", () => location.reload());

		const watch = async () => {
			if (!auto) {
				setTimeout(watch, 1000);
				return;
			}
			try {
				const qs = new URLSearchParams({ fingerprint, timeout: "30000" });
				const res = await fetch("/telemetry/watch?" + qs.toString(), { cache: "no-store" });
				const raw = await res.text();
				let data;
				try {
					data = JSON.parse(raw);
					hideNotice(jsonNotice);
				} catch {
					showNotice(jsonNotice, "Telemetry watch returned invalid JSON. Retrying...");
					setTimeout(watch, 2500);
					return;
				}
				if (data && data.changed) {
					location.reload();
					return;
				}
				fingerprint = typeof data.fingerprint === "string" ? data.fingerprint : fingerprint;
				setTimeout(watch, 50);
			} catch {
				setTimeout(watch, 2500);
			}
		};

		// Keep non-telemetry stats (DB/Nidra) fresh.
		setInterval(() => {
			if (auto) location.reload();
		}, 60000);

		watch();
	})();
	</script>
</body>
</html>`;
}
