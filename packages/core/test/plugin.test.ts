import { describe, it, expect, beforeEach } from "vitest";
import { createPluginRegistry, PluginError } from "@chitragupta/core";
import type { Plugin, PluginRegistry } from "@chitragupta/core";

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: overrides.name ?? "test-plugin",
    version: overrides.version ?? "1.0.0",
    type: overrides.type ?? "tool",
    description: overrides.description ?? "A test plugin",
    init: overrides.init ?? (() => {}),
    destroy: overrides.destroy,
  };
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createPluginRegistry();
  });

  describe("register", () => {
    it("should register a plugin successfully", () => {
      const plugin = makePlugin({ name: "my-plugin" });
      registry.register(plugin);
      expect(registry.has("my-plugin")).toBe(true);
    });

    it("should throw PluginError when registering a duplicate plugin name", () => {
      const plugin1 = makePlugin({ name: "dup" });
      const plugin2 = makePlugin({ name: "dup", version: "2.0.0" });
      registry.register(plugin1);

      expect(() => registry.register(plugin2)).toThrow(PluginError);
      expect(() => registry.register(plugin2)).toThrow(
        'Plugin "dup" is already registered',
      );
    });

    it("should allow registering multiple plugins with different names", () => {
      registry.register(makePlugin({ name: "plugin-a" }));
      registry.register(makePlugin({ name: "plugin-b" }));
      registry.register(makePlugin({ name: "plugin-c" }));
      expect(registry.has("plugin-a")).toBe(true);
      expect(registry.has("plugin-b")).toBe(true);
      expect(registry.has("plugin-c")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return a registered plugin by name", () => {
      const plugin = makePlugin({ name: "fetch-me" });
      registry.register(plugin);
      const fetched = registry.get("fetch-me");
      expect(fetched).toBe(plugin);
    });

    it("should return undefined for an unregistered plugin", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("has", () => {
    it("should return true for registered plugins", () => {
      registry.register(makePlugin({ name: "exists" }));
      expect(registry.has("exists")).toBe(true);
    });

    it("should return false for unregistered plugins", () => {
      expect(registry.has("does-not-exist")).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all registered plugins when no type filter is given", () => {
      registry.register(makePlugin({ name: "a", type: "tool" }));
      registry.register(makePlugin({ name: "b", type: "provider" }));
      registry.register(makePlugin({ name: "c", type: "theme" }));
      const all = registry.getAll();
      expect(all).toHaveLength(3);
    });

    it("should filter plugins by type", () => {
      registry.register(makePlugin({ name: "tool1", type: "tool" }));
      registry.register(makePlugin({ name: "tool2", type: "tool" }));
      registry.register(makePlugin({ name: "provider1", type: "provider" }));
      registry.register(makePlugin({ name: "theme1", type: "theme" }));

      const tools = registry.getAll("tool");
      expect(tools).toHaveLength(2);
      expect(tools.every((p) => p.type === "tool")).toBe(true);

      const providers = registry.getAll("provider");
      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe("provider1");
    });

    it("should return empty array when no plugins match the type", () => {
      registry.register(makePlugin({ name: "tool1", type: "tool" }));
      const commands = registry.getAll("command");
      expect(commands).toHaveLength(0);
    });

    it("should return empty array when no plugins are registered", () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("unregister", () => {
    it("should remove a registered plugin", () => {
      registry.register(makePlugin({ name: "removable" }));
      expect(registry.has("removable")).toBe(true);
      registry.unregister("removable");
      expect(registry.has("removable")).toBe(false);
    });

    it("should not throw when unregistering a non-existent plugin", () => {
      expect(() => registry.unregister("ghost")).not.toThrow();
    });

    it("should allow re-registration after unregister", () => {
      const plugin = makePlugin({ name: "reusable" });
      registry.register(plugin);
      registry.unregister("reusable");
      // Should not throw
      registry.register(makePlugin({ name: "reusable", version: "2.0.0" }));
      expect(registry.get("reusable")?.version).toBe("2.0.0");
    });
  });

  describe("Plugin interface", () => {
    it("should preserve all plugin fields on retrieval", () => {
      const plugin = makePlugin({
        name: "full-plugin",
        version: "3.2.1",
        type: "agent-profile",
        description: "A fully specified plugin",
      });
      registry.register(plugin);
      const fetched = registry.get("full-plugin");
      expect(fetched?.name).toBe("full-plugin");
      expect(fetched?.version).toBe("3.2.1");
      expect(fetched?.type).toBe("agent-profile");
      expect(fetched?.description).toBe("A fully specified plugin");
    });
  });
});
