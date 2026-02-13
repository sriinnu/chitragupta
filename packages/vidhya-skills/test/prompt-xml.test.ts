import { describe, it, expect } from "vitest";
import {
	skillToXml,
	generateSkillsXml,
	generateActivatedSkillXml,
} from "../src/prompt-xml.js";
import type { SkillManifest } from "../src/types.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillManifest> = {}): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill for unit testing.",
		author: "tester",
		body: "# Test Skill\n\nDo the thing.\n\n## Rules\n\n- Be good.",
		capabilities: [
			{ verb: "test", object: "things", description: "Tests things." },
		],
		tags: ["test", "unit", "demo"],
		source: { type: "manual", filePath: "test/SKILL.md" },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

// ─── skillToXml ─────────────────────────────────────────────────────────────

describe("skillToXml", () => {
	it("metadata tier includes name, description, tags, author", () => {
		const xml = skillToXml(makeSkill(), { tier: "metadata" });
		expect(xml).toContain('name="test-skill"');
		expect(xml).toContain("<description>A test skill for unit testing.</description>");
		expect(xml).toContain("<tags>test, unit, demo</tags>");
		expect(xml).toContain("<author>tester</author>");
		// Should NOT include instructions or capabilities
		expect(xml).not.toContain("<instructions>");
		expect(xml).not.toContain("<capabilities>");
	});

	it("instructions tier includes body", () => {
		const xml = skillToXml(makeSkill(), { tier: "instructions" });
		expect(xml).toContain("<instructions>");
		expect(xml).toContain("Do the thing.");
		expect(xml).toContain("</instructions>");
	});

	it("full tier includes capabilities and resources", () => {
		const xml = skillToXml(makeSkill(), {
			tier: "full",
			resources: ["scripts/run.sh", "references/GUIDE.md"],
		});
		expect(xml).toContain("<capabilities>");
		expect(xml).toContain('verb="test"');
		expect(xml).toContain('object="things"');
		expect(xml).toContain("<resources>");
		expect(xml).toContain("scripts/run.sh");
		expect(xml).toContain("references/GUIDE.md");
	});

	it("default tier is instructions", () => {
		const xml = skillToXml(makeSkill());
		expect(xml).toContain("<instructions>");
		expect(xml).not.toContain("<capabilities>"); // not full
	});

	it("escapes XML special characters", () => {
		const xml = skillToXml(makeSkill({
			name: "test-skill",
			description: 'Handles <scripts> & "quotes"',
		}), { tier: "metadata" });
		expect(xml).toContain("&lt;scripts&gt;");
		expect(xml).toContain("&amp;");
		expect(xml).toContain("&quot;quotes&quot;");
	});

	it("omits tags when includeTags is false", () => {
		const xml = skillToXml(makeSkill(), { tier: "metadata", includeTags: false });
		expect(xml).not.toContain("<tags>");
	});

	it("omits author when not present", () => {
		const xml = skillToXml(makeSkill({ author: undefined }), { tier: "metadata" });
		expect(xml).not.toContain("<author>");
	});

	it("includes anti-patterns when present", () => {
		const xml = skillToXml(makeSkill({ antiPatterns: ["Don't use for production"] }), { tier: "instructions" });
		expect(xml).toContain("<anti-patterns>");
		expect(xml).toContain("Don&apos;t use for production");
	});

	it("omits anti-patterns when empty", () => {
		const xml = skillToXml(makeSkill({ antiPatterns: [] }), { tier: "instructions" });
		expect(xml).not.toContain("<anti-patterns>");
	});

	it("omits body when not present", () => {
		const xml = skillToXml(makeSkill({ body: undefined }), { tier: "instructions" });
		expect(xml).not.toContain("<instructions>");
	});
});

// ─── generateSkillsXml ─────────────────────────────────────────────────────

describe("generateSkillsXml", () => {
	it("wraps skills in <available_skills> with count", () => {
		const skills = [makeSkill(), makeSkill({ name: "other-skill" })];
		const xml = generateSkillsXml(skills, { tier: "metadata" });
		expect(xml).toContain('<available_skills count="2">');
		expect(xml).toContain('name="test-skill"');
		expect(xml).toContain('name="other-skill"');
		expect(xml).toContain("</available_skills>");
	});

	it("returns empty string for empty array", () => {
		expect(generateSkillsXml([])).toBe("");
	});

	it("applies options to all skills", () => {
		const xml = generateSkillsXml([makeSkill()], { tier: "metadata" });
		expect(xml).not.toContain("<instructions>");
	});
});

// ─── generateActivatedSkillXml ──────────────────────────────────────────────

describe("generateActivatedSkillXml", () => {
	it("wraps in <activated_skill> with full context", () => {
		const xml = generateActivatedSkillXml(makeSkill(), ["scripts/run.sh"]);
		expect(xml).toContain('<activated_skill name="test-skill">');
		expect(xml).toContain("<instructions>");
		expect(xml).toContain("<capabilities>");
		expect(xml).toContain("<resources>");
		expect(xml).toContain("scripts/run.sh");
		expect(xml).toContain("</activated_skill>");
	});

	it("works without resources", () => {
		const xml = generateActivatedSkillXml(makeSkill());
		expect(xml).toContain('<activated_skill name="test-skill">');
		expect(xml).not.toContain("<resources>");
	});
});
