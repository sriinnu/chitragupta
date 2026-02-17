import { describe, it, expect, beforeEach } from "vitest";
import { KulaRegistry } from "../src/kula.js";
import type { MergeResult } from "../src/kula.js";
import { KULA_WEIGHTS } from "../src/types-v2.js";
import type { KulaType, EnhancedSkillManifest } from "../src/types-v2.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeManifest(
	name: string,
	overrides?: Partial<EnhancedSkillManifest>,
): EnhancedSkillManifest {
	return {
		name,
		version: "1.0.0",
		description: `A skill named ${name}`,
		capabilities: [
			{
				verb: "do",
				object: name,
				description: `Performs ${name}`,
			},
		],
		tags: ["test"],
		source: { type: "tool", toolName: name },
		updatedAt: new Date().toISOString(),
		...overrides,
	} as EnhancedSkillManifest;
}

let registry: KulaRegistry;

beforeEach(() => {
	registry = new KulaRegistry();
});

// ─── Priority Shadowing (Core Algorithm) ────────────────────────────────────

describe("Kula — Priority Shadowing", () => {
	it("same skill name in antara + bahya: get() returns antara version", () => {
		const antaraVersion = makeManifest("file-reader", { version: "2.0.0" });
		const bahyaVersion = makeManifest("file-reader", { version: "1.0.0" });

		registry.register(bahyaVersion, "bahya");
		registry.register(antaraVersion, "antara");

		const result = registry.get("file-reader");
		expect(result).not.toBeNull();
		expect(result!.kula).toBe("antara");
		expect(result!.manifest.version).toBe("2.0.0");
	});

	it("same skill name in bahya + shiksha: get() returns bahya version", () => {
		const bahyaVersion = makeManifest("code-gen", { version: "3.0.0" });
		const shikshaVersion = makeManifest("code-gen", { version: "0.1.0" });

		registry.register(shikshaVersion, "shiksha");
		registry.register(bahyaVersion, "bahya");

		const result = registry.get("code-gen");
		expect(result).not.toBeNull();
		expect(result!.kula).toBe("bahya");
		expect(result!.manifest.version).toBe("3.0.0");
	});

	it("same skill name in all 3 tiers: get() returns antara version", () => {
		registry.register(makeManifest("universal", { version: "0.1.0" }), "shiksha");
		registry.register(makeManifest("universal", { version: "1.0.0" }), "bahya");
		registry.register(makeManifest("universal", { version: "9.0.0" }), "antara");

		const result = registry.get("universal");
		expect(result).not.toBeNull();
		expect(result!.kula).toBe("antara");
		expect(result!.manifest.version).toBe("9.0.0");
	});

	it("remove from antara: bahya version becomes visible (unmasking)", () => {
		registry.register(makeManifest("shadowed", { version: "2.0.0" }), "antara");
		registry.register(makeManifest("shadowed", { version: "1.0.0" }), "bahya");

		// Before unregister: antara wins
		expect(registry.get("shadowed")!.kula).toBe("antara");

		// Unregister from antara
		const removed = registry.unregister("shadowed", "antara");
		expect(removed).toBe(true);

		// Now bahya is visible
		const result = registry.get("shadowed");
		expect(result).not.toBeNull();
		expect(result!.kula).toBe("bahya");
		expect(result!.manifest.version).toBe("1.0.0");
	});

	it("remove from antara + bahya: shiksha version becomes visible", () => {
		registry.register(makeManifest("deep-shadow", { version: "3.0.0" }), "antara");
		registry.register(makeManifest("deep-shadow", { version: "2.0.0" }), "bahya");
		registry.register(makeManifest("deep-shadow", { version: "1.0.0" }), "shiksha");

		registry.unregister("deep-shadow", "antara");
		expect(registry.get("deep-shadow")!.kula).toBe("bahya");

		registry.unregister("deep-shadow", "bahya");
		expect(registry.get("deep-shadow")!.kula).toBe("shiksha");
		expect(registry.get("deep-shadow")!.manifest.version).toBe("1.0.0");
	});

	it("getAll() with shadowing: N unique names, each from highest available tier", () => {
		// Register 3 unique + 2 shadowed
		registry.register(makeManifest("skill-a"), "antara");
		registry.register(makeManifest("skill-a"), "bahya");    // shadowed by antara
		registry.register(makeManifest("skill-b"), "bahya");
		registry.register(makeManifest("skill-b"), "shiksha");  // shadowed by bahya
		registry.register(makeManifest("skill-c"), "shiksha");

		const all = registry.getAll();
		expect(all).toHaveLength(3); // 3 unique names

		const map = new Map(all.map(r => [r.manifest.name, r.kula]));
		expect(map.get("skill-a")).toBe("antara");
		expect(map.get("skill-b")).toBe("bahya");
		expect(map.get("skill-c")).toBe("shiksha");
	});

	it("getAll() returns empty array for empty registry", () => {
		expect(registry.getAll()).toEqual([]);
	});

	it("get() returns null for non-existent skill", () => {
		expect(registry.get("nonexistent")).toBeNull();
	});

	it("getFromTier() bypasses shadowing and returns tier-specific manifest", () => {
		registry.register(makeManifest("multi", { version: "A" }), "antara");
		registry.register(makeManifest("multi", { version: "B" }), "bahya");

		// get() returns antara
		expect(registry.get("multi")!.manifest.version).toBe("A");

		// getFromTier() for bahya returns bahya version
		const bahyaResult = registry.getFromTier("multi", "bahya");
		expect(bahyaResult).not.toBeNull();
		expect(bahyaResult!.version).toBe("B");
	});
});

