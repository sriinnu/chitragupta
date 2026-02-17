import { describe, it, expect, vi } from "vitest";
import { decodePng } from "../src/pixel-diff.js";
import { deflateSync } from "node:zlib";

// ─── PNG Builder Helper ─────────────────────────────────────────────────────

/**
 * Build a minimal valid PNG buffer from RGBA pixel data.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param pixels - RGBA pixel data (width * height * 4 bytes)
 * @param colorType - PNG color type (6 = RGBA, 2 = RGB, 0 = Grayscale)
 * @param filterType - Scanline filter type (0=None, 1=Sub, 2=Up)
 */
function buildPngFromPixels(
  width: number,
  height: number,
  pixels: Uint8Array,
  colorType: number = 6,
  filterType: number = 0,
): Buffer {
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;

  // Build raw scanline data with filter bytes
  const rawData = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + stride)] = filterType; // filter byte
    for (let x = 0; x < stride; x++) {
      rawData[y * (1 + stride) + 1 + x] = pixels[y * stride + x];
    }
  }

  const compressed = deflateSync(rawData);

  // Build PNG file
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = colorType;
  const ihdrChunk = buildChunk("IHDR", ihdrData);

  // IDAT
  const idatChunk = buildChunk("IDAT", compressed);

  // IEND
  const iendChunk = buildChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); // Simplified CRC
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * Create a solid color RGBA image.
 */
function solidImage(width: number, height: number, r: number, g: number, b: number, a: number = 255): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = a;
  }
  return pixels;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("decodePng", () => {
  it("should decode a 2x2 RGBA PNG with all black pixels", () => {
    const pixels = new Uint8Array(2 * 2 * 4); // All zeros (black, transparent)
    pixels.fill(0);
    // Set alpha to 255
    for (let i = 0; i < 4; i++) {
      pixels[i * 4 + 3] = 255;
    }

    const buf = buildPngFromPixels(2, 2, pixels);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.pixels.length).toBe(2 * 2 * 4);
    // Check first pixel is black with full alpha
    expect(decoded.pixels[0]).toBe(0);
    expect(decoded.pixels[1]).toBe(0);
    expect(decoded.pixels[2]).toBe(0);
    expect(decoded.pixels[3]).toBe(255);
  });

  it("should decode a solid red 4x4 PNG", () => {
    const pixels = solidImage(4, 4, 255, 0, 0, 255);
    const buf = buildPngFromPixels(4, 4, pixels);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    // Check all pixels are red
    for (let i = 0; i < 16; i++) {
      expect(decoded.pixels[i * 4]).toBe(255);     // R
      expect(decoded.pixels[i * 4 + 1]).toBe(0);   // G
      expect(decoded.pixels[i * 4 + 2]).toBe(0);   // B
      expect(decoded.pixels[i * 4 + 3]).toBe(255);  // A
    }
  });

  it("should decode a 1x1 PNG", () => {
    const pixels = solidImage(1, 1, 128, 64, 32, 255);
    const buf = buildPngFromPixels(1, 1, pixels);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(decoded.pixels[0]).toBe(128);
    expect(decoded.pixels[1]).toBe(64);
    expect(decoded.pixels[2]).toBe(32);
    expect(decoded.pixels[3]).toBe(255);
  });

  it("should decode a PNG with varying pixel values", () => {
    const width = 3;
    const height = 2;
    const pixels = new Uint8Array(width * height * 4);
    // Row 0: red, green, blue
    pixels.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 0);
    // Row 1: white, gray, black
    pixels.set([255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 255], 12);

    const buf = buildPngFromPixels(width, height, pixels);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Check first pixel (red)
    expect(decoded.pixels[0]).toBe(255);
    expect(decoded.pixels[1]).toBe(0);
    expect(decoded.pixels[2]).toBe(0);
    // Check second pixel (green)
    expect(decoded.pixels[4]).toBe(0);
    expect(decoded.pixels[5]).toBe(255);
  });

  it("should throw for missing IHDR chunk", () => {
    // Build a buffer with PNG signature but no valid chunks
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const invalidChunk = buildChunk("XYZZ", Buffer.alloc(10));
    const iend = buildChunk("IEND", Buffer.alloc(0));

    const buf = Buffer.concat([signature, invalidChunk, iend]);
    expect(() => decodePng(buf)).toThrow("IHDR");
  });

  it("should throw for missing IDAT chunks", () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(2, 0);
    ihdrData.writeUInt32BE(2, 4);
    ihdrData[8] = 8;
    ihdrData[9] = 6;
    const ihdrChunk = buildChunk("IHDR", ihdrData);
    const iend = buildChunk("IEND", Buffer.alloc(0));

    const buf = Buffer.concat([signature, ihdrChunk, iend]);
    expect(() => decodePng(buf)).toThrow("IDAT");
  });

  it("should decode an RGB (colorType=2) PNG to RGBA", () => {
    const width = 2;
    const height = 2;
    // RGB data (3 bytes per pixel)
    const rgbPixels = new Uint8Array([
      255, 0, 0,    // red
      0, 255, 0,    // green
      0, 0, 255,    // blue
      255, 255, 0,  // yellow
    ]);

    const buf = buildPngFromPixels(width, height, rgbPixels, 2);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    // RGBA output: alpha should be 255
    expect(decoded.pixels[3]).toBe(255);  // first pixel alpha
    expect(decoded.pixels[7]).toBe(255);  // second pixel alpha
    expect(decoded.pixels[0]).toBe(255);  // red channel of first pixel
    expect(decoded.pixels[4]).toBe(0);    // red channel of second pixel (green)
    expect(decoded.pixels[5]).toBe(255);  // green channel of second pixel
  });

  it("should decode a grayscale (colorType=0) PNG to RGBA", () => {
    const width = 2;
    const height = 1;
    const grayPixels = new Uint8Array([0, 255]); // black, white

    const buf = buildPngFromPixels(width, height, grayPixels, 0);
    const decoded = decodePng(buf);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    // Black pixel: R=0, G=0, B=0, A=255
    expect(decoded.pixels[0]).toBe(0);
    expect(decoded.pixels[1]).toBe(0);
    expect(decoded.pixels[2]).toBe(0);
    expect(decoded.pixels[3]).toBe(255);
    // White pixel: R=255, G=255, B=255, A=255
    expect(decoded.pixels[4]).toBe(255);
    expect(decoded.pixels[5]).toBe(255);
    expect(decoded.pixels[6]).toBe(255);
    expect(decoded.pixels[7]).toBe(255);
  });
});

