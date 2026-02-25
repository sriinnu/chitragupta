/**
 * @chitragupta/tantra — Dynamic Tool Registry.
 *
 * Extends the static tool registration model of McpServer with runtime
 * plugin management, enable/disable lifecycle, change notifications,
 * namespace collision detection, and schema validation.
 *
 * This registry is designed to sit alongside the existing McpServer —
 * it does NOT modify server.ts. Integration wiring is deferred to a
 * later phase.
 */

import type { McpToolHandler, McpTool } from "./types.js";
import type {
	ToolPlugin,
	PluginInfo,
	RegistryChangeEvent,
	RegistryChangeListener,
	RegistrySnapshot,
	ToolSnapshotEntry,
	ToolRegistryConfig,
} from "./tool-registry-types.js";

// ─── Internal Entry ─────────────────────────────────────────────────────────

/**
 * Internal bookkeeping for a registered tool.
 */
interface ToolEntry {
	/** The tool handler (definition + execute). */
	handler: McpToolHandler;
	/** Whether this tool is currently enabled. */
	enabled: boolean;
	/** Plugin ID that owns this tool, or undefined if standalone. */
	pluginId: string | undefined;
}

// ─── ToolRegistry ───────────────────────────────────────────────────────────

/**
 * Dynamic tool registry with plugin grouping, enable/disable lifecycle,
 * change notifications, and namespace collision detection.
 *
 * @example
 * ```ts
 * const registry = new ToolRegistry();
 * registry.onChange((event) => console.log(event));
 * registry.registerTool(myHandler);
 * registry.disableTool("my-tool");
 * const snapshot = registry.toSnapshot();
 * ```
 */
export class ToolRegistry {
	/** Map of tool name -> internal entry. */
	private readonly _tools: Map<string, ToolEntry> = new Map();

	/** Map of plugin ID -> plugin metadata + tool names. */
	private readonly _plugins: Map<string, { plugin: ToolPlugin; toolNames: string[] }> = new Map();

	/** Registered change listeners. */
	private readonly _listeners: Set<RegistryChangeListener> = new Set();

	/** Configuration. */
	private readonly _config: Required<ToolRegistryConfig>;

	constructor(config?: ToolRegistryConfig) {
		this._config = {
			strictNamespaces: config?.strictNamespaces ?? true,
			validateSchemas: config?.validateSchemas ?? true,
		};
	}

	// ─── Core Registration ────────────────────────────────────────────────

	/**
	 * Register a standalone tool handler (not part of a plugin).
	 *
	 * @param handler - The tool handler with definition and execute function.
	 * @throws If a tool with the same name already exists and strictNamespaces is enabled.
	 */
	registerTool(handler: McpToolHandler): void {
		const name = handler.definition.name;
		this._assertNoCollision(name);
		this._validateToolDefinition(handler.definition);

		this._tools.set(name, {
			handler,
			enabled: true,
			pluginId: undefined,
		});

		this._emit({ type: "tool:registered", toolName: name, pluginId: undefined });
	}

	/**
	 * Unregister a tool by name.
	 * If the tool belongs to a plugin, it is removed from that plugin's tool list.
	 *
	 * @param name - The tool name to remove.
	 */
	unregisterTool(name: string): void {
		const entry = this._tools.get(name);
		if (!entry) {
			return;
		}

		// Remove from plugin tracking if applicable
		if (entry.pluginId) {
			const pluginRecord = this._plugins.get(entry.pluginId);
			if (pluginRecord) {
				pluginRecord.toolNames = pluginRecord.toolNames.filter((n) => n !== name);
			}
		}

		this._tools.delete(name);
		this._emit({ type: "tool:unregistered", toolName: name });
	}

	/**
	 * Get a tool handler by name. Only returns enabled tools.
	 *
	 * @param name - The tool name.
	 * @returns The handler if found and enabled, otherwise undefined.
	 */
	getTool(name: string): McpToolHandler | undefined {
		const entry = this._tools.get(name);
		if (!entry || !entry.enabled) {
			return undefined;
		}
		return entry.handler;
	}

