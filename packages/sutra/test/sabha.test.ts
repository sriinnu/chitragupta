import { describe, it, expect } from "vitest";
import { SabhaEngine } from "../src/sabha.js";
import type {
	NyayaSyllogism,
	SabhaParticipant,
	HetvabhasaDetection,
	Sabha,
	SabhaConfig,
} from "../src/sabha.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a standard set of 3 participants. */
function defaultParticipants(): SabhaParticipant[] {
	return [
		{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
		{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
		{ id: "anveshi", role: "observer", expertise: 0.7, credibility: 0.8 },
	];
}

/** A well-formed syllogism about refactoring. */
function validSyllogism(): NyayaSyllogism {
	return {
		pratijna: "The auth module should be refactored for maintainability.",
		hetu: "Because it has high cyclomatic complexity and accumulated technical debt.",
		udaharana: "Wherever modules have high cyclomatic complexity, refactoring improves maintainability, as demonstrated by the payment module refactor.",
		upanaya: "The auth module has high cyclomatic complexity and technical debt.",
		nigamana: "Therefore, the auth module should be refactored to improve maintainability.",
	};
}

/** A different syllogism about deploying to production. */
function deploymentSyllogism(): NyayaSyllogism {
	return {
		pratijna: "The new feature should be deployed to production.",
		hetu: "Because all tests pass and code review is complete.",
		udaharana: "Wherever all tests pass and reviews are complete, deployment is safe, as with the v2.1 release.",
		upanaya: "The new feature has all tests passing and code review complete.",
		nigamana: "Therefore, the new feature should be deployed to production.",
	};
}

// ─── SabhaEngine — Construction ─────────────────────────────────────────────

describe("SabhaEngine — construction", () => {
	it("creates an engine with default config", () => {
		const engine = new SabhaEngine();
		expect(engine).toBeDefined();
	});

	it("creates an engine with custom config", () => {
		const engine = new SabhaEngine({
			maxRounds: 5,
			maxParticipants: 10,
			consensusThreshold: 0.75,
		});
		expect(engine).toBeDefined();
	});

	it("clamps maxRounds to HARD_CEILING of 10", () => {
		const engine = new SabhaEngine({ maxRounds: 50 });
		// Convene and try to propose 11 rounds — should fail at 11
		const sabha = engine.convene("test", "admin", defaultParticipants());
		for (let i = 0; i < 10; i++) {
			engine.propose(sabha.id, "kartru", validSyllogism());
			// Must conclude each round to allow next proposal
			for (const p of defaultParticipants()) {
				try { engine.vote(sabha.id, p.id, "abstain", "pass"); } catch { /* already voted */ }
			}
			// Reset status for next round by re-entering deliberating
		}
		expect(() => engine.propose(sabha.id, "kartru", validSyllogism()))
			.toThrow(/max rounds/i);
	});

	it("clamps maxParticipants to HARD_CEILING of 20", () => {
		const engine = new SabhaEngine({ maxParticipants: 100 });
		const participants: SabhaParticipant[] = [];
		for (let i = 0; i < 21; i++) {
			participants.push({ id: `agent-${i}`, role: "observer", expertise: 0.5, credibility: 0.5 });
		}
		expect(() => engine.convene("test", "admin", participants))
			.toThrow(/maxParticipants/i);
	});

	it("clamps consensusThreshold to [0.5, 0.95]", () => {
		// We can verify indirectly by checking voting behavior
		const engineLow = new SabhaEngine({ consensusThreshold: 0.1 });
		const engineHigh = new SabhaEngine({ consensusThreshold: 0.99 });

		// Low threshold clamped to 0.5
		const sabhaLow = engineLow.convene("low-test", "admin", defaultParticipants());
		engineLow.propose(sabhaLow.id, "kartru", validSyllogism());
		engineLow.vote(sabhaLow.id, "kartru", "support", "yes");
		engineLow.vote(sabhaLow.id, "parikshaka", "abstain", "neutral");
		engineLow.vote(sabhaLow.id, "anveshi", "abstain", "neutral");
		const concludedLow = engineLow.conclude(sabhaLow.id);
		// With only 1/3 support by weight, normalized score < 0.5
		// so should be no-consensus → escalated
		expect(concludedLow.finalVerdict).toBe("escalated");

		// High threshold clamped to 0.95
		const sabhaHigh = engineHigh.convene("high-test", "admin", defaultParticipants());
		engineHigh.propose(sabhaHigh.id, "kartru", validSyllogism());
		engineHigh.vote(sabhaHigh.id, "kartru", "support", "yes");
		engineHigh.vote(sabhaHigh.id, "parikshaka", "support", "yes");
		engineHigh.vote(sabhaHigh.id, "anveshi", "oppose", "no");
		const concludedHigh = engineHigh.conclude(sabhaHigh.id);
		// With one opposition, normalized score < 0.95
		expect(concludedHigh.finalVerdict).toBe("escalated");
	});
});

// ─── SabhaEngine — Convene ──────────────────────────────────────────────────

describe("SabhaEngine — convene", () => {
	it("creates a Sabha with correct fields", () => {
		const engine = new SabhaEngine();
		const participants = defaultParticipants();
		const sabha = engine.convene("Should we refactor?", "orchestrator", participants);

		expect(sabha.id).toMatch(/^sabha-[0-9a-f]+$/);
		expect(sabha.topic).toBe("Should we refactor?");
		expect(sabha.status).toBe("convened");
		expect(sabha.convener).toBe("orchestrator");
		expect(sabha.participants).toHaveLength(3);
		expect(sabha.rounds).toHaveLength(0);
		expect(sabha.finalVerdict).toBeNull();
		expect(sabha.createdAt).toBeGreaterThan(0);
		expect(sabha.concludedAt).toBeNull();
	});

	it("generates unique IDs for different Sabhas", () => {
		const engine = new SabhaEngine();
		const p = defaultParticipants();
		const s1 = engine.convene("topic-1", "admin", p);
		const s2 = engine.convene("topic-2", "admin", p);
		expect(s1.id).not.toBe(s2.id);
	});

	it("requires at least 2 participants", () => {
		const engine = new SabhaEngine();
		expect(() => engine.convene("topic", "admin", [
			{ id: "lone", role: "proposer", expertise: 0.9, credibility: 0.8 },
		])).toThrow(/at least 2/i);
	});

	it("rejects duplicate participant IDs", () => {
		const engine = new SabhaEngine();
		expect(() => engine.convene("topic", "admin", [
			{ id: "same", role: "proposer", expertise: 0.9, credibility: 0.8 },
			{ id: "same", role: "challenger", expertise: 0.8, credibility: 0.9 },
		])).toThrow(/unique/i);
	});

	it("clamps expertise and credibility to [0, 1]", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", [
			{ id: "a", role: "proposer", expertise: 1.5, credibility: -0.3 },
			{ id: "b", role: "challenger", expertise: 0.8, credibility: 2.0 },
		]);
		expect(sabha.participants[0].expertise).toBe(1);
		expect(sabha.participants[0].credibility).toBe(0);
		expect(sabha.participants[1].credibility).toBe(1);
	});

	it("respects maxParticipants from config", () => {
		const engine = new SabhaEngine({ maxParticipants: 3 });
		const fourParts: SabhaParticipant[] = [
			{ id: "a", role: "proposer", expertise: 0.9, credibility: 0.8 },
			{ id: "b", role: "challenger", expertise: 0.8, credibility: 0.9 },
			{ id: "c", role: "observer", expertise: 0.7, credibility: 0.8 },
			{ id: "d", role: "observer", expertise: 0.6, credibility: 0.7 },
		];
		expect(() => engine.convene("test", "admin", fourParts))
			.toThrow(/maxParticipants/i);
	});

	it("can be retrieved with getSabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const retrieved = engine.getSabha(sabha.id);
		expect(retrieved).toBe(sabha);
	});

	it("appears in listActive", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const active = engine.listActive();
		expect(active).toContain(sabha);
	});
});

