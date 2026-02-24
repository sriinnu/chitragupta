/**
 * Types for incremental handover (handover_since).
 *
 * @module handover-types
 */

/**
 * Delta produced by incremental handover (handover_since).
 * Contains only changes since the previous cursor position.
 */
export interface HandoverDelta {
	sessionId: string;
	previousCursor: number;
	newCursor: number;
	turnsAdded: number;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
	commands: string[];
}
