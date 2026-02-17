/**
 * @chitragupta/sutra — Deadlock Prevention via Banker's Algorithm.
 *
 * While the existing `deadlock.ts` provides DFS-based deadlock *detection*
 * (a reactive approach), this module implements Banker's Algorithm for
 * deadlock *prevention* (a proactive approach).
 *
 * Banker's Algorithm (Dijkstra, 1965) prevents deadlocks by ensuring the
 * system never enters an unsafe state. Before granting any resource request,
 * it simulates the allocation and checks whether a safe sequence exists —
 * i.e., an ordering of processes where each can complete given the currently
 * available resources plus those held by all previously completed processes.
 *
 * Key data structures:
 *
 *   Available[r]      — Currently available instances of resource r
 *   Max[p][r]         — Maximum demand of process p for resource r
 *   Allocation[p][r]  — Currently allocated to process p of resource r
 *   Need[p][r]        — Max[p][r] - Allocation[p][r]
 *
 * Safe state check (O(n^2 * m) where n = processes, m = resources):
 *
 *   Work = Available.copy()
 *   Finish = [false] * n
 *   while exists i where !Finish[i] && Need[i] <= Work:
 *       Work += Allocation[i]
 *       Finish[i] = true
 *   return all(Finish)
 *
 * Integration: uses the existing `detectDeadlocks()` as a fallback safety
 * net. If prevention somehow fails, detection catches the deadlock.
 */

import type { DeadlockInfo } from "./types.js";
import type { CommHub } from "./hub.js";

// ─── Resource Vector Operations ──────────────────────────────────────────────

/**
 * Check if vector a is component-wise <= vector b.
 *
 * This is the partial order on resource vectors used by Banker's Algorithm:
 * a request Need[i] is satisfiable when Need[i] <= Work.
 *
 * @param a - First resource vector.
 * @param b - Second resource vector.
 * @returns True if a[r] <= b[r] for all resources r.
 */
function vectorLte(a: Map<string, number>, b: Map<string, number>): boolean {
	for (const [resource, needed] of a) {
		if (needed > (b.get(resource) ?? 0)) return false;
	}
	return true;
}

/**
 * Add vector a to vector b (in-place on b): b[r] += a[r] for all r.
 */
function vectorAdd(target: Map<string, number>, source: Map<string, number>): void {
	for (const [resource, amount] of source) {
		target.set(resource, (target.get(resource) ?? 0) + amount);
	}
}

/**
 * Subtract vector a from vector b (in-place on b): b[r] -= a[r] for all r.
 * Clamps to 0 to prevent negative resource counts.
 */
function vectorSub(target: Map<string, number>, source: Map<string, number>): void {
	for (const [resource, amount] of source) {
		const current = target.get(resource) ?? 0;
		target.set(resource, Math.max(0, current - amount));
	}
}

/** Clone a resource vector (Map). */
function vectorClone(v: Map<string, number>): Map<string, number> {
	return new Map(v);
}

// ─── State Snapshot ──────────────────────────────────────────────────────────

/** A snapshot of the Banker's Algorithm state matrices. */
export interface BankerState {
	/** Available resources. */
	available: Record<string, number>;
	/** Maximum declared demand per process. */
	max: Record<string, Record<string, number>>;
	/** Current allocation per process. */
	allocation: Record<string, Record<string, number>>;
	/** Remaining need per process (Max - Allocation). */
	need: Record<string, Record<string, number>>;
	/** All known resource types and their total instances. */
	totalResources: Record<string, number>;
	/** All registered process IDs. */
	processes: string[];
}

/** Result of a resource request. */
export interface RequestResult {
	/** Whether the request was granted. */
	granted: boolean;
	/** Human-readable reason if denied. */
	reason?: string;
}

// ─── Banker's Algorithm ──────────────────────────────────────────────────────

/**
 * Banker's Algorithm implementation for deadlock prevention.
 *
 * Processes must declare their maximum resource needs upfront via
 * `declareMaximum()`. Each subsequent `requestResource()` is checked
 * against the safety invariant before being granted.
 *
 * The key invariant maintained at all times:
 *
 *   "There exists a safe sequence — an ordering of all processes such that
 *    each process can acquire its remaining needed resources from the
 *    currently available resources plus those freed by all previously
 *    completed processes in the sequence."
 *
 * This guarantees that no deadlock can occur, as long as:
 *   1. Processes declare honest maximum demands
 *   2. All resource requests go through `requestResource()`
 *   3. Released resources go through `releaseResource()`
 *
 * @example
 * ```ts
 * const banker = new BankersAlgorithm();
 * banker.addResource("cpu", 4);
 * banker.addResource("memory", 8);
 *
 * banker.declareMaximum("agent-1", { cpu: 2, memory: 4 });
 * banker.declareMaximum("agent-2", { cpu: 3, memory: 3 });
 *
 * const result = banker.requestResource("agent-1", { cpu: 1, memory: 2 });
 * if (result.granted) {
 *   // Use resources, then release
 *   banker.releaseResource("agent-1", { cpu: 1, memory: 2 });
 * }
 * ```
 */
