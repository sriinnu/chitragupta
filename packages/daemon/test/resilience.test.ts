/**
 * Tests for daemon resilience: health state machine + circuit breaker.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { HealthMonitor, HealthState } from "../src/resilience.js";

describe("HealthMonitor", () => {
	let monitor: HealthMonitor;

	beforeEach(() => {
		monitor = new HealthMonitor({
			degradeThreshold: 3,
			healThreshold: 5,
			maxRestartAttempts: 3,
			restartCooldownMs: 100,
			heartbeatIntervalMs: 0, // disable for unit tests
		});
	});

	it("starts HEALTHY", () => {
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
		expect(monitor.isCircuitOpen()).toBe(false);
	});

	it("stays HEALTHY on success", () => {
		monitor.recordSuccess();
		monitor.recordSuccess();
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
	});

	it("transitions to DEGRADED after consecutive failures", () => {
		const changes: string[] = [];
		monitor.on("stateChange", (_from, to) => changes.push(to));

		monitor.recordFailure("timeout");
		monitor.recordFailure("timeout");
		expect(monitor.getState()).toBe(HealthState.HEALTHY);

		monitor.recordFailure("timeout"); // 3rd failure → DEGRADED
		expect(monitor.getState()).toBe(HealthState.DEGRADED);
		expect(changes).toContain(HealthState.DEGRADED);
	});

	it("transitions to HEALING after more failures", () => {
		for (let i = 0; i < 4; i++) monitor.recordFailure("timeout");
		expect(monitor.getState()).toBe(HealthState.DEGRADED);

		const shouldHeal = monitor.recordFailure("timeout"); // 5th → HEALING
		expect(monitor.getState()).toBe(HealthState.HEALING);
		expect(shouldHeal).toBe(true);
	});

	it("recovers to HEALTHY on success after degradation", () => {
		const healed = vi.fn();
		monitor.on("healed", healed);

		for (let i = 0; i < 3; i++) monitor.recordFailure("err");
		expect(monitor.getState()).toBe(HealthState.DEGRADED);

		monitor.recordSuccess();
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
		expect(healed).toHaveBeenCalled();
	});

	it("transitions to DEAD after max restart attempts", () => {
		const deadFn = vi.fn();
		monitor.on("dead", deadFn);

		for (let i = 0; i < 5; i++) monitor.recordFailure("err");
		expect(monitor.getState()).toBe(HealthState.HEALING);

		monitor.recordRestartAttempt(false); // 1st failed restart
		monitor.recordRestartAttempt(false); // 2nd
		const canContinue = monitor.recordRestartAttempt(false); // 3rd → DEAD

		expect(monitor.getState()).toBe(HealthState.DEAD);
		expect(canContinue).toBe(false);
		expect(monitor.isCircuitOpen()).toBe(true);
		expect(deadFn).toHaveBeenCalled();
	});

	it("circuit stays open in DEAD state", () => {
		// Force to DEAD
		for (let i = 0; i < 5; i++) monitor.recordFailure("err");
		for (let i = 0; i < 3; i++) monitor.recordRestartAttempt(false);

		expect(monitor.isCircuitOpen()).toBe(true);

		// Further failures return false (don't try healing)
		const shouldHeal = monitor.recordFailure("more");
		expect(shouldHeal).toBe(false);
	});

	it("reset() returns to HEALTHY from any state", () => {
		for (let i = 0; i < 5; i++) monitor.recordFailure("err");
		for (let i = 0; i < 3; i++) monitor.recordRestartAttempt(false);
		expect(monitor.getState()).toBe(HealthState.DEAD);

		monitor.reset();
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
		expect(monitor.isCircuitOpen()).toBe(false);
	});

	it("successful restart recovers to HEALTHY", () => {
		for (let i = 0; i < 5; i++) monitor.recordFailure("err");
		expect(monitor.getState()).toBe(HealthState.HEALING);

		const ok = monitor.recordRestartAttempt(true);
		expect(ok).toBe(true);
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
	});

	it("exponential backoff on restart cooldown", () => {
		expect(monitor.getRestartCooldown()).toBe(100); // base
		monitor.recordRestartAttempt(false);
		expect(monitor.getRestartCooldown()).toBe(200); // 2^1 * base
		monitor.recordRestartAttempt(false);
		expect(monitor.getRestartCooldown()).toBe(400); // 2^2 * base
	});

	it("getSnapshot() returns full state", () => {
		monitor.recordFailure("err1");
		monitor.recordSuccess();
		monitor.recordFailure("err2");

		const snap = monitor.getSnapshot();
		expect(snap.state).toBe(HealthState.HEALTHY);
		expect(snap.totalFailures).toBe(2);
		expect(snap.totalSuccesses).toBe(1);
		expect(snap.consecutiveFailures).toBe(1);
	});

	it("heartbeat integration", async () => {
		let pingResult = true;
		const fastMonitor = new HealthMonitor({
			degradeThreshold: 2,
			heartbeatIntervalMs: 50,
		});

		fastMonitor.startHeartbeat(async () => pingResult);

		// Wait for a few heartbeats
		await new Promise((r) => setTimeout(r, 120));
		expect(fastMonitor.getState()).toBe(HealthState.HEALTHY);

		// Simulate daemon going down
		pingResult = false;
		await new Promise((r) => setTimeout(r, 200));
		expect(fastMonitor.getState()).not.toBe(HealthState.HEALTHY);

		fastMonitor.dispose();
	});

	it("dispose cleans up", () => {
		monitor.startHeartbeat(async () => true);
		monitor.dispose();
		// No error, no lingering timers
		expect(monitor.getState()).toBe(HealthState.HEALTHY);
	});
});
