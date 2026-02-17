import { describe, it, expect, beforeEach } from "vitest";
import { createProviderRegistry } from "@chitragupta/swara";
import type { ProviderRegistry, ProviderDefinition, ModelDefinition } from "@chitragupta/swara";

function makeModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: overrides.id ?? "test-model",
    name: overrides.name ?? "Test Model",
    contextWindow: overrides.contextWindow ?? 128000,
    maxOutputTokens: overrides.maxOutputTokens ?? 4096,
    pricing: overrides.pricing ?? { input: 3, output: 15 },
    capabilities: overrides.capabilities ?? {
      vision: false,
      thinking: false,
      toolUse: true,
      streaming: true,
    },
  };
}

function makeProvider(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: overrides.id ?? "test-provider",
    name: overrides.name ?? "Test Provider",
    models: overrides.models ?? [makeModel()],
    auth: overrides.auth ?? { type: "api-key", envVar: "TEST_KEY" },
    stream: overrides.stream ?? (async function* () {}),
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = createProviderRegistry();
  });

  describe("register", () => {
    it("should register a provider", () => {
      const provider = makeProvider({ id: "anthropic" });
      registry.register(provider);
      expect(registry.has("anthropic")).toBe(true);
    });

    it("should overwrite a provider with the same id (no error)", () => {
      const provider1 = makeProvider({ id: "openai", name: "v1" });
      const provider2 = makeProvider({ id: "openai", name: "v2" });
      registry.register(provider1);
      registry.register(provider2);
      expect(registry.get("openai")?.name).toBe("v2");
    });
  });

  describe("get", () => {
    it("should return a registered provider by id", () => {
      const provider = makeProvider({ id: "google" });
      registry.register(provider);
      expect(registry.get("google")).toBe(provider);
    });

    it("should return undefined for an unregistered provider", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("has", () => {
    it("should return true for registered providers", () => {
      registry.register(makeProvider({ id: "exists" }));
      expect(registry.has("exists")).toBe(true);
    });

    it("should return false for unregistered providers", () => {
      expect(registry.has("nope")).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all registered providers", () => {
      registry.register(makeProvider({ id: "a" }));
      registry.register(makeProvider({ id: "b" }));
      registry.register(makeProvider({ id: "c" }));
      const all = registry.getAll();
      expect(all).toHaveLength(3);
      const ids = all.map((p) => p.id);
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids).toContain("c");
    });

    it("should return empty array when no providers are registered", () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("remove", () => {
    it("should remove a registered provider", () => {
      registry.register(makeProvider({ id: "removable" }));
      registry.remove("removable");
      expect(registry.has("removable")).toBe(false);
    });

    it("should not throw when removing a non-existent provider", () => {
      expect(() => registry.remove("ghost")).not.toThrow();
    });
  });

  describe("getModels", () => {
    it("should aggregate models from all providers", () => {
      const modelA = makeModel({ id: "model-a" });
      const modelB = makeModel({ id: "model-b" });
      const modelC = makeModel({ id: "model-c" });

      registry.register(makeProvider({ id: "p1", models: [modelA, modelB] }));
      registry.register(makeProvider({ id: "p2", models: [modelC] }));

      const models = registry.getModels();
      expect(models).toHaveLength(3);
      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain("model-a");
      expect(modelIds).toContain("model-b");
      expect(modelIds).toContain("model-c");
    });

    it("should return empty array when no providers are registered", () => {
      expect(registry.getModels()).toHaveLength(0);
    });

    it("should return empty array when providers have no models", () => {
      registry.register(makeProvider({ id: "empty", models: [] }));
      expect(registry.getModels()).toHaveLength(0);
    });
  });
});
