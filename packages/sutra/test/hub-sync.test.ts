import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LockManager, BarrierManager, SemaphoreManager } from "../src/hub-sync.js";

/**
 * Helper: swallow rejections from dangling lock promises.
 * In tests that create lock waiters without ever resolving them,
 * we must attach a .catch() to avoid unhandled rejections when
 * the afterEach teardown rejects them.
 */
function swallow(p: Promise<unknown>): void {
	p.catch(() => {});
}

describe("LockManager", () => {
	let mgr: LockManager;
	const log = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		mgr = new LockManager(5000, log);
	});

	afterEach(() => {
		mgr.rejectAll("teardown");
		mgr.clear();
		vi.useRealTimers();
		log.mockClear();
	});

	describe("acquireLock", () => {
		it("should acquire a lock on a free resource", async () => {
			const lock = await mgr.acquireLock("file.txt", "agent-1");
			expect(lock.resource).toBe("file.txt");
			expect(lock.holder).toBe("agent-1");
			expect(lock.id).toBeTruthy();
			expect(lock.waitQueue).toEqual([]);
		});

		it("should set acquiredAt and expiresAt with custom timeout", async () => {
			const now = Date.now();
			const lock = await mgr.acquireLock("r", "a", 3000);
			expect(lock.acquiredAt).toBeGreaterThanOrEqual(now);
			expect(lock.expiresAt).toBe(lock.acquiredAt + 3000);
		});

		it("should use defaultTimeout when no custom timeout given", async () => {
			const lock = await mgr.acquireLock("r", "a");
			expect(lock.expiresAt).toBe(lock.acquiredAt + 5000);
		});

		it("should increase lockCount to 1 after acquiring", async () => {
			expect(mgr.lockCount).toBe(0);
			await mgr.acquireLock("r", "a");
			expect(mgr.lockCount).toBe(1);
		});

		it("should acquire multiple independent locks", async () => {
			await mgr.acquireLock("r1", "a1");
			await mgr.acquireLock("r2", "a2");
			expect(mgr.lockCount).toBe(2);
		});
	});

	describe("releaseLock", () => {
		it("should release a held lock", async () => {
			await mgr.acquireLock("r", "a");
			mgr.releaseLock("r", "a");
			expect(mgr.isLocked("r")).toBe(false);
			expect(mgr.lockCount).toBe(0);
		});

		it("should throw if no lock exists", () => {
			expect(() => mgr.releaseLock("none", "a")).toThrow(/No lock exists/);
		});

		it("should throw if wrong holder tries to release", async () => {
			await mgr.acquireLock("r", "a1");
			expect(() => mgr.releaseLock("r", "a2")).toThrow(/does not hold the lock/);
		});
	});

	describe("re-entrant locks", () => {
		it("should allow the same agent to re-acquire the same lock", async () => {
			const lock1 = await mgr.acquireLock("r", "a");
			const lock2 = await mgr.acquireLock("r", "a");
			expect(lock1).toBe(lock2);
			expect(mgr.lockCount).toBe(1);
		});
	});

	describe("FIFO wait queue", () => {
		it("should queue a second agent waiting for a held lock", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2");
			const lock = mgr.getLocks().get("r")!;
			expect(lock.waitQueue).toContain("a2");
			mgr.releaseLock("r", "a1");
			const lock2 = await p2;
			expect(lock2.holder).toBe("a2");
		});

		it("should promote waiters in FIFO order", async () => {
			await mgr.acquireLock("r", "a1");
			const order: string[] = [];
			const p2 = mgr.acquireLock("r", "a2").then((l) => { order.push(l.holder); return l; });
			const p3 = mgr.acquireLock("r", "a3").then((l) => { order.push(l.holder); return l; });
			mgr.releaseLock("r", "a1");
			const l2 = await p2;
			expect(l2.holder).toBe("a2");
			mgr.releaseLock("r", "a2");
			const l3 = await p3;
			expect(l3.holder).toBe("a3");
			expect(order).toEqual(["a2", "a3"]);
		});

		it("should add multiple agents to the waitQueue", async () => {
			await mgr.acquireLock("r", "a1");
			swallow(mgr.acquireLock("r", "a2"));
			swallow(mgr.acquireLock("r", "a3"));
			swallow(mgr.acquireLock("r", "a4"));
			const lock = mgr.getLocks().get("r")!;
			expect(lock.waitQueue).toEqual(["a2", "a3", "a4"]);
		});
	});

	describe("lock timeout", () => {
		it("should reject with timeout error when wait exceeds limit", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2", 1000);
			vi.advanceTimersByTime(1000);
			await expect(p2).rejects.toThrow(/Lock timeout/);
		});

		it("should use defaultTimeout when no custom timeout specified", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2");
			vi.advanceTimersByTime(5000);
			await expect(p2).rejects.toThrow(/Lock timeout/);
		});

		it("should remove timed-out agent from the waitQueue", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2", 500);
			vi.advanceTimersByTime(500);
			await expect(p2).rejects.toThrow();
			const lock = mgr.getLocks().get("r")!;
			expect(lock.waitQueue).not.toContain("a2");
		});

		it("should include the agent ID and resource in the timeout message", async () => {
			await mgr.acquireLock("my-resource", "agent-x");
			const p = mgr.acquireLock("my-resource", "agent-y", 100);
			vi.advanceTimersByTime(100);
			await expect(p).rejects.toThrow(/agent-y/);
		});
	});

	describe("isLocked", () => {
		it("should return false for an unlocked resource", () => {
			expect(mgr.isLocked("r")).toBe(false);
		});

		it("should return true for a locked resource", async () => {
			await mgr.acquireLock("r", "a");
			expect(mgr.isLocked("r")).toBe(true);
		});

		it("should return false after releasing", async () => {
			await mgr.acquireLock("r", "a");
			mgr.releaseLock("r", "a");
			expect(mgr.isLocked("r")).toBe(false);
		});
	});

	describe("getLocks", () => {
		it("should return an empty map initially", () => {
			expect(mgr.getLocks().size).toBe(0);
		});

		it("should contain all acquired locks", async () => {
			await mgr.acquireLock("r1", "a1");
			await mgr.acquireLock("r2", "a2");
			const locks = mgr.getLocks();
			expect(locks.size).toBe(2);
			expect(locks.has("r1")).toBe(true);
			expect(locks.has("r2")).toBe(true);
		});
	});

	describe("forceReleaseLock", () => {
		it("should force-release a lock and promote next waiter", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2");
			mgr.forceReleaseLock("r");
			const lock2 = await p2;
			expect(lock2.holder).toBe("a2");
		});

		it("should remove the lock entirely if no waiters", async () => {
			await mgr.acquireLock("r", "a1");
			mgr.forceReleaseLock("r");
			expect(mgr.isLocked("r")).toBe(false);
			expect(mgr.lockCount).toBe(0);
		});

		it("should be a no-op for a non-existent lock", () => {
			expect(() => mgr.forceReleaseLock("nope")).not.toThrow();
		});

		it("should log the force-release", async () => {
			await mgr.acquireLock("r", "a1");
			mgr.forceReleaseLock("r");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[lock:force-release]"));
		});
	});

	describe("cleanupLocks", () => {
		it("should invoke releaseFn for expired locks", async () => {
			await mgr.acquireLock("r", "a", 1000);
			vi.advanceTimersByTime(1001);
			const releaseFn = vi.fn();
			mgr.cleanupLocks(releaseFn);
			expect(releaseFn).toHaveBeenCalledWith("r", "a");
		});

		it("should not invoke releaseFn for non-expired locks", async () => {
			await mgr.acquireLock("r", "a", 10000);
			vi.advanceTimersByTime(100);
			const releaseFn = vi.fn();
			mgr.cleanupLocks(releaseFn);
			expect(releaseFn).not.toHaveBeenCalled();
		});

		it("should delete the lock if releaseFn throws", async () => {
			await mgr.acquireLock("r", "a", 1000);
			vi.advanceTimersByTime(1001);
			const releaseFn = vi.fn(() => { throw new Error("fail"); });
			mgr.cleanupLocks(releaseFn);
			expect(mgr.isLocked("r")).toBe(false);
		});
	});

	describe("rejectAll", () => {
		it("should reject all queued waiters", async () => {
			await mgr.acquireLock("r", "a1");
			const p2 = mgr.acquireLock("r", "a2");
			const p3 = mgr.acquireLock("r", "a3");
			mgr.rejectAll("shutdown");
			await expect(p2).rejects.toThrow("shutdown");
			await expect(p3).rejects.toThrow("shutdown");
		});

		it("should be safe to call with no waiters", () => {
			expect(() => mgr.rejectAll("nothing")).not.toThrow();
		});
	});

	describe("clear", () => {
		it("should remove all locks and waiters", async () => {
			await mgr.acquireLock("r1", "a1");
			await mgr.acquireLock("r2", "a2");
			mgr.clear();
			expect(mgr.lockCount).toBe(0);
			expect(mgr.getLocks().size).toBe(0);
		});
	});

	describe("logging", () => {
		it("should call the log function on acquire", async () => {
			await mgr.acquireLock("r", "a");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[lock:acquire]"));
		});

		it("should call the log function on release", async () => {
			await mgr.acquireLock("r", "a");
			mgr.releaseLock("r", "a");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[lock:release]"));
		});

		it("should call the log function when a waiter queues", async () => {
			await mgr.acquireLock("r", "a1");
			swallow(mgr.acquireLock("r", "a2"));
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[lock:wait]"));
		});
	});
});

