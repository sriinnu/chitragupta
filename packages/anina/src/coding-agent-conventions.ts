/**
 * @chitragupta/anina — Project conventions detection.
 *
 * Standalone functions extracted from CodingAgent for auto-detecting
 * project conventions: package manager, language, framework, test
 * framework, indentation style, TypeScript config, and more.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProjectConventions } from "./coding-agent.js";

// ─── Package Manager Detection ──────────────────────────────────────────────

/** Detect which package manager the project uses. */
function detectPackageManager(dir: string): string | undefined {
	if (existsSync(join(dir, "pnpm-lock.yaml")) || existsSync(join(dir, "pnpm-workspace.yaml")))
		return "pnpm";
	if (existsSync(join(dir, "yarn.lock")))
		return "yarn";
	if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock")))
		return "bun";
	if (existsSync(join(dir, "package-lock.json")))
		return "npm";
	return undefined;
}

/** Get the run prefix for a package manager (e.g. "pnpm", "yarn", "npm"). */
function runPrefix(pm: string | undefined): string {
	if (pm === "pnpm") return "pnpm";
	if (pm === "yarn") return "yarn";
	if (pm === "bun") return "bun";
	return "npm";
}

// ─── Package.json Parsing ───────────────────────────────────────────────────

/** Extract conventions from package.json: language, module system, scripts, framework, test framework, formatter. */
function parsePackageJson(
	dir: string,
	conventions: ProjectConventions,
	prefix: string,
): void {
	const pkgPath = join(dir, "package.json");
	if (!existsSync(pkgPath)) return;

	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;

		if (conventions.language === "unknown") {
			conventions.language = "javascript";
		}

		const typeField = pkg.type as string | undefined;
		conventions.moduleSystem = typeField === "module" ? "esm" : typeField === "commonjs" ? "commonjs" : "unknown";

		if (pkg.workspaces && !conventions.isMonorepo) {
			conventions.isMonorepo = true;
		}

		const scripts = pkg.scripts as Record<string, string> | undefined;
		if (scripts) {
			if (scripts.test && scripts.test !== "echo \"Error: no test specified\" && exit 1") {
				conventions.testCommand = `${prefix} test`;
			}
			if (scripts.build) conventions.buildCommand = `${prefix} run build`;
			if (scripts.lint) conventions.lintCommand = `${prefix} run lint`;
		}

		const deps = {
			...(pkg.dependencies as Record<string, string> ?? {}),
			...(pkg.devDependencies as Record<string, string> ?? {}),
		};
		detectFramework(deps, conventions);
		detectTestFramework(deps, conventions);
		detectFormatterFromDeps(deps, conventions);
	} catch {
		// Malformed package.json — continue with defaults
	}
}

/** Detect the primary framework from dependencies. */
function detectFramework(deps: Record<string, string>, conventions: ProjectConventions): void {
	const map: Array<[string | string[], string]> = [
		["next", "next.js"],
		["nuxt", "nuxt"],
		[["remix", "@remix-run/node"], "remix"],
		["astro", "astro"],
		["@angular/core", "angular"],
		["react", "react"],
		["vue", "vue"],
		["svelte", "svelte"],
		["@nestjs/core", "nest.js"],
		["hono", "hono"],
		["express", "express"],
		["fastify", "fastify"],
		["koa", "koa"],
		["elysia", "elysia"],
	];
	for (const [keys, name] of map) {
		const arr = Array.isArray(keys) ? keys : [keys];
		if (arr.some((k) => deps[k])) {
			conventions.framework = name;
			return;
		}
	}
}

/** Detect the test framework from dependencies. */
function detectTestFramework(deps: Record<string, string>, conventions: ProjectConventions): void {
	if (deps.vitest) conventions.testFramework = "vitest";
	else if (deps.jest || deps["@jest/core"]) conventions.testFramework = "jest";
	else if (deps.mocha) conventions.testFramework = "mocha";
	else if (deps.ava) conventions.testFramework = "ava";
	else if (deps.tap || deps["@tapjs/core"]) conventions.testFramework = "tap";
}

/** Detect formatter from dependencies. */
function detectFormatterFromDeps(deps: Record<string, string>, conventions: ProjectConventions): void {
	if (deps.prettier) conventions.formatter = "prettier";
	else if (deps["@biomejs/biome"]) conventions.formatter = "biome";
}

// ─── TypeScript Detection ───────────────────────────────────────────────────

/** Parse tsconfig.json and extract TS conventions. */
function parseTsConfig(dir: string, conventions: ProjectConventions): void {
	const tsconfigPath = join(dir, "tsconfig.json");
	if (!existsSync(tsconfigPath)) return;

	conventions.hasTypeScript = true;
	if (conventions.language === "javascript" || conventions.language === "unknown") {
		conventions.language = "typescript";
	}

	try {
		const raw = readFileSync(tsconfigPath, "utf-8")
			.replace(/\/\/.*$/gm, "")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/,(\s*[}\]])/g, "$1");
		const tsconfig = JSON.parse(raw) as Record<string, unknown>;
		const co = tsconfig.compilerOptions as Record<string, unknown> | undefined;
		if (co) {
			if (co.strict === true) conventions.tsStrictness = "strict";
			else if (co.noImplicitAny === true || co.strictNullChecks === true) conventions.tsStrictness = "moderate";
			else conventions.tsStrictness = "loose";
			if (typeof co.target === "string") conventions.tsTarget = co.target;
		}
	} catch {
		// tsconfig parse error — continue with defaults
	}
}

// ─── Indentation Detection ──────────────────────────────────────────────────