export class BankersAlgorithm {
	/** Total instances of each resource type in the system. */
	private totalResources = new Map<string, number>();
	/** Currently available (unallocated) resources. */
	private available = new Map<string, number>();
	/** Maximum declared demand: processId -> resource -> amount. */
	private max = new Map<string, Map<string, number>>();
	/** Current allocation: processId -> resource -> amount. */
	private allocation = new Map<string, Map<string, number>>();
	/** Remaining need: processId -> resource -> amount (= max - allocation). */
	private need = new Map<string, Map<string, number>>();
	/** Ordered set of all registered processes. */
	private processes = new Set<string>();
	/** Optional CommHub reference for fallback deadlock detection. */
	private hub?: CommHub;

	/**
	 * @param hub - Optional CommHub instance for fallback deadlock detection.
	 */
	constructor(hub?: CommHub) {
		this.hub = hub;
	}

	// ─── Resource Management ──────────────────────────────────────────

	/**
	 * Register a resource type and its total available instances.
	 *
	 * @param resource - Resource identifier (e.g., "cpu", "memory", "gpu").
	 * @param totalInstances - Total number of instances available.
	 */
	addResource(resource: string, totalInstances: number): void {
		this.totalResources.set(resource, totalInstances);
		this.available.set(resource, totalInstances);
	}

	// ─── Process Declaration ──────────────────────────────────────────

	/**
	 * Declare the maximum resource demand for a process.
	 *
	 * This must be called before the process can request any resources.
	 * The maximum claim must not exceed the total available for any resource.
	 *
	 * @param processId - Unique process identifier.
	 * @param resources - Maximum demand: resource name -> max instances needed.
	 * @throws If maximum exceeds total available for any resource.
	 */
	declareMaximum(processId: string, resources: Record<string, number>): void {
		// Validate: max cannot exceed total
		for (const [resource, amount] of Object.entries(resources)) {
			const total = this.totalResources.get(resource);
			if (total === undefined) {
				throw new Error(
					`Resource "${resource}" is not registered. Call addResource() first.`,
				);
			}
			if (amount > total) {
				throw new Error(
					`Process "${processId}" claims max ${amount} of "${resource}" but only ${total} exist.`,
				);
			}
		}

		this.processes.add(processId);
		this.max.set(processId, new Map(Object.entries(resources)));
		this.allocation.set(processId, new Map());
		this.need.set(processId, new Map(Object.entries(resources)));
	}

	// ─── Resource Requests ────────────────────────────────────────────

	/**
	 * Request resources for a process. The request is granted only if the
	 * resulting state is safe (a safe sequence exists).
	 *
	 * Algorithm:
	 *   1. Validate: request <= need[process] (don't exceed declared max)
	 *   2. Validate: request <= available (resources must be physically available)
	 *   3. Tentatively allocate: available -= request, allocation += request, need -= request
	 *   4. Check if the resulting state is safe (safe sequence exists)
	 *   5. If safe: keep the allocation. If unsafe: roll back and deny.
	 *
	 * @param processId - The requesting process.
	 * @param request - Resources requested: resource name -> amount.
	 * @returns Whether the request was granted and why if not.
	 */
	requestResource(
		processId: string,
		request: Record<string, number>,
	): RequestResult {
		if (!this.processes.has(processId)) {
			return {
				granted: false,
				reason: `Process "${processId}" has not declared its maximum. Call declareMaximum() first.`,
			};
		}

		const reqMap = new Map(Object.entries(request));
		const processNeed = this.need.get(processId)!;
		const processAlloc = this.allocation.get(processId)!;

		// Check 1: request <= need
		for (const [resource, amount] of reqMap) {
			const needed = processNeed.get(resource) ?? 0;
			if (amount > needed) {
				return {
					granted: false,
					reason: `Process "${processId}" requests ${amount} of "${resource}" but only needs ${needed} more (exceeded declared maximum).`,
				};
			}
		}

		// Check 2: request <= available
		for (const [resource, amount] of reqMap) {
			const avail = this.available.get(resource) ?? 0;
			if (amount > avail) {
				return {
					granted: false,
					reason: `Insufficient "${resource}": requested ${amount}, available ${avail}. Process must wait.`,
				};
			}
		}

		// Tentative allocation
		const savedAvailable = vectorClone(this.available);
		const savedAlloc = vectorClone(processAlloc);
		const savedNeed = vectorClone(processNeed);

		vectorSub(this.available, reqMap);
		vectorAdd(processAlloc, reqMap);
		vectorSub(processNeed, reqMap);

		// Safety check
		if (this.isSafeState()) {
			return { granted: true };
		}

		// Rollback: unsafe state
		this.available = savedAvailable;
		for (const [k, v] of savedAlloc) processAlloc.set(k, v);
		for (const [k, v] of savedNeed) processNeed.set(k, v);
		// Clear any new keys that didn't exist before
		for (const k of processAlloc.keys()) {
			if (!savedAlloc.has(k)) processAlloc.delete(k);
		}
		for (const k of processNeed.keys()) {
			if (!savedNeed.has(k)) processNeed.delete(k);
		}

		return {
			granted: false,
			reason: `Granting this request would leave the system in an unsafe state (no safe sequence exists). Request denied to prevent potential deadlock.`,
		};
	}

