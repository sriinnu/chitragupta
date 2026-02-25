/**
 * @chitragupta/tantra — Plugin Loader.
 *
 * Loads ToolPlugin instances from configuration files (JSON) and
 * from local directories. Provides runtime validation that a loaded
 * module conforms to the ToolPlugin interface before the registry
 * accepts it.
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { McpToolHandler, McpTool } from "./types.js";
import type {
	ToolPlugin,
	PluginConfigFile,
	PluginConfigEntry,
} from "./tool-registry-types.js";

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Type guard: validates that an unknown value has the shape of a McpTool.
 */
function isValidToolDefinition(value: unknown): value is McpTool {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.name === "string" &&
		obj.name.length > 0 &&
		typeof obj.description === "string" &&
		obj.inputSchema !== null &&
		typeof obj.inputSchema === "object"
	);
}

/**
 * Type guard: validates that an unknown value has the shape of a McpToolHandler.
 */
function isValidToolHandler(value: unknown): value is McpToolHandler {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return (
		isValidToolDefinition(obj.definition) &&
		typeof obj.execute === "function"
	);
}

// ─── PluginLoader ───────────────────────────────────────────────────────────

/**
 * Loads and validates ToolPlugin instances from external sources.
 *
 * Supports two loading strategies:
 * 1. **Config file** — reads a `chitragupta-plugins.json` file and loads
 *    each listed plugin from a local path or npm package name.
 * 2. **Directory** — loads a single plugin from a directory that exports
 *    a default ToolPlugin.
 *
 * @example
 * ```ts
 * // From config file
 * const plugins = await PluginLoader.loadFromConfig("./chitragupta-plugins.json");
 * for (const plugin of plugins) {
 *   registry.registerPlugin(plugin);
 * }
 *
 * // From a directory
 * const plugin = await PluginLoader.loadFromDirectory("./plugins/my-tools");
 * registry.registerPlugin(plugin);
 * ```
 */
export class PluginLoader {
	/**
	 * Load plugins from a JSON config file.
	 *
	 * The config file must conform to the PluginConfigFile interface:
	 * ```json
	 * {
	 *   "plugins": [
	 *     { "id": "my-tools", "path": "./plugins/my-tools", "enabled": true },
	 *     { "id": "npm-plugin", "package": "@company/plugin-x", "enabled": true }
	 *   ]
	 * }
	 * ```
	 *
	 * Plugins with `enabled: false` are skipped. Each plugin entry must have
	 * either a `path` or a `package` field.
	 *
	 * @param configPath - Absolute or relative path to the config JSON file.
	 * @returns Array of validated ToolPlugin instances.
	 * @throws If the config file is malformed or any plugin fails to load.
	 */
	static async loadFromConfig(configPath: string): Promise<ToolPlugin[]> {
		const absolutePath = resolve(configPath);
		const raw = await readFile(absolutePath, "utf-8");

		let config: PluginConfigFile;
		try {
			config = JSON.parse(raw) as PluginConfigFile;
		} catch {
			throw new Error(`Failed to parse plugin config at ${absolutePath}: invalid JSON.`);
		}

		if (!config.plugins || !Array.isArray(config.plugins)) {
			throw new Error(
				`Invalid plugin config at ${absolutePath}: missing "plugins" array.`,
			);
		}

		const configDir = resolve(absolutePath, "..");
		const plugins: ToolPlugin[] = [];

		for (const entry of config.plugins) {
			PluginLoader._validateConfigEntry(entry);

			// Skip disabled plugins
			if (entry.enabled === false) {
				continue;
			}

			const plugin = await PluginLoader._loadEntry(entry, configDir);
			plugins.push(plugin);
		}

		return plugins;
	}

