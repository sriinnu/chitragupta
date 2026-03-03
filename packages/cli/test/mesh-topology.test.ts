/**
 * Tests for AdaptOrch-style topology router (mesh-topology.ts).
 *
 * Validates domain detection, coordination/parallel signal detection,
 * and topology selection logic across single/parallel/hierarchical modes.
 */

import { describe, it, expect } from "vitest";
import {
	detectDomains,
	hasCoordinationSignal,
	hasParallelSignal,
	selectTopology,
} from "../src/modes/mesh-topology.js";

const ALL_ACTORS = ["sys:memory", "sys:skills", "sys:session"];

// ═══════════════════════════════════════════════════════════════════════════
// Domain Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("detectDomains", () => {
	it("should detect memory domain", () => {
		expect(detectDomains("search my memory for auth decisions")).toContain("memory");
		expect(detectDomains("recall what we decided about routing")).toContain("memory");
		expect(detectDomains("store this fact in knowledge base")).toContain("memory");
	});

	it("should detect skills domain", () => {
		expect(detectDomains("find a skill for deploying containers")).toContain("skills");
		expect(detectDomains("recommend a tool for file reading")).toContain("skills");
		expect(detectDomains("discover available capabilities")).toContain("skills");
	});

	it("should detect session domain", () => {
		expect(detectDomains("show me the last session")).toContain("session");
		expect(detectDomains("generate a handover summary")).toContain("session");
		expect(detectDomains("list recent sessions")).toContain("session");
	});

	it("should detect multiple domains", () => {
		const domains = detectDomains("search memory and find skill for deployment");
		expect(domains).toContain("memory");
		expect(domains).toContain("skills");
	});

	it("should detect memory+session overlap for context-related queries", () => {
		const domains = detectDomains("recall the previous session context");
		expect(domains).toContain("memory");
		expect(domains).toContain("session");
	});

	it("should return empty array for unrelated tasks", () => {
		expect(detectDomains("calculate fibonacci numbers")).toHaveLength(0);
		expect(detectDomains("write a haiku about coffee")).toHaveLength(0);
	});

	it("should be case-insensitive", () => {
		expect(detectDomains("SEARCH MEMORY")).toContain("memory");
		expect(detectDomains("Find Skill")).toContain("skills");
	});

	it("should detect phrase-based matches", () => {
		expect(detectDomains("look in find in memory for it")).toContain("memory");
		expect(detectDomains("check the previous session")).toContain("session");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Coordination Signal Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("hasCoordinationSignal", () => {
	it("should detect sequential dependencies", () => {
		expect(hasCoordinationSignal("search memory then find related skills")).toBe(true);
		expect(hasCoordinationSignal("recall context and then show session")).toBe(true);
	});

	it("should detect output-chaining", () => {
		expect(hasCoordinationSignal("using the result from memory, find skills")).toBe(true);
		expect(hasCoordinationSignal("based on the session, search memory")).toBe(true);
	});

	it("should detect cross-referencing", () => {
		expect(hasCoordinationSignal("cross-reference memory with sessions")).toBe(true);
		expect(hasCoordinationSignal("correlate skills with past decisions")).toBe(true);
	});

	it("should NOT detect when no coordination keywords present", () => {
		expect(hasCoordinationSignal("search memory for auth")).toBe(false);
		expect(hasCoordinationSignal("list all skills")).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel Signal Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("hasParallelSignal", () => {
	it("should detect parallel connectors", () => {
		expect(hasParallelSignal("search memory and list skills")).toBe(true);
		expect(hasParallelSignal("check sessions as well as memory")).toBe(true);
		expect(hasParallelSignal("query both memory and skills")).toBe(true);
	});

	it("should detect explicit parallelism", () => {
		expect(hasParallelSignal("run in parallel: memory search + skill find")).toBe(true);
		expect(hasParallelSignal("simultaneously check all subsystems")).toBe(true);
	});

	it("should NOT detect when no parallel connectors present", () => {
		expect(hasParallelSignal("search memory for auth decisions")).toBe(false);
		expect(hasParallelSignal("find the best skill")).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Topology Selection
// ═══════════════════════════════════════════════════════════════════════════

describe("selectTopology", () => {
	it("should return single for single-domain tasks", () => {
		const result = selectTopology("search memory for auth patterns", ALL_ACTORS);
		expect(result.topology).toBe("single");
		expect(result.actorIds).toContain("sys:memory");
		expect(result.parallelizable).toBe(false);
	});

	it("should return single for no detected domains (default)", () => {
		const result = selectTopology("calculate fibonacci", ALL_ACTORS);
		expect(result.topology).toBe("single");
		expect(result.reason).toContain("No specific domain detected");
	});

	it("should default to memory actor when no domain detected", () => {
		const result = selectTopology("what is the meaning of life", ALL_ACTORS);
		expect(result.actorIds).toContain("sys:memory");
	});

	it("should return parallel for multi-domain independent tasks", () => {
		const result = selectTopology(
			"search memory and also list all skills",
			ALL_ACTORS,
		);
		expect(result.topology).toBe("parallel");
		expect(result.parallelizable).toBe(true);
		expect(result.actorIds).toContain("sys:memory");
		expect(result.actorIds).toContain("sys:skills");
	});

	it("should return hierarchical for coordinated multi-domain tasks", () => {
		const result = selectTopology(
			"search memory for auth then find related skills based on the result",
			ALL_ACTORS,
		);
		expect(result.topology).toBe("hierarchical");
		expect(result.parallelizable).toBe(false);
		expect(result.actorIds.length).toBeGreaterThan(1);
	});

	it("should default to single when multi-domain but no clear signal", () => {
		// "memory" + "skill" domains detected but no parallel/coordination keywords
		const result = selectTopology("memory skill", ALL_ACTORS);
		expect(result.topology).toBe("single");
		expect(result.reason).toContain("defaulting to sequential");
	});

	it("should filter actors to only available ones", () => {
		const result = selectTopology(
			"search memory and list skills",
			["sys:memory"], // skills actor not available
		);
		// Only memory is available, so only one actor
		expect(result.actorIds).toEqual(["sys:memory"]);
		expect(result.topology).toBe("single");
	});

	it("should handle all three domains simultaneously", () => {
		const result = selectTopology(
			"search memory and also find skills and list sessions",
			ALL_ACTORS,
		);
		expect(result.topology).toBe("parallel");
		expect(result.actorIds).toHaveLength(3);
	});

	it("should populate detectedDomains", () => {
		const result = selectTopology("search memory for patterns", ALL_ACTORS);
		expect(result.detectedDomains).toContain("memory");
	});

	it("should provide meaningful reason", () => {
		const result = selectTopology("find a skill for testing", ALL_ACTORS);
		expect(result.reason).toBeTruthy();
		expect(result.reason.length).toBeGreaterThan(10);
	});

	it("should handle empty available actors", () => {
		const result = selectTopology("search memory", []);
		expect(result.topology).toBe("single");
		expect(result.actorIds).toHaveLength(0);
	});

	it("should prefer coordination over parallelism when both signals present", () => {
		const result = selectTopology(
			"search memory and then based on the result find skills simultaneously",
			ALL_ACTORS,
		);
		// Coordination signal should win (checked first)
		expect(result.topology).toBe("hierarchical");
	});
});
