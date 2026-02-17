import { PluginError } from "./errors.js";
import type { Plugin, PluginRegistry, PluginType } from "./types.js";

/**
 * Create a plugin registry that manages registration, lookup, and lifecycle
 * of all plugins in the Chitragupta system.
 *
 * @returns A new {@link PluginRegistry} instance.
 * @throws {PluginError} If a plugin with a duplicate name is registered.
 *
 * @example
 * ```ts
 * const registry = createPluginRegistry();
 * registry.register(myPlugin);
 * const tools = registry.getAll("tool");
 * ```
 */
export function createPluginRegistry(): PluginRegistry {
	const plugins = new Map<string, Plugin>();

	return {
		register(plugin: Plugin): void {
			if (plugins.has(plugin.name)) {
				throw new PluginError(`Plugin "${plugin.name}" is already registered`, plugin.name);
			}
			plugins.set(plugin.name, plugin);
		},

		unregister(name: string): void {
			const plugin = plugins.get(name);
			if (!plugin) return;
			plugins.delete(name);
		},

		get<T extends Plugin>(name: string): T | undefined {
			return plugins.get(name) as T | undefined;
		},

		getAll(type?: PluginType): Plugin[] {
			const all = [...plugins.values()];
			return type ? all.filter((p) => p.type === type) : all;
		},

		has(name: string): boolean {
			return plugins.has(name);
		},
	};
}
