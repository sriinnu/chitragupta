/**
 * WebSocket connection manager for real-time Hub events.
 *
 * Manages a persistent WebSocket connection with automatic reconnection
 * using exponential backoff. Exposes reactive signals for connection
 * status and the latest received event.
 * @module signals/realtime
 */

import { signal } from "@preact/signals";
import { createWS } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** WebSocket connection states. */
export type WsStatus = "connected" | "connecting" | "disconnected";

/** Shape of an event received over the WebSocket. */
export interface WsEvent {
	type: string;
	payload: Record<string, unknown>;
	timestamp: number;
}

// ── Signals ───────────────────────────────────────────────────────

/** Current WebSocket connection status. */
export const wsStatus = signal<WsStatus>("disconnected");

/** The most recently received WebSocket event. `null` until first message. */
export const lastEvent = signal<WsEvent | null>(null);

// ── Internal state ────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

/** Maximum reconnection delay in milliseconds. */
const MAX_BACKOFF_MS = 30_000;

/** Base reconnection delay in milliseconds. */
const BASE_BACKOFF_MS = 1_000;

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Calculate the next backoff delay using exponential strategy.
 * Doubles each attempt: 1s, 2s, 4s, 8s, ... capped at 30s.
 */
function getBackoffDelay(): number {
	const delay = BASE_BACKOFF_MS * Math.pow(2, reconnectAttempt);
	return Math.min(delay, MAX_BACKOFF_MS);
}

/** Schedule a reconnection attempt after the appropriate backoff delay. */
function scheduleReconnect(): void {
	if (intentionalClose) return;
	const delay = getBackoffDelay();
	reconnectAttempt++;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectWebSocket();
	}, delay);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Open a WebSocket connection to the server's event stream.
 *
 * Handles open/close/error/message events and triggers automatic
 * reconnection with exponential backoff on unexpected disconnects.
 */
export function connectWebSocket(): void {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return;
	}

	intentionalClose = false;
	wsStatus.value = "connecting";

	try {
		ws = createWS("/ws/events");
	} catch {
		wsStatus.value = "disconnected";
		scheduleReconnect();
		return;
	}

	ws.onopen = () => {
		wsStatus.value = "connected";
		reconnectAttempt = 0;
	};

	ws.onmessage = (event: MessageEvent) => {
		try {
			const parsed = JSON.parse(event.data as string) as WsEvent;
			lastEvent.value = parsed;
		} catch {
			// Ignore malformed messages
		}
	};

	ws.onclose = () => {
		wsStatus.value = "disconnected";
		ws = null;
		scheduleReconnect();
	};

	ws.onerror = () => {
		// onerror is always followed by onclose, which handles reconnection
		wsStatus.value = "disconnected";
	};
}

/**
 * Intentionally close the WebSocket connection.
 * Clears any pending reconnection timers and prevents automatic reconnect.
 */
export function disconnectWebSocket(): void {
	intentionalClose = true;
	if (reconnectTimer !== null) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (ws) {
		ws.close();
		ws = null;
	}
	wsStatus.value = "disconnected";
	reconnectAttempt = 0;
}

/**
 * Send a subscription message over the WebSocket.
 *
 * Subscribes to specific event patterns so the server only sends
 * events matching those patterns.
 *
 * @param patterns - Array of event type patterns to subscribe to.
 */
export function subscribe(patterns: string[]): void {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ action: "subscribe", patterns }));
	}
}