	/**
	 * Load a single plugin from a directory.
	 *
	 * Looks for an `index.js` or `index.ts` file in the directory and
	 * expects a default export that conforms to ToolPlugin.
	 *
	 * @param dir - Path to the plugin directory.
	 * @returns A validated ToolPlugin.
	 * @throws If the directory does not contain a valid plugin export.
	 */
	static async loadFromDirectory(dir: string): Promise<ToolPlugin> {
		const absoluteDir = resolve(dir);
		const candidates = ["index.js", "index.mjs", "index.ts"];
		let loaded: unknown = null;
		let loadedFrom = "";

		for (const candidate of candidates) {
			const fullPath = join(absoluteDir, candidate);
			try {
				const fileUrl = pathToFileURL(fullPath).href;
				const mod = await import(fileUrl) as Record<string, unknown>;
				loaded = mod.default ?? mod;
				loadedFrom = fullPath;
				break;
			} catch {
				// Try next candidate
			}
		}

		if (loaded === null) {
			throw new Error(
				`No valid plugin entry found in ${absoluteDir}. ` +
				`Looked for: ${candidates.join(", ")}`,
			);
		}

		if (!PluginLoader.validate(loaded)) {
			throw new Error(
				`Plugin loaded from ${loadedFrom} does not conform to ToolPlugin interface.`,
			);
		}

		return loaded;
	}

	/**
	 * Validate that an unknown value conforms to the ToolPlugin interface.
	 *
	 * Checks for required fields (id, name, version, tools array) and
	 * validates each tool handler within the plugin.
	 *
	 * @param plugin - The value to validate.
	 * @returns Type predicate — true if the value is a valid ToolPlugin.
	 */
	static validate(plugin: unknown): plugin is ToolPlugin {
		if (plugin === null || typeof plugin !== "object") {
			return false;
		}

		const obj = plugin as Record<string, unknown>;

		// Required string fields
		if (typeof obj.id !== "string" || obj.id.length === 0) return false;
		if (typeof obj.name !== "string" || obj.name.length === 0) return false;
		if (typeof obj.version !== "string" || obj.version.length === 0) return false;

		// Tools must be a non-empty array
		if (!Array.isArray(obj.tools) || obj.tools.length === 0) return false;

		// Each tool must be a valid handler
		for (const tool of obj.tools) {
			if (!isValidToolHandler(tool)) {
				return false;
			}
		}

		// Optional description must be string if present
		if (obj.description !== undefined && typeof obj.description !== "string") {
			return false;
		}

		return true;
	}

	// ─── Internal Helpers ────────────────────────────────────────────────

	/**
	 * Validate a plugin config entry has the required fields.
	 */
	private static _validateConfigEntry(entry: PluginConfigEntry): void {
		if (!entry.id || typeof entry.id !== "string") {
			throw new Error("Plugin config entry must have a non-empty string 'id'.");
		}
		if (!entry.path && !entry.package) {
			throw new Error(
				`Plugin "${entry.id}": config entry must have either 'path' or 'package'.`,
			);
		}
	}

	/**
	 * Load a single plugin from a config entry.
	 */
	private static async _loadEntry(
		entry: PluginConfigEntry,
		configDir: string,
	): Promise<ToolPlugin> {
		if (entry.path) {
			const absolutePath = resolve(configDir, entry.path);
			return PluginLoader.loadFromDirectory(absolutePath);
		}

		if (entry.package) {
			try {
				const mod = await import(entry.package) as Record<string, unknown>;
				const loaded = mod.default ?? mod;

				if (!PluginLoader.validate(loaded)) {
					throw new Error(
						`Package "${entry.package}" does not export a valid ToolPlugin.`,
					);
				}

				return loaded;
			} catch (err) {
				if (err instanceof Error && err.message.includes("does not export")) {
					throw err;
				}
				throw new Error(
					`Failed to load plugin package "${entry.package}": ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}

		// This should not be reachable due to _validateConfigEntry
		throw new Error(`Plugin "${entry.id}": no 'path' or 'package' specified.`);
	}
}
