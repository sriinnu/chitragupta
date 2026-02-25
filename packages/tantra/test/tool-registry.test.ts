import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";
import { PluginLoader } from "../src/plugin-loader.js";
import type { McpToolHandler } from "../src/types.js";
import type {
	ToolPlugin,
	RegistryChangeEvent,
} from "../src/tool-registry-types.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Create a minimal valid McpToolHandler for testing. */
function createHandler(name: string, description = `Tool: ${name}`): McpToolHandler {
	return {
		definition: {
			name,
			description,
			inputSchema: { type: "object", properties: {} },
		},
		async execute(args: Record<string, unknown>) {
			return { content: [{ type: "text", text: JSON.stringify(args) }] };
		},
	};
}

/** Create a minimal valid ToolPlugin for testing. */
function createPlugin(
	id: string,
	toolNames: string[],
	version = "1.0.0",
): ToolPlugin {
	return {
		id,
		name: `Plugin ${id}`,
		version,
		description: `Test plugin: ${id}`,
		tools: toolNames.map((n) => createHandler(n)),
	};
}

// ─── ToolRegistry Tests ─────────────────────────────────────────────────────

describe("ToolRegistry", () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Core Registration
	// ═══════════════════════════════════════════════════════════════════════

	describe("registerTool / unregisterTool", () => {
		it("should register a standalone tool and retrieve it", () => {
			const handler = createHandler("greet");
			registry.registerTool(handler);

			expect(registry.hasTool("greet")).toBe(true);
			expect(registry.getTool("greet")).toBe(handler);
			expect(registry.size).toBe(1);
		});

		it("should unregister a tool by name", () => {
			registry.registerTool(createHandler("greet"));
			registry.unregisterTool("greet");

			expect(registry.hasTool("greet")).toBe(false);
			expect(registry.getTool("greet")).toBeUndefined();
			expect(registry.size).toBe(0);
		});

		it("should silently ignore unregistering a non-existent tool", () => {
			expect(() => registry.unregisterTool("nonexistent")).not.toThrow();
		});

		it("should list only enabled tools via listTools()", () => {
			registry.registerTool(createHandler("alpha"));
			registry.registerTool(createHandler("beta"));
			registry.disableTool("beta");

			const tools = registry.listTools();
			expect(tools).toHaveLength(1);
			expect(tools[0].definition.name).toBe("alpha");
		});

		it("should list all tools regardless of state via listAllTools()", () => {
			registry.registerTool(createHandler("alpha"));
			registry.registerTool(createHandler("beta"));
			registry.disableTool("beta");

			const tools = registry.listAllTools();
			expect(tools).toHaveLength(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Namespace Collision Detection
	// ═══════════════════════════════════════════════════════════════════════

	describe("namespace collision", () => {
		it("should throw on duplicate tool name when strictNamespaces is true", () => {
			registry.registerTool(createHandler("greet"));
			expect(() => registry.registerTool(createHandler("greet"))).toThrow(
				/Tool name collision.*greet/,
			);
		});

		it("should allow duplicate names when strictNamespaces is false", () => {
			const permissive = new ToolRegistry({ strictNamespaces: false });
			permissive.registerTool(createHandler("greet"));
			expect(() => permissive.registerTool(createHandler("greet"))).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Tool Validation
	// ═══════════════════════════════════════════════════════════════════════

	describe("tool validation", () => {
		it("should reject a tool with empty name", () => {
			const handler = createHandler("");
			expect(() => registry.registerTool(handler)).toThrow(/non-empty string 'name'/);
		});

		it("should reject a tool with empty description", () => {
			const handler: McpToolHandler = {
				definition: {
					name: "bad-tool",
					description: "",
					inputSchema: {},
				},
				async execute() {
					return { content: [{ type: "text", text: "ok" }] };
				},
			};
			expect(() => registry.registerTool(handler)).toThrow(/non-empty string 'description'/);
		});

		it("should skip validation when validateSchemas is false", () => {
			const lenient = new ToolRegistry({ validateSchemas: false });
			const handler: McpToolHandler = {
				definition: {
					name: "",
					description: "",
					inputSchema: {},
				},
				async execute() {
					return { content: [{ type: "text", text: "ok" }] };
				},
			};
			expect(() => lenient.registerTool(handler)).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Plugin Management
	// ═══════════════════════════════════════════════════════════════════════

	describe("registerPlugin / unregisterPlugin", () => {
		it("should register a plugin and all its tools", () => {
			const plugin = createPlugin("analytics", ["track", "identify"]);
			registry.registerPlugin(plugin);

			expect(registry.hasTool("track")).toBe(true);
			expect(registry.hasTool("identify")).toBe(true);
			expect(registry.size).toBe(2);

			const plugins = registry.listPlugins();
			expect(plugins).toHaveLength(1);
			expect(plugins[0].id).toBe("analytics");
			expect(plugins[0].toolNames).toEqual(["track", "identify"]);
			expect(plugins[0].enabled).toBe(true);
		});

		it("should unregister a plugin and remove all its tools", () => {
			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));
			registry.unregisterPlugin("analytics");

			expect(registry.hasTool("track")).toBe(false);
			expect(registry.hasTool("identify")).toBe(false);
			expect(registry.size).toBe(0);
			expect(registry.listPlugins()).toHaveLength(0);
		});

		it("should throw when registering a duplicate plugin ID", () => {
			registry.registerPlugin(createPlugin("analytics", ["track"]));
			expect(() => registry.registerPlugin(createPlugin("analytics", ["other"]))).toThrow(
				/Plugin already registered.*analytics/,
			);
		});

		it("should atomically reject plugin if any tool name collides", () => {
			registry.registerTool(createHandler("track"));
			const plugin = createPlugin("analytics", ["track", "identify"]);

			expect(() => registry.registerPlugin(plugin)).toThrow(/Tool name collision.*track/);
			// Neither tool should have been registered from the plugin
			expect(registry.hasTool("identify")).toBe(false);
			expect(registry.listPlugins()).toHaveLength(0);
		});

		it("should silently ignore unregistering a non-existent plugin", () => {
			expect(() => registry.unregisterPlugin("nonexistent")).not.toThrow();
		});

		it("should report plugin as disabled when any tool is disabled", () => {
			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));
			registry.disableTool("track");

			const plugins = registry.listPlugins();
			expect(plugins[0].enabled).toBe(false);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Enable / Disable Lifecycle
	// ═══════════════════════════════════════════════════════════════════════

	describe("enableTool / disableTool", () => {
		it("should disable a tool so getTool returns undefined", () => {
			registry.registerTool(createHandler("greet"));
			registry.disableTool("greet");

			expect(registry.isEnabled("greet")).toBe(false);
			expect(registry.getTool("greet")).toBeUndefined();
		});

		it("should re-enable a disabled tool", () => {
			const handler = createHandler("greet");
			registry.registerTool(handler);
			registry.disableTool("greet");
			registry.enableTool("greet");

			expect(registry.isEnabled("greet")).toBe(true);
			expect(registry.getTool("greet")).toBe(handler);
		});

		it("should throw when enabling a non-existent tool", () => {
			expect(() => registry.enableTool("nonexistent")).toThrow(/Tool not found/);
		});

		it("should throw when disabling a non-existent tool", () => {
			expect(() => registry.disableTool("nonexistent")).toThrow(/Tool not found/);
		});

		it("should be a no-op when enabling an already-enabled tool", () => {
			const listener = vi.fn();
			registry.registerTool(createHandler("greet"));
			registry.onChange(listener);

			registry.enableTool("greet");
			// No "tool:enabled" event should fire for a no-op
			expect(listener).not.toHaveBeenCalled();
		});

		it("should be a no-op when disabling an already-disabled tool", () => {
			const listener = vi.fn();
			registry.registerTool(createHandler("greet"));
			registry.disableTool("greet");
			registry.onChange(listener);

			registry.disableTool("greet");
			expect(listener).not.toHaveBeenCalled();
		});

		it("should still return disabled tool via getToolIncludingDisabled", () => {
			const handler = createHandler("greet");
			registry.registerTool(handler);
			registry.disableTool("greet");

			expect(registry.getToolIncludingDisabled("greet")).toBe(handler);
		});

		it("should return false for isEnabled on non-existent tool", () => {
			expect(registry.isEnabled("nonexistent")).toBe(false);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Change Events
	// ═══════════════════════════════════════════════════════════════════════

	describe("onChange events", () => {
		it("should fire tool:registered when a tool is added", () => {
			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.registerTool(createHandler("greet"));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("tool:registered");
			if (events[0].type === "tool:registered") {
				expect(events[0].toolName).toBe("greet");
				expect(events[0].pluginId).toBeUndefined();
			}
		});

		it("should fire tool:unregistered when a tool is removed", () => {
			registry.registerTool(createHandler("greet"));
			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.unregisterTool("greet");

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("tool:unregistered");
		});

		it("should fire tool:enabled and tool:disabled events", () => {
			registry.registerTool(createHandler("greet"));
			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.disableTool("greet");
			registry.enableTool("greet");

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe("tool:disabled");
			expect(events[1].type).toBe("tool:enabled");
		});

		it("should fire plugin:registered with tool names", () => {
			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("plugin:registered");
			if (events[0].type === "plugin:registered") {
				expect(events[0].pluginId).toBe("analytics");
				expect(events[0].toolNames).toEqual(["track", "identify"]);
			}
		});

		it("should fire plugin:unregistered with tool names", () => {
			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));
			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.unregisterPlugin("analytics");

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("plugin:unregistered");
			if (events[0].type === "plugin:unregistered") {
				expect(events[0].toolNames).toEqual(["track", "identify"]);
			}
		});

		it("should allow unsubscribing from events", () => {
			const listener = vi.fn();
			const unsubscribe = registry.onChange(listener);

			registry.registerTool(createHandler("greet"));
			expect(listener).toHaveBeenCalledTimes(1);

			unsubscribe();
			registry.registerTool(createHandler("farewell"));
			expect(listener).toHaveBeenCalledTimes(1); // No additional call
		});

		it("should not break when a listener throws", () => {
			registry.onChange(() => {
				throw new Error("bad listener");
			});
			const goodListener = vi.fn();
			registry.onChange(goodListener);

			// Should not throw even though the first listener throws
			expect(() => registry.registerTool(createHandler("greet"))).not.toThrow();
			expect(goodListener).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Snapshot
	// ═══════════════════════════════════════════════════════════════════════

	describe("toSnapshot", () => {
		it("should produce a complete snapshot of registry state", () => {
			registry.registerTool(createHandler("standalone"));
			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));
			registry.disableTool("track");

			const snapshot = registry.toSnapshot();

			expect(snapshot.totalTools).toBe(3);
			expect(snapshot.enabledTools).toBe(2);
			expect(snapshot.disabledTools).toBe(1);
			expect(snapshot.timestamp).toBeTruthy();
			expect(snapshot.tools).toHaveLength(3);
			expect(snapshot.plugins).toHaveLength(1);

			// Verify tool entries
			const trackEntry = snapshot.tools.find((t) => t.definition.name === "track");
			expect(trackEntry).toBeDefined();
			expect(trackEntry!.enabled).toBe(false);
			expect(trackEntry!.pluginId).toBe("analytics");

			const standaloneEntry = snapshot.tools.find(
				(t) => t.definition.name === "standalone",
			);
			expect(standaloneEntry).toBeDefined();
			expect(standaloneEntry!.pluginId).toBeUndefined();
		});

		it("should produce an empty snapshot for an empty registry", () => {
			const snapshot = registry.toSnapshot();

			expect(snapshot.totalTools).toBe(0);
			expect(snapshot.enabledTools).toBe(0);
			expect(snapshot.disabledTools).toBe(0);
			expect(snapshot.tools).toHaveLength(0);
			expect(snapshot.plugins).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Clear
	// ═══════════════════════════════════════════════════════════════════════

	describe("clear", () => {
		it("should remove all tools and plugins", () => {
			registry.registerTool(createHandler("standalone"));
			registry.registerPlugin(createPlugin("analytics", ["track"]));

			registry.clear();

			expect(registry.size).toBe(0);
			expect(registry.listTools()).toHaveLength(0);
			expect(registry.listPlugins()).toHaveLength(0);
		});

		it("should fire unregister events when clearing", () => {
			registry.registerPlugin(createPlugin("analytics", ["track"]));
			registry.registerTool(createHandler("standalone"));

			const events: RegistryChangeEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.clear();

			const pluginEvents = events.filter((e) => e.type === "plugin:unregistered");
			const toolEvents = events.filter((e) => e.type === "tool:unregistered");
			expect(pluginEvents).toHaveLength(1);
			expect(toolEvents).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Unregister tool belonging to a plugin
	// ═══════════════════════════════════════════════════════════════════════

	describe("unregister plugin tool individually", () => {
		it("should remove tool from plugin tracking when unregistered individually", () => {
			registry.registerPlugin(createPlugin("analytics", ["track", "identify"]));
			registry.unregisterTool("track");

			expect(registry.hasTool("track")).toBe(false);
			expect(registry.hasTool("identify")).toBe(true);

			const plugins = registry.listPlugins();
			expect(plugins[0].toolNames).toEqual(["identify"]);
		});
	});
});

// ─── PluginLoader.validate Tests ────────────────────────────────────────────

describe("PluginLoader.validate", () => {
	it("should accept a valid plugin object", () => {
		const plugin = createPlugin("test", ["tool-a"]);
		expect(PluginLoader.validate(plugin)).toBe(true);
	});

	it("should reject null", () => {
		expect(PluginLoader.validate(null)).toBe(false);
	});

	it("should reject a plugin with missing id", () => {
		expect(
			PluginLoader.validate({
				name: "Test",
				version: "1.0.0",
				tools: [createHandler("a")],
			}),
		).toBe(false);
	});

	it("should reject a plugin with empty tools array", () => {
		expect(
			PluginLoader.validate({
				id: "test",
				name: "Test",
				version: "1.0.0",
				tools: [],
			}),
		).toBe(false);
	});

	it("should reject a plugin where a tool handler has no execute function", () => {
		expect(
			PluginLoader.validate({
				id: "test",
				name: "Test",
				version: "1.0.0",
				tools: [{ definition: { name: "a", description: "A", inputSchema: {} } }],
			}),
		).toBe(false);
	});

	it("should reject a plugin with non-string description", () => {
		expect(
			PluginLoader.validate({
				id: "test",
				name: "Test",
				version: "1.0.0",
				description: 123,
				tools: [createHandler("a")],
			}),
		).toBe(false);
	});

	it("should accept a plugin with optional description omitted", () => {
		const plugin: ToolPlugin = {
			id: "test",
			name: "Test",
			version: "1.0.0",
			tools: [createHandler("a")],
		};
		expect(PluginLoader.validate(plugin)).toBe(true);
	});
});
