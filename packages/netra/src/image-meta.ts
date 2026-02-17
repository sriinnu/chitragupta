/**
 * @chitragupta/netra — Image metadata extraction WITHOUT external libraries.
 *
 * Parses PNG, JPEG, GIF, BMP, and WebP headers to extract dimensions
 * and format information using only Node.js built-ins.
 */

import { readFile, stat } from "node:fs/promises";
import type { ImageFormat, ImageMeta } from "./types.js";

// ─── Magic Bytes ────────────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A = Buffer.from("GIF87a", "ascii");
const GIF89A = Buffer.from("GIF89a", "ascii");
const BMP_MAGIC = Buffer.from("BM", "ascii");
const RIFF_MAGIC = Buffer.from("RIFF", "ascii");
const WEBP_MAGIC = Buffer.from("WEBP", "ascii");

// ─── Format Detection ───────────────────────────────────────────────────────

/**
 * Detect image format by inspecting magic bytes at the start of the buffer.
 *
 * Supports PNG, JPEG, GIF (87a/89a), BMP, and WebP.
 *
 * @param buffer - Raw image data buffer (at least 12 bytes recommended).
 * @returns The detected image format, or "unknown" if unrecognized.
 *
 * @example
 * ```ts
 * const format = detectFormat(fs.readFileSync("photo.png"));
 * // => "png"
 * ```
 */
export function detectFormat(buffer: Buffer): ImageFormat {
	if (buffer.length < 4) {
		return "unknown";
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
		return "png";
	}

	// JPEG: FF D8 FF
	if (buffer.subarray(0, 3).equals(JPEG_SOI)) {
		return "jpeg";
	}

	// GIF: GIF87a or GIF89a
	if (buffer.length >= 6) {
		const sig = buffer.subarray(0, 6);
		if (sig.equals(GIF87A) || sig.equals(GIF89A)) {
			return "gif";
		}
	}

	// BMP: BM
	if (buffer.subarray(0, 2).equals(BMP_MAGIC)) {
		return "bmp";
	}

	// WebP: RIFF....WEBP
	if (buffer.length >= 12 && buffer.subarray(0, 4).equals(RIFF_MAGIC) && buffer.subarray(8, 12).equals(WEBP_MAGIC)) {
		return "webp";
	}

	return "unknown";
}

// ─── PNG Parsing ────────────────────────────────────────────────────────────

/**
 * Parse PNG IHDR chunk to extract width and height.
 * Layout: 8-byte signature, then IHDR chunk:
 *   4 bytes length + 4 bytes "IHDR" + 4 bytes width + 4 bytes height + ...
 */
