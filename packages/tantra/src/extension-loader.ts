/**
 * @chitragupta/tantra — Extension Loader.
 *
 * Discovers, loads, validates, and manages Chitragupta extensions.
 * Extensions are TypeScript files loaded via dynamic import (jiti for
 * uncompiled .ts, native import for .js/.mjs).
 *
 * Directory layout:
 *   ~/.chitragupta/extensions/*.ts   (global extensions)
 *   .chitragupta/extensions/*.ts     (project-local extensions)
 *
 * Hot-reload: optional fs.watch on extension directories.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import type { McpToolHandler } from "./types.js";
import type {
	ExtensionManifest,
	LoadedExtension,
	ExtensionLoaderConfig,
} from "./extension-types.js";
import { HookRegistry } from "./extension-hooks.js";

const MAX_EXTENSIONS = 50;
const VALID_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);

/**
 * ExtensionLoader — discovers, loads, and manages extensions.
 *
 * Usage:
 *   const loader = new ExtensionLoader({ projectDir: ".chitragupta/extensions" });
 *   await loader.loadAll();
 *   const tools = loader.getRegisteredTools();
 */
export class ExtensionLoader {
	private extensions = new Map<string, LoadedExtension>();
	private config: Required<ExtensionLoaderConfig>;
	private hookRegistry: HookRegistry;
	private watchers: fs.FSWatcher[] = [];
	private registeredTools: McpToolHandler[] = [];

	constructor(config: ExtensionLoaderConfig = {}, hookRegistry?: HookRegistry) {
		const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
		this.config = {
			globalDir: config.globalDir ?? path.join(home, ".chitragupta", "extensions"),
			projectDir: config.projectDir ?? path.join(process.cwd(), ".chitragupta", "extensions"),
			hotReload: config.hotReload ?? false,
			maxExtensions: config.maxExtensions ?? MAX_EXTENSIONS,
		};
		this.hookRegistry = hookRegistry ?? new HookRegistry();
	}

	/** Get the hook registry for dispatching hooks. */
	getHookRegistry(): HookRegistry {
		return this.hookRegistry;
	}

	/** Get all registered tools from loaded extensions. */
	getRegisteredTools(): McpToolHandler[] {
		return [...this.registeredTools];
	}

	/** Get all loaded extensions with status. */
	getLoadedExtensions(): LoadedExtension[] {
		return [...this.extensions.values()];
	}