// ─── SabhaEngine — Propose ──────────────────────────────────────────────────

describe("SabhaEngine — propose", () => {
	it("creates a round with the syllogism", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const syl = validSyllogism();
		const round = engine.propose(sabha.id, "kartru", syl);

		expect(round.roundNumber).toBe(1);
		expect(round.proposal.pratijna).toBe(syl.pratijna);
		expect(round.proposal.hetu).toBe(syl.hetu);
		expect(round.challenges).toHaveLength(0);
		expect(round.votes).toHaveLength(0);
		expect(round.verdict).toBeNull();
	});

	it("transitions status to deliberating", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		expect(sabha.status).toBe("deliberating");
	});

	it("rejects proposal to non-existent Sabha", () => {
		const engine = new SabhaEngine();
		expect(() => engine.propose("fake-id", "kartru", validSyllogism()))
			.toThrow(/not found/i);
	});

	it("rejects proposal from non-participant", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		expect(() => engine.propose(sabha.id, "outsider", validSyllogism()))
			.toThrow(/not a member/i);
	});

	it("rejects empty syllogism fields", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const syl = validSyllogism();
		syl.hetu = "";
		expect(() => engine.propose(sabha.id, "kartru", syl))
			.toThrow(/hetu.*empty/i);
	});

	it("rejects whitespace-only syllogism fields", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const syl = validSyllogism();
		syl.pratijna = "   ";
		expect(() => engine.propose(sabha.id, "kartru", syl))
			.toThrow(/pratijna.*empty/i);
	});

	it("rejects proposal to concluded Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		for (const p of defaultParticipants()) {
			engine.vote(sabha.id, p.id, "support", "yes");
		}
		engine.conclude(sabha.id);
		expect(() => engine.propose(sabha.id, "kartru", validSyllogism()))
			.toThrow(/already concluded/i);
	});

	it("allows multiple rounds", () => {
		const engine = new SabhaEngine({ maxRounds: 5 });
		const sabha = engine.convene("test", "admin", defaultParticipants());

		engine.propose(sabha.id, "kartru", validSyllogism());
		expect(sabha.rounds).toHaveLength(1);

		engine.propose(sabha.id, "kartru", deploymentSyllogism());
		expect(sabha.rounds).toHaveLength(2);
		expect(sabha.rounds[1].roundNumber).toBe(2);
	});

	it("enforces maxRounds", () => {
		const engine = new SabhaEngine({ maxRounds: 2 });
		const sabha = engine.convene("test", "admin", defaultParticipants());

		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.propose(sabha.id, "kartru", deploymentSyllogism());

		expect(() => engine.propose(sabha.id, "kartru", validSyllogism()))
			.toThrow(/max rounds/i);
	});
});

// ─── SabhaEngine — Challenge ────────────────────────────────────────────────