	/**
	 * Get a tool handler by name regardless of enabled state.
	 *
	 * @param name - The tool name.
	 * @returns The handler if registered, otherwise undefined.
	 */
	getToolIncludingDisabled(name: string): McpToolHandler | undefined {
		return this._tools.get(name)?.handler;
	}

	/**
	 * List all currently enabled tool handlers.
	 *
	 * @returns Array of enabled McpToolHandler instances.
	 */
	listTools(): McpToolHandler[] {
		const result: McpToolHandler[] = [];
		for (const entry of this._tools.values()) {
			if (entry.enabled) {
				result.push(entry.handler);
			}
		}
		return result;
	}

	/**
	 * List all registered tool handlers regardless of enabled state.
	 *
	 * @returns Array of all McpToolHandler instances.
	 */
	listAllTools(): McpToolHandler[] {
		return Array.from(this._tools.values()).map((e) => e.handler);
	}

	/**
	 * Check if a tool name is already registered.
	 *
	 * @param name - The tool name to check.
	 */
	hasTool(name: string): boolean {
		return this._tools.has(name);
	}

	/**
	 * Get the total count of registered tools.
	 */
	get size(): number {
		return this._tools.size;
	}

	// ─── Plugin Management ────────────────────────────────────────────────

	/**
	 * Register a plugin and all its tools.
	 * All tools from the plugin are registered atomically — if any tool
	 * name collides, no tools from the plugin are registered.
	 *
	 * @param plugin - The plugin definition with its tools.
	 * @throws If a plugin with the same ID already exists.
	 * @throws If any tool name collides with an existing tool.
	 */
	registerPlugin(plugin: ToolPlugin): void {
		if (this._plugins.has(plugin.id)) {
			throw new Error(`Plugin already registered: ${plugin.id}`);
		}

		// Pre-validate all tool names before registering any (atomic check)
		const toolNames: string[] = [];
		for (const handler of plugin.tools) {
			const name = handler.definition.name;
			this._assertNoCollision(name);
			this._validateToolDefinition(handler.definition);
			toolNames.push(name);
		}

		// Register all tools
		for (const handler of plugin.tools) {
			const name = handler.definition.name;
			this._tools.set(name, {
				handler,
				enabled: true,
				pluginId: plugin.id,
			});
		}

		this._plugins.set(plugin.id, { plugin, toolNames: [...toolNames] });
		this._emit({ type: "plugin:registered", pluginId: plugin.id, toolNames });
	}

	/**
	 * Unregister a plugin and remove all its tools.
	 *
	 * @param pluginId - The plugin identifier.
	 */
	unregisterPlugin(pluginId: string): void {
		const record = this._plugins.get(pluginId);
		if (!record) {
			return;
		}

		const removedNames = [...record.toolNames];
		for (const name of removedNames) {
			this._tools.delete(name);
		}

		this._plugins.delete(pluginId);
		this._emit({ type: "plugin:unregistered", pluginId, toolNames: removedNames });
	}

