import { describe, it, expect, beforeEach } from "vitest";
import { SoulManager, ARCHETYPES } from "../src/agent-soul.js";
import type { AgentSoul, AgentArchetype } from "../src/agent-soul.js";

describe("SoulManager", () => {
	let manager: SoulManager;

	beforeEach(() => {
		manager = new SoulManager();
	});

	// ─── ARCHETYPES constant ────────────────────────────────────────

	describe("ARCHETYPES", () => {
		it("should define exactly 5 predefined archetypes", () => {
			expect(Object.keys(ARCHETYPES)).toHaveLength(5);
		});

		it("should include all expected archetype IDs", () => {
			const ids = Object.keys(ARCHETYPES);
			expect(ids).toContain("meticulous-craftsman");
			expect(ids).toContain("curious-scholar");
			expect(ids).toContain("vigilant-guardian");
			expect(ids).toContain("creative-explorer");
			expect(ids).toContain("wise-mediator");
		});

		it("should have valid temperature biases for all archetypes", () => {
			for (const archetype of Object.values(ARCHETYPES)) {
				expect(archetype.temperatureBias).toBeGreaterThanOrEqual(-1);
				expect(archetype.temperatureBias).toBeLessThanOrEqual(1);
			}
		});

		it("should have non-empty traits for all archetypes", () => {
			for (const archetype of Object.values(ARCHETYPES)) {
				expect(archetype.traits.length).toBeGreaterThan(0);
				expect(archetype.strengths.length).toBeGreaterThan(0);
				expect(archetype.weaknesses.length).toBeGreaterThan(0);
			}
		});
	});

	// ─── create() ───────────────────────────────────────────────────

	describe("create()", () => {
		it("should create a soul with the specified archetype", () => {
			const soul = manager.create({
				id: "agent-1",
				name: "Coder",
				archetype: "meticulous-craftsman",
				purpose: "write code",
			});

			expect(soul.id).toBe("agent-1");
			expect(soul.name).toBe("Coder");
			expect(soul.archetype.id).toBe("meticulous-craftsman");
			expect(soul.purpose).toBe("write code");
		});

		it("should default to curious-scholar when no archetype is specified", () => {
			const soul = manager.create({
				id: "agent-2",
				name: "Default",
				purpose: "do things",
			});

			expect(soul.archetype.id).toBe("curious-scholar");
		});

		it("should fallback to curious-scholar for unknown archetype ID", () => {
			const soul = manager.create({
				id: "agent-3",
				name: "Unknown",
				archetype: "nonexistent-archetype",
				purpose: "test",
			});

			expect(soul.archetype.id).toBe("curious-scholar");
		});

		it("should initialize with empty learnedTraits, values, and confidenceModel", () => {
			const soul = manager.create({
				id: "agent-4",
				name: "Fresh",
				purpose: "testing",
			});

			expect(soul.learnedTraits).toEqual([]);
			expect(soul.values).toEqual([]);
			expect(soul.confidenceModel.size).toBe(0);
		});

		it("should set createdAt and lastActiveAt to current time", () => {
			const before = Date.now();
			const soul = manager.create({
				id: "agent-5",
				name: "Timer",
				purpose: "timing",
			});
			const after = Date.now();

			expect(soul.createdAt).toBeGreaterThanOrEqual(before);
			expect(soul.createdAt).toBeLessThanOrEqual(after);
			expect(soul.lastActiveAt).toBeGreaterThanOrEqual(before);
			expect(soul.lastActiveAt).toBeLessThanOrEqual(after);
		});

		it("should store the soul and allow retrieval via get()", () => {
			const soul = manager.create({
				id: "agent-6",
				name: "Stored",
				purpose: "testing storage",
			});

			expect(manager.get("agent-6")).toBe(soul);
		});
	});

	// ─── get() ──────────────────────────────────────────────────────

	describe("get()", () => {
		it("should return undefined for unknown agent ID", () => {
			expect(manager.get("nonexistent")).toBeUndefined();
		});
	});

	// ─── updateConfidence() ─────────────────────────────────────────

	describe("updateConfidence()", () => {
		it("should set initial confidence from 0.5 baseline on success", () => {
			manager.create({ id: "a1", name: "A", purpose: "test" });
			manager.updateConfidence("a1", "coding", true);

			const soul = manager.get("a1")!;
			// EMA: 0.5 + 0.15 * (1 - 0.5) = 0.575
			expect(soul.confidenceModel.get("coding")).toBeCloseTo(0.575, 5);
		});

		it("should decrease confidence on failure", () => {
			manager.create({ id: "a2", name: "B", purpose: "test" });
			manager.updateConfidence("a2", "coding", false);

			const soul = manager.get("a2")!;
			// EMA: 0.5 + 0.15 * (0 - 0.5) = 0.425
			expect(soul.confidenceModel.get("coding")).toBeCloseTo(0.425, 5);
		});

		it("should evolve confidence through multiple updates", () => {
			manager.create({ id: "a3", name: "C", purpose: "test" });

			// Three successes
			manager.updateConfidence("a3", "testing", true);
			manager.updateConfidence("a3", "testing", true);
			manager.updateConfidence("a3", "testing", true);

			const soul = manager.get("a3")!;
			const c = soul.confidenceModel.get("testing")!;
			// Should be higher than baseline 0.5 after three successes
			expect(c).toBeGreaterThan(0.5);
			// But less than 1 (converges gradually)
			expect(c).toBeLessThan(1);
		});

		it("should clamp confidence between 0 and 1", () => {
			manager.create({ id: "a4", name: "D", purpose: "test" });

			// Many failures to push toward 0
			for (let i = 0; i < 50; i++) {
				manager.updateConfidence("a4", "domain", false);
			}

			const soul = manager.get("a4")!;
			const val = soul.confidenceModel.get("domain")!;
			expect(val).toBeGreaterThanOrEqual(0);
			expect(val).toBeLessThanOrEqual(1);
		});

		it("should be a no-op for unknown agent ID", () => {
			// Should not throw
			manager.updateConfidence("nonexistent", "domain", true);
		});

		it("should update lastActiveAt on confidence change", () => {
			manager.create({ id: "a5", name: "E", purpose: "test" });
			const before = Date.now();
			manager.updateConfidence("a5", "domain", true);

			const soul = manager.get("a5")!;
			expect(soul.lastActiveAt).toBeGreaterThanOrEqual(before);
		});
	});

	// ─── addTrait() ─────────────────────────────────────────────────

	describe("addTrait()", () => {
		it("should add a learned trait", () => {
			manager.create({ id: "t1", name: "T", purpose: "test" });
			manager.addTrait("t1", "fast-learner");

			const soul = manager.get("t1")!;
			expect(soul.learnedTraits).toContain("fast-learner");
		});

		it("should deduplicate traits", () => {
			manager.create({ id: "t2", name: "T", purpose: "test" });
			manager.addTrait("t2", "persistent");
			manager.addTrait("t2", "persistent");

			const soul = manager.get("t2")!;
			expect(soul.learnedTraits.filter((t) => t === "persistent")).toHaveLength(1);
		});

		it("should be a no-op for unknown agent ID", () => {
			// Should not throw
			manager.addTrait("nonexistent", "something");
		});
	});

	// ─── addValue() ─────────────────────────────────────────────────

	describe("addValue()", () => {
		it("should add a core value", () => {
			manager.create({ id: "v1", name: "V", purpose: "test" });
			manager.addValue("v1", "quality");

			const soul = manager.get("v1")!;
			expect(soul.values).toContain("quality");
		});

		it("should deduplicate values", () => {
			manager.create({ id: "v2", name: "V", purpose: "test" });
			manager.addValue("v2", "simplicity");
			manager.addValue("v2", "simplicity");

			const soul = manager.get("v2")!;
			expect(soul.values.filter((v) => v === "simplicity")).toHaveLength(1);
		});
	});

	// ─── getEffectiveTemperature() ──────────────────────────────────

	describe("getEffectiveTemperature()", () => {
		it("should apply archetype temperature bias", () => {
			manager.create({
				id: "temp1",
				name: "Meticulous",
				archetype: "meticulous-craftsman",
				purpose: "test",
			});

			// meticulous-craftsman has temperatureBias of -0.15
			const effective = manager.getEffectiveTemperature("temp1", 0.7);
			expect(effective).toBeCloseTo(0.55, 5);
		});

		it("should clamp to minimum 0", () => {
			manager.create({
				id: "temp2",
				name: "Meticulous",
				archetype: "meticulous-craftsman",
				purpose: "test",
			});

			// -0.15 bias + base 0.1 = -0.05, clamped to 0
			const effective = manager.getEffectiveTemperature("temp2", 0.1);
			expect(effective).toBe(0);
		});

		it("should clamp to maximum 2", () => {
			manager.create({
				id: "temp3",
				name: "Creative",
				archetype: "creative-explorer",
				purpose: "test",
			});

			// +0.2 bias + base 1.9 = 2.1, clamped to 2
			const effective = manager.getEffectiveTemperature("temp3", 1.9);
			expect(effective).toBe(2);
		});

		it("should return base temperature for unknown agent", () => {
			expect(manager.getEffectiveTemperature("nonexistent", 0.8)).toBe(0.8);
		});
	});

	// ─── buildSoulPrompt() ──────────────────────────────────────────

	describe("buildSoulPrompt()", () => {
		it("should return empty string for unknown agent", () => {
			expect(manager.buildSoulPrompt("nonexistent")).toBe("");
		});

		it("should include agent name, archetype, and purpose", () => {
			manager.create({
				id: "p1",
				name: "Scholar",
				archetype: "curious-scholar",
				purpose: "research topics",
			});

			const prompt = manager.buildSoulPrompt("p1");
			expect(prompt).toContain("Scholar");
			expect(prompt).toContain("Curious Scholar");
			expect(prompt).toContain("research topics");
		});

		it("should include archetype traits and strengths", () => {
			manager.create({
				id: "p2",
				name: "Guard",
				archetype: "vigilant-guardian",
				purpose: "security review",
			});

			const prompt = manager.buildSoulPrompt("p2");
			expect(prompt).toContain("cautious");
			expect(prompt).toContain("security");
		});

		it("should include learned traits in the traits line", () => {
			manager.create({
				id: "p3",
				name: "Learner",
				purpose: "learning",
			});
			manager.addTrait("p3", "quick-adapter");

			const prompt = manager.buildSoulPrompt("p3");
			expect(prompt).toContain("quick-adapter");
		});

		it("should include values when present", () => {
			manager.create({
				id: "p4",
				name: "Valued",
				purpose: "testing",
			});
			manager.addValue("p4", "reliability");

			const prompt = manager.buildSoulPrompt("p4");
			expect(prompt).toContain("reliability");
		});

		it("should surface high confidence domains", () => {
			manager.create({
				id: "p5",
				name: "Confident",
				purpose: "testing",
			});

			// Manually set high confidence
			const soul = manager.get("p5")!;
			soul.confidenceModel.set("coding", 0.9);

			const prompt = manager.buildSoulPrompt("p5");
			expect(prompt).toContain("High confidence in:");
			expect(prompt).toContain("coding");
		});

		it("should surface low confidence domains as still learning", () => {
			manager.create({
				id: "p6",
				name: "Learner",
				purpose: "testing",
			});

			const soul = manager.get("p6")!;
			soul.confidenceModel.set("security", 0.2);

			const prompt = manager.buildSoulPrompt("p6");
			expect(prompt).toContain("Still learning:");
			expect(prompt).toContain("security");
		});
	});

	// ─── serialize() / deserialize() ────────────────────────────────

	describe("serialize/deserialize", () => {
		it("should round-trip souls through serialization", () => {
			manager.create({
				id: "s1",
				name: "Serialize Me",
				archetype: "creative-explorer",
				purpose: "test serialization",
			});
			manager.addTrait("s1", "learned-trait");
			manager.addValue("s1", "test-value");
			manager.updateConfidence("s1", "coding", true);

			const json = manager.serialize();
			const restored = new SoulManager();
			restored.deserialize(json);

			const original = manager.get("s1")!;
			const copy = restored.get("s1")!;

			expect(copy.id).toBe(original.id);
			expect(copy.name).toBe(original.name);
			expect(copy.archetype.id).toBe(original.archetype.id);
			expect(copy.purpose).toBe(original.purpose);
			expect(copy.learnedTraits).toEqual(original.learnedTraits);
			expect(copy.values).toEqual(original.values);
			expect(copy.confidenceModel.get("coding")).toBeCloseTo(
				original.confidenceModel.get("coding")!,
				5,
			);
		});

		it("should handle multiple souls in serialization", () => {
			manager.create({ id: "m1", name: "One", purpose: "first" });
			manager.create({ id: "m2", name: "Two", purpose: "second" });

			const json = manager.serialize();
			const restored = new SoulManager();
			restored.deserialize(json);

			expect(restored.getAll()).toHaveLength(2);
			expect(restored.get("m1")!.name).toBe("One");
			expect(restored.get("m2")!.name).toBe("Two");
		});

		it("should handle empty confidenceModel in deserialization", () => {
			manager.create({ id: "e1", name: "Empty", purpose: "no confidence" });

			const json = manager.serialize();
			const restored = new SoulManager();
			restored.deserialize(json);

			const soul = restored.get("e1")!;
			expect(soul.confidenceModel).toBeInstanceOf(Map);
			expect(soul.confidenceModel.size).toBe(0);
		});
	});

	// ─── remove() ───────────────────────────────────────────────────

	describe("remove()", () => {
		it("should remove an existing soul and return true", () => {
			manager.create({ id: "r1", name: "Remove Me", purpose: "removal" });
			expect(manager.remove("r1")).toBe(true);
			expect(manager.get("r1")).toBeUndefined();
		});

		it("should return false for unknown agent ID", () => {
			expect(manager.remove("nonexistent")).toBe(false);
		});
	});

	// ─── getAll() ───────────────────────────────────────────────────

	describe("getAll()", () => {
		it("should return empty array when no souls exist", () => {
			expect(manager.getAll()).toEqual([]);
		});

		it("should return all created souls", () => {
			manager.create({ id: "g1", name: "One", purpose: "first" });
			manager.create({ id: "g2", name: "Two", purpose: "second" });
			manager.create({ id: "g3", name: "Three", purpose: "third" });

			expect(manager.getAll()).toHaveLength(3);
		});
	});
});
