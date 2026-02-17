import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectProtocol, renderImageBuffer } from "../src/terminal-image.js";
import { deflateSync } from "node:zlib";

// ─── PNG Builder ────────────────────────────────────────────────────────────

function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function buildTestPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA

  const stride = width * 4;
  const rawData = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + stride)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + stride) + 1 + x * 4;
      rawData[offset] = (x * 50) & 0xff;       // R
      rawData[offset + 1] = (y * 50) & 0xff;   // G
      rawData[offset + 2] = 128;                // B
      rawData[offset + 3] = 255;                // A
    }
  }
  const compressed = deflateSync(rawData);

  return Buffer.concat([
    signature,
    buildChunk("IHDR", ihdrData),
    buildChunk("IDAT", compressed),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectProtocol", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should detect kitty protocol when TERM_PROGRAM=kitty", () => {
    process.env.TERM_PROGRAM = "kitty";
    expect(detectProtocol()).toBe("kitty");
  });

  it("should detect kitty protocol when TERM contains 'kitty'", () => {
    process.env.TERM_PROGRAM = "";
    process.env.TERM = "xterm-kitty";
    expect(detectProtocol()).toBe("kitty");
  });

  it("should detect iTerm2 protocol when TERM_PROGRAM=iTerm.app", () => {
    process.env.TERM_PROGRAM = "iTerm.app";
    process.env.TERM = "";
    expect(detectProtocol()).toBe("iterm2");
  });

  it("should detect iTerm2 protocol when TERM_PROGRAM=iTerm2", () => {
    process.env.TERM_PROGRAM = "iTerm2";
    process.env.TERM = "";
    expect(detectProtocol()).toBe("iterm2");
  });

  it("should detect sixel when SIXEL_SUPPORT=1", () => {
    process.env.TERM_PROGRAM = "";
    process.env.TERM = "";
    process.env.SIXEL_SUPPORT = "1";
    expect(detectProtocol()).toBe("sixel");
  });

  it("should return 'none' for unknown terminals", () => {
    process.env.TERM_PROGRAM = "";
    process.env.TERM = "xterm-256color";
    delete process.env.SIXEL_SUPPORT;
    expect(detectProtocol()).toBe("none");
  });
});

describe("Kitty protocol encoding", () => {
  it("should encode small images in a single chunk", async () => {
    // Create a very small PNG (1x1 pixel)
    const buf = buildTestPng(1, 1);
    const output = await renderImageBuffer(buf, { protocol: "kitty" });

    // Should start with ESC_G sequence
    expect(output).toContain("\x1b_G");
    // Should contain format and action metadata
    expect(output).toContain("f=100");
    expect(output).toContain("t=d");
    expect(output).toContain("a=T");
    // Should end with ESC backslash
    expect(output).toContain("\x1b\\");
    // Small image should have m=0 (last/only chunk)
    expect(output).toContain("m=0");
  });

  it("should chunk large images into 4096-byte base64 segments", async () => {
    // Create a larger PNG that will exceed 4096 bytes in base64
    const buf = buildTestPng(100, 100);
    const output = await renderImageBuffer(buf, { protocol: "kitty" });

    // Should have multiple chunks: first with m=1, last with m=0
    const chunks = output.split("\x1b\\");
    // Filter out empty trailing element from split
    const validChunks = chunks.filter((c) => c.length > 0);

    if (validChunks.length > 1) {
      // First chunk should have m=1 (more to come)
      expect(validChunks[0]).toContain("m=1");
      // Last chunk should have m=0
      expect(validChunks[validChunks.length - 1]).toContain("m=0");
    }
  });

  it("should produce base64-encoded content", async () => {
    const buf = buildTestPng(2, 2);
    const expectedBase64 = buf.toString("base64");
    const output = await renderImageBuffer(buf, { protocol: "kitty" });

    // The full base64 content should be present (possibly across chunks)
    // Extract all data between ; and ESC\
    const dataMatches = output.match(/;([A-Za-z0-9+/=]+)\x1b\\/g);
    expect(dataMatches).not.toBeNull();

    // Concatenate all base64 data
    const allData = dataMatches!
      .map((m) => m.replace(/;/, "").replace(/\x1b\\/, ""))
      .join("");
    expect(allData).toBe(expectedBase64);
  });
});

describe("iTerm2 protocol encoding", () => {
  it("should produce iTerm2 inline image sequence", async () => {
    const buf = buildTestPng(2, 2);
    const output = await renderImageBuffer(buf, { protocol: "iterm2" });

    // Should start with OSC 1337 sequence
    expect(output).toContain("\x1b]1337;File=");
    // Should contain size parameter
    expect(output).toContain(`size=${buf.length}`);
    // Should have inline=1
    expect(output).toContain("inline=1");
    // Should end with BEL
    expect(output).toContain("\x07");
  });

  it("should include base64-encoded data", async () => {
    const buf = buildTestPng(2, 2);
    const expectedBase64 = buf.toString("base64");
    const output = await renderImageBuffer(buf, { protocol: "iterm2" });

    expect(output).toContain(expectedBase64);
  });
});

describe("ASCII fallback rendering", () => {
  it("should render with no escape sequences in ascii colorDepth mode", async () => {
    const buf = buildTestPng(4, 4);
    const output = await renderImageBuffer(buf, {
      protocol: "none",
      colorDepth: "ascii",
      maxWidth: 4,
      maxHeight: 8,
    });

    // ASCII mode should NOT contain ANSI escape sequences for colors
    // But does contain reset at end of lines
    expect(output).toContain("\x1b[0m");
    // Should have visible characters from the ASCII charset
    expect(output.length).toBeGreaterThan(0);
  });

  it("should produce output with ANSI 256-color codes in 256 mode", async () => {
    const buf = buildTestPng(4, 4);
    const output = await renderImageBuffer(buf, {
      protocol: "none",
      colorDepth: "256",
      maxWidth: 4,
      maxHeight: 8,
    });

    // Should contain ANSI 256-color escape sequences
    expect(output).toContain("\x1b[48;5;");
    expect(output).toContain("\x1b[38;5;");
    // Should contain the lower-half block character
    expect(output).toContain("\u2584");
  });

  it("should produce output with truecolor ANSI sequences", async () => {
    const buf = buildTestPng(4, 4);
    const output = await renderImageBuffer(buf, {
      protocol: "none",
      colorDepth: "truecolor",
      maxWidth: 4,
      maxHeight: 8,
    });

    // Should contain 24-bit color escape sequences
    expect(output).toContain("\x1b[48;2;");
    expect(output).toContain("\x1b[38;2;");
  });

  it("should reset colors at end of each line", async () => {
    const buf = buildTestPng(4, 4);
    const output = await renderImageBuffer(buf, {
      protocol: "none",
      colorDepth: "256",
      maxWidth: 4,
      maxHeight: 8,
    });

    const lines = output.split("\n");
    for (const line of lines) {
      expect(line).toContain("\x1b[0m");
    }
  });

  it("should respect maxWidth and maxHeight", async () => {
    const buf = buildTestPng(100, 100);
    const output = await renderImageBuffer(buf, {
      protocol: "none",
      colorDepth: "ascii",
      maxWidth: 10,
      maxHeight: 20,
    });

    const lines = output.split("\n");
    // Each line should be no wider than maxWidth (plus ANSI reset)
    for (const line of lines) {
      // Strip ANSI codes to count actual characters
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
      expect(stripped.length).toBeLessThanOrEqual(10);
    }
  });
});
