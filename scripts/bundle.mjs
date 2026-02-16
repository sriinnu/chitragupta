#!/usr/bin/env node

/**
 * bundle.mjs — Bundle all Chitragupta packages into a single publishable dist/
 *
 * Prerequisites: run `pnpm -r run build` first (tsc compilation).
 * Uses esbuild with code splitting to create optimized ESM bundles.
 *
 * Output:
 *   dist/index.js         Main barrel (core + smriti)
 *   dist/<pkg>.js          Per-package entry points
 *   dist/cli.js            CLI binary
 *   dist/mcp-entry.js      MCP server binary
 *   dist/code-entry.js     Coding agent binary
 *   dist/chunk-*.js        Shared chunks (automatic)
 */

import { build } from "esbuild";
import {
	rmSync,
	mkdirSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

// ── Library entry points (compiled JS from tsc) ──────────────────────────────
const PACKAGES = {
	core: "packages/core/dist/index.js",
	swara: "packages/swara/dist/index.js",
	anina: "packages/anina/dist/index.js",
	smriti: "packages/smriti/dist/index.js",
	ui: "packages/ui/dist/index.js",
	yantra: "packages/yantra/dist/index.js",
	dharma: "packages/dharma/dist/index.js",
	netra: "packages/netra/dist/index.js",
	vayu: "packages/vayu/dist/index.js",
	sutra: "packages/sutra/dist/index.js",
	tantra: "packages/tantra/dist/index.js",
	"vidhya-skills": "packages/vidhya-skills/dist/index.js",
	niyanta: "packages/niyanta/dist/index.js",
	darpana: "packages/darpana/dist/index.js",
};

// ── Binary entry points ──────────────────────────────────────────────────────
const BINARIES = {
	cli: "packages/cli/dist/cli.js",
	"mcp-entry": "packages/cli/dist/mcp-entry.js",
	"code-entry": "packages/cli/dist/code-entry.js",
};

async function main() {
	const start = Date.now();
	console.log("Bundling @yugenlab/chitragupta...\n");

	// Clean dist/
	if (existsSync(DIST)) {
		rmSync(DIST, { recursive: true });
	}
	mkdirSync(DIST, { recursive: true });

	// Verify tsc output exists for all entry points
	const allEntries = { ...PACKAGES, ...BINARIES };
	const missing = [];
	for (const [name, path] of Object.entries(allEntries)) {
		if (!existsSync(resolve(ROOT, path))) {
			missing.push(`  ${name}: ${path}`);
		}
	}
	if (missing.length > 0) {
		console.error("Missing tsc output files:");
		console.error(missing.join("\n"));
		console.error('\nRun "pnpm -r run build" first.');
		process.exit(1);
	}

	// Build entry points map for esbuild
	const entryPoints = {
		// Main barrel — esbuild handles TypeScript natively
		index: resolve(ROOT, "src/barrel.ts"),
	};

	// Library packages (compiled JS)
	for (const [name, path] of Object.entries(PACKAGES)) {
		entryPoints[name] = resolve(ROOT, path);
	}

	// Binary entry points
	for (const [name, path] of Object.entries(BINARIES)) {
		entryPoints[name] = resolve(ROOT, path);
	}

	console.log(`  Entry points: ${Object.keys(entryPoints).length}`);
	console.log(
		`  Packages: ${Object.keys(PACKAGES).length} + ${Object.keys(BINARIES).length} binaries`,
	);

	// Run esbuild
	const result = await build({
		entryPoints,
		outdir: DIST,
		format: "esm",
		platform: "node",
		target: "node22",
		bundle: true,
		splitting: true,
		sourcemap: true,
		treeShaking: true,
		external: ["better-sqlite3"],
		logLevel: "info",
		metafile: true,
		// Ensure chunk filenames are clean
		chunkNames: "chunks/[name]-[hash]",
	});

	// Add shebang to binary entry points
	for (const bin of Object.keys(BINARIES)) {
		const outPath = resolve(DIST, `${bin}.js`);
		if (existsSync(outPath)) {
			const content = readFileSync(outPath, "utf8");
			if (!content.startsWith("#!/")) {
				writeFileSync(outPath, `#!/usr/bin/env node\n${content}`);
			}
		}
	}

	// Write metafile for bundle analysis (not published)
	writeFileSync(
		resolve(DIST, "meta.json"),
		JSON.stringify(result.metafile, null, 2),
	);

	// Print summary
	const outputs = Object.entries(result.metafile.outputs).filter(
		([k]) => k.endsWith(".js") && !k.endsWith(".map"),
	);
	const totalSize = outputs.reduce((sum, [, o]) => sum + o.bytes, 0);
	const entryCount = outputs.filter(
		([, o]) => o.entryPoint !== undefined,
	).length;
	const chunkCount = outputs.length - entryCount;

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(
		`\n  ${entryCount} entry points + ${chunkCount} shared chunks`,
	);
	console.log(`  Total size: ${(totalSize / 1024).toFixed(0)} KB`);
	console.log(`  Done in ${elapsed}s`);
}

main().catch((err) => {
	console.error("Bundle failed:", err);
	process.exit(1);
});
