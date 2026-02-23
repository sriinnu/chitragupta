/**
 * @chitragupta/sutra/mesh — CapabilityLearner: runtime capability discovery.
 *
 * Tracks which message types (identified by payload.type or topic) an actor
 * handles successfully. After a configurable threshold of successes, the
 * message type is promoted to a declared capability in the gossip protocol.
 *
 * Mirrors Vasana (behavioral tendencies in Vedic philosophy): past actions
 * shape future routing. No configuration needed — capabilities emerge from
 * observed behavior.
 *
 * @module
 */

import type { GossipProtocol } from "./gossip-protocol.js";
import type { MeshEnvelope } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the capability learner. */
export interface CapabilityLearnerConfig {
	/** Successes needed before a message type becomes a capability. Default: 5 */
	promotionThreshold?: number;
	/** Max tracked message types per actor (prevents memory bloat). Default: 50 */
	maxTrackedTypes?: number;
	/** Decay interval (ms): reduce counters periodically. Default: 300_000 (5min) */
	decayIntervalMs?: number;
	/** Decay factor (multiply counters by this each interval). Default: 0.8 */
	decayFactor?: number;
}

/** Tracking entry for a single message type on a single actor. */
interface TypeTracker {
	successes: number;
	failures: number;
	lastSeen: number;
	promoted: boolean;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PROMOTION_THRESHOLD = 5;
const DEFAULT_MAX_TRACKED_TYPES = 50;
const DEFAULT_DECAY_INTERVAL_MS = 300_000;
const DEFAULT_DECAY_FACTOR = 0.8;

// ─── CapabilityLearner ──────────────────────────────────────────────────────

/**
 * Learns capabilities from observed message handling behavior.
 *
 * Attach to an ActorSystem to track successes/failures per actor per
 * message type. When an actor consistently handles a message type,
 * it becomes a declared capability via gossip.
 *
 * @example
 * ```ts
 * const learner = new CapabilityLearner(gossip, { promotionThreshold: 3 });
 * learner.start();
 *
 * // After actor "worker" successfully handles 3 "lint" messages:
 * // gossip auto-registers "lint" as a capability for "worker"
 * ```
 */
export class CapabilityLearner {
	private readonly gossip: GossipProtocol;
	private readonly config: Required<CapabilityLearnerConfig>;

	/** actorId → (messageType → TypeTracker) */
	private readonly tracking = new Map<string, Map<string, TypeTracker>>();
	private decayTimer: ReturnType<typeof setInterval> | null = null;

	constructor(gossip: GossipProtocol, config?: CapabilityLearnerConfig) {
		this.gossip = gossip;
		this.config = {
			promotionThreshold: config?.promotionThreshold ?? DEFAULT_PROMOTION_THRESHOLD,
			maxTrackedTypes: config?.maxTrackedTypes ?? DEFAULT_MAX_TRACKED_TYPES,
			decayIntervalMs: config?.decayIntervalMs ?? DEFAULT_DECAY_INTERVAL_MS,
			decayFactor: config?.decayFactor ?? DEFAULT_DECAY_FACTOR,
		};
	}

	// ─── Recording ──────────────────────────────────────────────────

	/**
	 * Record a successful message handling for an actor.
	 * If the message type crosses the promotion threshold, it becomes a capability.
	 */
	recordSuccess(actorId: string, envelope: MeshEnvelope): void {
		const msgType = this.extractMessageType(envelope);
		if (!msgType) return;

		const tracker = this.getOrCreateTracker(actorId, msgType);
		tracker.successes++;
		tracker.lastSeen = Date.now();

		if (!tracker.promoted && tracker.successes >= this.config.promotionThreshold) {
			this.promote(actorId, msgType);
			tracker.promoted = true;
		}
	}

	/**
	 * Record a failed message handling for an actor.
	 * Failures slow down promotion but don't revoke existing capabilities.
	 */
	recordFailure(actorId: string, envelope: MeshEnvelope): void {
		const msgType = this.extractMessageType(envelope);
		if (!msgType) return;

		const tracker = this.getOrCreateTracker(actorId, msgType);
		tracker.failures++;
		tracker.lastSeen = Date.now();
	}

