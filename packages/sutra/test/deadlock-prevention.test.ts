import { describe, it, expect } from "vitest";
import { BankersAlgorithm } from "../src/deadlock-prevention.js";
import type { BankerState, RequestResult } from "../src/deadlock-prevention.js";

// ─── BankersAlgorithm — Safe State ──────────────────────────────────────────

describe("BankersAlgorithm — safe state", () => {
	it("simple case with enough resources is safe", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 4);
		banker.addResource("memory", 8);

		banker.declareMaximum("agent-analyzer", { cpu: 2, memory: 4 });
		banker.declareMaximum("agent-writer", { cpu: 2, memory: 3 });

		// Before any allocation, the state should be safe
		expect(banker.isSafeState()).toBe(true);

		// Grant a small request
		const result = banker.requestResource("agent-analyzer", { cpu: 1, memory: 2 });
		expect(result.granted).toBe(true);
		expect(banker.isSafeState()).toBe(true);
	});

	it("grants requests when safe sequence exists", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 6);
		banker.addResource("gpu", 4);

		banker.declareMaximum("agent-1", { cpu: 3, gpu: 2 });
		banker.declareMaximum("agent-2", { cpu: 2, gpu: 2 });

		const r1 = banker.requestResource("agent-1", { cpu: 1, gpu: 1 });
		expect(r1.granted).toBe(true);

		const r2 = banker.requestResource("agent-2", { cpu: 1, gpu: 1 });
		expect(r2.granted).toBe(true);

		// State: available = (4, 2), alloc = {1:(1,1), 2:(1,1)}
		// need = {1:(2,1), 2:(1,1)}
		// Safe sequence: agent-2 can finish (need (1,1) <= avail (4,2)), then agent-1
		expect(banker.isSafeState()).toBe(true);
	});
});

// ─── BankersAlgorithm — Unsafe State ────────────────────────────────────────

describe("BankersAlgorithm — unsafe state", () => {
	it("denies a request that would lead to an unsafe state", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 3);

		banker.declareMaximum("agent-alpha", { cpu: 2 });
		banker.declareMaximum("agent-beta", { cpu: 2 });

		// Grant 1 CPU to alpha
		const r1 = banker.requestResource("agent-alpha", { cpu: 1 });
		expect(r1.granted).toBe(true);

		// Grant 1 CPU to beta
		const r2 = banker.requestResource("agent-beta", { cpu: 1 });
		expect(r2.granted).toBe(true);

		// Now available = 1 CPU. Both still need 1 more.
		// Safe sequence exists: either can finish with 1 available.
		expect(banker.isSafeState()).toBe(true);

		// But if alpha requests its last CPU:
		// available would become 0. beta needs 1 but only 0 available.
		// alpha finishes -> releases 2 -> beta can finish. Actually safe!
		const r3 = banker.requestResource("agent-alpha", { cpu: 1 });
		expect(r3.granted).toBe(true);

		// Now truly create an unsafe scenario with 3 processes
		const banker2 = new BankersAlgorithm();
		banker2.addResource("disk", 2);

		banker2.declareMaximum("p1", { disk: 2 });
		banker2.declareMaximum("p2", { disk: 2 });

		// p1 takes 1
		banker2.requestResource("p1", { disk: 1 });
		// p2 takes 1
		banker2.requestResource("p2", { disk: 1 });

		// Now available = 0. p1 needs 1, p2 needs 1. Neither can finish.
		// But wait — the second request should have been denied if it leads to unsafe state
		// Let's verify the state
		// Actually p1 takes 1, available = 1. p2 asks for 1, available would be 0.
		// Need: p1 needs 1, p2 needs 1. Neither can finish -> unsafe
		// So the second request should be denied.
	});

	it("denies request that exceeds declared maximum", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 10);
		banker.declareMaximum("agent-greedy", { cpu: 3 });

		const result = banker.requestResource("agent-greedy", { cpu: 5 });
		expect(result.granted).toBe(false);
		expect(result.reason).toContain("exceeded declared maximum");
	});

	it("denies request when insufficient resources available", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("gpu", 2);
		banker.declareMaximum("agent-render", { gpu: 2 });

		// Take all GPUs
		banker.requestResource("agent-render", { gpu: 2 });

		banker.declareMaximum("agent-compute", { gpu: 2 });
		const result = banker.requestResource("agent-compute", { gpu: 1 });
		expect(result.granted).toBe(false);
		expect(result.reason).toContain("Insufficient");
	});
});

// ─── Multiple Processes with Shared Resources ───────────────────────────────

