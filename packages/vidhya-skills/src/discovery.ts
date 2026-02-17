/**
 * @module discovery
 * @description Discover skills from multiple sources: directories, node_modules,
 * and file watchers.
 *
 * The discovery system finds `skill.md` files (case-insensitive, also matches
 * `SKILL.md`) in directory trees, parses them into {@link SkillManifest}
 * objects, and optionally watches for changes.
 *
 * ## Discovery Sources
 *
 * - **Directory Scanner**: Recursively finds `skill.md` / `SKILL.md` files in a directory tree
 * - **Package Scanner**: Finds npm packages with `"chitragupta-skill"` keyword
 * - **File Watcher**: Watches directories for skill.md / SKILL.md additions/changes/removals
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseSkillMarkdown } from "./parser.js";
import type { SkillManifest } from "./types.js";
import type { SkillSandbox } from "./skill-sandbox.js";
import type { SurakshaScanner } from "./suraksha.js";
import type { KulaType, EnhancedSkillManifest } from "./types-v2.js";
import type { KulaRegistry } from "./kula.js";
import { checkPranamaya } from "./pancha-kosha.js";

/**
 * Event emitted when a skill.md file changes on disk.
 */
export interface SkillChangeEvent {
	/** The type of change. */
	type: "added" | "changed" | "removed";
	/** Absolute path to the skill.md file. */
	filePath: string;
	/** The parsed manifest (undefined for "removed" events). */
	manifest?: SkillManifest;
}

/**
 * Skill discovery engine — finds and watches skill.md files across
 * directories and packages.
 *
 * @example
 * ```ts
 * const discovery = new SkillDiscovery();
 * const skills = await discovery.discoverFromDirectory("./skills");
 * const cleanup = discovery.watchDirectory("./skills", (event) => {
 *   console.log(event.type, event.filePath);
 * });
 * // Later: cleanup();
 * ```
 */
export class SkillDiscovery {
	/** Active file watchers. */
	private watchers: fs.FSWatcher[] = [];
	/** Optional sandbox for quarantine gating. */
	private sandbox?: SkillSandbox;
	/** Optional scanner for security analysis. */
	private scanner?: SurakshaScanner;

	/**
	 * Set optional security components for gated discovery.
	 * When set, `discoverAndQuarantine()` will scan and quarantine discovered skills.
	 */
	setSecurity(opts: { sandbox?: SkillSandbox; scanner?: SurakshaScanner }): void {
		this.sandbox = opts.sandbox;
		this.scanner = opts.scanner;
	}

	/**
	 * Discover skills from a directory and submit them to quarantine.
	 *
	 * Each discovered skill is scanned with Suraksha (if available) and
	 * submitted to the SkillSandbox for quarantine. Returns the quarantine
	 * IDs for each submitted skill.
	 *
	 * Requires sandbox and scanner to be set via `setSecurity()`.
	 *
	 * @param dirPath - Directory to scan for skill.md files.
	 * @returns Array of { manifest, quarantineId } for submitted skills.
	 */
	async discoverAndQuarantine(
		dirPath: string,
	): Promise<Array<{ manifest: SkillManifest; quarantineId: string }>> {
		if (!this.sandbox) {
			throw new Error("SkillSandbox not set. Call setSecurity() first.");
		}

		const manifests = await this.discoverFromDirectory(dirPath);
		const results: Array<{ manifest: SkillManifest; quarantineId: string }> = [];

		for (const manifest of manifests) {
			// Read the raw content for scanning
			let content = "";
			if (manifest.source.type === "manual" && manifest.source.filePath) {
				try {
					content = await fs.promises.readFile(manifest.source.filePath, "utf-8");
				} catch {
					content = JSON.stringify(manifest);
				}
			}

			// Scan if scanner available
			if (this.scanner && content) {
				this.scanner.scan(manifest.name, content);
			}

			// Submit to quarantine
			const quarantineId = this.sandbox.submit(
				{
					name: manifest.name,
					description: manifest.description,
					tags: manifest.tags,
					content,
				},
				"external",
			);

			results.push({ manifest, quarantineId });
		}

		return results;
	}

	/**
	 * Discover all skill.md files in a directory tree.
	 *
	 * Recursively walks the directory, finds files named `skill.md`,
	 * and parses each into a SkillManifest. Files that fail to parse
	 * are logged and skipped.
	 *
	 * @param dirPath - Absolute path to the root directory to scan.
	 * @returns Array of parsed skill manifests.
	 */
	async discoverFromDirectory(dirPath: string): Promise<SkillManifest[]> {
		const manifests: SkillManifest[] = [];
		const skillFiles = await findSkillFiles(dirPath);

		for (const filePath of skillFiles) {
			try {
				const content = await fs.promises.readFile(filePath, "utf-8");
				const manifest = parseSkillMarkdown(content);

				// If source is manual, set the file path
				if (manifest.source.type === "manual" && !manifest.source.filePath) {
					(manifest.source as { type: "manual"; filePath: string }).filePath = filePath;
				}

				manifests.push(manifest);
			} catch {
				// Silently skip: skill.md files that fail to parse are non-critical
			}
		}

		return manifests;
	}