// ─── Registration ───────────────────────────────────────────────────────────

describe("Kula — Registration", () => {
	it("register() sets kula field on manifest if not already set", () => {
		const manifest = makeManifest("no-kula");
		expect(manifest.kula).toBeUndefined();

		registry.register(manifest, "bahya");
		const result = registry.get("no-kula");
		expect(result!.manifest.kula).toBe("bahya");
	});

	it("register() preserves existing kula field", () => {
		const manifest = makeManifest("has-kula", { kula: "antara" });
		registry.register(manifest, "bahya"); // registering in bahya tier, but kula field says antara
		const result = registry.getFromTier("has-kula", "bahya");
		expect(result).not.toBeNull();
		expect(result!.kula).toBe("antara"); // preserved, not overwritten
	});

	it("duplicate registration in same tier overwrites", () => {
		registry.register(makeManifest("dup", { version: "1.0.0" }), "bahya");
		registry.register(makeManifest("dup", { version: "2.0.0" }), "bahya");

		const result = registry.getFromTier("dup", "bahya");
		expect(result!.version).toBe("2.0.0");
		expect(registry.sizeByTier.bahya).toBe(1); // still 1, not 2
	});

	it("register() returns void", () => {
		const result = registry.register(makeManifest("void-check"), "antara");
		expect(result).toBeUndefined();
	});

	it("registered manifest is retrievable via get()", () => {
		const manifest = makeManifest("retrievable");
		registry.register(manifest, "shiksha");
		const result = registry.get("retrievable");
		expect(result).not.toBeNull();
		expect(result!.manifest.name).toBe("retrievable");
	});

	it("unregisterAll removes from all tiers", () => {
		registry.register(makeManifest("everywhere"), "antara");
		registry.register(makeManifest("everywhere"), "bahya");
		registry.register(makeManifest("everywhere"), "shiksha");

		registry.unregisterAll("everywhere");
		expect(registry.get("everywhere")).toBeNull();
		expect(registry.has("everywhere")).toBe(false);
	});

	it("unregister returns false for non-existent skill in tier", () => {
		expect(registry.unregister("ghost", "antara")).toBe(false);
	});
});

// ─── Weight System ──────────────────────────────────────────────────────────

describe("Kula — Weight System", () => {
	it("KULA_WEIGHTS: antara=1.0, bahya=0.7, shiksha=0.4", () => {
		expect(KULA_WEIGHTS.antara).toBe(1.0);
		expect(KULA_WEIGHTS.bahya).toBe(0.7);
		expect(KULA_WEIGHTS.shiksha).toBe(0.4);
	});

	it("getWeight returns 1.0 for antara skill", () => {
		registry.register(makeManifest("core-tool"), "antara");
		expect(registry.getWeight("core-tool")).toBe(1.0);
	});

	it("getWeight returns 0.7 for bahya skill", () => {
		registry.register(makeManifest("community-tool"), "bahya");
		expect(registry.getWeight("community-tool")).toBe(0.7);
	});

	it("getWeight returns 0.4 for shiksha skill", () => {
		registry.register(makeManifest("learned-tool"), "shiksha");
		expect(registry.getWeight("learned-tool")).toBe(0.4);
	});

	it("getWeight returns 0 for unknown skill", () => {
		expect(registry.getWeight("does-not-exist")).toBe(0);
	});

	it("weight resolves from highest-priority tier when skill exists in multiple", () => {
		registry.register(makeManifest("multi-weight"), "shiksha");
		registry.register(makeManifest("multi-weight"), "bahya");

		// bahya wins (higher priority)
		expect(registry.getWeight("multi-weight")).toBe(0.7);

		// Add to antara — now antara wins
		registry.register(makeManifest("multi-weight"), "antara");
		expect(registry.getWeight("multi-weight")).toBe(1.0);
	});

	it("getTier returns correct tier for each priority level", () => {
		registry.register(makeManifest("tier-a"), "antara");
		registry.register(makeManifest("tier-b"), "bahya");
		registry.register(makeManifest("tier-c"), "shiksha");

		expect(registry.getTier("tier-a")).toBe("antara");
		expect(registry.getTier("tier-b")).toBe("bahya");
		expect(registry.getTier("tier-c")).toBe("shiksha");
		expect(registry.getTier("nonexistent")).toBeNull();
	});
});