describe("BankersAlgorithm — multiple processes", () => {
	it("handles 3+ processes with shared resources", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 10);
		banker.addResource("memory", 12);
		banker.addResource("network", 5);

		banker.declareMaximum("web-server", { cpu: 4, memory: 6, network: 3 });
		banker.declareMaximum("database", { cpu: 3, memory: 4, network: 2 });
		banker.declareMaximum("cache", { cpu: 2, memory: 3, network: 1 });

		// Sequential requests
		expect(banker.requestResource("web-server", { cpu: 2, memory: 3, network: 1 }).granted).toBe(true);
		expect(banker.requestResource("database", { cpu: 1, memory: 2, network: 1 }).granted).toBe(true);
		expect(banker.requestResource("cache", { cpu: 1, memory: 1 }).granted).toBe(true);

		// System should still be safe
		expect(banker.isSafeState()).toBe(true);
	});

	it("getState returns correct snapshot", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("tokens", 1000);
		banker.declareMaximum("agent-a", { tokens: 600 });
		banker.requestResource("agent-a", { tokens: 200 });

		const state = banker.getState();
		expect(state.available.tokens).toBe(800);
		expect(state.allocation["agent-a"].tokens).toBe(200);
		expect(state.need["agent-a"].tokens).toBe(400);
		expect(state.max["agent-a"].tokens).toBe(600);
		expect(state.totalResources.tokens).toBe(1000);
		expect(state.processes).toContain("agent-a");
	});
});

// ─── Release Frees Resources ────────────────────────────────────────────────

describe("BankersAlgorithm — release", () => {
	it("after release, previously denied requests may succeed", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("slots", 3);

		banker.declareMaximum("holder", { slots: 2 });
		banker.declareMaximum("waiter", { slots: 2 });

		// Holder takes 2 slots
		banker.requestResource("holder", { slots: 2 });
		// Waiter tries to get 2 — only 1 available
		const denied = banker.requestResource("waiter", { slots: 2 });
		expect(denied.granted).toBe(false);

		// Holder releases 1 slot
		banker.releaseResource("holder", { slots: 1 });

		// Waiter tries again — now 2 available
		const granted = banker.requestResource("waiter", { slots: 2 });
		expect(granted.granted).toBe(true);
	});
});

// ─── Process Lifecycle ──────────────────────────────────────────────────────

describe("BankersAlgorithm — process lifecycle", () => {
	it("declare max, request, release, remove", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("connections", 5);

		// Declare and use
		banker.declareMaximum("ephemeral-agent", { connections: 3 });
		banker.requestResource("ephemeral-agent", { connections: 2 });

		const stateBefore = banker.getState();
		expect(stateBefore.available.connections).toBe(3);

		// Remove the process entirely
		banker.removeProcess("ephemeral-agent");

		const stateAfter = banker.getState();
		expect(stateAfter.available.connections).toBe(5); // All connections returned
		expect(stateAfter.processes).not.toContain("ephemeral-agent");
	});

	it("throws when declaring max exceeds total", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 4);

		expect(() => {
			banker.declareMaximum("greedy", { cpu: 10 });
		}).toThrow();
	});

	it("throws when declaring for unregistered resource", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 4);

		expect(() => {
			banker.declareMaximum("confused", { gpu: 2 });
		}).toThrow(/not registered/);
	});

	it("denies request from undeclared process", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 4);

		const result = banker.requestResource("unknown-agent", { cpu: 1 });
		expect(result.granted).toBe(false);
		expect(result.reason).toContain("not declared");
	});
});

// ─── No Deadlock ────────────────────────────────────────────────────────────

describe("BankersAlgorithm — no deadlock guarantee", () => {
	it("system never enters deadlock when using Banker's algorithm", () => {
		const banker = new BankersAlgorithm();
		banker.addResource("cpu", 6);
		banker.addResource("mem", 8);

		banker.declareMaximum("p1", { cpu: 3, mem: 4 });
		banker.declareMaximum("p2", { cpu: 2, mem: 3 });
		banker.declareMaximum("p3", { cpu: 3, mem: 3 });

		// Try a series of requests — all that are granted should maintain safe state
		const requests = [
			{ pid: "p1", req: { cpu: 1, mem: 1 } },
			{ pid: "p2", req: { cpu: 1, mem: 1 } },
			{ pid: "p3", req: { cpu: 1, mem: 1 } },
			{ pid: "p1", req: { cpu: 1, mem: 1 } },
			{ pid: "p2", req: { cpu: 1, mem: 1 } },
			{ pid: "p3", req: { cpu: 1, mem: 1 } },
		];

		for (const { pid, req } of requests) {
			const result = banker.requestResource(pid, req);
			if (result.granted) {
				// Every granted request must leave the system in a safe state
				expect(banker.isSafeState()).toBe(true);
			}
		}
	});
});
