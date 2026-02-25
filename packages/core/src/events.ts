import type { EventBus } from "./types.js";

/**
 * Create a simple typed event emitter with no external dependencies.
 *
 * Provides on/off/emit/once/removeAll methods for decoupled event-driven
 * communication between Chitragupta subsystems.
 *
 * Handlers that throw are caught and logged, preventing one broken listener
 * from disrupting others.
 *
 * @returns A new {@link EventBus} instance.
 *
 * @example
 * ```ts
 * const bus = createEventBus();
 * bus.on("session:created", (data) => console.log(data));
 * bus.emit("session:created", { id: "s-123" });
 * ```
 */
export function createEventBus(): EventBus {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	return {
		on<T>(event: string, handler: (data: T) => void): void {
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			// Safe cast: handlers are stored generically and invoked with the correct data type via emit<T>.
			listeners.get(event)!.add(handler as (...args: unknown[]) => void);
		},

		off(event: string, handler: (...args: unknown[]) => void): void {
			listeners.get(event)?.delete(handler);
		},

		emit<T>(event: string, data: T): void {
			const handlers = listeners.get(event);
			if (!handlers) return;
			for (const handler of handlers) {
				try {
					handler(data);
				} catch (err) {
					// Handler errors are caught to prevent one broken listener from disrupting others.
					// Log to stderr so failures are visible without requiring a logger dependency.
					process.stderr.write(
						`[chitragupta] EventBus handler error on "${event}": ${err instanceof Error ? err.message : String(err)}\n`,
					);
				}
			}
		},

		once<T>(event: string, handler: (data: T) => void): void {
			// Safe cast: wrapper stored generically, invoked with correct data type via emit<T>.
			const wrapper = ((data: T) => {
				listeners.get(event)?.delete(wrapper as (...args: unknown[]) => void);
				handler(data);
			}) as (...args: unknown[]) => void;
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			listeners.get(event)!.add(wrapper);
		},

		removeAll(event?: string): void {
			if (event) {
				listeners.delete(event);
			} else {
				listeners.clear();
			}
		},
	};
}