describe("BarrierManager", () => {
	let mgr: BarrierManager;
	const log = vi.fn();

	beforeEach(() => {
		mgr = new BarrierManager(log);
	});

	afterEach(() => {
		mgr.clear();
		log.mockClear();
	});

	describe("createBarrier", () => {
		it("should create a barrier with the given name and count", () => {
			const b = mgr.createBarrier("sync", 3);
			expect(b.name).toBe("sync");
			expect(b.required).toBe(3);
			expect(b.arrived.size).toBe(0);
			expect(b.id).toBeTruthy();
		});

		it("should throw if barrier already exists", () => {
			mgr.createBarrier("sync", 3);
			expect(() => mgr.createBarrier("sync", 2)).toThrow(/already exists/);
		});

		it("should increment barrierCount", () => {
			expect(mgr.barrierCount).toBe(0);
			mgr.createBarrier("b1", 2);
			expect(mgr.barrierCount).toBe(1);
			mgr.createBarrier("b2", 2);
			expect(mgr.barrierCount).toBe(2);
		});

		it("should log on creation", () => {
			mgr.createBarrier("sync", 3);
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[barrier:create]"));
		});
	});

	describe("arriveAtBarrier", () => {
		it("should throw if barrier does not exist", () => {
			expect(() => mgr.arriveAtBarrier("nope", "a")).toThrow(/does not exist/);
		});

		it("should resolve immediately when required count is 1", async () => {
			mgr.createBarrier("sync", 1);
			await expect(mgr.arriveAtBarrier("sync", "a1")).resolves.toBeUndefined();
		});

		it("should block until all agents arrive", async () => {
			mgr.createBarrier("sync", 3);
			let resolved1 = false;
			let resolved2 = false;
			const p1 = mgr.arriveAtBarrier("sync", "a1").then(() => { resolved1 = true; });
			const p2 = mgr.arriveAtBarrier("sync", "a2").then(() => { resolved2 = true; });
			await Promise.resolve();
			expect(resolved1).toBe(false);
			expect(resolved2).toBe(false);
			const p3 = mgr.arriveAtBarrier("sync", "a3");
			await Promise.all([p1, p2, p3]);
			expect(resolved1).toBe(true);
			expect(resolved2).toBe(true);
		});

		it("should handle duplicate arrivals from the same agent (Set semantics)", async () => {
			mgr.createBarrier("sync", 2);
			mgr.arriveAtBarrier("sync", "a1");
			mgr.arriveAtBarrier("sync", "a1");
			await Promise.resolve();
			const p3 = mgr.arriveAtBarrier("sync", "a2");
			await p3;
		});

		it("should log arrive events", async () => {
			mgr.createBarrier("sync", 1);
			await mgr.arriveAtBarrier("sync", "a1");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[barrier:arrive]"));
		});

		it("should include count in log message", () => {
			mgr.createBarrier("sync", 2);
			mgr.arriveAtBarrier("sync", "a1");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("1/2"));
		});
	});

	describe("clear", () => {
		it("should remove all barriers", () => {
			mgr.createBarrier("b1", 2);
			mgr.createBarrier("b2", 2);
			mgr.clear();
			expect(mgr.barrierCount).toBe(0);
		});
	});
});