/**
 * Find a sample source file in the working directory to detect indentation.
 * Searches common source directories for index files.
 */
export function findSampleSourceFile(dir: string, isTypeScript: boolean): string | null {
	const extensions = isTypeScript ? [".ts", ".tsx"] : [".js", ".jsx", ".ts", ".tsx"];
	const searchDirs = ["src", "lib", "app", "."];

	for (const subDir of searchDirs) {
		const searchPath = join(dir, subDir);
		if (!existsSync(searchPath)) continue;
		for (const ext of extensions) {
			const indexFile = join(searchPath, `index${ext}`);
			if (existsSync(indexFile)) return indexFile;
		}
	}
	return null;
}

/** Detect indentation style from a sample source file. */
function detectIndentation(dir: string, conventions: ProjectConventions): void {
	const sampleFile = findSampleSourceFile(dir, conventions.hasTypeScript);
	if (!sampleFile) return;

	try {
		const content = readFileSync(sampleFile, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0 && l !== l.trimStart());
		if (lines.length === 0) return;

		const tabLines = lines.filter((l) => l.startsWith("\t")).length;
		const spaceLines = lines.length - tabLines;

		if (tabLines > spaceLines) {
			conventions.indentation = "tabs";
			conventions.indentWidth = 2;
		} else {
			conventions.indentation = "spaces";
			const widths = lines
				.filter((l) => l.startsWith(" "))
				.map((l) => {
					const match = l.match(/^( +)/);
					return match ? match[1].length : 0;
				})
				.filter((w) => w > 0);

			if (widths.length > 0) {
				const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
				const detected = widths.slice(0, 20).reduce(gcd);
				conventions.indentWidth = detected > 0 && detected <= 8 ? detected : 2;
			}
		}
	} catch {
		// Can't read file — keep defaults
	}
}

// ─── Linter & Formatter & Test Pattern Detection ────────────────────────────

/** Detect linter from config files. */
function detectLinter(dir: string, conventions: ProjectConventions, prefix: string): void {
	const npxPrefix = prefix === "npm" ? "npx" : prefix;
	if (existsSync(join(dir, "biome.json")) || existsSync(join(dir, "biome.jsonc"))) {
		if (!conventions.lintCommand) conventions.lintCommand = `${npxPrefix} biome check .`;
	} else if (
		existsSync(join(dir, ".eslintrc")) ||
		existsSync(join(dir, ".eslintrc.js")) ||
		existsSync(join(dir, ".eslintrc.json")) ||
		existsSync(join(dir, ".eslintrc.yml")) ||
		existsSync(join(dir, "eslint.config.js")) ||
		existsSync(join(dir, "eslint.config.mjs")) ||
		existsSync(join(dir, "eslint.config.ts"))
	) {
		if (!conventions.lintCommand) conventions.lintCommand = `${npxPrefix} eslint .`;
	}
}

/** Detect formatter from config files (fallback after deps check). */
function detectFormatterFromFiles(dir: string, conventions: ProjectConventions): void {
	if (conventions.formatter) return;
	if (
		existsSync(join(dir, ".prettierrc")) || existsSync(join(dir, ".prettierrc.json")) ||
		existsSync(join(dir, ".prettierrc.js")) || existsSync(join(dir, "prettier.config.js"))
	) {
		conventions.formatter = "prettier";
	}
}

/** Detect test directory pattern. */
function detectTestPattern(dir: string, conventions: ProjectConventions): void {
	if (existsSync(join(dir, "__tests__"))) conventions.testPattern = "__tests__";
	else if (existsSync(join(dir, "test"))) conventions.testPattern = "test";
	else if (existsSync(join(dir, "tests"))) conventions.testPattern = "tests";
	else if (existsSync(join(dir, "src", "__tests__"))) conventions.testPattern = "src/__tests__";
	else if (conventions.testFramework === "vitest" || conventions.testFramework === "jest") {
		conventions.testPattern = "**/*.test.{ts,tsx,js,jsx}";
	}
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Auto-detect project conventions from the working directory.
 *
 * Checks package.json scripts, tsconfig.json, linter/formatter configs,
 * indentation style from source files, and test directory patterns.
 *
 * @param dir - The project working directory.
 * @param languageHint - Optional language hint from config.
 * @param overrides - Optional command overrides from CodingAgentConfig.
 * @returns Detected project conventions.
 */
export function detectProjectConventions(
	dir: string,
	languageHint?: string,
	overrides?: { testCommand?: string; buildCommand?: string; lintCommand?: string },
): ProjectConventions {
	const conventions: ProjectConventions = {
		language: languageHint ?? "unknown",
		indentation: "tabs",
		indentWidth: 2,
		moduleSystem: "unknown",
		hasTypeScript: false,
	};

	conventions.packageManager = detectPackageManager(dir);
	const prefix = runPrefix(conventions.packageManager);

	// Monorepo detection
	if (
		existsSync(join(dir, "pnpm-workspace.yaml")) ||
		existsSync(join(dir, "lerna.json")) ||
		existsSync(join(dir, "nx.json"))
	) {
		conventions.isMonorepo = true;
	}

	parsePackageJson(dir, conventions, prefix);
	parseTsConfig(dir, conventions);
	detectIndentation(dir, conventions);
	detectLinter(dir, conventions, prefix);
	detectFormatterFromFiles(dir, conventions);
	detectTestPattern(dir, conventions);

	// Apply config overrides
	if (overrides?.testCommand) conventions.testCommand = overrides.testCommand;
	if (overrides?.buildCommand) conventions.buildCommand = overrides.buildCommand;
	if (overrides?.lintCommand) conventions.lintCommand = overrides.lintCommand;

	return conventions;
}
