import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sabha } from "@chitragupta/sutra";
import { shouldResumeMeshBinding } from "../src/services-collaboration-helpers.js";
import {
	appendSabhaDispatchRecord,
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
});
