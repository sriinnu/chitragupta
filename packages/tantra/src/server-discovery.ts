/**
 * @chitragupta/tantra — MCP Server Discovery.
 *
 * Discovers MCP servers from multiple sources: explicit configuration
 * objects, convention-based directory scanning (.chitragupta/mcp/),
 * and NPM packages with the "chitragupta-mcp-server" keyword.
 *
 * Supports file watching for live reloading of server configs.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, extname, basename } from "node:path";

import type { McpRemoteServerConfig } from "./registry-types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A configuration object that contains an `mcpServers` array,
 * typically loaded from a project or workspace config file.
 */
export interface McpConfigSource {
	/** Array of MCP server configurations. */
	mcpServers?: McpRemoteServerConfig[];
}

/**
 * Options for the combined discovery scan.
 */
export interface DiscoverAllOptions {
	/** Explicit config objects to scan. */
	configs?: McpConfigSource[];
	/** Directories to scan for *.json server config files. */
	directories?: string[];
	/** Root paths to scan for node_modules with MCP server packages. */
	nodeModulesRoots?: string[];
}

/**
 * Event emitted when a config file changes in a watched directory.
 */
export interface DiscoveryEvent {
	/** The type of file change. */
	type: "added" | "changed" | "removed";
	/** The file path that changed. */
	filePath: string;
	/** The parsed config, if available (not present for "removed"). */
	config?: McpRemoteServerConfig;
}

/**
 * Callback for directory watch events.
 */
export type DiscoveryCallback = (event: DiscoveryEvent) => void;

// ─── Discovery ─────────────────────────────────────────────────────────────

/**
 * Discovers MCP servers from multiple sources and provides directory
 * watching for live reloading of server configurations.
 *
 * Discovery sources:
 * 1. **Config-based**: Extract server configs from in-memory config objects.
 * 2. **Convention-based**: Scan `.chitragupta/mcp/` directories for `*.json` files.
 * 3. **NPM-based**: Scan `node_modules` for packages with the
 *    `"chitragupta-mcp-server"` keyword in their package.json.
 *
 * @example
 * ```ts
 * const discovery = new ServerDiscovery();
 * const servers = await discovery.discoverAll({
 *   configs: [workspaceConfig],
 *   directories: [".chitragupta/mcp"],
 *   nodeModulesRoots: ["/project"],
 * });
 * const cleanup = discovery.watchDirectory(".chitragupta/mcp", (event) => { ... });
 * // Later:
 * cleanup();
 * ```
 */
export class ServerDiscovery {
	private _watchers: FSWatcher[] = [];

	// ─── Config-Based Discovery ────────────────────────────────────────

	/**
	 * Extract MCP server configurations from an in-memory config object.
	 * Validates each entry and filters out malformed configs.
	 *
	 * @param config - A config object with an optional `mcpServers` array.
	 * @returns Array of valid server configurations.
	 */
	discoverFromConfig(config: McpConfigSource): McpRemoteServerConfig[] {
		if (!config.mcpServers || !Array.isArray(config.mcpServers)) {
			return [];
		}

		return config.mcpServers.filter((s) => this._isValidConfig(s));
	}

	// ─── Convention-Based Discovery ────────────────────────────────────

	/**
	 * Scan a directory for `*.json` files, each containing a single
	 * MCP server configuration. Files that fail to parse or contain
	 * invalid configs are silently skipped.
	 *
	 * Expected file format:
	 * ```json
	 * {
	 *   "id": "my-server",
	 *   "name": "My Server",
	 *   "transport": "stdio",
	 *   "command": "my-mcp-server"
	 * }
	 * ```
	 *
	 * @param dirPath - The directory to scan.
	 * @returns Array of valid server configurations found.
	 */
	async discoverFromDirectory(dirPath: string): Promise<McpRemoteServerConfig[]> {
		const configs: McpRemoteServerConfig[] = [];

		let entries: string[];
		try {
			entries = await readdir(dirPath);
		} catch {
			// Directory doesn't exist or can't be read — not an error
			return configs;
		}

		const jsonFiles = entries.filter((f) => extname(f) === ".json");

		const readPromises = jsonFiles.map(async (fileName) => {
			const filePath = join(dirPath, fileName);
			try {
				const raw = await readFile(filePath, "utf-8");
				const parsed = JSON.parse(raw) as unknown;

				if (typeof parsed === "object" && parsed !== null) {
					const config = parsed as McpRemoteServerConfig;

					// Derive an ID from the filename if not provided
					if (!config.id) {
						config.id = basename(fileName, ".json");
					}

					if (this._isValidConfig(config)) {
						return config;
					}
				}
			} catch {
				// Malformed JSON or unreadable file — skip
			}
			return null;
		});

		const results = await Promise.all(readPromises);
		for (const config of results) {
			if (config) {
				configs.push(config);
			}
		}

		return configs;
	}

