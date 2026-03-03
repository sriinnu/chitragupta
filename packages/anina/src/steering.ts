/**
 * SteeringManager — dual-queue steering with interrupt + follow-up priorities.
 *
 * Steering allows injecting instructions into the agent loop between turns.
 * Two priority levels:
 *   - **Interrupt** (high priority): delivered before any follow-ups, ASAP.
 *   - **Follow-up** (normal priority): delivered after the current task completes.
 *
 * Backward-compatible: original `steer()`, `queueFollowUp()`,
 * `getSteeringInstruction()`, and `getNextFollowUp()` still work.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Priority level for steering instructions. */
export type SteeringPriority = "interrupt" | "follow-up";

/** Steering mode controls how `getNext()` drains the queues. */
export type SteeringMode = "one-at-a-time" | "all";

/** A single steering instruction with priority and timestamp. */
export interface SteeringInstruction {
	/** The steering message text. */
	message: string;
	/** Priority level: interrupt or follow-up. */
	priority: SteeringPriority;
	/** When this instruction was queued (epoch ms). */
	queuedAt: number;
}

// ─── Manager ────────────────────────────────────────────────────────────────

/**
 * Manages mid-turn steering instructions and follow-up queues.
 *
 * Supports two queues with priority-aware retrieval:
 * interrupts are always delivered before follow-ups.
 */
export class SteeringManager {
	private interruptQueue: SteeringInstruction[] = [];
	private followUpQueue: SteeringInstruction[] = [];
	private mode: SteeringMode;

	/**
	 * @param mode - Controls `getNext()` behavior:
	 *   - `'one-at-a-time'` returns the single highest-priority instruction.
	 *   - `'all'` drains all pending into a combined message.
	 *   Defaults to `'one-at-a-time'`.
	 */
	constructor(mode: SteeringMode = "one-at-a-time") {
		this.mode = mode;
	}

	// ─── Interrupt Queue ──────────────────────────────────────────────────

	/**
	 * Add a high-priority interrupt instruction.
	 * Interrupts are always delivered before follow-ups.
	 */
	steerInterrupt(message: string): void {
		this.interruptQueue.push({
			message,
			priority: "interrupt",
			queuedAt: Date.now(),
		});
	}

	// ─── Follow-Up Queue ──────────────────────────────────────────────────

	/**
	 * Add a normal-priority follow-up message.
	 * Delivered after all pending interrupts are consumed.
	 */
	steerFollowUp(message: string): void {
		this.followUpQueue.push({
			message,
			priority: "follow-up",
			queuedAt: Date.now(),
		});
	}

	// ─── Priority-Aware Retrieval ─────────────────────────────────────────

	/**
	 * Get the next instruction, respecting priority ordering.
	 *
	 * In `'one-at-a-time'` mode: returns one interrupt (or one follow-up
	 * if no interrupts remain). Destructive read.
	 *
	 * In `'all'` mode: drains all interrupts then all follow-ups into a
	 * single combined `SteeringInstruction`. Returns null if empty.
	 */
	getNext(): SteeringInstruction | null {
		if (this.mode === "all") {
			return this.drainAll();
		}
		// One-at-a-time: interrupt first, then follow-up
		if (this.interruptQueue.length > 0) {
			return this.interruptQueue.shift()!;
		}
		if (this.followUpQueue.length > 0) {
			return this.followUpQueue.shift()!;
		}
		return null;
	}

	// ─── Backward-Compatible API ──────────────────────────────────────────

	/**
	 * Set a steering instruction (legacy API).
	 * Maps to `steerInterrupt()` for backward compatibility.
	 * @deprecated Use `steerInterrupt()` instead.
	 */
	steer(message: string): void {
		this.steerInterrupt(message);
	}

	/**
	 * Queue a follow-up message (legacy API).
	 * Maps to `steerFollowUp()` for backward compatibility.
	 * @deprecated Use `steerFollowUp()` instead.
	 */
	queueFollowUp(message: string): void {
		this.steerFollowUp(message);
	}

	/**
	 * Consume and return the next interrupt instruction (legacy API).
	 * Returns null if no interrupts are pending.
	 * @deprecated Use `getNext()` instead.
	 */
	getSteeringInstruction(): string | null {
		const instruction = this.interruptQueue.shift();
		return instruction?.message ?? null;
	}

	/**
	 * Dequeue and return the next follow-up message (legacy API).
	 * Returns null if no follow-ups are queued.
	 * @deprecated Use `getNext()` instead.
	 */
	getNextFollowUp(): string | null {
		const instruction = this.followUpQueue.shift();
		return instruction?.message ?? null;
	}

	// ─── Introspection ────────────────────────────────────────────────────

	/** Check if there are any pending interrupts or follow-ups. */
	hasPending(): boolean {
		return this.interruptQueue.length > 0 || this.followUpQueue.length > 0;
	}

	/** Number of pending interrupt instructions. */
	get interruptCount(): number {
		return this.interruptQueue.length;
	}

	/** Number of pending follow-up instructions. */
	get followUpCount(): number {
		return this.followUpQueue.length;
	}

	/** Total pending instructions across both queues. */
	get pendingCount(): number {
		return this.interruptQueue.length + this.followUpQueue.length;
	}

	/** Get the current steering mode. */
	getMode(): SteeringMode {
		return this.mode;
	}

	/** Update the steering mode. */
	setMode(mode: SteeringMode): void {
		this.mode = mode;
	}

	/** Clear all pending steering instructions and follow-ups. */
	clear(): void {
		this.interruptQueue = [];
		this.followUpQueue = [];
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	/**
	 * Drain all queues into a single combined instruction.
	 * Interrupts are listed first, then follow-ups.
	 * Returns null if both queues are empty.
	 */
	private drainAll(): SteeringInstruction | null {
		if (!this.hasPending()) return null;

		const parts: string[] = [];
		const earliest = Math.min(
			this.interruptQueue[0]?.queuedAt ?? Infinity,
			this.followUpQueue[0]?.queuedAt ?? Infinity,
		);

		// Drain interrupts first
		while (this.interruptQueue.length > 0) {
			parts.push(`[INTERRUPT] ${this.interruptQueue.shift()!.message}`);
		}
		// Then follow-ups
		while (this.followUpQueue.length > 0) {
			parts.push(this.followUpQueue.shift()!.message);
		}

		return {
			message: parts.join("\n\n"),
			priority: "interrupt",
			queuedAt: earliest,
		};
	}
}
