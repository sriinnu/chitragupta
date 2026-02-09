/**
 * SteeringManager — manages mid-turn steering instructions and follow-up queues.
 *
 * Steering allows injecting a system-level instruction into the current agent turn
 * (e.g. "focus on the database layer, not the UI"). Follow-ups are user messages
 * queued to be sent after the current turn completes.
 */

export class SteeringManager {
	private steeringInstruction: string | null = null;
	private followUpQueue: string[] = [];

	/**
	 * Set a steering instruction to be injected into the current turn.
	 * Overwrites any previous unconsumed steering instruction.
	 */
	steer(message: string): void {
		this.steeringInstruction = message;
	}

	/**
	 * Queue a follow-up message to be sent after the current turn completes.
	 */
	queueFollowUp(message: string): void {
		this.followUpQueue.push(message);
	}

	/**
	 * Consume and return the current steering instruction, clearing it.
	 * Returns null if no steering instruction is pending.
	 */
	getSteeringInstruction(): string | null {
		const instruction = this.steeringInstruction;
		this.steeringInstruction = null;
		return instruction;
	}

	/**
	 * Dequeue and return the next follow-up message.
	 * Returns null if no follow-ups are queued.
	 */
	getNextFollowUp(): string | null {
		return this.followUpQueue.shift() ?? null;
	}

	/**
	 * Check if there are any pending steering instructions or follow-ups.
	 */
	hasPending(): boolean {
		return this.steeringInstruction !== null || this.followUpQueue.length > 0;
	}

	/**
	 * Clear all pending steering instructions and follow-ups.
	 */
	clear(): void {
		this.steeringInstruction = null;
		this.followUpQueue = [];
	}
}
