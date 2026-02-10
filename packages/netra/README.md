# @chitragupta/netra

![Logo](../../assets/logos/netra.svg)

**नेत्र (netra) -- Eye**

**Vision pipeline: image analysis, pixel diffing, terminal image rendering, and screenshots.**

Netra gives Chitragupta eyes. It can analyze images using vision-capable LLMs, render images directly in the terminal (detecting iTerm2, Kitty, and Sixel protocols), compute pixel-level diffs between images, and capture screenshots of terminals, URLs, and files. It bridges the gap between visual content and the text-based agent loop.

---

## Key Features

- **Image metadata** -- Extract dimensions, format, color space from files or buffers via `getImageMeta()` / `getImageMetaFromBuffer()`
- **Format detection** -- Detect PNG, JPEG, GIF, WebP, BMP from magic bytes with `detectFormat()`
- **Terminal image rendering** -- Render images inline using iTerm2, Kitty, or Sixel protocols via `renderImage()` / `renderImageBuffer()`
- **Protocol detection** -- Automatically detect which image protocol the terminal supports with `detectProtocol()`
- **Pixel diffing** -- Decode PNGs and compute pixel-level differences with `decodePng()` / `diffImages()`
- **Vision analysis** -- Send images to vision-capable LLMs for description and analysis via `analyzeImage()` / `analyzeUIChanges()`
- **Screenshots** -- Capture terminal state, URLs, or files as images with `captureTerminal()` / `captureUrl()` / `captureFile()`

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `ImageMeta`, `ImageFormat`, `DiffResult`, `ProtocolType`, `AnalysisResult` |
| `image-meta.ts` | `getImageMeta()`, `getImageMetaFromBuffer()`, `detectFormat()` |
| `terminal-image.ts` | `detectProtocol()`, `renderImage()`, `renderImageBuffer()` |
| `pixel-diff.ts` | `decodePng()`, `diffImages()` |
| `vision-analysis.ts` | `analyzeImage()`, `analyzeUIChanges()` |
| `screenshot.ts` | `captureTerminal()`, `captureUrl()`, `captureFile()` |

## API

### Image Metadata

```typescript
import {
  getImageMeta,
  getImageMetaFromBuffer,
  detectFormat,
} from "@chitragupta/netra";

// From a file path
const meta = await getImageMeta("screenshot.png");
console.log(meta.width, meta.height, meta.format);

// From a buffer
const buffer = await fs.readFile("photo.jpg");
const bufMeta = getImageMetaFromBuffer(buffer);

// Detect format from magic bytes
const format = detectFormat(buffer); // "png" | "jpeg" | "gif" | ...
```

### Terminal Image Rendering

```typescript
import {
  detectProtocol,
  renderImage,
  renderImageBuffer,
} from "@chitragupta/netra";

// Detect what the terminal supports
const protocol = detectProtocol(); // "iterm2" | "kitty" | "sixel" | "none"

// Render an image inline in the terminal
await renderImage("diagram.png");

// Render from a buffer
const buffer = await fs.readFile("chart.png");
renderImageBuffer(buffer);
```

### Pixel Diffing

```typescript
import { decodePng, diffImages } from "@chitragupta/netra";

const before = await decodePng("before.png");
const after = await decodePng("after.png");

const diff = diffImages(before, after);
console.log(`Changed pixels: ${diff.changedPixels}`);
console.log(`Difference: ${(diff.percentage * 100).toFixed(1)}%`);
```

### Vision Analysis

```typescript
import { analyzeImage, analyzeUIChanges } from "@chitragupta/netra";

// Analyze a single image with a vision LLM
const analysis = await analyzeImage("screenshot.png", {
  prompt: "Describe what you see in this UI",
  model: "claude-sonnet-4-5-20250929",
});
console.log(analysis.description);

// Compare two UI states
const changes = await analyzeUIChanges(
  "before.png",
  "after.png",
  { model: "claude-sonnet-4-5-20250929" }
);
console.log(changes.differences);
```

### Screenshots

```typescript
import {
  captureTerminal,
  captureUrl,
  captureFile,
} from "@chitragupta/netra";

// Capture the current terminal state
const termShot = await captureTerminal();

// Capture a web page
const webShot = await captureUrl("https://example.com");

// Capture a file (e.g., render an HTML file)
const fileShot = await captureFile("report.html");
```

---

[Back to Chitragupta root](../../README.md)
