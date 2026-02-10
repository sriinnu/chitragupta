import { describe, it, expect } from "vitest";
import { detectFormat, getImageMetaFromBuffer } from "../src/image-meta.js";
import { deflateSync } from "node:zlib";

// ─── Test Buffer Builders ───────────────────────────────────────────────────

/**
 * Build a minimal valid PNG buffer with given dimensions.
 * PNG layout: 8-byte signature + IHDR chunk + IDAT chunk + IEND chunk.
 */
function buildPngBuffer(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 13 bytes of data
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData[8] = 8;                    // bit depth = 8
  ihdrData[9] = 6;                    // color type = 6 (RGBA)
  ihdrData[10] = 0;                   // compression method
  ihdrData[11] = 0;                   // filter method
  ihdrData[12] = 0;                   // interlace method

  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrCrc = Buffer.alloc(4); // Simplified CRC (not verified by our parser)

  // IDAT chunk: compressed image data
  // Each scanline: 1 filter byte (0=None) + width*4 bytes (RGBA)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // Filter: None
  }
  const compressed = deflateSync(rawData);
  const idatType = Buffer.from("IDAT", "ascii");
  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressed.length, 0);
  const idatCrc = Buffer.alloc(4);

  // IEND chunk
  const iendType = Buffer.from("IEND", "ascii");
  const iendLength = Buffer.alloc(4);
  iendLength.writeUInt32BE(0, 0);
  const iendCrc = Buffer.alloc(4);

  return Buffer.concat([
    signature,
    ihdrLength, ihdrType, ihdrData, ihdrCrc,
    idatLength, idatType, compressed, idatCrc,
    iendLength, iendType, iendCrc,
  ]);
}

/**
 * Build a minimal JPEG buffer with given dimensions.
 * JPEG: FF D8 FF (SOI) + APP0 marker + SOF0 marker with dimensions.
 */
function buildJpegBuffer(width: number, height: number): Buffer {
  // SOI
  const soi = Buffer.from([0xff, 0xd8, 0xff]);
  // APP0 marker (FFE0) with minimal data
  const app0Marker = Buffer.from([0xff, 0xe0]);
  const app0Length = Buffer.alloc(2);
  app0Length.writeUInt16BE(16, 0);
  const app0Data = Buffer.alloc(14); // JFIF header data
  app0Data.write("JFIF", 0, "ascii");
  app0Data[4] = 0; // null terminator
  app0Data[5] = 1; // version major
  app0Data[6] = 1; // version minor

  // SOF0 marker (FFC0) with dimensions
  const sof0Marker = Buffer.from([0xff, 0xc0]);
  const sof0Length = Buffer.alloc(2);
  sof0Length.writeUInt16BE(11, 0); // length
  const sof0Data = Buffer.alloc(9);
  sof0Data[0] = 8; // precision
  sof0Data.writeUInt16BE(height, 1);
  sof0Data.writeUInt16BE(width, 3);
  sof0Data[5] = 3; // num components
  sof0Data[6] = 1; // component 1
  sof0Data[7] = 0x11; // subsampling
  sof0Data[8] = 0; // quantization table

  return Buffer.concat([soi, app0Marker, app0Length, app0Data, sof0Marker, sof0Length, sof0Data]);
}

/**
 * Build a minimal GIF buffer with given dimensions.
 */
function buildGifBuffer(width: number, height: number, version: "87a" | "89a" = "89a"): Buffer {
  const sig = Buffer.from(`GIF${version}`, "ascii");
  const dimensions = Buffer.alloc(4);
  dimensions.writeUInt16LE(width, 0);
  dimensions.writeUInt16LE(height, 2);
  return Buffer.concat([sig, dimensions]);
}

/**
 * Build a minimal BMP buffer with given dimensions.
 */