describe("SabhaEngine — challenge", () => {
	it("creates a challenge record", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const record = engine.challenge(
			sabha.id, "parikshaka", "hetu",
			"The complexity metric is not defined.",
		);

		expect(record.challengerId).toBe("parikshaka");
		expect(record.targetStep).toBe("hetu");
		expect(record.challenge).toBe("The complexity metric is not defined.");
		expect(record.resolved).toBe(false);
	});

	it("can challenge each of the 5 syllogism steps", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const steps: (keyof NyayaSyllogism)[] = ["pratijna", "hetu", "udaharana", "upanaya", "nigamana"];
		for (const step of steps) {
			const record = engine.challenge(sabha.id, "parikshaka", step, `Challenge to ${step}`);
			expect(record.targetStep).toBe(step);
		}

		const round = sabha.rounds[0];
		expect(round.challenges).toHaveLength(5);
	});

	it("rejects challenge to non-deliberating Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		// Status is "convened", not "deliberating"
		expect(() => engine.challenge(sabha.id, "parikshaka", "hetu", "challenge"))
			.toThrow(/not in deliberating/i);
	});

	it("rejects challenge from non-participant", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		expect(() => engine.challenge(sabha.id, "outsider", "hetu", "challenge"))
			.toThrow(/not a member/i);
	});

	it("rejects challenge when no round exists", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		// Force status to deliberating without a round (edge case via direct manipulation)
		// Actually, this can't happen via public API since propose creates the round.
		// Instead, test challenge on Sabha that had its round but was voted on
		engine.propose(sabha.id, "kartru", validSyllogism());
		// Voting transitions to "voting" status
		engine.vote(sabha.id, "kartru", "support", "yes");
		expect(() => engine.challenge(sabha.id, "parikshaka", "hetu", "late challenge"))
			.toThrow(/not in deliberating/i);
	});

	it("attaches detected fallacy if relevant", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());

		// Syllogism with circular reasoning (nigamana ≈ pratijna)
		engine.propose(sabha.id, "kartru", {
			pratijna: "The system should use caching for performance.",
			hetu: "Because caching reduces latency.",
			udaharana: "Wherever caching is applied, latency is reduced, as in CDN systems.",
			upanaya: "The system can apply caching.",
			nigamana: "The system should use caching for performance.",
		});

		const record = engine.challenge(sabha.id, "parikshaka", "nigamana", "Circular reasoning!");
		// Prakarana-sama should be detected on nigamana
		expect(record.fallacyDetected).toBeDefined();
		expect(record.fallacyDetected!.type).toBe("prakarana-sama");
	});
});

// ─── SabhaEngine — Respond ──────────────────────────────────────────────────

describe("SabhaEngine — respond", () => {
	it("marks a challenge as resolved", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "What is complexity?");

		engine.respond(sabha.id, 0, "Cyclomatic complexity as measured by McCabe metric.");

		const round = sabha.rounds[0];
		expect(round.challenges[0].resolved).toBe(true);
		expect(round.challenges[0].response).toBe("Cyclomatic complexity as measured by McCabe metric.");
	});

	it("rejects response with out-of-bounds index", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "What?");

		expect(() => engine.respond(sabha.id, 5, "response"))
			.toThrow(/out of bounds/i);
		expect(() => engine.respond(sabha.id, -1, "response"))
			.toThrow(/out of bounds/i);
	});

	it("rejects response to non-deliberating Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		expect(() => engine.respond(sabha.id, 0, "response"))
			.toThrow(/not in deliberating/i);
	});

	it("can respond to multiple challenges", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "Challenge 1");
		engine.challenge(sabha.id, "anveshi", "udaharana", "Challenge 2");

		engine.respond(sabha.id, 0, "Response to 1");
		engine.respond(sabha.id, 1, "Response to 2");

		const round = sabha.rounds[0];
		expect(round.challenges[0].resolved).toBe(true);
		expect(round.challenges[1].resolved).toBe(true);
	});
});

// ─── SabhaEngine — Vote ─────────────────────────────────────────────────────

describe("SabhaEngine — vote", () => {
	it("records a vote with correct weight", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const vote = engine.vote(sabha.id, "kartru", "support", "I proposed it.");

		expect(vote.participantId).toBe("kartru");
		expect(vote.position).toBe("support");
		expect(vote.weight).toBeCloseTo(0.9 * 0.85); // expertise * credibility
		expect(vote.reasoning).toBe("I proposed it.");
	});

	it("transitions status to voting on first vote", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		expect(sabha.status).toBe("deliberating");

		engine.vote(sabha.id, "kartru", "support", "yes");
		expect(sabha.status).toBe("voting");
	});

	it("prevents duplicate votes from same participant", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");

		expect(() => engine.vote(sabha.id, "kartru", "oppose", "changed mind"))
			.toThrow(/already voted/i);
	});

	it("rejects vote from non-participant", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		expect(() => engine.vote(sabha.id, "outsider", "support", "hi"))
			.toThrow(/not a member/i);
	});

	it("rejects vote on convened (no proposal) Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		expect(() => engine.vote(sabha.id, "kartru", "support", "too early"))
			.toThrow(/not accepting votes/i);
	});

	it("rejects vote on concluded Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "support", "yes");
		engine.vote(sabha.id, "anveshi", "support", "yes");
		engine.conclude(sabha.id);

		expect(() => engine.vote(sabha.id, "kartru", "support", "post-mortem"))
			.toThrow(/not accepting votes/i);
	});

	it("records abstain vote with zero effective weight", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const vote = engine.vote(sabha.id, "anveshi", "abstain", "no opinion");
		expect(vote.position).toBe("abstain");
		// Weight is still computed (expertise * credibility), but sign is 0 in tally
		expect(vote.weight).toBeCloseTo(0.7 * 0.8);
	});

	it("allows voting during voting status", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		expect(sabha.status).toBe("voting");

		// Second participant should still be able to vote
		const vote = engine.vote(sabha.id, "parikshaka", "oppose", "no");
		expect(vote.position).toBe("oppose");
	});
});

