/**
 * @chitragupta/netra — Image diffing WITHOUT external libraries.
 *
 * Implements a basic PNG decoder (zlib decompression, scanline unfiltering)
 * and pixel-by-pixel comparison with connected component labeling for
 * identifying changed regions.
 */

import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import type { DiffResult } from "./types.js";
import { findChangedRegions } from "./union-find.js";

// ─── PNG Decoder ────────────────────────────────────────────────────────────

interface PngDecoded {
	width: number;
	height: number;
	pixels: Uint8Array; // RGBA, row-major, 4 bytes per pixel
}

interface IhdrData {
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
}

/**
 * Parse PNG chunks from a buffer.
 * PNG structure: 8-byte signature, then chunks of [4 len][4 type][len data][4 crc].
 */
function parsePngChunks(buffer: Buffer): Array<{ type: string; data: Buffer }> {
	const chunks: Array<{ type: string; data: Buffer }> = [];
	let offset = 8; // Skip PNG signature

	while (offset < buffer.length) {
		if (offset + 8 > buffer.length) break;

		const length = buffer.readUInt32BE(offset);
		const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
		const data = buffer.subarray(offset + 8, offset + 8 + length);

		chunks.push({ type, data });

		// Skip: length(4) + type(4) + data(length) + crc(4)
		offset += 12 + length;

		if (type === "IEND") break;
	}

	return chunks;
}

/**
 * Parse IHDR chunk data.
 */
function parseIhdr(data: Buffer): IhdrData {
	return {
		width: data.readUInt32BE(0),
		height: data.readUInt32BE(4),
		bitDepth: data[8]!,
		colorType: data[9]!,
	};
}

/**
 * Calculate bytes per pixel based on color type and bit depth.
 *
 * Color types:
 *   0 = Grayscale
 *   2 = RGB (Truecolor)
 *   3 = Indexed (palette)
 *   4 = Grayscale + Alpha
 *   6 = RGBA (Truecolor + Alpha)
 */
function bytesPerPixel(colorType: number, bitDepth: number): number {
	const channelBytes = bitDepth / 8;
	switch (colorType) {
		case 0: return 1 * channelBytes; // Grayscale
		case 2: return 3 * channelBytes; // RGB
		case 3: return 1;                // Indexed (1 byte index)
		case 4: return 2 * channelBytes; // Grayscale + Alpha
		case 6: return 4 * channelBytes; // RGBA
		default: throw new Error(`Unsupported PNG color type: ${colorType}`);
	}
}

/**
 * Paeth predictor function used in PNG filter type 4.
 */
