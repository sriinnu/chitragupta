/**
 * @chitragupta/netra — Vision Pipeline types for screenshot analysis,
 * UI diff detection, and image processing for the terminal.
 */

// ─── Image Formats ──────────────────────────────────────────────────────────

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "unknown";

// ─── Image Metadata ─────────────────────────────────────────────────────────

export interface ImageMeta {
	width: number;
	height: number;
	format: ImageFormat;
	sizeBytes: number;
	filePath?: string;
}

// ─── Regions ────────────────────────────────────────────────────────────────

export interface ImageRegion {
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
}

// ─── Diff ───────────────────────────────────────────────────────────────────

export interface DiffResult {
	similarity: number;
	changedRegions: ImageRegion[];
	diffImageBase64?: string;
	pixelsDifferent: number;
	totalPixels: number;
}

// ─── Terminal Rendering ─────────────────────────────────────────────────────

export type TerminalImageProtocol = "kitty" | "iterm2" | "sixel" | "none";

export interface RenderOptions {
	maxWidth?: number;
	maxHeight?: number;
	protocol?: TerminalImageProtocol;
	dither?: boolean;
	colorDepth?: "256" | "truecolor" | "ascii";
}

// ─── Screenshot ─────────────────────────────────────────────────────────────

export interface ScreenshotOptions {
	selector?: string;
	fullPage?: boolean;
	delay?: number;
	format?: "png" | "jpeg";
	/** Viewport width in pixels. Defaults to 1280. */
	width?: number;
	/** Viewport height in pixels. Defaults to 720. */
	height?: number;
}

// ─── Vision Analysis ────────────────────────────────────────────────────────

export interface VisionAnalysis {
	description: string;
	elements: UIElement[];
	suggestions: string[];
	accessibility: AccessibilityIssue[];
}

export interface UIElement {
	type:
		| "button"
		| "input"
		| "text"
		| "image"
		| "link"
		| "nav"
		| "header"
		| "footer"
		| "form"
		| "list"
		| "card"
		| "modal"
		| "other";
	label: string;
	region?: ImageRegion;
	properties?: Record<string, string>;
}

export interface AccessibilityIssue {
	severity: "error" | "warning" | "info";
	element?: string;
	issue: string;
	suggestion: string;
	wcagRule?: string;
}
