/**
 * @chitragupta/smriti — Provider & Actor Label Utilities
 *
 * Normalizes session provider identifiers into stable, human-readable labels.
 * UUIDs and opaque hashes are shortened to `subagent#XXXXXXXX`. Well-known
 * provider aliases (mcp-client, mcp-host) are normalized to "mcp".
 *
 * Shared by event-extractor, day-consolidation, and day-consolidation-renderer
 * so that provider labels are consistent across all outputs.
 *
 * @module
 */

import type { SessionMeta } from "./types.js";

// ─── ANSI Regex ─────────────────────────────────────────────────────────────

/** ECMA-48 CSI sequence pattern (covers SGR, cursor movement, etc). */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Strip ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

// ─── Provider Label Normalization ───────────────────────────────────────────

/**
 * Normalize a raw provider string into a stable label.
 *
 * - Strips ANSI, trims, lowercases.
 * - Returns `null` for empty/missing/oversized values.
 * - Maps mcp-client / mcp-host → "mcp".
 * - Shortens UUIDs and hex hashes to `subagent#XXXXXXXX`.
 */
export function normalizeProviderLabel(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = value
		.replace(ANSI_RE, "")
		.trim()
		.toLowerCase();
	if (!cleaned) return null;
	if (cleaned.length > 80) return null;
	if (cleaned === "mcp-client" || cleaned === "mcp-host") return "mcp";
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cleaned)) {
		return `subagent#${cleaned.slice(0, 8)}`;
	}
	if (/^[0-9a-f]{32,}$/.test(cleaned)) return `subagent#${cleaned.slice(0, 8)}`;
	return cleaned;
}

/**
 * Normalize a human-facing actor label (agent name, display name, etc).
 *
 * - Strips ANSI, trims, lowercases, collapses non-alphanum to hyphens.
 * - Returns `null` for empty/oversized values.
 */
export function normalizeActorLabel(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = value
		.replace(ANSI_RE, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!cleaned || cleaned.length > 48) return null;
	return cleaned;
}

/**
 * Extract an actor label from a session title like "Agent session: foo"
 * or "Sub-agent: bar".
 */
export function titleActorLabel(title: string): string | null {
	const agentMatch = title.match(/^Agent session:\s*(.+)$/i);
	if (agentMatch) return normalizeActorLabel(agentMatch[1]);
	const subMatch = title.match(/^Sub-agent:\s*(.+)$/i);
	if (subMatch) return normalizeActorLabel(subMatch[1]);
	return null;
}

/**
 * Resolve a session's provider label with a multi-level fallback chain:
 *
 * 1. Named actor label from metadata (agentLabel, actorLabel, displayName, etc.)
 * 2. Session-level `provider` field
 * 3. metadata.provider
 * 4. Session-level `agent` field
 * 5. "unknown"
 *
 * When a named actor is found, the result includes a subagent prefix with
 * an optional 8-char ID suffix for disambiguation.
 */
export function resolveSessionProvider(meta: SessionMeta): string {
	const metadata = (meta.metadata as Record<string, unknown> | undefined) ?? {};
	const actorLabel =
		normalizeActorLabel(metadata.agentLabel) ??
		normalizeActorLabel(metadata.actorLabel) ??
		normalizeActorLabel(metadata.actorName) ??
		normalizeActorLabel(metadata.displayName) ??
		normalizeActorLabel(metadata.nickname) ??
		normalizeActorLabel(metadata.name) ??
		normalizeActorLabel(metadata.profile) ??
		normalizeActorLabel(metadata.purpose) ??
		titleActorLabel(meta.title);
	const actorId = normalizeProviderLabel(metadata.actorId);
	if (actorLabel) {
		const idSuffix = (actorId ?? normalizeProviderLabel(meta.agent))?.match(/^subagent#([a-z0-9]{8})$/)?.[1];
		return idSuffix ? `subagent:${actorLabel}#${idSuffix}` : `subagent:${actorLabel}`;
	}
	const fromProvider = normalizeProviderLabel(meta.provider);
	if (fromProvider) return fromProvider;
	const fromMetadata = normalizeProviderLabel(metadata.provider);
	if (fromMetadata) return fromMetadata;
	const fromAgent = normalizeProviderLabel(meta.agent);
	return fromAgent ?? "unknown";
}
