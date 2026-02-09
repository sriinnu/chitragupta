/**
 * @chitragupta/ui — Theming system.
 *
 * Provides color palettes, symbol sets, and utilities for converting
 * hex colors to terminal-compatible ANSI 256 codes.
 */

// ─── Theme Interface ────────────────────────────────────────────────────────

/**
 * Theme definition containing color palette, symbol set, and name.
 * Used throughout the TUI to ensure consistent visual styling.
 */
export interface Theme {
	name: string;
	colors: {
		primary: string;
		secondary: string;
		success: string;
		warning: string;
		error: string;
		info: string;
		muted: string;
		background: string;
		foreground: string;
		border: string;
		/** Color for reasoning/thinking blocks */
		thinking: string;
		/** Color for tool calls */
		tool: string;
		/** Color for sub-agents */
		agent: string;
		/** Color for money/cost display */
		cost: string;
		/** Color for token counts */
		tokens: string;
		/** Color for git-related info */
		git: string;
		/** Deep background */
		bgDeep: string;
		/** Surface background */
		bgSurface: string;
		/** Hover state background */
		bgHover: string;
		/** Overlay background */
		bgOverlay: string;
	};
	symbols: {
		prompt: string;
		thinking: string;
		success: string;
		error: string;
		warning: string;
		info: string;
		spinner: string[];
		branch: string;
		branchEnd: string;
		branchLine: string;
	};
}

// ─── Default Theme ──────────────────────────────────────────────────────────

/** Nakshatram — the default Chitragupta theme. Saffron & gold palette inspired by Vedic cosmology. */
export const DEFAULT_THEME: Theme = {
	name: "nakshatram",
	colors: {
		primary: "#FF9933",    // Saffron — identity, the divine flame
		secondary: "#FFD700",  // Gold — wisdom, illumination
		success: "#22c55e",    // Emerald — success
		warning: "#f59e0b",    // Topaz — warning
		error: "#ef4444",      // Ruby — error
		info: "#FFD700",       // Gold — info, warm knowledge
		muted: "#484f58",      // Muted gray
		background: "#0d1117", // Deep background
		foreground: "#e6edf3", // Primary text
		border: "#30363d",     // Subtle border
		thinking: "#FFD700",   // Gold — reasoning glow
		tool: "#FF9933",       // Saffron — tool calls
		agent: "#ec4899",      // Lotus — sub-agents
		cost: "#10b981",       // Money green
		tokens: "#FFD700",     // Gold — token counts
		git: "#f97316",        // Orange
		bgDeep: "#0d1117",
		bgSurface: "#161b22",
		bgHover: "#1c2128",
		bgOverlay: "#21262d",
	},
	symbols: {
		prompt: "\u091A\u093F",  // चि — the Chitragupta mark
		thinking: "\u25C6",
		success: "\u2713",
		error: "\u2717",
		warning: "\u26A0",
		info: "\u2139",
		spinner: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
		branch: "\u251C",
		branchEnd: "\u2514",
		branchLine: "\u2502",
	},
};

// ─── Chitragupta Premium Theme ──────────────────────────────────────────────

/** Chitragupta — premium Vedic theme. Deep saffron, warm gold, ink blue depths. */
export const CHITRAGUPTA_THEME: Theme = {
	name: "chitragupta",
	colors: {
		primary: "#E8850A",    // Deep saffron — the scribe's flame
		secondary: "#FFD700",  // Pure gold — divine ink
		success: "#4ade80",    // Bright emerald — karma fulfilled
		warning: "#fbbf24",    // Warm amber — caution
		error: "#f87171",      // Soft ruby — transgression
		info: "#FFD700",       // Gold — illumination
		muted: "#5c5c7a",     // Muted twilight
		background: "#1A1A4E", // Ink blue — the cosmic ledger
		foreground: "#f0e6d3", // Parchment — aged manuscript
		border: "#2d2d6b",     // Deep indigo border
		thinking: "#FFD700",   // Gold — contemplation
		tool: "#FF9933",       // Saffron — yantra activation
		agent: "#e879a8",      // Lotus pink — agent presence
		cost: "#4ade80",       // Emerald — artha (wealth)
		tokens: "#E8850A",     // Deep saffron — token flow
		git: "#FF9933",        // Saffron — branch lineage
		bgDeep: "#12123a",     // Deepest ink
		bgSurface: "#1e1e56",  // Surface ink blue
		bgHover: "#2a2a6e",    // Hover indigo
		bgOverlay: "#33337a",  // Overlay violet-blue
	},
	symbols: {
		prompt: "\u091A\u093F",  // चि — the Chitragupta mark
		thinking: "\u25C8",      // ◈ — diamond with dot, inner focus
		success: "\u2713",       // checkmark
		error: "\u2717",         // cross
		warning: "\u26A0",       // warning
		info: "\u27D0",          // ⟐ — diamond with left-pointing
		spinner: ["\u0950", "\u25C7", "\u0950", "\u25C6", "\u0950", "\u25C7", "\u0950", "\u25C6"], // ॐ ◇ ◆ cycle
		branch: "\u251C",
		branchEnd: "\u2514",
		branchLine: "\u2502",
	},
};

// ─── Minimal Theme ──────────────────────────────────────────────────────────

