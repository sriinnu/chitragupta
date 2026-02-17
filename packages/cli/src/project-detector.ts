/**
 * @chitragupta/cli — Project type detection.
 *
 * Detects the project type, name, framework, and package manager
 * by inspecting files in the current working directory.
 */

import fs from "fs";
import path from "path";

export interface ProjectInfo {
	type: string;
	name?: string;
	framework?: string;
	packageManager?: string;
	path: string;
}

/**
 * Detect the project type from the given directory.
 *
 * Checks for well-known project manifest files (package.json, Cargo.toml,
 * go.mod, pyproject.toml, Gemfile, pom.xml, build.gradle) and extracts
 * metadata where possible. Returns a generic "unknown" type if no
 * recognized files are found.
 *
 * @param dir - Absolute path to the project directory.
 * @returns Detected project info including type, name, framework, and package manager.
 */
export function detectProject(dir: string): ProjectInfo {
	const info: ProjectInfo = {
		type: "unknown",
		path: dir,
	};

	// ─── Node.js / TypeScript ───────────────────────────────────────────
	const packageJsonPath = path.join(dir, "package.json");
	if (fs.existsSync(packageJsonPath)) {
		info.type = "node";
		try {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
			info.name = pkg.name;

			// Detect TypeScript
			const tsconfigPath = path.join(dir, "tsconfig.json");
			if (fs.existsSync(tsconfigPath) || pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
				info.type = "typescript";
			}

			// Detect framework
			const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (allDeps?.next) {
				info.framework = "next.js";
			} else if (allDeps?.react) {
				info.framework = "react";
			} else if (allDeps?.vue) {
				info.framework = "vue";
			} else if (allDeps?.svelte || allDeps?.["@sveltejs/kit"]) {
				info.framework = "svelte";
			} else if (allDeps?.express) {
				info.framework = "express";
			} else if (allDeps?.fastify) {
				info.framework = "fastify";
			} else if (allDeps?.hono) {
				info.framework = "hono";
			} else if (allDeps?.astro) {
				info.framework = "astro";
			} else if (allDeps?.nuxt) {
				info.framework = "nuxt";
			} else if (allDeps?.angular || allDeps?.["@angular/core"]) {
				info.framework = "angular";
			}

			// Detect package manager
			if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) {
				info.packageManager = "bun";
			} else if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
				info.packageManager = "pnpm";
			} else if (fs.existsSync(path.join(dir, "yarn.lock"))) {
				info.packageManager = "yarn";
			} else if (fs.existsSync(path.join(dir, "package-lock.json"))) {
				info.packageManager = "npm";
			}
		} catch {
			// Failed to parse package.json — keep type as "node"
		}

		return info;
	}

	// ─── Rust ───────────────────────────────────────────────────────────
	const cargoPath = path.join(dir, "Cargo.toml");
	if (fs.existsSync(cargoPath)) {
		info.type = "rust";
		try {
			const cargo = fs.readFileSync(cargoPath, "utf-8");
			const nameMatch = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
			if (nameMatch) {
				info.name = nameMatch[1];
			}
		} catch {
			// Best effort
		}
		return info;
	}

	// ─── Go ─────────────────────────────────────────────────────────────
	const goModPath = path.join(dir, "go.mod");
	if (fs.existsSync(goModPath)) {
		info.type = "go";
		try {
			const goMod = fs.readFileSync(goModPath, "utf-8");
			const moduleMatch = goMod.match(/^module\s+(.+)/m);
			if (moduleMatch) {
				info.name = moduleMatch[1].trim();
			}
		} catch {
			// Best effort
		}
		return info;
	}

	// ─── Python ─────────────────────────────────────────────────────────
	const pyprojectPath = path.join(dir, "pyproject.toml");
	const requirementsPath = path.join(dir, "requirements.txt");
	const setupPyPath = path.join(dir, "setup.py");

	if (fs.existsSync(pyprojectPath)) {
		info.type = "python";
		try {
			const content = fs.readFileSync(pyprojectPath, "utf-8");
			const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
			if (nameMatch) {
				info.name = nameMatch[1];
			}
			// Detect framework
			if (content.includes("django")) {
				info.framework = "django";
			} else if (content.includes("fastapi")) {
				info.framework = "fastapi";
			} else if (content.includes("flask")) {
				info.framework = "flask";
			}
		} catch {
			// Best effort
		}

		if (fs.existsSync(path.join(dir, "poetry.lock"))) {
			info.packageManager = "poetry";
		} else if (fs.existsSync(path.join(dir, "uv.lock"))) {
			info.packageManager = "uv";
		} else if (fs.existsSync(path.join(dir, "Pipfile"))) {
			info.packageManager = "pipenv";
		} else {
			info.packageManager = "pip";
		}

		return info;
	}

	if (fs.existsSync(requirementsPath) || fs.existsSync(setupPyPath)) {
		info.type = "python";
		info.packageManager = "pip";
		return info;
	}

	// ─── Ruby ───────────────────────────────────────────────────────────
	const gemfilePath = path.join(dir, "Gemfile");
	if (fs.existsSync(gemfilePath)) {
		info.type = "ruby";
		info.packageManager = "bundler";
		try {
			const gemfile = fs.readFileSync(gemfilePath, "utf-8");
			if (gemfile.includes("rails")) {
				info.framework = "rails";
			} else if (gemfile.includes("sinatra")) {
				info.framework = "sinatra";
			}
		} catch {
			// Best effort
		}
		return info;
	}

	// ─── Java / Kotlin ──────────────────────────────────────────────────
	if (fs.existsSync(path.join(dir, "pom.xml"))) {
		info.type = "java";
		info.packageManager = "maven";
		return info;
	}

	if (fs.existsSync(path.join(dir, "build.gradle")) || fs.existsSync(path.join(dir, "build.gradle.kts"))) {
		info.type = "java";
		info.packageManager = "gradle";
		return info;
	}

	return info;
}
