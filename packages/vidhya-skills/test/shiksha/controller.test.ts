import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShikshaController } from "../../src/shiksha/controller.js";
import type {
	ShikshaEvent,
	ShikshaEventType,
	BashExecutor,
} from "../../src/shiksha/types.js";
import { DEFAULT_SHIKSHA_CONFIG, SHIKSHA_HARD_CEILINGS } from "../../src/shiksha/types.js";
import type { SkillRegistry } from "../../src/registry.js";
import type { SkillPipeline } from "../../src/pariksha.js";
import type { SkillEvolution } from "../../src/skill-evolution.js";
import type { SurakshaScanner } from "../../src/suraksha.js";
import type { SkillMatch } from "../../src/types.js";

// ─── Mock node:child_process ─────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: Function) => {
		if (cmd === "which") {
			cb(null, "/usr/sbin/arp");
		} else if (cmd === "sh") {
			cb(null, "mock output", "");
		} else {
			cb(new Error("not found"), "", "");
		}
	}),
}));

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockRegistry(): SkillRegistry {
	return {
		register: vi.fn(),
		query: vi.fn().mockReturnValue([]),
	} as unknown as SkillRegistry;
}

function createMockScanner(verdict: "clean" | "suspicious" | "dangerous" = "clean"): SurakshaScanner {
	return {
		scan: vi.fn().mockReturnValue({
			verdict,
			riskScore: verdict === "clean" ? 0 : 0.7,
			findings: verdict === "clean" ? [] : [{ threat: "obfuscation", severity: "medium", message: "suspicious" }],
			scanDurationMs: 1,
			contentHash: 0,
		}),
	} as unknown as SurakshaScanner;
}

function createMockPipeline(): SkillPipeline {
	return {
		ingest: vi.fn().mockResolvedValue({
			quarantineId: "q-123",
			skillName: "test",
			verdict: "clean",
			riskScore: 0,
			autoRejected: false,
			staged: true,
		}),
	} as unknown as SkillPipeline;
}

function createMockEvolution(): SkillEvolution {
	return {
		recordMatch: vi.fn(),
	} as unknown as SkillEvolution;
}

function createMockBashExecutor(): BashExecutor {
	return {
		execute: vi.fn().mockResolvedValue({
			stdout: "arp output here",
			stderr: "",
			exitCode: 0,
		}),
	};
}

