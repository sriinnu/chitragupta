/**
 * Tests for sabha-deliberate.ts — LLM-injectable risk gate.
 */

import { describe, it, expect, vi } from "vitest";
import {
	deliberateWithSabha,
	aggregatePerspectives,
	SabhaRejectedError,
} from "../src/sabha-deliberate.js";
import type {
	SabhaProvider,
	SabhaDeliberateResult,
	SabhaDeliberatePerspective,
} from "../src/sabha-deliberate.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(result: Partial<SabhaDeliberateResult>): SabhaProvider {
	return {
		deliberate: vi.fn().mockResolvedValue({
			verdict: "approved",
			confidence: 0.8,
			rationale: "test rationale",
			...result,
		}),
	};
}

// ─── deliberateWithSabha ──────────────────────────────────────────────────────

describe("deliberateWithSabha", () => {
	it("returns result on approved verdict", async () => {
		const provider = makeProvider({ verdict: "approved", confidence: 0.9 });
		const result = await deliberateWithSabha("run cleanup", "context", provider);
		expect(result.verdict).toBe("approved");
		expect(result.confidence).toBe(0.9);
	});

	it("returns result on no-consensus verdict", async () => {
		const provider = makeProvider({ verdict: "no-consensus", confidence: 0.4 });
		const result = await deliberateWithSabha("risky action", "context", provider);
		expect(result.verdict).toBe("no-consensus");
	});

	it("throws SabhaRejectedError on rejected verdict", async () => {
		const provider = makeProvider({ verdict: "rejected", confidence: 0.85, rationale: "too risky" });
		await expect(
			deliberateWithSabha("delete all logs", "context", provider),
		).rejects.toThrow(SabhaRejectedError);
	});

	it("SabhaRejectedError contains topic in message", async () => {
		const provider = makeProvider({ verdict: "rejected", confidence: 0.9, rationale: "no" });
		try {
			await deliberateWithSabha("my-dangerous-action", "context", provider);
			expect.fail("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SabhaRejectedError);
			expect((e as SabhaRejectedError).message).toContain("my-dangerous-action");
		}
	});

	it("SabhaRejectedError exposes full result", async () => {
		const provider = makeProvider({ verdict: "rejected", confidence: 0.75, rationale: "blocked" });
		try {
			await deliberateWithSabha("topic", "context", provider);
		} catch (e) {
			expect(e).toBeInstanceOf(SabhaRejectedError);
			const err = e as SabhaRejectedError;
			expect(err.result.verdict).toBe("rejected");
			expect(err.result.rationale).toBe("blocked");
		}
	});

	it("passes options to provider", async () => {
		const provider = makeProvider({ verdict: "approved", confidence: 0.9 });
		const options = { roles: ["security-lead"], consensusThreshold: 0.8 };
		await deliberateWithSabha("action", "context", provider, options);
		const call = (provider.deliberate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[2]).toMatchObject(options);
	});

	it("normalizes 'approve' to 'approved'", async () => {
		const provider = makeProvider({ verdict: "approve" as never });
		const result = await deliberateWithSabha("action", "context", provider);
		expect(result.verdict).toBe("approved");
	});

	it("normalizes unknown verdict to 'no-consensus'", async () => {
		const provider = makeProvider({ verdict: "maybe" as never });
		const result = await deliberateWithSabha("action", "context", provider);
		expect(result.verdict).toBe("no-consensus");
	});

	it("clamps confidence above 1 to 1", async () => {
		const provider = makeProvider({ verdict: "approved", confidence: 1.5 });
		const result = await deliberateWithSabha("action", "context", provider);
		expect(result.confidence).toBe(1);
	});

	it("clamps negative confidence to 0", async () => {
		const provider = makeProvider({ verdict: "approved", confidence: -0.3 });
		const result = await deliberateWithSabha("action", "context", provider);
		expect(result.confidence).toBe(0);
	});

	it("fallback rationale when provider returns empty string", async () => {
		const provider = makeProvider({ verdict: "approved", confidence: 0.8, rationale: "" });
		const result = await deliberateWithSabha("action", "context", provider);
		expect(result.rationale.length).toBeGreaterThan(0);
	});

	it("propagates provider errors (not SabhaRejectedError)", async () => {
		const provider: SabhaProvider = {
			deliberate: vi.fn().mockRejectedValue(new Error("LLM timeout")),
		};
		await expect(
			deliberateWithSabha("action", "context", provider),
		).rejects.toThrow("LLM timeout");
		// Not a SabhaRejectedError
		await expect(
			deliberateWithSabha("action", "context", provider),
		).rejects.not.toThrow(SabhaRejectedError);
	});
});

// ─── aggregatePerspectives ────────────────────────────────────────────────────

describe("aggregatePerspectives", () => {
	function makePerspective(position: "support" | "oppose" | "abstain", weight: number): SabhaDeliberatePerspective {
		return { role: "test", position, weight, reasoning: "" };
	}

	it("returns approved when support >= threshold", () => {
		const perspectives = [
			makePerspective("support", 0.9),
			makePerspective("support", 0.8),
			makePerspective("oppose", 0.3),
		];
		const result = aggregatePerspectives(perspectives, 0.67);
		expect(result.verdict).toBe("approved");
		expect(result.confidence).toBeGreaterThan(0.67);
	});

	it("returns rejected when oppose >= threshold", () => {
		const perspectives = [
			makePerspective("oppose", 0.9),
			makePerspective("oppose", 0.8),
			makePerspective("support", 0.2),
		];
		const result = aggregatePerspectives(perspectives, 0.67);
		expect(result.verdict).toBe("rejected");
		expect(result.confidence).toBeGreaterThan(0.67);
	});

	it("returns no-consensus when neither side reaches threshold", () => {
		const perspectives = [
			makePerspective("support", 0.5),
			makePerspective("oppose", 0.5),
		];
		const result = aggregatePerspectives(perspectives, 0.67);
		expect(result.verdict).toBe("no-consensus");
	});

	it("abstain votes do not count toward support or oppose", () => {
		const perspectives = [
			makePerspective("abstain", 1.0),
			makePerspective("abstain", 1.0),
			makePerspective("support", 0.5),
		];
		const result = aggregatePerspectives(perspectives, 0.67);
		// support is 0.5 / 2.5 = 0.2 — well below 0.67
		expect(result.verdict).toBe("no-consensus");
	});

	it("empty perspectives → no-consensus with 0 confidence", () => {
		const result = aggregatePerspectives([], 0.67);
		expect(result.verdict).toBe("no-consensus");
		expect(result.confidence).toBe(0);
	});

	it("clamps perspective weight to [0, 1] before computing", () => {
		const perspectives = [
			makePerspective("support", 5.0), // over 1 — clamps to 1
			makePerspective("oppose", 0.3),
		];
		const result = aggregatePerspectives(perspectives, 0.67);
		// effective: support=1, oppose=0.3, total=1.3 → support share = 1/1.3 ≈ 0.77 > 0.67
		expect(result.verdict).toBe("approved");
	});

	it("uses default threshold of 0.67 when not provided", () => {
		const perspectives = [
			makePerspective("support", 0.9),
			makePerspective("support", 0.8),
		];
		const result = aggregatePerspectives(perspectives); // no threshold arg
		expect(result.verdict).toBe("approved");
	});
});
