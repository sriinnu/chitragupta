/**
 * P2P Wire Serialization for MeshEnvelope and PeerMessages.
 *
 * Handles JSON serialization/deserialization with validation,
 * HMAC-SHA256 signing for authenticated peers, and envelope
 * origin stamping for distributed routing.
 *
 * @module
 */

import { createHmac } from "node:crypto";
import type { MeshEnvelope, MeshPriority } from "./types.js";
import type { PeerMessage } from "./peer-types.js";

// ─── Serialization ──────────────────────────────────────────────────────────

/** Maximum wire message size (1 MB). Reject anything larger. */
const MAX_MESSAGE_BYTES = 1_048_576;

/** Serialize a PeerMessage to a JSON string for the wire. */
export function serializePeerMessage(msg: PeerMessage): string {
	return JSON.stringify(msg);
}

/**
 * Deserialize a raw WebSocket text frame into a PeerMessage.
 * Returns null if the message is malformed or too large.
 */
export function deserializePeerMessage(raw: string): PeerMessage | null {
	if (raw.length > MAX_MESSAGE_BYTES) return null;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!parsed || typeof parsed.type !== "string") return null;
		return parsed as unknown as PeerMessage;
	} catch {
		return null;
	}
}

// ─── Envelope Validation ────────────────────────────────────────────────────

const VALID_ENVELOPE_TYPES = new Set(["tell", "ask", "reply", "signal"]);
const VALID_PRIORITIES = new Set([0, 1, 2, 3]);

/**
 * Validate a deserialized MeshEnvelope from the network.
 * Checks required fields, types, and value ranges.
 */
export function validateEnvelope(env: unknown): env is MeshEnvelope {
	if (!env || typeof env !== "object") return false;
	const e = env as Record<string, unknown>;
	return (
		typeof e.id === "string" && e.id.length > 0 &&
		typeof e.from === "string" && e.from.length > 0 &&
		typeof e.to === "string" && e.to.length > 0 &&
		typeof e.type === "string" && VALID_ENVELOPE_TYPES.has(e.type) &&
		VALID_PRIORITIES.has(e.priority as number) &&
		typeof e.timestamp === "number" && e.timestamp > 0 &&
		typeof e.ttl === "number" && e.ttl > 0 &&
		Array.isArray(e.hops)
	);
}

// ─── Origin Stamping ────────────────────────────────────────────────────────

/**
 * Stamp an envelope with the sending node's ID in the hops array.
 * Prevents routing loops across the distributed mesh.
 */
export function stampOrigin(env: MeshEnvelope, nodeId: string): MeshEnvelope {
	if (env.hops.includes(nodeId)) return env;
	return { ...env, hops: [...env.hops, nodeId] };
}

/**
 * Check if an envelope has already visited a specific node.
 * Used for loop prevention in multi-hop routing.
 */
export function hasVisited(env: MeshEnvelope, nodeId: string): boolean {
	return env.hops.includes(nodeId);
}

// ─── HMAC Signing ───────────────────────────────────────────────────────────

/**
 * Sign a wire message with HMAC-SHA256 using the mesh shared secret.
 * Returns the hex signature string.
 */
export function signMessage(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify a wire message's HMAC-SHA256 signature.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
	const expected = signMessage(payload, secret);
	if (expected.length !== signature.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return diff === 0;
}

// ─── Envelope Factory ───────────────────────────────────────────────────────

let envelopeCounter = 0;

/** Generate a unique envelope ID. */
export function generateEnvelopeId(nodeId: string): string {
	return `${nodeId}-${Date.now().toString(36)}-${(++envelopeCounter).toString(36)}`;
}

/** Create a minimal valid MeshEnvelope. */
export function createEnvelope(
	from: string,
	to: string,
	payload: unknown,
	opts: {
		type?: MeshEnvelope["type"];
		priority?: MeshPriority;
		ttl?: number;
		topic?: string;
		correlationId?: string;
		nodeId?: string;
	} = {},
): MeshEnvelope {
	return {
		id: generateEnvelopeId(opts.nodeId ?? "local"),
		from,
		to,
		type: opts.type ?? "tell",
		payload,
		priority: opts.priority ?? 1,
		timestamp: Date.now(),
		ttl: opts.ttl ?? 30_000,
		hops: [],
		...(opts.topic ? { topic: opts.topic } : {}),
		...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
	};
}
