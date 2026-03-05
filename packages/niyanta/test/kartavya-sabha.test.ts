/**
 * Kartavya Sabha risk gate tests.
 *
 * Verifies that approveNiyamaWithSabha() correctly routes high-confidence
 * proposals through Sabha deliberation, and blocks or passes based on verdict.
 */

import { describe, it, expect, vi } from "vitest";
import { KartavyaEngine } from "../src/kartavya.js";
import { SabhaRejectedError } from "@chitragupta/sutra";
import type { SabhaProvider } from "../src/kartavya.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEngine(sabhaProvider?: SabhaProvider, sabhaRiskThreshold = 0.7) {
	return new KartavyaEngine({ sabhaProvider, sabhaRiskThreshold });
}

function makeProvider(verdict: "approved" | "rejected" | "no-consensus"): SabhaProvider {
	return {
		deliberate: vi.fn().mockResolvedValue({
			verdict,
			confidence: 0.8,
			rationale: `test: ${verdict}`,
		}),
	};
}

function proposeHighConf(engine: KartavyaEngine, confidence = 0.85) {
	return engine.proposeNiyama(
		"vasana-1", "auto-cleanup", "Remove stale temp files",
		{ type: "cron", condition: "0 3 * * *", cooldownMs: 300_000 },
		{ type: "command", payload: { cmd: "rm /tmp/stale" } },
		["temp files are stale", "disk usage >80%"],
		confidence,
	);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("KartavyaEngine.approveNiyamaWithSabha", () => {
	describe("no Sabha provider configured", () => {
		it("approves normally without Sabha when no provider", async () => {
			const engine = makeEngine(); // no sabhaProvider
			const proposal = proposeHighConf(engine, 0.85);
			const kartavya = await engine.approveNiyamaWithSabha(proposal.id);
			expect(kartavya.status).toBe("active");
			expect(kartavya.name).toBe("auto-cleanup");
		});
	});

	describe("Sabha provider configured", () => {
		it("consults Sabha for proposals above risk threshold", async () => {
			const provider = makeProvider("approved");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85); // 0.85 > 0.7 threshold
			await engine.approveNiyamaWithSabha(proposal.id);
			expect((provider.deliberate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
		});

		it("skips Sabha for proposals below risk threshold", async () => {
			const provider = makeProvider("approved");
			const engine = makeEngine(provider, 0.9); // high threshold
			const proposal = proposeHighConf(engine, 0.75); // 0.75 < 0.9 — no Sabha
			await engine.approveNiyamaWithSabha(proposal.id);
			expect((provider.deliberate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
		});

		it("passes topic and context to Sabha provider", async () => {
			const provider = makeProvider("approved");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85);
			await engine.approveNiyamaWithSabha(proposal.id);
			const [topic, context] = (provider.deliberate as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(topic).toBe("auto-cleanup");
			expect(context).toContain("Remove stale temp files");
			expect(context).toContain("0.850");
		});

		it("approves the kartavya when Sabha verdict is 'approved'", async () => {
			const provider = makeProvider("approved");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85);
			const kartavya = await engine.approveNiyamaWithSabha(proposal.id);
			expect(kartavya.status).toBe("active");
		});

		it("approves the kartavya when Sabha verdict is 'no-consensus'", async () => {
			const provider = makeProvider("no-consensus");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85);
			const kartavya = await engine.approveNiyamaWithSabha(proposal.id);
			expect(kartavya.status).toBe("active"); // no-consensus = cautious approval
		});

		it("throws SabhaRejectedError when Sabha verdict is 'rejected'", async () => {
			const provider = makeProvider("rejected");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85);
			await expect(
				engine.approveNiyamaWithSabha(proposal.id),
			).rejects.toThrow(SabhaRejectedError);
		});

		it("proposal stays pending after Sabha rejection", async () => {
			const provider = makeProvider("rejected");
			const engine = makeEngine(provider, 0.7);
			const proposal = proposeHighConf(engine, 0.85);
			try {
				await engine.approveNiyamaWithSabha(proposal.id);
			} catch {
				// expected
			}
			const pending = engine.getPendingNiyamas();
			expect(pending.find((p) => p.id === proposal.id)?.status).toBe("pending");
		});

		it("throws if niyamaId not found", async () => {
			const engine = makeEngine(makeProvider("approved"));
			await expect(
				engine.approveNiyamaWithSabha("nonexistent-id"),
			).rejects.toThrow("not found");
		});
	});
});