function makeMatch(score: number): SkillMatch {
	return {
		skill: {
			name: "test-skill",
			version: "1.0.0",
			description: "A test skill",
			tags: ["test"],
			capabilities: [{ verb: "test", object: "thing", description: "test thing" }],
			source: { type: "manual", filePath: "/test.md" },
			updatedAt: new Date().toISOString(),
		},
		score,
		breakdown: {
			traitSimilarity: score,
			tagBoost: 0,
			capabilityMatch: 0,
			antiPatternPenalty: 0,
		},
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ShikshaController", () => {
	let registry: SkillRegistry;
	let scanner: SurakshaScanner;
	let pipeline: SkillPipeline;
	let evolution: SkillEvolution;
	let bashExecutor: BashExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		registry = createMockRegistry();
		scanner = createMockScanner();
		pipeline = createMockPipeline();
		evolution = createMockEvolution();
		bashExecutor = createMockBashExecutor();
	});

	// ─── 1. detectGap ──────────────────────────────────────────────────────

	describe("detectGap", () => {
		it("returns true when matches array is empty", () => {
			const ctrl = new ShikshaController({ registry });
			expect(ctrl.detectGap("check devices on my network", [])).toBe(true);
		});

		it("returns true when all matches are below gap threshold", () => {
			const ctrl = new ShikshaController({ registry });
			const matches = [makeMatch(0.1), makeMatch(0.2)];
			expect(ctrl.detectGap("check devices", matches)).toBe(true);
		});

		it("returns false when some matches are above gap threshold", () => {
			const ctrl = new ShikshaController({ registry });
			const matches = [makeMatch(0.5), makeMatch(0.1)];
			expect(ctrl.detectGap("check devices", matches)).toBe(false);
		});

		it("returns false when query is empty", () => {
			const ctrl = new ShikshaController({ registry });
			expect(ctrl.detectGap("", [])).toBe(false);
		});

		it("returns false when query is whitespace-only", () => {
			const ctrl = new ShikshaController({ registry });
			expect(ctrl.detectGap("   ", [])).toBe(false);
		});

		it("respects custom gapThreshold from config", () => {
			const ctrl = new ShikshaController({ registry }, { config: { gapThreshold: 0.6 } });
			const matches = [makeMatch(0.5)];
			// 0.5 < 0.6 → gap detected
			expect(ctrl.detectGap("check stuff", matches)).toBe(true);
		});
	});

	// ─── 2. learn — shell-command flow ────────────────────────────────────

	describe("learn — shell-command flow", () => {
		it("analyzes, sources, builds, scans, auto-approves, executes, and returns success", async () => {
			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline, evolution },
				{ bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(true);
			expect(result.executed).toBe(true);
			expect(result.executionOutput).toBeDefined();
			expect(result.skill).toBeDefined();
			expect(result.skill!.manifest.name).toContain("check");
			expect(result.skill!.implementation.type).toBe("shell");
			expect(result.scanResult).toBeDefined();
			expect(result.scanResult!.verdict).toBe("clean");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);

			// Registry.register should have been called
			expect(registry.register).toHaveBeenCalledOnce();

			// Evolution should have recorded the match
			expect(evolution.recordMatch).toHaveBeenCalledOnce();

			// BashExecutor should have been called for execution
			expect(bashExecutor.execute).toHaveBeenCalledOnce();
		});
	});

	// ─── 3. learn — auto-approve denied (network required) ───────────────

	describe("learn — auto-approve denied (network required)", () => {
		it("quarantines skill when candidate utilities require network", async () => {
			// "ping" requires network, so auto-approve should be denied
			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline, evolution },
				{ bashExecutor },
			);

			const result = await ctrl.learn("ping google.com");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			// Should have been ingested into the quarantine pipeline
			expect(pipeline.ingest).toHaveBeenCalledOnce();
			expect(result.quarantineId).toBe("q-123");
		});
	});

	// ─── 4. learn — auto-approve denied (dirty scan) ─────────────────────

	describe("learn — auto-approve denied (dirty scan)", () => {
		it("quarantines skill when scanner returns suspicious verdict", async () => {
			const dirtyScanner = createMockScanner("suspicious");
			const ctrl = new ShikshaController(
				{ registry, scanner: dirtyScanner, pipeline, evolution },
				{ bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			expect(result.scanResult!.verdict).toBe("suspicious");
			expect(result.quarantineId).toBe("q-123");
		});
	});

	// ─── 5. learn — fallthrough (no utilities) ───────────────────────────

	describe("learn — fallthrough (no utilities)", () => {
		it("returns error with LLM required when no shell utilities match", async () => {
			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline },
				{ bashExecutor },
			);

			const result = await ctrl.learn("summarize this code");

			expect(result.success).toBe(false);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			expect(result.error).toBeDefined();
			// Could be either "LLM" or "code generation" depending on analysis strategy
			expect(
				result.error!.includes("LLM") || result.error!.includes("code generation"),
			).toBe(true);
		});
	});

	// ─── 6. learn — auto-execute disabled ────────────────────────────────

	describe("learn — auto-execute disabled", () => {
		it("creates and approves skill but does not execute when autoExecute is false", async () => {
			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline, evolution },
				{ config: { autoExecute: false }, bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(true);
			expect(result.executed).toBe(false);
			expect(result.executionOutput).toBeUndefined();
			// Skill should still be registered
			expect(registry.register).toHaveBeenCalledOnce();
			// BashExecutor should NOT have been called
			expect(bashExecutor.execute).not.toHaveBeenCalled();
		});
	});

	// ─── 7. learn — auto-approve disabled ────────────────────────────────

	describe("learn — auto-approve disabled", () => {
		it("always quarantines when autoApprove is false", async () => {
			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline, evolution },
				{ config: { autoApprove: false }, bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			// Should have been quarantined via pipeline
			expect(pipeline.ingest).toHaveBeenCalledOnce();
			expect(result.quarantineId).toBe("q-123");
			// Registry should NOT have been called (not approved)
			expect(registry.register).not.toHaveBeenCalled();
		});
	});

	// ─── 8. learn — no scanner ───────────────────────────────────────────

	describe("learn — no scanner", () => {
		it("cannot auto-approve when scanner is undefined", async () => {
			const ctrl = new ShikshaController(
				{ registry, pipeline, evolution },
				{ bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			expect(result.scanResult).toBeUndefined();
			// Should have quarantined since no scan means no auto-approve
			expect(pipeline.ingest).toHaveBeenCalledOnce();
		});
	});

	// ─── 9. learn — events emitted ──────────────────────────────────────

	describe("learn — events emitted", () => {
		it("emits the correct event sequence for a successful shell skill", async () => {
			const emittedEvents: ShikshaEvent[] = [];
			const onEvent = vi.fn((event: ShikshaEvent) => {
				emittedEvents.push(event);
			});

			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline, evolution },
				{ bashExecutor, onEvent },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(true);
			expect(onEvent).toHaveBeenCalled();

			// Verify the event sequence
			const eventTypes = emittedEvents.map((e) => e.type);
			expect(eventTypes).toContain("gap:detected");
			expect(eventTypes).toContain("skill:analyzing");
			expect(eventTypes).toContain("skill:analyzed");
			expect(eventTypes).toContain("skill:sourcing");
			expect(eventTypes).toContain("skill:sourced");
			expect(eventTypes).toContain("skill:generating");
			expect(eventTypes).toContain("skill:generated");
			expect(eventTypes).toContain("skill:scanning");
			expect(eventTypes).toContain("skill:scanned");
			expect(eventTypes).toContain("skill:auto_approved");
			expect(eventTypes).toContain("skill:executing");
			expect(eventTypes).toContain("skill:executed");
			expect(eventTypes).toContain("skill:learned");

			// Events in result should match emitted events
			expect(result.events.length).toBe(emittedEvents.length);

			// All events must have timestamps
			for (const event of emittedEvents) {
				expect(event.timestamp).toBeGreaterThan(0);
			}
		});

		it("emits gap:detected then skill:failed for LLM-required queries", async () => {
			const emittedEvents: ShikshaEvent[] = [];
			const onEvent = vi.fn((event: ShikshaEvent) => {
				emittedEvents.push(event);
			});

			const ctrl = new ShikshaController(
				{ registry },
				{ bashExecutor, onEvent },
			);

			await ctrl.learn("summarize this code");

			const eventTypes = emittedEvents.map((e) => e.type);
			expect(eventTypes).toContain("gap:detected");
			expect(eventTypes).toContain("skill:analyzing");
			expect(eventTypes).toContain("skill:failed" as ShikshaEventType);
		});

		it("emits skill:quarantined when auto-approve is denied", async () => {
			const emittedEvents: ShikshaEvent[] = [];
			const onEvent = vi.fn((event: ShikshaEvent) => {
				emittedEvents.push(event);
			});

			const ctrl = new ShikshaController(
				{ registry, scanner, pipeline },
				{ config: { autoApprove: false }, bashExecutor, onEvent },
			);

			await ctrl.learn("check devices on my network");

			const eventTypes = emittedEvents.map((e) => e.type);
			expect(eventTypes).toContain("skill:quarantined");
			expect(eventTypes).not.toContain("skill:auto_approved");
		});
	});

	// ─── 10. learn — error handling ──────────────────────────────────────

	describe("learn — error handling", () => {
		it("catches errors gracefully and returns success=false", async () => {
			// Make the registry.query throw during sourceSkill's builtin-tool check
			const brokenRegistry = {
				register: vi.fn(),
				query: vi.fn().mockImplementation(() => {
					throw new Error("registry exploded");
				}),
			} as unknown as SkillRegistry;

			const ctrl = new ShikshaController(
				{ registry: brokenRegistry, scanner, pipeline },
				{ bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.success).toBe(false);
			expect(result.autoApproved).toBe(false);
			expect(result.executed).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("registry exploded");
			expect(result.events.length).toBeGreaterThan(0);
			// Last event should be skill:failed
			const lastEvent = result.events[result.events.length - 1];
			expect(lastEvent.type).toBe("skill:failed");
		});

		it("includes durationMs even on failure", async () => {
			const brokenRegistry = {
				register: vi.fn(),
				query: vi.fn().mockImplementation(() => {
					throw new Error("boom");
				}),
			} as unknown as SkillRegistry;

			const ctrl = new ShikshaController(
				{ registry: brokenRegistry },
				{ bashExecutor },
			);

			const result = await ctrl.learn("check devices on my network");

			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	// ─── 11. getConfig ───────────────────────────────────────────────────

	describe("getConfig", () => {
		it("returns a copy of the current config", () => {
			const ctrl = new ShikshaController({ registry });
			const config = ctrl.getConfig();

			expect(config.gapThreshold).toBe(DEFAULT_SHIKSHA_CONFIG.gapThreshold);
			expect(config.autoApprove).toBe(DEFAULT_SHIKSHA_CONFIG.autoApprove);
			expect(config.autoExecute).toBe(DEFAULT_SHIKSHA_CONFIG.autoExecute);
			expect(config.enableRemoteSourcing).toBe(DEFAULT_SHIKSHA_CONFIG.enableRemoteSourcing);
			expect(config.minNpmDownloads).toBe(DEFAULT_SHIKSHA_CONFIG.minNpmDownloads);
			expect(config.minGithubStars).toBe(DEFAULT_SHIKSHA_CONFIG.minGithubStars);
			expect(config.sourcingTimeoutMs).toBe(DEFAULT_SHIKSHA_CONFIG.sourcingTimeoutMs);
		});

		it("reflects custom config values", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { gapThreshold: 0.5, autoExecute: false } },
			);
			const config = ctrl.getConfig();

			expect(config.gapThreshold).toBe(0.5);
			expect(config.autoExecute).toBe(false);
			// Others remain at defaults
			expect(config.autoApprove).toBe(true);
		});

		it("returns a frozen copy — mutations do not affect the controller", () => {
			const ctrl = new ShikshaController({ registry });
			const config1 = ctrl.getConfig();
			(config1 as Record<string, unknown>).gapThreshold = 0.99;

			const config2 = ctrl.getConfig();
			expect(config2.gapThreshold).toBe(DEFAULT_SHIKSHA_CONFIG.gapThreshold);
		});
	});

	// ─── 12. Config clamping ─────────────────────────────────────────────

	describe("Config clamping", () => {
		it("clamps gapThreshold to maxGapThreshold ceiling", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { gapThreshold: 0.95 } },
			);
			const config = ctrl.getConfig();

			expect(config.gapThreshold).toBe(SHIKSHA_HARD_CEILINGS.maxGapThreshold);
		});

		it("clamps sourcingTimeoutMs to maxSourcingTimeoutMs ceiling", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { sourcingTimeoutMs: 60_000 } },
			);
			const config = ctrl.getConfig();

			expect(config.sourcingTimeoutMs).toBe(SHIKSHA_HARD_CEILINGS.maxSourcingTimeoutMs);
		});

		it("clamps minNpmDownloads to floor value", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { minNpmDownloads: 5 } },
			);
			const config = ctrl.getConfig();

			expect(config.minNpmDownloads).toBe(SHIKSHA_HARD_CEILINGS.minNpmDownloadsFloor);
		});

		it("clamps minGithubStars to floor value", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { minGithubStars: 1 } },
			);
			const config = ctrl.getConfig();

			expect(config.minGithubStars).toBe(SHIKSHA_HARD_CEILINGS.minGithubStarsFloor);
		});

		it("does not clamp values within acceptable range", () => {
			const ctrl = new ShikshaController(
				{ registry },
				{ config: { gapThreshold: 0.5, sourcingTimeoutMs: 15_000, minNpmDownloads: 500, minGithubStars: 25 } },
			);
			const config = ctrl.getConfig();

			expect(config.gapThreshold).toBe(0.5);
			expect(config.sourcingTimeoutMs).toBe(15_000);
			expect(config.minNpmDownloads).toBe(500);
			expect(config.minGithubStars).toBe(25);
		});
	});
});
