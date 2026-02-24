/**
 * Test setup for the Hub SPA test suite.
 *
 * Provides minimal DOM mocks (window, localStorage, fetch) so that
 * the signal modules and API client can run in a Node/vitest
 * environment without a real browser.
 * @module test/setup
 */

import { vi } from "vitest";

// ── localStorage mock ───────────────────────────────────────────

/** In-memory storage backing for localStorage mock. */
const storageMap = new Map<string, string>();

/** Mock localStorage implementation backed by a simple Map. */
const localStorageMock: Storage = {
	getItem: (key: string): string | null => storageMap.get(key) ?? null,
	setItem: (key: string, value: string): void => {
		storageMap.set(key, value);
	},
	removeItem: (key: string): void => {
		storageMap.delete(key);
	},
	clear: (): void => {
		storageMap.clear();
	},
	get length(): number {
		return storageMap.size;
	},
	key: (index: number): string | null => {
		const keys = [...storageMap.keys()];
		return keys[index] ?? null;
	},
};

// ── window / globalThis mocks ───────────────────────────────────

if (typeof globalThis.localStorage === "undefined") {
	Object.defineProperty(globalThis, "localStorage", {
		value: localStorageMock,
		writable: true,
	});
}

if (typeof globalThis.window === "undefined") {
	Object.defineProperty(globalThis, "window", {
		value: {
			location: { origin: "http://localhost:3141" },
		},
		writable: true,
	});
} else if (!globalThis.window.location) {
	(globalThis.window as Record<string, unknown>).location = {
		origin: "http://localhost:3141",
	};
}

// ── fetch mock ──────────────────────────────────────────────────

if (typeof globalThis.fetch === "undefined") {
	Object.defineProperty(globalThis, "fetch", {
		value: vi.fn(),
		writable: true,
	});
}

// ── Headers mock (minimal polyfill) ─────────────────────────────

if (typeof globalThis.Headers === "undefined") {
	class HeadersMock {
		private _map = new Map<string, string>();

		constructor(init?: HeadersInit | Record<string, string>) {
			if (init && typeof init === "object" && !Array.isArray(init)) {
				for (const [k, v] of Object.entries(init)) {
					this._map.set(k.toLowerCase(), String(v));
				}
			}
		}

		has(name: string): boolean {
			return this._map.has(name.toLowerCase());
		}

		get(name: string): string | null {
			return this._map.get(name.toLowerCase()) ?? null;
		}

		set(name: string, value: string): void {
			this._map.set(name.toLowerCase(), value);
		}

		delete(name: string): void {
			this._map.delete(name.toLowerCase());
		}

		entries(): IterableIterator<[string, string]> {
			return this._map.entries();
		}

		forEach(cb: (value: string, key: string) => void): void {
			this._map.forEach(cb);
		}
	}

	Object.defineProperty(globalThis, "Headers", {
		value: HeadersMock,
		writable: true,
	});
}

// ── WebSocket mock ──────────────────────────────────────────────

if (typeof globalThis.WebSocket === "undefined") {
	class WebSocketMock {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;

		readonly CONNECTING = 0;
		readonly OPEN = 1;
		readonly CLOSING = 2;
		readonly CLOSED = 3;

		readyState = 1;
		url: string;
		onopen: ((ev: Event) => void) | null = null;
		onclose: ((ev: Event) => void) | null = null;
		onmessage: ((ev: MessageEvent) => void) | null = null;
		onerror: ((ev: Event) => void) | null = null;

		constructor(url: string) {
			this.url = url;
		}

		send(_data: string): void {
			/* noop in mock */
		}

		close(): void {
			this.readyState = 3;
		}
	}

	Object.defineProperty(globalThis, "WebSocket", {
		value: WebSocketMock,
		writable: true,
	});
}

// ── Reset storage between tests ─────────────────────────────────

/** Clear the in-memory storage between tests to prevent leakage. */
export function resetStorage(): void {
	storageMap.clear();
}