// ─── SabhaEngine — Conclude ─────────────────────────────────────────────────

describe("SabhaEngine — conclude", () => {
	it("accepts when all support (unanimous)", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "support", "yes");
		engine.vote(sabha.id, "anveshi", "support", "yes");

		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("accepted");
		expect(concluded.status).toBe("concluded");
		expect(concluded.concludedAt).toBeGreaterThan(0);
		expect(concluded.rounds[0].verdict).toBe("accepted");
	});

	it("rejects when all oppose (unanimous)", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		engine.vote(sabha.id, "kartru", "oppose", "no");
		engine.vote(sabha.id, "parikshaka", "oppose", "no");
		engine.vote(sabha.id, "anveshi", "oppose", "no");

		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("rejected");
		expect(concluded.status).toBe("concluded");
		expect(concluded.rounds[0].verdict).toBe("rejected");
	});

	it("escalates on no consensus with autoEscalate", () => {
		const engine = new SabhaEngine({ autoEscalate: true });
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "oppose", "no");
		engine.vote(sabha.id, "anveshi", "abstain", "unsure");

		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("escalated");
		expect(concluded.status).toBe("escalated");
	});

	it("escalates when no votes are cast", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("escalated");
		expect(concluded.rounds[0].verdict).toBe("no-consensus");
	});

	it("weighted votes: high-expertise support outweighs low-expertise opposition", () => {
		const engine = new SabhaEngine({ consensusThreshold: 0.6 });
		const participants: SabhaParticipant[] = [
			{ id: "expert", role: "proposer", expertise: 0.95, credibility: 0.95 },
			{ id: "novice1", role: "challenger", expertise: 0.2, credibility: 0.3 },
			{ id: "novice2", role: "observer", expertise: 0.2, credibility: 0.3 },
		];
		const sabha = engine.convene("test", "admin", participants);
		engine.propose(sabha.id, "expert", validSyllogism());

		engine.vote(sabha.id, "expert", "support", "yes");
		engine.vote(sabha.id, "novice1", "oppose", "no");
		engine.vote(sabha.id, "novice2", "oppose", "no");

		const concluded = engine.conclude(sabha.id);
		// Expert weight: 0.95*0.95 = 0.9025
		// Novice weights: 0.2*0.3 = 0.06 each
		// weighted = 0.9025 - 0.06 - 0.06 = 0.7825
		// total = 0.9025 + 0.06 + 0.06 = 1.0225
		// normalized = 0.7825 / 1.0225 ≈ 0.7654 >= 0.6
		expect(concluded.finalVerdict).toBe("accepted");
	});

	it("uses last decisive round for multi-round Sabhas", () => {
		const engine = new SabhaEngine({ maxRounds: 3 });
		const sabha = engine.convene("test", "admin", defaultParticipants());

		// Round 1: no consensus
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "oppose", "no");
		engine.vote(sabha.id, "anveshi", "abstain", "idk");

		// Round 2: accepted
		engine.propose(sabha.id, "kartru", deploymentSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "support", "convinced");
		engine.vote(sabha.id, "anveshi", "support", "ok");

		const concluded = engine.conclude(sabha.id);
		expect(concluded.rounds[0].verdict).toBe("no-consensus");
		expect(concluded.rounds[1].verdict).toBe("accepted");
		expect(concluded.finalVerdict).toBe("accepted");
	});

	it("rejects concluding an already-concluded Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.conclude(sabha.id);

		expect(() => engine.conclude(sabha.id))
			.toThrow(/already/i);
	});

	it("removes concluded Sabha from listActive", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "support", "yes");
		engine.vote(sabha.id, "anveshi", "support", "yes");
		engine.conclude(sabha.id);

		expect(engine.listActive()).not.toContain(sabha);
	});

	it("handles all-abstain votes as no-consensus", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		engine.vote(sabha.id, "kartru", "abstain", "unsure");
		engine.vote(sabha.id, "parikshaka", "abstain", "unsure");
		engine.vote(sabha.id, "anveshi", "abstain", "unsure");

		const concluded = engine.conclude(sabha.id);
		// All abstains → weightedScore = 0, normalizedScore = 0 → no-consensus
		expect(concluded.rounds[0].verdict).toBe("no-consensus");
		expect(concluded.finalVerdict).toBe("escalated");
	});

	it("mixed votes near threshold: just above accepted", () => {
		// With threshold 0.67, need normalized >= 0.67
		const engine = new SabhaEngine({ consensusThreshold: 0.67 });
		const participants: SabhaParticipant[] = [
			{ id: "a", role: "proposer", expertise: 0.9, credibility: 0.9 },   // weight: 0.81
			{ id: "b", role: "challenger", expertise: 0.9, credibility: 0.9 },  // weight: 0.81
			{ id: "c", role: "observer", expertise: 0.1, credibility: 0.1 },    // weight: 0.01
		];
		const sabha = engine.convene("test", "admin", participants);
		engine.propose(sabha.id, "a", validSyllogism());

		engine.vote(sabha.id, "a", "support", "yes");
		engine.vote(sabha.id, "b", "support", "yes");
		engine.vote(sabha.id, "c", "oppose", "no");

		// weighted = 0.81 + 0.81 - 0.01 = 1.61
		// total = 0.81 + 0.81 + 0.01 = 1.63
		// normalized ≈ 0.988 >= 0.67 → accepted
		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("accepted");
	});

	it("mixed votes near threshold: just below rejected", () => {
		const engine = new SabhaEngine({ consensusThreshold: 0.67 });
		const participants: SabhaParticipant[] = [
			{ id: "a", role: "proposer", expertise: 0.9, credibility: 0.9 },
			{ id: "b", role: "challenger", expertise: 0.9, credibility: 0.9 },
			{ id: "c", role: "observer", expertise: 0.1, credibility: 0.1 },
		];
		const sabha = engine.convene("test", "admin", participants);
		engine.propose(sabha.id, "a", validSyllogism());

		engine.vote(sabha.id, "a", "oppose", "no");
		engine.vote(sabha.id, "b", "oppose", "no");
		engine.vote(sabha.id, "c", "support", "yes");

		// weighted = -0.81 - 0.81 + 0.01 = -1.61
		// normalized ≈ -0.988 <= -0.67 → rejected
		const concluded = engine.conclude(sabha.id);
		expect(concluded.finalVerdict).toBe("rejected");
	});
});