	// ─── Query ──────────────────────────────────────────────────────

	/** Get learned capabilities for an actor (promoted types). */
	getLearnedCapabilities(actorId: string): string[] {
		const actorMap = this.tracking.get(actorId);
		if (!actorMap) return [];
		const caps: string[] = [];
		for (const [msgType, tracker] of actorMap) {
			if (tracker.promoted) caps.push(msgType);
		}
		return caps;
	}

	/** Get tracking stats for an actor and message type. */
	getStats(actorId: string, msgType: string): { successes: number; failures: number } | undefined {
		return this.tracking.get(actorId)?.get(msgType);
	}

	/** Number of actors being tracked. */
	get trackedActorCount(): number { return this.tracking.size; }

	// ─── Lifecycle ──────────────────────────────────────────────────

	/** Start periodic decay of counters. */
	start(): void {
		if (this.decayTimer) return;
		this.decayTimer = setInterval(() => this.decay(), this.config.decayIntervalMs);
	}

	/** Stop decay timer and clear state. */
	stop(): void {
		if (this.decayTimer) {
			clearInterval(this.decayTimer);
			this.decayTimer = null;
		}
	}

	/** Stop and clear all tracking data. */
	destroy(): void {
		this.stop();
		this.tracking.clear();
	}

	// ─── Internals ──────────────────────────────────────────────────

	/**
	 * Extract a message type identifier from an envelope.
	 * Priority: payload.type > topic > envelope.type (fallback).
	 */
	private extractMessageType(envelope: MeshEnvelope): string | undefined {
		const payload = envelope.payload as Record<string, unknown> | undefined;
		if (payload && typeof payload.type === "string") return payload.type;
		if (envelope.topic) return envelope.topic;
		// Don't track generic tell/ask/reply as capabilities
		return undefined;
	}

	/** Get or create a tracker entry for an actor + message type. */
	private getOrCreateTracker(actorId: string, msgType: string): TypeTracker {
		let actorMap = this.tracking.get(actorId);
		if (!actorMap) {
			actorMap = new Map();
			this.tracking.set(actorId, actorMap);
		}

		let tracker = actorMap.get(msgType);
		if (!tracker) {
			// Evict oldest if at capacity
			if (actorMap.size >= this.config.maxTrackedTypes) {
				this.evictOldest(actorMap);
			}
			tracker = { successes: 0, failures: 0, lastSeen: Date.now(), promoted: false };
			actorMap.set(msgType, tracker);
		}
		return tracker;
	}

	/** Promote a message type to a declared capability via gossip. */
	private promote(actorId: string, capability: string): void {
		const view = this.gossip.getView().find((v) => v.actorId === actorId);
		const existingCaps = view?.capabilities ?? [];
		if (existingCaps.includes(capability)) return;
		const expertise = view?.expertise;
		this.gossip.register(actorId, expertise, [...existingCaps, capability]);
	}

	/** Decay all counters by the decay factor. */
	private decay(): void {
		for (const [, actorMap] of this.tracking) {
			for (const [msgType, tracker] of actorMap) {
				tracker.successes = Math.floor(tracker.successes * this.config.decayFactor);
				tracker.failures = Math.floor(tracker.failures * this.config.decayFactor);
				// Remove zeroed-out entries (except promoted ones)
				if (tracker.successes === 0 && tracker.failures === 0 && !tracker.promoted) {
					actorMap.delete(msgType);
				}
			}
		}
	}

	/** Evict the oldest tracked type from an actor's map. */
	private evictOldest(actorMap: Map<string, TypeTracker>): void {
		let oldest: string | undefined;
		let oldestTime = Infinity;
		for (const [msgType, tracker] of actorMap) {
			if (!tracker.promoted && tracker.lastSeen < oldestTime) {
				oldest = msgType;
				oldestTime = tracker.lastSeen;
			}
		}
		if (oldest) actorMap.delete(oldest);
	}
}
