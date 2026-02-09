/**
 * @chitragupta/netra — Render images in the terminal.
 *
 * Supports Kitty Graphics Protocol, iTerm2 inline images, and
 * an ASCII/Unicode block-character fallback with ANSI colors.
 */

import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import type { RenderOptions, TerminalImageProtocol } from "./types.js";
import { detectFormat } from "./image-meta.js";
import { decodePng } from "./pixel-diff.js";

// ─── Protocol Detection ─────────────────────────────────────────────────────

/**
 * Detect the best terminal image protocol available by checking
 * environment variables.
 *
 * Detection order:
 * - Kitty: `TERM_PROGRAM=kitty` or `TERM` contains "kitty"
 * - iTerm2: `TERM_PROGRAM=iTerm.app` or `TERM_PROGRAM=iTerm2`
 * - Sixel: `SIXEL_SUPPORT=1`
 * - Falls back to "none" (ASCII block rendering)
 *
 * @returns The detected terminal image protocol.
 *
 * @example
 * ```ts
 * const protocol = detectProtocol();
 * if (protocol === "kitty") { ... }
 * ```
 */
export function detectProtocol(): TerminalImageProtocol {
	const termProgram = process.env["TERM_PROGRAM"] ?? "";
	const term = process.env["TERM"] ?? "";

	if (termProgram === "kitty" || term.includes("kitty")) {
		return "kitty";
	}

	if (termProgram === "iTerm.app" || termProgram === "iTerm2") {
		return "iterm2";
	}

	// Sixel detection heuristic: some terminals advertise sixel support
	// via TERM or environment variables. Accurate detection requires
	// querying the terminal with DA sequences, which is asynchronous.
	if (process.env["SIXEL_SUPPORT"] === "1") {
		return "sixel";
	}

	return "none";
}

// ─── Kitty Protocol ─────────────────────────────────────────────────────────

const KITTY_CHUNK_SIZE = 4096;

/**
 * Encode image data for Kitty Graphics Protocol.
 * Large payloads are chunked into 4096-byte base64 segments.
 *
 * Protocol: ESC_G{key=value,...};{base64_payload}ESC\
 *   f=100  -> PNG format
 *   t=d    -> direct data transfer
 *   a=T    -> transmit and display
 *   m=1    -> more chunks follow
 *   m=0    -> last chunk
 */
function encodeKitty(base64Data: string): string {
	const chunks: string[] = [];
	let offset = 0;

	while (offset < base64Data.length) {
		const chunk = base64Data.slice(offset, offset + KITTY_CHUNK_SIZE);
		const isLast = offset + KITTY_CHUNK_SIZE >= base64Data.length;
		const more = isLast ? 0 : 1;

		if (offset === 0) {
			// First chunk: include all metadata
			chunks.push(`\x1b_Gf=100,t=d,a=T,m=${more};${chunk}\x1b\\`);
		} else {
			// Continuation chunk
			chunks.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
		}

		offset += KITTY_CHUNK_SIZE;
	}

	return chunks.join("");
}

// ─── iTerm2 Protocol ────────────────────────────────────────────────────────

/**
 * Encode image data for iTerm2 inline image protocol.
 *
 * Protocol: ESC]1337;File=size={size};inline=1;width=auto;height=auto:{base64}BEL
 */
function encodeIterm2(base64Data: string, sizeBytes: number): string {
	return `\x1b]1337;File=size=${sizeBytes};inline=1;width=auto;height=auto:${base64Data}\x07`;
}

// ─── ASCII Fallback ─────────────────────────────────────────────────────────

/**
 * ANSI 256-color index for an RGB color.
 * Uses the 6x6x6 color cube (indices 16-231) for colors,
 * and grayscale ramp (indices 232-255) for near-gray values.
 */
function rgbToAnsi256(r: number, g: number, b: number): number {
	// Check if the color is close to grayscale
	if (r === g && g === b) {
		if (r < 8) return 16;
		if (r > 248) return 231;
		return Math.round((r - 8) / 247 * 24) + 232;
	}

	const ri = Math.round(r / 255 * 5);
	const gi = Math.round(g / 255 * 5);
	const bi = Math.round(b / 255 * 5);
	return 16 + 36 * ri + 6 * gi + bi;
}

/**
 * Render an image as Unicode block characters with ANSI colors.
 *
 * Each terminal cell represents 2 vertical pixels using the lower-half
 * block character (U+2584 "▄"):
 *   - Background color = top pixel
 *   - Foreground color = bottom pixel
 *
 * This effectively doubles the vertical resolution compared to using
 * full block characters.
 */