	// ─── NPM-Based Discovery ──────────────────────────────────────────

	/**
	 * Scan `node_modules` at the given root path for packages that declare
	 * the `"chitragupta-mcp-server"` keyword in their `package.json`.
	 *
	 * For qualifying packages, the server config is extracted from
	 * either:
	 * - A `"chitraguptaMcpServer"` field in package.json, or
	 * - A `chitragupta-mcp.json` file in the package root.
	 *
	 * @param rootPath - The project root to search from.
	 * @returns Array of valid server configurations discovered.
	 */
	async discoverFromNodeModules(
		rootPath: string,
	): Promise<McpRemoteServerConfig[]> {
		const configs: McpRemoteServerConfig[] = [];
		const nodeModulesPath = join(rootPath, "node_modules");

		let topLevel: string[];
		try {
			topLevel = await readdir(nodeModulesPath);
		} catch {
			return configs;
		}

		// Collect all package directories (including scoped packages)
		const packageDirs: string[] = [];

		for (const entry of topLevel) {
			if (entry.startsWith(".")) continue;

			const entryPath = join(nodeModulesPath, entry);

			if (entry.startsWith("@")) {
				// Scoped package — scan one level deeper
				try {
					const scoped = await readdir(entryPath);
					for (const scopedEntry of scoped) {
						packageDirs.push(join(entryPath, scopedEntry));
					}
				} catch {
					continue;
				}
			} else {
				packageDirs.push(entryPath);
			}
		}

		// Check each package for the keyword
		const checkPromises = packageDirs.map(async (pkgDir) => {
			return this._checkPackageForMcp(pkgDir);
		});

		const results = await Promise.all(checkPromises);
		for (const config of results) {
			if (config) {
				configs.push(config);
			}
		}

		return configs;
	}

	// ─── Combined Discovery ───────────────────────────────────────────

	/**
	 * Run all discovery methods and return a merged, deduplicated list
	 * of server configurations. Deduplication is based on server ID;
	 * the first occurrence wins.
	 *
	 * @param opts - Options specifying which sources to scan.
	 * @returns Array of unique server configurations.
	 */
	async discoverAll(opts: DiscoverAllOptions): Promise<McpRemoteServerConfig[]> {
		const allConfigs: McpRemoteServerConfig[] = [];
		const seenIds = new Set<string>();

		// Config-based
		if (opts.configs) {
			for (const config of opts.configs) {
				const found = this.discoverFromConfig(config);
				for (const c of found) {
					if (!seenIds.has(c.id)) {
						seenIds.add(c.id);
						allConfigs.push(c);
					}
				}
			}
		}

		// Directory-based
		if (opts.directories) {
			const dirPromises = opts.directories.map((d) => this.discoverFromDirectory(d));
			const dirResults = await Promise.all(dirPromises);
			for (const found of dirResults) {
				for (const c of found) {
					if (!seenIds.has(c.id)) {
						seenIds.add(c.id);
						allConfigs.push(c);
					}
				}
			}
		}

		// NPM-based
		if (opts.nodeModulesRoots) {
			const npmPromises = opts.nodeModulesRoots.map((r) =>
				this.discoverFromNodeModules(r),
			);
			const npmResults = await Promise.all(npmPromises);
			for (const found of npmResults) {
				for (const c of found) {
					if (!seenIds.has(c.id)) {
						seenIds.add(c.id);
						allConfigs.push(c);
					}
				}
			}
		}

		return allConfigs;
	}

	// ─── File Watching ────────────────────────────────────────────────