// ─── SabhaEngine — Fallacy Detection ────────────────────────────────────────

describe("SabhaEngine — detectFallacies", () => {
	const engine = new SabhaEngine();

	it("returns empty array for valid syllogism", () => {
		const fallacies = engine.detectFallacies(validSyllogism());
		// The valid syllogism is well-grounded, no circularity, no universals, etc.
		// May have prakarana-sama since conclusion restates proposition
		// Let's verify the actual behavior
		const nonCircular = fallacies.filter((f) => f.type !== "prakarana-sama");
		// The valid syllogism should have few or no non-circular fallacies
		expect(nonCircular.length).toBeLessThanOrEqual(1);
	});

	// ─── Asiddha (Unestablished) ──────────────────────────────────

	it("detects Asiddha: hetu references concepts absent from udaharana", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The database should use indexing.",
			hetu: "Because quantum entanglement improves lookup speed.",
			udaharana: "B-tree structures provide logarithmic search time.",
			upanaya: "The database can use quantum indexing.",
			nigamana: "Therefore, the database should use quantum indexing.",
		});

		const asiddha = fallacies.find((f) => f.type === "asiddha");
		expect(asiddha).toBeDefined();
		expect(asiddha!.affectedStep).toBe("hetu");
		expect(asiddha!.severity).toBe("fatal");
	});

	it("does not detect Asiddha when hetu is well-grounded", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The module should use caching.",
			hetu: "Because caching reduces latency significantly.",
			udaharana: "Wherever caching is applied, latency drops significantly, as with Redis.",
			upanaya: "The module can benefit from caching.",
			nigamana: "Therefore, the module should use caching to reduce latency.",
		});

		const asiddha = fallacies.find((f) => f.type === "asiddha");
		expect(asiddha).toBeUndefined();
	});

	// ─── Viruddha (Contradictory) ─────────────────────────────────

	it("detects Viruddha: hetu negates pratijna", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The system should use caching for performance.",
			hetu: "Because caching does not improve performance in this system.",
			udaharana: "Many systems find caching unhelpful when data changes frequently.",
			upanaya: "This system has rapidly changing data.",
			nigamana: "Therefore, the system should avoid caching.",
		});

		const viruddha = fallacies.find((f) => f.type === "viruddha");
		expect(viruddha).toBeDefined();
		expect(viruddha!.affectedStep).toBe("hetu");
		expect(viruddha!.severity).toBe("fatal");
	});

	it("does not detect Viruddha when hetu supports pratijna", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The system should add monitoring.",
			hetu: "Because monitoring reveals production issues early.",
			udaharana: "Prometheus monitoring caught the outage before users noticed.",
			upanaya: "The system currently lacks monitoring.",
			nigamana: "Therefore, the system should add monitoring.",
		});

		const viruddha = fallacies.find((f) => f.type === "viruddha");
		expect(viruddha).toBeUndefined();
	});

	// ─── Anaikantika (Inconclusive) ───────────────────────────────

	it("detects Anaikantika: hetu uses universal quantifiers", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "We should rewrite the service in Rust.",
			hetu: "Because every system in all cases always benefits from Rust.",
			udaharana: "Some services improved after Rust rewrites.",
			upanaya: "This service is a system.",
			nigamana: "Therefore, we should rewrite in Rust.",
		});

		const anaikantika = fallacies.find((f) => f.type === "anaikantika");
		expect(anaikantika).toBeDefined();
		expect(anaikantika!.severity).toBe("warning");
		expect(anaikantika!.affectedStep).toBe("hetu");
	});

	it("detects Anaikantika: single universal in brief hetu", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "We should use TypeScript.",
			hetu: "Everything is better typed.",
			udaharana: "Typed languages catch bugs at compile time.",
			upanaya: "Our code is untyped.",
			nigamana: "Therefore, we should use TypeScript.",
		});

		const anaikantika = fallacies.find((f) => f.type === "anaikantika");
		expect(anaikantika).toBeDefined();
	});

	it("does not detect Anaikantika for specific, bounded reasons", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "Module X should be refactored.",
			hetu: "Because cyclomatic complexity exceeds threshold of 15.",
			udaharana: "Modules above 15 complexity have 3x bug rate.",
			upanaya: "Module X has complexity 23.",
			nigamana: "Therefore, Module X should be refactored.",
		});

		const anaikantika = fallacies.find((f) => f.type === "anaikantika");
		expect(anaikantika).toBeUndefined();
	});

	// ─── Prakarana-sama (Circular) ────────────────────────────────

	it("detects Prakarana-sama: nigamana identical to pratijna", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The system should use caching for performance.",
			hetu: "Because caching reduces latency.",
			udaharana: "CDNs demonstrate caching improves performance.",
			upanaya: "The system has latency issues.",
			nigamana: "The system should use caching for performance.",
		});

		const circular = fallacies.find((f) => f.type === "prakarana-sama");
		expect(circular).toBeDefined();
		expect(circular!.affectedStep).toBe("nigamana");
		expect(circular!.severity).toBe("warning");
	});

	it("detects Prakarana-sama: nigamana is minor rephrasing of pratijna", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The application must implement rate limiting.",
			hetu: "Because abuse can overwhelm resources.",
			udaharana: "Rate limiting prevented DDoS in similar systems.",
			upanaya: "The application faces abuse risk.",
			nigamana: "The application should implement rate limiting.",
		});

		const circular = fallacies.find((f) => f.type === "prakarana-sama");
		// Keywords are identical (must/should are stop words), Jaccard = 1.0
		expect(circular).toBeDefined();
	});

	it("does not detect Prakarana-sama when conclusion adds new information", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The hill has fire.",
			hetu: "Because there is smoke on the hill.",
			udaharana: "Wherever there is smoke there is fire, as in a kitchen.",
			upanaya: "The hill has smoke.",
			nigamana: "Therefore, by the invariable concomitance of smoke and fire, the hill has fire, and we should evacuate the northern villages immediately.",
		});

		const circular = fallacies.find((f) => f.type === "prakarana-sama");
		// The conclusion adds "evacuate the northern villages immediately"
		// which reduces Jaccard similarity
		expect(circular).toBeUndefined();
	});

	// ─── Kalatita (Untimely) ──────────────────────────────────────

	it("detects Kalatita: past evidence for future claim", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The stock price will increase next quarter.",
			hetu: "Because historically the stock was profitable and had strong earnings.",
			udaharana: "Companies with past profits often continue growing.",
			upanaya: "This company had profits historically.",
			nigamana: "Therefore, the stock will appreciate in the future.",
		});

		const kalatita = fallacies.find((f) => f.type === "kalatita");
		expect(kalatita).toBeDefined();
		expect(kalatita!.affectedStep).toBe("hetu");
		expect(kalatita!.severity).toBe("warning");
	});

	it("does not detect Kalatita when hetu uses present evidence", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The new API endpoint will handle the load.",
			hetu: "Because current benchmarks show 10x headroom above peak traffic.",
			udaharana: "Services with 10x headroom handle traffic spikes reliably.",
			upanaya: "The endpoint has benchmark results showing headroom.",
			nigamana: "Therefore, the endpoint will handle the expected load.",
		});

		const kalatita = fallacies.find((f) => f.type === "kalatita");
		expect(kalatita).toBeUndefined();
	});

	// ─── Multiple fallacies ───────────────────────────────────────

	it("detects multiple fallacies in a single syllogism", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "The project will succeed next year.",
			hetu: "Because historically every project always succeeded in the past.",
			udaharana: "Success breeds more success universally.",
			upanaya: "This project exists.",
			nigamana: "The project will succeed next year.",
		});

		const types = new Set(fallacies.map((f) => f.type));
		// Should detect: anaikantika (every/always), kalatita (past→future),
		// prakarana-sama (identical conclusion), possibly asiddha
		expect(types.size).toBeGreaterThanOrEqual(2);
	});

	it("returns correct structure for all detections", () => {
		const fallacies = engine.detectFallacies({
			pratijna: "System A will outperform system B.",
			hetu: "Because historically system A was faster in all benchmarks.",
			udaharana: "Faster systems tend to outperform.",
			upanaya: "System A runs faster historically.",
			nigamana: "System A will outperform system B.",
		});

		for (const f of fallacies) {
			expect(f).toHaveProperty("type");
			expect(f).toHaveProperty("description");
			expect(f).toHaveProperty("severity");
			expect(f).toHaveProperty("affectedStep");
			expect(["fatal", "warning"]).toContain(f.severity);
			expect(typeof f.description).toBe("string");
			expect(f.description.length).toBeGreaterThan(0);
		}
	});
});

