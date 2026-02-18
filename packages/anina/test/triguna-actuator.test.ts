/**
 * @chitragupta/anina — TrigunaActuator Tests.
 *
 * Tests for the Triguna health event → system actuation bridge.
 * Verifies event dispatching, KaalaBrahma healing, Samiti broadcasts,
 * and agent capacity adjustments.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TrigunaActuator } from "../src/triguna-actuator.js";
import type { KaalaLifecycle } from "../src/types.js";

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockKaala() {
	return {
		registerAgent: vi.fn(),
		recordHeartbeat: vi.fn(),
		markCompleted: vi.fn(),
		markError: vi.fn(),
		startMonitoring: vi.fn(),
		stopMonitoring: vi.fn(),
		onStatusChange: vi.fn(() => () => {}),
		healTree: vi.fn(),
		getTreeHealth: vi.fn(),
		setConfig: vi.fn(),
	} satisfies KaalaLifecycle & { setConfig: ReturnType<typeof vi.fn> };
}

function createMockSamiti() {
	return {
		broadcast: vi.fn(),
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TrigunaActuator", () => {
	let kaala: ReturnType<typeof createMockKaala>;
	let samiti: ReturnType<typeof createMockSamiti>;
	let actuator: TrigunaActuator;

	beforeEach(() => {
		kaala = createMockKaala();
		samiti = createMockSamiti();
		actuator = new TrigunaActuator(kaala, samiti);
	});

	// ─── Construction ────────────────────────────────────────────────

	describe("construction", () => {
		it("accepts null kaala and samiti", () => {
			const a = new TrigunaActuator(null, null);
			// Should not throw on any event
			a.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "test" });
			a.handleEvent("triguna:sattva_dominant", { sattva: 0.7, message: "ok" });
		});

		it("accepts custom config", () => {
			const a = new TrigunaActuator(kaala, samiti, {
				normalMaxSubAgents: 16,
				degradedMaxSubAgents: 2,
				normalHeartbeatIntervalMs: 4000,
				rajasHeartbeatIntervalMs: 7000,
				tamasHeartbeatIntervalMs: 11000,
			});
			a.handleEvent("triguna:tamas_alert", { tamas: 0.9, message: "bad" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 2 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 11000 });

			kaala.setConfig.mockClear();
			a.handleEvent("triguna:rajas_alert", { rajas: 0.7, message: "hyper" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 7000 });

			kaala.setConfig.mockClear();
			a.handleEvent("triguna:sattva_dominant", { sattva: 0.8, message: "good" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 16 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 4000 });
		});

		it("uses default config values (8 normal, 4 degraded)", () => {
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.7, message: "x" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 4 });

			kaala.setConfig.mockClear();
			actuator.handleEvent("triguna:sattva_dominant", { sattva: 0.8, message: "y" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 8 });
		});
	});

	// ─── Event Dispatching ───────────────────────────────────────────

	describe("handleEvent", () => {
		it("ignores unknown events", () => {
			actuator.handleEvent("unknown:event", {});
			expect(kaala.healTree).not.toHaveBeenCalled();
			expect(samiti.broadcast).not.toHaveBeenCalled();
		});

		it("dispatches all 4 event types", () => {
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "t" });
			actuator.handleEvent("triguna:rajas_alert", { rajas: 0.7, message: "r" });
			actuator.handleEvent("triguna:sattva_dominant", { sattva: 0.9, message: "s" });
			actuator.handleEvent("triguna:guna_shift", { from: "sattva", to: "rajas", state: {} });
			expect(samiti.broadcast).toHaveBeenCalledTimes(4);
		});
	});

	// ─── Tamas Alert ─────────────────────────────────────────────────

	describe("tamas_alert", () => {
		it("calls kaala.healTree()", () => {
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "degraded" });
			expect(kaala.healTree).toHaveBeenCalledOnce();
		});

		it("reduces agent capacity to degraded level", () => {
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.75, message: "slow" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 4 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 12000 });
		});

		it("broadcasts warning to #health channel", () => {
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "high inertia" });
			expect(samiti.broadcast).toHaveBeenCalledWith("#health", expect.objectContaining({
				sender: "triguna-actuator",
				severity: "warning",
				category: "health",
			}));
			const content = samiti.broadcast.mock.calls[0][1].content;
			expect(content).toContain("Tamas alert");
			expect(content).toContain("80%");
			expect(content).toContain("high inertia");
		});

		it("tolerates healTree throwing", () => {
			kaala.healTree.mockImplementation(() => { throw new Error("heal failed"); });
			// Should not throw
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.9, message: "err" });
			expect(samiti.broadcast).toHaveBeenCalled();
		});
	});

	// ─── Rajas Alert ─────────────────────────────────────────────────

	describe("rajas_alert", () => {
		it("does NOT call healTree (only reduces capacity)", () => {
			actuator.handleEvent("triguna:rajas_alert", { rajas: 0.7, message: "hyper" });
			expect(kaala.healTree).not.toHaveBeenCalled();
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 4 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 8000 });
		});

		it("broadcasts warning with rajas percentage", () => {
			actuator.handleEvent("triguna:rajas_alert", { rajas: 0.65, message: "too active" });
			const content = samiti.broadcast.mock.calls[0][1].content;
			expect(content).toContain("Rajas alert");
			expect(content).toContain("65%");
			expect(content).toContain("too active");
		});
	});

	// ─── Sattva Dominant ─────────────────────────────────────────────

	describe("sattva_dominant", () => {
		it("restores normal agent capacity", () => {
			// First degrade
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "bad" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 4 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 12000 });

			kaala.setConfig.mockClear();

			// Then recover
			actuator.handleEvent("triguna:sattva_dominant", { sattva: 0.7, message: "recovered" });
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 8 });
			expect(kaala.setConfig).toHaveBeenCalledWith({ heartbeatInterval: 5000 });
		});

		it("broadcasts info (not warning)", () => {
			actuator.handleEvent("triguna:sattva_dominant", { sattva: 0.85, message: "stable" });
			expect(samiti.broadcast).toHaveBeenCalledWith("#health", expect.objectContaining({
				severity: "info",
			}));
			const content = samiti.broadcast.mock.calls[0][1].content;
			expect(content).toContain("Sattva dominant");
			expect(content).toContain("85%");
		});
	});

	// ─── Guna Shift ──────────────────────────────────────────────────

	describe("guna_shift", () => {
		it("broadcasts shift info without affecting capacity", () => {
			actuator.handleEvent("triguna:guna_shift", { from: "sattva", to: "rajas", state: {} });
			expect(kaala.setConfig).not.toHaveBeenCalled();
			expect(kaala.healTree).not.toHaveBeenCalled();
			expect(samiti.broadcast).toHaveBeenCalledWith("#health", expect.objectContaining({
				severity: "info",
				content: expect.stringContaining("sattva → rajas"),
			}));
		});
	});

	// ─── Null Dependencies ───────────────────────────────────────────

	describe("null dependencies", () => {
		it("skips healTree when kaala is null", () => {
			const a = new TrigunaActuator(null, samiti);
			a.handleEvent("triguna:tamas_alert", { tamas: 0.9, message: "no kaala" });
			// No throw, broadcast still works
			expect(samiti.broadcast).toHaveBeenCalled();
		});

		it("skips broadcast when samiti is null", () => {
			const a = new TrigunaActuator(kaala, null);
			a.handleEvent("triguna:tamas_alert", { tamas: 0.9, message: "no samiti" });
			// No throw, kaala actions still work
			expect(kaala.healTree).toHaveBeenCalled();
			expect(kaala.setConfig).toHaveBeenCalledWith({ maxSubAgents: 4 });
		});

		it("skips setConfig when kaala has no setConfig method", () => {
			const bareKaala = {
				registerAgent: vi.fn(),
				recordHeartbeat: vi.fn(),
				markCompleted: vi.fn(),
				markError: vi.fn(),
				startMonitoring: vi.fn(),
				stopMonitoring: vi.fn(),
				onStatusChange: vi.fn(() => () => {}),
				healTree: vi.fn(),
				getTreeHealth: vi.fn(),
				// No setConfig
			} satisfies KaalaLifecycle;

			const a = new TrigunaActuator(bareKaala, samiti);
			a.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "no setConfig" });
			expect(bareKaala.healTree).toHaveBeenCalled();
			expect(samiti.broadcast).toHaveBeenCalled();
		});
	});

	// ─── Broadcast Error Tolerance ───────────────────────────────────

	describe("error tolerance", () => {
		it("tolerates broadcast throwing", () => {
			samiti.broadcast.mockImplementation(() => { throw new Error("broadcast failed"); });
			// Should not throw
			actuator.handleEvent("triguna:sattva_dominant", { sattva: 0.9, message: "ok" });
		});

		it("tolerates setConfig throwing", () => {
			kaala.setConfig.mockImplementation(() => { throw new Error("config failed"); });
			// Should not throw — tamas alert does healTree, then setConfig (throws), then broadcast
			actuator.handleEvent("triguna:tamas_alert", { tamas: 0.8, message: "fail config" });
			expect(kaala.healTree).toHaveBeenCalled();
			expect(samiti.broadcast).toHaveBeenCalled();
		});
	});
});
