import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { VamshaTracker } from "../src/vamsha.js";
import type {
	VamshaEvent, VamshaLineage, AnandamayaMastery, EnhancedSkillManifest,
} from "../src/types-v2.js";
import { DEFAULT_VIDYA_TANTRA_CONFIG } from "../src/types-v2.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMastery(overrides: Partial<AnandamayaMastery> = {}): AnandamayaMastery {
	return {
		totalInvocations: 0,
		successCount: 0,
		failureCount: 0,
		successRate: 0,
		avgLatencyMs: 0,
		dreyfusLevel: "novice",
		lastInvokedAt: null,
		firstInvokedAt: null,
		thompsonAlpha: 1,
		thompsonBeta: 1,
		...overrides,
	};
}

function makeManifest(overrides: Partial<EnhancedSkillManifest> = {}): EnhancedSkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill",
		capabilities: [],
		tags: [],
		source: { type: "builtin" },
		...overrides,
	} as EnhancedSkillManifest;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("VamshaTracker — Evolutionary Biology for Skills", () => {
	let tracker: VamshaTracker;

	beforeEach(() => {
		tracker = new VamshaTracker();
	});

	// ── Lineage Tracking (Evolutionary Tree) ────────────────────────────

	describe("Lineage Tracking (Evolutionary Tree)", () => {
		it("creates a lineage with skillName, empty events, no ancestor", () => {
			const lineage = tracker.getOrCreateLineage("weather");
			expect(lineage.skillName).toBe("weather");
			expect(lineage.events).toEqual([]);
			expect(lineage.variants).toEqual([]);
			expect(lineage.symbionts).toEqual([]);
			expect(lineage.ancestor).toBeNull();
		});

		it("returns the same lineage object on repeated getOrCreate calls", () => {
			const a = tracker.getOrCreateLineage("weather");
			const b = tracker.getOrCreateLineage("weather");
			expect(a).toBe(b);
		});

		it("getLineage returns null for non-existent skill", () => {
			expect(tracker.getLineage("nonexistent")).toBeNull();
		});

		it("getLineage returns the lineage after creation", () => {
			tracker.getOrCreateLineage("weather");
			const lineage = tracker.getLineage("weather");
			expect(lineage).not.toBeNull();
			expect(lineage!.skillName).toBe("weather");
		});

		it("recording events grows the events array", () => {
			tracker.recordMutation("weather", "1.1.0", "bug fix");
			tracker.recordExtinction("weather", "superseded");
			const lineage = tracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(2);
		});

		it("each event has timestamp, type, and relevant metadata", () => {
			const event = tracker.recordMutation("weather", "2.0.0", "major rewrite");
			expect(event.type).toBe("mutation");
			expect(event.skillName).toBe("weather");
			expect(event.reason).toBe("major rewrite");
			expect(event.newVersion).toBe("2.0.0");
			expect(typeof event.timestamp).toBe("string");
			// Timestamp is valid ISO 8601
			expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
		});

		it("events are appended chronologically (monotonic timestamps)", () => {
			tracker.recordMutation("weather", "1.1.0", "first");
			tracker.recordMutation("weather", "1.2.0", "second");
			tracker.recordMutation("weather", "1.3.0", "third");
			const lineage = tracker.getLineage("weather")!;
			for (let i = 1; i < lineage.events.length; i++) {
				const prev = new Date(lineage.events[i - 1].timestamp).getTime();
				const curr = new Date(lineage.events[i].timestamp).getTime();
				expect(curr).toBeGreaterThanOrEqual(prev);
			}
		});
	});

	// ── Mutation (Versioning) ───────────────────────────────────────────

	describe("Mutation (Versioning)", () => {
		it("recordMutation adds a mutation event with newVersion", () => {
			const event = tracker.recordMutation("weather", "1.1.0", "fixed API endpoint");
			expect(event.type).toBe("mutation");
			expect(event.newVersion).toBe("1.1.0");
			expect(event.reason).toBe("fixed API endpoint");
		});

		it("consecutive mutations create a version history chain", () => {
			tracker.recordMutation("weather", "1.0.1", "patch");
			tracker.recordMutation("weather", "1.1.0", "minor feature");
			tracker.recordMutation("weather", "2.0.0", "breaking change");
			const lineage = tracker.getLineage("weather")!;
			const versions = lineage.events
				.filter(e => e.type === "mutation")
				.map(e => e.newVersion);
			expect(versions).toEqual(["1.0.1", "1.1.0", "2.0.0"]);
		});

		it("mutation events carry the diff description (reason)", () => {
			tracker.recordMutation("weather", "1.1.0", "added humidity field");
			const lineage = tracker.getLineage("weather")!;
			const mutationEvent = lineage.events[0];
			expect(mutationEvent.reason).toBe("added humidity field");
		});

		it("mutation creates lineage if it does not exist", () => {
			expect(tracker.getLineage("new-skill")).toBeNull();
			tracker.recordMutation("new-skill", "0.1.0", "initial");
			expect(tracker.getLineage("new-skill")).not.toBeNull();
		});
	});

	// ── Speciation (Forking) ────────────────────────────────────────────

	describe("Speciation (Forking)", () => {
		it("speciate creates a new lineage for the variant", () => {
			tracker.recordSpeciation("weather", "weather-linux", "OS-specific clipboard");
			const variant = tracker.getLineage("weather-linux");
			expect(variant).not.toBeNull();
			expect(variant!.skillName).toBe("weather-linux");
		});

		it("variant lineage has ancestor pointing to parent skill", () => {
			tracker.recordSpeciation("weather", "weather-linux", "OS fork");
			const variant = tracker.getLineage("weather-linux")!;
			expect(variant.ancestor).toBe("weather");
		});

		it("parent lineage records the speciation event", () => {
			tracker.recordSpeciation("weather", "weather-linux", "OS fork");
			const parent = tracker.getLineage("weather")!;
			const speciationEvents = parent.events.filter(e => e.type === "speciation");
			expect(speciationEvents).toHaveLength(1);
			expect(speciationEvents[0].variantName).toBe("weather-linux");
		});

		it("variant lineage also records a speciation event referencing parent", () => {
			tracker.recordSpeciation("weather", "weather-linux", "OS fork");
			const variant = tracker.getLineage("weather-linux")!;
			const speciationEvents = variant.events.filter(e => e.type === "speciation");
			expect(speciationEvents).toHaveLength(1);
			expect(speciationEvents[0].reason).toContain("Forked from weather");
		});

		it("parent tracks variant names in its variants array", () => {
			tracker.recordSpeciation("weather", "weather-linux", "OS fork");
			const parent = tracker.getLineage("weather")!;
			expect(parent.variants).toContain("weather-linux");
		});

		it("multiple speciations from same parent track all children", () => {
			tracker.recordSpeciation("weather", "weather-linux", "linux fork");
			tracker.recordSpeciation("weather", "weather-darwin", "mac fork");
			tracker.recordSpeciation("weather", "weather-win32", "windows fork");
			const parent = tracker.getLineage("weather")!;
			expect(parent.variants).toEqual(["weather-linux", "weather-darwin", "weather-win32"]);
			expect(tracker.getVariants("weather")).toEqual(["weather-linux", "weather-darwin", "weather-win32"]);
		});

		it("duplicate speciation with same variant name is idempotent in variants array", () => {
			tracker.recordSpeciation("weather", "weather-linux", "first fork");
			tracker.recordSpeciation("weather", "weather-linux", "duplicate fork");
			const parent = tracker.getLineage("weather")!;
			// Variants array should not have duplicates
			expect(parent.variants.filter(v => v === "weather-linux")).toHaveLength(1);
			// But events are still recorded (two speciation events)
			expect(parent.events.filter(e => e.type === "speciation")).toHaveLength(2);
		});

		it("getAncestor traces back to the ultimate progenitor", () => {
			tracker.recordSpeciation("weather", "weather-linux", "linux fork");
			tracker.recordSpeciation("weather-linux", "weather-linux-arm", "ARM variant");
			// weather-linux-arm → weather-linux → weather (root, no ancestor)
			expect(tracker.getAncestor("weather-linux-arm")).toBe("weather");
		});

		it("getAncestor returns null for a root skill", () => {
			tracker.getOrCreateLineage("weather");
			expect(tracker.getAncestor("weather")).toBeNull();
		});

		it("getAncestor handles circular references gracefully (returns null)", () => {
			// Manually create a cycle by manipulating lineages
			const a = tracker.getOrCreateLineage("skill-a");
			const b = tracker.getOrCreateLineage("skill-b");
			(a as { ancestor: string | null }).ancestor = "skill-b";
			(b as { ancestor: string | null }).ancestor = "skill-a";
			// Should not infinite-loop, returns null
			expect(tracker.getAncestor("skill-a")).toBeNull();
		});
	});

	// ── Symbiosis (Mutual Strengthening) ────────────────────────────────

	describe("Symbiosis (Mutual Strengthening)", () => {
		it("recordSymbiosis marks two skills as symbiotic partners", () => {
			tracker.recordSymbiosis("weather", "calendar", "always used together");
			const weatherLineage = tracker.getLineage("weather")!;
			const calendarLineage = tracker.getLineage("calendar")!;
			expect(weatherLineage.symbionts).toContain("calendar");
			expect(calendarLineage.symbionts).toContain("weather");
		});

		it("symbiosis is bidirectional: both skills benefit", () => {
			tracker.recordSymbiosis("skill-a", "skill-b", "mutual benefit");
			expect(tracker.getSymbionts("skill-a")).toContain("skill-b");
			expect(tracker.getSymbionts("skill-b")).toContain("skill-a");
		});

		it("partner name is recorded in the event", () => {
			const event = tracker.recordSymbiosis("weather", "calendar", "morning routine");
			expect(event.partnerName).toBe("calendar");
			expect(event.type).toBe("symbiosis");
		});

		it("symbiotic event is added to the first skill's lineage", () => {
			tracker.recordSymbiosis("weather", "calendar", "morning routine");
			const lineage = tracker.getLineage("weather")!;
			const symbiosisEvents = lineage.events.filter(e => e.type === "symbiosis");
			expect(symbiosisEvents).toHaveLength(1);
			expect(symbiosisEvents[0].partnerName).toBe("calendar");
		});

		it("duplicate symbiosis does not duplicate the symbionts array entry", () => {
			tracker.recordSymbiosis("weather", "calendar", "first");
			tracker.recordSymbiosis("weather", "calendar", "second");
			expect(tracker.getSymbionts("weather").filter(s => s === "calendar")).toHaveLength(1);
			expect(tracker.getSymbionts("calendar").filter(s => s === "weather")).toHaveLength(1);
		});

		it("getSymbionts returns empty for skill with no symbionts", () => {
			expect(tracker.getSymbionts("loner")).toEqual([]);
		});

		it("multiple symbionts can be accumulated", () => {
			tracker.recordSymbiosis("hub", "spoke-1", "connection 1");
			tracker.recordSymbiosis("hub", "spoke-2", "connection 2");
			tracker.recordSymbiosis("hub", "spoke-3", "connection 3");
			expect(tracker.getSymbionts("hub")).toEqual(["spoke-1", "spoke-2", "spoke-3"]);
		});
	});

	// ── Extinction (Skill Death) ────────────────────────────────────────

	describe("Extinction (Skill Death)", () => {
		it("recordExtinction marks a skill as extinct with reason", () => {
			const event = tracker.recordExtinction("old-weather", "superseded by weather-v2");
			expect(event.type).toBe("extinction");
			expect(event.reason).toBe("superseded by weather-v2");
		});

		it("extinct skills have extinction event in their lineage", () => {
			tracker.recordExtinction("old-weather", "no usage for 90 days");
			const lineage = tracker.getLineage("old-weather")!;
			const extinctionEvents = lineage.events.filter(e => e.type === "extinction");
			expect(extinctionEvents).toHaveLength(1);
		});

		it("extinction reason is preserved accurately", () => {
			tracker.recordExtinction("old-weather", "no usage for 90 days");
			const lineage = tracker.getLineage("old-weather")!;
			expect(lineage.events[0].reason).toBe("no usage for 90 days");
		});

		it("double extinction records two events (not idempotent)", () => {
			tracker.recordExtinction("old-weather", "first death");
			tracker.recordExtinction("old-weather", "resurrected then died again");
			const lineage = tracker.getLineage("old-weather")!;
			const extinctionEvents = lineage.events.filter(e => e.type === "extinction");
			expect(extinctionEvents).toHaveLength(2);
		});

		it("extinction after a rich history preserves all events", () => {
			tracker.recordMutation("weather", "1.1.0", "update");
			tracker.recordSymbiosis("weather", "calendar", "pair");
			tracker.recordExtinction("weather", "end of life");
			const lineage = tracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(3);
			expect(lineage.events[0].type).toBe("mutation");
			expect(lineage.events[1].type).toBe("symbiosis");
			expect(lineage.events[2].type).toBe("extinction");
		});
	});

	// ── Adaptation (Usage-driven Evolution) ─────────────────────────────

	describe("Adaptation (Usage-driven Evolution)", () => {
		it("recordAdaptation captures vector delta and reason", () => {
			const event = tracker.recordAdaptation("weather", 0.15, "query drift toward humidity");
			expect(event.type).toBe("adaptation");
			expect(event.vectorDelta).toBe(0.15);
			expect(event.reason).toBe("query drift toward humidity");
		});

		it("adaptation events are appended to the lineage", () => {
			tracker.recordAdaptation("weather", 0.10, "first drift");
			tracker.recordAdaptation("weather", 0.05, "second drift");
			const lineage = tracker.getLineage("weather")!;
			const adaptations = lineage.events.filter(e => e.type === "adaptation");
			expect(adaptations).toHaveLength(2);
			expect(adaptations[0].vectorDelta).toBe(0.10);
			expect(adaptations[1].vectorDelta).toBe(0.05);
		});

		it("adaptation with zero delta is still recorded", () => {
			const event = tracker.recordAdaptation("weather", 0.0, "no change needed");
			expect(event.vectorDelta).toBe(0.0);
		});
	});

	// ── Event Trimming ──────────────────────────────────────────────────

	describe("Event Trimming", () => {
		it("trims oldest events when exceeding maxEventsPerSkill", () => {
			const maxEvents = 5;
			const smallTracker = new VamshaTracker(maxEvents);
			for (let i = 0; i < 10; i++) {
				smallTracker.recordMutation("weather", `1.${i}.0`, `change ${i}`);
			}
			const lineage = smallTracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(maxEvents);
		});

		it("preserves most recent events after trimming", () => {
			const maxEvents = 3;
			const smallTracker = new VamshaTracker(maxEvents);
			for (let i = 0; i < 7; i++) {
				smallTracker.recordMutation("weather", `1.${i}.0`, `change ${i}`);
			}
			const lineage = smallTracker.getLineage("weather")!;
			// Should keep the last 3: change 4, change 5, change 6
			expect(lineage.events[0].reason).toBe("change 4");
			expect(lineage.events[1].reason).toBe("change 5");
			expect(lineage.events[2].reason).toBe("change 6");
		});

		it("trimming uses the configured maxEventsPerSkill from DEFAULT config", () => {
			// Default is 200 per DEFAULT_VIDYA_TANTRA_CONFIG
			const defaultTracker = new VamshaTracker();
			for (let i = 0; i < 210; i++) {
				defaultTracker.recordMutation("weather", `1.${i}.0`, `change ${i}`);
			}
			const lineage = defaultTracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(DEFAULT_VIDYA_TANTRA_CONFIG.maxVamshaEvents);
		});

		it("trimming is applied per-event-type: mixed events all count toward the cap", () => {
			const maxEvents = 4;
			const smallTracker = new VamshaTracker(maxEvents);
			smallTracker.recordMutation("weather", "1.0.0", "mutation");
			smallTracker.recordAdaptation("weather", 0.1, "adaptation");
			smallTracker.recordSymbiosis("weather", "calendar", "symbiosis");
			smallTracker.recordExtinction("weather", "extinction");
			smallTracker.recordMutation("weather", "2.0.0", "overflow mutation");
			const lineage = smallTracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(maxEvents);
			// Oldest (first mutation) should have been trimmed
			expect(lineage.events[0].type).toBe("adaptation");
		});

		it("single event does not trigger trimming", () => {
			const smallTracker = new VamshaTracker(1);
			smallTracker.recordMutation("weather", "1.0.0", "only one");
			const lineage = smallTracker.getLineage("weather")!;
			expect(lineage.events).toHaveLength(1);
		});
	});

	// ── Extinction Candidate Detection ──────────────────────────────────

	describe("detectExtinctionCandidates", () => {
		it("identifies skills with low health, high invocations, low success, and staleness", () => {
			vi.useFakeTimers();
			const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
			vi.setSystemTime(ninetyOneDaysAgo);

			const mastery = makeMastery({
				totalInvocations: 25,
				successCount: 1,
				failureCount: 24,
				successRate: 0.04,
				lastInvokedAt: ninetyOneDaysAgo.toISOString(),
			});

			vi.useRealTimers();

			const masteryMap = new Map([["dying-skill", mastery]]);
			const healthMap = new Map([["dying-skill", 0.01]]);
			const candidates = tracker.detectExtinctionCandidates(masteryMap, healthMap);
			expect(candidates).toContain("dying-skill");
		});

		it("does not flag skills with health >= 0.05", () => {
			const mastery = makeMastery({
				totalInvocations: 100,
				successCount: 5,
				lastInvokedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
			});
			const masteryMap = new Map([["ok-health", mastery]]);
			const healthMap = new Map([["ok-health", 0.05]]);
			expect(tracker.detectExtinctionCandidates(masteryMap, healthMap)).toEqual([]);
		});

		it("does not flag skills with fewer than 20 invocations", () => {
			const mastery = makeMastery({
				totalInvocations: 10,
				successCount: 0,
				lastInvokedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
			});
			const masteryMap = new Map([["new-skill", mastery]]);
			const healthMap = new Map([["new-skill", 0.0]]);
			expect(tracker.detectExtinctionCandidates(masteryMap, healthMap)).toEqual([]);
		});

		it("does not flag skills invoked within the last 90 days", () => {
			const mastery = makeMastery({
				totalInvocations: 50,
				successCount: 2,
				lastInvokedAt: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
			});
			const masteryMap = new Map([["recent-fail", mastery]]);
			const healthMap = new Map([["recent-fail", 0.01]]);
			expect(tracker.detectExtinctionCandidates(masteryMap, healthMap)).toEqual([]);
		});

		it("does not flag skills with success rate >= 0.1", () => {
			const mastery = makeMastery({
				totalInvocations: 50,
				successCount: 6,
				lastInvokedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
			});
			const masteryMap = new Map([["some-success", mastery]]);
			const healthMap = new Map([["some-success", 0.01]]);
			expect(tracker.detectExtinctionCandidates(masteryMap, healthMap)).toEqual([]);
		});

		it("does not flag skills with null lastInvokedAt", () => {
			const mastery = makeMastery({
				totalInvocations: 100,
				successCount: 0,
				lastInvokedAt: null,
			});
			const masteryMap = new Map([["never-invoked", mastery]]);
			const healthMap = new Map([["never-invoked", 0.0]]);
			expect(tracker.detectExtinctionCandidates(masteryMap, healthMap)).toEqual([]);
		});
	});

	// ── Speciation Candidate Detection ──────────────────────────────────

	describe("detectSpeciationCandidates", () => {
		it("detects skills using OS-specific binaries across multiple OS targets", () => {
			const manifest = makeManifest({
				name: "clipboard-manager",
				requirements: {
					bins: ["pbcopy", "xclip"],
					env: [],
					os: ["darwin", "linux"],
					network: false,
					privilege: false,
				},
			});
			const candidates = tracker.detectSpeciationCandidates([manifest]);
			expect(candidates.length).toBeGreaterThanOrEqual(2);
			const names = candidates.map(c => c.suggestedVariant);
			expect(names).toContain("clipboard-manager-darwin");
			expect(names).toContain("clipboard-manager-linux");
		});

		it("does not suggest speciation for skills with no bins", () => {
			const manifest = makeManifest({
				name: "pure-logic",
				requirements: {
					bins: [],
					env: [],
					os: ["darwin", "linux"],
					network: false,
					privilege: false,
				},
			});
			expect(tracker.detectSpeciationCandidates([manifest])).toEqual([]);
		});

		it("does not suggest speciation for single-OS skills", () => {
			const manifest = makeManifest({
				name: "mac-only",
				requirements: {
					bins: ["pbcopy"],
					env: [],
					os: ["darwin"],
					network: false,
					privilege: false,
				},
			});
			expect(tracker.detectSpeciationCandidates([manifest])).toEqual([]);
		});

		it("includes reason with OS-specific binary names", () => {
			const manifest = makeManifest({
				name: "clipboard",
				requirements: {
					bins: ["pbcopy", "xclip"],
					env: [],
					os: ["darwin", "linux"],
					network: false,
					privilege: false,
				},
			});
			const candidates = tracker.detectSpeciationCandidates([manifest]);
			const darwinCandidate = candidates.find(c => c.suggestedVariant === "clipboard-darwin");
			expect(darwinCandidate).toBeDefined();
			expect(darwinCandidate!.reason).toContain("pbcopy");
		});

		it("handles skills with no requirements gracefully", () => {
			const manifest = makeManifest({ name: "bare" });
			expect(tracker.detectSpeciationCandidates([manifest])).toEqual([]);
		});
	});

	// ── Symbiosis Candidate Detection ───────────────────────────────────

	describe("detectSymbiosisCandidates", () => {
		it("detects skills with co-occurrence rate above threshold", () => {
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 18]])],
			]);
			const sessions = new Map([
				["weather", 20],
				["calendar", 20],
			]);
			const candidates = tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.8);
			expect(candidates).toHaveLength(1);
			expect(candidates[0].skillA).toBe("weather");
			expect(candidates[0].skillB).toBe("calendar");
			expect(candidates[0].rate).toBe(18 / 20);
		});

		it("does not suggest symbiosis for pairs below threshold", () => {
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 5]])],
			]);
			const sessions = new Map([
				["weather", 20],
				["calendar", 20],
			]);
			expect(tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.8)).toEqual([]);
		});

		it("deduplicates A:B and B:A pairs", () => {
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 18]])],
				["calendar", new Map([["weather", 18]])],
			]);
			const sessions = new Map([
				["weather", 20],
				["calendar", 20],
			]);
			const candidates = tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.8);
			expect(candidates).toHaveLength(1);
		});

		it("skips pairs that are already registered as symbionts", () => {
			tracker.recordSymbiosis("weather", "calendar", "already linked");
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 18]])],
			]);
			const sessions = new Map([
				["weather", 20],
				["calendar", 20],
			]);
			expect(tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.8)).toEqual([]);
		});

		it("rate formula uses min(sessionsA, sessionsB) as denominator", () => {
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 9]])],
			]);
			const sessions = new Map([
				["weather", 100],
				["calendar", 10],
			]);
			// rate = 9 / min(100, 10) = 9/10 = 0.9
			const candidates = tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.8);
			expect(candidates).toHaveLength(1);
			expect(candidates[0].rate).toBeCloseTo(0.9, 5);
		});

		it("skips skills with zero sessions", () => {
			const coOccurrences = new Map([
				["weather", new Map([["calendar", 5]])],
			]);
			const sessions = new Map([
				["weather", 0],
				["calendar", 10],
			]);
			expect(tracker.detectSymbiosisCandidates(coOccurrences, sessions, 0.1)).toEqual([]);
		});
	});

	// ── Serialization ───────────────────────────────────────────────────

	describe("Serialization (serialize / deserialize)", () => {
		it("round-trips lineage state through serialize/deserialize", () => {
			tracker.recordMutation("weather", "1.1.0", "update");
			tracker.recordSpeciation("weather", "weather-linux", "fork");
			tracker.recordSymbiosis("weather", "calendar", "pair");
			tracker.recordExtinction("old-skill", "deprecated");

			const serialized = tracker.serialize();
			const restored = new VamshaTracker();
			restored.deserialize(serialized);

			// Verify weather lineage
			const weather = restored.getLineage("weather")!;
			expect(weather.events).toHaveLength(3); // mutation + speciation + symbiosis
			expect(weather.variants).toContain("weather-linux");
			expect(weather.symbionts).toContain("calendar");

			// Verify variant lineage
			const variant = restored.getLineage("weather-linux")!;
			expect(variant.ancestor).toBe("weather");

			// Verify extinct skill
			const extinct = restored.getLineage("old-skill")!;
			expect(extinct.events[0].type).toBe("extinction");
		});

		it("serialize returns an array of [name, lineage] tuples", () => {
			tracker.getOrCreateLineage("skill-a");
			tracker.getOrCreateLineage("skill-b");
			const serialized = tracker.serialize();
			expect(Array.isArray(serialized)).toBe(true);
			expect(serialized).toHaveLength(2);
			expect(serialized[0][0]).toBe("skill-a");
			expect(serialized[1][0]).toBe("skill-b");
		});

		it("deserialize clears existing state", () => {
			tracker.getOrCreateLineage("existing");
			tracker.deserialize([]);
			expect(tracker.getLineage("existing")).toBeNull();
		});
	});

	// ── Edge Cases ──────────────────────────────────────────────────────

	describe("Edge Cases", () => {
		it("empty lineage (no events beyond creation)", () => {
			const lineage = tracker.getOrCreateLineage("empty");
			expect(lineage.events).toHaveLength(0);
			expect(lineage.ancestor).toBeNull();
			expect(lineage.variants).toEqual([]);
			expect(lineage.symbionts).toEqual([]);
		});

		it("speciation of non-existent skill auto-creates both lineages", () => {
			expect(tracker.getLineage("parent")).toBeNull();
			expect(tracker.getLineage("child")).toBeNull();
			tracker.recordSpeciation("parent", "child", "fork");
			expect(tracker.getLineage("parent")).not.toBeNull();
			expect(tracker.getLineage("child")).not.toBeNull();
		});

		it("getVariants returns empty for non-existent skill", () => {
			expect(tracker.getVariants("ghost")).toEqual([]);
		});

		it("getAncestor returns null for non-existent skill", () => {
			expect(tracker.getAncestor("ghost")).toBeNull();
		});

		it("all event types can coexist on the same lineage", () => {
			tracker.recordMutation("weather", "1.1.0", "update");
			tracker.recordAdaptation("weather", 0.1, "drift");
			tracker.recordSymbiosis("weather", "calendar", "pair");
			tracker.recordExtinction("weather", "end");
			const lineage = tracker.getLineage("weather")!;
			const types = lineage.events.map(e => e.type);
			expect(types).toEqual(["mutation", "adaptation", "symbiosis", "extinction"]);
		});

		it("VamshaTracker constructor defaults maxEventsPerSkill from config", () => {
			const defaultTracker = new VamshaTracker();
			// Fill beyond default max and verify trim
			for (let i = 0; i < DEFAULT_VIDYA_TANTRA_CONFIG.maxVamshaEvents + 5; i++) {
				defaultTracker.recordMutation("skill", `1.${i}.0`, `change ${i}`);
			}
			const lineage = defaultTracker.getLineage("skill")!;
			expect(lineage.events).toHaveLength(DEFAULT_VIDYA_TANTRA_CONFIG.maxVamshaEvents);
		});

		it("deep ancestry chain is traversed correctly up to depth 100", () => {
			// Build a chain: root → child-0 → child-1 → ... → child-9
			tracker.getOrCreateLineage("root");
			let parent = "root";
			for (let i = 0; i < 10; i++) {
				const child = `child-${i}`;
				tracker.recordSpeciation(parent, child, `depth ${i}`);
				parent = child;
			}
			expect(tracker.getAncestor("child-9")).toBe("root");
		});
	});
});