function buildBmpBuffer(width: number, height: number): Buffer {
  const header = Buffer.alloc(30);
  header.write("BM", 0, "ascii");             // magic
  header.writeUInt32LE(30, 2);                 // file size (minimal)
  header.writeUInt32LE(0, 6);                  // reserved
  header.writeUInt32LE(26, 10);                // pixel data offset
  header.writeUInt32LE(12, 14);                // DIB header size
  header.writeInt32LE(width, 18);              // width
  header.writeInt32LE(height, 22);             // height
  header.writeUInt16LE(1, 26);                 // color planes
  header.writeUInt16LE(24, 28);                // bits per pixel
  return header;
}

/**
 * Build a minimal WebP VP8 (lossy) buffer with given dimensions.
 */
function buildWebpVP8Buffer(width: number, height: number): Buffer {
  const riff = Buffer.from("RIFF", "ascii");
  const fileSize = Buffer.alloc(4);
  fileSize.writeUInt32LE(100, 0);
  const webp = Buffer.from("WEBP", "ascii");
  const vp8 = Buffer.from("VP8 ", "ascii");
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(30, 0);

  // VP8 bitstream: 3-byte frame tag + sync code + dimensions
  const frameTag = Buffer.alloc(3);
  frameTag[0] = 0x9d;
  frameTag[1] = 0x01;
  frameTag[2] = 0x2a;

  // Sync code at the expected offset
  const data = Buffer.alloc(30);
  // Frame tag at offset 0
  data[0] = 0; // frame tag byte 0
  data[1] = 0; // frame tag byte 1
  data[2] = 0; // frame tag byte 2
  // Sync code: 0x9d 0x01 0x2a at offset 3
  data[3] = 0x9d;
  data[4] = 0x01;
  data[5] = 0x2a;
  data.writeUInt16LE(width & 0x3fff, 6);
  data.writeUInt16LE(height & 0x3fff, 8);

  return Buffer.concat([riff, fileSize, webp, vp8, chunkSize, data]);
}

/**
 * Build a minimal WebP VP8L (lossless) buffer with given dimensions.
 */
function buildWebpVP8LBuffer(width: number, height: number): Buffer {
  const riff = Buffer.from("RIFF", "ascii");
  const fileSize = Buffer.alloc(4);
  fileSize.writeUInt32LE(100, 0);
  const webp = Buffer.from("WEBP", "ascii");
  const vp8l = Buffer.from("VP8L", "ascii");
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(20, 0);

  const data = Buffer.alloc(20);
  data[0] = 0x2f; // VP8L signature byte
  // width-1 in lower 14 bits, height-1 in next 14 bits
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  data.writeUInt32LE(bits, 1);

  return Buffer.concat([riff, fileSize, webp, vp8l, chunkSize, data]);
}

/**
 * Build a minimal WebP VP8X (extended) buffer with given dimensions.
 */
function buildWebpVP8XBuffer(width: number, height: number): Buffer {
  const riff = Buffer.from("RIFF", "ascii");
  const fileSize = Buffer.alloc(4);
  fileSize.writeUInt32LE(100, 0);
  const webp = Buffer.from("WEBP", "ascii");
  const vp8x = Buffer.from("VP8X", "ascii");
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(20, 0);

  const data = Buffer.alloc(20);
  // 4 bytes flags
  data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0;
  // Canvas width-1 as 24-bit LE at offset 4
  const w = width - 1;
  data[4] = w & 0xff;
  data[5] = (w >> 8) & 0xff;
  data[6] = (w >> 16) & 0xff;
  // Canvas height-1 as 24-bit LE at offset 7
  const h = height - 1;
  data[7] = h & 0xff;
  data[8] = (h >> 8) & 0xff;
  data[9] = (h >> 16) & 0xff;

  return Buffer.concat([riff, fileSize, webp, vp8x, chunkSize, data]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectFormat", () => {
  it("should detect PNG format", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectFormat(buf)).toBe("png");
  });

  it("should detect JPEG format", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectFormat(buf)).toBe("jpeg");
  });

  it("should detect GIF87a format", () => {
    const buf = Buffer.from("GIF87a\x00\x00\x00\x00", "ascii");
    expect(detectFormat(buf)).toBe("gif");
  });

  it("should detect GIF89a format", () => {
    const buf = Buffer.from("GIF89a\x00\x00\x00\x00", "ascii");
    expect(detectFormat(buf)).toBe("gif");
  });

  it("should detect BMP format", () => {
    const buf = Buffer.from("BM\x00\x00\x00\x00\x00\x00", "ascii");
    expect(detectFormat(buf)).toBe("bmp");
  });

  it("should detect WebP format", () => {
    const buf = Buffer.alloc(16);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(100, 4);
    buf.write("WEBP", 8, "ascii");
    expect(detectFormat(buf)).toBe("webp");
  });

  it("should return 'unknown' for unrecognized formats", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(detectFormat(buf)).toBe("unknown");
  });

  it("should return 'unknown' for buffers shorter than 4 bytes", () => {
    const buf = Buffer.from([0x89, 0x50]);
    expect(detectFormat(buf)).toBe("unknown");
  });

  it("should return 'unknown' for empty buffer", () => {
    const buf = Buffer.alloc(0);
    expect(detectFormat(buf)).toBe("unknown");
  });
});