function paethPredictor(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

/**
 * Unfilter PNG scanlines.
 *
 * Each scanline is preceded by a filter type byte:
 *   0 = None (no filter)
 *   1 = Sub (difference from left pixel)
 *   2 = Up (difference from pixel above)
 *   3 = Average (average of left and above)
 *   4 = Paeth (predictor based on left, above, and upper-left)
 */
function unfilterScanlines(
	raw: Buffer,
	width: number,
	height: number,
	bpp: number,
): Uint8Array {
	const stride = width * bpp; // bytes per row (without filter byte)
	const result = new Uint8Array(height * stride);

	let rawOffset = 0;

	for (let y = 0; y < height; y++) {
		const filterType = raw[rawOffset]!;
		rawOffset++;

		const rowStart = y * stride;
		const prevRowStart = (y - 1) * stride;

		for (let x = 0; x < stride; x++) {
			const rawByte = raw[rawOffset + x]!;

			// a = byte to the left (same row), or 0 if at left edge
			const a = x >= bpp ? result[rowStart + x - bpp]! : 0;
			// b = byte above (previous row), or 0 if first row
			const b = y > 0 ? result[prevRowStart + x]! : 0;
			// c = byte to the upper-left, or 0 if at edge
			const c = y > 0 && x >= bpp ? result[prevRowStart + x - bpp]! : 0;

			let value: number;

			switch (filterType) {
				case 0: // None
					value = rawByte;
					break;
				case 1: // Sub
					value = (rawByte + a) & 0xff;
					break;
				case 2: // Up
					value = (rawByte + b) & 0xff;
					break;
				case 3: // Average
					value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
					break;
				case 4: // Paeth
					value = (rawByte + paethPredictor(a, b, c)) & 0xff;
					break;
				default:
					throw new Error(`Unknown PNG filter type: ${filterType}`);
			}

			result[rowStart + x] = value;
		}

		rawOffset += stride;
	}

	return result;
}

/**
 * Convert decoded pixel data to RGBA format regardless of source color type.
 */
function toRgba(
	data: Uint8Array,
	width: number,
	height: number,
	colorType: number,
	bitDepth: number,
	palette?: Buffer,
): Uint8Array {
	const totalPixels = width * height;
	const rgba = new Uint8Array(totalPixels * 4);

	const bpp = bytesPerPixel(colorType, bitDepth);

	for (let i = 0; i < totalPixels; i++) {
		const srcOffset = i * bpp;
		const dstOffset = i * 4;

		switch (colorType) {
			case 0: { // Grayscale
				const gray = data[srcOffset]!;
				rgba[dstOffset] = gray;
				rgba[dstOffset + 1] = gray;
				rgba[dstOffset + 2] = gray;
				rgba[dstOffset + 3] = 255;
				break;
			}
			case 2: { // RGB
				rgba[dstOffset] = data[srcOffset]!;
				rgba[dstOffset + 1] = data[srcOffset + 1]!;
				rgba[dstOffset + 2] = data[srcOffset + 2]!;
				rgba[dstOffset + 3] = 255;
				break;
			}
			case 3: { // Indexed
				const index = data[srcOffset]!;
				if (palette && index * 3 + 2 < palette.length) {
					rgba[dstOffset] = palette[index * 3]!;
					rgba[dstOffset + 1] = palette[index * 3 + 1]!;
					rgba[dstOffset + 2] = palette[index * 3 + 2]!;
					rgba[dstOffset + 3] = 255;
				}
				break;
			}
			case 4: { // Grayscale + Alpha
				const g = data[srcOffset]!;
				rgba[dstOffset] = g;
				rgba[dstOffset + 1] = g;
				rgba[dstOffset + 2] = g;
				rgba[dstOffset + 3] = data[srcOffset + 1]!;
				break;
			}
			case 6: { // RGBA
				rgba[dstOffset] = data[srcOffset]!;
				rgba[dstOffset + 1] = data[srcOffset + 1]!;
				rgba[dstOffset + 2] = data[srcOffset + 2]!;
				rgba[dstOffset + 3] = data[srcOffset + 3]!;
				break;
			}
		}
	}

	return rgba;
}

/**
 * Decode a PNG buffer into raw RGBA pixel data.
 *
 * Steps:
 *   1. Parse chunks (IHDR, PLTE, IDAT, IEND)
 *   2. Concatenate all IDAT chunk data
 *   3. Decompress with zlib (Node.js built-in)
 *   4. Unfilter scanlines (None, Sub, Up, Average, Paeth)
 *   5. Convert to RGBA pixel array
 */
export function decodePng(buffer: Buffer): PngDecoded {
	const chunks = parsePngChunks(buffer);

	// Find IHDR
	const ihdrChunk = chunks.find((c) => c.type === "IHDR");
	if (!ihdrChunk) {
		throw new Error("PNG missing IHDR chunk");
	}
	const ihdr = parseIhdr(ihdrChunk.data);

	if (ihdr.bitDepth !== 8) {
		throw new Error(
			`Unsupported PNG bit depth: ${ihdr.bitDepth}. Only 8-bit PNGs are supported.`
		);
	}

	// Find optional PLTE for indexed color
	const plteChunk = chunks.find((c) => c.type === "PLTE");
	const palette = plteChunk?.data;

	// Concatenate all IDAT chunks
	const idatChunks = chunks.filter((c) => c.type === "IDAT");
	if (idatChunks.length === 0) {
		throw new Error("PNG missing IDAT chunks");
	}

	const totalIdatLength = idatChunks.reduce((sum, c) => sum + c.data.length, 0);
	const compressedData = Buffer.alloc(totalIdatLength);
	let copyOffset = 0;
	for (const chunk of idatChunks) {
		chunk.data.copy(compressedData, copyOffset);
		copyOffset += chunk.data.length;
	}

	// Decompress
	const decompressed = inflateSync(compressedData);

	// Unfilter
	const bpp = bytesPerPixel(ihdr.colorType, ihdr.bitDepth);
	const unfiltered = unfilterScanlines(
		decompressed as Buffer,
		ihdr.width,
		ihdr.height,
		bpp,
	);

	// Convert to RGBA
	const pixels = toRgba(unfiltered, ihdr.width, ihdr.height, ihdr.colorType, ihdr.bitDepth, palette);

	return { width: ihdr.width, height: ihdr.height, pixels };
}

// ─── Pixel Comparison ───────────────────────────────────────────────────────

/**
 * Calculate Euclidean color distance between two RGB pixels.
 */
function colorDistance(
	r1: number, g1: number, b1: number,
	r2: number, g2: number, b2: number,
): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ─── Diff Overlay Generation ────────────────────────────────────────────────

/**
 * Generate a PNG-like diff overlay image as base64.
 *
 * - Unchanged pixels: dimmed (multiplied by 0.3)
 * - Changed in A but not B: red tint (removal)
 * - Changed in B but not A: green tint (addition)
 *
 * Returns raw RGBA data encoded as base64 (not a valid PNG, but usable
 * for further processing or direct pixel inspection).
 */
function generateDiffOverlay(
	pixelsA: Uint8Array,
	pixelsB: Uint8Array,
	diffMask: Uint8Array,
	width: number,
	height: number,
): string {
	const overlay = new Uint8Array(width * height * 4);

	for (let i = 0; i < width * height; i++) {
		const px = i * 4;

		if (diffMask[i]) {
			// Pixel differs: blend both images with a color tint
			const rA = pixelsA[px]!;
			const gA = pixelsA[px + 1]!;
			const bA = pixelsA[px + 2]!;
			const rB = pixelsB[px]!;
			const gB = pixelsB[px + 1]!;
			const bB = pixelsB[px + 2]!;

			// If B is brighter, it's an "addition" (green tint)
			// If A is brighter, it's a "removal" (red tint)
			const lumA = 0.299 * rA + 0.587 * gA + 0.114 * bA;
			const lumB = 0.299 * rB + 0.587 * gB + 0.114 * bB;

			if (lumB >= lumA) {
				// Addition: green tint
				overlay[px] = Math.min(255, Math.floor(rB * 0.5));
				overlay[px + 1] = Math.min(255, Math.floor(gB * 0.5 + 128));
				overlay[px + 2] = Math.min(255, Math.floor(bB * 0.5));
			} else {
				// Removal: red tint
				overlay[px] = Math.min(255, Math.floor(rA * 0.5 + 128));
				overlay[px + 1] = Math.min(255, Math.floor(gA * 0.5));
				overlay[px + 2] = Math.min(255, Math.floor(bA * 0.5));
			}
			overlay[px + 3] = 255;
		} else {
			// Unchanged: dim the original
			overlay[px] = Math.floor(pixelsA[px]! * 0.3);
			overlay[px + 1] = Math.floor(pixelsA[px + 1]! * 0.3);
			overlay[px + 2] = Math.floor(pixelsA[px + 2]! * 0.3);
			overlay[px + 3] = 255;
		}
	}

	return Buffer.from(overlay.buffer).toString("base64");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compare two PNG images pixel-by-pixel and produce a diff result.
 *
 * @param imageA - Path to the first (baseline) PNG image
 * @param imageB - Path to the second (comparison) PNG image
 * @param threshold - Color distance threshold below which pixels are
 *   considered identical (default: 10, range 0-441)
 * @returns DiffResult with similarity score, changed regions, and diff overlay
 */
export async function diffImages(
	imageA: string,
	imageB: string,
	threshold: number = 10,
): Promise<DiffResult> {
	const [bufA, bufB] = await Promise.all([readFile(imageA), readFile(imageB)]);

	const decodedA = decodePng(bufA);
	const decodedB = decodePng(bufB);

	// Images must be the same dimensions for pixel-by-pixel comparison
	if (decodedA.width !== decodedB.width || decodedA.height !== decodedB.height) {
		throw new Error(
			`Image dimensions do not match: ` +
			`${decodedA.width}x${decodedA.height} vs ${decodedB.width}x${decodedB.height}. ` +
			`Both images must have identical dimensions for pixel diff.`
		);
	}

	const { width, height } = decodedA;
	const totalPixels = width * height;
	const diffMask = new Uint8Array(totalPixels); // 1 = different, 0 = same
	let pixelsDifferent = 0;

	// Compare pixel-by-pixel
	for (let i = 0; i < totalPixels; i++) {
		const px = i * 4;
		const dist = colorDistance(
			decodedA.pixels[px]!, decodedA.pixels[px + 1]!, decodedA.pixels[px + 2]!,
			decodedB.pixels[px]!, decodedB.pixels[px + 1]!, decodedB.pixels[px + 2]!,
		);

		if (dist > threshold) {
			diffMask[i] = 1;
			pixelsDifferent++;
		}
	}

	// Find connected regions of changed pixels
	const changedRegions = findChangedRegions(diffMask, width, height);

	// Generate diff overlay
	const diffImageBase64 = generateDiffOverlay(
		decodedA.pixels,
		decodedB.pixels,
		diffMask,
		width,
		height,
	);

	const similarity = totalPixels > 0 ? 1 - pixelsDifferent / totalPixels : 1;

	return {
		similarity,
		changedRegions,
		diffImageBase64,
		pixelsDifferent,
		totalPixels,
	};
}
