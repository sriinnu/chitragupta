import { describe, it, expect } from "vitest";
import {
  CHITRAGUPTA_PROFILE,
  MINIMAL_PROFILE,
  FRIENDLY_PROFILE,
  KARTRU_PROFILE,
  BUILT_IN_PROFILES,
  resolveProfile,
} from "@chitragupta/core";
import type { AgentProfile } from "@chitragupta/core";

describe("AgentProfile", () => {
  describe("built-in profiles", () => {
    it("should have a chitragupta profile with correct id", () => {
      expect(CHITRAGUPTA_PROFILE.id).toBe("chitragupta");
      expect(CHITRAGUPTA_PROFILE.name).toBe("Chitragupta");
    });

    it("should have a minimal profile with correct id", () => {
      expect(MINIMAL_PROFILE.id).toBe("minimal");
      expect(MINIMAL_PROFILE.name).toBe("Assistant");
    });

    it("should have a friendly profile with correct id", () => {
      expect(FRIENDLY_PROFILE.id).toBe("friendly");
      expect(FRIENDLY_PROFILE.name).toBe("Guide");
    });

    it("chitragupta profile should have expertise areas", () => {
      expect(CHITRAGUPTA_PROFILE.expertise.length).toBeGreaterThan(0);
      expect(CHITRAGUPTA_PROFILE.expertise).toContain("typescript");
    });

    it("chitragupta profile should have bold voice", () => {
      expect(CHITRAGUPTA_PROFILE.voice).toBe("bold");
    });

    it("minimal profile should have minimal voice", () => {
      expect(MINIMAL_PROFILE.voice).toBe("minimal");
    });

    it("friendly profile should have friendly voice", () => {
      expect(FRIENDLY_PROFILE.voice).toBe("friendly");
    });

    it("chitragupta profile should have a preferredModel", () => {
      expect(CHITRAGUPTA_PROFILE.preferredModel).toBeDefined();
      expect(typeof CHITRAGUPTA_PROFILE.preferredModel).toBe("string");
    });

    it("chitragupta profile should have a preferredThinking level", () => {
      expect(CHITRAGUPTA_PROFILE.preferredThinking).toBe("medium");
    });

    it("all profiles should have non-empty personality", () => {
      expect(CHITRAGUPTA_PROFILE.personality.length).toBeGreaterThan(0);
      expect(MINIMAL_PROFILE.personality.length).toBeGreaterThan(0);
      expect(FRIENDLY_PROFILE.personality.length).toBeGreaterThan(0);
    });
  });

  describe("BUILT_IN_PROFILES", () => {
    it("should contain all nine built-in profiles", () => {
      expect(Object.keys(BUILT_IN_PROFILES)).toHaveLength(9);
      expect(BUILT_IN_PROFILES).toHaveProperty("chitragupta");
      expect(BUILT_IN_PROFILES).toHaveProperty("minimal");
      expect(BUILT_IN_PROFILES).toHaveProperty("friendly");
      expect(BUILT_IN_PROFILES).toHaveProperty("kartru");
      expect(BUILT_IN_PROFILES).toHaveProperty("parikshaka");
      expect(BUILT_IN_PROFILES).toHaveProperty("anveshi");
      expect(BUILT_IN_PROFILES).toHaveProperty("shodhaka");
      expect(BUILT_IN_PROFILES).toHaveProperty("parikartru");
      expect(BUILT_IN_PROFILES).toHaveProperty("lekhaka");
    });

    it("should map to the correct profile instances", () => {
      expect(BUILT_IN_PROFILES.chitragupta).toBe(CHITRAGUPTA_PROFILE);
      expect(BUILT_IN_PROFILES.minimal).toBe(MINIMAL_PROFILE);
      expect(BUILT_IN_PROFILES.friendly).toBe(FRIENDLY_PROFILE);
      expect(BUILT_IN_PROFILES.kartru).toBe(KARTRU_PROFILE);
    });
  });

  describe("resolveProfile", () => {
    it("should resolve built-in profiles by id", () => {
      expect(resolveProfile("chitragupta")).toBe(CHITRAGUPTA_PROFILE);
      expect(resolveProfile("minimal")).toBe(MINIMAL_PROFILE);
      expect(resolveProfile("friendly")).toBe(FRIENDLY_PROFILE);
    });

    it("should return undefined for unknown profile id with no custom map", () => {
      expect(resolveProfile("unknown")).toBeUndefined();
    });

    it("should resolve custom profiles from the custom map", () => {
      const customProfile: AgentProfile = {
        id: "custom",
        name: "Custom Agent",
        personality: "A custom personality",
        expertise: ["python"],
        voice: "custom",
      };
      const customMap = { custom: customProfile };
      expect(resolveProfile("custom", customMap)).toBe(customProfile);
    });

    it("should prefer built-in profiles over custom profiles with the same id", () => {
      const overrideProfile: AgentProfile = {
        id: "chitragupta",
        name: "Fake Chitragupta",
        personality: "Overridden",
        expertise: [],
        voice: "minimal",
      };
      const customMap = { chitragupta: overrideProfile };
      // Built-in wins via ?? operator
      expect(resolveProfile("chitragupta", customMap)).toBe(CHITRAGUPTA_PROFILE);
    });

    it("should return undefined when custom map does not contain the id", () => {
      const customMap = {
        other: {
          id: "other",
          name: "Other",
          personality: "...",
          expertise: [],
          voice: "minimal" as const,
        },
      };
      expect(resolveProfile("missing", customMap)).toBeUndefined();
    });

    it("should work with an empty custom map", () => {
      expect(resolveProfile("chitragupta", {})).toBe(CHITRAGUPTA_PROFILE);
      expect(resolveProfile("missing", {})).toBeUndefined();
    });
  });
});
