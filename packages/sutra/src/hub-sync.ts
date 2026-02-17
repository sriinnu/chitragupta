/**
 * @chitragupta/sutra — Synchronization primitives for CommHub.
 *
 * Extracted from hub.ts to keep file sizes manageable.
 * Provides distributed coordination primitives:
 * - Locks with FIFO wait queues (re-entrant)
 * - Barriers (block until N agents arrive)
 * - Counting semaphores (fair FIFO queue)
 */

import type { Barrier, Lock, Semaphore } from "./types.js";

// ─── Lock Manager ────────────────────────────────────────────────────────────

/**
 * Manages resource locks with FIFO wait queues and re-entrant support.
 *
 * Used internally by CommHub. Lock waiters are queued in FIFO order and
 * automatically promoted when the holder releases.
 */
export class LockManager {
	private readonly locks = new Map<string, Lock>();
	private readonly lockWaiters = new Map<string, Array<{
		agentId: string;
		resolve: (lock: Lock) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>>();
	private readonly defaultTimeout: number;
	private readonly logFn: (msg: string) => void;

	constructor(defaultTimeout: number, logFn: (msg: string) => void) {
		this.defaultTimeout = defaultTimeout;
		this.logFn = logFn;
	}

	/**
	 * Acquire a lock on a resource.
	 *
	 * Re-entrant: if the same agent already holds the lock, returns it immediately.
	 *
	 * @param resource - The resource identifier to lock.
	 * @param agentId - The agent requesting the lock.
	 * @param timeout - Max wait time in ms (defaults to configured lockTimeout).
	 * @returns The acquired lock object.
	 * @throws If the wait times out.
	 */
	acquireLock(resource: string, agentId: string, timeout?: number): Promise<Lock> {
		const lockTimeout = timeout ?? this.defaultTimeout;

		// If not locked, acquire immediately
		if (!this.locks.has(resource)) {
			const lock = this.createLock(resource, agentId, lockTimeout);
			return Promise.resolve(lock);
		}

		const existing = this.locks.get(resource)!;

		// Re-entrant
		if (existing.holder === agentId) {
			return Promise.resolve(existing);
		}

		// Queue and wait
		return new Promise<Lock>((resolve, reject) => {
			const timer = setTimeout(() => {
				const waiters = this.lockWaiters.get(resource);
				if (waiters) {
					const idx = waiters.findIndex((w) => w.agentId === agentId);
					if (idx !== -1) waiters.splice(idx, 1);
				}
				const lock = this.locks.get(resource);
				if (lock) {
					lock.waitQueue = lock.waitQueue.filter((id) => id !== agentId);
				}
				reject(new Error(
					`Lock timeout: agent "${agentId}" waited ${lockTimeout}ms for resource "${resource}".`,
				));
			}, lockTimeout);

			if (!this.lockWaiters.has(resource)) {
				this.lockWaiters.set(resource, []);
			}
			this.lockWaiters.get(resource)!.push({ agentId, resolve, reject, timer });
			existing.waitQueue.push(agentId);

			this.logFn(`[lock:wait] ${agentId} waiting for ${resource}`);
		});
	}

	/**
	 * Release a lock held by the specified agent.
	 *
	 * If there are waiters, the next one in the FIFO queue acquires the lock.
	 *
	 * @param resource - The locked resource identifier.
	 * @param agentId - The agent releasing the lock (must be the current holder).
	 * @throws If no lock exists or the agent is not the holder.
	 */
	releaseLock(resource: string, agentId: string): void {
		const lock = this.locks.get(resource);
		if (!lock) throw new Error(`No lock exists for resource "${resource}".`);
		if (lock.holder !== agentId) {
			throw new Error(
				`Agent "${agentId}" does not hold the lock for resource "${resource}" (holder: ${lock.holder}).`,
			);
		}

		this.logFn(`[lock:release] ${agentId} released ${resource}`);

		const waiters = this.lockWaiters.get(resource);
		if (waiters && waiters.length > 0) {
			const next = waiters.shift()!;
			clearTimeout(next.timer);
			lock.waitQueue = lock.waitQueue.filter((id) => id !== next.agentId);
			const newLock = this.createLock(resource, next.agentId, this.defaultTimeout);
			newLock.waitQueue = lock.waitQueue;
			next.resolve(newLock);
			// Clean up empty waiter list
			if (waiters.length === 0) {
				this.lockWaiters.delete(resource);
			}
		} else {
			this.locks.delete(resource);
			this.lockWaiters.delete(resource);
		}
	}

	/** Check if a resource is currently locked. */
	isLocked(resource: string): boolean {
		return this.locks.has(resource);
	}

	/** Get all current locks (read-only snapshot). Used by deadlock detection. */
	getLocks(): ReadonlyMap<string, Lock> {
		return this.locks;
	}

	/** Force-release a lock regardless of holder (used by deadlock resolution). */
	forceReleaseLock(resource: string): void {
		const lock = this.locks.get(resource);
		if (!lock) return;

		this.logFn(`[lock:force-release] ${resource} (was held by ${lock.holder})`);

		const waiters = this.lockWaiters.get(resource);
		if (waiters && waiters.length > 0) {
			const next = waiters.shift()!;
			clearTimeout(next.timer);
			const newLock = this.createLock(resource, next.agentId, this.defaultTimeout);
			newLock.waitQueue = lock.waitQueue.filter((id) => id !== next.agentId);
			next.resolve(newLock);
		} else {
			this.locks.delete(resource);
			this.lockWaiters.delete(resource);
		}
	}

	/** Clean up expired locks. */
	cleanupLocks(releaseFn: (resource: string, holder: string) => void): void {
		const now = Date.now();
		for (const [resource, lock] of this.locks.entries()) {
			if (lock.expiresAt <= now) {
				this.logFn(`[lock:expire] ${resource} held by ${lock.holder}`);
				try {
					releaseFn(resource, lock.holder);
				} catch {
					this.locks.delete(resource);
				}
			}
		}
	}

	/** Number of active locks. */
	get lockCount(): number {
		return this.locks.size;
	}

	/** Reject all lock waiters (on destroy). */
	rejectAll(reason: string): void {
		for (const [, waiters] of this.lockWaiters.entries()) {
			for (const waiter of waiters) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error(reason));
			}
		}
	}

	/** Clear all state. */
	clear(): void {
		this.locks.clear();
		this.lockWaiters.clear();
	}

	private createLock(resource: string, agentId: string, timeout: number): Lock {
		const lock: Lock = {
			id: crypto.randomUUID(),
			resource,
			holder: agentId,
			acquiredAt: Date.now(),
			expiresAt: Date.now() + timeout,
			waitQueue: [],
		};

		this.locks.set(resource, lock);
		this.logFn(`[lock:acquire] ${agentId} acquired ${resource}`);
		return lock;
	}
}