describe("SemaphoreManager", () => {
	let mgr: SemaphoreManager;
	const log = vi.fn();

	beforeEach(() => {
		mgr = new SemaphoreManager(log);
	});

	afterEach(() => {
		mgr.clear();
		log.mockClear();
	});

	describe("createSemaphore", () => {
		it("should create a semaphore with the given permits", () => {
			const s = mgr.createSemaphore("pool", 3);
			expect(s.name).toBe("pool");
			expect(s.maxPermits).toBe(3);
			expect(s.currentPermits).toBe(3);
			expect(s.waitQueue).toEqual([]);
		});

		it("should throw if semaphore already exists", () => {
			mgr.createSemaphore("pool", 3);
			expect(() => mgr.createSemaphore("pool", 2)).toThrow(/already exists/);
		});

		it("should increment semaphoreCount", () => {
			expect(mgr.semaphoreCount).toBe(0);
			mgr.createSemaphore("s1", 1);
			expect(mgr.semaphoreCount).toBe(1);
		});

		it("should have a unique id", () => {
			const s = mgr.createSemaphore("pool", 1);
			expect(s.id).toBeTruthy();
			expect(typeof s.id).toBe("string");
		});
	});

	describe("acquireSemaphore", () => {
		it("should throw if semaphore does not exist", () => {
			expect(() => mgr.acquireSemaphore("nope", "a")).toThrow(/does not exist/);
		});

		it("should resolve immediately when permits are available", async () => {
			mgr.createSemaphore("pool", 2);
			await expect(mgr.acquireSemaphore("pool", "a1")).resolves.toBeUndefined();
		});

		it("should decrement permits on acquire", async () => {
			const s = mgr.createSemaphore("pool", 3);
			await mgr.acquireSemaphore("pool", "a1");
			expect(s.currentPermits).toBe(2);
			await mgr.acquireSemaphore("pool", "a2");
			expect(s.currentPermits).toBe(1);
		});

		it("should block when no permits are available", async () => {
			mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			let resolved = false;
			const p2 = mgr.acquireSemaphore("pool", "a2").then(() => { resolved = true; });
			await Promise.resolve();
			expect(resolved).toBe(false);
			mgr.releaseSemaphore("pool", "a1");
			await p2;
			expect(resolved).toBe(true);
		});

		it("should queue multiple waiters in FIFO order", async () => {
			mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			const order: string[] = [];
			const p2 = mgr.acquireSemaphore("pool", "a2").then(() => { order.push("a2"); });
			const p3 = mgr.acquireSemaphore("pool", "a3").then(() => { order.push("a3"); });
			mgr.releaseSemaphore("pool", "a1");
			await p2;
			mgr.releaseSemaphore("pool", "a2");
			await p3;
			expect(order).toEqual(["a2", "a3"]);
		});

		it("should allow all permits to be consumed", async () => {
			const s = mgr.createSemaphore("pool", 3);
			await mgr.acquireSemaphore("pool", "a1");
			await mgr.acquireSemaphore("pool", "a2");
			await mgr.acquireSemaphore("pool", "a3");
			expect(s.currentPermits).toBe(0);
		});
	});

	describe("releaseSemaphore", () => {
		it("should throw if semaphore does not exist", () => {
			expect(() => mgr.releaseSemaphore("nope", "a")).toThrow(/does not exist/);
		});

		it("should increment permits when no waiters", async () => {
			const s = mgr.createSemaphore("pool", 2);
			await mgr.acquireSemaphore("pool", "a1");
			expect(s.currentPermits).toBe(1);
			mgr.releaseSemaphore("pool", "a1");
			expect(s.currentPermits).toBe(2);
		});

		it("should cap permits at maxPermits", () => {
			const s = mgr.createSemaphore("pool", 2);
			mgr.releaseSemaphore("pool", "a1");
			expect(s.currentPermits).toBe(2);
		});

		it("should pass permit to next waiter instead of incrementing", async () => {
			const s = mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			const p2 = mgr.acquireSemaphore("pool", "a2");
			mgr.releaseSemaphore("pool", "a1");
			await p2;
			expect(s.currentPermits).toBe(0);
		});
	});

	describe("clear", () => {
		it("should remove all semaphores", () => {
			mgr.createSemaphore("s1", 1);
			mgr.createSemaphore("s2", 2);
			mgr.clear();
			expect(mgr.semaphoreCount).toBe(0);
		});
	});

	describe("logging", () => {
		it("should log on create", () => {
			mgr.createSemaphore("pool", 3);
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[semaphore:create]"));
		});

		it("should log on acquire", async () => {
			mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[semaphore:acquire]"));
		});

		it("should log on release", async () => {
			mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			mgr.releaseSemaphore("pool", "a1");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[semaphore:release]"));
		});

		it("should log when a waiter queues", async () => {
			mgr.createSemaphore("pool", 1);
			await mgr.acquireSemaphore("pool", "a1");
			mgr.acquireSemaphore("pool", "a2");
			expect(log).toHaveBeenCalledWith(expect.stringContaining("[semaphore:wait]"));
		});
	});
});
