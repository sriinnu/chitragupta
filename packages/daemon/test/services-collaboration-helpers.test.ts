import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sabha } from "@chitragupta/sutra";
import {
	gatherSabhaState,
	shouldResumeMeshBinding,
} from "../src/services-collaboration-helpers.js";
import {
	appendSabhaDispatchRecord,
	getSabhaPerspectiveMap,
	resetCollaborationStateMaps,
} from "../src/services-collaboration-state.js";
import type { SabhaMeshBinding } from "../src/services-collaboration-types.js";

function createSabha(id: string): Sabha {
	return {
		id,
		topic: "Test Sabha",
		status: "convened",
		convener: "vaayu",
		participants: [],
		rounds: [],
		finalVerdict: null,
		createdAt: 1,
		concludedAt: null,
	};
}

function createBinding(): SabhaMeshBinding {
	return {
		participantId: "mesh-peer",
		target: "capability:sabha.consult.memory",
		mode: "ask",
		timeoutMs: 1_000,
	};
}

describe("services-collaboration helpers", () => {
	afterEach(() => {
		vi.useRealTimers();
		resetCollaborationStateMaps();
	});

	it("does not resume a pending mesh dispatch while its lease is active", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-08T18:00:00Z"));
		const sabha = createSabha("sabha-lease-active");
		const binding = createBinding();
		appendSabhaDispatchRecord(sabha.id, {
			participantId: binding.participantId,
			target: binding.target,
			mode: binding.mode,
			status: "pending",
			attemptedAt: Date.now(),
			leaseOwner: "node-a",
			leaseExpiresAt: Date.now() + 1_000,
		});
		expect(shouldResumeMeshBinding(sabha, binding)).toBe(false);
	});

	it("resumes a pending mesh dispatch after its lease expires", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-08T18:00:00Z"));
		const sabha = createSabha("sabha-lease-expired");
		const binding = createBinding();
		appendSabhaDispatchRecord(sabha.id, {
			participantId: binding.participantId,
			target: binding.target,
			mode: binding.mode,
			status: "pending",
			attemptedAt: Date.now() - 5_000,
			leaseOwner: "node-a",
			leaseExpiresAt: Date.now() - 1,
		});
		expect(shouldResumeMeshBinding(sabha, binding)).toBe(true);
	});

	it("resumes a same-owner pending mesh lease immediately during forced recovery", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-08T18:00:00Z"));
		const sabha = createSabha("sabha-lease-owned");
		const binding = createBinding();
		appendSabhaDispatchRecord(sabha.id, {
			participantId: binding.participantId,
			target: binding.target,
			mode: binding.mode,
			status: "pending",
			attemptedAt: Date.now(),
			leaseOwner: "sabha-daemon",
			leaseExpiresAt: Date.now() + 10_000,
		});
		expect(shouldResumeMeshBinding(sabha, binding, {
			forceFailed: true,
			leaseOwner: "sabha-daemon",
		})).toBe(true);
	});

	it("builds a machine-usable Sabha resume plan for timed-out mesh work", () => {
		const sabha = createSabha("sabha-resume-plan");
		sabha.participants = [
			{ id: "mesh-peer", role: "memory", expertise: 0.8, credibility: 0.9 },
			{ id: "session-peer", role: "session", expertise: 0.7, credibility: 0.85 },
		];
		appendSabhaDispatchRecord(sabha.id, {
			participantId: "mesh-peer",
			target: "capability:sabha.consult.memory",
			mode: "ask",
			status: "pending",
			attemptedAt: Date.now(),
		});
		getSabhaPerspectiveMap(sabha.id).set("session-peer", {
			participantId: "session-peer",
			submittedAt: Date.now(),
			summary: "Existing session context",
			reasoning: "Already answered",
			position: "support",
			recommendedAction: null,
			evidence: [],
			clientId: null,
			transport: "unknown",
			metadata: {},
		});

		const state = gatherSabhaState(sabha) as {
			resumePlan?: { nextAction?: string; pendingDispatchParticipantIds?: string[]; pendingParticipantIds?: string[] };
		};
		expect(state.resumePlan).toEqual(expect.objectContaining({
			nextAction: "resume-mesh-dispatches",
			pendingDispatchParticipantIds: ["mesh-peer"],
		}));
		expect(state.resumePlan?.pendingParticipantIds).toEqual(["mesh-peer"]);
	});
});