describe("pixel comparison (via identical images)", () => {
  it("should produce identical decoded output for the same PNG", () => {
    const pixels = solidImage(4, 4, 100, 150, 200, 255);
    const buf = buildPngFromPixels(4, 4, pixels);

    const decoded1 = decodePng(buf);
    const decoded2 = decodePng(buf);

    expect(decoded1.width).toBe(decoded2.width);
    expect(decoded1.height).toBe(decoded2.height);

    // All pixels should match exactly
    for (let i = 0; i < decoded1.pixels.length; i++) {
      expect(decoded1.pixels[i]).toBe(decoded2.pixels[i]);
    }
  });

  it("should produce different pixels for different images", () => {
    const redPixels = solidImage(2, 2, 255, 0, 0, 255);
    const bluePixels = solidImage(2, 2, 0, 0, 255, 255);

    const redBuf = buildPngFromPixels(2, 2, redPixels);
    const blueBuf = buildPngFromPixels(2, 2, bluePixels);

    const decodedRed = decodePng(redBuf);
    const decodedBlue = decodePng(blueBuf);

    // Pixels should differ
    let diffCount = 0;
    for (let i = 0; i < decodedRed.pixels.length; i++) {
      if (decodedRed.pixels[i] !== decodedBlue.pixels[i]) {
        diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });
});

describe("connected component labeling (Union-Find integration)", () => {
  // The Union-Find is used internally by diffImages, tested via integration.
  // Here we verify that decoding produces correct spatial pixel layout.

  it("should preserve spatial layout: top-left pixel differs from bottom-right", () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8Array(width * height * 4);

    // Fill all white
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 255;
      pixels[i * 4 + 2] = 255;
      pixels[i * 4 + 3] = 255;
    }

    // Set top-left corner (0,0) to red
    pixels[0] = 255;
    pixels[1] = 0;
    pixels[2] = 0;

    // Set bottom-right corner (3,3) to blue
    const brIdx = (3 * width + 3) * 4;
    pixels[brIdx] = 0;
    pixels[brIdx + 1] = 0;
    pixels[brIdx + 2] = 255;

    const buf = buildPngFromPixels(width, height, pixels);
    const decoded = decodePng(buf);

    // Verify top-left is red
    expect(decoded.pixels[0]).toBe(255);
    expect(decoded.pixels[1]).toBe(0);
    expect(decoded.pixels[2]).toBe(0);

    // Verify bottom-right is blue
    const brDecIdx = (3 * width + 3) * 4;
    expect(decoded.pixels[brDecIdx]).toBe(0);
    expect(decoded.pixels[brDecIdx + 1]).toBe(0);
    expect(decoded.pixels[brDecIdx + 2]).toBe(255);
  });

  it("should handle a checkerboard pattern", () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const isWhite = (x + y) % 2 === 0;
        pixels[idx] = isWhite ? 255 : 0;
        pixels[idx + 1] = isWhite ? 255 : 0;
        pixels[idx + 2] = isWhite ? 255 : 0;
        pixels[idx + 3] = 255;
      }
    }

    const buf = buildPngFromPixels(width, height, pixels);
    const decoded = decodePng(buf);

    // Verify checkerboard pattern is preserved
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const isWhite = (x + y) % 2 === 0;
        expect(decoded.pixels[idx]).toBe(isWhite ? 255 : 0);
      }
    }
  });
});
