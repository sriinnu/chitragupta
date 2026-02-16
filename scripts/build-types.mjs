#!/usr/bin/env node

/**
 * build-types.mjs — Assemble type declarations for @yugenlab/chitragupta
 *
 * Copies .d.ts files from each package's tsc output into dist/_types/<pkg>/,
 * patches @chitragupta/* import paths to use relative paths,
 * and creates barrel .d.ts files for each entry point.
 *
 * Must run AFTER scripts/bundle.mjs (dist/ must exist).
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { resolve, dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const TYPES_DIR = resolve(DIST, "_types");

// All internal packages
const PACKAGES = [
	"core",
	"swara",
	"anina",
	"smriti",
	"ui",
	"yantra",
	"dharma",
	"netra",
	"vayu",
	"sutra",
	"tantra",
	"vidhya-skills",
	"niyanta",
	"cli",
	"darpana",
];

function main() {
	console.log("Assembling type declarations...\n");

	if (!existsSync(DIST)) {
		console.error("dist/ does not exist. Run scripts/bundle.mjs first.");
		process.exit(1);
	}

	mkdirSync(TYPES_DIR, { recursive: true });

	// ── Step 1: Copy .d.ts files from each package's tsc output ──────────────
	let copyCount = 0;
	for (const pkg of PACKAGES) {
		const srcDir = resolve(ROOT, "packages", pkg, "dist");
		const destDir = resolve(TYPES_DIR, pkg);

		if (!existsSync(srcDir)) {
			console.warn(`  ! Skipping ${pkg}: no dist/ directory`);
			continue;
		}

		cpSync(srcDir, destDir, {
			recursive: true,
			filter: (src) => {
				if (statSync(src).isDirectory()) return true;
				// Only copy .d.ts (not .d.ts.map — source .ts files aren't published)
				return src.endsWith(".d.ts") && !src.endsWith(".d.ts.map");
			},
		});
		copyCount++;
	}
	console.log(`  Copied types from ${copyCount} packages`);

	// ── Step 2: Patch @chitragupta/* imports to relative paths ───────────────
	console.log("  Patching import paths...");
	let patchCount = 0;
	walkDts(TYPES_DIR, (filePath) => {
		if (patchImports(filePath)) patchCount++;
	});
	console.log(`  Patched ${patchCount} files`);

	// ── Step 3: Create barrel .d.ts for each entry point ─────────────────────
	console.log("  Creating barrel declarations...");

	// Main barrel: exports core + smriti
	writeFileSync(
		resolve(DIST, "index.d.ts"),
		[
			'export * from "./_types/core/index.js";',
			'export * from "./_types/smriti/index.js";',
			"",
		].join("\n"),
	);

	// Per-package barrels
	for (const pkg of PACKAGES) {
		if (pkg === "cli") continue; // CLI has separate binary entries
		writeFileSync(
			resolve(DIST, `${pkg}.d.ts`),
			`export * from "./_types/${pkg}/index.js";\n`,
		);
	}

	// Binary entry point declarations
	writeFileSync(
		resolve(DIST, "cli.d.ts"),
		'export * from "./_types/cli/cli.js";\n',
	);
	writeFileSync(
		resolve(DIST, "mcp-entry.d.ts"),
		'export * from "./_types/cli/mcp-entry.js";\n',
	);
	writeFileSync(
		resolve(DIST, "code-entry.d.ts"),
		'export * from "./_types/cli/code-entry.js";\n',
	);

	console.log("\n  Done.");
}

/**
 * Walk all .d.ts files in a directory (recursive).
 */
function walkDts(dir, callback) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walkDts(full, callback);
		} else if (entry.name.endsWith(".d.ts") && !entry.name.endsWith(".d.ts.map")) {
			callback(full);
		}
	}
}

/**
 * Patch @chitragupta/* imports in a single .d.ts file.
 * Replaces `from "@chitragupta/pkg"` with `from "<relative>/<pkg>/index.js"`
 * and `from "@chitragupta/pkg/sub"` with `from "<relative>/<pkg>/sub.js"`.
 *
 * Returns true if the file was modified.
 */
function patchImports(filePath) {
	let content = readFileSync(filePath, "utf8");
	let changed = false;

	// Match: from "@chitragupta/..." (in import/export statements)
	const regex = /(from\s+["'])@chitragupta\/([^"']+)(["'])/g;

	content = content.replace(regex, (_match, prefix, importPath, suffix) => {
		const parts = importPath.split("/");
		const pkgName = parts[0];
		const subPath = parts.slice(1).join("/");

		if (!PACKAGES.includes(pkgName)) {
			return _match; // Unknown package — leave as-is
		}

		// Calculate relative path from this file's directory to _types/<pkgName>/
		const fileDir = dirname(filePath);
		const targetDir = resolve(TYPES_DIR, pkgName);
		let relPath = relative(fileDir, targetDir).split(sep).join("/");

		// Ensure it starts with ./
		if (!relPath.startsWith(".")) {
			relPath = "./" + relPath;
		}

		// Build full target path
		const target = subPath ? `${relPath}/${subPath}.js` : `${relPath}/index.js`;

		changed = true;
		return `${prefix}${target}${suffix}`;
	});

	// Also patch import("@chitragupta/...") dynamic type imports
	const dynamicRegex = /(import\s*\(\s*["'])@chitragupta\/([^"']+)(["']\s*\))/g;
	content = content.replace(dynamicRegex, (_match, prefix, importPath, suffix) => {
		const parts = importPath.split("/");
		const pkgName = parts[0];
		const subPath = parts.slice(1).join("/");

		if (!PACKAGES.includes(pkgName)) {
			return _match;
		}

		const fileDir = dirname(filePath);
		const targetDir = resolve(TYPES_DIR, pkgName);
		let relPath = relative(fileDir, targetDir).split(sep).join("/");
		if (!relPath.startsWith(".")) {
			relPath = "./" + relPath;
		}

		const target = subPath ? `${relPath}/${subPath}.js` : `${relPath}/index.js`;
		changed = true;
		return `${prefix}${target}${suffix}`;
	});

	// Remove sourceMappingURL references (we don't ship .d.ts.map files)
	const cleaned = content.replace(/\/\/# sourceMappingURL=.*\.d\.ts\.map\s*$/gm, "");
	if (cleaned !== content) changed = true;

	if (changed) {
		writeFileSync(filePath, cleaned);
	}
	return changed;
}

main();
