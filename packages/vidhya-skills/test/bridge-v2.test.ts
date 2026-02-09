import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	VidyaBridge,
	SkillRegistry,
	SamskaraSkillBridge,
	AshramamMachine,
	createInitialState,
	INITIAL_ANANDAMAYA,
} from "@chitragupta/vidhya-skills";
import type {
	ToolDefinition,
	SkillManifest,
	EnhancedSkillManifest,
	VidyaTantraMatch,
	SkillState,
	AshramamState,
	PanchaKoshaScores,
	ParamparaChain,
	AnandamayaMastery,
	VamshaLineage,
	MatchContext,
} from "@chitragupta/vidhya-skills";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeToolDef(name: string, description: string): ToolDefinition {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
		},
	};
}

function makeEnhancedManifest(
	overrides: Partial<EnhancedSkillManifest> & { name: string },
): EnhancedSkillManifest {
	return {
		version: "1.0.0",
		description: overrides.description ?? "A test skill",
		capabilities: overrides.capabilities ?? [
			{ verb: "read", object: "files", description: "Read files." },
		],
		tags: overrides.tags ?? ["test"],
		source: { type: "tool", toolName: overrides.name },
		updatedAt: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

function makeSkillState(
	manifest: EnhancedSkillManifest,
	stage: "brahmacharya" | "grihastha" | "vanaprastha" | "sannyasa" = "grihastha",
): SkillState {
	const now = new Date().toISOString();
	return {
		manifest,
		ashrama: {
			stage,
			enteredAt: now,
			history: [{ from: stage, to: stage, reason: "test", healthAtTransition: 0.5, timestamp: now }],
			lastEvaluatedAt: now,
			consecutiveDaysInactive: 0,
		},
		kosha: {
			annamaya: 1,
			pranamaya: 1,
			manomaya: 0.8,
			vijnanamaya: 0.5,
			anandamaya: 0.3,
			overall: 0.7,
		},
		parampara: {
			skillName: manifest.name,
			links: [],
			trust: {
				originTrust: 0.8,
				scanTrust: 0.9,
				reviewTrust: 0.5,
				ageTrust: 0.6,
				freshnessTrust: 0.7,
				score: 0.75,
			},
			chainIntact: true,
		},
		mastery: { ...INITIAL_ANANDAMAYA },
		vamsha: {
			skillName: manifest.name,
			ancestor: null,
			variants: [],
			symbionts: [],
			events: [],
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("VidyaBridge — Vidya-Tantra Enhanced Methods", () => {
	let registry: SkillRegistry;
	let bridge: VidyaBridge;

	beforeEach(() => {
		registry = new SkillRegistry();
		bridge = new VidyaBridge(registry);
	});

	// ─── setVidyaTantra ─────────────────────────────────────────────────

	describe("setVidyaTantra()", () => {
		it("attaching SamskaraSkillBridge enables recordImpression", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.registerToolsAsSkills([makeToolDef("read_file", "Read a file")]);
			bridge.recordImpression({
				skillName: "read_file",
				success: true,
				latencyMs: 50,
			});

			const mastery = samskara.getMastery("read_file");
			expect(mastery.totalInvocations).toBe(1);
			expect(mastery.successCount).toBe(1);
		});

		it("attaching AshramamMachine enables lifecycle management", () => {
			const machine = new AshramamMachine();
			bridge.setVidyaTantra({ ashramamMachine: machine });

			// The machine being attached is verified indirectly:
			// we just confirm no error is thrown
			expect(machine.isMatchable("grihastha")).toBe(true);
			expect(machine.isMatchable("brahmacharya")).toBe(false);
		});

		it("can attach both SamskaraSkillBridge and AshramamMachine", () => {
			const samskara = new SamskaraSkillBridge();
			const machine = new AshramamMachine();
			bridge.setVidyaTantra({ samskaraBridge: samskara, ashramamMachine: machine });

			bridge.registerToolsAsSkills([makeToolDef("tool_a", "Tool A")]);
			bridge.recordImpression({ skillName: "tool_a", success: true, latencyMs: 10 });

			expect(samskara.getMastery("tool_a").totalInvocations).toBe(1);
		});

		it("can attach either independently — only samskara", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.registerToolsAsSkills([makeToolDef("t1", "Tool 1")]);
			bridge.recordImpression({ skillName: "t1", success: false, latencyMs: 200 });

			expect(samskara.getMastery("t1").failureCount).toBe(1);
		});

		it("can attach either independently — only ashrama", () => {
			const machine = new AshramamMachine();
			bridge.setVidyaTantra({ ashramamMachine: machine });

			// recordImpression should be a no-op without samskara
			bridge.recordImpression({ skillName: "x", success: true, latencyMs: 1 });
			// No error, no crash
		});
	});

	// ─── recommendSkillsV2 — Three-Phase Pipeline ───────────────────────

	describe("recommendSkillsV2() — Three-Phase Pipeline", () => {
		it("returns VidyaTantraMatch[] with phase metadata", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("read_file", "Read a file from the filesystem"),
				makeToolDef("write_file", "Write content to a file"),
			]);

			const results = bridge.recommendSkillsV2("read a file");
			expect(Array.isArray(results)).toBe(true);
			for (const match of results) {
				expect(match).toHaveProperty("resolvedInPhase");
				expect([1, 2, 3]).toContain(match.resolvedInPhase);
				expect(match).toHaveProperty("breakdown");
				expect(match.breakdown).toHaveProperty("kulaPriority");
				expect(match.breakdown).toHaveProperty("trustMultiplier");
				expect(match.breakdown).toHaveProperty("ashramamWeight");
				expect(match.breakdown).toHaveProperty("thompsonSample");
				expect(match.breakdown).toHaveProperty("chetanaBoost");
				expect(match.breakdown).toHaveProperty("requirementsMet");
			}
		});

		it("respects topK parameter — capped at phase-2 max of 5", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("a", "Read a file from disk"),
				makeToolDef("b", "Write a file to disk"),
				makeToolDef("c", "Delete a file from disk"),
				makeToolDef("d", "Search for files on disk"),
				makeToolDef("e", "List files in a directory"),
				makeToolDef("f", "Move files to new location"),
				makeToolDef("g", "Copy files to new location"),
			]);

			// matchSkillsV2 hard-caps at top-5 in phase 2
			const results = bridge.recommendSkillsV2("file operations", undefined, 5, 0);
			expect(results.length).toBeLessThanOrEqual(5);
		});

		it("respects threshold parameter", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("niche", "Extremely specialized obscure operation"),
			]);

			const results = bridge.recommendSkillsV2("completely unrelated query", undefined, 5, 0.99);
			expect(results.length).toBe(0);
		});

		it("with no context, falls back to algorithmic matching only", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("file_reader", "Read files from the local filesystem"),
			]);

			const results = bridge.recommendSkillsV2("read files from disk");
			// Should still return results via Phase 1 algorithmic matching
			// Without context, no Phase 2 boosts are applied
			if (results.length > 0) {
				expect(results[0].breakdown.chetanaBoost).toBe(0);
			}
		});

		it("with MatchContext (focus concepts, frustration, goals), re-ranking applies", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("file_reader", "Read files from the local filesystem"),
				makeToolDef("code_analyzer", "Analyze source code for complexity"),
			]);

			const context: MatchContext = {
				focusConcepts: new Map([["filesystem", 0.9], ["read", 0.8]]),
				frustration: 0.8,
				activeGoalKeywords: ["read"],
				mastery: new Map([
					["file_reader", {
						...INITIAL_ANANDAMAYA,
						totalInvocations: 50,
						successCount: 45,
						successRate: 0.9,
						thompsonAlpha: 46,
						thompsonBeta: 6,
					}],
				]),
			};

			const results = bridge.recommendSkillsV2("read a file", context, 5, 0);
			expect(results.length).toBeGreaterThan(0);
			// File reader should benefit from focus + frustration + goal boosts
		});

		it("empty registry returns empty results", () => {
			const results = bridge.recommendSkillsV2("anything");
			expect(results).toEqual([]);
		});

		it("all skills below threshold returns empty results", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("obscure_tool", "Does something very specific and unrelated"),
			]);

			const results = bridge.recommendSkillsV2("quantum computing analysis", undefined, 5, 0.95);
			expect(results).toEqual([]);
		});
	});

	// ─── recordImpression ───────────────────────────────────────────────

	describe("recordImpression()", () => {
		it("is no-op when no SamskaraSkillBridge attached", () => {
			// Should not throw
			bridge.recordImpression({
				skillName: "test",
				success: true,
				latencyMs: 100,
			});
		});

		it("with bridge attached, impression is recorded (verify via getMastery)", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.recordImpression({
				skillName: "tool_x",
				success: true,
				latencyMs: 42,
			});

			const mastery = samskara.getMastery("tool_x");
			expect(mastery.totalInvocations).toBe(1);
			expect(mastery.successCount).toBe(1);
			expect(mastery.avgLatencyMs).toBe(42);
		});

		it("accepts minimal opts (skillName, success, latencyMs)", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.recordImpression({
				skillName: "minimal",
				success: false,
				latencyMs: 500,
			});

			const mastery = samskara.getMastery("minimal");
			expect(mastery.totalInvocations).toBe(1);
			expect(mastery.failureCount).toBe(1);
		});

		it("accepts full opts (sessionId, triggerQuery, matchScore, wasOverridden, preferredSkill)", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.recordImpression({
				skillName: "full_tool",
				success: true,
				latencyMs: 75,
				sessionId: "sess-001",
				triggerQuery: "read a file",
				matchScore: 0.85,
				wasOverridden: true,
				preferredSkill: "better_tool",
			});

			const mastery = samskara.getMastery("full_tool");
			expect(mastery.totalInvocations).toBe(1);
			expect(mastery.successCount).toBe(1);
		});

		it("timestamp is auto-set as ISO string", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			const before = new Date().toISOString();
			bridge.recordImpression({
				skillName: "ts_tool",
				success: true,
				latencyMs: 10,
			});
			const after = new Date().toISOString();

			const mastery = samskara.getMastery("ts_tool");
			// lastInvokedAt should be between before and after
			expect(mastery.lastInvokedAt).not.toBeNull();
			expect(mastery.lastInvokedAt! >= before).toBe(true);
			expect(mastery.lastInvokedAt! <= after).toBe(true);
		});
	});

	// ─── getSkillState ──────────────────────────────────────────────────

	describe("getSkillState()", () => {
		it("returns SkillState for registered skills with state", () => {
			const manifest = makeEnhancedManifest({ name: "file-reader" });
			registry.register(manifest);
			const state = makeSkillState(manifest, "grihastha");
			registry.setState("file-reader", state);

			const result = bridge.getSkillState("file-reader");
			expect(result).toBeDefined();
			expect(result!.manifest.name).toBe("file-reader");
			expect(result!.ashrama.stage).toBe("grihastha");
		});

		it("returns undefined for unknown skills", () => {
			const result = bridge.getSkillState("nonexistent");
			expect(result).toBeUndefined();
		});

		it("returns undefined for skills without state set", () => {
			bridge.registerToolsAsSkills([makeToolDef("no_state", "No state tool")]);
			const result = bridge.getSkillState("no_state");
			expect(result).toBeUndefined();
		});
	});

	// ─── getMatchableSkills ─────────────────────────────────────────────

	describe("getMatchableSkills()", () => {
		it("returns only grihastha + vanaprastha skills (excludes brahmacharya, sannyasa)", () => {
			const m1 = makeEnhancedManifest({ name: "active-skill", description: "Active" });
			const m2 = makeEnhancedManifest({ name: "retired-skill", description: "Retired" });
			const m3 = makeEnhancedManifest({ name: "student-skill", description: "Student" });
			const m4 = makeEnhancedManifest({ name: "archived-skill", description: "Archived" });

			registry.register(m1);
			registry.register(m2);
			registry.register(m3);
			registry.register(m4);

			registry.setState("active-skill", makeSkillState(m1, "grihastha"));
			registry.setState("retired-skill", makeSkillState(m2, "vanaprastha"));
			registry.setState("student-skill", makeSkillState(m3, "brahmacharya"));
			registry.setState("archived-skill", makeSkillState(m4, "sannyasa"));

			const matchable = bridge.getMatchableSkills();
			const names = matchable.map((s) => s.name);

			expect(names).toContain("active-skill");
			expect(names).toContain("retired-skill");
			expect(names).not.toContain("student-skill");
			expect(names).not.toContain("archived-skill");
		});

		it("returns EnhancedSkillManifest[]", () => {
			const m = makeEnhancedManifest({ name: "enhanced", kula: "antara" });
			registry.register(m);
			registry.setState("enhanced", makeSkillState(m, "grihastha"));

			const matchable = bridge.getMatchableSkills();
			expect(matchable.length).toBe(1);
			// Cast and check extended field
			const enhanced = matchable[0] as EnhancedSkillManifest;
			expect(enhanced.kula).toBe("antara");
		});

		it("includes skills without state (default matchable)", () => {
			bridge.registerToolsAsSkills([makeToolDef("no_state_skill", "No state")]);
			const matchable = bridge.getMatchableSkills();
			const names = matchable.map((s) => s.name);
			expect(names).toContain("no_state_skill");
		});
	});

	// ─── buildContextFromSamskara ───────────────────────────────────────

	describe("buildContextFromSamskara()", () => {
		it("returns undefined when no SamskaraSkillBridge", () => {
			const result = bridge.buildContextFromSamskara();
			expect(result).toBeUndefined();
		});

		it("with bridge, returns Partial<MatchContext> with mastery and preferenceRules", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			samskara.updateMastery("tool_a", true, 100);

			const result = bridge.buildContextFromSamskara();
			expect(result).toBeDefined();
			expect(result).toHaveProperty("mastery");
			expect(result).toHaveProperty("preferenceRules");
			expect(result!.mastery).toBeInstanceOf(Map);
			expect(Array.isArray(result!.preferenceRules)).toBe(true);
		});

		it("preference rules populated after override impressions", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			// Record enough overrides to trigger preference detection (threshold is 3)
			for (let i = 0; i < 5; i++) {
				samskara.recordImpression({
					skillName: "tool_old",
					sessionId: `sess-${i}`,
					timestamp: new Date().toISOString(),
					success: true,
					latencyMs: 50,
					triggerQuery: "do something",
					matchScore: 0.7,
					wasOverridden: true,
					preferredSkill: "tool_new",
				});
			}

			// Also record some impressions for tool_new so mastery data exists
			for (let i = 0; i < 5; i++) {
				samskara.recordImpression({
					skillName: "tool_new",
					sessionId: `sess-${i}`,
					timestamp: new Date().toISOString(),
					success: true,
					latencyMs: 30,
					triggerQuery: "do something",
					matchScore: 0.9,
					wasOverridden: false,
				});
			}

			const result = bridge.buildContextFromSamskara();
			expect(result).toBeDefined();
			expect(result!.preferenceRules!.length).toBeGreaterThan(0);

			const rule = result!.preferenceRules![0];
			expect(rule.preferred).toBe("tool_new");
			expect(rule.over).toBe("tool_old");
			expect(rule.confidence).toBeGreaterThanOrEqual(0);
		});

		it("empty preferences when no overrides recorded", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			const result = bridge.buildContextFromSamskara();
			expect(result!.preferenceRules).toEqual([]);
		});
	});

	// ─── Integration (end-to-end) ───────────────────────────────────────

	describe("Integration (end-to-end)", () => {
		it("register tools -> recommend -> record impression -> mastery updates -> recommend again", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			// Step 1: Register tools
			bridge.registerToolsAsSkills([
				makeToolDef("read_file", "Read a file from the local filesystem"),
				makeToolDef("write_file", "Write content to a file on disk"),
				makeToolDef("search_code", "Search through source code"),
			]);
			expect(bridge.registeredCount).toBe(3);

			// Step 2: First recommendation
			const matches1 = bridge.recommendSkillsV2("read a file", undefined, 5, 0);
			expect(matches1.length).toBeGreaterThan(0);
			const topSkill = matches1[0].skill.name;

			// Step 3: Record impressions
			for (let i = 0; i < 10; i++) {
				bridge.recordImpression({
					skillName: topSkill,
					success: true,
					latencyMs: 20 + i,
				});
			}

			// Step 4: Mastery should be updated
			const mastery = samskara.getMastery(topSkill);
			expect(mastery.totalInvocations).toBe(10);
			expect(mastery.successRate).toBe(1.0);
			expect(mastery.dreyfusLevel).toBe("advanced-beginner");

			// Step 5: Recommend again with context from samskara
			const context = bridge.buildContextFromSamskara();
			const matches2 = bridge.recommendSkillsV2("read a file", context as MatchContext, 5, 0);
			expect(matches2.length).toBeGreaterThan(0);
		});

		it("register tool -> check lifecycle state -> promote -> matchable", () => {
			const machine = new AshramamMachine();
			bridge.setVidyaTantra({ ashramamMachine: machine });

			// Register a skill
			const manifest = makeEnhancedManifest({
				name: "lifecycle-test",
				description: "A skill going through lifecycle",
			});
			registry.register(manifest);

			// Start in brahmacharya
			const initialState = createInitialState("brahmacharya");
			const fullState = makeSkillState(manifest, "brahmacharya");
			registry.setState("lifecycle-test", fullState);

			// Should NOT be matchable in brahmacharya
			let matchable = bridge.getMatchableSkills();
			let names = matchable.map((s) => s.name);
			expect(names).not.toContain("lifecycle-test");

			// Promote to grihastha via machine
			const promoted = machine.evaluate(
				fullState.ashrama,
				0.8,  // health above promotion threshold
				0.7,  // trust above 0.5
				10,   // above minObservations
			);
			expect(promoted.stage).toBe("grihastha");

			// Update state in registry
			const promotedState: SkillState = {
				...fullState,
				ashrama: promoted,
			};
			registry.setState("lifecycle-test", promotedState);

			// Now should be matchable
			matchable = bridge.getMatchableSkills();
			names = matchable.map((s) => s.name);
			expect(names).toContain("lifecycle-test");
		});

		it("full pipeline: register -> set VidyaTantra -> recommend V2 -> record -> build context -> re-recommend", () => {
			const samskara = new SamskaraSkillBridge();
			const machine = new AshramamMachine();
			bridge.setVidyaTantra({ samskaraBridge: samskara, ashramamMachine: machine });

			bridge.registerToolsAsSkills([
				makeToolDef("grep", "Search file contents using patterns"),
				makeToolDef("find_files", "Find files by name patterns"),
			]);

			// Initial V2 recommendation
			const initial = bridge.recommendSkillsV2("search for patterns in files", undefined, 5, 0);
			expect(initial.length).toBeGreaterThan(0);

			// Record impressions for top result
			const topName = initial[0].skill.name;
			bridge.recordImpression({ skillName: topName, success: true, latencyMs: 30 });
			bridge.recordImpression({ skillName: topName, success: true, latencyMs: 25 });

			// Build context from samskara
			const ctx = bridge.buildContextFromSamskara();
			expect(ctx).toBeDefined();

			// Re-recommend with context
			const reranked = bridge.recommendSkillsV2(
				"search for patterns in files",
				ctx as MatchContext,
				5,
				0,
			);
			expect(reranked.length).toBeGreaterThan(0);
		});

		it("multiple record impressions accumulate mastery correctly", () => {
			const samskara = new SamskaraSkillBridge();
			bridge.setVidyaTantra({ samskaraBridge: samskara });

			bridge.registerToolsAsSkills([makeToolDef("tool_z", "Tool Z")]);

			// Record mix of success and failure
			bridge.recordImpression({ skillName: "tool_z", success: true, latencyMs: 10 });
			bridge.recordImpression({ skillName: "tool_z", success: true, latencyMs: 20 });
			bridge.recordImpression({ skillName: "tool_z", success: false, latencyMs: 100 });
			bridge.recordImpression({ skillName: "tool_z", success: true, latencyMs: 15 });

			const mastery = samskara.getMastery("tool_z");
			expect(mastery.totalInvocations).toBe(4);
			expect(mastery.successCount).toBe(3);
			expect(mastery.failureCount).toBe(1);
			expect(mastery.successRate).toBeCloseTo(0.75, 5);
			expect(mastery.thompsonAlpha).toBe(4); // 3 successes + 1 initial
			expect(mastery.thompsonBeta).toBe(2);  // 1 failure + 1 initial
		});

		it("getSkillState reflects registry state after setState", () => {
			const m = makeEnhancedManifest({ name: "stateful-skill" });
			registry.register(m);

			// Initially no state
			expect(bridge.getSkillState("stateful-skill")).toBeUndefined();

			// Set state
			const state = makeSkillState(m, "vanaprastha");
			registry.setState("stateful-skill", state);

			const result = bridge.getSkillState("stateful-skill");
			expect(result).toBeDefined();
			expect(result!.ashrama.stage).toBe("vanaprastha");
		});
	});
});
