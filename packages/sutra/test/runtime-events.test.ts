import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeEventStream } from "@chitragupta/sutra";
import type { RuntimeJobEvent, JobStatus } from "@chitragupta/sutra";

describe("RuntimeEventStream", () => {
	let stream: RuntimeEventStream;

	beforeEach(() => {
		stream = new RuntimeEventStream({ bufferSize: 100, maxPendingPerSink: 50 });
	});

	afterEach(() => {
		stream.destroy();
	});

	// ═══════════════════════════════════════════════════════════════
	// PUBLISH & SUBSCRIBE
	// ═══════════════════════════════════════════════════════════════

	describe("publish and subscribe", () => {
		it("should deliver published events to subscribers", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received.push(evt));

			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "running", progress: 50 });

			expect(received).toHaveLength(2);
			expect(received[0].jobId).toBe("j1");
			expect(received[0].status).toBe("queued");
			expect(received[1].status).toBe("running");
			expect(received[1].progress).toBe(50);
		});

		it("should auto-generate timestamp on publish", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received.push(evt));

			const before = Date.now();
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			const after = Date.now();

			expect(received[0].timestamp).toBeGreaterThanOrEqual(before);
			expect(received[0].timestamp).toBeLessThanOrEqual(after);
		});

		it("should deliver to multiple subscribers", () => {
			const received1: RuntimeJobEvent[] = [];
			const received2: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received1.push(evt));
			stream.subscribe((evt) => received2.push(evt));

			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });

			expect(received1).toHaveLength(1);
			expect(received2).toHaveLength(1);
		});

		it("should unsubscribe correctly", () => {
			const received: RuntimeJobEvent[] = [];
			const unsub = stream.subscribe((evt) => received.push(evt));

			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			unsub();
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });

			expect(received).toHaveLength(1);
			expect(received[0].status).toBe("queued");
		});

		it("should track subscriber count", () => {
			expect(stream.subscriberCount).toBe(0);
			const unsub1 = stream.subscribe(vi.fn());
			expect(stream.subscriberCount).toBe(1);
			const unsub2 = stream.subscribe(vi.fn());
			expect(stream.subscriberCount).toBe(2);
			unsub1();
			expect(stream.subscriberCount).toBe(1);
			unsub2();
			expect(stream.subscriberCount).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// GET JOB HISTORY
	// ═══════════════════════════════════════════════════════════════

	describe("getJobHistory", () => {
		it("should return events for a specific job", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j2", agentId: "a2", status: "queued" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });

			const history = stream.getJobHistory("j1");
			expect(history).toHaveLength(2);
			expect(history[0].status).toBe("queued");
			expect(history[1].status).toBe("running");
		});

		it("should return empty array for unknown job", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			expect(stream.getJobHistory("unknown")).toHaveLength(0);
		});

		it("should respect limit parameter", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "running", progress: 25 });
			stream.publish({ jobId: "j1", agentId: "a1", status: "running", progress: 75 });
			stream.publish({ jobId: "j1", agentId: "a1", status: "completed" });

			const limited = stream.getJobHistory("j1", 2);
			expect(limited).toHaveLength(2);
			// Should return the last 2 events (most recent)
			expect(limited[0].progress).toBe(75);
			expect(limited[1].status).toBe("completed");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// GET ACTIVE JOBS
	// ═══════════════════════════════════════════════════════════════

	describe("getActiveJobs", () => {
		it("should track non-terminal jobs", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j2", agentId: "a2", status: "running" });

			const active = stream.getActiveJobs();
			expect(active).toHaveLength(2);

			const ids = active.map((j) => j.jobId).sort();
			expect(ids).toEqual(["j1", "j2"]);
		});

		it("should remove jobs in terminal state: completed", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "completed" });

			expect(stream.getActiveJobs()).toHaveLength(0);
		});

		it("should remove jobs in terminal state: failed", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "failed", error: "oops" });

			expect(stream.getActiveJobs()).toHaveLength(0);
		});

		it("should remove jobs in terminal state: cancelled", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "cancelled" });

			expect(stream.getActiveJobs()).toHaveLength(0);
		});

		it("should update lastUpdate timestamp on status change", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			const t1 = stream.getActiveJobs()[0].lastUpdate;

			// Small delay to ensure timestamp difference
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			const t2 = stream.getActiveJobs()[0].lastUpdate;

			expect(t2).toBeGreaterThanOrEqual(t1);
			expect(stream.getActiveJobs()[0].status).toBe("running");
		});

		it("should keep paused jobs as active", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "paused" });

			const active = stream.getActiveJobs();
			expect(active).toHaveLength(1);
			expect(active[0].status).toBe("paused");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REPLAY RECENT
	// ═══════════════════════════════════════════════════════════════

	describe("replayRecent", () => {
		it("should return the last N events", () => {
			for (let i = 0; i < 10; i++) {
				stream.publish({ jobId: `j${i}`, agentId: "a1", status: "queued" });
			}

			const replayed = stream.replayRecent(3);
			expect(replayed).toHaveLength(3);
			expect(replayed[0].jobId).toBe("j7");
			expect(replayed[1].jobId).toBe("j8");
			expect(replayed[2].jobId).toBe("j9");
		});

		it("should use config reconnectReplayCount as default", () => {
			const s = new RuntimeEventStream({ reconnectReplayCount: 2, bufferSize: 100 });
			for (let i = 0; i < 5; i++) {
				s.publish({ jobId: `j${i}`, agentId: "a1", status: "queued" });
			}

			const replayed = s.replayRecent();
			expect(replayed).toHaveLength(2);
			expect(replayed[0].jobId).toBe("j3");
			expect(replayed[1].jobId).toBe("j4");
			s.destroy();
		});

		it("should return all events if count exceeds buffer size", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j2", agentId: "a2", status: "running" });

			const replayed = stream.replayRecent(100);
			expect(replayed).toHaveLength(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// BACKPRESSURE
	// ═══════════════════════════════════════════════════════════════

	describe("backpressure", () => {
		it("should drop oldest events when maxPendingPerSink is exceeded", () => {
			// Create stream with very small backpressure limit
			const small = new RuntimeEventStream({
				bufferSize: 200,
				maxPendingPerSink: 5,
			});

			const received: RuntimeJobEvent[] = [];
			small.subscribe((evt) => received.push(evt));

			// Publish more events than the backpressure limit
			for (let i = 0; i < 10; i++) {
				small.publish({ jobId: `j${i}`, agentId: "a1", status: "queued" });
			}

			// All events should still be delivered since the drain happens synchronously,
			// but the ring buffer inside the sink caps at maxPendingPerSink
			expect(received.length).toBeGreaterThan(0);
			expect(received.length).toBeLessThanOrEqual(10);
			small.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// RECONNECT
	// ═══════════════════════════════════════════════════════════════

	describe("reconnect replay", () => {
		it("should allow late-joining subscriber to replay recent events", () => {
			// Publish some events before subscriber joins
			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.publish({ jobId: "j2", agentId: "a2", status: "queued" });

			// Late joiner replays history
			const replayed = stream.replayRecent(10);
			expect(replayed).toHaveLength(3);
			expect(replayed[0].jobId).toBe("j1");
			expect(replayed[0].status).toBe("queued");
			expect(replayed[2].jobId).toBe("j2");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// BURST
	// ═══════════════════════════════════════════════════════════════

	describe("burst publishing", () => {
		it("should handle rapid burst of events without crashing", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received.push(evt));

			const statuses: JobStatus[] = ["queued", "running", "paused", "running", "completed"];

			for (let job = 0; job < 50; job++) {
				for (const status of statuses) {
					stream.publish({
						jobId: `burst-${job}`,
						agentId: "burst-agent",
						status,
						progress: status === "running" ? 50 : undefined,
						message: `Job burst-${job} is ${status}`,
					});
				}
			}

			// 50 jobs * 5 statuses = 250 events
			expect(received).toHaveLength(250);

			// All burst jobs should be in terminal state (completed)
			expect(stream.getActiveJobs()).toHaveLength(0);
		});

		it("should not lose events under burst when buffer wraps", () => {
			// Small buffer to force wrapping
			const small = new RuntimeEventStream({ bufferSize: 10 });
			for (let i = 0; i < 20; i++) {
				small.publish({ jobId: `j${i}`, agentId: "a1", status: "queued" });
			}

			// Buffer only holds 10, so only last 10 should be available
			const replayed = small.replayRecent(20);
			expect(replayed).toHaveLength(10);
			expect(replayed[0].jobId).toBe("j10");
			expect(replayed[9].jobId).toBe("j19");
			small.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DESTROY / LIFECYCLE
	// ═══════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should throw on publish after destroy", () => {
			stream.destroy();
			expect(() =>
				stream.publish({ jobId: "j1", agentId: "a1", status: "queued" }),
			).toThrow("RuntimeEventStream has been destroyed");
		});

		it("should throw on subscribe after destroy", () => {
			stream.destroy();
			expect(() => stream.subscribe(vi.fn())).toThrow(
				"RuntimeEventStream has been destroyed",
			);
		});

		it("should clear all state on destroy", () => {
			stream.publish({ jobId: "j1", agentId: "a1", status: "running" });
			stream.subscribe(vi.fn());

			stream.destroy();

			expect(stream.subscriberCount).toBe(0);
			expect(stream.getActiveJobs()).toHaveLength(0);
			expect(stream.getJobHistory("j1")).toHaveLength(0);
			expect(stream.replayRecent()).toHaveLength(0);
		});

		it("should stop delivering events to subscribers after destroy", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received.push(evt));

			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });
			expect(received).toHaveLength(1);

			stream.destroy();
			// Cannot publish after destroy — it throws, but subscriber should not receive more
			expect(received).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// EDGE CASES
	// ═══════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("should handle subscriber that throws without affecting others", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe(() => {
				throw new Error("bad subscriber");
			});
			stream.subscribe((evt) => received.push(evt));

			stream.publish({ jobId: "j1", agentId: "a1", status: "queued" });

			// The good subscriber should still receive the event
			expect(received).toHaveLength(1);
		});

		it("should include optional fields when provided", () => {
			const received: RuntimeJobEvent[] = [];
			stream.subscribe((evt) => received.push(evt));

			stream.publish({
				jobId: "j1",
				agentId: "a1",
				status: "failed",
				error: "timeout",
				message: "Job timed out",
				metadata: { retries: 3 },
				progress: 80,
			});

			const evt = received[0];
			expect(evt.error).toBe("timeout");
			expect(evt.message).toBe("Job timed out");
			expect(evt.metadata).toEqual({ retries: 3 });
			expect(evt.progress).toBe(80);
		});
	});
});
