/**
 * JobQueue — Priority min-heap for the Niyanta background job scheduler.
 *
 * Implements a binary min-heap ordered by (priority weight, scheduledAt, createdAt).
 * Supports O(log n) enqueue/dequeue, peek, removal by ID, and deferred-job filtering.
 *
 * @module job-queue
 */

import {
	PRIORITY_WEIGHT,
	type SchedulerJob,
} from "./scheduler-types.js";

// ─── Comparison ──────────────────────────────────────────────────────────────

/**
 * Compare two jobs for heap ordering.
 * Lower priority weight wins; ties break by scheduledAt then createdAt.
 * Returns negative if `a` should come before `b`.
 */
function compareJobs(a: SchedulerJob, b: SchedulerJob): number {
	const pa = PRIORITY_WEIGHT[a.priority];
	const pb = PRIORITY_WEIGHT[b.priority];
	if (pa !== pb) return pa - pb;

	const sa = a.scheduledAt ?? 0;
	const sb = b.scheduledAt ?? 0;
	if (sa !== sb) return sa - sb;

	return a.createdAt - b.createdAt;
}

// ─── JobQueue ────────────────────────────────────────────────────────────────

/**
 * Priority queue backed by a binary min-heap.
 *
 * Jobs are ordered by priority weight (critical < high < normal < low < background),
 * then by scheduledAt (earlier first), then by createdAt (FIFO within same priority).
 *
 * Deferred jobs (those with a future `scheduledAt`) are stored in the heap but
 * only returned by {@link dequeueEligible} once `Date.now() >= scheduledAt`.
 *
 * @example
 * ```ts
 * const q = new JobQueue();
 * q.enqueue(job);
 * const next = q.dequeueEligible();
 * ```
 */
export class JobQueue {
	/** The min-heap array. Index 0 is the root (highest priority). */
	private heap: SchedulerJob[] = [];

	/** Fast lookup by job ID for O(1) existence checks and O(n) removal. */
	private index = new Map<string, number>();

	/** Number of jobs in the queue. */
	get size(): number {
		return this.heap.length;
	}

	/** Whether the queue is empty. */
	get isEmpty(): boolean {
		return this.heap.length === 0;
	}

	/**
	 * Add a job to the queue. O(log n).
	 * @param job - The job to enqueue.
	 * @throws If a job with the same ID already exists.
	 */
	enqueue(job: SchedulerJob): void {
		if (this.index.has(job.id)) {
			throw new Error(`Job "${job.id}" is already in the queue.`);
		}
		const pos = this.heap.length;
		this.heap.push(job);
		this.index.set(job.id, pos);
		this.bubbleUp(pos);
	}

	/**
	 * Peek at the highest-priority job without removing it.
	 * @returns The top job, or undefined if the queue is empty.
	 */
	peek(): SchedulerJob | undefined {
		return this.heap[0];
	}

	/**
	 * Dequeue the highest-priority job that is eligible for execution.
	 *
	 * A job is eligible if it has no `scheduledAt`, or `Date.now() >= scheduledAt`.
	 * Deferred jobs that are not yet eligible are skipped (left in the heap).
	 *
	 * @returns The next eligible job, or undefined if none are eligible.
	 */
	dequeueEligible(): SchedulerJob | undefined {
		const now = Date.now();

		// Scan from root downward for the first eligible job.
		// In the common case (no deferred jobs), this is just the root.
		const eligible = this.findFirstEligible(now);
		if (eligible === undefined) return undefined;

		return this.removeAt(eligible);
	}

	/**
	 * Remove a job by ID. O(n) scan + O(log n) heap fix.
	 * @param jobId - The ID of the job to remove.
	 * @returns The removed job, or undefined if not found.
	 */
	remove(jobId: string): SchedulerJob | undefined {
		const pos = this.index.get(jobId);
		if (pos === undefined) return undefined;
		return this.removeAt(pos);
	}

	/**
	 * Check whether a job exists in the queue.
	 * @param jobId - The job ID to check.
	 */
	has(jobId: string): boolean {
		return this.index.has(jobId);
	}

	/**
	 * Drain all jobs from the queue, returned in priority order.
	 * @returns All jobs, sorted by priority.
	 */
	drain(): SchedulerJob[] {
		const result: SchedulerJob[] = [];
		while (this.heap.length > 0) {
			result.push(this.removeAt(0));
		}
		return result;
	}

	/**
	 * Get all jobs currently in the queue (unordered snapshot).
	 * @returns A shallow copy of all queued jobs.
	 */
	toArray(): SchedulerJob[] {
		return [...this.heap];
	}

	// ─── Private: Heap Operations ────────────────────────────────────────

	/**
	 * Find the index of the first eligible job by BFS-style traversal.
	 * Prioritized by heap order, skipping deferred jobs not yet ready.
	 */
	private findFirstEligible(now: number): number | undefined {
		if (this.heap.length === 0) return undefined;

		// BFS through heap levels to find the first eligible job
		const queue: number[] = [0];
		let bestIdx: number | undefined;
		let bestJob: SchedulerJob | undefined;

		while (queue.length > 0) {
			const idx = queue.shift()!;
			if (idx >= this.heap.length) continue;

			const job = this.heap[idx];
			const isEligible = job.scheduledAt === undefined || job.scheduledAt <= now;

			if (isEligible) {
				if (bestJob === undefined || compareJobs(job, bestJob) < 0) {
					bestIdx = idx;
					bestJob = job;
				}
				// No need to check children — heap property guarantees they are lower priority.
				continue;
			}

			// Job is deferred but not ready — check children (they might be eligible).
			const left = 2 * idx + 1;
			const right = 2 * idx + 2;
			if (left < this.heap.length) queue.push(left);
			if (right < this.heap.length) queue.push(right);
		}

		return bestIdx;
	}

	/** Remove the job at a given heap index and restore heap order. */
	private removeAt(pos: number): SchedulerJob {
		const removed = this.heap[pos];
		this.index.delete(removed.id);

		const last = this.heap.pop()!;
		if (pos < this.heap.length) {
			this.heap[pos] = last;
			this.index.set(last.id, pos);
			this.bubbleUp(pos);
			this.sinkDown(pos);
		}

		return removed;
	}

	/** Move a node up until the heap property is restored. */
	private bubbleUp(pos: number): void {
		while (pos > 0) {
			const parent = Math.floor((pos - 1) / 2);
			if (compareJobs(this.heap[pos], this.heap[parent]) >= 0) break;
			this.swap(pos, parent);
			pos = parent;
		}
	}

	/** Move a node down until the heap property is restored. */
	private sinkDown(pos: number): void {
		const len = this.heap.length;
		while (true) {
			let smallest = pos;
			const left = 2 * pos + 1;
			const right = 2 * pos + 2;

			if (left < len && compareJobs(this.heap[left], this.heap[smallest]) < 0) {
				smallest = left;
			}
			if (right < len && compareJobs(this.heap[right], this.heap[smallest]) < 0) {
				smallest = right;
			}
			if (smallest === pos) break;
			this.swap(pos, smallest);
			pos = smallest;
		}
	}

	/** Swap two heap positions, updating the index map. */
	private swap(a: number, b: number): void {
		const jobA = this.heap[a];
		const jobB = this.heap[b];
		this.heap[a] = jobB;
		this.heap[b] = jobA;
		this.index.set(jobA.id, b);
		this.index.set(jobB.id, a);
	}
}
