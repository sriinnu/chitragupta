import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { VidyaOrchestrator } from "../src/vidya-orchestrator.js";
import type { VidyaPersistedState, SkillReport, EcosystemStats } from "../src/vidya-orchestrator.js";
import { SkillRegistry } from "../src/registry.js";
import { VidyaBridge } from "../src/bridge.js";
import type { SkillManifest } from "../src/types.js";
import type { EnhancedSkillManifest, KulaType } from "../src/types-v2.js";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(name: string, overrides?: Partial<SkillManifest>): SkillManifest {
	return {
		name,
		version: "1.0.0",
		description: `Test skill: ${name}`,
		capabilities: [{ verb: "test", object: name, description: `Tests ${name}` }],
		tags: ["test"],
		source: { type: "tool", toolName: name },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeOrchestrator(opts?: {
	skills?: SkillManifest[];
	persistPath?: string;
	shiksha?: { learn: ReturnType<typeof vi.fn> };
	scanner?: { scanContent: ReturnType<typeof vi.fn> };
}) {
	const registry = new SkillRegistry();
	const bridge = new VidyaBridge(registry);

	for (const skill of opts?.skills ?? []) {
		registry.register(skill);
	}

	return new VidyaOrchestrator(
		{
			registry,
			bridge,
			scanner: opts?.scanner as any,
			shiksha: opts?.shiksha as any,
		},
		{
			persistPath: opts?.persistPath,
			enableAutoComposition: true,
		},
	);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("VidyaOrchestrator", () => {
	describe("constructor", () => {
		it("creates owned subsystems", () => {
			const orch = makeOrchestrator();
			expect(orch.kula).toBeDefined();
			expect(orch.ashrama).toBeDefined();
			expect(orch.samskara).toBeDefined();
			expect(orch.yoga).toBeDefined();
			expect(orch.vamsha).toBeDefined();
			expect(orch.evolution).toBeDefined();
			expect(orch.isInitialized).toBe(false);
		});
	});

	describe("initialize", () => {
		it("loads skills into KulaRegistry and creates Ashrama states", async () => {
			const skills = [makeManifest("read"), makeManifest("write"), makeManifest("search")];
			const orch = makeOrchestrator({ skills });

			const result = await orch.initialize();

			expect(result.loaded).toBe(3);
			expect(result.errors).toHaveLength(0);
			expect(result.restored).toBe(false);
			expect(orch.isInitialized).toBe(true);

			// All skills should have Ashrama states
			for (const skill of skills) {
				const state = orch.getAshramamState(skill.name);
				expect(state).toBeDefined();
				// antara kula → start as grihastha
				expect(state!.stage).toBe("grihastha");
			}
		});

		it("creates PanchaKosha scores for all skills", async () => {
			const skills = [makeManifest("alpha")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const kosha = orch.getKoshaScores("alpha");
			expect(kosha).toBeDefined();
			expect(kosha!.overall).toBeGreaterThanOrEqual(0);
			expect(kosha!.overall).toBeLessThanOrEqual(1);
		});

		it("creates Parampara chains for all skills", async () => {
			const skills = [makeManifest("beta")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const chain = orch.getParamparaChain("beta");
			expect(chain).toBeDefined();
			expect(chain!.links).toHaveLength(1);
			expect(chain!.links[0].action).toBe("created");
		});
	});

	describe("onToolRegistered", () => {
		it("registers a tool in KulaRegistry with specified kula", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			orch.onToolRegistered(
				{ name: "new-tool", description: "A new tool" },
				"bahya",
			);

			const entry = orch.kula.get("new-tool");
			expect(entry).toBeDefined();
			expect(entry!.kula).toBe("bahya");

			// Should have brahmacharya state for non-antara
			const state = orch.getAshramamState("new-tool");
			expect(state).toBeDefined();
			expect(state!.stage).toBe("brahmacharya");
		});

		it("registers antara tools with grihastha state", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			orch.onToolRegistered(
				{ name: "core-tool", description: "Core tool" },
				"antara",
			);

			const state = orch.getAshramamState("core-tool");
			expect(state!.stage).toBe("grihastha");
		});
	});

	describe("onSkillExecuted", () => {
		it("updates mastery via Samskara", async () => {
			const skills = [makeManifest("executor")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			orch.onSkillExecuted("executor", true, 50);
			orch.onSkillExecuted("executor", true, 30);
			orch.onSkillExecuted("executor", false, 100);

			const mastery = orch.samskara.getMastery("executor");
			expect(mastery.totalInvocations).toBe(3);
			expect(mastery.successCount).toBe(2);
			expect(mastery.failureCount).toBe(1);
		});

		it("records usage in SkillEvolution", async () => {
			const skills = [makeManifest("evo-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			orch.onSkillExecuted("evo-skill", true, 50, "session-1");

			const health = orch.evolution.getSkillHealth("evo-skill");
			expect(health.useCount).toBe(1);
			expect(health.successCount).toBe(1);
		});

		it("resets Ashrama inactivity counter", async () => {
			const skills = [makeManifest("active-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			// Manually set some inactivity
			const state = orch.getAshramamState("active-skill")!;
			// Execute a skill — should reset inactivity
			orch.onSkillExecuted("active-skill", true, 50);

			const updated = orch.getAshramamState("active-skill")!;
			expect(updated.consecutiveDaysInactive).toBe(0);
		});

		it("appends Parampara link on milestones", async () => {
			const skills = [makeManifest("milestone-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			// Execute 50 times to hit milestone
			for (let i = 0; i < 50; i++) {
				orch.onSkillExecuted("milestone-skill", true, 10);
			}

			const chain = orch.getParamparaChain("milestone-skill");
			expect(chain).toBeDefined();
			// Should have genesis + at least one milestone link
			expect(chain!.links.length).toBeGreaterThan(1);
		});
	});

	describe("onSkillMatched", () => {
		it("records match in SkillEvolution", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			orch.onSkillMatched("some-skill", "read a file", 0.85);

			const health = orch.evolution.getSkillHealth("some-skill");
			expect(health.matchCount).toBe(1);
		});
	});

	describe("onSkillRejected", () => {
		it("records rejection in SkillEvolution", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			orch.onSkillRejected("bad-skill", "better-skill");

			const health = orch.evolution.getSkillHealth("bad-skill");
			expect(health.rejectCount).toBe(1);
		});
	});

	describe("onSessionEnd", () => {
		it("flushes Samskara session", async () => {
			const skills = [makeManifest("sess-a"), makeManifest("sess-b")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			// Simulate session usage via Samskara impressions
			orch.samskara.recordImpression({
				skillName: "sess-a", sessionId: "s1", success: true, latencyMs: 10,
				triggerQuery: "test", matchScore: 0.9, wasOverridden: false, timestamp: new Date().toISOString(),
			});
			orch.samskara.recordImpression({
				skillName: "sess-b", sessionId: "s1", success: true, latencyMs: 20,
				triggerQuery: "test", matchScore: 0.8, wasOverridden: false, timestamp: new Date().toISOString(),
			});

			// Should not throw
			orch.onSessionEnd("s1", ["sess-a", "sess-b"]);
		});

		it("records Yoga session for composition discovery", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			// Record enough sessions for auto-discovery threshold
			for (let i = 0; i < 10; i++) {
				orch.onSessionEnd(`s-${i}`, ["skill-x", "skill-y"]);
			}

			const compositions = orch.yoga.getAll();
			// May or may not discover depending on thresholds, but should not error
			expect(compositions).toBeDefined();
		});
	});

	describe("evaluateLifecycles", () => {
		it("returns a lifecycle report", async () => {
			const skills = [makeManifest("eval-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const report = orch.evaluateLifecycles();

			expect(report).toHaveProperty("promotions");
			expect(report).toHaveProperty("demotions");
			expect(report).toHaveProperty("archived");
			expect(report).toHaveProperty("extinctionCandidates");
			expect(report).toHaveProperty("speciationCandidates");
			expect(report).toHaveProperty("deprecationCandidates");
			expect(report).toHaveProperty("newCompositions");
		});

		it("does not crash with no skills", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			const report = orch.evaluateLifecycles();
			expect(report.promotions).toHaveLength(0);
		});
	});

	describe("learnSkill", () => {
		it("returns failed if no Shiksha controller", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			const result = await orch.learnSkill("disk space");
			expect(result.success).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.error).toContain("not available");
		});

		it("registers auto-approved skills in shiksha kula", async () => {
			const mockLearn = vi.fn().mockResolvedValue({
				success: true,
				skill: { manifest: makeManifest("disk-check") },
				autoApproved: true,
				durationMs: 100,
			});

			const orch = makeOrchestrator({ shiksha: { learn: mockLearn } });
			await orch.initialize();

			const result = await orch.learnSkill("check disk space");
			expect(result.success).toBe(true);
			expect(result.status).toBe("registered");
			expect(result.skillName).toBe("disk-check");

			// Should be in shiksha kula
			const entry = orch.kula.get("disk-check");
			expect(entry).toBeDefined();
		});

		it("returns quarantined for non-auto-approved skills", async () => {
			const mockLearn = vi.fn().mockResolvedValue({
				success: true,
				skill: { manifest: makeManifest("risky-skill") },
				autoApproved: false,
				quarantineId: "q-123",
				durationMs: 200,
			});

			const orch = makeOrchestrator({ shiksha: { learn: mockLearn } });
			await orch.initialize();

			const result = await orch.learnSkill("risky operation");
			expect(result.success).toBe(true);
			expect(result.status).toBe("quarantined");
			expect(result.quarantineId).toBe("q-123");
		});

		it("handles Shiksha errors gracefully", async () => {
			const mockLearn = vi.fn().mockRejectedValue(new Error("Network error"));

			const orch = makeOrchestrator({ shiksha: { learn: mockLearn } });
			await orch.initialize();

			const result = await orch.learnSkill("anything");
			expect(result.success).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.error).toContain("Network error");
		});
	});

	describe("promoteSkill", () => {
		it("promotes brahmacharya → grihastha", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			// Register a bahya skill (starts as brahmacharya)
			orch.onToolRegistered({ name: "promo-skill", description: "Test" }, "bahya");
			expect(orch.getAshramamState("promo-skill")!.stage).toBe("brahmacharya");

			const promoted = orch.promoteSkill("promo-skill", "reviewer-1");
			expect(promoted).toBe(true);
			expect(orch.getAshramamState("promo-skill")!.stage).toBe("grihastha");

			// Parampara chain should have a "promoted" link
			const chain = orch.getParamparaChain("promo-skill");
			expect(chain!.links.some((l) => l.action === "promoted")).toBe(true);
		});

		it("returns false for invalid transition", async () => {
			const skills = [makeManifest("already-active")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			// antara skills start as grihastha, can't promote again
			const promoted = orch.promoteSkill("already-active");
			expect(promoted).toBe(false);
		});

		it("returns false for unknown skill", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			const promoted = orch.promoteSkill("nonexistent");
			expect(promoted).toBe(false);
		});
	});

	describe("deprecateSkill", () => {
		it("deprecates grihastha → vanaprastha", async () => {
			const skills = [makeManifest("old-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const deprecated = orch.deprecateSkill("old-skill", "no longer needed");
			expect(deprecated).toBe(true);
			expect(orch.getAshramamState("old-skill")!.stage).toBe("vanaprastha");

			// Parampara chain should have a "demoted" link
			const chain = orch.getParamparaChain("old-skill");
			expect(chain!.links.some((l) => l.action === "demoted")).toBe(true);
		});

		it("returns false for brahmacharya (can't deprecate)", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			orch.onToolRegistered({ name: "baby-skill", description: "New" }, "bahya");
			const deprecated = orch.deprecateSkill("baby-skill");
			expect(deprecated).toBe(false);
		});
	});

	describe("recommend", () => {
		it("delegates to VidyaBridge.recommendSkillsV2", async () => {
			const skills = [makeManifest("file-reader", {
				description: "Read files from the filesystem",
				capabilities: [{ verb: "read", object: "files", description: "Read files" }],
				tags: ["file", "read", "filesystem"],
			})];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const matches = orch.recommend("read a file");
			// Should return an array (may be empty depending on TVM threshold)
			expect(Array.isArray(matches)).toBe(true);
		});
	});

	describe("getSkillReport", () => {
		it("returns a single skill report", async () => {
			const skills = [makeManifest("report-skill")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			orch.onSkillExecuted("report-skill", true, 50);

			const report = orch.getSkillReport("report-skill") as SkillReport;
			expect(report.name).toBe("report-skill");
			expect(report.manifest).toBeDefined();
			expect(report.ashrama).toBeDefined();
			expect(report.kosha).toBeDefined();
			expect(report.mastery.totalInvocations).toBe(1);
			expect(report.health).toBeDefined();
			expect(report.compositions).toBeDefined();
		});

		it("returns all skill reports when no name given", async () => {
			const skills = [makeManifest("a"), makeManifest("b")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const reports = orch.getSkillReport() as SkillReport[];
			expect(reports).toHaveLength(2);
			expect(reports.map((r) => r.name).sort()).toEqual(["a", "b"]);
		});

		it("returns report for unknown skill without crashing", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			const report = orch.getSkillReport("ghost") as SkillReport;
			expect(report.name).toBe("ghost");
			expect(report.ashrama.stage).toBe("brahmacharya");
		});
	});

	describe("getEcosystemStats", () => {
		it("returns comprehensive ecosystem statistics", async () => {
			const skills = [makeManifest("s1"), makeManifest("s2"), makeManifest("s3")];
			const orch = makeOrchestrator({ skills });
			await orch.initialize();

			const stats = orch.getEcosystemStats();
			expect(stats.totalSkills).toBe(3);
			expect(stats.byKula.antara).toBe(3);
			expect(stats.byAshrama.grihastha).toBe(3);
			expect(stats.avgKosha.overall).toBeGreaterThanOrEqual(0);
			expect(stats.extinctionCandidates).toBeDefined();
			expect(stats.deprecationCandidates).toBeDefined();
		});

		it("returns zero stats for empty ecosystem", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();

			const stats = orch.getEcosystemStats();
			expect(stats.totalSkills).toBe(0);
		});
	});

	describe("persist / restore", () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = join(tmpdir(), `vidya-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			await mkdir(tmpDir, { recursive: true });
		});

		afterEach(async () => {
			try {
				await rm(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		});

		it("persists and restores orchestrator state", async () => {
			const persistPath = join(tmpDir, "vidya-state.json");
			const skills = [makeManifest("persist-skill")];

			// Create first orchestrator, do work, persist
			const orch1 = makeOrchestrator({ skills, persistPath });
			await orch1.initialize();

			orch1.onSkillExecuted("persist-skill", true, 50);
			orch1.onSkillExecuted("persist-skill", true, 30);
			orch1.onSkillExecuted("persist-skill", false, 100);

			await orch1.persist();

			// Create second orchestrator, restore
			const orch2 = makeOrchestrator({ skills, persistPath });
			const result = await orch2.initialize();

			expect(result.restored).toBe(true);

			// Samskara mastery should be restored
			const mastery = orch2.samskara.getMastery("persist-skill");
			expect(mastery.totalInvocations).toBe(3);
			expect(mastery.successCount).toBe(2);
		});

		it("returns false when no persist file exists", async () => {
			const persistPath = join(tmpDir, "nonexistent.json");
			const orch = makeOrchestrator({ persistPath });

			const restored = await orch.restore();
			expect(restored).toBe(false);
		});

		it("returns false for invalid JSON", async () => {
			const persistPath = join(tmpDir, "bad.json");
			await writeFile(persistPath, "not json", "utf-8");

			const orch = makeOrchestrator({ persistPath });
			const restored = await orch.restore();
			expect(restored).toBe(false);
		});

		it("returns false for wrong version", async () => {
			const persistPath = join(tmpDir, "v0.json");
			await writeFile(persistPath, JSON.stringify({ version: 99 }), "utf-8");

			const orch = makeOrchestrator({ persistPath });
			const restored = await orch.restore();
			expect(restored).toBe(false);
		});

		it("persist is no-op without persistPath", async () => {
			const orch = makeOrchestrator();
			await orch.initialize();
			// Should not throw
			await orch.persist();
		});
	});

	describe("full lifecycle integration", () => {
		it("initialize → register → execute → session end → evaluate → persist → restore", async () => {
			const tmpDir = join(tmpdir(), `vidya-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			await mkdir(tmpDir, { recursive: true });
			const persistPath = join(tmpDir, "state.json");

			try {
				const skills = [makeManifest("lifecycle-skill")];
				const orch = makeOrchestrator({ skills, persistPath });

				// 1. Initialize
				const init = await orch.initialize();
				expect(init.loaded).toBe(1);

				// 2. Register a new tool
				orch.onToolRegistered({ name: "dynamic-tool", description: "Dynamic" }, "bahya");

				// 3. Execute skills
				for (let i = 0; i < 10; i++) {
					orch.onSkillExecuted("lifecycle-skill", true, 20 + i);
					orch.onSkillExecuted("dynamic-tool", i < 8, 30 + i);
				}

				// 4. Match and reject
				orch.onSkillMatched("lifecycle-skill", "test query", 0.9);
				orch.onSkillRejected("dynamic-tool");

				// 5. Session end
				orch.onSessionEnd("int-session", ["lifecycle-skill", "dynamic-tool"]);

				// 6. Evaluate lifecycles
				const report = orch.evaluateLifecycles();
				expect(report).toBeDefined();

				// 7. Get reports
				const skillReport = orch.getSkillReport("lifecycle-skill") as SkillReport;
				expect(skillReport.mastery.totalInvocations).toBe(10);

				const stats = orch.getEcosystemStats();
				expect(stats.totalSkills).toBeGreaterThanOrEqual(1);

				// 8. Persist
				await orch.persist();

				// 9. Restore in new instance
				const orch2 = makeOrchestrator({ skills, persistPath });
				const init2 = await orch2.initialize();
				expect(init2.restored).toBe(true);

				// Verify state survived
				const mastery = orch2.samskara.getMastery("lifecycle-skill");
				expect(mastery.totalInvocations).toBe(10);
			} finally {
				await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
			}
		});
	});
});