function renderAscii(
	pixels: Uint8Array,
	width: number,
	height: number,
	options: RenderOptions,
): string {
	const maxCols = options.maxWidth ?? (process.stdout.columns || 80);
	const maxRows = options.maxHeight ?? ((process.stdout.rows || 24) * 2); // *2 because 2 pixel rows per cell row

	// Calculate scale factor to fit within terminal
	const scaleX = maxCols / width;
	const scaleY = maxRows / height;
	const scale = Math.min(scaleX, scaleY, 1); // Never upscale

	const outWidth = Math.max(1, Math.floor(width * scale));
	const outHeight = Math.max(2, Math.floor(height * scale));
	// Ensure even height for block pairing
	const evenHeight = outHeight % 2 === 0 ? outHeight : outHeight + 1;

	const useTruecolor = options.colorDepth === "truecolor";
	const useAsciiOnly = options.colorDepth === "ascii";

	const lines: string[] = [];

	for (let cellRow = 0; cellRow < evenHeight; cellRow += 2) {
		let line = "";

		for (let col = 0; col < outWidth; col++) {
			// Map output coordinates back to source image
			const srcX = Math.min(Math.floor(col / scale), width - 1);
			const srcYTop = Math.min(Math.floor(cellRow / scale), height - 1);
			const srcYBot = Math.min(Math.floor((cellRow + 1) / scale), height - 1);

			// Read top pixel RGBA
			const topIdx = (srcYTop * width + srcX) * 4;
			const tr = pixels[topIdx]!;
			const tg = pixels[topIdx + 1]!;
			const tb = pixels[topIdx + 2]!;

			// Read bottom pixel RGBA
			const botIdx = (srcYBot * width + srcX) * 4;
			const br = pixels[botIdx]!;
			const bg = pixels[botIdx + 1]!;
			const bb = pixels[botIdx + 2]!;

			if (useAsciiOnly) {
				// Pure ASCII: use luminance-based characters
				const topLum = 0.299 * tr + 0.587 * tg + 0.114 * tb;
				const botLum = 0.299 * br + 0.587 * bg + 0.114 * bb;
				const avgLum = (topLum + botLum) / 2;
				const chars = " .:-=+*#%@";
				const idx = Math.min(Math.floor(avgLum / 255 * (chars.length - 1)), chars.length - 1);
				line += chars[idx];
			} else if (useTruecolor) {
				// True color: 24-bit foreground and background
				line += `\x1b[48;2;${tr};${tg};${tb}m\x1b[38;2;${br};${bg};${bb}m\u2584`;
			} else {
				// 256-color mode
				const topColor = rgbToAnsi256(tr, tg, tb);
				const botColor = rgbToAnsi256(br, bg, bb);
				line += `\x1b[48;5;${topColor}m\x1b[38;5;${botColor}m\u2584`;
			}
		}

		line += "\x1b[0m"; // Reset colors at end of line
		lines.push(line);
	}

	return lines.join("\n");
}

// ─── Pixel Extraction for ASCII Fallback ────────────────────────────────────

/**
 * Extract raw RGBA pixel data from a PNG buffer.
 * Uses the decodePng function from pixel-diff module.
 */
function extractPixels(buffer: Buffer): { pixels: Uint8Array; width: number; height: number } {
	const format = detectFormat(buffer);
	if (format !== "png") {
		throw new Error(
			`ASCII fallback rendering currently supports PNG format only (got "${format}"). ` +
			`Convert the image to PNG first, or use a terminal with Kitty/iTerm2 protocol support.`
		);
	}

	const decoded = decodePng(buffer);
	return { pixels: decoded.pixels, width: decoded.width, height: decoded.height };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Render an image file in the terminal using the best available protocol.
 *
 * @param imagePath - Path to the image file.
 * @param options - Rendering options (protocol, color depth, max dimensions).
 * @returns A string of terminal escape sequences to display the image.
 * @throws If the file cannot be read.
 */
export async function renderImage(imagePath: string, options?: RenderOptions): Promise<string> {
	const buffer = await readFile(imagePath);
	return renderImageBuffer(buffer, options);
}

/**
 * Render an image buffer in the terminal using the best available protocol.
 *
 * @param buffer - Raw image file data.
 * @param options - Rendering options (protocol, color depth, max dimensions).
 * @returns A string of terminal escape sequences to display the image.
 */
export async function renderImageBuffer(buffer: Buffer, options?: RenderOptions): Promise<string> {
	const opts: RenderOptions = {
		colorDepth: "256",
		...options,
	};

	const protocol = opts.protocol ?? detectProtocol();
	const base64Data = buffer.toString("base64");

	switch (protocol) {
		case "kitty":
			return encodeKitty(base64Data);

		case "iterm2":
			return encodeIterm2(base64Data, buffer.length);

		case "sixel":
			// Sixel encoding is complex; fall through to ASCII for now.
			// A full sixel encoder would convert pixels to six-row bands
			// using the DCS sequence format.
			return renderAsciiFromBuffer(buffer, opts);

		case "none":
		default:
			return renderAsciiFromBuffer(buffer, opts);
	}
}

/**
 * Helper to render ASCII from a buffer, extracting pixels first.
 */
function renderAsciiFromBuffer(buffer: Buffer, options: RenderOptions): string {
	const { pixels, width, height } = extractPixels(buffer);
	return renderAscii(pixels, width, height, options);
}