// ─── Barrier Manager ─────────────────────────────────────────────────────────

/**
 * Manages coordination barriers that block until a required number of agents arrive.
 */
export class BarrierManager {
	private readonly barriers = new Map<string, Barrier>();
	private readonly logFn: (msg: string) => void;

	constructor(logFn: (msg: string) => void) {
		this.logFn = logFn;
	}

	/**
	 * Create a barrier that blocks until `requiredCount` agents arrive.
	 *
	 * @param name - Unique barrier name.
	 * @param requiredCount - Number of agents that must arrive before all are released.
	 * @returns The created barrier object.
	 * @throws If a barrier with the same name already exists.
	 */
	createBarrier(name: string, requiredCount: number): Barrier {
		if (this.barriers.has(name)) {
			throw new Error(`Barrier "${name}" already exists.`);
		}

		const barrier: Barrier = {
			id: crypto.randomUUID(),
			name,
			required: requiredCount,
			arrived: new Set(),
			resolvers: [],
		};

		this.barriers.set(name, barrier);
		this.logFn(`[barrier:create] ${name} required=${requiredCount}`);
		return barrier;
	}

	/**
	 * Arrive at a barrier. When the last agent arrives, all promises resolve.
	 *
	 * @param barrierName - The barrier to arrive at.
	 * @param agentId - The arriving agent ID.
	 * @returns A promise that resolves when all required agents have arrived.
	 * @throws If the barrier does not exist.
	 */
	arriveAtBarrier(barrierName: string, agentId: string): Promise<void> {
		const barrier = this.barriers.get(barrierName);
		if (!barrier) throw new Error(`Barrier "${barrierName}" does not exist.`);

		barrier.arrived.add(agentId);
		this.logFn(`[barrier:arrive] ${agentId} at ${barrierName} (${barrier.arrived.size}/${barrier.required})`);

		if (barrier.arrived.size >= barrier.required && barrier.resolvers.length > 0) {
			const resolvers = barrier.resolvers;
			barrier.resolvers = [];
			for (const resolver of resolvers) resolver();
			return Promise.resolve();
		}
		if (barrier.arrived.size >= barrier.required) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			barrier.resolvers.push(resolve);
		});
	}

	/** Number of active barriers. */
	get barrierCount(): number {
		return this.barriers.size;
	}

	/** Clear all barriers. */
	clear(): void {
		this.barriers.clear();
	}
}