	/**
	 * Watch a directory for changes to `*.json` files and emit
	 * discovery events. Used for live-reloading server configs
	 * from the `.chitragupta/mcp/` directory.
	 *
	 * @param dirPath - The directory to watch.
	 * @param callback - Invoked on file add/change/remove events.
	 * @returns A cleanup function that stops watching.
	 */
	watchDirectory(dirPath: string, callback: DiscoveryCallback): () => void {
		let watcher: FSWatcher;

		try {
			watcher = watch(dirPath, { persistent: false }, (eventType, fileName) => {
				if (!fileName || extname(fileName) !== ".json") return;

				const filePath = join(dirPath, fileName);

				// Determine the event type by trying to read the file
				this._handleFileChange(filePath, eventType, callback).catch(() => {
					// Swallow errors from watch handler
				});
			});
		} catch {
			// Directory doesn't exist yet — return a no-op cleanup
			return () => {};
		}

		this._watchers.push(watcher);

		return () => {
			watcher.close();
			const idx = this._watchers.indexOf(watcher);
			if (idx >= 0) {
				this._watchers.splice(idx, 1);
			}
		};
	}

	/**
	 * Stop all active directory watchers.
	 */
	stopWatching(): void {
		for (const watcher of this._watchers) {
			watcher.close();
		}
		this._watchers = [];
	}

	// ─── Internal Helpers ─────────────────────────────────────────────

	/**
	 * Validate that a config object has the minimum required fields.
	 */
	private _isValidConfig(config: McpRemoteServerConfig): boolean {
		if (!config.id || typeof config.id !== "string") return false;
		if (!config.name || typeof config.name !== "string") return false;
		if (config.transport !== "stdio" && config.transport !== "sse") return false;

		if (config.transport === "stdio" && !config.command) return false;
		if (config.transport === "sse" && !config.url) return false;

		return true;
	}

	/**
	 * Check a single npm package directory for MCP server configuration.
	 */
	private async _checkPackageForMcp(
		pkgDir: string,
	): Promise<McpRemoteServerConfig | null> {
		const pkgJsonPath = join(pkgDir, "package.json");

		try {
			const raw = await readFile(pkgJsonPath, "utf-8");
			const pkg = JSON.parse(raw) as Record<string, unknown>;

			// Check for the keyword
			const keywords = pkg.keywords as string[] | undefined;
			if (!keywords || !Array.isArray(keywords)) return null;
			if (!keywords.includes("chitragupta-mcp-server")) return null;

			// Try embedded config first
			if (pkg.chitraguptaMcpServer && typeof pkg.chitraguptaMcpServer === "object") {
				const config = pkg.chitraguptaMcpServer as McpRemoteServerConfig;
				if (!config.id) {
					config.id = (pkg.name as string) ?? basename(pkgDir);
				}
				if (!config.name) {
					config.name = config.id;
				}
				if (this._isValidConfig(config)) {
					return config;
				}
			}

			// Try external config file
			const configPath = join(pkgDir, "chitragupta-mcp.json");
			try {
				const configRaw = await readFile(configPath, "utf-8");
				const config = JSON.parse(configRaw) as McpRemoteServerConfig;
				if (!config.id) {
					config.id = (pkg.name as string) ?? basename(pkgDir);
				}
				if (!config.name) {
					config.name = config.id;
				}
				if (this._isValidConfig(config)) {
					return config;
				}
			} catch {
				// No external config file — that's fine
			}
		} catch {
			// Can't read package.json — skip
		}

		return null;
	}

	/**
	 * Handle a file change event from the directory watcher.
	 */
	private async _handleFileChange(
		filePath: string,
		eventType: string,
		callback: DiscoveryCallback,
	): Promise<void> {
		try {
			// Check if the file exists
			await stat(filePath);

			// File exists — read and parse it
			const raw = await readFile(filePath, "utf-8");
			const config = JSON.parse(raw) as McpRemoteServerConfig;

			if (!config.id) {
				config.id = basename(filePath, ".json");
			}

			if (this._isValidConfig(config)) {
				callback({
					type: eventType === "rename" ? "added" : "changed",
					filePath,
					config,
				});
			}
		} catch {
			// File doesn't exist or can't be read — treat as removed
			callback({
				type: "removed",
				filePath,
			});
		}
	}
}
