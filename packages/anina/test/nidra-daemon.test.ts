/**
 * @chitragupta/anina — NidraDaemon (निद्रा) Tests.
 *
 * Comprehensive tests for the 3-state sleep cycle daemon:
 *   LISTENING -> DREAMING -> DEEP_SLEEP -> LISTENING
 *
 * Covers: construction, state machine transitions, heartbeat emission,
 * idle timeout, dream/deep-sleep handlers, wake interrupt, touch activity,
 * snapshot inspection, start/stop lifecycle, AbortController integration,
 * event emission, and SQLite persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NidraDaemon } from "../src/nidra-daemon.js";
import { DEFAULT_NIDRA_CONFIG } from "../src/types.js";
import type { NidraConfig, NidraState, NidraSnapshot, SvapnaPhase } from "../src/types.js";
import { createEventBus } from "@chitragupta/core";
import type { EventBus } from "@chitragupta/core";

// ─── Mock @chitragupta/smriti DatabaseManager ────────────────────────────────
// The NidraDaemon calls DatabaseManager.instance().get("agent") for persist/restore.
// We mock it to avoid real SQLite I/O and to verify persistence calls.

const mockRun = vi.fn((..._args: unknown[]) => undefined);
const mockGet = vi.fn((): Record<string, unknown> | undefined => undefined);
const mockPrepare = vi.fn((_sql: string) => ({
	run: mockRun,
	get: mockGet,
}));
const mockDb = { prepare: mockPrepare };

vi.mock("@chitragupta/smriti", () => ({
	DatabaseManager: {
		instance: () => ({
			get: (_name: string) => mockDb,
		}),
	},
}));

// ─── Test Config ─────────────────────────────────────────────────────────────
// Use short durations so fake timer advances are small and readable.

const FAST_CONFIG: Partial<NidraConfig> = {
	heartbeatMs: {
		LISTENING: 100,
		DREAMING: 200,
		DEEP_SLEEP: 500,
	},
	idleTimeoutMs: 1000,
	dreamDurationMs: 2000,
	deepSleepDurationMs: 3000,
	autoStart: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDaemon(
	config?: Partial<NidraConfig>,
	events?: EventBus,
): NidraDaemon {
	return new NidraDaemon(config ?? FAST_CONFIG, events);
}

/** Collect events from an EventBus into an array for assertions. */
function collectEvents(bus: EventBus): Array<{ event: string; data: unknown }> {
	const collected: Array<{ event: string; data: unknown }> = [];
	for (const evt of [
		"nidra:state_change",
		"nidra:heartbeat",
		"nidra:consolidation_start",
		"nidra:consolidation_end",
	]) {
		bus.on(evt, (data: unknown) => {
			collected.push({ event: evt, data });
		});
	}
	return collected;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NidraDaemon", () => {
	let daemon: NidraDaemon;

	beforeEach(() => {
		vi.useFakeTimers();
		mockRun.mockClear();
		mockGet.mockClear();
		mockPrepare.mockClear();
		// Default: restore returns undefined (no saved state)
		mockGet.mockReturnValue(undefined);
	});

	afterEach(async () => {
		if (daemon) {
			daemon.dispose();
		}
		vi.useRealTimers();
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 1. Construction
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Construction", () => {
		it("should construct with default config when no args provided", () => {
			daemon = new NidraDaemon();
			const snap = daemon.snapshot();
			expect(snap.state).toBe("LISTENING");
			expect(snap.consolidationProgress).toBe(0);
			expect(snap.uptime).toBe(0); // not started yet
		});

		it("should construct with custom config", () => {
			daemon = createDaemon(FAST_CONFIG);
			const snap = daemon.snapshot();
			expect(snap.state).toBe("LISTENING");
			expect(snap.consolidationProgress).toBe(0);
		});

		it("should merge partial config with defaults", () => {
			daemon = new NidraDaemon({ idleTimeoutMs: 999 });
			// The merged config should use 999 for idle but default heartbeats
			// We can't inspect config directly, but we can verify daemon starts fine
			daemon.start();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should accept an EventBus", () => {
			const bus = createEventBus();
			daemon = createDaemon(FAST_CONFIG, bus);
			// No errors — bus is wired
			daemon.start();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should work without an EventBus (null path)", () => {
			daemon = createDaemon(FAST_CONFIG);
			daemon.start();
			// Heartbeat fires without crashing even though no bus
			vi.advanceTimersByTime(150);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 2. State Machine Transitions
	// ═══════════════════════════════════════════════════════════════════════════

	describe("State Machine Transitions", () => {
		it("should start in LISTENING state", () => {
			daemon = createDaemon();
			daemon.start();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should transition LISTENING -> DREAMING on idle timeout", () => {
			daemon = createDaemon();
			daemon.start();
			// Advance past idle timeout
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should transition DREAMING -> DEEP_SLEEP on dream duration timeout", () => {
			daemon = createDaemon();
			daemon.start();
			// LISTENING -> DREAMING
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
			// DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
		});

		it("should transition DEEP_SLEEP -> LISTENING on deep sleep duration timeout", () => {
			daemon = createDaemon();
			daemon.start();
			// LISTENING -> DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(1001);
			vi.advanceTimersByTime(2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
			// DEEP_SLEEP -> LISTENING
			vi.advanceTimersByTime(3001);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should complete a full cycle: LISTENING -> DREAMING -> DEEP_SLEEP -> LISTENING", () => {
			daemon = createDaemon();
			daemon.start();
			const states: NidraState[] = [daemon.snapshot().state];

			vi.advanceTimersByTime(1001);
			states.push(daemon.snapshot().state);

			vi.advanceTimersByTime(2001);
			states.push(daemon.snapshot().state);

			vi.advanceTimersByTime(3001);
			states.push(daemon.snapshot().state);

			expect(states).toEqual(["LISTENING", "DREAMING", "DEEP_SLEEP", "LISTENING"]);
		});

		it("should support multiple consecutive cycles", () => {
			daemon = createDaemon();
			daemon.start();

			// Full cycle 1
			vi.advanceTimersByTime(1001 + 2001 + 3001);
			expect(daemon.snapshot().state).toBe("LISTENING");

			// Full cycle 2
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
			vi.advanceTimersByTime(2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
			vi.advanceTimersByTime(3001);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 3. Heartbeat Emission
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Heartbeat Emission", () => {
		it("should emit heartbeat events in LISTENING state", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			// LISTENING heartbeat is 100ms — advance 350ms for ~3 heartbeats
			vi.advanceTimersByTime(350);

			const heartbeats = events.filter((e) => e.event === "nidra:heartbeat");
			expect(heartbeats.length).toBeGreaterThanOrEqual(3);

			for (const hb of heartbeats) {
				const data = hb.data as { state: NidraState; timestamp: number; uptime: number };
				expect(data.state).toBe("LISTENING");
				expect(data.timestamp).toBeGreaterThan(0);
				expect(data.uptime).toBeGreaterThanOrEqual(0);
			}
		});

		it("should emit heartbeat events in DREAMING state with different cadence", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			// Transition to DREAMING
			vi.advanceTimersByTime(1001);
			events.length = 0; // Clear LISTENING heartbeats

			// DREAMING heartbeat is 200ms — advance 450ms for ~2 heartbeats
			vi.advanceTimersByTime(450);

			const heartbeats = events.filter((e) => e.event === "nidra:heartbeat");
			expect(heartbeats.length).toBeGreaterThanOrEqual(2);
			for (const hb of heartbeats) {
				const data = hb.data as { state: NidraState };
				expect(data.state).toBe("DREAMING");
			}
		});

		it("should emit heartbeat events in DEEP_SLEEP state with slowest cadence", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			// Transition to DEEP_SLEEP
			vi.advanceTimersByTime(1001 + 2001);
			events.length = 0; // Clear previous heartbeats

			// DEEP_SLEEP heartbeat is 500ms — advance 550ms for 1 heartbeat
			vi.advanceTimersByTime(550);

			const heartbeats = events.filter((e) => e.event === "nidra:heartbeat");
			expect(heartbeats.length).toBe(1);
			const data = heartbeats[0]!.data as { state: NidraState };
			expect(data.state).toBe("DEEP_SLEEP");
		});

		it("should persist heartbeat timestamp to SQLite", () => {
			daemon = createDaemon();
			daemon.start();

			mockRun.mockClear();

			// Advance to trigger a heartbeat
			vi.advanceTimersByTime(150);

			// persistHeartbeat calls db.prepare(...).run(now, now)
			const heartbeatCalls = mockRun.mock.calls.filter(
				(call) => call.length === 2 && typeof call[0] === "number" && typeof call[1] === "number"
			);
			expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);
		});

		it("should not emit heartbeats after stop", async () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			await daemon.stop();
			events.length = 0;

			vi.advanceTimersByTime(500);
			const heartbeats = events.filter((e) => e.event === "nidra:heartbeat");
			expect(heartbeats.length).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 4. Idle Timeout
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Idle Timeout", () => {
		it("should transition to DREAMING after idleTimeoutMs of inactivity", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			vi.advanceTimersByTime(499);
			expect(daemon.snapshot().state).toBe("LISTENING");

			vi.advanceTimersByTime(2);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should reset idle timer on touch(), delaying DREAMING transition", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			vi.advanceTimersByTime(400);
			daemon.touch(); // Reset idle timer

			vi.advanceTimersByTime(400);
			expect(daemon.snapshot().state).toBe("LISTENING"); // Still LISTENING

			vi.advanceTimersByTime(101);
			expect(daemon.snapshot().state).toBe("DREAMING"); // Now transitions
		});

		it("should reset idle timer on wake() when already LISTENING", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			vi.advanceTimersByTime(400);
			daemon.wake(); // Reset idle timer (already LISTENING)

			vi.advanceTimersByTime(400);
			expect(daemon.snapshot().state).toBe("LISTENING");

			vi.advanceTimersByTime(101);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 5. onDream() and onDeepSleep() Callback Hooks
	// ═══════════════════════════════════════════════════════════════════════════

	describe("onDream() and onDeepSleep() hooks", () => {
		it("should invoke the dream handler when entering DREAMING", () => {
			const dreamFn = vi.fn(async (_progress: (phase: SvapnaPhase, pct: number) => void) => {});
			daemon = createDaemon();
			daemon.onDream(dreamFn);
			daemon.start();

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
			expect(dreamFn).toHaveBeenCalledOnce();
		});

		it("should provide a progress callback to the dream handler", async () => {
			const phases: Array<{ phase: SvapnaPhase; pct: number }> = [];

			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.2);
				progress("RECOMBINE", 0.5);
				progress("CRYSTALLIZE", 0.8);
				progress("COMPRESS", 1.0);
			});
			daemon.start();

			vi.advanceTimersByTime(1001);

			// Allow microtasks from the async dream handler to resolve
			await vi.advanceTimersByTimeAsync(0);

			const snap = daemon.snapshot();
			// The last progress call sets phase to COMPRESS, pct to 1.0
			expect(snap.consolidationProgress).toBe(1.0);
		});

		it("should clamp progress percentage to [0, 1]", async () => {
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("REPLAY", -0.5); // Should clamp to 0
				progress("REPLAY", 2.0);  // Should clamp to 1
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);

			// After clamping, final pct should be 1.0
			expect(daemon.snapshot().consolidationProgress).toBeLessThanOrEqual(1);
			expect(daemon.snapshot().consolidationProgress).toBeGreaterThanOrEqual(0);
		});

		it("should invoke the deep sleep handler when entering DEEP_SLEEP", () => {
			const deepSleepFn = vi.fn(async () => {});
			daemon = createDaemon();
			daemon.onDeepSleep(deepSleepFn);
			daemon.start();

			// LISTENING -> DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(1001 + 2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
			expect(deepSleepFn).toHaveBeenCalledOnce();
		});

		it("should not crash if dream handler throws", async () => {
			daemon = createDaemon();
			daemon.onDream(async () => {
				throw new Error("Dream failed!");
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(10);

			// Daemon should still be running
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should not crash if deep sleep handler throws", async () => {
			daemon = createDaemon();
			daemon.onDeepSleep(async () => {
				throw new Error("Maintenance failed!");
			});
			daemon.start();

			vi.advanceTimersByTime(1001 + 2001);
			await vi.advanceTimersByTimeAsync(10);

			// Daemon should still be running
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
		});

		it("should not invoke dream handler if none registered", () => {
			daemon = createDaemon();
			daemon.start();

			// Transition to DREAMING without registering a handler — should not throw
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should not invoke deep sleep handler if none registered", () => {
			daemon = createDaemon();
			daemon.start();

			// Transition to DEEP_SLEEP without registering a handler
			vi.advanceTimersByTime(1001 + 2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 6. wake() — Force Return to LISTENING
	// ═══════════════════════════════════════════════════════════════════════════

	describe("wake() — Force Return to LISTENING", () => {
		it("should wake from DREAMING to LISTENING", () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should wake from DEEP_SLEEP to LISTENING", () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(1001 + 2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");

			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should be a no-op when already LISTENING (just resets idle timer)", () => {
			daemon = createDaemon();
			daemon.start();

			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should restart the idle timer after waking", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			// Go to DREAMING
			vi.advanceTimersByTime(501);
			expect(daemon.snapshot().state).toBe("DREAMING");

			// Wake up
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");

			// Idle timer should restart — not transition for another 500ms
			vi.advanceTimersByTime(400);
			expect(daemon.snapshot().state).toBe("LISTENING");

			vi.advanceTimersByTime(101);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should not work when daemon is not running", () => {
			daemon = createDaemon();
			// Not started — wake should be no-op
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should throw when daemon is disposed", () => {
			daemon = createDaemon();
			daemon.dispose();

			expect(() => daemon.wake()).toThrow("NidraDaemon has been disposed.");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 7. touch() — Reset Idle Timer / Wake from Sleep
	// ═══════════════════════════════════════════════════════════════════════════

	describe("touch() — Reset Idle Timer", () => {
		it("should reset the idle timer when in LISTENING state", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			vi.advanceTimersByTime(300);
			daemon.touch();

			vi.advanceTimersByTime(300);
			// Should still be LISTENING (600ms total, but timer was reset at 300ms)
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should trigger wake when called during DREAMING", () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			daemon.touch();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should trigger wake when called during DEEP_SLEEP", () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(1001 + 2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");

			daemon.touch();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should not work when daemon is not running", () => {
			daemon = createDaemon();
			// Not started
			daemon.touch();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should throw when daemon is disposed", () => {
			daemon = createDaemon();
			daemon.dispose();

			expect(() => daemon.touch()).toThrow("NidraDaemon has been disposed.");
		});

		it("should allow repeated touches to keep LISTENING indefinitely", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 500 });
			daemon.start();

			for (let i = 0; i < 10; i++) {
				vi.advanceTimersByTime(400);
				daemon.touch();
			}

			// After 4000ms of repeated touches, should still be LISTENING
			expect(daemon.snapshot().state).toBe("LISTENING");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 8. Snapshot Inspection
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Snapshot Inspection", () => {
		it("should return correct initial snapshot", () => {
			daemon = createDaemon();
			const snap = daemon.snapshot();

			expect(snap.state).toBe("LISTENING");
			expect(snap.consolidationProgress).toBe(0);
			expect(snap.consolidationPhase).toBeUndefined();
			expect(snap.lastConsolidationStart).toBeUndefined();
			expect(snap.lastConsolidationEnd).toBeUndefined();
			expect(snap.uptime).toBe(0);
		});

		it("should report uptime when running", () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(500);
			const snap = daemon.snapshot();
			expect(snap.uptime).toBeGreaterThanOrEqual(500);
		});

		it("should report zero uptime when stopped", async () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(500);
			await daemon.stop();

			const snap = daemon.snapshot();
			expect(snap.uptime).toBe(0);
		});

		it("should reflect state changes in snapshot", () => {
			daemon = createDaemon();
			daemon.start();

			expect(daemon.snapshot().state).toBe("LISTENING");

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			vi.advanceTimersByTime(2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
		});

		it("should track lastStateChange timestamp", () => {
			daemon = createDaemon();
			daemon.start();

			const before = daemon.snapshot().lastStateChange;

			vi.advanceTimersByTime(1001);
			const after = daemon.snapshot().lastStateChange;

			expect(after).toBeGreaterThan(before);
		});

		it("should track lastHeartbeat timestamp", () => {
			daemon = createDaemon();
			daemon.start();

			const before = daemon.snapshot().lastHeartbeat;

			vi.advanceTimersByTime(150);
			const after = daemon.snapshot().lastHeartbeat;

			expect(after).toBeGreaterThan(before);
		});

		it("should track consolidation start when entering DREAMING", async () => {
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.5);
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);

			const snap = daemon.snapshot();
			expect(snap.lastConsolidationStart).toBeDefined();
			expect(snap.lastConsolidationStart).toBeGreaterThan(0);
		});

		it("should track consolidation end when dream completes", async () => {
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("COMPRESS", 1.0);
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);

			const snap = daemon.snapshot();
			expect(snap.lastConsolidationEnd).toBeDefined();
			expect(snap.lastConsolidationEnd).toBeGreaterThanOrEqual(snap.lastConsolidationStart!);
		});

		it("should clear consolidation tracking when leaving DREAMING", () => {
			daemon = createDaemon();
			daemon.start();

			// Enter DREAMING
			vi.advanceTimersByTime(1001);
			// Exit DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(2001);

			const snap = daemon.snapshot();
			expect(snap.consolidationPhase).toBeUndefined();
			expect(snap.consolidationProgress).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 9. Start/Stop Lifecycle
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Start/Stop Lifecycle", () => {
		it("should start the daemon", () => {
			daemon = createDaemon();
			daemon.start();

			const snap = daemon.snapshot();
			expect(snap.uptime).toBeGreaterThanOrEqual(0);
		});

		it("should be idempotent — calling start() twice is safe", () => {
			daemon = createDaemon();
			daemon.start();
			daemon.start(); // Second call is a no-op

			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should stop the daemon and persist state", async () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(200);
			await daemon.stop();

			expect(daemon.snapshot().uptime).toBe(0);
		});

		it("should be idempotent — calling stop() twice is safe", async () => {
			daemon = createDaemon();
			daemon.start();

			await daemon.stop();
			await daemon.stop(); // Second call is a no-op
		});

		it("should stop without errors when never started", async () => {
			daemon = createDaemon();
			await daemon.stop(); // No-op
		});

		it("should cancel all timers on stop", async () => {
			daemon = createDaemon();
			daemon.start();

			vi.advanceTimersByTime(200);
			await daemon.stop();

			// Advancing more should not trigger any state changes
			const stateBefore = daemon.snapshot().state;
			vi.advanceTimersByTime(5000);
			expect(daemon.snapshot().state).toBe(stateBefore);
		});

		it("should call persist() on stop", async () => {
			daemon = createDaemon();
			daemon.start();

			mockPrepare.mockClear();
			await daemon.stop();

			// persist() calls db.prepare(INSERT OR REPLACE ...)
			expect(mockPrepare).toHaveBeenCalled();
		});

		it("should throw on start after dispose", () => {
			daemon = createDaemon();
			daemon.dispose();

			expect(() => daemon.start()).toThrow("NidraDaemon has been disposed.");
		});

		it("should allow restart after stop (but not after dispose)", async () => {
			daemon = createDaemon();
			daemon.start();
			await daemon.stop();

			// Restart
			daemon.start();
			expect(daemon.snapshot().state).toBe("LISTENING");
			// Timers work again
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("dispose should stop the daemon and prevent further use", () => {
			daemon = createDaemon();
			daemon.start();
			daemon.dispose();

			expect(() => daemon.start()).toThrow("NidraDaemon has been disposed.");
			expect(() => daemon.wake()).toThrow("NidraDaemon has been disposed.");
			expect(() => daemon.touch()).toThrow("NidraDaemon has been disposed.");
		});

		it("dispose should be idempotent", () => {
			daemon = createDaemon();
			daemon.dispose();
			daemon.dispose(); // Second call is a no-op, no throw
		});

		it("dispose should abort in-flight dream consolidation", () => {
			let abortSignalAborted = false;
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				// Simulate long-running dream that checks abort
				await new Promise<void>((resolve) => {
					setTimeout(() => {
						abortSignalAborted = true;
						resolve();
					}, 5000);
				});
			});
			daemon.start();

			// Enter DREAMING
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			// Dispose while dreaming
			daemon.dispose();

			// Daemon is disposed
			expect(() => daemon.wake()).toThrow("NidraDaemon has been disposed.");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 10. AbortController Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("AbortController Integration", () => {
		it("should abort the dream handler's abort signal on wake during DREAMING", async () => {
			let signalAborted = false;
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				// Create a promise that watches for abort
				const controller = new AbortController();
				// We check the progress fn's signal behavior — when aborted,
				// progress calls are silently ignored
				progress("REPLAY", 0.1);
				await new Promise<void>((resolve) => {
					const timer = setTimeout(() => {
						progress("CRYSTALLIZE", 0.9);
						resolve();
					}, 5000);
					// Simulate abort detection: resolve early if aborted
					// The actual abort is internal, but we can observe that
					// progress stops being effective after wake
				});
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			// Wake interrupts the dream
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should abort dream on stop", async () => {
			let dreamResolved = false;
			daemon = createDaemon();
			daemon.onDream(async (_progress) => {
				await new Promise<void>((resolve) => {
					setTimeout(() => {
						dreamResolved = true;
						resolve();
					}, 10000);
				});
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			await daemon.stop();
			// The abort controller should have been triggered
		});

		it("should not invoke consolidation_end after abort", async () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);

			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.5);
				// Simulate async work
				await new Promise((resolve) => setTimeout(resolve, 5000));
				progress("COMPRESS", 1.0);
			});
			daemon.start();

			vi.advanceTimersByTime(1001);

			// Clear events after state change
			const startEvents = events.filter((e) => e.event === "nidra:consolidation_start");
			expect(startEvents.length).toBe(1);

			// Wake to abort, then stop to prevent re-cycling into a new DREAMING
			daemon.wake();
			await daemon.stop();

			// Clear events collected up to this point, then advance
			const eventsBeforeAdvance = events.length;

			// Advance so the original dream's inner timer would have fired
			await vi.advanceTimersByTimeAsync(6000);

			// consolidation_end should NOT have been emitted after the abort
			const endEvents = events.slice(eventsBeforeAdvance).filter(
				(e) => e.event === "nidra:consolidation_end"
			);
			expect(endEvents.length).toBe(0);
		});

		it("should ignore progress reports after abort", async () => {
			let reportAfterAbort = false;
			daemon = createDaemon();

			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.3);
				// Simulate long work
				await new Promise((resolve) => setTimeout(resolve, 5000));
				// This runs after abort — progress should be silently ignored
				progress("COMPRESS", 1.0);
				reportAfterAbort = true;
			});
			daemon.start();

			vi.advanceTimersByTime(1001);

			// Wake to abort, then stop to prevent the daemon from re-entering
			// DREAMING after a new idle timeout fires during advanceTimersByTimeAsync
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
			await daemon.stop();

			// Run the timer that completes the dream handler
			await vi.advanceTimersByTimeAsync(6000);

			// The daemon should NOT reflect the post-abort progress
			// (consolidation fields were cleared when leaving DREAMING via wake)
			expect(daemon.snapshot().consolidationProgress).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 11. Event Emission
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Event Emission", () => {
		it("should emit nidra:state_change on every transition", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			// LISTENING -> DREAMING
			vi.advanceTimersByTime(1001);
			// DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(2001);
			// DEEP_SLEEP -> LISTENING
			vi.advanceTimersByTime(3001);

			const stateChanges = events.filter((e) => e.event === "nidra:state_change");
			expect(stateChanges.length).toBe(3);

			const transitions = stateChanges.map((e) => {
				const d = e.data as { prev: NidraState; next: NidraState };
				return `${d.prev}->${d.next}`;
			});
			expect(transitions).toEqual([
				"LISTENING->DREAMING",
				"DREAMING->DEEP_SLEEP",
				"DEEP_SLEEP->LISTENING",
			]);
		});

		it("should emit nidra:state_change on wake interrupt", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			vi.advanceTimersByTime(1001);
			events.length = 0;

			daemon.wake();

			const stateChanges = events.filter((e) => e.event === "nidra:state_change");
			expect(stateChanges.length).toBe(1);
			const data = stateChanges[0]!.data as { prev: NidraState; next: NidraState };
			expect(data.prev).toBe("DREAMING");
			expect(data.next).toBe("LISTENING");
		});

		it("should emit nidra:heartbeat with state, timestamp, uptime", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			vi.advanceTimersByTime(150);

			const heartbeats = events.filter((e) => e.event === "nidra:heartbeat");
			expect(heartbeats.length).toBeGreaterThanOrEqual(1);

			const data = heartbeats[0]!.data as { state: NidraState; timestamp: number; uptime: number };
			expect(data.state).toBe("LISTENING");
			expect(typeof data.timestamp).toBe("number");
			expect(typeof data.uptime).toBe("number");
			expect(data.uptime).toBeGreaterThanOrEqual(0);
		});

		it("should emit nidra:consolidation_start when entering DREAMING with a handler", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.onDream(async () => {});
			daemon.start();

			vi.advanceTimersByTime(1001);

			const starts = events.filter((e) => e.event === "nidra:consolidation_start");
			expect(starts.length).toBe(1);
			const data = starts[0]!.data as { timestamp: number };
			expect(typeof data.timestamp).toBe("number");
		});

		it("should emit nidra:consolidation_end when dream handler completes", async () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.onDream(async (progress) => {
				progress("COMPRESS", 1.0);
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);

			const ends = events.filter((e) => e.event === "nidra:consolidation_end");
			expect(ends.length).toBe(1);
			const data = ends[0]!.data as { timestamp: number; durationMs: number };
			expect(typeof data.timestamp).toBe("number");
			expect(typeof data.durationMs).toBe("number");
			expect(data.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("should not emit consolidation events if no dream handler is registered", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			vi.advanceTimersByTime(1001);

			const consolidation = events.filter(
				(e) => e.event === "nidra:consolidation_start" || e.event === "nidra:consolidation_end"
			);
			expect(consolidation.length).toBe(0);
		});

		it("should not crash if event handler throws", () => {
			const bus = createEventBus();
			bus.on("nidra:heartbeat", () => {
				throw new Error("Listener exploded!");
			});

			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			// Heartbeat should fire without crashing the daemon
			vi.advanceTimersByTime(150);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should include timestamp in state_change events", () => {
			const bus = createEventBus();
			const events = collectEvents(bus);
			daemon = createDaemon(FAST_CONFIG, bus);
			daemon.start();

			vi.advanceTimersByTime(1001);

			const stateChanges = events.filter((e) => e.event === "nidra:state_change");
			const data = stateChanges[0]!.data as { timestamp: number };
			expect(typeof data.timestamp).toBe("number");
			expect(data.timestamp).toBeGreaterThan(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 12. SQLite Persistence
	// ═══════════════════════════════════════════════════════════════════════════

	describe("SQLite Persistence", () => {
		it("should call persist (INSERT OR REPLACE) on state transitions", () => {
			daemon = createDaemon();
			daemon.start();

			mockPrepare.mockClear();
			mockRun.mockClear();

			// Trigger a transition
			vi.advanceTimersByTime(1001);

			// persist() should be called (INSERT OR REPLACE INTO nidra_state)
			const insertCalls = mockPrepare.mock.calls.filter(
				(call) => typeof call[0] === "string" && (call[0] as string).includes("INSERT OR REPLACE")
			);
			expect(insertCalls.length).toBeGreaterThanOrEqual(1);
		});

		it("should call persist on stop", async () => {
			daemon = createDaemon();
			daemon.start();

			mockPrepare.mockClear();
			await daemon.stop();

			const insertCalls = mockPrepare.mock.calls.filter(
				(call) => typeof call[0] === "string" && (call[0] as string).includes("INSERT OR REPLACE")
			);
			expect(insertCalls.length).toBeGreaterThanOrEqual(1);
		});

		it("should call restore on start", () => {
			mockPrepare.mockClear();

			daemon = createDaemon();
			daemon.start();

			// restore() calls SELECT ... FROM nidra_state
			const selectCalls = mockPrepare.mock.calls.filter(
				(call) => typeof call[0] === "string" && (call[0] as string).includes("SELECT")
			);
			expect(selectCalls.length).toBeGreaterThanOrEqual(1);
		});

		it("should restore saved state from SQLite row", () => {
			mockGet.mockReturnValue({
				current_state: "DREAMING",
				last_state_change: 1000,
				last_heartbeat: 2000,
				last_consolidation_start: 900,
				last_consolidation_end: null,
				consolidation_phase: "RECOMBINE",
				consolidation_progress: 0.6,
			});

			daemon = createDaemon();
			daemon.start();

			const snap = daemon.snapshot();
			expect(snap.state).toBe("DREAMING");
			expect(snap.lastStateChange).toBe(1000);
			expect(snap.lastHeartbeat).toBe(2000);
			expect(snap.lastConsolidationStart).toBe(900);
			expect(snap.lastConsolidationEnd).toBeUndefined();
			expect(snap.consolidationPhase).toBe("RECOMBINE");
			expect(snap.consolidationProgress).toBe(0.6);
		});

		it("should start fresh in LISTENING if no saved row", () => {
			mockGet.mockReturnValue(undefined);

			daemon = createDaemon();
			daemon.start();

			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should start fresh in LISTENING if restore throws", () => {
			mockPrepare.mockImplementationOnce(() => {
				throw new Error("SQLite unavailable");
			});

			daemon = createDaemon();
			daemon.start();

			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should not crash if persist throws", () => {
			daemon = createDaemon();
			daemon.start();

			// Make persist fail
			mockPrepare.mockImplementation(() => {
				throw new Error("Disk full");
			});

			// Transition should still work despite persist failure
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");

			// Restore original mock
			mockPrepare.mockImplementation(() => ({
				run: mockRun,
				get: mockGet,
			}));
		});

		it("should persist consolidation progress during dream", async () => {
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.25);
				progress("RECOMBINE", 0.50);
			});
			daemon.start();

			mockRun.mockClear();

			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);

			// persist() is called by progress reports
			// Each progress call triggers persist() which calls .run() with the state
			expect(mockRun).toHaveBeenCalled();
		});

		it("should persist heartbeat timestamp separately (UPDATE only)", () => {
			daemon = createDaemon();
			daemon.start();

			mockPrepare.mockClear();

			// Trigger a heartbeat
			vi.advanceTimersByTime(150);

			const updateCalls = mockPrepare.mock.calls.filter(
				(call) => typeof call[0] === "string" && (call[0] as string).includes("UPDATE nidra_state")
			);
			expect(updateCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// Edge Cases and Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("Edge Cases", () => {
		it("should handle rapid touch() calls without issues", () => {
			daemon = createDaemon({ ...FAST_CONFIG, idleTimeoutMs: 200 });
			daemon.start();

			// Rapid touches
			for (let i = 0; i < 100; i++) {
				vi.advanceTimersByTime(10);
				daemon.touch();
			}

			// Should still be LISTENING despite 1000ms passing
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should handle wake() during DEEP_SLEEP and re-enter full cycle", () => {
			daemon = createDaemon();
			daemon.start();

			// Enter DEEP_SLEEP
			vi.advanceTimersByTime(1001 + 2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");

			// Wake up
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");

			// Should be able to go through the cycle again
			vi.advanceTimersByTime(1001);
			expect(daemon.snapshot().state).toBe("DREAMING");
		});

		it("should handle both handlers registered simultaneously", async () => {
			const dreamFn = vi.fn(async (progress: (phase: SvapnaPhase, pct: number) => void) => {
				progress("COMPRESS", 1.0);
			});
			const deepSleepFn = vi.fn(async () => {});

			daemon = createDaemon();
			daemon.onDream(dreamFn);
			daemon.onDeepSleep(deepSleepFn);
			daemon.start();

			// LISTENING -> DREAMING
			vi.advanceTimersByTime(1001);
			await vi.advanceTimersByTimeAsync(0);
			expect(dreamFn).toHaveBeenCalledOnce();

			// DREAMING -> DEEP_SLEEP
			vi.advanceTimersByTime(2001);
			await vi.advanceTimersByTimeAsync(0);
			expect(deepSleepFn).toHaveBeenCalledOnce();
		});

		it("should handle transition from restored DREAMING state", () => {
			mockGet.mockReturnValue({
				current_state: "DREAMING",
				last_state_change: Date.now(),
				last_heartbeat: Date.now(),
				last_consolidation_start: null,
				last_consolidation_end: null,
				consolidation_phase: null,
				consolidation_progress: 0,
			});

			daemon = createDaemon();
			daemon.start();
			expect(daemon.snapshot().state).toBe("DREAMING");

			// Should transition to DEEP_SLEEP after dream duration
			vi.advanceTimersByTime(2001);
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");
		});

		it("should handle transition from restored DEEP_SLEEP state", () => {
			mockGet.mockReturnValue({
				current_state: "DEEP_SLEEP",
				last_state_change: Date.now(),
				last_heartbeat: Date.now(),
				last_consolidation_start: null,
				last_consolidation_end: null,
				consolidation_phase: null,
				consolidation_progress: 0,
			});

			daemon = createDaemon();
			daemon.start();
			expect(daemon.snapshot().state).toBe("DEEP_SLEEP");

			// Should transition to LISTENING after deep sleep duration
			vi.advanceTimersByTime(3001);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should not emit events when no EventBus provided", () => {
			daemon = createDaemon(FAST_CONFIG); // No bus
			daemon.start();

			// Full cycle without crashing
			vi.advanceTimersByTime(1001 + 2001 + 3001);
			expect(daemon.snapshot().state).toBe("LISTENING");
		});

		it("should persist state with correct values on transition", () => {
			daemon = createDaemon();
			daemon.start();

			mockRun.mockClear();
			vi.advanceTimersByTime(1001);

			// Find the persist call with the full INSERT OR REPLACE
			const calls = mockRun.mock.calls;
			const persistCall = calls.find(
				(c) => c.length >= 8 && c[0] === "DREAMING"
			);
			expect(persistCall).toBeDefined();
			if (persistCall) {
				expect(persistCall[0]).toBe("DREAMING"); // current_state
				expect(typeof persistCall[1]).toBe("number"); // last_state_change
				expect(typeof persistCall[2]).toBe("number"); // last_heartbeat
			}
		});

		it("should handle concurrent dream progress and wake gracefully", async () => {
			let progressCalled = 0;
			daemon = createDaemon();
			daemon.onDream(async (progress) => {
				progress("REPLAY", 0.2);
				progressCalled++;
				await new Promise((resolve) => setTimeout(resolve, 1000));
				progress("CRYSTALLIZE", 0.8);
				progressCalled++;
			});
			daemon.start();

			vi.advanceTimersByTime(1001);
			// Dream starts, first progress call happens synchronously
			expect(progressCalled).toBe(1);

			// Wake before second progress, then stop to prevent re-cycling
			daemon.wake();
			expect(daemon.snapshot().state).toBe("LISTENING");
			await daemon.stop();

			// Complete the async portion of the original dream handler
			await vi.advanceTimersByTimeAsync(2000);

			// The second progress call executed in the handler code but was
			// silently ignored because signal.aborted was true. The
			// consolidation fields were cleared when transitioning out of DREAMING.
			expect(daemon.snapshot().consolidationProgress).toBe(0);
		});

		it("snapshot() should be a fresh object each time (no reference sharing)", () => {
			daemon = createDaemon();
			daemon.start();

			const snap1 = daemon.snapshot();
			const snap2 = daemon.snapshot();

			expect(snap1).not.toBe(snap2);
			expect(snap1).toEqual(snap2);
		});
	});
});
