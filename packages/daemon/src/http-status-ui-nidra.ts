/**
 * @chitragupta/daemon — Nidra monitor SVG renderer.
 */

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\"", "&quot;")
		.replaceAll("'", "&#39;");
}

export function renderNidraMonitorSvg(state: string, activity: string, progress: number): string {
	const tones: Record<string, { ring: string; glow: string; trace: string }> = {
		LISTENING: { ring: "#22c55e", glow: "#86efac", trace: "#22d3ee" },
		DREAMING: { ring: "#f59e0b", glow: "#fde68a", trace: "#fb923c" },
		DEEP_SLEEP: { ring: "#38bdf8", glow: "#93c5fd", trace: "#60a5fa" },
	};
	const t = tones[state] ?? tones.DEEP_SLEEP;
	const pct = Math.round(progress * 100);
	const dash = Math.max(0, Math.min(283, Math.round(283 * progress)));
	return `
<svg class="nidra-svg" viewBox="0 0 360 180" role="img" aria-label="Nidra activity monitor">
	<defs>
		<linearGradient id="bg-g" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#0f2130" />
			<stop offset="100%" stop-color="#172b3a" />
		</linearGradient>
		<linearGradient id="trace-g" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stop-color="${escapeHtml(t.trace)}" />
			<stop offset="100%" stop-color="#f43f5e" />
		</linearGradient>
	</defs>
	<rect x="2" y="2" width="356" height="176" rx="16" fill="url(#bg-g)" stroke="#2f4a5e" stroke-width="2"/>
	<circle class="orb" cx="72" cy="90" r="28" fill="${escapeHtml(t.glow)}" opacity="0.25"/>
	<circle cx="72" cy="90" r="45" fill="none" stroke="#29465c" stroke-width="10"/>
	<circle cx="72" cy="90" r="45" fill="none" stroke="${escapeHtml(t.ring)}" stroke-width="10" stroke-dasharray="${dash} 283" transform="rotate(-90 72 90)"/>
	<text x="72" y="92" text-anchor="middle" dominant-baseline="middle" fill="#e9f6ff" font-size="16" font-weight="700">${escapeHtml(String(pct))}%</text>
	<path class="trace" d="M130 105 L160 105 L171 82 L184 123 L194 92 L205 105 L224 105 L237 88 L247 115 L258 103 L330 103" stroke="url(#trace-g)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	<text x="130" y="54" fill="#9bc4df" font-size="12">NIDRA STATE</text>
	<text x="130" y="74" fill="#ebf7ff" font-size="18" font-weight="700">${escapeHtml(state)}</text>
	<text x="130" y="142" fill="#9bc4df" font-size="12">ACTIVITY</text>
	<text x="130" y="160" fill="#ebf7ff" font-size="16" font-weight="600">${escapeHtml(activity)}</text>
</svg>`;
}