	/**
	 * List all registered plugins with their metadata.
	 *
	 * @returns Array of PluginInfo objects.
	 */
	listPlugins(): PluginInfo[] {
		const result: PluginInfo[] = [];
		for (const [, record] of this._plugins) {
			const allEnabled = record.toolNames.every((name) => {
				const entry = this._tools.get(name);
				return entry?.enabled ?? false;
			});

			result.push({
				id: record.plugin.id,
				name: record.plugin.name,
				version: record.plugin.version,
				description: record.plugin.description,
				toolNames: [...record.toolNames],
				enabled: allEnabled,
			});
		}
		return result;
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/**
	 * Enable a previously disabled tool.
	 *
	 * @param name - The tool name to enable.
	 * @throws If the tool is not registered.
	 */
	enableTool(name: string): void {
		const entry = this._tools.get(name);
		if (!entry) {
			throw new Error(`Tool not found: ${name}`);
		}
		if (entry.enabled) {
			return; // Already enabled, no-op
		}
		entry.enabled = true;
		this._emit({ type: "tool:enabled", toolName: name });
	}

	/**
	 * Disable a tool without removing it from the registry.
	 * Disabled tools are not returned by getTool() or listTools().
	 *
	 * @param name - The tool name to disable.
	 * @throws If the tool is not registered.
	 */
	disableTool(name: string): void {
		const entry = this._tools.get(name);
		if (!entry) {
			throw new Error(`Tool not found: ${name}`);
		}
		if (!entry.enabled) {
			return; // Already disabled, no-op
		}
		entry.enabled = false;
		this._emit({ type: "tool:disabled", toolName: name });
	}

	/**
	 * Check if a tool is currently enabled.
	 *
	 * @param name - The tool name.
	 * @returns true if registered and enabled, false otherwise.
	 */
	isEnabled(name: string): boolean {
		const entry = this._tools.get(name);
		return entry?.enabled ?? false;
	}

	// ─── Events ───────────────────────────────────────────────────────────

	/**
	 * Subscribe to registry change events.
	 *
	 * @param callback - Called whenever the registry mutates.
	 * @returns An unsubscribe function.
	 */
	onChange(callback: RegistryChangeListener): () => void {
		this._listeners.add(callback);
		return () => {
			this._listeners.delete(callback);
		};
	}

	// ─── Serialization ───────────────────────────────────────────────────

	/**
	 * Create a serializable snapshot of the current registry state.
	 *
	 * @returns A RegistrySnapshot with tool and plugin metadata.
	 */
	toSnapshot(): RegistrySnapshot {
		const tools: ToolSnapshotEntry[] = [];
		let enabledCount = 0;

		for (const [, entry] of this._tools) {
			tools.push({
				definition: entry.handler.definition,
				enabled: entry.enabled,
				pluginId: entry.pluginId,
			});
			if (entry.enabled) {
				enabledCount++;
			}
		}

		return {
			timestamp: new Date().toISOString(),
			totalTools: this._tools.size,
			enabledTools: enabledCount,
			disabledTools: this._tools.size - enabledCount,
			tools,
			plugins: this.listPlugins(),
		};
	}

	/**
	 * Remove all tools and plugins, resetting the registry to empty.
	 */
	clear(): void {
		// Emit unregister events for all plugins first
		for (const [pluginId, record] of this._plugins) {
			this._emit({
				type: "plugin:unregistered",
				pluginId,
				toolNames: [...record.toolNames],
			});
		}

		// Emit unregister events for standalone tools
		for (const [name, entry] of this._tools) {
			if (!entry.pluginId) {
				this._emit({ type: "tool:unregistered", toolName: name });
			}
		}

		this._tools.clear();
		this._plugins.clear();
	}

	// ─── Internal Helpers ─────────────────────────────────────────────────

	/**
	 * Emit an event to all registered listeners.
	 */
	private _emit(event: RegistryChangeEvent): void {
		for (const listener of this._listeners) {
			try {
				listener(event);
			} catch {
				// Listener errors are swallowed to prevent one bad listener
				// from breaking the registry's operation.
			}
		}
	}

	/**
	 * Assert that a tool name does not already exist in the registry.
	 *
	 * @throws If the name is taken and strictNamespaces is enabled.
	 */
	private _assertNoCollision(name: string): void {
		if (this._config.strictNamespaces && this._tools.has(name)) {
			throw new Error(
				`Tool name collision: "${name}" is already registered.`,
			);
		}
	}

	/**
	 * Validate a tool definition meets minimum requirements.
	 *
	 * @throws If validation is enabled and the definition is malformed.
	 */
	private _validateToolDefinition(definition: McpTool): void {
		if (!this._config.validateSchemas) {
			return;
		}

		if (!definition.name || typeof definition.name !== "string") {
			throw new Error("Tool definition must have a non-empty string 'name'.");
		}

		if (!definition.description || typeof definition.description !== "string") {
			throw new Error(
				`Tool "${definition.name}": definition must have a non-empty string 'description'.`,
			);
		}

		if (
			definition.inputSchema === null ||
			definition.inputSchema === undefined ||
			typeof definition.inputSchema !== "object"
		) {
			throw new Error(
				`Tool "${definition.name}": definition must have an 'inputSchema' object.`,
			);
		}
	}
}
