/**
 * Type definitions, constants, and helpers for the Samiti ambient channel system.
 *
 * @module samiti-types
 */

import type { RingBuffer } from "./ring-buffer.js";

// ─── FNV-1a (inline, zero-dependency) ────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash of the input string, returned as a
 * zero-padded hex string.
 */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Public Types ────────────────────────────────────────────────────────────

/** A message broadcast to a Samiti channel. */
export interface SamitiMessage {
	/** Deterministic ID — FNV-1a hash of timestamp + channel + sender. */
	id: string;
	/** Channel name (e.g., '#security', '#performance'). */
	channel: string;
	/** Agent ID or system component that sent the message. */
	sender: string;
	/** Severity level of the observation. */
	severity: "info" | "warning" | "critical";
	/** Freeform category tag (e.g., 'credential-leak', 'slow-query'). */
	category: string;
	/** Human-readable message content. */
	content: string;
	/** Optional structured payload data. */
	data?: unknown;
	/** Unix epoch ms when the message was created. */
	timestamp: number;
	/** Time-to-live in ms. 0 means infinite (never expires). */
	ttl: number;
	/** IDs of related messages for threading/correlation. */
	references?: string[];
}

/** A persistent, topic-based ambient channel. */
export interface SamitiChannel {
	/** Channel name (must start with '#'). */
	name: string;
	/** Human-readable description. */
	description: string;
	/** Maximum messages retained in the ring buffer. */
	maxHistory: number;
	/** Set of subscribed agent IDs. */
	subscribers: Set<string>;
	/** Ring buffer of messages (oldest first on read). */
	messages: SamitiMessage[];
	/** Unix epoch ms when the channel was created. */
	createdAt: number;
}

/** Configuration for the Samiti ambient channel system. */
export interface SamitiConfig {
	/** Maximum number of channels allowed. Default: 20. */
	maxChannels: number;
	/** Default ring buffer size for new channels. Default: 100. */
	defaultMaxHistory: number;
	/** Default TTL for messages in ms. Default: 86400000 (24h). */
	defaultTTL: number;
	/** Whether to enable persistence (reserved for future use). Default: false. */
	enablePersistence: boolean;
}

/** Options for filtering messages when listening. */
export interface ListenOptions {
	/** Only return messages after this timestamp (Unix epoch ms). */
	since?: number;
	/** Only return messages of this severity. */
	severity?: SamitiMessage["severity"];
	/** Maximum number of messages to return. */
	limit?: number;
}

/** Aggregate statistics for the Samiti system. */
export interface SamitiStats {
	/** Number of active channels. */
	channels: number;
	/** Total messages across all channels. */
	totalMessages: number;
	/** Total unique subscribers across all channels. */
	subscribers: number;
}

// ─── Hard Ceilings ───────────────────────────────────────────────────────────

/** System hard ceilings — cannot be exceeded regardless of configuration. */
export const HARD_CEILINGS = {
	maxChannels: 100,
	maxHistory: 10_000,
	maxMessageSize: 1_048_576, // 1MB
	maxSubscribersPerChannel: 50,
} as const;

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SAMITI_CONFIG: SamitiConfig = {
	maxChannels: 20,
	defaultMaxHistory: 100,
	defaultTTL: 86_400_000, // 24 hours
	enablePersistence: false,
};

/** Pre-configured channels created on construction. */
export const DEFAULT_CHANNELS: ReadonlyArray<{ name: string; description: string }> = [
	{ name: "#security", description: "Security findings, credential leaks, vulnerability alerts" },
	{ name: "#performance", description: "Performance regressions, memory leaks, slow queries" },
	{ name: "#correctness", description: "Logic errors, test failures, type mismatches" },
	{ name: "#style", description: "Code style violations, naming inconsistencies" },
	{ name: "#alerts", description: "System alerts, daemon events, threshold breaches" },
];

// ─── Internal Channel State ──────────────────────────────────────────────────

/** Internal channel representation using a proper ring buffer. */
export interface InternalChannel {
	name: string;
	description: string;
	maxHistory: number;
	subscribers: Set<string>;
	ring: RingBuffer<SamitiMessage>;
	createdAt: number;
}