	// ─── Resource Release ─────────────────────────────────────────────

	/**
	 * Release resources held by a process.
	 *
	 * Released resources are returned to the available pool.
	 *
	 * @param processId - The releasing process.
	 * @param release - Resources to release: resource name -> amount.
	 */
	releaseResource(processId: string, release: Record<string, number>): void {
		const processAlloc = this.allocation.get(processId);
		if (!processAlloc) return;

		const releaseMap = new Map(Object.entries(release));

		for (const [resource, amount] of releaseMap) {
			const allocated = processAlloc.get(resource) ?? 0;
			const releaseAmount = Math.min(amount, allocated);

			processAlloc.set(resource, allocated - releaseAmount);
			this.available.set(
				resource,
				(this.available.get(resource) ?? 0) + releaseAmount,
			);
		}
	}

	/**
	 * Remove a process entirely, releasing all its resources.
	 *
	 * @param processId - The process to remove.
	 */
	removeProcess(processId: string): void {
		const processAlloc = this.allocation.get(processId);
		if (processAlloc) {
			vectorAdd(this.available, processAlloc);
		}

		this.processes.delete(processId);
		this.max.delete(processId);
		this.allocation.delete(processId);
		this.need.delete(processId);
	}

	// ─── Safety Check ─────────────────────────────────────────────────

	/**
	 * Determine whether the current state is safe.
	 *
	 * A state is safe if there exists a *safe sequence* — an ordering of
	 * all processes P_1, P_2, ..., P_n such that for each P_i:
	 *
	 *   Need[P_i] <= Work    (where Work starts as Available
	 *                          and accumulates freed resources)
	 *
	 * The algorithm greedily finds such a sequence:
	 *
	 *   Work = Available.copy()
	 *   Finish = {p: false for all p}
	 *   while exists p where !Finish[p] && Need[p] <= Work:
	 *       Work += Allocation[p]    // p finishes, releases its resources
	 *       Finish[p] = true
	 *   return all(Finish)
	 *
	 * Complexity: O(n^2 * m) in the worst case (n processes, m resource types),
	 * as each pass finds at least one finishable process.
	 *
	 * @returns True if the current state is safe (deadlock-free).
	 */
	isSafeState(): boolean {
		const work = vectorClone(this.available);
		const finish = new Map<string, boolean>();

		for (const pid of this.processes) {
			finish.set(pid, false);
		}

		let progress = true;
		while (progress) {
			progress = false;

			for (const pid of this.processes) {
				if (finish.get(pid)) continue;

				const processNeed = this.need.get(pid);
				if (!processNeed) {
					finish.set(pid, true);
					progress = true;
					continue;
				}

				// Can this process finish with current Work?
				if (vectorLte(processNeed, work)) {
					// Process can finish: release its allocation back to Work
					const processAlloc = this.allocation.get(pid);
					if (processAlloc) {
						vectorAdd(work, processAlloc);
					}
					finish.set(pid, true);
					progress = true;
				}
			}
		}

		// Safe if all processes can finish
		for (const done of finish.values()) {
			if (!done) return false;
		}
		return true;
	}

	// ─── State Inspection ─────────────────────────────────────────────

	/**
	 * Get a snapshot of all Banker's Algorithm matrices.
	 *
	 * @returns A serializable snapshot of the current state.
	 */
	getState(): BankerState {
		const mapToRecord = (m: Map<string, number>): Record<string, number> =>
			Object.fromEntries(m);

		const nestedMapToRecord = (
			m: Map<string, Map<string, number>>,
		): Record<string, Record<string, number>> => {
			const result: Record<string, Record<string, number>> = {};
			for (const [key, inner] of m) {
				result[key] = mapToRecord(inner);
			}
			return result;
		};

		return {
			available: mapToRecord(this.available),
			max: nestedMapToRecord(this.max),
			allocation: nestedMapToRecord(this.allocation),
			need: nestedMapToRecord(this.need),
			totalResources: mapToRecord(this.totalResources),
			processes: [...this.processes],
		};
	}
}
