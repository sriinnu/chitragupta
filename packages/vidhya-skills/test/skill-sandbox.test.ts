import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	SkillSandbox,
	type SandboxConfig,
	type QuarantinedSkill,
	type SandboxValidationResult,
} from "../src/skill-sandbox.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSkill(o?: Partial<QuarantinedSkill["skill"]>): QuarantinedSkill["skill"] {
	return {
		name: "test-skill",
		description: "A valid test skill for testing purposes",
		tags: ["testing", "automation"],
		capabilities: ["read", "analyze"],
		...o,
	};
}

describe("SkillSandbox", () => {
	let sandbox: SkillSandbox;

	beforeEach(() => {
		sandbox = new SkillSandbox();
	});

	// ─── submit ──────────────────────────────────────────────────────────

	describe("submit", () => {
		it("returns a quarantine ID", () => {
			const id = sandbox.submit(makeSkill(), "new");
			expect(id).toMatch(/^qs_/);
		});

		it("stores the skill in quarantine", () => {
			const id = sandbox.submit(makeSkill(), "new");
			const entry = sandbox.get(id);
			expect(entry).toBeDefined();
			expect(entry!.skill.name).toBe("test-skill");
		});

		it("sets status to validated for valid skills", () => {
			const id = sandbox.submit(makeSkill(), "new");
			expect(sandbox.get(id)!.status).toBe("validated");
		});

		it("sets reason correctly", () => {
			const id1 = sandbox.submit(makeSkill(), "new");
			const id2 = sandbox.submit(makeSkill({ name: "evolved-skill" }), "evolved");
			const id3 = sandbox.submit(makeSkill({ name: "fused-skill" }), "fused");
			expect(sandbox.get(id1)!.reason).toBe("new");
			expect(sandbox.get(id2)!.reason).toBe("evolved");
			expect(sandbox.get(id3)!.reason).toBe("fused");
		});

		it("rejects skills with critical security violations", () => {
			const id = sandbox.submit(makeSkill({ content: "eval('malicious code')" }), "new");
			expect(sandbox.get(id)!.status).toBe("rejected");
		});

		it("rejects skills with disallowed capabilities", () => {
			const id = sandbox.submit(makeSkill({ capabilities: ["execute", "admin"] }), "new");
			expect(sandbox.get(id)!.status).toBe("rejected");
		});

		it("auto-promotes when autoPromote enabled and health score meets threshold", () => {
			const autoSandbox = new SkillSandbox({ autoPromote: true, minHealthScore: 0.6 });
			const id = autoSandbox.submit(makeSkill(), "new");
			expect(autoSandbox.get(id)!.status).toBe("approved");
		});

		it("does not auto-promote when autoPromote is false", () => {
			const id = sandbox.submit(makeSkill(), "new");
			expect(sandbox.get(id)!.status).toBe("validated");
		});

		it("throws when quarantine is full", () => {
			const smallSandbox = new SkillSandbox({ maxQuarantineSize: 2 });
			smallSandbox.submit(makeSkill({ name: "skill-a" }), "new");
			smallSandbox.submit(makeSkill({ name: "skill-b" }), "new");
			expect(() => smallSandbox.submit(makeSkill({ name: "skill-c" }), "new")).toThrow("Quarantine full");
		});

		it("generates unique IDs for each submission", () => {
			const id1 = sandbox.submit(makeSkill(), "new");
			const id2 = sandbox.submit(makeSkill({ name: "another-skill" }), "new");
			expect(id1).not.toBe(id2);
		});

		it("computes health score and stores it", () => {
			const id = sandbox.submit(makeSkill(), "new");
			const entry = sandbox.get(id)!;
			expect(entry.healthScore).toBeGreaterThan(0);
			expect(entry.healthScore).toBeLessThanOrEqual(1);
		});

		it("produces validation results", () => {
			const id = sandbox.submit(makeSkill(), "new");
			const entry = sandbox.get(id)!;
			expect(entry.validationResults.length).toBeGreaterThan(0);
		});
	});

	// ─── validation checks ───────────────────────────────────────────────

	describe("validation", () => {
		it("flags invalid skill names", () => {
			const id = sandbox.submit(makeSkill({ name: "Invalid Name!" }), "new");
			const entry = sandbox.get(id)!;
			const nameCheck = entry.validationResults.find((r) => r.check === "name_format");
			expect(nameCheck).toBeDefined();
			expect(nameCheck!.passed).toBe(false);
		});

		it("passes valid kebab-case names", () => {
			const id = sandbox.submit(makeSkill({ name: "my-valid-skill" }), "new");
			const entry = sandbox.get(id)!;
			const nameCheck = entry.validationResults.find((r) => r.check === "name_format");
			expect(nameCheck!.passed).toBe(true);
		});

		it("flags missing or short descriptions", () => {
			const id = sandbox.submit(makeSkill({ description: "short" }), "new");
			const entry = sandbox.get(id)!;
			const descCheck = entry.validationResults.find((r) => r.check === "description_present");
			expect(descCheck!.passed).toBe(false);
		});

		it("flags empty tags", () => {
			const id = sandbox.submit(makeSkill({ tags: [] }), "new");
			const entry = sandbox.get(id)!;
			const tagsCheck = entry.validationResults.find((r) => r.check === "tags_present");
			expect(tagsCheck!.passed).toBe(false);
		});

		it("checks content size", () => {
			const id = sandbox.submit(makeSkill({ content: "x".repeat(60000) }), "new");
			const entry = sandbox.get(id)!;
			const sizeCheck = entry.validationResults.find((r) => r.check === "content_size");
			expect(sizeCheck!.passed).toBe(false);
		});

		it("passes content under size limit", () => {
			const id = sandbox.submit(makeSkill({ content: "safe content" }), "new");
			const entry = sandbox.get(id)!;
			const sizeCheck = entry.validationResults.find((r) => r.check === "content_size");
			expect(sizeCheck!.passed).toBe(true);
		});

		it("detects blocked security patterns", () => {
			const patterns = [
				"eval('code')",
				"Function('return this')",
				"require('fs')",
				"import('module')",
				"child_process.exec",
				"execSync('cmd')",
				"spawn('sh')",
				"rm -rf /",
				"__proto__",
				"process.env.SECRET",
			];
			for (const content of patterns) {
				const id = sandbox.submit(makeSkill({ name: "test-skill", content }), "new");
				expect(sandbox.get(id)!.status).toBe("rejected");
			}
		});

		it("passes clean content", () => {
			const id = sandbox.submit(makeSkill({ content: "function add(a, b) { return a + b; }" }), "new");
			expect(sandbox.get(id)!.status).not.toBe("rejected");
		});

		it("supports custom blocked patterns", () => {
			const customSandbox = new SkillSandbox({
				blockedPatterns: [/FORBIDDEN/i],
			});
			const id = customSandbox.submit(makeSkill({ content: "something FORBIDDEN here" }), "new");
			expect(customSandbox.get(id)!.status).toBe("rejected");
		});

		it("validates capability whitelist", () => {
			const restrictedSandbox = new SkillSandbox({
				allowedCapabilities: ["read"],
			});
			const id = restrictedSandbox.submit(makeSkill({ capabilities: ["read", "write"] }), "new");
			const entry = restrictedSandbox.get(id)!;
			const capCheck = entry.validationResults.find((r) => r.check === "capability_whitelist");
			expect(capCheck!.passed).toBe(false);
		});

		it("skips capability check when skill has no capabilities", () => {
			const id = sandbox.submit(makeSkill({ capabilities: undefined }), "new");
			const entry = sandbox.get(id)!;
			const capCheck = entry.validationResults.find((r) => r.check === "capability_whitelist");
			expect(capCheck).toBeUndefined();
		});
	});

	// ─── health score ────────────────────────────────────────────────────

	describe("health score computation", () => {
		it("perfect score for fully valid skill", () => {
			const id = sandbox.submit(makeSkill(), "new");
			expect(sandbox.get(id)!.healthScore).toBe(1);
		});

		it("reduces score for warnings", () => {
			const id = sandbox.submit(makeSkill({ tags: [] }), "new");
			expect(sandbox.get(id)!.healthScore).toBeLessThan(1);
		});

		it("significantly reduces score for critical failures", () => {
			const id = sandbox.submit(makeSkill({ capabilities: ["dangerous"] }), "new");
			expect(sandbox.get(id)!.healthScore).toBeLessThanOrEqual(0.5);
		});

		it("never goes below 0", () => {
			const id = sandbox.submit(makeSkill({
				name: "BAD!!!",
				description: "",
				tags: [],
				capabilities: ["admin", "root"],
				content: "eval(require('child_process').execSync('rm -rf /'))",
			}), "new");
			expect(sandbox.get(id)!.healthScore).toBeGreaterThanOrEqual(0);
		});
	});

	// ─── approve ─────────────────────────────────────────────────────────

	describe("approve", () => {
		it("sets status to approved", () => {
			const id = sandbox.submit(makeSkill(), "new");
			const entry = sandbox.approve(id);
			expect(entry.status).toBe("approved");
		});

		it("throws for unknown entry", () => {
			expect(() => sandbox.approve("nonexistent")).toThrow("not found");
		});

		it("throws when approving a rejected skill", () => {
			const id = sandbox.submit(makeSkill({ content: "eval('x')" }), "new");
			expect(() => sandbox.approve(id)).toThrow("Cannot approve rejected");
		});
	});

	// ─── reject ──────────────────────────────────────────────────────────

	describe("reject", () => {
		it("sets status to rejected", () => {
			const id = sandbox.submit(makeSkill(), "new");
			sandbox.reject(id);
			expect(sandbox.get(id)!.status).toBe("rejected");
		});

		it("adds manual rejection reason to validation results", () => {
			const id = sandbox.submit(makeSkill(), "new");
			sandbox.reject(id, "Not useful");
			const entry = sandbox.get(id)!;
			const manualReject = entry.validationResults.find((r) => r.check === "manual_rejection");
			expect(manualReject).toBeDefined();
			expect(manualReject!.message).toBe("Not useful");
		});

		it("throws for unknown entry", () => {
			expect(() => sandbox.reject("nonexistent")).toThrow("not found");
		});

		it("does not add manual reason when not provided", () => {
			const id = sandbox.submit(makeSkill(), "new");
			const countBefore = sandbox.get(id)!.validationResults.length;
			sandbox.reject(id);
			expect(sandbox.get(id)!.validationResults.length).toBe(countBefore);
		});
	});

	// ─── drainApproved ───────────────────────────────────────────────────

	describe("drainApproved", () => {
		it("returns approved skills and removes them from quarantine", () => {
			const id1 = sandbox.submit(makeSkill(), "new");
			const id2 = sandbox.submit(makeSkill({ name: "another-skill" }), "new");
			sandbox.approve(id1);
			sandbox.approve(id2);

			const approved = sandbox.drainApproved();
			expect(approved).toHaveLength(2);
			expect(sandbox.get(id1)).toBeUndefined();
			expect(sandbox.get(id2)).toBeUndefined();
		});

		it("returns empty array when no approved skills", () => {
			sandbox.submit(makeSkill(), "new"); // validated, not approved
			expect(sandbox.drainApproved()).toHaveLength(0);
		});

		it("leaves non-approved skills in quarantine", () => {
			const id1 = sandbox.submit(makeSkill(), "new");
			const id2 = sandbox.submit(makeSkill({ name: "another-skill" }), "new");
			sandbox.approve(id1);
			sandbox.drainApproved();
			expect(sandbox.get(id2)).toBeDefined();
		});
	});

	// ─── getStats ────────────────────────────────────────────────────────

	describe("getStats", () => {
		it("returns zero counts for empty sandbox", () => {
			const stats = sandbox.getStats();
			expect(stats).toEqual({ total: 0, pending: 0, validated: 0, approved: 0, rejected: 0, expired: 0 });
		});

		it("counts entries by status", () => {
			sandbox.submit(makeSkill(), "new"); // validated
			sandbox.submit(makeSkill({ name: "bad-skill", content: "eval('x')" }), "new"); // rejected
			const id3 = sandbox.submit(makeSkill({ name: "approve-me" }), "new"); // will approve
			sandbox.approve(id3);

			const stats = sandbox.getStats();
			expect(stats.total).toBe(3);
			expect(stats.validated).toBe(1);
			expect(stats.rejected).toBe(1);
			expect(stats.approved).toBe(1);
		});
	});

	// ─── list ────────────────────────────────────────────────────────────

	describe("list", () => {
		it("returns all quarantined skills", () => {
			sandbox.submit(makeSkill(), "new");
			sandbox.submit(makeSkill({ name: "another-skill" }), "new");
			expect(sandbox.list()).toHaveLength(2);
		});

		it("returns empty array for empty sandbox", () => {
			expect(sandbox.list()).toHaveLength(0);
		});
	});

	// ─── get ─────────────────────────────────────────────────────────────

	describe("get", () => {
		it("returns entry by ID", () => {
			const id = sandbox.submit(makeSkill(), "new");
			expect(sandbox.get(id)).toBeDefined();
		});

		it("returns undefined for unknown ID", () => {
			expect(sandbox.get("nonexistent")).toBeUndefined();
		});
	});

	// ─── expireStale ─────────────────────────────────────────────────────

	describe("stale expiration", () => {
		it("expires stale entries when submit is called", () => {
			const fastSandbox = new SkillSandbox({ quarantineTimeoutMs: 1 });
			const id = fastSandbox.submit(makeSkill(), "new");

			// The entry might still be there since submit calls expireStale before adding
			// Trigger a second submit after a brief wait
			const originalDateNow = Date.now;
			Date.now = () => originalDateNow() + 100;
			try {
				fastSandbox.submit(makeSkill({ name: "trigger-expiry" }), "new");
				// The first entry should now be expired and removed
				expect(fastSandbox.get(id)).toBeUndefined();
			} finally {
				Date.now = originalDateNow;
			}
		});

		it("does not expire approved entries", () => {
			const fastSandbox = new SkillSandbox({ quarantineTimeoutMs: 1 });
			const id = fastSandbox.submit(makeSkill(), "new");
			fastSandbox.approve(id);

			const originalDateNow = Date.now;
			Date.now = () => originalDateNow() + 100;
			try {
				fastSandbox.submit(makeSkill({ name: "trigger-expiry" }), "new");
				expect(fastSandbox.get(id)).toBeDefined();
			} finally {
				Date.now = originalDateNow;
			}
		});

		it("does not expire rejected entries", () => {
			const fastSandbox = new SkillSandbox({ quarantineTimeoutMs: 1 });
			const id = fastSandbox.submit(makeSkill({ content: "eval('x')" }), "new");
			// Already rejected by validation

			const originalDateNow = Date.now;
			Date.now = () => originalDateNow() + 100;
			try {
				fastSandbox.submit(makeSkill({ name: "trigger-expiry" }), "new");
				expect(fastSandbox.get(id)).toBeDefined();
			} finally {
				Date.now = originalDateNow;
			}
		});
	});

	// ─── config defaults ─────────────────────────────────────────────────

	describe("configuration", () => {
		it("uses default config values", () => {
			const defaultSandbox = new SkillSandbox();
			// Just verify it works with defaults
			const id = defaultSandbox.submit(makeSkill(), "new");
			expect(defaultSandbox.get(id)).toBeDefined();
		});

		it("respects custom maxQuarantineSize", () => {
			const tinySandbox = new SkillSandbox({ maxQuarantineSize: 1 });
			tinySandbox.submit(makeSkill(), "new");
			expect(() => tinySandbox.submit(makeSkill({ name: "overflow" }), "new")).toThrow("Quarantine full");
		});

		it("respects custom minHealthScore for auto-promote", () => {
			const strictSandbox = new SkillSandbox({ autoPromote: true, minHealthScore: 1.0 });
			// A skill with empty tags gets a warning, so health < 1.0
			const id = strictSandbox.submit(makeSkill({ tags: [] }), "new");
			expect(strictSandbox.get(id)!.status).toBe("validated"); // not auto-promoted
		});
	});
});
