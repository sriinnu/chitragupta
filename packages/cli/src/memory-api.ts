/**
 * Smriti Dvaara — Memory CRUD HTTP helpers for Chitragupta.
 *
 * Translates between URL scope parameters and MemoryScope discriminated
 * unions, provides metadata enrichment, and serialization for the REST API.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getChitraguptaHome } from "@chitragupta/core";
import type { MemoryScope } from "@chitragupta/smriti";
import {
	getMemory,
	listMemoryScopes,
} from "@chitragupta/smriti";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A memory entry with metadata, suitable for API responses. */
export interface MemoryEntry {
	/** Serialized scope string (e.g. "global", "project:/my/path", "agent:kartru"). */
	scope: string;
	/** Memory file content (empty string if file does not exist). */
	content: string;
	/** Whether the memory file exists on disk. */
	exists: boolean;
	/** ISO date of last modification, if file exists. */
	lastModified?: string;
}

/** Scope info with display name for listing endpoints. */
export interface MemoryScopeInfo {
	/** Scope type: "global", "project", or "agent". */
	type: string;
	/** Identifier within the type: project path or agent ID. */
	identifier?: string;
	/** Human-readable display name for this scope. */
	displayName: string;
}

// ─── Scope Parsing & Serialization ───────────────────────────────────────────

/**
 * Parse a URL scope parameter string into a MemoryScope discriminated union.
 *
 * Supported formats:
 *   - `"global"` -> `{ type: "global" }`
 *   - `"project:<path>"` -> `{ type: "project", path: "<path>" }`
 *   - `"agent:<agentId>"` -> `{ type: "agent", agentId: "<agentId>" }`
 *
 * Returns null for invalid formats or session scopes (session memory is
 * stored within session files and accessed via the session API).
 */
export function parseScopeParam(scopeStr: string): MemoryScope | null {
	if (!scopeStr || typeof scopeStr !== "string") return null;

	const trimmed = scopeStr.trim();

	if (trimmed === "global") {
		return { type: "global" };
	}

	if (trimmed.startsWith("project:")) {
		const projectPath = trimmed.slice("project:".length);
		if (!projectPath) return null;
		return { type: "project", path: projectPath };
	}

	if (trimmed.startsWith("agent:")) {
		const agentId = trimmed.slice("agent:".length);
		if (!agentId) return null;
		return { type: "agent", agentId };
	}

	// Session scopes are explicitly rejected — use the session API instead
	if (trimmed.startsWith("session:")) {
		return null;
	}

	return null;
}

/**
 * Serialize a MemoryScope back to the URL-parameter string format.
 * Inverse of parseScopeParam.
 */
export function serializeScope(scope: MemoryScope): string {
	switch (scope.type) {
		case "global":
			return "global";
		case "project":
			return `project:${scope.path}`;
		case "agent":
			return `agent:${scope.agentId}`;
		case "session":
			return `session:${scope.sessionId}`;
	}
}

// ─── Memory File Path Resolution (mirrors smriti internals for stat) ─────────

/**
 * Hash a project path to a short hex string, matching smriti's internal hash.
 */
function hashProject(projectPath: string): string {
	return crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

/**
 * Resolve a MemoryScope to its filesystem path.
 * Returns null for session scope.
 */
function resolveMemoryPath(scope: MemoryScope): string | null {
	const root = path.join(getChitraguptaHome(), "memory");

	switch (scope.type) {
		case "global":
			return path.join(root, "global.md");
		case "project":
			return path.join(root, "projects", hashProject(scope.path), "project.md");
		case "agent":
			return path.join(root, "agents", `${scope.agentId}.md`);
		case "session":
			return null;
	}
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

/**
 * Get a MemoryEntry with metadata for a given scope.
 * Returns content, existence, and last-modified timestamp.
 */
export function getMemoryEntry(scope: MemoryScope): MemoryEntry {
	const scopeStr = serializeScope(scope);
	const content = getMemory(scope);
	const filePath = resolveMemoryPath(scope);

	let exists = false;
	let lastModified: string | undefined;

	if (filePath) {
		try {
			if (fs.existsSync(filePath)) {
				exists = true;
				const stat = fs.statSync(filePath);
				lastModified = stat.mtime.toISOString();
			}
		} catch {
			// Non-fatal: stat may fail on race conditions
		}
	}

	return { scope: scopeStr, content, exists, lastModified };
}

/**
 * List all existing memory scopes with human-readable display names.
 */
export function listAllScopes(): MemoryScopeInfo[] {
	const scopes = listMemoryScopes();

	return scopes.map((scope): MemoryScopeInfo => {
		switch (scope.type) {
			case "global":
				return {
					type: "global",
					displayName: "Global Memory",
				};

			case "project":
				return {
					type: "project",
					identifier: scope.path,
					displayName: `Project: ${scope.path}`,
				};

			case "agent":
				return {
					type: "agent",
					identifier: scope.agentId,
					displayName: `Agent: ${scope.agentId}`,
				};

			default:
				return {
					type: "unknown",
					displayName: "Unknown scope",
				};
		}
	});
}
