/**
 * @chitragupta/cli — Plugin loader.
 *
 * Scans ~/.chitragupta/plugins/ for plugin modules and loads them.
 * Each plugin is a .js ESM module that exports a `register` function.
 *
 * Plugin directory structure:
 *   ~/.chitragupta/plugins/
 *     my-plugin.js          (single-file plugin)
 *     my-other-plugin/      (directory plugin)
 *       index.js
 *
 * Each module must export:
 *   register(): Promise<ChitraguptaPlugin> | ChitraguptaPlugin
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolHandler } from "@chitragupta/anina";

// ─── Plugin Types ────────────────────────────────────────────────────────────

/** A loaded plugin's manifest. */
export interface ChitraguptaPlugin {
	/** Plugin display name. */
	name: string;
	/** Plugin version (semver). */
	version?: string;
	/** Tool handlers provided by this plugin. */
	tools?: ToolHandler[];
	/** Slash commands provided by this plugin. */
	commands?: PluginCommand[];
}

/** A slash command contributed by a plugin. */
export interface PluginCommand {
	/** Command name without the leading slash (e.g. "deploy"). */
	name: string;
	/** Human-readable description shown in /help. */
	description: string;
	/** Execute the command with parsed arguments. */
	execute: (args: string[], stdout: NodeJS.WriteStream) => Promise<void>;
}

/** Aggregated registry of all loaded plugins, tools, and commands. */
export interface PluginRegistry {
	/** All successfully loaded plugins. */
	plugins: ChitraguptaPlugin[];
	/** All tool handlers across all plugins. */
	tools: ToolHandler[];
	/** All slash commands across all plugins. */
	commands: PluginCommand[];
}

// ─── Plugin Directory ────────────────────────────────────────────────────────

const PLUGIN_DIR = join(
	process.env.HOME ?? process.env.USERPROFILE ?? ".",
	".chitragupta",
	"plugins",
);

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * Discover and load all plugins from the plugin directory.
 *
 * Scans `~/.chitragupta/plugins/` for:
 *   - `.js` files (loaded directly)
 *   - Directories containing an `index.js` entry point
 *
 * Each module must export a `register()` function that returns a
 * `ChitraguptaPlugin` (or a Promise resolving to one).
 *
 * Plugins that fail to load are silently skipped — a broken plugin
 * should never crash the CLI.
 *
 * @returns An aggregated registry of all loaded plugins, tools, and commands.
 */
export async function loadPlugins(): Promise<PluginRegistry> {
	const registry: PluginRegistry = { plugins: [], tools: [], commands: [] };

	// Check if plugin directory exists
	try {
		const dirStat = await stat(PLUGIN_DIR);
		if (!dirStat.isDirectory()) return registry;
	} catch {
		// Directory doesn't exist — no plugins to load
		return registry;
	}

	const entries = await readdir(PLUGIN_DIR, { withFileTypes: true });

	for (const entry of entries) {
		// Support both single .js files and directories with index.js
		let modulePath: string;

		if (entry.isFile() && entry.name.endsWith(".js")) {
			modulePath = join(PLUGIN_DIR, entry.name);
		} else if (entry.isDirectory()) {
			modulePath = join(PLUGIN_DIR, entry.name, "index.js");
			try {
				await stat(modulePath);
			} catch {
				continue; // No index.js in directory — skip
			}
		} else {
			continue;
		}

		try {
			const moduleUrl = pathToFileURL(modulePath).href;
			const mod: Record<string, unknown> = await import(moduleUrl);

			// Plugin must export a register function
			if (typeof mod.register !== "function") continue;

			const plugin = await (mod.register as () => Promise<ChitraguptaPlugin> | ChitraguptaPlugin)();
			if (!plugin || !plugin.name) continue;

			registry.plugins.push(plugin);

			if (plugin.tools) {
				for (const tool of plugin.tools) {
					registry.tools.push(tool);
				}
			}

			if (plugin.commands) {
				for (const command of plugin.commands) {
					registry.commands.push(command);
				}
			}
		} catch {
			// Skip plugins that fail to load — don't crash the CLI.
			// Structured logging can be added here in the future.
		}
	}

	return registry;
}

/**
 * List all installed plugin files/directories in the plugin directory.
 *
 * Returns the file/directory names (not full paths). Useful for the
 * `chitragupta plugin list` subcommand.
 *
 * @returns Array of plugin entry names.
 */
export async function listInstalledPlugins(): Promise<string[]> {
	try {
		const entries = await readdir(PLUGIN_DIR, { withFileTypes: true });
		return entries
			.filter(
				(e) => (e.isFile() && e.name.endsWith(".js")) || e.isDirectory(),
			)
			.map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * Get the plugin directory path.
 * Exposed so that CLI commands can display it to the user.
 */
export function getPluginDir(): string {
	return PLUGIN_DIR;
}
