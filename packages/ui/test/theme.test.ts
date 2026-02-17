import { describe, it, expect } from "vitest";
import {
	DEFAULT_THEME,
	MINIMAL_THEME,
	CHITRAGUPTA_THEME,
	getTheme,
	registerTheme,
	hexToAnsi,
	hexToBgAnsi,
} from "@chitragupta/ui";
import type { Theme } from "@chitragupta/ui";

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT_THEME
// ═══════════════════════════════════════════════════════════════════════════

describe("DEFAULT_THEME", () => {
	it("should have the name 'nakshatram'", () => {
		expect(DEFAULT_THEME.name).toBe("nakshatram");
	});

	it("should contain all required color keys", () => {
		const requiredColors = [
			"primary", "secondary", "success", "warning", "error", "info",
			"muted", "background", "foreground", "border", "thinking", "tool",
			"agent", "cost", "tokens", "git", "bgDeep", "bgSurface", "bgHover",
			"bgOverlay",
		];
		for (const key of requiredColors) {
			expect(DEFAULT_THEME.colors).toHaveProperty(key);
		}
	});

	it("should have hex-format strings for all color values", () => {
		for (const [key, value] of Object.entries(DEFAULT_THEME.colors)) {
			expect(value, `color '${key}' should be a hex string`).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});

	it("should contain all required symbol keys", () => {
		const requiredSymbols = [
			"prompt", "thinking", "success", "error", "warning", "info",
			"spinner", "branch", "branchEnd", "branchLine",
		];
		for (const key of requiredSymbols) {
			expect(DEFAULT_THEME.symbols).toHaveProperty(key);
		}
	});

	it("should have a spinner array with at least one frame", () => {
		expect(Array.isArray(DEFAULT_THEME.symbols.spinner)).toBe(true);
		expect(DEFAULT_THEME.symbols.spinner.length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// MINIMAL_THEME
// ═══════════════════════════════════════════════════════════════════════════

describe("MINIMAL_THEME", () => {
	it("should have the name 'minimal'", () => {
		expect(MINIMAL_THEME.name).toBe("minimal");
	});

	it("should contain all required color keys", () => {
		const requiredColors = [
			"primary", "secondary", "success", "warning", "error", "info",
			"muted", "background", "foreground", "border", "thinking", "tool",
			"agent", "cost", "tokens", "git", "bgDeep", "bgSurface", "bgHover",
			"bgOverlay",
		];
		for (const key of requiredColors) {
			expect(MINIMAL_THEME.colors).toHaveProperty(key);
		}
	});

	it("should contain all required symbol keys", () => {
		const requiredSymbols = [
			"prompt", "thinking", "success", "error", "warning", "info",
			"spinner", "branch", "branchEnd", "branchLine",
		];
		for (const key of requiredSymbols) {
			expect(MINIMAL_THEME.symbols).toHaveProperty(key);
		}
	});

	it("should use ASCII-only symbols for terminal compatibility", () => {
		expect(MINIMAL_THEME.symbols.prompt).toBe(">");
		expect(MINIMAL_THEME.symbols.success).toBe("+");
		expect(MINIMAL_THEME.symbols.error).toBe("x");
		expect(MINIMAL_THEME.symbols.warning).toBe("!");
		expect(MINIMAL_THEME.symbols.info).toBe("i");
	});

	it("should have a spinner array with basic ASCII frames", () => {
		expect(MINIMAL_THEME.symbols.spinner).toEqual(["-", "\\", "|", "/"]);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// CHITRAGUPTA_THEME
// ═══════════════════════════════════════════════════════════════════════════

describe("CHITRAGUPTA_THEME", () => {
	it("should have the name 'chitragupta'", () => {
		expect(CHITRAGUPTA_THEME.name).toBe("chitragupta");
	});

	it("should contain all required color keys", () => {
		const requiredColors = [
			"primary", "secondary", "success", "warning", "error", "info",
			"muted", "background", "foreground", "border", "thinking", "tool",
			"agent", "cost", "tokens", "git", "bgDeep", "bgSurface", "bgHover",
			"bgOverlay",
		];
		for (const key of requiredColors) {
			expect(CHITRAGUPTA_THEME.colors).toHaveProperty(key);
		}
	});

	it("should have hex-format strings for all color values", () => {
		for (const [key, value] of Object.entries(CHITRAGUPTA_THEME.colors)) {
			expect(value, `color '${key}' should be a hex string`).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});

	it("should contain all required symbol keys", () => {
		const requiredSymbols = [
			"prompt", "thinking", "success", "error", "warning", "info",
			"spinner", "branch", "branchEnd", "branchLine",
		];
		for (const key of requiredSymbols) {
			expect(CHITRAGUPTA_THEME.symbols).toHaveProperty(key);
		}
	});

	it("should have a spinner array with at least one frame", () => {
		expect(Array.isArray(CHITRAGUPTA_THEME.symbols.spinner)).toBe(true);
		expect(CHITRAGUPTA_THEME.symbols.spinner.length).toBeGreaterThan(0);
	});

	it("should use ink blue background", () => {
		expect(CHITRAGUPTA_THEME.colors.background).toBe("#1A1A4E");
	});

	it("should use deep saffron primary", () => {
		expect(CHITRAGUPTA_THEME.colors.primary).toBe("#E8850A");
	});

	it("should use gold secondary", () => {
		expect(CHITRAGUPTA_THEME.colors.secondary).toBe("#FFD700");
	});

	it("should use the Devanagari chi prompt symbol", () => {
		expect(CHITRAGUPTA_THEME.symbols.prompt).toBe("\u091A\u093F");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand consistency
// ═══════════════════════════════════════════════════════════════════════════

describe("Brand consistency", () => {
	it("DEFAULT_THEME should use saffron as primary", () => {
		expect(DEFAULT_THEME.colors.primary).toBe("#FF9933");
	});

	it("DEFAULT_THEME should use gold as secondary", () => {
		expect(DEFAULT_THEME.colors.secondary).toBe("#FFD700");
	});

	it("DEFAULT_THEME should use the Devanagari chi prompt symbol", () => {
		expect(DEFAULT_THEME.symbols.prompt).toBe("\u091A\u093F");
	});

	it("both branded themes should share the chi prompt symbol", () => {
		expect(DEFAULT_THEME.symbols.prompt).toBe(CHITRAGUPTA_THEME.symbols.prompt);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// getTheme
// ═══════════════════════════════════════════════════════════════════════════

describe("getTheme", () => {
	it("should return DEFAULT_THEME for 'default'", () => {
		expect(getTheme("default")).toBe(DEFAULT_THEME);
	});

	it("should return DEFAULT_THEME for 'nakshatram'", () => {
		expect(getTheme("nakshatram")).toBe(DEFAULT_THEME);
	});

	it("should return CHITRAGUPTA_THEME for 'chitragupta'", () => {
		expect(getTheme("chitragupta")).toBe(CHITRAGUPTA_THEME);
	});

	it("should return MINIMAL_THEME for 'minimal'", () => {
		expect(getTheme("minimal")).toBe(MINIMAL_THEME);
	});

	it("should fall back to DEFAULT_THEME for unknown theme names", () => {
		expect(getTheme("nonexistent")).toBe(DEFAULT_THEME);
		expect(getTheme("")).toBe(DEFAULT_THEME);
		expect(getTheme("fancy-dark")).toBe(DEFAULT_THEME);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// registerTheme
// ═══════════════════════════════════════════════════════════════════════════

describe("registerTheme", () => {
	it("should register a custom theme retrievable by getTheme", () => {
		const custom: Theme = {
			name: "test-custom",
			colors: { ...DEFAULT_THEME.colors, primary: "#123456" },
			symbols: { ...DEFAULT_THEME.symbols },
		};
		registerTheme(custom);
		const retrieved = getTheme("test-custom");
		expect(retrieved).toBe(custom);
		expect(retrieved.colors.primary).toBe("#123456");
	});

	it("should allow overwriting an existing theme name", () => {
		const v1: Theme = {
			name: "overwrite-test",
			colors: { ...DEFAULT_THEME.colors },
			symbols: { ...DEFAULT_THEME.symbols },
		};
		const v2: Theme = {
			name: "overwrite-test",
			colors: { ...MINIMAL_THEME.colors },
			symbols: { ...MINIMAL_THEME.symbols },
		};
		registerTheme(v1);
		expect(getTheme("overwrite-test")).toBe(v1);
		registerTheme(v2);
		expect(getTheme("overwrite-test")).toBe(v2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// hexToAnsi
// ═══════════════════════════════════════════════════════════════════════════

describe("hexToAnsi", () => {
	it("should return a foreground ANSI 256-color escape sequence", () => {
		const result = hexToAnsi("#FF0000");
		expect(result).toMatch(/^\x1b\[38;5;\d+m$/);
	});

	it("should convert pure black #000000 correctly", () => {
		// Black: r=0,g=0,b=0 → cube index 16+0+0+0 = 16 (cube black)
		// Gray: avg=0 → grayIdx = max(0, round((0-8)/10)) = max(0,-1) = 0 → 232, value=8
		// cubeDist = 0, grayDist = (0-8)^2*3 = 192 → cube wins
		expect(hexToAnsi("#000000")).toBe("\x1b[38;5;16m");
	});

	it("should convert pure white #FFFFFF correctly", () => {
		// White: r=255,g=255,b=255 → cube(5,5,5) → 16+180+30+5 = 231, value=(255,255,255)
		// cubeDist = 0
		// Gray: avg=255 → grayIdx = round((255-8)/10) = round(24.7) = 25 → clamped to 23 → 255, value=238
		// grayDist = (255-238)^2*3 = 867 → cube wins
		expect(hexToAnsi("#FFFFFF")).toBe("\x1b[38;5;231m");
	});

	it("should convert pure red #FF0000 correctly", () => {
		// Red: r=255,g=0,b=0 → cube(5,0,0) → 16+180+0+0 = 196
		// cubeDist = 0
		// Gray: avg=85 → grayIdx = round((85-8)/10) = round(7.7) = 8 → 240, value=88
		// grayDist = (255-88)^2 + (0-88)^2 + (0-88)^2 = big → cube wins
		expect(hexToAnsi("#FF0000")).toBe("\x1b[38;5;196m");
	});

	it("should convert pure green #00FF00 correctly", () => {
		// Green: cube(0,5,0) → 16+0+30+0 = 46
		expect(hexToAnsi("#00FF00")).toBe("\x1b[38;5;46m");
	});

	it("should convert pure blue #0000FF correctly", () => {
		// Blue: cube(0,0,5) → 16+0+0+5 = 21
		expect(hexToAnsi("#0000FF")).toBe("\x1b[38;5;21m");
	});

	it("should handle mid-gray values", () => {
		// #808080: r=128,g=128,b=128
		// cube: nearest for 128 → step 0x87=135 (idx 2) → cube(2,2,2) → 16+72+12+2=102
		// cubeR=cubeG=cubeB=135, cubeDist = (128-135)^2*3 = 147
		// Gray: avg=128 → grayIdx = round((128-8)/10) = round(12.0) = 12 → 244, value=128
		// grayDist = 0 → gray wins
		expect(hexToAnsi("#808080")).toBe("\x1b[38;5;244m");
	});

	it("should handle hex strings without # prefix", () => {
		const withHash = hexToAnsi("#FF0000");
		const withoutHash = hexToAnsi("FF0000");
		expect(withHash).toBe(withoutHash);
	});

	it("should handle 3-character shorthand hex", () => {
		// #F00 → #FF0000
		const shorthand = hexToAnsi("F00");
		const full = hexToAnsi("FF0000");
		expect(shorthand).toBe(full);
	});

	it("should produce correct ANSI codes for various colors", () => {
		// Just verify they all produce valid escape sequences
		const colors = ["#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444"];
		for (const color of colors) {
			const result = hexToAnsi(color);
			expect(result).toMatch(/^\x1b\[38;5;\d+m$/);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// hexToBgAnsi
// ═══════════════════════════════════════════════════════════════════════════

describe("hexToBgAnsi", () => {
	it("should return a background ANSI 256-color escape sequence (48;5 prefix)", () => {
		const result = hexToBgAnsi("#FF0000");
		expect(result).toMatch(/^\x1b\[48;5;\d+m$/);
	});

	it("should convert pure black #000000 to background ANSI", () => {
		expect(hexToBgAnsi("#000000")).toBe("\x1b[48;5;16m");
	});

	it("should convert pure white #FFFFFF to background ANSI", () => {
		expect(hexToBgAnsi("#FFFFFF")).toBe("\x1b[48;5;231m");
	});

	it("should use the same color index as hexToAnsi but with 48;5 prefix", () => {
		const testColors = ["#FF0000", "#00FF00", "#0000FF", "#808080", "#123456"];
		for (const color of testColors) {
			const fgCode = hexToAnsi(color).match(/\d+(?=m$)/)![0];
			const bgCode = hexToBgAnsi(color).match(/\d+(?=m$)/)![0];
			expect(bgCode).toBe(fgCode);
		}
	});

	it("should handle mid-gray correctly as background", () => {
		expect(hexToBgAnsi("#808080")).toBe("\x1b[48;5;244m");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Color Conversion Correctness
// ═══════════════════════════════════════════════════════════════════════════

describe("Color conversion correctness", () => {
	it("should pick grayscale ramp when it is closer than the color cube", () => {
		// #808080 (128,128,128) → grayscale idx 12 → ANSI 244 (value 128, distance 0)
		// vs cube(2,2,2) → ANSI 102 (value 135, distance 147)
		const result = hexToAnsi("#808080");
		expect(result).toBe("\x1b[38;5;244m");
	});

	it("should pick the color cube when it is closer than grayscale", () => {
		// Pure red has zero cube distance → cube always wins
		expect(hexToAnsi("#FF0000")).toBe("\x1b[38;5;196m");
	});

	it("should correctly map dark gray #1a1a1a", () => {
		// r=g=b=26, avg=26 → grayIdx = round((26-8)/10) = round(1.8) = 2 → 234, value=28
		// grayDist = (26-28)^2 * 3 = 12
		// cube: nearest for 26 → 0 (idx 0) → cube(0,0,0) → 16, value=(0,0,0)
		// cubeDist = 26^2 * 3 = 2028 → gray wins
		expect(hexToAnsi("#1a1a1a")).toBe("\x1b[38;5;234m");
	});

	it("should correctly map near-white #eeeeee", () => {
		// r=g=b=238, avg=238 → grayIdx = round((238-8)/10) = round(23.0) = 23 → 255, value=238
		// grayDist = 0
		// cube: nearest for 238 → 0xff=255 (idx 5) → cube(5,5,5) → 231, value=(255,255,255)
		// cubeDist = (238-255)^2*3 = 867 → gray wins
		expect(hexToAnsi("#eeeeee")).toBe("\x1b[38;5;255m");
	});
});
