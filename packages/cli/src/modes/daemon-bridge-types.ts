/**
 * daemon-bridge type definitions — extracted to keep daemon-bridge.ts under 450 LOC.
 * @module daemon-bridge-types
 */

/** Options forwarded to the daemon's context.load RPC. */
export interface LoadContextOptions {
	/** Provider context window size in tokens (for adaptive budget). */
	providerContextWindow?: number;
	/** Device identifier for cross-device session pickup. */
	deviceId?: string;
}