function parsePng(buffer: Buffer): { width: number; height: number } {
	// IHDR starts at byte 8 (after signature)
	// chunk layout: [4 bytes length][4 bytes type][data...][4 bytes crc]
	// IHDR data: [4 bytes width][4 bytes height][1 bit depth][1 color type]...
	if (buffer.length < 24) {
		throw new Error("PNG buffer too short to contain IHDR chunk");
	}
	const chunkLength = buffer.readUInt32BE(8);
	const chunkType = buffer.subarray(12, 16).toString("ascii");
	if (chunkType !== "IHDR" || chunkLength !== 13) {
		throw new Error(`Invalid PNG: expected IHDR chunk (length 13), got "${chunkType}" (length ${chunkLength})`);
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	return { width, height };
}

// ─── JPEG Parsing ───────────────────────────────────────────────────────────

/**
 * Parse JPEG to find SOF0 (0xFFC0) or SOF2 (0xFFC2) marker for dimensions.
 * JPEG structure: series of markers (0xFF + marker byte), each followed by
 * 2-byte length (big-endian) and then (length-2) bytes of data.
 */
function parseJpeg(buffer: Buffer): { width: number; height: number } {
	let offset = 2; // Skip SOI (0xFF 0xD8)

	while (offset < buffer.length - 1) {
		// Find next marker
		if (buffer[offset] !== 0xff) {
			offset++;
			continue;
		}

		// Skip padding FF bytes
		while (offset < buffer.length && buffer[offset] === 0xff) {
			offset++;
		}

		if (offset >= buffer.length) break;

		const marker = buffer[offset];
		offset++;

		// SOF0 (baseline), SOF1 (extended), SOF2 (progressive), SOF3, SOF5-SOF15
		// All SOF markers are in range 0xC0-0xCF except 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC)
		if (
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			if (offset + 7 > buffer.length) break;
			// SOF data: [2 len][1 precision][2 height][2 width]
			const height = buffer.readUInt16BE(offset + 1 + 2);
			const width = buffer.readUInt16BE(offset + 1 + 2 + 2);
			return { width, height };
		}

		// SOS marker — start of scan, stop searching
		if (marker === 0xda) break;

		// For other markers, read length and skip
		if (offset + 1 < buffer.length) {
			const segmentLength = buffer.readUInt16BE(offset);
			offset += segmentLength;
		} else {
			break;
		}
	}

	throw new Error("Could not find SOF marker in JPEG");
}

// ─── GIF Parsing ────────────────────────────────────────────────────────────

/**
 * Parse GIF logical screen descriptor for width and height.
 * Layout: 6-byte signature + 2 bytes width (LE) + 2 bytes height (LE)
 */
function parseGif(buffer: Buffer): { width: number; height: number } {
	if (buffer.length < 10) {
		throw new Error("GIF buffer too short for logical screen descriptor");
	}
	const width = buffer.readUInt16LE(6);
	const height = buffer.readUInt16LE(8);
	return { width, height };
}

// ─── BMP Parsing ────────────────────────────────────────────────────────────

/**
 * Parse BMP DIB header for width and height.
 * Layout: 2 bytes "BM" + 4 file size + 4 reserved + 4 offset +
 *         4 DIB header size + 4 width (LE, signed) + 4 height (LE, signed)
 */
function parseBmp(buffer: Buffer): { width: number; height: number } {
	if (buffer.length < 26) {
		throw new Error("BMP buffer too short for DIB header");
	}
	const width = Math.abs(buffer.readInt32LE(18));
	const height = Math.abs(buffer.readInt32LE(22));
	return { width, height };
}

// ─── WebP Parsing ───────────────────────────────────────────────────────────

/**
 * Parse WebP container for dimensions.
 * WebP has three variants:
 *   - VP8 (lossy): chunk starts at offset 12, dimensions in VP8 bitstream header
 *   - VP8L (lossless): chunk starts at offset 12, dimensions in VP8L header
 *   - VP8X (extended): chunk starts at offset 12, canvas dimensions in VP8X header
 */
function parseWebp(buffer: Buffer): { width: number; height: number } {
	if (buffer.length < 30) {
		throw new Error("WebP buffer too short");
	}

	const chunkType = buffer.subarray(12, 16).toString("ascii");

	if (chunkType === "VP8 ") {
		// Lossy VP8: skip chunk header (8 bytes), then 3-byte frame tag, 3-byte sync code
		// Offset 12 + 4 (type) + 4 (size) = 20, then skip 3 bytes for keyframe header
		// Sync code at offset 23: 0x9D 0x01 0x2A, then 2 bytes width (LE), 2 bytes height (LE)
		const syncOffset = 23;
		if (buffer.length < syncOffset + 7) {
			throw new Error("VP8 buffer too short for frame header");
		}
		if (buffer[syncOffset] === 0x9d && buffer[syncOffset + 1] === 0x01 && buffer[syncOffset + 2] === 0x2a) {
			const width = buffer.readUInt16LE(syncOffset + 3) & 0x3fff;
			const height = buffer.readUInt16LE(syncOffset + 5) & 0x3fff;
			return { width, height };
		}
		throw new Error("VP8 sync code not found");
	}

	if (chunkType === "VP8L") {
		// Lossless VP8L: offset 12 + 4 (type) + 4 (size) = 20, then 1 byte signature (0x2F)
		// Then 4 bytes containing width-1 (14 bits) and height-1 (14 bits)
		const dataOffset = 21; // skip signature byte at 20
		if (buffer.length < dataOffset + 4) {
			throw new Error("VP8L buffer too short");
		}
		const bits = buffer.readUInt32LE(dataOffset);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >> 14) & 0x3fff) + 1;
		return { width, height };
	}

	if (chunkType === "VP8X") {
		// Extended VP8X: offset 12 + 4 (type) + 4 (size) + 4 (flags) = 24
		// Canvas width (24 bits LE) at offset 24, canvas height (24 bits LE) at offset 27
		if (buffer.length < 30) {
			throw new Error("VP8X buffer too short");
		}
		const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
		const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
		return { width, height };
	}

	throw new Error(`Unknown WebP chunk type: "${chunkType}"`);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract image metadata (dimensions, format, size) from a buffer
 * without any external libraries.
 *
 * @param buffer - Raw image data buffer.
 * @returns Metadata including width, height, format, and byte size.
 * @throws If the buffer is too short or the header is malformed for a known format.
 *
 * @example
 * ```ts
 * const meta = getImageMetaFromBuffer(pngBuffer);
 * console.log(`${meta.width}x${meta.height} ${meta.format}`);
 * ```
 */
export function getImageMetaFromBuffer(buffer: Buffer): ImageMeta {
	const format = detectFormat(buffer);
	let width = 0;
	let height = 0;

	switch (format) {
		case "png":
			({ width, height } = parsePng(buffer));
			break;
		case "jpeg":
			({ width, height } = parseJpeg(buffer));
			break;
		case "gif":
			({ width, height } = parseGif(buffer));
			break;
		case "bmp":
			({ width, height } = parseBmp(buffer));
			break;
		case "webp":
			({ width, height } = parseWebp(buffer));
			break;
		default:
			break;
	}

	return {
		width,
		height,
		format,
		sizeBytes: buffer.length,
	};
}

/**
 * Extract image metadata from a file path. Reads only the first ~100 bytes
 * for header parsing (full file for JPEG), then stats the file for full size.
 *
 * @param filePath - Absolute or relative path to the image file.
 * @returns Metadata including width, height, format, byte size, and file path.
 * @throws If the file cannot be read or the header is malformed.
 */
export async function getImageMeta(filePath: string): Promise<ImageMeta> {
	const [fileHandle, fileStat] = await Promise.all([
		readFile(filePath).then((buf) => buf.subarray(0, 100)),
		stat(filePath),
	]);

	// We read the first 100 bytes for header parsing, but need the full
	// buffer for JPEG since SOF markers can be further in the file.
	const format = detectFormat(fileHandle);
	let fullBuffer: Buffer;

	if (format === "jpeg") {
		// JPEG SOF markers can be anywhere; read the full file
		fullBuffer = await readFile(filePath);
	} else {
		fullBuffer = fileHandle;
	}

	const meta = getImageMetaFromBuffer(fullBuffer);
	meta.sizeBytes = fileStat.size;
	meta.filePath = filePath;
	return meta;
}