/** Minimal theme using basic ASCII symbols for broader terminal compatibility. */
export const MINIMAL_THEME: Theme = {
	name: "minimal",
	colors: {
		primary: "#ffffff",
		secondary: "#aaaaaa",
		success: "#00ff00",
		warning: "#ffff00",
		error: "#ff0000",
		info: "#00ffff",
		muted: "#666666",
		background: "#000000",
		foreground: "#cccccc",
		border: "#444444",
		thinking: "#cccccc",
		tool: "#ffff00",
		agent: "#ff00ff",
		cost: "#00ff00",
		tokens: "#aaaaaa",
		git: "#ffaa00",
		bgDeep: "#000000",
		bgSurface: "#111111",
		bgHover: "#222222",
		bgOverlay: "#333333",
	},
	symbols: {
		prompt: ">",
		thinking: "*",
		success: "+",
		error: "x",
		warning: "!",
		info: "i",
		spinner: ["-", "\\", "|", "/"],
		branch: "|-",
		branchEnd: "\\-",
		branchLine: "|",
	},
};

// ─── Theme Registry ─────────────────────────────────────────────────────────

const themes: Map<string, Theme> = new Map([
	["default", DEFAULT_THEME],
	["nakshatram", DEFAULT_THEME],
	["chitragupta", CHITRAGUPTA_THEME],
	["minimal", MINIMAL_THEME],
]);

/**
 * Get a theme by name, falling back to the default theme.
 * @param name - Theme name to look up.
 * @returns The matching theme, or DEFAULT_THEME if not found.
 */
export function getTheme(name: string): Theme {
	return themes.get(name) ?? DEFAULT_THEME;
}

/**
 * Register a custom theme in the theme registry.
 * @param theme - Theme object to register (keyed by `theme.name`).
 */
export function registerTheme(theme: Theme): void {
	themes.set(theme.name, theme);
}

// ─── Hex to ANSI Conversion ─────────────────────────────────────────────────

/**
 * The ANSI 256 color cube uses 6 steps: 0, 95, 135, 175, 215, 255.
 * We map an 8-bit channel value to the nearest cube index (0-5).
 */
const CUBE_STEPS = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

function nearestCubeIndex(value: number): number {
	let best = 0;
	let bestDist = Math.abs(value - CUBE_STEPS[0]);
	for (let i = 1; i < 6; i++) {
		const dist = Math.abs(value - CUBE_STEPS[i]);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

/** Grayscale ramp values (indices 232-255) */
const GRAY_START = 8;
const GRAY_STEP = 10;

function nearestGrayscaleIndex(value: number): number {
	// Grayscale ramp: 232 + index, values 8, 18, 28, ..., 238
	const index = Math.round((value - GRAY_START) / GRAY_STEP);
	return Math.max(0, Math.min(23, index));
}

/** Parse a hex color string (with or without #) into [r, g, b] */
function parseHex(hex: string): [number, number, number] {
	const cleaned = hex.replace(/^#/, "");
	let r: number;
	let g: number;
	let b: number;

	if (cleaned.length === 3) {
		r = parseInt(cleaned[0] + cleaned[0], 16);
		g = parseInt(cleaned[1] + cleaned[1], 16);
		b = parseInt(cleaned[2] + cleaned[2], 16);
	} else {
		r = parseInt(cleaned.slice(0, 2), 16);
		g = parseInt(cleaned.slice(2, 4), 16);
		b = parseInt(cleaned.slice(4, 6), 16);
	}

	return [r, g, b];
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/**
 * Convert a hex color to the nearest ANSI 256 foreground color escape code.
 *
 * Compares against both the 6x6x6 color cube and the 24-step grayscale
 * ramp, returning whichever is closer in RGB color distance.
 *
 * @param hex - Hex color string (with or without `#`), e.g. `"#7c6ff5"` or `"abc"`.
 * @returns ANSI escape sequence for the nearest 256-color foreground.
 */
export function hexToAnsi(hex: string): string {
	const [r, g, b] = parseHex(hex);

	// Find nearest color cube match
	const ri = nearestCubeIndex(r);
	const gi = nearestCubeIndex(g);
	const bi = nearestCubeIndex(b);
	const cubeIndex = 16 + 36 * ri + 6 * gi + bi;
	const cubeR = CUBE_STEPS[ri];
	const cubeG = CUBE_STEPS[gi];
	const cubeB = CUBE_STEPS[bi];
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);

	// Find nearest grayscale match
	const avg = (r + g + b) / 3;
	const grayIdx = nearestGrayscaleIndex(avg);
	const grayValue = GRAY_START + grayIdx * GRAY_STEP;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	const grayIndex = 232 + grayIdx;

	// Use whichever is closer
	const ansiCode = cubeDist <= grayDist ? cubeIndex : grayIndex;
	return `\x1b[38;5;${ansiCode}m`;
}

/**
 * Convert a hex color to the nearest ANSI 256 background color escape code.
 *
 * @param hex - Hex color string (with or without `#`), e.g. `"#1e1e2e"`.
 * @returns ANSI escape sequence for the nearest 256-color background.
 */
export function hexToBgAnsi(hex: string): string {
	const [r, g, b] = parseHex(hex);

	const ri = nearestCubeIndex(r);
	const gi = nearestCubeIndex(g);
	const bi = nearestCubeIndex(b);
	const cubeIndex = 16 + 36 * ri + 6 * gi + bi;
	const cubeR = CUBE_STEPS[ri];
	const cubeG = CUBE_STEPS[gi];
	const cubeB = CUBE_STEPS[bi];
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);

	const avg = (r + g + b) / 3;
	const grayIdx = nearestGrayscaleIndex(avg);
	const grayValue = GRAY_START + grayIdx * GRAY_STEP;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	const grayIndex = 232 + grayIdx;

	const ansiCode = cubeDist <= grayDist ? cubeIndex : grayIndex;
	return `\x1b[48;5;${ansiCode}m`;
}