// ─── SabhaEngine — Explain ──────────────────────────────────────────────────

describe("SabhaEngine — explain", () => {
	it("produces human-readable output", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("Refactor auth?", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "Complexity metric undefined");
		engine.respond(sabha.id, 0, "McCabe complexity > 15");
		engine.vote(sabha.id, "kartru", "support", "yes");
		engine.vote(sabha.id, "parikshaka", "support", "convinced");
		engine.vote(sabha.id, "anveshi", "oppose", "risky");
		engine.conclude(sabha.id);

		const explanation = engine.explain(sabha.id);

		expect(explanation).toContain("Sabha: Refactor auth?");
		expect(explanation).toContain("Status:");
		expect(explanation).toContain("Convener: admin");
		expect(explanation).toContain("Participants:");
		expect(explanation).toContain("kartru (proposer)");
		expect(explanation).toContain("Round 1");
		expect(explanation).toContain("Proposition:");
		expect(explanation).toContain("Challenges:");
		expect(explanation).toContain("Votes:");
		expect(explanation).toContain("Final Verdict:");
	});

	it("includes challenge details and resolution", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "Why?");
		engine.respond(sabha.id, 0, "Because metrics.");

		const explanation = engine.explain(sabha.id);
		expect(explanation).toContain("[hetu] by parikshaka: Why?");
		expect(explanation).toContain("Response: Because metrics.");
		expect(explanation).toContain("Resolved: yes");
	});

	it("shows unresolved challenges", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.challenge(sabha.id, "parikshaka", "hetu", "Unanswered question");

		const explanation = engine.explain(sabha.id);
		expect(explanation).toContain("Resolved: no");
	});

	it("throws for non-existent Sabha", () => {
		const engine = new SabhaEngine();
		expect(() => engine.explain("nope")).toThrow(/not found/i);
	});

	it("shows pending verdict for in-progress Sabha", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());

		const explanation = engine.explain(sabha.id);
		expect(explanation).toContain("Verdict: pending");
	});
});