// ─── Merge (Bulk Loading) ───────────────────────────────────────────────────

describe("Kula — Merge", () => {
	it("merge() processes sources in priority order (shiksha first, antara last)", () => {
		// Register in merge — antara should be processed last and shadow
		const result = registry.merge([
			{
				path: "/core",
				kula: "antara",
				manifests: [makeManifest("shared-skill", { version: "A" })],
			},
			{
				path: "/community",
				kula: "bahya",
				manifests: [makeManifest("shared-skill", { version: "B" })],
			},
			{
				path: "/learned",
				kula: "shiksha",
				manifests: [makeManifest("shared-skill", { version: "C" })],
			},
		]);

		// All 3 registered, 2 shadowed (antara shadows both, bahya shadows shiksha)
		expect(result.loaded).toBe(3);
		expect(result.shadowed).toBe(2);

		// get() should resolve to antara
		expect(registry.get("shared-skill")!.kula).toBe("antara");
	});

	it("merge() reports loaded count", () => {
		const result = registry.merge([
			{
				path: "/skills",
				kula: "bahya",
				manifests: [
					makeManifest("skill-1"),
					makeManifest("skill-2"),
					makeManifest("skill-3"),
				],
			},
		]);
		expect(result.loaded).toBe(3);
		expect(result.shadowed).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it("merge() reports shadowed count", () => {
		const result = registry.merge([
			{
				path: "/low",
				kula: "shiksha",
				manifests: [makeManifest("overlap")],
			},
			{
				path: "/high",
				kula: "antara",
				manifests: [makeManifest("overlap")],
			},
		]);
		expect(result.loaded).toBe(2);
		expect(result.shadowed).toBe(1);
	});

	it("merge() collects errors for manifests without names", () => {
		const namelessManifest = { ...makeManifest(""), name: "" } as unknown as EnhancedSkillManifest;
		// Manifest with empty name — the code checks !manifest.name which is truthy for ""
		const result = registry.merge([
			{
				path: "/bad",
				kula: "bahya",
				manifests: [namelessManifest],
			},
		]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].error).toContain("missing name");
	});

	it("after merge, shadowed skills resolve from higher-priority tier", () => {
		registry.merge([
			{
				path: "/shiksha-source",
				kula: "shiksha",
				manifests: [makeManifest("merged-skill", { version: "0.1.0" })],
			},
			{
				path: "/bahya-source",
				kula: "bahya",
				manifests: [makeManifest("merged-skill", { version: "1.0.0" })],
			},
		]);

		const result = registry.get("merged-skill");
		expect(result!.kula).toBe("bahya");
		expect(result!.manifest.version).toBe("1.0.0");
	});

	it("merge() with empty sources returns zero counts", () => {
		const result = registry.merge([]);
		expect(result.loaded).toBe(0);
		expect(result.shadowed).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it("merge() handles multiple skills per source", () => {
		const result = registry.merge([
			{
				path: "/batch",
				kula: "antara",
				manifests: [
					makeManifest("batch-1"),
					makeManifest("batch-2"),
					makeManifest("batch-3"),
					makeManifest("batch-4"),
					makeManifest("batch-5"),
				],
			},
		]);
		expect(result.loaded).toBe(5);
		expect(registry.size).toBe(5);
	});
});

// ─── Conflict Detection ─────────────────────────────────────────────────────

describe("Kula — Conflict Detection", () => {
	it("getConflicts() returns skills present in multiple tiers", () => {
		registry.register(makeManifest("conflicted"), "antara");
		registry.register(makeManifest("conflicted"), "bahya");
		registry.register(makeManifest("unique-a"), "antara");
		registry.register(makeManifest("unique-b"), "bahya");

		const conflicts = registry.getConflicts();
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].name).toBe("conflicted");
		expect(conflicts[0].tiers).toContain("antara");
		expect(conflicts[0].tiers).toContain("bahya");
	});

	it("no conflicts when all skills are unique across tiers", () => {
		registry.register(makeManifest("a-skill"), "antara");
		registry.register(makeManifest("b-skill"), "bahya");
		registry.register(makeManifest("c-skill"), "shiksha");

		expect(registry.getConflicts()).toHaveLength(0);
	});

	it("conflict lists the correct tiers for a skill in all 3", () => {
		registry.register(makeManifest("triple"), "antara");
		registry.register(makeManifest("triple"), "bahya");
		registry.register(makeManifest("triple"), "shiksha");

		const conflicts = registry.getConflicts();
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].tiers).toEqual(["antara", "bahya", "shiksha"]);
	});

	it("multiple skills can have conflicts simultaneously", () => {
		registry.register(makeManifest("conflict-1"), "antara");
		registry.register(makeManifest("conflict-1"), "bahya");
		registry.register(makeManifest("conflict-2"), "bahya");
		registry.register(makeManifest("conflict-2"), "shiksha");

		const conflicts = registry.getConflicts();
		expect(conflicts).toHaveLength(2);
		const names = conflicts.map(c => c.name).sort();
		expect(names).toEqual(["conflict-1", "conflict-2"]);
	});

	it("empty registry has no conflicts", () => {
		expect(registry.getConflicts()).toEqual([]);
	});
});