	/**
	 * Discover skills from npm packages that declare `"chitragupta-skill"` keyword.
	 *
	 * Scans the node_modules directory for packages whose package.json contains
	 * `"chitragupta-skill"` in the `keywords` array, then looks for a `skill.md`
	 * file in the package root.
	 *
	 * @param rootPath - Path to the project root containing node_modules.
	 * @returns Array of parsed skill manifests found in packages.
	 */
	async discoverFromNodeModules(rootPath: string): Promise<SkillManifest[]> {
		const manifests: SkillManifest[] = [];
		const nodeModulesPath = path.join(rootPath, "node_modules");

		if (!existsSync(nodeModulesPath)) return manifests;

		try {
			const entries = await fs.promises.readdir(nodeModulesPath, {
				withFileTypes: true,
			});

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				// Handle scoped packages (@scope/package)
				if (entry.name.startsWith("@")) {
					const scopePath = path.join(nodeModulesPath, entry.name);
					const scopedEntries = await fs.promises.readdir(scopePath, {
						withFileTypes: true,
					});
					for (const scopedEntry of scopedEntries) {
						if (!scopedEntry.isDirectory()) continue;
						const pkgPath = path.join(scopePath, scopedEntry.name);
						const manifest = await tryParsePackageSkill(pkgPath);
						if (manifest) manifests.push(manifest);
					}
				} else {
					const pkgPath = path.join(nodeModulesPath, entry.name);
					const manifest = await tryParsePackageSkill(pkgPath);
					if (manifest) manifests.push(manifest);
				}
			}
		} catch {
			// node_modules may not exist or be readable
		}

		return manifests;
	}

	/**
	 * Discover skills from multiple paths simultaneously.
	 *
	 * Combines results from directory scanning and node_modules scanning
	 * across all provided paths.
	 *
	 * @param paths - Array of absolute directory paths to scan.
	 * @returns Combined array of all discovered skill manifests.
	 */
	async discoverAll(paths: string[]): Promise<SkillManifest[]> {
		const results = await Promise.all(
			paths.map(async (p) => {
				const dirSkills = await this.discoverFromDirectory(p);
				const npmSkills = await this.discoverFromNodeModules(p);
				return [...dirSkills, ...npmSkills];
			}),
		);
		return results.flat();
	}

	/**
	 * Watch a directory for skill.md file changes.
	 *
	 * Uses `fs.watch` in recursive mode to detect additions, modifications,
	 * and removals of skill.md files. Emits {@link SkillChangeEvent}s via
	 * the provided callback.
	 *
	 * @param dirPath - Absolute path to the directory to watch.
	 * @param onChange - Callback invoked for each change event.
	 * @returns A cleanup function that stops watching.
	 */
	watchDirectory(
		dirPath: string,
		onChange: (event: SkillChangeEvent) => void,
	): () => void {
		let watcher: fs.FSWatcher;

		try {
			watcher = fs.watch(
				dirPath,
				{ recursive: true },
				(eventType, filename) => {
					if (!filename || !isSkillManifest(path.basename(filename))) return;

					const filePath = path.join(dirPath, filename);

					// Debounce: small delay to handle rapid file system events
					setTimeout(async () => {
						if (existsSync(filePath)) {
							try {
								const content = await fs.promises.readFile(filePath, "utf-8");
								const manifest = parseSkillMarkdown(content);
								onChange({
									type: eventType === "rename" ? "added" : "changed",
									filePath,
									manifest,
								});
							} catch {
								// Silently skip: parse errors during watch are non-critical
							}
						} else {
							onChange({ type: "removed", filePath });
						}
					}, 50);
				},
			);

			this.watchers.push(watcher);
			watcher.on("error", () => {
				// Best-effort recovery: detach this watcher so runtime keeps running.
				const idx = this.watchers.indexOf(watcher);
				if (idx >= 0) this.watchers.splice(idx, 1);
				try {
					watcher.close();
				} catch {
					// no-op
				}
			});
		} catch {
			// Silently skip: directory watching is best-effort; caller gets a no-op cleanup
			return () => {};
		}

		return () => {
			watcher.close();
			const idx = this.watchers.indexOf(watcher);
			if (idx >= 0) this.watchers.splice(idx, 1);
		};
	}

	/**
	 * Stop all active file watchers.
	 */
	stopWatching(): void {
		for (const watcher of this.watchers) {
			watcher.close();
		}
		this.watchers = [];
	}

	/**
	 * Discover skills from multiple directories with Kula priority merging.
	 *
	 * Sources are loaded in priority order: shiksha (lowest) → bahya → antara (highest).
	 * Higher-priority tiers shadow lower ones when skills share the same name.
	 *
	 * Pranamaya pre-validation optionally filters out skills whose runtime
	 * requirements are not met on the current system.
	 *
	 * @param sources - Array of { path, kula } sources to scan.
	 * @param kulaRegistry - Optional KulaRegistry to populate.
	 * @param validateRequirements - If true, excludes skills failing Pranamaya check.
	 * @returns Array of discovered manifests with kula annotations.
	 */
	async discoverWithKula(
		sources: Array<{ path: string; kula: KulaType }>,
		kulaRegistry?: KulaRegistry,
		validateRequirements: boolean = false,
	): Promise<Array<{ manifest: EnhancedSkillManifest; kula: KulaType }>> {
		// Sort by priority: shiksha first (lowest), antara last (highest wins)
		const priorityOrder: KulaType[] = ["shiksha", "bahya", "antara"];
		const sorted = [...sources].sort(
			(a, b) => priorityOrder.indexOf(a.kula) - priorityOrder.indexOf(b.kula),
		);

		const seen = new Map<string, { manifest: EnhancedSkillManifest; kula: KulaType }>();

		for (const source of sorted) {
			const manifests = await this.discoverFromDirectory(source.path);

			for (const manifest of manifests) {
				// Annotate with kula
				const enhanced = manifest as EnhancedSkillManifest;
				if (!enhanced.kula) {
					(enhanced as { kula: KulaType }).kula = source.kula;
				}

				// Pranamaya pre-validation
				if (validateRequirements && enhanced.requirements) {
					const check = checkPranamaya(enhanced.requirements);
					if (!check.satisfied) continue;
				}

				// Higher priority overwrites (later in sorted = higher priority)
				seen.set(manifest.name, { manifest: enhanced, kula: source.kula });

				// Register in KulaRegistry if provided
				if (kulaRegistry) {
					kulaRegistry.register(enhanced, source.kula);
				}
			}
		}

		return [...seen.values()];
	}
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Check if a filename is a skill manifest (case-insensitive match for `skill.md`).
 * Accepts both `skill.md` and `SKILL.md` (and any mixed-case variant).
 */