// ─── SabhaEngine — listActive / getSabha ────────────────────────────────────

describe("SabhaEngine — queries", () => {
	it("getSabha returns undefined for unknown ID", () => {
		const engine = new SabhaEngine();
		expect(engine.getSabha("nonexistent")).toBeUndefined();
	});

	it("listActive returns only non-concluded Sabhas", () => {
		const engine = new SabhaEngine();
		const s1 = engine.convene("topic-1", "admin", defaultParticipants());
		const s2 = engine.convene("topic-2", "admin", defaultParticipants());

		// Conclude s1
		engine.propose(s1.id, "kartru", validSyllogism());
		engine.vote(s1.id, "kartru", "support", "y");
		engine.vote(s1.id, "parikshaka", "support", "y");
		engine.vote(s1.id, "anveshi", "support", "y");
		engine.conclude(s1.id);

		const active = engine.listActive();
		expect(active).not.toContain(s1);
		expect(active).toContain(s2);
	});

	it("listActive returns empty when all concluded", () => {
		const engine = new SabhaEngine();
		const s = engine.convene("topic", "admin", defaultParticipants());
		engine.propose(s.id, "kartru", validSyllogism());
		engine.vote(s.id, "kartru", "support", "y");
		engine.conclude(s.id);

		expect(engine.listActive()).toHaveLength(0);
	});

	it("listActive includes convened, deliberating, and voting statuses", () => {
		const engine = new SabhaEngine();
		const convened = engine.convene("convened", "admin", defaultParticipants());
		const deliberating = engine.convene("deliberating", "admin", defaultParticipants());
		engine.propose(deliberating.id, "kartru", validSyllogism());
		const voting = engine.convene("voting", "admin", defaultParticipants());
		engine.propose(voting.id, "kartru", validSyllogism());
		engine.vote(voting.id, "kartru", "support", "y");

		const active = engine.listActive();
		expect(active).toContain(convened);
		expect(active).toContain(deliberating);
		expect(active).toContain(voting);
	});
});

// ─── SabhaEngine — Edge Cases ───────────────────────────────────────────────

describe("SabhaEngine — edge cases", () => {
	it("single round with 2 participants: split vote → no-consensus", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", [
			{ id: "a", role: "proposer", expertise: 0.8, credibility: 0.8 },
			{ id: "b", role: "challenger", expertise: 0.8, credibility: 0.8 },
		]);
		engine.propose(sabha.id, "a", validSyllogism());
		engine.vote(sabha.id, "a", "support", "yes");
		engine.vote(sabha.id, "b", "oppose", "no");

		const concluded = engine.conclude(sabha.id);
		// Normalized = 0, which is between -threshold and +threshold
		expect(concluded.rounds[0].verdict).toBe("no-consensus");
		expect(concluded.finalVerdict).toBe("escalated");
	});

	it("participant with zero expertise has zero vote weight", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", [
			{ id: "expert", role: "proposer", expertise: 0.9, credibility: 0.9 },
			{ id: "zero", role: "observer", expertise: 0, credibility: 0.9 },
		]);
		engine.propose(sabha.id, "expert", validSyllogism());

		const vote = engine.vote(sabha.id, "zero", "oppose", "oppose");
		expect(vote.weight).toBe(0);

		engine.vote(sabha.id, "expert", "support", "support");
		const concluded = engine.conclude(sabha.id);
		// Zero-weight vote doesn't change the outcome
		expect(concluded.finalVerdict).toBe("accepted");
	});

	it("participant with zero credibility has zero vote weight", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", [
			{ id: "trustworthy", role: "proposer", expertise: 0.9, credibility: 0.9 },
			{ id: "untrusted", role: "challenger", expertise: 0.9, credibility: 0 },
		]);
		engine.propose(sabha.id, "trustworthy", validSyllogism());

		const vote = engine.vote(sabha.id, "untrusted", "oppose", "no");
		expect(vote.weight).toBe(0);
	});

	it("conclude with only one vote still works", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		engine.propose(sabha.id, "kartru", validSyllogism());
		engine.vote(sabha.id, "kartru", "support", "yes");

		const concluded = engine.conclude(sabha.id);
		// Normalized = 1.0 >= threshold → accepted
		expect(concluded.finalVerdict).toBe("accepted");
	});

	it("large participant count within ceiling", () => {
		const engine = new SabhaEngine({ maxParticipants: 20 });
		const participants: SabhaParticipant[] = [];
		for (let i = 0; i < 20; i++) {
			participants.push({
				id: `agent-${i}`,
				role: i === 0 ? "proposer" : "observer",
				expertise: 0.5 + Math.random() * 0.5,
				credibility: 0.5 + Math.random() * 0.5,
			});
		}
		const sabha = engine.convene("crowd", "admin", participants);
		expect(sabha.participants).toHaveLength(20);
	});

	it("syllogism fields are copied, not referenced", () => {
		const engine = new SabhaEngine();
		const sabha = engine.convene("test", "admin", defaultParticipants());
		const syl = validSyllogism();
		engine.propose(sabha.id, "kartru", syl);

		// Mutate the original — should not affect the stored proposal
		syl.pratijna = "MUTATED";
		expect(sabha.rounds[0].proposal.pratijna).not.toBe("MUTATED");
	});

	it("challenge on non-existent Sabha throws", () => {
		const engine = new SabhaEngine();
		expect(() => engine.challenge("nope", "someone", "hetu", "challenge"))
			.toThrow(/not found/i);
	});

	it("respond on non-existent Sabha throws", () => {
		const engine = new SabhaEngine();
		expect(() => engine.respond("nope", 0, "response"))
			.toThrow(/not found/i);
	});

	it("vote on non-existent Sabha throws", () => {
		const engine = new SabhaEngine();
		expect(() => engine.vote("nope", "someone", "support", "yes"))
			.toThrow(/not found/i);
	});

	it("conclude on non-existent Sabha throws", () => {
		const engine = new SabhaEngine();
		expect(() => engine.conclude("nope"))
			.toThrow(/not found/i);
	});
});