	/**
	 * Discover and load all extensions from configured directories.
	 * Global extensions load first, then project-local (which can override).
	 */
	async loadAll(): Promise<{ loaded: number; errors: string[] }> {
		const errors: string[] = [];
		let loaded = 0;

		// Discover extension files
		const files = [
			...this.discoverFiles(this.config.globalDir),
			...this.discoverFiles(this.config.projectDir),
		];

		for (const filePath of files) {
			if (this.extensions.size >= this.config.maxExtensions) {
				errors.push(`Max extensions (${this.config.maxExtensions}) reached, skipping remaining`);
				break;
			}

			try {
				await this.loadExtension(filePath);
				loaded++;
			} catch (err) {
				const msg = `Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
				errors.push(msg);
				process.stderr.write(`[extension-loader] ${msg}\n`);
			}
		}

		// Start file watchers if hot-reload enabled
		if (this.config.hotReload) {
			this.startWatchers();
		}

		return { loaded, errors };
	}

	/**
	 * Load a single extension from a file path.
	 * Validates the manifest, registers hooks and tools.
	 */
	async loadExtension(filePath: string): Promise<void> {
		const ext = path.extname(filePath);
		if (!VALID_EXTENSIONS.has(ext)) {
			throw new Error(`Unsupported file type: ${ext}`);
		}

		// Dynamic import (works for .js/.mjs, TypeScript needs jiti or pre-compilation)
		const moduleUrl = `file://${filePath}`;
		let mod: Record<string, unknown>;

		try {
			mod = await import(moduleUrl) as Record<string, unknown>;
		} catch (importErr) {
			// Fallback: try jiti for TypeScript (.ts files that aren't pre-compiled)
			try {
				// jiti is optional — dynamic import with variable avoids hard TS module resolution
				const jitiPkg = "jiti";
				const jitiMod = await import(jitiPkg) as Record<string, unknown>;
				const createJitiFn = jitiMod.createJiti as (base: string) => { import: (p: string) => Promise<unknown> };
				const jiti = createJitiFn(import.meta.url);
				mod = await jiti.import(filePath) as Record<string, unknown>;
			} catch {
				throw importErr; // Re-throw original if jiti also fails
			}
		}

		// Extract manifest from default export or named export
		const manifest = (mod.default ?? mod) as ExtensionManifest;
		if (!manifest.name || typeof manifest.name !== "string") {
			throw new Error("Extension must export 'name' string");
		}
		if (!manifest.version || typeof manifest.version !== "string") {
			throw new Error("Extension must export 'version' string");
		}

		// Deactivate previous version if exists
		if (this.extensions.has(manifest.name)) {
			await this.unloadExtension(manifest.name);
		}

		const loaded: LoadedExtension = {
			manifest,
			filePath,
			loadedAt: Date.now(),
			active: true,
			errors: [],
		};

		// Register hooks
		if (manifest.hooks) {
			this.hookRegistry.registerHooks(manifest.name, manifest.hooks);
		}

		// Register tools
		if (manifest.tools && Array.isArray(manifest.tools)) {
			for (const tool of manifest.tools) {
				// Namespace tools to prevent collisions
				const namespacedTool: McpToolHandler = {
					definition: {
						...tool.definition,
						name: `ext_${manifest.name}_${tool.definition.name}`,
						description: `[${manifest.name}] ${tool.definition.description}`,
					},
					execute: tool.execute.bind(tool),
				};
				this.registeredTools.push(namespacedTool);
			}
		}

		// Call activate
		if (typeof manifest.activate === "function") {
			try {
				await manifest.activate();
			} catch (err) {
				loaded.errors.push(`activate() failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		this.extensions.set(manifest.name, loaded);
		process.stderr.write(`[extension-loader] Loaded: ${manifest.name}@${manifest.version} from ${filePath}\n`);
	}

	/** Unload an extension by name. */
	async unloadExtension(name: string): Promise<void> {
		const ext = this.extensions.get(name);
		if (!ext) return;

		// Call deactivate
		if (typeof ext.manifest.deactivate === "function") {
			try {
				await ext.manifest.deactivate();
			} catch {
				/* best-effort */
			}
		}

		// Remove hooks
		this.hookRegistry.unregisterHooks(name);

		// Remove tools
		const prefix = `ext_${name}_`;
		this.registeredTools = this.registeredTools.filter(
			t => !t.definition.name.startsWith(prefix),
		);

		ext.active = false;
		this.extensions.delete(name);
	}

	/** Stop all watchers and unload all extensions. */
	async dispose(): Promise<void> {
		for (const watcher of this.watchers) {
			watcher.close();
		}
		this.watchers = [];

		for (const extName of [...this.extensions.keys()]) {
			await this.unloadExtension(extName);
		}
	}

	// ── Private ─────────────────────────────────────────────────────

	/** Discover extension files in a directory. */
	private discoverFiles(dir: string): string[] {
		if (!fs.existsSync(dir)) return [];

		try {
			return fs.readdirSync(dir)
				.filter(f => VALID_EXTENSIONS.has(path.extname(f)))
				.filter(f => !f.startsWith(".") && !f.startsWith("_"))
				.sort()
				.map(f => path.join(dir, f));
		} catch {
			return [];
		}
	}

	/** Start file watchers for hot-reload. */
	private startWatchers(): void {
		for (const dir of [this.config.globalDir, this.config.projectDir]) {
			if (!fs.existsSync(dir)) continue;

			try {
				const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
					if (!filename || !VALID_EXTENSIONS.has(path.extname(filename))) return;
					const filePath = path.join(dir, filename);

					// Debounce: small delay for file write completion
					setTimeout(() => {
						if (fs.existsSync(filePath)) {
							this.loadExtension(filePath).catch((err) => {
								process.stderr.write(
									`[extension-loader] Hot-reload failed for ${filename}: ${err instanceof Error ? err.message : String(err)}\n`,
								);
							});
						}
					}, 200);
				});

				this.watchers.push(watcher);
			} catch {
				/* Watch not available — skip */
			}
		}
	}
}
