import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createConfig,
  cascadeConfigs,
  getChitraguptaHome,
  loadGlobalSettings,
  saveGlobalSettings,
  loadProjectConfig,
  DEFAULT_SETTINGS,
  ConfigError,
} from "@chitragupta/core";

// Mock the fs module used by config.ts
vi.mock("fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    default: {
      existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
        return store.get(p)!;
      }),
      writeFileSync: vi.fn((p: string, data: string) => {
        store.set(p, data);
      }),
      mkdirSync: vi.fn((_p: string) => {
        dirs.add(_p);
      }),
      readdirSync: vi.fn(() => []),
      rmdirSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    __store: store,
    __dirs: dirs,
  };
});

describe("Config", () => {
  describe("createConfig", () => {
    it("should create a config with the specified layer", () => {
      const config = createConfig("project");
      expect(config.layer).toBe("project");
    });

    it("should get and set simple values", () => {
      const config = createConfig("session");
      config.set("key", "value");
      expect(config.get("key")).toBe("value");
    });

    it("should return fallback when key does not exist", () => {
      const config = createConfig("session");
      expect(config.get("missing", "default")).toBe("default");
    });

    it("should return undefined when key does not exist and no fallback", () => {
      const config = createConfig("session");
      expect(config.get("missing")).toBeUndefined();
    });

    it("should support dot-notation for nested values", () => {
      const config = createConfig("session");
      config.set("a.b.c", 42);
      expect(config.get("a.b.c")).toBe(42);
    });

    it("should create intermediate objects for nested set", () => {
      const config = createConfig("session");
      config.set("deep.nested.key", "hello");
      const all = config.all();
      expect((all as any).deep.nested.key).toBe("hello");
    });

    it("should support has() check", () => {
      const config = createConfig("session");
      config.set("exists", true);
      expect(config.has("exists")).toBe(true);
      expect(config.has("nope")).toBe(false);
    });

    it("should support has() for nested keys", () => {
      const config = createConfig("session");
      config.set("a.b", "val");
      expect(config.has("a.b")).toBe(true);
      expect(config.has("a.c")).toBe(false);
    });

    it("should support delete()", () => {
      const config = createConfig("session");
      config.set("key", "value");
      config.delete("key");
      expect(config.has("key")).toBe(false);
      expect(config.get("key")).toBeUndefined();
    });

    it("should support delete() for nested keys", () => {
      const config = createConfig("session");
      config.set("a.b.c", 42);
      config.delete("a.b.c");
      expect(config.has("a.b.c")).toBe(false);
    });

    it("should handle delete on non-existent key without error", () => {
      const config = createConfig("session");
      expect(() => config.delete("nonexistent.key")).not.toThrow();
    });

    it("should return a shallow copy from all()", () => {
      const config = createConfig("session", { a: 1, b: 2 });
      const all = config.all();
      all.c = 3;
      expect(config.has("c")).toBe(false);
    });

    it("should support merge()", () => {
      const config = createConfig("session", { a: 1 });
      config.merge({ b: 2, c: 3 });
      expect(config.get("a")).toBe(1);
      expect(config.get("b")).toBe(2);
      expect(config.get("c")).toBe(3);
    });

    it("should accept initial values in the constructor", () => {
      const config = createConfig("global", { name: "test", count: 5 });
      expect(config.get("name")).toBe("test");
      expect(config.get("count")).toBe(5);
    });
  });

  describe("cascadeConfigs", () => {
    it("should merge multiple config layers", () => {
      const global = createConfig("global", { theme: "dark", lang: "en" });
      const project = createConfig("project", { lang: "es" });
      const session = createConfig("session", { debug: true });

      const merged = cascadeConfigs(global, project, session);
      expect(merged.get("theme")).toBe("dark");
      expect(merged.get("lang")).toBe("es"); // project overrides global
      expect(merged.get("debug")).toBe(true);
    });

    it("should give last layer priority on conflicts", () => {
      const layer1 = createConfig("global", { key: "first" });
      const layer2 = createConfig("project", { key: "second" });
      const layer3 = createConfig("session", { key: "third" });

      const merged = cascadeConfigs(layer1, layer2, layer3);
      expect(merged.get("key")).toBe("third");
    });

    it("should produce a session-layer config", () => {
      const merged = cascadeConfigs(createConfig("global"));
      expect(merged.layer).toBe("session");
    });
  });

  describe("getChitraguptaHome", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    afterEach(() => {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    });

    it("should return a path ending with .chitragupta", () => {
      const home = getChitraguptaHome();
      expect(home).toMatch(/\.chitragupta$/);
    });

    it("should use HOME environment variable", () => {
      process.env.HOME = "/home/testuser";
      const home = getChitraguptaHome();
      expect(home).toBe("/home/testuser/.chitragupta");
    });

    it("should fall back to USERPROFILE on Windows", () => {
      delete process.env.HOME;
      process.env.USERPROFILE = "C:\\Users\\testuser";
      const home = getChitraguptaHome();
      expect(home).toContain(".chitragupta");
    });
  });

  describe("loadGlobalSettings", () => {
    let fsModule: any;

    beforeEach(async () => {
      fsModule = await import("fs");
      fsModule.__store.clear();
      fsModule.__dirs.clear();
    });

    it("should return default settings when no file exists", () => {
      const settings = loadGlobalSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it("should merge saved settings with defaults", () => {
      const settingsPath = getChitraguptaHome() + "/config/settings.json";
      fsModule.__store.set(settingsPath, JSON.stringify({
        defaultProvider: "openai",
        theme: "monokai",
      }));

      const settings = loadGlobalSettings();
      expect(settings.defaultProvider).toBe("openai");
      expect(settings.theme).toBe("monokai");
      // Defaults should still be present for unset keys
      expect(settings.defaultModel).toBe(DEFAULT_SETTINGS.defaultModel);
    });

    it("should return defaults when settings file is corrupted", () => {
      const settingsPath = getChitraguptaHome() + "/config/settings.json";
      fsModule.__store.set(settingsPath, "not-valid-json{{{");

      const settings = loadGlobalSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("saveGlobalSettings", () => {
    let fsModule: any;

    beforeEach(async () => {
      fsModule = await import("fs");
      fsModule.__store.clear();
      fsModule.__dirs.clear();
    });

    it("should save settings as JSON", () => {
      const settings = { ...DEFAULT_SETTINGS, theme: "solarized" };
      saveGlobalSettings(settings);

      const settingsPath = getChitraguptaHome() + "/config/settings.json";
      const written = fsModule.__store.get(settingsPath);
      expect(written).toBeDefined();
      const parsed = JSON.parse(written);
      expect(parsed.theme).toBe("solarized");
    });

    it("should create the config directory", () => {
      saveGlobalSettings(DEFAULT_SETTINGS);
      expect(fsModule.default.mkdirSync).toHaveBeenCalled();
    });
  });

  describe("loadProjectConfig", () => {
    let fsModule: any;

    beforeEach(async () => {
      fsModule = await import("fs");
      fsModule.__store.clear();
      fsModule.__dirs.clear();
    });

    it("should return empty object when no chitragupta.json exists", () => {
      const config = loadProjectConfig("/some/project");
      expect(config).toEqual({});
    });

    it("should load and parse chitragupta.json", () => {
      fsModule.__store.set("/myproject/chitragupta.json", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
      }));

      const config = loadProjectConfig("/myproject");
      expect(config.provider).toBe("anthropic");
      expect(config.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("should throw ConfigError when chitragupta.json is malformed", () => {
      fsModule.__store.set("/badproject/chitragupta.json", "{invalid json");
      expect(() => loadProjectConfig("/badproject")).toThrow(ConfigError);
    });
  });
});
