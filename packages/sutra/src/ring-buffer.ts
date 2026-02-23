/**
 * Generic fixed-size circular (ring) buffer.
 *
 * When at capacity the oldest entry is silently overwritten.
 * Reads always return items oldest-first. Used by Samiti
 * (ambient channels) and EventManager (webhook delivery history).
 *
 * Like a japa-mala (जपमाला) whose beads cycle endlessly —
 * the newest prayer bead pushes the oldest off the string,
 * yet the rhythm of recitation is never broken.
 *
 * @module ring-buffer
 */

/**
 * Fixed-size circular buffer that overwrites the oldest entry
 * when capacity is exceeded.
 *
 * @typeParam T - The type of elements stored in the buffer.
 */
export class RingBuffer<T> {
	private readonly buffer: (T | undefined)[];
	private head = 0;
	private count = 0;

	constructor(private readonly capacity: number) {
		this.buffer = new Array<T | undefined>(capacity);
	}

	/** Add an item, overwriting the oldest if at capacity. */
	push(item: T): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	/** Return all items as an array, oldest first. Optionally limit count. */
	toArray(limit?: number): T[] {
		const total = limit !== undefined ? Math.min(limit, this.count) : this.count;
		const result: T[] = [];
		const start = this.count < this.capacity ? 0 : this.head;
		const offset = this.count - total;
		for (let i = 0; i < total; i++) {
			const idx = (start + offset + i) % this.capacity;
			result.push(this.buffer[idx] as T);
		}
		return result;
	}

	/** Current number of items in the buffer. */
	get size(): number {
		return this.count;
	}

	/**
	 * Remove items that match a predicate. Returns the count of removed items.
	 * After removal the buffer is compacted to maintain contiguous storage.
	 */
	removeWhere(predicate: (item: T) => boolean): number {
		const kept: T[] = [];
		const arr = this.toArray();
		for (const item of arr) {
			if (!predicate(item)) kept.push(item);
		}
		const removed = this.count - kept.length;
		if (removed > 0) {
			this.buffer.fill(undefined);
			this.head = 0;
			this.count = 0;
			for (const item of kept) {
				this.push(item);
			}
		}
		return removed;
	}

	/** Clear the buffer entirely. */
	clear(): void {
		this.buffer.fill(undefined);
		this.head = 0;
		this.count = 0;
	}
}