describe("getImageMetaFromBuffer", () => {
  describe("PNG parsing", () => {
    it("should extract width and height from a PNG buffer", () => {
      const buf = buildPngBuffer(640, 480);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(640);
      expect(meta.height).toBe(480);
      expect(meta.sizeBytes).toBe(buf.length);
    });

    it("should handle small PNG dimensions", () => {
      const buf = buildPngBuffer(1, 1);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.width).toBe(1);
      expect(meta.height).toBe(1);
    });

    it("should handle large PNG dimensions", () => {
      const buf = buildPngBuffer(3840, 2160);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.width).toBe(3840);
      expect(meta.height).toBe(2160);
    });

    it("should throw for truncated PNG (too short for IHDR)", () => {
      // Build a PNG signature only (8 bytes) + partial IHDR
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      expect(() => getImageMetaFromBuffer(buf)).toThrow();
    });
  });

  describe("JPEG parsing", () => {
    it("should extract width and height from a JPEG buffer", () => {
      const buf = buildJpegBuffer(1920, 1080);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("jpeg");
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
    });

    it("should handle small JPEG dimensions", () => {
      const buf = buildJpegBuffer(16, 16);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.width).toBe(16);
      expect(meta.height).toBe(16);
    });
  });

  describe("GIF parsing", () => {
    it("should extract width and height from a GIF89a buffer", () => {
      const buf = buildGifBuffer(320, 240, "89a");
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("gif");
      expect(meta.width).toBe(320);
      expect(meta.height).toBe(240);
    });

    it("should extract width and height from a GIF87a buffer", () => {
      const buf = buildGifBuffer(100, 50, "87a");
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("gif");
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(50);
    });
  });

  describe("BMP parsing", () => {
    it("should extract width and height from a BMP buffer", () => {
      const buf = buildBmpBuffer(800, 600);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("bmp");
      expect(meta.width).toBe(800);
      expect(meta.height).toBe(600);
    });

    it("should handle negative BMP height (top-down)", () => {
      const buf = buildBmpBuffer(100, -200);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(200); // abs value
    });
  });

  describe("WebP parsing", () => {
    it("should extract dimensions from WebP VP8 (lossy)", () => {
      const buf = buildWebpVP8Buffer(1024, 768);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(768);
    });

    it("should extract dimensions from WebP VP8L (lossless)", () => {
      const buf = buildWebpVP8LBuffer(512, 256);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(256);
    });

    it("should extract dimensions from WebP VP8X (extended)", () => {
      const buf = buildWebpVP8XBuffer(2048, 1024);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(2048);
      expect(meta.height).toBe(1024);
    });
  });

  describe("unknown format", () => {
    it("should return 0x0 for unknown formats", () => {
      const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      const meta = getImageMetaFromBuffer(buf);
      expect(meta.format).toBe("unknown");
      expect(meta.width).toBe(0);
      expect(meta.height).toBe(0);
    });
  });
});
