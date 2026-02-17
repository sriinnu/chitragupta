import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PratikshaManager } from "../src/pratiksha.js";
import type { QuarantinedSkill } from "../src/skill-sandbox.js";
import type { SurakshaScanResult } from "../src/suraksha.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(id: string, name?: string): QuarantinedSkill {
	return {
		id,
		skill: {
			name: name ?? "test-skill",
			description: "A test skill",
			tags: ["test"],
			content: "---\nname: test-skill\nversion: 1.0.0\n---\n# Test Skill\nA test",
		},
		reason: "external",
		enteredAt: Date.now(),
		validationResults: [],
		healthScore: 0.8,
		status: "validated",
	};
}

function makeScanResult(name: string): SurakshaScanResult {
	return {
		skillName: name,
		verdict: "clean",
		findings: [],
		riskScore: 0,
		scanDurationMs: 1,
		contentHash: 12345,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PratikshaManager", () => {
	let tempDir: string;
	let mgr: PratikshaManager;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratiksha-test-"));
		mgr = new PratikshaManager({ baseDir: tempDir });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ─── stage ────────────────────────────────────────────────────────

	describe("stage", () => {
		it("creates staging directory", async () => {
			const entry = makeEntry("skill_001");
			await mgr.stage(entry);
			const stagingPath = path.join(tempDir, "staging", "skill_001");
			expect(fs.existsSync(stagingPath)).toBe(true);
			expect(fs.statSync(stagingPath).isDirectory()).toBe(true);
		});

		it("writes manifest.json", async () => {
			const entry = makeEntry("skill_002");
			await mgr.stage(entry);
			const manifestPath = path.join(tempDir, "staging", "skill_002", "manifest.json");
			expect(fs.existsSync(manifestPath)).toBe(true);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			expect(manifest.quarantineId).toBe("skill_002");
			expect(manifest.skillName).toBe("test-skill");
			expect(manifest.status).toBe("validated");
			expect(manifest.healthScore).toBe(0.8);
		});

		it("writes skill.md", async () => {
			const entry = makeEntry("skill_003");
			await mgr.stage(entry);
			const skillPath = path.join(tempDir, "staging", "skill_003", "skill.md");
			expect(fs.existsSync(skillPath)).toBe(true);
			const content = fs.readFileSync(skillPath, "utf-8");
			expect(content).toContain("# Test Skill");
		});

		it("writes scan-report.json when provided", async () => {
			const entry = makeEntry("skill_004");
			const scan = makeScanResult("test-skill");
			await mgr.stage(entry, scan);
			const reportPath = path.join(tempDir, "staging", "skill_004", "scan-report.json");
			expect(fs.existsSync(reportPath)).toBe(true);
			const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
			expect(report.verdict).toBe("clean");
			expect(report.riskScore).toBe(0);
		});

		it("validates quarantine ID format — rejects '../bad'", async () => {
			const entry = makeEntry("../bad");
			await expect(mgr.stage(entry)).rejects.toThrow("Invalid quarantine ID");
		});

		it("rejects invalid IDs with uppercase", async () => {
			const entry = makeEntry("INVALID");
			await expect(mgr.stage(entry)).rejects.toThrow("Invalid quarantine ID");
		});
	});

	// ─── promote ──────────────────────────────────────────────────────

	describe("promote", () => {
		it("moves skill from staging to approved", async () => {
			const entry = makeEntry("promo_001");
			await mgr.stage(entry);
			await mgr.promote("promo_001");

			const stagingPath = path.join(tempDir, "staging", "promo_001");
			expect(fs.existsSync(stagingPath)).toBe(false);

			const approvedPath = path.join(tempDir, "approved", "test-skill");
			expect(fs.existsSync(approvedPath)).toBe(true);
		});

		it("creates approved/<skill-name> dir", async () => {
			const entry = makeEntry("promo_002", "my-cool-skill");
			await mgr.stage(entry);
			await mgr.promote("promo_002");

			const approvedPath = path.join(tempDir, "approved", "my-cool-skill");
			expect(fs.existsSync(approvedPath)).toBe(true);
			expect(fs.statSync(approvedPath).isDirectory()).toBe(true);
		});

		it("updates manifest status to 'approved'", async () => {
			const entry = makeEntry("promo_003");
			await mgr.stage(entry);
			await mgr.promote("promo_003");

			const manifestPath = path.join(tempDir, "approved", "test-skill", "manifest.json");
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			expect(manifest.status).toBe("approved");
			expect(manifest.approvedAt).toBeDefined();
		});

		it("removes staging dir after promotion", async () => {
			const entry = makeEntry("promo_004");
			await mgr.stage(entry);
			await mgr.promote("promo_004");

			const stagingPath = path.join(tempDir, "staging", "promo_004");
			expect(fs.existsSync(stagingPath)).toBe(false);
		});

		it("throws if not found", async () => {
			await expect(mgr.promote("nonexistent")).rejects.toThrow();
		});
	});

	// ─── reject ───────────────────────────────────────────────────────

	describe("reject", () => {
		it("moves skill from staging to archived", async () => {
			const entry = makeEntry("reject_001");
			await mgr.stage(entry);
			await mgr.reject("reject_001", "Too risky");

			const stagingPath = path.join(tempDir, "staging", "reject_001");
			expect(fs.existsSync(stagingPath)).toBe(false);

			const archivedPath = path.join(tempDir, "archived", "reject_001");
			expect(fs.existsSync(archivedPath)).toBe(true);
		});

		it("writes rejection-reason.txt", async () => {
			const entry = makeEntry("reject_002");
			await mgr.stage(entry);
			await mgr.reject("reject_002", "Contains network calls");

			const reasonPath = path.join(tempDir, "archived", "reject_002", "rejection-reason.txt");
			expect(fs.existsSync(reasonPath)).toBe(true);
			const reason = fs.readFileSync(reasonPath, "utf-8");
			expect(reason).toBe("Contains network calls");
		});

		it("updates manifest with rejection reason", async () => {
			const entry = makeEntry("reject_003");
			await mgr.stage(entry);
			await mgr.reject("reject_003", "Suspicious patterns");

			const manifestPath = path.join(tempDir, "archived", "reject_003", "manifest.json");
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			expect(manifest.status).toBe("rejected");
			expect(manifest.rejectionReason).toBe("Suspicious patterns");
			expect(manifest.archivedAt).toBeDefined();
		});

		it("removes staging dir after rejection", async () => {
			const entry = makeEntry("reject_004");
			await mgr.stage(entry);
			await mgr.reject("reject_004", "Bad skill");

			const stagingPath = path.join(tempDir, "staging", "reject_004");
			expect(fs.existsSync(stagingPath)).toBe(false);
		});

		it("throws if not found", async () => {
			await expect(mgr.reject("nonexistent", "reason")).rejects.toThrow();
		});
	});

	// ─── delete ───────────────────────────────────────────────────────

	describe("delete", () => {
		it("removes staging dir permanently", async () => {
			const entry = makeEntry("del_001");
			await mgr.stage(entry);

			const stagingPath = path.join(tempDir, "staging", "del_001");
			expect(fs.existsSync(stagingPath)).toBe(true);

			await mgr.delete("del_001");
			expect(fs.existsSync(stagingPath)).toBe(false);
		});

		it("throws if not found", async () => {
			await expect(mgr.delete("nonexistent")).rejects.toThrow();
		});
	});

	// ─── listStaged ─────────────────────────────────────────────────

	describe("listStaged", () => {
		it("returns empty for fresh instance", async () => {
			const result = await mgr.listStaged();
			expect(result).toEqual([]);
		});

		it("returns staged entries", async () => {
			await mgr.stage(makeEntry("list_001", "alpha"));
			await mgr.stage(makeEntry("list_002", "beta"));

			const result = await mgr.listStaged();
			expect(result).toHaveLength(2);

			const ids = result.map((r) => r.quarantineId).sort();
			expect(ids).toEqual(["list_001", "list_002"]);
		});

		it("includes correct fields", async () => {
			await mgr.stage(makeEntry("list_003", "gamma"));

			const result = await mgr.listStaged();
			expect(result).toHaveLength(1);

			const entry = result[0];
			expect(entry.quarantineId).toBe("list_003");
			expect(entry.skillName).toBe("gamma");
			expect(entry.reason).toBe("external");
			expect(entry.status).toBe("validated");
			expect(entry.healthScore).toBe(0.8);
			expect(entry.stagedAt).toBeDefined();
			expect(entry.path).toContain("list_003");
		});
	});

	// ─── listApproved ───────────────────────────────────────────────

	describe("listApproved", () => {
		it("returns empty initially", async () => {
			const result = await mgr.listApproved();
			expect(result).toEqual([]);
		});

		it("returns approved after promote", async () => {
			await mgr.stage(makeEntry("app_001", "approved-skill"));
			await mgr.promote("app_001");

			const result = await mgr.listApproved();
			expect(result).toHaveLength(1);
			expect(result[0].skillName).toBe("approved-skill");
		});

		it("includes correct fields", async () => {
			await mgr.stage(makeEntry("app_002", "another-skill"));
			await mgr.promote("app_002");

			const result = await mgr.listApproved();
			expect(result).toHaveLength(1);

			const entry = result[0];
			expect(entry.skillName).toBe("another-skill");
			expect(entry.approvedAt).toBeDefined();
			expect(entry.path).toContain("another-skill");
		});
	});

	// ─── listArchived ───────────────────────────────────────────────

	describe("listArchived", () => {
		it("returns archived after reject", async () => {
			await mgr.stage(makeEntry("arch_001", "bad-skill"));
			await mgr.reject("arch_001", "Security concern");

			const result = await mgr.listArchived();
			expect(result).toHaveLength(1);
			expect(result[0].skillName).toBe("bad-skill");
		});

		it("includes rejection reason", async () => {
			await mgr.stage(makeEntry("arch_002", "another-bad"));
			await mgr.reject("arch_002", "Contains eval()");

			const result = await mgr.listArchived();
			expect(result).toHaveLength(1);
			expect(result[0].rejectionReason).toBe("Contains eval()");
			expect(result[0].archivedAt).toBeDefined();
			expect(result[0].quarantineId).toBe("arch_002");
		});
	});

	// ─── cleanExpired ───────────────────────────────────────────────

	describe("cleanExpired", () => {
		it("removes entries older than expiration", async () => {
			const shortMgr = new PratikshaManager({ baseDir: tempDir, expirationMs: 100 });

			await shortMgr.stage(makeEntry("exp_001"));

			// Wait for expiration
			await new Promise((resolve) => setTimeout(resolve, 150));

			const count = await shortMgr.cleanExpired();
			expect(count).toBe(1);

			const staged = await shortMgr.listStaged();
			expect(staged).toHaveLength(0);
		});

		it("keeps fresh entries", async () => {
			const shortMgr = new PratikshaManager({ baseDir: tempDir, expirationMs: 10_000 });

			await shortMgr.stage(makeEntry("exp_002"));

			const count = await shortMgr.cleanExpired();
			expect(count).toBe(0);

			const staged = await shortMgr.listStaged();
			expect(staged).toHaveLength(1);
		});

		it("returns count of cleaned entries", async () => {
			const shortMgr = new PratikshaManager({ baseDir: tempDir, expirationMs: 100 });

			await shortMgr.stage(makeEntry("exp_003"));
			await shortMgr.stage(makeEntry("exp_004"));

			await new Promise((resolve) => setTimeout(resolve, 150));

			const count = await shortMgr.cleanExpired();
			expect(count).toBe(2);
		});
	});

	// ─── evolution state ────────────────────────────────────────────

	describe("evolution state", () => {
		it("saveEvolutionState writes file", async () => {
			const state = {
				skills: [["test", { usageCount: 5, lastUsed: Date.now(), health: 1 }]] as Array<[string, unknown]>,
				coOccurrences: [] as Array<[string, Array<[string, number]>]>,
				sessionSkills: [["test"]],
			};

			await mgr.saveEvolutionState(state as never);

			const filePath = path.join(tempDir, "evolution.json");
			expect(fs.existsSync(filePath)).toBe(true);

			const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			expect(raw.skills).toBeDefined();
			expect(raw.sessionSkills).toBeDefined();
		});

		it("loadEvolutionState reads it back", async () => {
			const state = {
				skills: [["alpha", { usageCount: 3, lastUsed: Date.now(), health: 0.9 }]] as Array<[string, unknown]>,
				coOccurrences: [["alpha", [["beta", 2]]]] as Array<[string, Array<[string, number]>]>,
				sessionSkills: [["alpha", "beta"]],
			};

			await mgr.saveEvolutionState(state as never);
			const loaded = await mgr.loadEvolutionState();

			expect(loaded).not.toBeNull();
			expect(loaded!.skills).toHaveLength(1);
			expect(loaded!.skills[0][0]).toBe("alpha");
			expect(loaded!.sessionSkills).toEqual([["alpha", "beta"]]);
		});

		it("loadEvolutionState returns null when no file", async () => {
			const loaded = await mgr.loadEvolutionState();
			expect(loaded).toBeNull();
		});
	});

	// ─── path traversal ─────────────────────────────────────────────

	describe("path traversal", () => {
		it("rejects IDs with '..'", async () => {
			const entry = makeEntry("..%2f..%2fetc");
			await expect(mgr.stage(entry)).rejects.toThrow("Invalid quarantine ID");
		});

		it("rejects IDs with '/'", async () => {
			const entry = makeEntry("foo/bar");
			await expect(mgr.stage(entry)).rejects.toThrow("Invalid quarantine ID");
		});

		it("rejects IDs with spaces", async () => {
			const entry = makeEntry("has space");
			await expect(mgr.stage(entry)).rejects.toThrow("Invalid quarantine ID");
		});
	});
});
