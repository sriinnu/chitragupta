/**
 * Authentication signals for the Hub SPA.
 *
 * Uses Preact signals to provide reactive auth state. Token and device ID
 * are persisted to localStorage so they survive page reloads.
 * @module signals/auth
 */

import { signal, computed } from "@preact/signals";

const TOKEN_KEY = "chitragupta_hub_token";
const DEVICE_ID_KEY = "chitragupta_hub_device_id";

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 string.
 * Prefers `crypto.randomUUID()` when available, falls back to a manual
 * implementation for older browsers.
 */
function generateUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// Fallback for environments without crypto.randomUUID
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/** Read a string value from localStorage, returning null when absent. */
function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Write a string value to localStorage, silently ignoring errors. */
function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage may be unavailable (private browsing, quota exceeded).
	}
}

/** Remove a key from localStorage, silently ignoring errors. */
function removeStorage(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// noop
	}
}

// ── Signals ────────────────────────────────────────────────────────

/** JWT bearer token. `null` when unauthenticated. */
export const token = signal<string | null>(readStorage(TOKEN_KEY));

/** Reactive boolean indicating whether the user holds a valid token. */
export const isAuthenticated = computed<boolean>(() => token.value !== null);

/**
 * Stable device identifier persisted across sessions.
 * Generated once on first visit, then reused.
 */
export const deviceId = signal<string>(
	readStorage(DEVICE_ID_KEY) ?? (() => {
		const id = generateUUID();
		writeStorage(DEVICE_ID_KEY, id);
		return id;
	})(),
);

// ── Mutators ───────────────────────────────────────────────────────

/**
 * Store a new JWT token and persist it to localStorage.
 * @param jwt - The bearer token received from the server.
 */
export function setToken(jwt: string): void {
	token.value = jwt;
	writeStorage(TOKEN_KEY, jwt);
}

/**
 * Clear the current auth token from both signal state and localStorage.
 */
export function clearToken(): void {
	token.value = null;
	removeStorage(TOKEN_KEY);
}

/**
 * Build an Authorization header object for the current token.
 * Returns an empty object when unauthenticated so callers can safely
 * spread it into a headers init: `{ ...getAuthHeaders() }`.
 */
export function getAuthHeaders(): Record<string, string> {
	if (token.value) {
		return { Authorization: `Bearer ${token.value}` };
	}
	return {};
}
