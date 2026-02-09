/**
 * @chitragupta/netra — Screenshot capture utilities.
 *
 * Captures screenshots using platform-native tools (macOS screencapture)
 * and headless browsers when available.
 */

import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ScreenshotOptions } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a temporary file path with the given extension.
 */
function tempPath(ext: string): string {
	const name = `netra-${randomBytes(8).toString("hex")}.${ext}`;
	return join(tmpdir(), name);
}

/**
 * Execute a command and return a promise.
 */
function exec(
	command: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 30_000 }, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

/**
 * Check if a command exists in PATH.
 */
async function commandExists(command: string): Promise<boolean> {
	try {
		await exec("which", [command]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Terminal Screenshot ────────────────────────────────────────────────────

/**
 * Capture a screenshot of the current screen using platform-native tools.
 *
 * - macOS: uses the built-in `screencapture` command.
 * - Linux: tries ImageMagick `import`, `scrot`, `gnome-screenshot`, or `xfce4-screenshooter`.
 *
 * @returns Buffer containing the PNG screenshot data.
 * @throws If no screenshot tool is available on the current platform.
 */
export async function captureTerminal(): Promise<Buffer> {
	if (process.platform === "darwin") {
		const outPath = tempPath("png");

		try {
			// -x = no sound, -C = capture cursor, -t png = format
			await exec("screencapture", ["-x", "-t", "png", outPath]);
			const buffer = await readFile(outPath);
			return buffer;
		} finally {
			// Clean up temp file
			await unlink(outPath).catch(() => {});
		}
	}

	if (process.platform === "linux") {
		// Try common Linux screenshot tools
		const tools = [
			{ cmd: "import", args: (path: string) => ["-window", "root", path] },          // ImageMagick
			{ cmd: "scrot", args: (path: string) => [path] },                                // scrot
			{ cmd: "gnome-screenshot", args: (path: string) => ["-f", path] },               // GNOME
			{ cmd: "xfce4-screenshooter", args: (path: string) => ["-f", "-s", path] },      // XFCE
		];

		for (const tool of tools) {
			if (await commandExists(tool.cmd)) {
				const outPath = tempPath("png");
				try {
					await exec(tool.cmd, tool.args(outPath));
					const buffer = await readFile(outPath);
					return buffer;
				} catch {
					await unlink(outPath).catch(() => {});
					continue;
				}
			}
		}

		throw new Error(
			"No screenshot tool found on Linux. Install one of: " +
			"imagemagick (import), scrot, gnome-screenshot, or xfce4-screenshooter."
		);
	}

	throw new Error(
		`Screen capture is not supported on ${process.platform}. ` +
		`Supported platforms: macOS (screencapture), Linux (import/scrot/gnome-screenshot).`
	);
}

// ─── URL Screenshot ─────────────────────────────────────────────────────────

/**
 * Find an available headless browser in PATH.
 * Returns the command name or null if none found.
 */
async function findBrowser(): Promise<string | null> {
	const browsers = [
		"chromium",
		"chromium-browser",
		"google-chrome",
		"google-chrome-stable",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"firefox",
	];

	for (const browser of browsers) {
		if (await commandExists(browser)) {
			return browser;
		}
	}

	return null;
}

/**
 * Capture a screenshot of a URL using a headless browser.
 *
 * Attempts to use Chromium/Chrome first (headless mode with --screenshot),
 * then falls back to Firefox if available.
 *
 * @param url - The URL to screenshot.
 * @param options - Screenshot options (selector, fullPage, delay, format).
 * @returns Buffer containing the screenshot image data.
 * @throws If no headless browser is found in PATH.
 */
export async function captureUrl(
	url: string,
	options?: ScreenshotOptions,
): Promise<Buffer> {
	const browser = await findBrowser();

	if (!browser) {
		throw new Error(
			"No headless browser found. Install one of:\n" +
			"  - Chromium: brew install chromium (macOS) / apt install chromium (Linux)\n" +
			"  - Chrome: https://www.google.com/chrome/\n" +
			"  - Firefox: brew install firefox (macOS) / apt install firefox (Linux)\n\n" +
			"A headless browser is required for URL screenshot capture."
		);
	}

	const format = options?.format ?? "png";
	const width = options?.width ?? 1280;
	const height = options?.height ?? 720;
	const outPath = tempPath(format);

	if (options?.delay) {
		await delay(options.delay);
	}

	try {
		if (browser.includes("firefox")) {
			// Firefox headless screenshot
			await exec(browser, [
				"--headless",
				"--screenshot", outPath,
				`--window-size=${width},${height}`,
				url,
			]);
		} else {
			// Chromium/Chrome headless screenshot
			const args = [
				"--headless=new",
				"--disable-gpu",
				"--no-sandbox",
				"--disable-dev-shm-usage",
				`--screenshot=${outPath}`,
				`--window-size=${width},${height}`,
			];

			if (options?.fullPage) {
				args.push("--full-page-screenshot");
			}

			args.push(url);

			await exec(browser, args);
		}

		const buffer = await readFile(outPath);
		return buffer;
	} finally {
		await unlink(outPath).catch(() => {});
	}
}

// ─── Local HTML File Screenshot ─────────────────────────────────────────────

/**
 * Capture a screenshot of a local HTML file.
 * Converts the file path to a `file://` URL and delegates to {@link captureUrl}.
 *
 * @param htmlPath - Absolute or relative path to the HTML file.
 * @param options - Screenshot options.
 * @returns Buffer containing the screenshot image data.
 * @throws If no headless browser is found in PATH.
 */
export async function captureFile(
	htmlPath: string,
	options?: ScreenshotOptions,
): Promise<Buffer> {
	// Convert to file:// URL
	const { resolve } = await import("node:path");
	const absolutePath = resolve(htmlPath);
	const fileUrl = `file://${absolutePath}`;

	return captureUrl(fileUrl, options);
}