function isSkillManifest(filename: string): boolean {
	return filename.toLowerCase() === "skill.md";
}

/**
 * Find a skill.md file (case-insensitive) in the given directory's immediate children.
 * Returns the absolute path if found, null otherwise.
 */
async function findSkillMdInDir(dirPath: string): Promise<string | null> {
	try {
		const entries = await fs.promises.readdir(dirPath);
		for (const name of entries) {
			if (isSkillManifest(name)) {
				return path.join(dirPath, name);
			}
		}
	} catch {
		// Directory may not exist or be readable
	}
	return null;
}

/**
 * Recursively find all files named `skill.md` (case-insensitive) in a directory tree.
 */
async function findSkillFiles(dirPath: string): Promise<string[]> {
	const results: string[] = [];

	if (!existsSync(dirPath)) return results;

	async function walk(currentDir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				// Skip node_modules and hidden directories
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				await walk(fullPath);
			} else if (entry.isFile() && isSkillManifest(entry.name)) {
				results.push(fullPath);
			}
		}
	}

	await walk(dirPath);
	return results;
}

/**
 * Try to parse a skill.md from an npm package directory.
 * Returns null if the package doesn't have the "chitragupta-skill" keyword
 * or doesn't contain a skill.md.
 */
async function tryParsePackageSkill(
	pkgPath: string,
): Promise<SkillManifest | null> {
	try {
		const pkgJsonPath = path.join(pkgPath, "package.json");
		if (!existsSync(pkgJsonPath)) return null;

		const pkgJson = JSON.parse(
			await fs.promises.readFile(pkgJsonPath, "utf-8"),
		);

		// Check for "chitragupta-skill" keyword
		const keywords: string[] = pkgJson.keywords ?? [];
		if (!keywords.includes("chitragupta-skill")) return null;

		// Look for skill.md (case-insensitive) in package root
		const skillMdPath = await findSkillMdInDir(pkgPath);
		if (!skillMdPath) return null;

		const content = await fs.promises.readFile(skillMdPath, "utf-8");
		return parseSkillMarkdown(content);
	} catch {
		return null;
	}
}

/**
 * Synchronous existence check (used for quick guards before async reads).
 */
function existsSync(filePath: string): boolean {
	try {
		fs.accessSync(filePath);
		return true;
	} catch {
		return false;
	}
}