// ─── Semaphore Manager ───────────────────────────────────────────────────────

/**
 * Manages counting semaphores with fair FIFO wait queues.
 */
export class SemaphoreManager {
	private readonly semaphores = new Map<string, Semaphore>();
	private readonly logFn: (msg: string) => void;

	constructor(logFn: (msg: string) => void) {
		this.logFn = logFn;
	}

	/**
	 * Create a counting semaphore with the given number of permits.
	 *
	 * @param name - Unique semaphore name.
	 * @param permits - Maximum number of concurrent permits.
	 * @returns The created semaphore object.
	 * @throws If a semaphore with the same name already exists.
	 */
	createSemaphore(name: string, permits: number): Semaphore {
		if (this.semaphores.has(name)) {
			throw new Error(`Semaphore "${name}" already exists.`);
		}

		const semaphore: Semaphore = {
			id: crypto.randomUUID(),
			name,
			maxPermits: permits,
			currentPermits: permits,
			waitQueue: [],
		};

		this.semaphores.set(name, semaphore);
		this.logFn(`[semaphore:create] ${name} permits=${permits}`);
		return semaphore;
	}

	/**
	 * Acquire a permit. Blocks if no permits are available (fair FIFO).
	 *
	 * @param name - The semaphore name.
	 * @param agentId - The agent acquiring the permit.
	 * @returns A promise that resolves when a permit is acquired.
	 * @throws If the semaphore does not exist.
	 */
	acquireSemaphore(name: string, agentId: string): Promise<void> {
		const semaphore = this.semaphores.get(name);
		if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);

		if (semaphore.currentPermits > 0) {
			semaphore.currentPermits--;
			this.logFn(`[semaphore:acquire] ${agentId} acquired ${name} (${semaphore.currentPermits}/${semaphore.maxPermits} remaining)`);
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			semaphore.waitQueue.push({ agentId, resolve });
			this.logFn(`[semaphore:wait] ${agentId} queued for ${name}`);
		});
	}

	/**
	 * Release a permit. If there are waiters, the next one gets the permit.
	 *
	 * @param name - The semaphore name.
	 * @param agentId - The agent releasing the permit.
	 * @throws If the semaphore does not exist.
	 */
	releaseSemaphore(name: string, agentId: string): void {
		const semaphore = this.semaphores.get(name);
		if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);

		this.logFn(`[semaphore:release] ${agentId} released ${name}`);

		if (semaphore.waitQueue.length > 0) {
			const next = semaphore.waitQueue.shift()!;
			this.logFn(`[semaphore:acquire] ${next.agentId} acquired ${name} (from queue)`);
			next.resolve();
		} else {
			semaphore.currentPermits = Math.min(semaphore.currentPermits + 1, semaphore.maxPermits);
		}
	}

	/** Number of active semaphores. */
	get semaphoreCount(): number {
		return this.semaphores.size;
	}

	/** Clear all semaphores. */
	clear(): void {
		this.semaphores.clear();
	}
}
