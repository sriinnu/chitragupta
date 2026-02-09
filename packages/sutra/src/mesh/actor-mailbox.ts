/**
 * @chitragupta/sutra/mesh — Lock-free 4-lane priority mailbox.
 *
 * Each actor owns a mailbox that partitions incoming envelopes across
 * four priority lanes (0 = low ... 3 = critical). Dequeue always favours
 * the highest non-empty lane, ensuring that critical signals (heartbeats,
 * kill commands) preempt routine traffic without any mutex.
 *
 * The design mirrors the four Vedic varnas of duty — critical dharma
 * always takes precedence, while lower-priority karma queues patiently.
 */

import type { MeshEnvelope, MeshPriority } from "./types.js";

/** Number of priority lanes. */
const LANE_COUNT = 4;

/**
 * A bounded, lock-free, 4-lane priority queue for MeshEnvelope messages.
 *
 * - `push` returns false when the total capacity is exhausted.
 * - `pop` drains from the highest non-empty lane first.
 * - No locks: single-threaded JS event loop guarantees atomicity.
 */
export class ActorMailbox {
	/** Internal lanes indexed by priority (0 = low ... 3 = critical). */
	private readonly lanes: MeshEnvelope[][] = [];
	private readonly maxSize: number;
	private count = 0;

	constructor(maxSize = 10_000) {
		this.maxSize = maxSize;
		for (let i = 0; i < LANE_COUNT; i++) {
			this.lanes.push([]);
		}
	}

	// ─── Accessors ─────────────────────────────────────────────────

	get size(): number {
		return this.count;
	}

	get isEmpty(): boolean {
		return this.count === 0;
	}

	get isFull(): boolean {
		return this.count >= this.maxSize;
	}

	// ─── Enqueue ───────────────────────────────────────────────────

	/**
	 * Push an envelope into its priority lane.
	 *
	 * @returns `true` if accepted, `false` if the mailbox is full.
	 */
	push(envelope: MeshEnvelope): boolean {
		if (this.count >= this.maxSize) return false;

		const lane = clampPriority(envelope.priority);
		this.lanes[lane].push(envelope);
		this.count++;
		return true;
	}

	// ─── Dequeue ───────────────────────────────────────────────────

	/**
	 * Pop the highest-priority envelope.
	 *
	 * Scans from lane 3 (critical) down to lane 0 (low) and shifts
	 * the first element found.
	 *
	 * @returns The next envelope, or `undefined` if empty.
	 */
	pop(): MeshEnvelope | undefined {
		for (let lane = LANE_COUNT - 1; lane >= 0; lane--) {
			if (this.lanes[lane].length > 0) {
				this.count--;
				return this.lanes[lane].shift()!;
			}
		}
		return undefined;
	}

	/**
	 * Peek at the highest-priority envelope without removing it.
	 */
	peek(): MeshEnvelope | undefined {
		for (let lane = LANE_COUNT - 1; lane >= 0; lane--) {
			if (this.lanes[lane].length > 0) {
				return this.lanes[lane][0];
			}
		}
		return undefined;
	}

	/**
	 * Drain all envelopes in priority order (highest first).
	 *
	 * @returns An array of all envelopes, emptying the mailbox.
	 */
	drain(): MeshEnvelope[] {
		const result: MeshEnvelope[] = [];
		for (let lane = LANE_COUNT - 1; lane >= 0; lane--) {
			if (this.lanes[lane].length > 0) {
				result.push(...this.lanes[lane]);
				this.lanes[lane] = [];
			}
		}
		this.count = 0;
		return result;
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a priority value to a valid lane index [0, 3]. */
function clampPriority(p: MeshPriority): number {
	return Math.max(0, Math.min(3, p)) | 0;
}