// ─── Size and Counting ──────────────────────────────────────────────────────

describe("Kula — Size and Counting", () => {
	it("size counts unique names with shadowing applied", () => {
		registry.register(makeManifest("s1"), "antara");
		registry.register(makeManifest("s1"), "bahya");   // same name, shadowed
		registry.register(makeManifest("s2"), "bahya");
		registry.register(makeManifest("s3"), "shiksha");

		expect(registry.size).toBe(3); // s1, s2, s3
	});

	it("sizeByTier counts raw per-tier (no shadowing)", () => {
		registry.register(makeManifest("s1"), "antara");
		registry.register(makeManifest("s1"), "bahya");   // same name in different tier
		registry.register(makeManifest("s2"), "bahya");
		registry.register(makeManifest("s3"), "shiksha");

		const sizes = registry.sizeByTier;
		expect(sizes.antara).toBe(1);
		expect(sizes.bahya).toBe(2); // s1 and s2
		expect(sizes.shiksha).toBe(1);
	});

	it("empty registry has size 0 and all tiers at 0", () => {
		expect(registry.size).toBe(0);
		expect(registry.sizeByTier).toEqual({ antara: 0, bahya: 0, shiksha: 0 });
	});

	it("clear() empties all tiers", () => {
		registry.register(makeManifest("a"), "antara");
		registry.register(makeManifest("b"), "bahya");
		registry.register(makeManifest("c"), "shiksha");
		expect(registry.size).toBe(3);

		registry.clear();
		expect(registry.size).toBe(0);
		expect(registry.sizeByTier).toEqual({ antara: 0, bahya: 0, shiksha: 0 });
		expect(registry.get("a")).toBeNull();
		expect(registry.get("b")).toBeNull();
		expect(registry.get("c")).toBeNull();
	});

	it("clearTier() empties only the specified tier", () => {
		registry.register(makeManifest("a"), "antara");
		registry.register(makeManifest("b"), "bahya");
		registry.register(makeManifest("c"), "shiksha");

		registry.clearTier("bahya");
		expect(registry.sizeByTier.antara).toBe(1);
		expect(registry.sizeByTier.bahya).toBe(0);
		expect(registry.sizeByTier.shiksha).toBe(1);
		expect(registry.get("b")).toBeNull();
		expect(registry.get("a")).not.toBeNull();
	});

	it("clearTier for antara unmasks bahya skills", () => {
		registry.register(makeManifest("masked", { version: "A" }), "antara");
		registry.register(makeManifest("masked", { version: "B" }), "bahya");

		expect(registry.get("masked")!.kula).toBe("antara");

		registry.clearTier("antara");
		expect(registry.get("masked")!.kula).toBe("bahya");
		expect(registry.get("masked")!.manifest.version).toBe("B");
	});

	it("has() returns true if skill exists in any tier", () => {
		registry.register(makeManifest("exists"), "shiksha");
		expect(registry.has("exists")).toBe(true);
		expect(registry.has("nope")).toBe(false);
	});

	it("getAllFromTier() returns only skills from specified tier", () => {
		registry.register(makeManifest("a1"), "antara");
		registry.register(makeManifest("a2"), "antara");
		registry.register(makeManifest("b1"), "bahya");

		const antaraSkills = registry.getAllFromTier("antara");
		expect(antaraSkills).toHaveLength(2);
		const names = antaraSkills.map(s => s.name).sort();
		expect(names).toEqual(["a1", "a2"]);
	});
});