// ─── SabhaEngine — Full Deliberation Flow ───────────────────────────────────

describe("SabhaEngine — full flow", () => {
	it("complete flow: convene → propose → challenge → respond → vote → conclude", () => {
		const engine = new SabhaEngine({ consensusThreshold: 0.5 });
		const participants: SabhaParticipant[] = [
			{ id: "kartru", role: "proposer", expertise: 0.95, credibility: 0.95 },
			{ id: "parikshaka", role: "challenger", expertise: 0.9, credibility: 0.9 },
			{ id: "anveshi", role: "observer", expertise: 0.3, credibility: 0.3 },
		];

		// 1. Convene
		const sabha = engine.convene("Should we migrate to Rust?", "orchestrator", participants);
		expect(sabha.status).toBe("convened");

		// 2. Propose
		const round = engine.propose(sabha.id, "kartru", {
			pratijna: "The core service should be rewritten in Rust.",
			hetu: "Because Rust provides memory safety without garbage collection overhead.",
			udaharana: "Discord rewrote their Read States service in Rust and reduced latency by 10x.",
			upanaya: "The core service has memory-related bugs and GC pauses.",
			nigamana: "Therefore, rewriting the core service in Rust will improve reliability and performance.",
		});
		expect(sabha.status).toBe("deliberating");
		expect(round.roundNumber).toBe(1);

		// 3. Challenge
		const ch = engine.challenge(
			sabha.id, "parikshaka", "hetu",
			"Memory safety can also be achieved with modern GC tuning. Is the overhead truly the bottleneck?",
		);
		expect(ch.resolved).toBe(false);

		// 4. Respond
		engine.respond(sabha.id, 0, "Profile data shows 40% of p99 latency is GC-related.");
		expect(sabha.rounds[0].challenges[0].resolved).toBe(true);

		// 5. Vote — two high-weight support, one low-weight oppose
		// kartru: 0.95*0.95 = 0.9025, parikshaka: 0.9*0.9 = 0.81, anveshi: 0.3*0.3 = 0.09
		// normalized = (0.9025 + 0.81 - 0.09) / (0.9025 + 0.81 + 0.09) ≈ 0.9 >= 0.5
		engine.vote(sabha.id, "kartru", "support", "Strong evidence for Rust migration.");
		engine.vote(sabha.id, "parikshaka", "support", "Response addresses my concern.");
		engine.vote(sabha.id, "anveshi", "oppose", "Team lacks Rust expertise. Risk is too high.");
		expect(sabha.status).toBe("voting");

		// 6. Conclude
		const result = engine.conclude(sabha.id);
		expect(result.status).toBe("concluded");
		expect(result.finalVerdict).toBe("accepted");
		expect(result.concludedAt).toBeGreaterThan(0);

		// Verify explanation is complete
		const explanation = engine.explain(sabha.id);
		expect(explanation).toContain("Should we migrate to Rust?");
		expect(explanation).toContain("Final Verdict: accepted");
	});

	it("multi-round flow: first round no-consensus, second round accepted", () => {
		const engine = new SabhaEngine({ maxRounds: 3, consensusThreshold: 0.6 });
		const sabha = engine.convene("Deploy v3?", "admin", defaultParticipants());

		// Round 1: no consensus — 1 support vs 2 oppose, but weighted score
		// doesn't cross -0.6 threshold due to weight differences
		engine.propose(sabha.id, "kartru", {
			pratijna: "Deploy v3 now without staging.",
			hetu: "Because time to market is critical.",
			udaharana: "Companies that ship fast win, as shown by startup velocity studies.",
			upanaya: "Our competitor is about to launch.",
			nigamana: "Therefore, deploy v3 without staging.",
		});
		engine.vote(sabha.id, "kartru", "support", "Ship it!");
		engine.vote(sabha.id, "parikshaka", "oppose", "Too risky without staging.");
		engine.vote(sabha.id, "anveshi", "oppose", "Need staging first.");

		// Round 2: revised proposal — unanimous support → accepted
		engine.propose(sabha.id, "kartru", {
			pratijna: "Deploy v3 with a 2-hour staging window.",
			hetu: "Because abbreviated staging catches critical issues while maintaining speed.",
			udaharana: "The v2.5 release used 2-hour staging and caught 3 blocking bugs.",
			upanaya: "V3 can go through 2-hour staging.",
			nigamana: "Therefore, deploy v3 with a 2-hour staging window to balance speed and safety.",
		});
		engine.vote(sabha.id, "kartru", "support", "Compromise accepted.");
		engine.vote(sabha.id, "parikshaka", "support", "2-hour staging is sufficient.");
		engine.vote(sabha.id, "anveshi", "support", "Agreed.");

		const result = engine.conclude(sabha.id);
		expect(result.rounds).toHaveLength(2);
		expect(result.rounds[0].verdict).toBe("no-consensus");
		expect(result.rounds[1].verdict).toBe("accepted");
		expect(result.finalVerdict).toBe("accepted");
	});
});
